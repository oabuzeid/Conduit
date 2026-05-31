#!/usr/bin/env node

// override:true so .env always wins over the shell environment.
// Without this, a stale token left in the shell from a previous
// `source .env` silently overrides the current .env contents and the
// server fails with cryptic 401/404 errors from upstream APIs.
import { config as loadDotenv } from "dotenv";
loadDotenv({ override: true });
import { Command } from "commander";
import { runGenerate } from "./commands/generate.js";
import { runSync } from "./commands/sync.js";
import { runAudit } from "./commands/audit.js";
import { runInit } from "./commands/init.js";
import { runScan } from "./commands/scan.js";
import { startServer } from "./server/index.js";

const program = new Command();

program
  .name("conduit")
  .description(
    "Keep your specs, tickets, and designs in sync. AI-powered ticket generation and drift detection for product managers."
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize conduit in the current repo")
  .action(() => {
    runInit();
  });

program
  .command("generate")
  .description("Read spec files and generate engineering tickets (epics, stories, tasks)")
  .option("--dry-run", "Preview generated tickets without pushing")
  .option("-v, --verbose", "Show acceptance criteria in preview")
  .action(async (options) => {
    await runGenerate(options);
  });

program
  .command("sync")
  .description("Detect drift between specs and existing tickets, suggest updates")
  .action(async () => {
    await runSync();
  });

program
  .command("audit")
  .description("Compare Figma designs against spec files and flag mismatches")
  .action(async () => {
    await runAudit();
  });

program
  .command("scan")
  .description("Scan spec files for ambiguity (vague verbs, undefined terms, missing edge cases, conflicts) before generating tickets")
  .action(async () => {
    await runScan();
  });

program
  .command("serve")
  .description("Run the webhook listener (Jira / GitHub / Figma → agent → spec PRs)")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .action((options) => {
    startServer({ port: parseInt(options.port, 10) });
  });

program.parse();
