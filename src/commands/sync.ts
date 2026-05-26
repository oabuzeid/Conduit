import chalk from "chalk";
import ora from "ora";
import { existsSync, readFileSync } from "fs";
import { loadConfig } from "../core/config.js";
import { loadSpecs, specsToPromptContext } from "../core/spec-parser.js";
import { analyzeDrift } from "../core/ai-engine.js";
import { detectAcRegression } from "../core/ac-regression.js";
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

  // 5. AC regression check on ticket_changed diffs
  const changedDiffs = diffs.filter((d) => d.drift_type === "ticket_changed");
  if (changedDiffs.length === 0) return;

  const stateMap = loadStateMappings(config.sync.state_file);
  const regSpinner = ora(`Checking ${changedDiffs.length} edited ticket(s) for AC regressions...`).start();
  const findings = [] as Awaited<ReturnType<typeof detectAcRegression>>[];
  for (const diff of changedDiffs) {
    const ticket = tickets.find((t) => t.id === diff.ticket_id || t.key === diff.ticket_id);
    if (!ticket) continue;
    const mapping = stateMap.find((m) => m.ticket_id === ticket.key);
    if (!mapping) continue;
    const sectionContent = findSpecSection(mapping.spec_file, mapping.spec_section);
    if (!sectionContent) continue;
    const finding = await detectAcRegression(
      { id: ticket.key, title: ticket.title, current_description: ticket.description },
      sectionContent,
      config
    );
    if (finding) findings.push(finding);
  }
  regSpinner.succeed(`Found ${findings.length} AC regression(s)`);

  if (findings.length > 0) {
    console.log("");
    console.log(chalk.bold("Acceptance criteria regressions:"));
    for (const f of findings) {
      if (!f) continue;
      const color = f.severity === "major" ? chalk.red : chalk.yellow;
      console.log(color(`  ⚠ [${f.severity}] ${f.ticket_id} ${f.ticket_title}`));
      console.log(chalk.gray(`     ${f.summary}`));
      for (const r of f.removed) console.log(chalk.gray(`     - removed: ${r}`));
      for (const w of f.weakened) console.log(chalk.gray(`     - weakened: ${w.before} → ${w.after}  (${w.why})`));
      console.log("");
    }
  }
}

interface StateMapping {
  spec_file: string;
  spec_section: string;
  ticket_id: string;
}

function loadStateMappings(path: string): StateMapping[] {
  if (!existsSync(path)) return [];
  return (JSON.parse(readFileSync(path, "utf-8")) as { mappings: StateMapping[] }).mappings ?? [];
}

function findSpecSection(specFile: string, sectionTitle: string): string | null {
  const candidates = ["specs/__tests/", "specs/", ""].map((d) => d + specFile);
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  const content = readFileSync(path, "utf-8");
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : null;
}
