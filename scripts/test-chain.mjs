#!/usr/bin/env node
// End-to-end synthetic test of the v0.2 chain:
//   reverse-analyzer (#1) → investigation agent (#3) → spec PR drafter (#2)
// No webhooks, no real GitHub PRs. Prints what conduit would do.

import "dotenv/config";
import { readFileSync } from "fs";
import { analyzeReverseDiff } from "../dist/core/reverse-analyzer.js";
import { decide } from "../dist/core/agent.js";
import { draftSpecEdit } from "../dist/core/spec-pr.js";
import { recordSelfWrite, matchesRecentSelfWrite } from "../dist/core/loop-guard.js";
import { loadConfig } from "../dist/core/config.js";

const config = loadConfig();
const specFile = "specs/__tests/tester-spec-1.md";
const specContent = readFileSync(specFile, "utf-8");

const before = {
  id: "CTST-12",
  title: "Avatar upload: client-side cropping",
  description: "When the user picks a file, open a square crop tool. Output a 512x512 image and upload it.",
  acceptance_criteria: [
    "Crop tool opens after file selection",
    "Aspect ratio locked to 1:1",
    "Output is a 512x512 PNG",
  ],
  labels: ["conduit-managed", "frontend"],
};

const after = {
  ...before,
  description:
    "When the user picks a file, open a square crop tool. Output a 512x512 image and upload it. If the source image is smaller than 256x256, show an inline error and block the upload before the crop tool opens.",
  acceptance_criteria: [
    "Crop tool opens after file selection",
    "Aspect ratio locked to 1:1",
    "Output is a 512x512 PNG",
    "Source images below 256x256 are rejected with an inline error before the crop tool opens",
  ],
};

const sectionMatch = specContent.match(/## Upload Flow\n\n([\s\S]*?)(?=\n## )/);
const mappedSpec = {
  file: specFile,
  section: "Upload Flow",
  content: sectionMatch ? sectionMatch[1].trim() : "",
};

console.log("=".repeat(70));
console.log("STEP 1 — Reverse-direction analyzer (#1)");
console.log("=".repeat(70));
const event = await analyzeReverseDiff(before, after, mappedSpec, "jira", config);
if (!event) {
  console.log("No field diffs detected — chain halted.");
  process.exit(0);
}
console.log("Ticket:", event.ticket_id, "—", event.ticket_title);
console.log("Fields changed:", event.field_diffs.map((d) => d.field).join(", "));
console.log("Mapped spec:", `${event.mapped_spec?.file} > ${event.mapped_spec?.section}`);
console.log("\nNarrative summary:");
console.log(event.narrative_summary);

console.log("\n" + "=".repeat(70));
console.log("STEP 1.5 — Loop guard (#6) — check if this is a self-write");
console.log("=".repeat(70));
const selfWriteMatch = matchesRecentSelfWrite({ ticket_id: event.ticket_id });
if (selfWriteMatch) {
  console.log("Self-write detected:", selfWriteMatch.kind, "at", selfWriteMatch.at);
  console.log("Would skip processing. Chain halted.");
  process.exit(0);
}
console.log("No recent self-write for", event.ticket_id, "— continuing.");

console.log("\n" + "=".repeat(70));
console.log("STEP 2 — Investigation agent (#3)");
console.log("=".repeat(70));
const decision = await decide(event, { spec_section_content: mappedSpec.content }, config);
console.log("Action:", decision.action);
console.log("Reasoning:", decision.reasoning);
if (decision.pr_payload) {
  console.log("\nPR payload:");
  console.log("  target_spec_file:", decision.pr_payload.target_spec_file);
  console.log("  branch_name:", decision.pr_payload.branch_name);
  console.log("  edit_summary:", decision.pr_payload.edit_summary);
}
if (decision.question) console.log("\nQuestion for PM:", decision.question);
if (decision.batch_key) console.log("\nBatch key:", decision.batch_key);
if (decision.loop_evidence) console.log("\nLoop evidence:", decision.loop_evidence);

if (decision.action !== "open_pr_now" || !decision.pr_payload) {
  console.log("\nChain halts here for action other than open_pr_now.");
  process.exit(0);
}

console.log("\n" + "=".repeat(70));
console.log("STEP 3 — Spec PR drafter (#2) — DRY RUN, no real PR opened");
console.log("=".repeat(70));
const draft = await draftSpecEdit(
  specContent,
  {
    decision: { ...decision, pr_payload: decision.pr_payload },
    triggering_event: event,
    spec_file_path: specFile,
    repo: { owner: "oabuzeid", name: "Conduit" },
  },
  config
);

console.log("\n--- PR BODY ---");
console.log(draft.prBody);

console.log("\n--- SPEC DIFF (Upload Flow section, before → after) ---");
const beforeSection = specContent.match(/## Upload Flow[\s\S]*?(?=\n## )/)?.[0] ?? "";
const afterSection = draft.newContent.match(/## Upload Flow[\s\S]*?(?=\n## )/)?.[0] ?? "";
console.log("\n[BEFORE]\n" + beforeSection);
console.log("\n[AFTER]\n" + afterSection);

console.log("\n" + "=".repeat(70));
console.log("STEP 4 — Loop guard write recording");
console.log("=".repeat(70));
recordSelfWrite({ kind: "spec_pr_open", pr_number: 9999 });
console.log("Recorded self-write for PR #9999. Future webhooks on this PR would be skipped.");

console.log("\n" + "=".repeat(70));
console.log("DONE — chain composed end-to-end with no errors.");
console.log("=".repeat(70));
