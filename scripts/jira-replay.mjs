#!/usr/bin/env node
// Diff a Jira ticket against its saved snapshot, run the v0.2 chain,
// and (with --apply) actually open a real spec PR against the conduit repo.
//
// Usage: node scripts/jira-replay.mjs CTST-5 [--apply]

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { analyzeReverseDiff } from "../dist/core/reverse-analyzer.js";
import { decide } from "../dist/core/agent.js";
import { openSpecPR, draftSpecEdit } from "../dist/core/spec-pr.js";
import { recordSelfWrite, matchesRecentSelfWrite } from "../dist/core/loop-guard.js";
import { loadConfig } from "../dist/core/config.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const key = argv.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const specFileOverride = flag("spec-file");
const specSectionOverride = flag("spec-section");

if (!key) {
  console.error("Usage: node scripts/jira-replay.mjs <TICKET-KEY> [--spec-file <path>] [--spec-section <name>] [--apply]");
  process.exit(1);
}

const snapshotPath = `.conduit/snapshots/${key}.json`;
if (!existsSync(snapshotPath)) {
  console.error(`No snapshot at ${snapshotPath}. Run jira-snapshot.mjs ${key} first.`);
  process.exit(1);
}

let specPath, specSection;
if (specFileOverride && specSectionOverride) {
  if (!existsSync(specFileOverride)) {
    console.error(`Spec file not found: ${specFileOverride}`);
    process.exit(1);
  }
  specPath = specFileOverride;
  specSection = specSectionOverride;
} else {
  const state = JSON.parse(readFileSync(".conduit/state.json", "utf-8"));
  const mapping = state.mappings.find((m) => m.ticket_id === key);
  if (!mapping) {
    console.error(`No spec mapping in state.json for ${key}. Pass --spec-file and --spec-section to override.`);
    process.exit(1);
  }
  const specCandidates = ["specs/__tests/", "specs/"].map((d) => d + mapping.spec_file);
  specPath = specCandidates.find((p) => existsSync(p));
  if (!specPath) {
    console.error(`Could not locate spec file ${mapping.spec_file}. Tried: ${specCandidates.join(", ")}`);
    process.exit(1);
  }
  specSection = mapping.spec_section;
}
const specContent = readFileSync(specPath, "utf-8");

const sectionRe = new RegExp(`## ${escapeRegex(specSection)}\\n\\n([\\s\\S]*?)(?=\\n## |$)`);
const sectionMatch = specContent.match(sectionRe);
if (!sectionMatch) {
  console.error(`Could not find section "${specSection}" in ${specPath}`);
  process.exit(1);
}
const sectionContent = sectionMatch[1].trim();

// Fetch current Jira state.
const host = process.env.JIRA_HOST;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_API_TOKEN;
const auth = Buffer.from(`${email}:${token}`).toString("base64");
const res = await fetch(`https://${host}/rest/api/3/issue/${key}?fields=summary,description,labels,status`, {
  headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
});
if (!res.ok) {
  console.error(`Jira fetch failed: ${res.status} ${res.statusText}\n${await res.text()}`);
  process.exit(1);
}
const data = await res.json();
const after = {
  id: data.key,
  title: data.fields.summary,
  description: extractText(data.fields.description),
  labels: data.fields.labels ?? [],
  status: data.fields.status?.name ?? "",
  acceptance_criteria: [],
};

const before = JSON.parse(readFileSync(snapshotPath, "utf-8"));

const config = loadConfig();

console.log("=".repeat(70));
console.log(`STEP 1 — Reverse analyzer on ${key}`);
console.log("=".repeat(70));
const event = await analyzeReverseDiff(
  before,
  after,
  { file: specPath, section: specSection, content: sectionContent },
  "jira",
  config
);
if (!event) {
  console.log("No field diffs detected between snapshot and current Jira state.");
  console.log("Either nothing was edited, or the edit didn't change tracked fields.");
  process.exit(0);
}
console.log("Fields changed:", event.field_diffs.map((d) => d.field).join(", "));
console.log("\nNarrative summary:");
console.log(event.narrative_summary);

console.log("\n" + "=".repeat(70));
console.log("STEP 1.5 — Loop guard");
console.log("=".repeat(70));
const selfMatch = matchesRecentSelfWrite({ ticket_id: event.ticket_id });
if (selfMatch) {
  console.log("This event matches a recent Conduit self-write — would skip.");
  process.exit(0);
}
console.log("Not a self-write — continuing.");

console.log("\n" + "=".repeat(70));
console.log("STEP 2 — Investigation agent");
console.log("=".repeat(70));
const decision = await decide(event, { spec_section_content: sectionContent }, config);
console.log("Action:", decision.action);
console.log("Reasoning:", decision.reasoning);
if (decision.pr_payload) {
  console.log("\nPR payload:");
  console.log("  target_spec_file:", decision.pr_payload.target_spec_file);
  console.log("  branch_name:", decision.pr_payload.branch_name);
  console.log("  edit_summary:", decision.pr_payload.edit_summary);
}
if (decision.question) console.log("\nQuestion for PM:", decision.question);

if (decision.action !== "open_pr_now" || !decision.pr_payload) {
  console.log("\nAgent did not choose open_pr_now. Stopping.");
  process.exit(0);
}

// Override target file with the actual disk path (agent doesn't know about the __tests/ dir).
decision.pr_payload.target_spec_file = specPath;

console.log("\n" + "=".repeat(70));
console.log(apply ? "STEP 3 — Drafting + opening real PR" : "STEP 3 — Drafting (dry run, no PR opened)");
console.log("=".repeat(70));

if (!apply) {
  const draft = await draftSpecEdit(
    specContent,
    { decision: { ...decision, pr_payload: decision.pr_payload }, triggering_event: event, spec_file_path: specPath, repo: { owner: "oabuzeid", name: "Conduit" } },
    config
  );
  console.log("\n--- PR BODY ---");
  console.log(draft.prBody);
  const beforeSection = specContent.match(sectionRe)?.[0] ?? "";
  const afterSection = draft.newContent.match(sectionRe)?.[0] ?? "";
  console.log("\n--- SECTION BEFORE ---\n" + beforeSection);
  console.log("\n--- SECTION AFTER ---\n" + afterSection);
  console.log("\nRe-run with --apply to actually open the PR.");
  process.exit(0);
}

if (!process.env.GITHUB_TOKEN) {
  console.error("GITHUB_TOKEN not set in .env. Cannot open real PR.");
  process.exit(1);
}

const result = await openSpecPR(
  { decision: { ...decision, pr_payload: decision.pr_payload }, triggering_event: event, spec_file_path: specPath, repo: { owner: "oabuzeid", name: "Conduit" } },
  config
);
console.log("\nPR opened:", result.pr_url);
console.log("Branch:", result.branch_name);
recordSelfWrite({ kind: "spec_pr_open", pr_number: result.pr_number });
console.log("Recorded self-write for PR #" + result.pr_number);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractText(adf) {
  if (!adf || typeof adf !== "object" || !adf.content) return "";
  const walk = (nodes) =>
    nodes
      .map((n) => {
        if (n.type === "text") return n.text ?? "";
        if (n.type === "hardBreak") return "\n";
        if (n.content) return walk(n.content);
        return "";
      })
      .join("");
  return adf.content
    .map((block) => {
      if (block.type === "bulletList" || block.type === "orderedList") {
        return (block.content ?? [])
          .map((li) => "- " + walk(li.content ?? []))
          .join("\n");
      }
      return walk(block.content ?? []);
    })
    .join("\n\n");
}
