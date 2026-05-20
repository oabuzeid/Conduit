import Anthropic from "@anthropic-ai/sdk";
import type { ConduitConfig } from "./config.js";
import type { TicketChangeEvent, TicketFieldDiff } from "./events.js";
import { captured } from "./capture.js";

export interface TicketSnapshot {
  id: string;
  title: string;
  description: string;
  acceptance_criteria?: string[];
  labels: string[];
  status?: string;
}

const client = new Anthropic();

export async function analyzeReverseDiff(
  before: TicketSnapshot,
  after: TicketSnapshot,
  specSection: { file: string; section: string; content: string } | null,
  source: "linear" | "jira",
  config: ConduitConfig
): Promise<TicketChangeEvent | null> {
  const field_diffs = diffFields(before, after);
  if (field_diffs.length === 0) return null;

  const narrative_summary = await summarize(field_diffs, after, specSection, config);

  return {
    source,
    change_kind: "edited",
    ticket_id: after.id,
    ticket_title: after.title,
    field_diffs,
    mapped_spec: specSection ? { file: specSection.file, section: specSection.section } : null,
    narrative_summary,
    detected_at: new Date().toISOString(),
  };
}

export async function analyzeTicketCreation(
  ticket: TicketSnapshot,
  specSection: { file: string; section: string; content: string } | null,
  source: "linear" | "jira",
  config: ConduitConfig
): Promise<TicketChangeEvent> {
  const prompt = `A new ticket was just created in ${source}. Describe what it adds and how it relates to the mapped spec section (or note no mapping exists).

Write 2-4 sentences. Identify whether the new ticket introduces scope the spec already covers, scope the spec is silent on, or scope that contradicts the spec.

NEW TICKET: ${ticket.title} (${ticket.id})

DESCRIPTION:
${ticket.description}

LABELS: ${ticket.labels.join(", ") || "(none)"}

${specSection ? `MAPPED SPEC SECTION (${specSection.file} > ${specSection.section}):\n${specSection.content}` : "No mapped spec section — this ticket has no obvious counterpart in the spec."}`;

  const narrative_summary = await captured(
    "analyze_reverse_diff",
    { prompt, ticket_id: ticket.id, kind: "created" },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].type === "text" ? response.content[0].text.trim() : "";
    }
  );

  return {
    source,
    change_kind: "created",
    ticket_id: ticket.id,
    ticket_title: ticket.title,
    field_diffs: [],
    full_snapshot: {
      title: ticket.title,
      description: ticket.description,
      acceptance_criteria: ticket.acceptance_criteria,
      labels: ticket.labels,
      status: ticket.status,
    },
    mapped_spec: specSection ? { file: specSection.file, section: specSection.section } : null,
    narrative_summary,
    detected_at: new Date().toISOString(),
  };
}

export async function analyzeTicketDeletion(
  lastKnown: TicketSnapshot,
  specSection: { file: string; section: string; content: string } | null,
  source: "linear" | "jira",
  config: ConduitConfig
): Promise<TicketChangeEvent> {
  const prompt = `A ticket was just deleted in ${source}. Describe what it was responsible for and what removing it implies for the spec.

Write 2-4 sentences. Identify whether the deletion implies the spec should drop the corresponding scope, or whether the ticket was redundant / migrated / accidentally deleted.

DELETED TICKET: ${lastKnown.title} (${lastKnown.id})

LAST KNOWN DESCRIPTION:
${lastKnown.description}

${specSection ? `MAPPED SPEC SECTION (${specSection.file} > ${specSection.section}):\n${specSection.content}` : "No mapped spec section — the deleted ticket had no counterpart in the spec."}`;

  const narrative_summary = await captured(
    "analyze_reverse_diff",
    { prompt, ticket_id: lastKnown.id, kind: "deleted" },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].type === "text" ? response.content[0].text.trim() : "";
    }
  );

  return {
    source,
    change_kind: "deleted",
    ticket_id: lastKnown.id,
    ticket_title: lastKnown.title,
    field_diffs: [],
    full_snapshot: {
      title: lastKnown.title,
      description: lastKnown.description,
      acceptance_criteria: lastKnown.acceptance_criteria,
      labels: lastKnown.labels,
      status: lastKnown.status,
    },
    mapped_spec: specSection ? { file: specSection.file, section: specSection.section } : null,
    narrative_summary,
    detected_at: new Date().toISOString(),
  };
}

function diffFields(before: TicketSnapshot, after: TicketSnapshot): TicketFieldDiff[] {
  const diffs: TicketFieldDiff[] = [];
  if (before.title !== after.title) {
    diffs.push({ field: "title", before: before.title, after: after.title });
  }
  if (before.description !== after.description) {
    diffs.push({ field: "description", before: before.description, after: after.description });
  }
  const beforeAc = (before.acceptance_criteria ?? []).join("\n");
  const afterAc = (after.acceptance_criteria ?? []).join("\n");
  if (beforeAc !== afterAc) {
    diffs.push({ field: "acceptance_criteria", before: beforeAc, after: afterAc });
  }
  const beforeLabels = [...before.labels].sort().join(",");
  const afterLabels = [...after.labels].sort().join(",");
  if (beforeLabels !== afterLabels) {
    diffs.push({ field: "labels", before: beforeLabels, after: afterLabels });
  }
  if ((before.status ?? "") !== (after.status ?? "")) {
    diffs.push({ field: "status", before: before.status ?? "", after: after.status ?? "" });
  }
  return diffs;
}

async function summarize(
  field_diffs: TicketFieldDiff[],
  ticket: TicketSnapshot,
  specSection: { file: string; section: string; content: string } | null,
  config: ConduitConfig
): Promise<string> {
  const diffBlock = field_diffs
    .map((d) => `### ${d.field}\n\nBEFORE:\n${d.before}\n\nAFTER:\n${d.after}`)
    .join("\n\n");
  const specBlock = specSection
    ? `MAPPED SPEC SECTION (${specSection.file} > ${specSection.section}):\n${specSection.content}`
    : "No mapped spec section — this ticket is orphaned or unmapped.";

  const prompt = `A ticket was edited externally in Linear or Jira. Summarize what changed and why it matters relative to the spec it came from.

Write 2-4 sentences in plain prose. Lead with the substantive change (not "the title was updated"). Identify whether the change tightens, loosens, contradicts, or stays neutral against the spec section. No marketing-speak, no hedging.

TICKET: ${ticket.title} (${ticket.id})

FIELD DIFFS:
${diffBlock}

${specBlock}`;

  return captured(
    "analyze_reverse_diff",
    { prompt, ticket_id: ticket.id, field_count: field_diffs.length },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });
      return response.content[0].type === "text" ? response.content[0].text.trim() : "";
    }
  );
}
