#!/usr/bin/env node

import { Command } from "commander";
import dotenv from "dotenv";
import { runGenerate } from "./commands/generate.js";
import { runSync } from "./commands/sync.js";
import { runAudit } from "./commands/audit.js";
import { runInit } from "./commands/init.js";

dotenv.config();

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

program.parse();
