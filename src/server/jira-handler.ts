import { readFileSync, existsSync } from "fs";
import type { ConduitConfig } from "../core/config.js";
import { analyzeReverseDiff, analyzeTicketCreation, analyzeTicketDeletion, type TicketSnapshot } from "../core/reverse-analyzer.js";
import { decide } from "../core/agent.js";
import { openSpecPR } from "../core/spec-pr.js";
import { isConduitWrite, matchesRecentSelfWrite, recentSelfWrites } from "../core/loop-guard.js";
import { mapToSpecSection } from "../core/spec-mapper.js";
import { loadSpecs } from "../core/spec-parser.js";

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
  if (process.env.CONDUIT_DEBUG_WEBHOOKS === "1") {
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import("fs");
      if (!existsSync(".conduit/debug")) mkdirSync(".conduit/debug", { recursive: true });
      writeFileSync(`.conduit/debug/jira-${Date.now()}.json`, JSON.stringify(payload, null, 2));
    } catch {}
  }
  const kind =
    payload.webhookEvent === "jira:issue_updated" ? "edited" :
    payload.webhookEvent === "jira:issue_created" ? "created" :
    payload.webhookEvent === "jira:issue_deleted" ? "deleted" :
    null;
  if (!kind) {
    console.log(`[jira] ignoring event: ${payload.webhookEvent}`);
    return;
  }
  const issue = payload.issue;
  if (!issue) {
    console.log("[jira] no issue in payload — skipping");
    return;
  }
  if (kind === "edited" && !payload.changelog) {
    console.log(`[jira] ${issue.key}: edited event with no changelog — skipping`);
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

  const snapshot: TicketSnapshot = {
    id: issue.key,
    title: issue.fields.summary,
    description: extractText(issue.fields.description),
    labels: issue.fields.labels ?? [],
    status: issue.fields.status?.name ?? "",
    acceptance_criteria: [],
  };
  console.log(`[jira] ${issue.key} (${kind}): description length = ${snapshot.description.length}`);

  let mapped = lookupSpecMapping(issue.key);
  if (!mapped && (kind === "created" || kind === "edited")) {
    const specs = loadSpecs(config.specs);
    const candidate = await mapToSpecSection(
      `${snapshot.title}\n\n${snapshot.description}`.slice(0, 4000),
      specs,
      config
    );
    if (candidate && candidate.confidence !== "low") {
      console.log(`[jira] ${issue.key}: auto-mapped → ${candidate.file} > ${candidate.section} (${candidate.confidence})`);
      mapped = candidate;
    }
  }

  let event;
  if (kind === "edited") {
    const before: TicketSnapshot = { ...snapshot };
    for (const item of payload.changelog!.items) {
      if (item.field === "summary") before.title = item.fromString ?? "";
      else if (item.field === "description") before.description = item.fromString ?? "";
      else if (item.field === "status") before.status = item.fromString ?? "";
      else if (item.field === "labels") before.labels = (item.fromString ?? "").split(/\s+/).filter(Boolean);
    }
    event = await analyzeReverseDiff(before, snapshot, mapped, "jira", config);
    if (!event) {
      console.log(`[jira] ${issue.key}: no analyzable field changes — skipping`);
      return;
    }
    console.log(`[jira] ${issue.key}: ${event.field_diffs.map((d) => d.field).join(", ")} changed`);
  } else if (kind === "created") {
    event = await analyzeTicketCreation(snapshot, mapped, "jira", config);
    console.log(`[jira] ${issue.key}: new ticket analyzed`);
  } else {
    event = await analyzeTicketDeletion(snapshot, mapped, "jira", config);
    console.log(`[jira] ${issue.key}: deletion analyzed`);
  }

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
  if (typeof adf === "string") return adf;
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
