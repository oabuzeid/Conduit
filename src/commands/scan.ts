import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../core/config.js";
import { loadSpecs } from "../core/spec-parser.js";
import { scanSpecForAmbiguity, type AmbiguityFinding } from "../core/ambiguity-scanner.js";

const KIND_LABEL: Record<AmbiguityFinding["kind"], string> = {
  vague_verb: "vague verb",
  undefined_term: "undefined term",
  missing_edge_case: "missing edge case",
  conflict: "conflict",
  open_question_in_build_text: "open question in build text",
};

export async function runScan(): Promise<void> {
  const config = loadConfig();
  const spinner = ora("Reading spec files...").start();
  const specs = loadSpecs(config.specs);
  if (specs.length === 0) {
    spinner.fail("No spec files found matching: " + config.specs.join(", "));
    return;
  }
  spinner.succeed(`Found ${specs.length} spec file(s)`);

  let total = 0;
  for (const spec of specs) {
    const scanSpinner = ora(`Scanning ${spec.file}...`).start();
    const findings = await scanSpecForAmbiguity(spec, config);
    scanSpinner.succeed(`${spec.file}: ${findings.length} finding(s)`);
    total += findings.length;
    if (findings.length === 0) continue;
    console.log("");
    const grouped = findings.reduce<Record<string, AmbiguityFinding[]>>((acc, f) => {
      (acc[f.severity] ??= []).push(f);
      return acc;
    }, {});
    for (const sev of ["high", "medium", "low"] as const) {
      const list = grouped[sev] ?? [];
      if (list.length === 0) continue;
      const color = sev === "high" ? chalk.red : sev === "medium" ? chalk.yellow : chalk.gray;
      for (const f of list) {
        console.log(color(`  [${sev}] ${KIND_LABEL[f.kind]}  ·  ${f.section}`));
        console.log(chalk.gray(`     "${f.excerpt}"`));
        console.log(chalk.white(`     ${f.reason}`));
        console.log(chalk.cyan(`     → ${f.suggested_fix}`));
        console.log("");
      }
    }
  }
  if (total === 0) {
    console.log(chalk.green("\n  ✅ No ambiguities detected. Ready to generate."));
  } else {
    console.log(chalk.bold(`\n  ${total} total finding(s) across ${specs.length} spec(s).`));
  }
}
