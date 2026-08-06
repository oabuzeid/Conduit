import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import type { DesignChangeEvent, TicketChangeEvent } from "../core/events.js";

export interface SpecPRAlertData {
  kind: "spec_pr";
  id: string;
  thread_ts: string;
  channel: string;
  pr_number: number;
  pr_url: string;
  branch_name: string;
  repo: { owner: string; name: string };
  edit_summary: string;
  triggering_event: TicketChangeEvent | DesignChangeEvent;
  created_at: string;
}

export interface DesignChangeAlertData {
  kind: "design_change";
  id: string;
  thread_ts: string;
  channel: string;
  event: DesignChangeEvent;
  spec_file_path?: string;
  repo?: { owner: string; name: string };
  created_at: string;
}

export type AlertData = SpecPRAlertData | DesignChangeAlertData;

const PATH = ".conduit/alerts.json";

function readAll(): AlertData[] {
  if (!existsSync(PATH)) return [];
  return JSON.parse(readFileSync(PATH, "utf-8")) as AlertData[];
}

function writeAll(alerts: AlertData[]): void {
  const dir = dirname(PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PATH, JSON.stringify(alerts, null, 2), "utf-8");
}

export function storeAlert(alert: Omit<SpecPRAlertData, "id" | "created_at"> | Omit<DesignChangeAlertData, "id" | "created_at">): string {
  const id = randomUUID().slice(0, 12);
  const full = { ...alert, id, created_at: new Date().toISOString() } as AlertData;
  const list = readAll();
  list.push(full);
  writeAll(list);
  return id;
}

export function getAlert(id: string): AlertData | null {
  return readAll().find((a) => a.id === id) ?? null;
}

export function removeAlert(id: string): void {
  writeAll(readAll().filter((a) => a.id !== id));
}
