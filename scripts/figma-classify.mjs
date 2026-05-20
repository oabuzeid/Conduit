#!/usr/bin/env node
// Diff a Figma file against its snapshot, apply the threshold filter,
// classify the change via Claude, and (optionally) feed the resulting
// DesignChangeEvent into the investigation agent.
//
// Stand-in for the Figma webhook handler (#4, not yet built).
//
// Usage: node scripts/figma-classify.mjs [file-id] [--with-agent]

import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { getFigmaTree } from "../dist/integrations/figma.js";
import { flattenTree, diffSnapshots, classifyChanges } from "../dist/core/figma-classifier.js";
import { decide } from "../dist/core/agent.js";
import { loadConfig } from "../dist/core/config.js";

const argv = process.argv.slice(2);
const withAgent = argv.includes("--with-agent");
const fileIdArg = argv.find((a) => !a.startsWith("--"));

const config = loadConfig();
const fileId = fileIdArg ?? config.design?.file_id;
if (!fileId) {
  console.error("Usage: node scripts/figma-classify.mjs <file-id> [--with-agent]");
  process.exit(1);
}

const snapshotPath = `.conduit/snapshots/figma-${fileId}.json`;
if (!existsSync(snapshotPath)) {
  console.error(`No snapshot at ${snapshotPath}. Run figma-snapshot.mjs first.`);
  process.exit(1);
}
const before = JSON.parse(readFileSync(snapshotPath, "utf-8"));

const currentTree = await getFigmaTree(fileId);
const after = flattenTree(fileId, currentTree.name, currentTree.nodes);

const threshold = config.design?.significant_change_threshold;
if (!threshold) {
  console.error("No significant_change_threshold configured.");
  process.exit(1);
}

console.log("=".repeat(70));
console.log("STEP 1 — Structural diff + threshold filter");
console.log("=".repeat(70));
const deltas = diffSnapshots(before, after, threshold);
console.log(`Frame additions: ${deltas.filter((d) => d.kind === "frame_added").length}`);
console.log(`Frame removals:  ${deltas.filter((d) => d.kind === "frame_removed").length}`);
console.log(`Text changes:    ${deltas.filter((d) => d.kind === "text_changed").length}`);
console.log(`Passed threshold: ${deltas.length > 0 ? "yes" : "no"}`);

if (deltas.length === 0) {
  console.log("\nNo changes above threshold. Done.");
  process.exit(0);
}

console.log("\n" + "=".repeat(70));
console.log("STEP 2 — Semantic classification (Claude)");
console.log("=".repeat(70));
const event = await classifyChanges(fileId, currentTree.nodes[0]?.id ?? "0:0", deltas, config);
console.log("Classification:", event.classification);
console.log("\nSummary:");
console.log(event.semantic_summary);

if (event.classification === "ignore") {
  console.log("\nClassifier said ignore. Done.");
  process.exit(0);
}

if (!withAgent) {
  console.log("\nRe-run with --with-agent to pipe this event into the investigation agent.");
  process.exit(0);
}

console.log("\n" + "=".repeat(70));
console.log("STEP 3 — Investigation agent");
console.log("=".repeat(70));
const decision = await decide(event, {}, config);
console.log("Action:", decision.action);
console.log("Reasoning:", decision.reasoning);
if (decision.pr_payload) {
  console.log("\nPR payload:");
  console.log("  target_spec_file:", decision.pr_payload.target_spec_file);
  console.log("  branch_name:", decision.pr_payload.branch_name);
  console.log("  edit_summary:", decision.pr_payload.edit_summary);
}
if (decision.question) console.log("\nQuestion for PM:", decision.question);
