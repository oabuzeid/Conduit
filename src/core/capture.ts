import { appendFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";

export type JobKind =
  | "generate_tickets"
  | "analyze_drift"
  | "audit_design"
  | "classify_design_change"
  | "analyze_reverse_diff"
  | "agent_decision";

export interface JobRecord {
  id: string;
  timestamp: string;
  kind: JobKind;
  input: unknown;
  output: unknown;
  metadata: {
    model?: string;
    duration_ms?: number;
    error?: string;
    [key: string]: unknown;
  };
}

const DEFAULT_LOG_PATH = ".conduit/jobs.jsonl";

export function captureJob(record: Omit<JobRecord, "id" | "timestamp">, logPath: string = DEFAULT_LOG_PATH): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const full: JobRecord = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...record,
  };
  appendFileSync(logPath, JSON.stringify(full) + "\n", "utf-8");
}

export async function captured<T>(
  kind: JobKind,
  input: unknown,
  metadata: JobRecord["metadata"],
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const output = await fn();
    captureJob({
      kind,
      input,
      output,
      metadata: { ...metadata, duration_ms: Date.now() - start },
    });
    return output;
  } catch (err) {
    captureJob({
      kind,
      input,
      output: null,
      metadata: {
        ...metadata,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
