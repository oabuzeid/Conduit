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
    ticket_id: after.id,
    ticket_title: after.title,
    field_diffs,
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
