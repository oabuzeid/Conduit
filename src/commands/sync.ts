import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../core/config.js";
import { loadSpecs, specsToPromptContext } from "../core/spec-parser.js";
import { analyzeDrift } from "../core/ai-engine.js";
import { getProvider } from "../integrations/registry.js";

export async function runSync(): Promise<void> {
  const config = loadConfig();
  const provider = getProvider(config.tickets.provider);

  // 1. Load specs
  const spinner = ora("Loading specs and tickets...").start();
  const specs = loadSpecs(config.specs);
  const specContext = specsToPromptContext(specs);

  // 2. Load existing tickets via provider
  const managedLabel = config.tickets.labels[0] ?? "conduit-managed";
  const tickets = await provider.getTicketsByLabel(
    config.tickets.project,
    managedLabel
  );

  if (tickets.length === 0) {
    spinner.info(
      "No conduit-managed tickets found. Run `conduit generate` first."
    );
    return;
  }

  const ticketContext = provider.ticketsToPromptContext(tickets);
  spinner.succeed(
    `Loaded ${specs.length} spec(s) and ${tickets.length} ticket(s) from ${provider.name}`
  );

  // 3. Analyze drift
  const driftSpinner = ora("Analyzing drift...").start();
  const diffs = await analyzeDrift(specContext, ticketContext, config);
  driftSpinner.succeed(`Found ${diffs.length} difference(s)`);

  if (diffs.length === 0) {
    console.log(chalk.green("\n  ✅ Specs and tickets are in sync!"));
    return;
  }

  // 4. Display results
  console.log("");
  const icons: Record<string, string> = {
    spec_changed: "📝",
    ticket_changed: "🔄",
    missing_ticket: "❌",
    orphaned_ticket: "👻",
  };

  for (const diff of diffs) {
    const icon = icons[diff.drift_type] ?? "•";
    const color =
      diff.drift_type === "missing_ticket" ||
      diff.drift_type === "orphaned_ticket"
        ? chalk.red
        : chalk.yellow;

    console.log(color(`  ${icon} [${diff.drift_type}] ${diff.ticket_title}`));
    console.log(chalk.gray(`     ${diff.summary}`));
    console.log(chalk.white(`     → ${diff.suggested_action}`));
    console.log("");
  }
}
