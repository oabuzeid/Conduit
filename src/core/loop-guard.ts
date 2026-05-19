import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export const CONDUIT_WRITE_LABEL = "conduit-write";
export const CONDUIT_WRITE_MARKER = "[conduit-write]";
const DEFAULT_LOG = ".conduit/self-writes.json";
const TTL_MS = 5 * 60 * 1000;

export interface SelfWrite {
  kind: "ticket_update" | "ticket_create" | "spec_pr_open" | "figma_comment";
  ticket_id?: string;
  pr_number?: number;
  figma_node_id?: string;
  at: string;
}

export function recordSelfWrite(write: Omit<SelfWrite, "at">, logPath: string = DEFAULT_LOG): void {
  const log = readLog(logPath);
  log.push({ ...write, at: new Date().toISOString() });
  writeLog(logPath, prune(log));
}

export function recentSelfWrites(logPath: string = DEFAULT_LOG): SelfWrite[] {
  return prune(readLog(logPath));
}

export function isConduitWrite(payload: {
  labels?: string[];
  title?: string;
  body?: string;
}): boolean {
  if (payload.labels?.some((l) => l === CONDUIT_WRITE_LABEL || l.startsWith(`${CONDUIT_WRITE_LABEL}-`))) {
    return true;
  }
  if (payload.title?.includes(CONDUIT_WRITE_MARKER)) return true;
  if (payload.body?.includes(CONDUIT_WRITE_MARKER)) return true;
  return false;
}

export function matchesRecentSelfWrite(
  event: { ticket_id?: string; pr_number?: number; figma_node_id?: string },
  logPath: string = DEFAULT_LOG
): SelfWrite | null {
  const recent = recentSelfWrites(logPath);
  return (
    recent.find(
      (w) =>
        (event.ticket_id && w.ticket_id === event.ticket_id) ||
        (event.pr_number && w.pr_number === event.pr_number) ||
        (event.figma_node_id && w.figma_node_id === event.figma_node_id)
    ) ?? null
  );
}

function readLog(logPath: string): SelfWrite[] {
  if (!existsSync(logPath)) return [];
  return JSON.parse(readFileSync(logPath, "utf-8")) as SelfWrite[];
}

function writeLog(logPath: string, entries: SelfWrite[]): void {
  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(logPath, JSON.stringify(entries, null, 2), "utf-8");
}

function prune(entries: SelfWrite[]): SelfWrite[] {
  const cutoff = Date.now() - TTL_MS;
  return entries.filter((e) => new Date(e.at).getTime() >= cutoff);
}
