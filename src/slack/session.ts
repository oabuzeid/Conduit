import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { GeneratedTicket } from "../core/ai-engine.js";

export interface ChatTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_use_id?: string;
  tool_name?: string;
}

export interface FigmaFrameRef {
  file_id: string;
  node_id: string;
  name: string;
  type: string;   // FRAME, SECTION, or COMPONENT
  path: string;   // e.g. "Page 1 > Future phases > Unavailable"
}

export interface Session {
  thread_ts: string;
  channel: string;
  user_id: string;
  started_at: string;
  updated_at: string;
  status: "active" | "completed" | "abandoned";

  // Accumulated context
  spec_text?: string;
  spec_file_path?: string;
  destination?: string;          // Project key override
  tone?: string;                  // Tone directive override
  attached_urls: string[];
  figma_frames?: FigmaFrameRef[];
  scan_findings_count?: number;
  draft_tickets?: GeneratedTicket[];
  pushed_ticket_ids?: string[];

  // Claude conversation history (excludes system prompt — that's regenerated each turn)
  history: ChatTurn[];
}

const PATH = ".conduit/sessions.json";

function readAll(): Session[] {
  if (!existsSync(PATH)) return [];
  return JSON.parse(readFileSync(PATH, "utf-8")) as Session[];
}

function writeAll(sessions: Session[]): void {
  const dir = dirname(PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PATH, JSON.stringify(sessions, null, 2), "utf-8");
}

export function getSession(thread_ts: string): Session | null {
  return readAll().find((s) => s.thread_ts === thread_ts) ?? null;
}

export function saveSession(session: Session): void {
  const list = readAll();
  const idx = list.findIndex((s) => s.thread_ts === session.thread_ts);
  session.updated_at = new Date().toISOString();
  if (idx >= 0) list[idx] = session;
  else list.push(session);
  writeAll(list);
}

export function startSession(input: { thread_ts: string; channel: string; user_id: string }): Session {
  const session: Session = {
    thread_ts: input.thread_ts,
    channel: input.channel,
    user_id: input.user_id,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "active",
    attached_urls: [],
    history: [],
  };
  saveSession(session);
  return session;
}
