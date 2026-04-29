import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../core/config.js";
import { loadSpecs, specsToPromptContext } from "../core/spec-parser.js";
import { auditDesignVsSpec } from "../core/ai-engine.js";
import { getFigmaTree, figmaTreeToPromptContext } from "../integrations/figma.js";

export async function runAudit(): Promise<void> {
  const config = loadConfig();

  if (!config.design?.file_id) {
    console.log(
      chalk.yellow(
        "No design file configured. Add a `design` section to specbot.yaml."
      )
    );
    return;
  }

  // 1. Load specs
  const spinner = ora("Loading specs and Figma design...").start();
  const specs = loadSpecs(config.specs);
  const specContext = specsToPromptContext(specs);

  // 2. Fetch Figma
  let designDescription: string;
  try {
    const { name, nodes } = await getFigmaTree(config.design.file_id);
    designDescription = figmaTreeToPromptContext(name, nodes);
  } catch (err) {
    spinner.fail("Failed to fetch Figma file");
    console.error(err);
    return;
  }
  spinner.succeed("Loaded specs and Figma design");

  // 3. Run audit
  const auditSpinner = ora("Auditing design vs spec...").start();
  const findings = await auditDesignVsSpec(
    specContext,
    designDescription,
    config
  );
  auditSpinner.succeed(`Found ${findings.length} finding(s)`);

  if (findings.length === 0) {
    console.log(chalk.green("\n  ✅ Design and spec are consistent!"));
    return;
  }

  // 4. Display findings
  console.log("");
  const icons = { info: "ℹ️", warning: "⚠️", error: "🚨" };
  const colors = { info: chalk.blue, warning: chalk.yellow, error: chalk.red };

  for (const finding of findings) {
    const icon = icons[finding.severity];
    const color = colors[finding.severity];
    console.log(color(`  ${icon} [${finding.source}] ${finding.message}`));
    console.log(chalk.gray(`     ${finding.details}`));
    console.log("");
  }
}
