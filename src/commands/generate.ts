import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../core/config.js";
import { loadSpecs, specsToPromptContext } from "../core/spec-parser.js";
import { generateTickets, type GeneratedTicket } from "../core/ai-engine.js";
import { loadState, saveState, addMapping, hashContent } from "../core/state.js";
import { getProvider } from "../integrations/registry.js";
import {
  getFigmaTree,
  postSpecChangeComments,
} from "../integrations/figma.js";

interface GenerateOptions {
  dryRun?: boolean;
  verbose?: boolean;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  const config = loadConfig();
  const provider = getProvider(config.tickets.provider);

  // 1. Load and parse specs
  const spinner = ora("Reading spec files...").start();
  const specs = loadSpecs(config.specs);
  if (specs.length === 0) {
    spinner.fail(
      "No spec files found matching patterns: " + config.specs.join(", ")
    );
    return;
  }
  spinner.succeed(
    `Found ${specs.length} spec file(s) with ${specs.reduce((n, s) => n + s.sections.length, 0)} sections`
  );

  // 2. Generate tickets via AI
  const genSpinner = ora("Generating tickets from specs...").start();
  const specContext = specsToPromptContext(specs);
  let tickets: GeneratedTicket[];
  try {
    tickets = await generateTickets(specContext, config);
    genSpinner.succeed(`Generated ${tickets.length} tickets`);
  } catch (err) {
    genSpinner.fail("Failed to generate tickets");
    console.error(err);
    return;
  }

  // 3. Preview
  console.log("");
  console.log(chalk.bold("Generated tickets:"));
  const epics = tickets.filter((t) => t.type === "epic");
  for (const epic of epics) {
    console.log(chalk.cyan(`\n  📦 [Epic] ${epic.title}`));
    const stories = tickets.filter(
      (t) => t.type === "story" && t.parent_title === epic.title
    );
    for (const story of stories) {
      console.log(chalk.white(`    📋 [Story] ${story.title}`));
      if (options.verbose) {
        for (const ac of story.acceptance_criteria) {
          console.log(chalk.gray(`       ✓ ${ac}`));
        }
      }
      const tasks = tickets.filter(
        (t) => t.type === "task" && t.parent_title === story.title
      );
      for (const task of tasks) {
        console.log(chalk.gray(`      ☐ [Task] ${task.title}`));
      }
    }
  }

  // Show orphan stories/tasks (parent_title doesn't match any generated ticket)
  const allTitles = new Set(tickets.map((t) => t.title));
  const orphans = tickets.filter(
    (t) => t.type !== "epic" && (!t.parent_title || !allTitles.has(t.parent_title))
  );
  if (orphans.length > 0) {
    console.log(
      chalk.yellow(
        `\n  ⚠ ${orphans.length} ticket(s) without a matched parent`
      )
    );
  }

  console.log("");

  if (options.dryRun) {
    console.log(
      chalk.yellow(
        `Dry run — no tickets created. Remove --dry-run to push to ${provider.name}`
      )
    );
    return;
  }

  // 4. Push to ticket provider
  const pushSpinner = ora(`Pushing tickets to ${provider.name}...`).start();
  try {
    const projectId = await provider.resolveProject(config.tickets.project);
    const labelIds: string[] = [];
    for (const label of config.tickets.labels) {
      labelIds.push(await provider.ensureLabel(projectId, label));
    }

    const state = loadState(config.sync.state_file);
    const createdMap = new Map<string, string>(); // title -> ticket id

    // Create epics first
    for (const ticket of tickets.filter((t) => t.type === "epic")) {
      const result = await provider.createTicket(projectId, {
        title: ticket.title,
        description: formatDescription(ticket),
        labels: labelIds,
        type: ticket.type,
      });
      createdMap.set(ticket.title, result.id);

      addMapping(state, {
        spec_file: ticket.spec_ref.file,
        spec_section: ticket.spec_ref.section_title,
        spec_hash: hashContent(ticket.description),
        ticket_id: result.key,
        ticket_provider: config.tickets.provider,
        ticket_type: "epic",
        last_synced: new Date().toISOString(),
      });
    }

    // Create stories and tasks
    for (const ticket of tickets.filter((t) => t.type !== "epic")) {
      const parentId = ticket.parent_title
        ? createdMap.get(ticket.parent_title)
        : undefined;

      const result = await provider.createTicket(projectId, {
        title: ticket.title,
        description: formatDescription(ticket),
        parentId,
        labels: labelIds,
        type: ticket.type,
      });
      createdMap.set(ticket.title, result.id);

      addMapping(state, {
        spec_file: ticket.spec_ref.file,
        spec_section: ticket.spec_ref.section_title,
        spec_hash: hashContent(ticket.description),
        ticket_id: result.key,
        ticket_provider: config.tickets.provider,
        ticket_type: ticket.type,
        parent_ticket_id: parentId,
        last_synced: new Date().toISOString(),
      });
    }

    saveState(config.sync.state_file, state);
    pushSpinner.succeed(
      `Created ${tickets.length} tickets in ${provider.name} (project: ${config.tickets.project})`
    );
  } catch (err) {
    pushSpinner.fail(`Failed to push to ${provider.name}`);
    console.error(err);
    return;
  }

  // 5. Post Figma comments if configured
  if (config.design?.file_id) {
    const figmaSpinner = ora("Posting spec changes to Figma...").start();
    try {
      const { nodes } = await getFigmaTree(config.design.file_id);
      const changes = epics.map((e) => ({
        sectionTitle: e.title,
        summary: `Tickets generated from spec:\n${tickets
          .filter(
            (t) =>
              t.parent_title === e.title || t.title === e.title
          )
          .map((t) => `• [${t.type}] ${t.title}`)
          .join("\n")}`,
      }));

      const { posted, matched } = await postSpecChangeComments(
        config.design.file_id,
        nodes,
        changes
      );
      figmaSpinner.succeed(
        `Posted ${posted} comment(s) to Figma (${matched} matched to frames)`
      );
    } catch (err) {
      figmaSpinner.warn("Figma comment posting failed (tickets were still created)");
      if (options.verbose) console.error(err);
    }
  }
}

function formatDescription(ticket: GeneratedTicket): string {
  let desc = ticket.description + "\n";
  if (ticket.acceptance_criteria.length > 0) {
    desc += "\n## Acceptance Criteria\n";
    for (const ac of ticket.acceptance_criteria) {
      desc += `- ${ac}\n`;
    }
  }
  desc += `\n---\n_Generated by conduit from \`${ticket.spec_ref.file}\` → "${ticket.spec_ref.section_title}" (line ${ticket.spec_ref.line})_`;
  return desc;
}
