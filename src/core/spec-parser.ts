import { readFileSync } from "fs";
import { globSync } from "glob";

export interface SpecSection {
  level: number;
  title: string;
  body: string;
  tasks: string[];
  file: string;
  line: number;
}

export interface ParsedSpec {
  file: string;
  sections: SpecSection[];
  raw: string;
}

export function parseSpec(filepath: string): ParsedSpec {
  const raw = readFileSync(filepath, "utf-8");
  const lines = raw.split("\n");
  const sections: SpecSection[] = [];

  let current: SpecSection | null = null;
  let bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      if (current) {
        current.body = bodyLines.join("\n").trim();
        current.tasks = extractTasks(bodyLines);
        sections.push(current);
      }
      current = {
        level: headingMatch[1].length,
        title: headingMatch[2].trim(),
        body: "",
        tasks: [],
        file: filepath,
        line: i + 1,
      };
      bodyLines = [];
    } else if (current) {
      bodyLines.push(line);
    }
  }

  if (current) {
    current.body = bodyLines.join("\n").trim();
    current.tasks = extractTasks(bodyLines);
    sections.push(current);
  }

  return { file: filepath, sections, raw };
}

export function loadSpecs(
  patterns: string[],
  cwd: string = process.cwd()
): ParsedSpec[] {
  const files = new Set<string>();
  for (const pattern of patterns) {
    for (const match of globSync(pattern, { cwd, absolute: true })) {
      files.add(match);
    }
  }
  return Array.from(files).sort().map((f) => parseSpec(f));
}

function extractTasks(lines: string[]): string[] {
  return lines
    .filter((l) => /^\s*-\s*\[[ x]\]/.test(l))
    .map((l) => l.replace(/^\s*-\s*\[[ x]\]\s*/, "").trim());
}

export function specsToPromptContext(specs: ParsedSpec[]): string {
  return specs
    .map((spec) => {
      const header = `=== File: ${spec.file} ===`;
      const body = spec.sections
        .map((s) => {
          const prefix = "#".repeat(s.level);
          const taskList =
            s.tasks.length > 0
              ? "\nTasks:\n" + s.tasks.map((t) => `  - ${t}`).join("\n")
              : "";
          return `${prefix} ${s.title}\n${s.body}${taskList}`;
        })
        .join("\n\n");
      return `${header}\n${body}`;
    })
    .join("\n\n");
}
