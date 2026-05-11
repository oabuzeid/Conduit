import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { createHash } from "crypto";

export interface TicketMapping {
  spec_file: string;
  spec_section: string;
  spec_hash: string;
  ticket_id: string;
  ticket_provider: string;
  ticket_type: "epic" | "story" | "task";
  parent_ticket_id?: string;
  last_synced: string;
}

export interface ConduitState {
  version: 1;
  mappings: TicketMapping[];
  last_run: string;
}

export function loadState(filepath: string): ConduitState {
  if (!existsSync(filepath)) {
    return { version: 1, mappings: [], last_run: new Date().toISOString() };
  }
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw) as ConduitState;
}

export function saveState(filepath: string, state: ConduitState): void {
  const dir = dirname(filepath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.last_run = new Date().toISOString();
  writeFileSync(filepath, JSON.stringify(state, null, 2), "utf-8");
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

export function addMapping(state: ConduitState, mapping: TicketMapping): void {
  const idx = state.mappings.findIndex(
    (m) =>
      m.spec_file === mapping.spec_file &&
      m.spec_section === mapping.spec_section &&
      m.ticket_provider === mapping.ticket_provider
  );
  if (idx >= 0) {
    state.mappings[idx] = mapping;
  } else {
    state.mappings.push(mapping);
  }
}

export function findMappingBySection(
  state: ConduitState,
  file: string,
  section: string
): TicketMapping | undefined {
  return state.mappings.find(
    (m) => m.spec_file === file && m.spec_section === section
  );
}

export function findMappingByTicket(
  state: ConduitState,
  ticketId: string
): TicketMapping | undefined {
  return state.mappings.find((m) => m.ticket_id === ticketId);
}
