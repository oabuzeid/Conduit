import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { AgentInput } from "./events.js";

export interface PendingPR {
  pr_number: number;
  repo: { owner: string; name: string };
  triggering_event: AgentInput;
  target_spec_file: string;
  branch_name: string;
  opened_at: string;
}

const DEFAULT_PATH = ".conduit/pending-prs.json";

export function recordPendingPR(pr: PendingPR, path: string = DEFAULT_PATH): void {
  const list = read(path);
  const idx = list.findIndex((p) => p.pr_number === pr.pr_number);
  if (idx >= 0) list[idx] = pr;
  else list.push(pr);
  write(path, list);
}

export function getPendingPR(pr_number: number, path: string = DEFAULT_PATH): PendingPR | null {
  return read(path).find((p) => p.pr_number === pr_number) ?? null;
}

export function removePendingPR(pr_number: number, path: string = DEFAULT_PATH): void {
  write(path, read(path).filter((p) => p.pr_number !== pr_number));
}

export function listPendingPRs(path: string = DEFAULT_PATH): PendingPR[] {
  return read(path);
}

function read(path: string): PendingPR[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8")) as PendingPR[];
}

function write(path: string, list: PendingPR[]): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2), "utf-8");
}
