#!/usr/bin/env node
// Run merge-propagation for a Conduit-opened PR that's been merged.
// Stand-in for the GitHub pull_request.closed webhook handler (#4).
//
// Usage: node scripts/propagate-merge.mjs <PR-NUMBER>
//        [--inject-ticket <KEY> --inject-spec-file <path>]
//
// If --inject-* flags are present and no pending record exists, a synthetic
// pending PR record is created first. Useful for testing on PRs opened
// before pending-prs tracking existed.

import "dotenv/config";
import { propagateMerge } from "../dist/core/merge-propagator.js";
import { getPendingPR, recordPendingPR } from "../dist/core/pending-prs.js";

const argv = process.argv.slice(2);
const prNumber = parseInt(argv.find((a) => !a.startsWith("--")) ?? "", 10);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const injectTicket = flag("inject-ticket");
const injectSpec = flag("inject-spec-file");

if (!prNumber) {
  console.error("Usage: node scripts/propagate-merge.mjs <PR-NUMBER> [--inject-ticket KEY --inject-spec-file path]");
  process.exit(1);
}

if (!getPendingPR(prNumber) && injectTicket && injectSpec) {
  console.log(`Injecting synthetic pending record for PR #${prNumber} → ${injectTicket}`);
  recordPendingPR({
    pr_number: prNumber,
    repo: { owner: "oabuzeid", name: "Conduit" },
    triggering_event: {
      source: "jira",
      ticket_id: injectTicket,
      ticket_title: "(injected)",
      field_diffs: [],
      mapped_spec: { file: injectSpec, section: "(injected)" },
      narrative_summary: "(injected)",
      detected_at: new Date().toISOString(),
    },
    target_spec_file: injectSpec,
    branch_name: "(injected)",
    opened_at: new Date().toISOString(),
  });
}

const result = await propagateMerge(prNumber);

console.log("Propagated to:", result.propagated_to.length ? result.propagated_to.join(", ") : "(nothing)");
if (result.skipped.length) {
  console.log("Skipped:", result.skipped.join("; "));
}
