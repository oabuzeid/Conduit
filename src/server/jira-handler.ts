import { readFileSync, existsSync } from "fs";
import type { ConduitConfig } from "../core/config.js";
import { analyzeReverseDiff, type TicketSnapshot } from "../core/reverse-analyzer.js";
import { decide } from "../core/agent.js";
import { openSpecPR } from "../core/spec-pr.js";
import { isConduitWrite, matchesRecentSelfWrite, recentSelfWrites } from "../core/loop-guard.js";

interface JiraChangelogItem {
  field: string;
  fromString: string | null;
  toString: string | null;
}

interface JiraWebhookPayload {
  webhookEvent?: string;
  issue?: {
    id: string;
    key: string;
    fields: {
      summary: string;
      description?: unknown;
      status?: { name: string };
      labels?: string[];
    };
  };
  changelog?: { items: JiraChangelogItem[] };
}

export async function handleJiraWebhook(payload: JiraWebhookPayload, config: ConduitConfig): Promise<void> {
  if (payload.webhookEvent !== "jira:issue_updated") {
    console.log(`[jira] ignoring event: ${payload.webhookEvent}`);
    return;
  }
  const issue = payload.issue;
  const changelog = payload.changelog;
  if (!issue || !changelog) {
    console.log("[jira] no issue or changelog in payload — skipping");
    return;
  }

  if (isConduitWrite({ labels: issue.fields.labels })) {
    console.log(`[jira] ${issue.key}: self-write detected via label — skipping`);
    return;
  }
  if (matchesRecentSelfWrite({ ticket_id: issue.key })) {
    console.log(`[jira] ${issue.key}: matches recent self-write — skipping`);
    return;
  }

  const after: TicketSnapshot = {
    id: issue.key,
    title: issue.fields.summary,
    description: extractText(issue.fields.description),
    labels: issue.fields.labels ?? [],
    status: issue.fields.status?.name ?? "",
    acceptance_criteria: [],
  };

  const before: TicketSnapshot = { ...after };
  for (const item of changelog.items) {
    if (item.field === "summary") before.title = item.fromString ?? "";
    else if (item.field === "description") before.description = item.fromString ?? "";
    else if (item.field === "status") before.status = item.fromString ?? "";
    else if (item.field === "labels") before.labels = (item.fromString ?? "").split(/\s+/).filter(Boolean);
  }

  const mapped = lookupSpecMapping(issue.key);
  const event = await analyzeReverseDiff(before, after, mapped, "jira", config);
  if (!event) {
    console.log(`[jira] ${issue.key}: no analyzable field changes — skipping`);
    return;
  }
  console.log(`[jira] ${issue.key}: ${event.field_diffs.map((d) => d.field).join(", ")} changed`);

  const decision = await decide(event, { spec_section_content: mapped?.content, recent_self_writes: recentSelfWrites() }, config);
  console.log(`[jira] ${issue.key}: agent decision → ${decision.action}`);
  if (decision.reasoning) console.log(`        ${decision.reasoning}`);

  if (decision.action !== "open_pr_now" || !decision.pr_payload) {
    if (decision.question) console.log(`        question: ${decision.question}`);
    return;
  }

  const repo = parseRepoEnv();
  if (!repo) {
    console.warn("[jira] CONDUIT_GITHUB_REPO not set (owner/name) — cannot open PR");
    return;
  }
  if (mapped?.file) {
    decision.pr_payload.target_spec_file = mapped.file;
  }

  const result = await openSpecPR(
    {
      decision: { ...decision, pr_payload: decision.pr_payload },
      triggering_event: event,
      spec_file_path: decision.pr_payload.target_spec_file,
      repo,
    },
    config
  );
  console.log(`[jira] ${issue.key}: opened spec PR ${result.pr_url}`);
}

function lookupSpecMapping(ticketKey: string): { file: string; section: string; content: string } | null {
  const statePath = ".conduit/state.json";
  if (!existsSync(statePath)) return null;
  const state = JSON.parse(readFileSync(statePath, "utf-8")) as {
    mappings: Array<{ ticket_id: string; spec_file: string; spec_section: string }>;
  };
  const m = state.mappings.find((x) => x.ticket_id === ticketKey);
  if (!m) return null;
  const candidates = ["specs/__tests/", "specs/"].map((d) => d + m.spec_file);
  const specPath = candidates.find((p) => existsSync(p));
  if (!specPath) return null;
  const specContent = readFileSync(specPath, "utf-8");
  const escaped = m.spec_section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = specContent.match(new RegExp(`## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`));
  if (!match) return null;
  return { file: specPath, section: m.spec_section, content: match[1].trim() };
}

function parseRepoEnv(): { owner: string; name: string } | null {
  const env = process.env.CONDUIT_GITHUB_REPO;
  if (!env || !env.includes("/")) return null;
  const [owner, name] = env.split("/");
  return { owner, name };
}

function extractText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const doc = adf as { content?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; content?: unknown[] }> }> };
  if (!doc.content) return "";
  const walk = (nodes: Array<{ type?: string; text?: string; content?: unknown[] }> = []): string =>
    nodes
      .map((n) => {
        if (n.type === "text") return n.text ?? "";
        if (n.type === "hardBreak") return "\n";
        if (n.content) return walk(n.content as Array<{ type?: string; text?: string; content?: unknown[] }>);
        return "";
      })
      .join("");
  return doc.content
    .map((block) => {
      if (block.type === "bulletList" || block.type === "orderedList") {
        return (block.content ?? [])
          .map((li) => "- " + walk((li.content as Array<{ type?: string; text?: string; content?: unknown[] }>) ?? []))
          .join("\n");
      }
      return walk(block.content ?? []);
    })
    .join("\n\n");
}
