import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import { resolve } from "path";

export interface AcFormat {
  format: "given_when_then" | "bullets" | "numbered";
  include_background: boolean;
  include_figma_links: boolean;
}

export const DEFAULT_AC_FORMAT: AcFormat = {
  format: "given_when_then",
  include_background: false,
  include_figma_links: false,
};

export interface FigmaChangeThreshold {
  min_frames_added: number;
  min_frames_removed: number;
  min_text_chars_changed: number;
  track_top_level_only: boolean;
}

export const DEFAULT_FIGMA_THRESHOLD: FigmaChangeThreshold = {
  min_frames_added: 1,
  min_frames_removed: 1,
  min_text_chars_changed: 50,
  track_top_level_only: true,
};

export interface ConduitConfig {
  specs: string[];
  tickets: {
    provider: "linear" | "jira";
    project: string;
    mapping: {
      epic: string;
      story: string;
      task: string;
    };
    labels: string[];
  };
  design?: {
    provider: "figma";
    file_id: string;
    significant_change_threshold?: FigmaChangeThreshold;
  };
  ai: {
    model: string;
    ac_format: AcFormat;
  };
  sync: {
    auto_update: boolean;
    detect_drift: boolean;
    state_file: string;
  };
}

const CONFIG_FILENAMES = ["conduit.yaml", "conduit.yml", ".conduit.yaml"];

export function loadConfig(dir: string = process.cwd()): ConduitConfig {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(dir, filename);
    if (existsSync(filepath)) {
      const raw = readFileSync(filepath, "utf-8");
      const parsed = parseYaml(raw) as Partial<ConduitConfig>;
      return applyDefaults(parsed);
    }
  }
  throw new Error(
    `No conduit config found. Create a conduit.yaml in your repo root.\nRun: conduit init`
  );
}

function applyDefaults(partial: Partial<ConduitConfig>): ConduitConfig {
  return {
    specs: partial.specs ?? ["specs/**/*.md"],
    tickets: {
      provider: partial.tickets?.provider ?? "linear",
      project: partial.tickets?.project ?? "",
      mapping: {
        epic: partial.tickets?.mapping?.epic ?? "h1",
        story: partial.tickets?.mapping?.story ?? "h2",
        task: partial.tickets?.mapping?.task ?? "- [ ]",
      },
      labels: partial.tickets?.labels ?? ["conduit-managed"],
    },
    design: partial.design
      ? {
          ...partial.design,
          significant_change_threshold: {
            ...DEFAULT_FIGMA_THRESHOLD,
            ...(partial.design.significant_change_threshold ?? {}),
          },
        }
      : undefined,
    ai: {
      model: partial.ai?.model ?? "claude-sonnet-4-20250514",
      ac_format: {
        ...DEFAULT_AC_FORMAT,
        ...(partial.ai?.ac_format ?? {}),
      },
    },
    sync: {
      auto_update: partial.sync?.auto_update ?? false,
      detect_drift: partial.sync?.detect_drift ?? true,
      state_file: partial.sync?.state_file ?? ".conduit/state.json",
    },
  };
}
