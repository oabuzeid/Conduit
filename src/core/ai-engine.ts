import Anthropic from "@anthropic-ai/sdk";
import type { Breakdown, ConduitConfig } from "./config.js";
import { captured } from "./capture.js";

export interface GeneratedTicket {
  type: "epic" | "story";
  title: string;
  description: string;
  acceptance_criteria: string[];
  parent_title?: string;
  labels: string[];
  spec_ref: {
    file: string;
    section_title: string;
    line: number;
  };
}

export interface SyncDiff {
  ticket_id: string;
  ticket_title: string;
  drift_type: "spec_changed" | "ticket_changed" | "missing_ticket" | "orphaned_ticket";
  summary: string;
  suggested_action: string;
}

export interface AuditFinding {
  severity: "info" | "warning" | "error";
  source: string;
  message: string;
  details: string;
}

const client = new Anthropic();

export async function generateTickets(
  specContext: string,
  config: ConduitConfig
): Promise<GeneratedTicket[]> {
  const breakdownInstruction = renderBreakdownInstruction(config.ai.breakdown);
  const ac = config.ai.ac_format;
  const formatInstruction: Record<typeof ac.format, string> = {
    given_when_then:
      'Each acceptance criterion follows "Given <state>, when <action>, then <observable outcome>." Each AC tests one discrete behavior.',
    bullets:
      "Each acceptance criterion is a short, testable statement (one observable behavior per bullet). No Given/When/Then framing.",
    numbered:
      "Acceptance criteria are an ordered list. Earlier items are prerequisites for later ones. Each item describes one observable behavior.",
  };
  const acInstructions = [
    formatInstruction[ac.format],
    "Use as many acceptance criteria as the work requires — one per discrete behavior or constraint. Do not pad.",
    ac.include_background
      ? "Acceptance criteria may include brief story-context phrasing (e.g. 'Given a host has completed check-in...')."
      : "Acceptance criteria stay tight — assume the story context is already understood from the title and description. Do not restate it.",
    ac.include_figma_links
      ? "When a story maps to a specific Figma frame, reference the frame name in the description or AC where it clarifies the work."
      : "",
  ]
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join("\n");

  const prompt = `You are a senior product manager breaking down a product spec into engineering tickets.

Tone: concise, direct, plain language. No figures of speech, no jargon, no marketing-speak. Active voice. Each sentence earns its place.

Given the following product spec, generate a structured set of tickets (epics and stories) that engineering can execute against. Stories are the atomic unit of work — engineers split them into tasks themselves, so do not emit subtasks.

WHICH SECTIONS BECOME TICKETS

Every ticket you emit must describe a concrete change to implement. Do not emit a ticket for a spec section whose only purpose is context (Overview, Background, "Why this exists," "What we're solving"). If a section produces no implementation work, do not produce a ticket from it.

Borderline cases — Problems, Goals, Principles, Opportunity — only emit a ticket if the acceptance criteria would be measurable or testable. Never emit a ticket whose AC reduces to "the team understands X" or "stakeholders agree on Y."

Sections that are themselves open-question lists (e.g. "Design Questions," "Open Questions") should produce one ticket per question whose deliverable is "produce a documented decision on X." Do not presume an answer in the AC.

WRITING ACCEPTANCE CRITERIA

- Acceptance criteria must reflect only what the spec has committed to. If the spec marks something as unresolved — blockquote asides starting with \`>\`, items in "Open Questions" / "Design Questions" sections, MVP-scope items with a trailing \`?\` — do not include it in build-ticket AC. Track unresolved items as separate decision tickets.
- Each story must have clear acceptance criteria.
${acInstructions}

STRUCTURE

- H1 sections map to Epics.
- ${breakdownInstruction}
- Checkbox items (\`- [ ]\`) in the spec are the author's draft task list. Fold the ones that imply real, testable behavior into the parent Story's acceptance criteria. Ignore throwaway items (e.g. "ask design", "follow up"). Do not emit them as separate tickets.
- Preserve traceability: reference which spec file and section each ticket came from.

OUTPUT

Respond ONLY with a JSON array of ticket objects. No markdown, no preamble.

Each ticket object:
{
  "type": "epic" | "story",
  "title": "string",
  "description": "string",
  "acceptance_criteria": ["string"],
  "parent_title": "string or null",
  "labels": ["string"],
  "spec_ref": { "file": "string", "section_title": "string", "line": number }
}

SPEC:
${specContext}`;

  return captured(
    "generate_tickets",
    { prompt, spec_chars: specContext.length },
    { model: config.ai.model, breakdown_mode: config.ai.breakdown.mode, ac_format: config.ai.ac_format.format },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned) as GeneratedTicket[];
    }
  );
}

function renderBreakdownInstruction(breakdown: Breakdown): string {
  switch (breakdown.mode) {
    case "by_section":
      return "H2 sections map directly to Stories under the nearest Epic. The spec's section structure determines the story structure.";
    case "by_layer":
      return "Group Stories by execution layer (e.g. backend, frontend, mobile, design, infra, data). Stories cross H2 section boundaries — a single H2 section may produce multiple stories, one per layer involved, and a single layer may pull work from multiple sections. Only emit stories for layers the spec actually implies; do not invent empty backend/frontend splits when only one layer is involved.";
    case "by_component":
      return "Group Stories by UI or system component (e.g. \"Mileage Row Component,\" \"Attestation Overlay,\" \"Pre-Calculation Service\"). Each component story carries the full backend + frontend + design work needed to ship it. Identify components from the spec content; do not constrain yourself to the spec's section structure.";
    case "custom":
      return `Group Stories according to the following user-provided rule: ${breakdown.custom_instructions}. Apply this rule consistently across the spec.`;
  }
}

export async function analyzeDrift(
  specContext: string,
  ticketData: string,
  config: ConduitConfig
): Promise<SyncDiff[]> {
  const prompt = `You are analyzing drift between a product spec and existing engineering tickets.

Compare the spec against the current tickets and identify:
1. Spec sections that changed but tickets weren't updated
2. Tickets that were modified externally (description differs from what the spec implies)
3. Spec sections with no corresponding ticket
4. Tickets with no corresponding spec section (orphaned)

Respond ONLY with a JSON array of diff objects. No markdown, no preamble.

Each diff object:
{
  "ticket_id": "string",
  "ticket_title": "string",
  "drift_type": "spec_changed" | "ticket_changed" | "missing_ticket" | "orphaned_ticket",
  "summary": "string",
  "suggested_action": "string"
}

SPEC:
${specContext}

CURRENT TICKETS:
${ticketData}`;

  return captured(
    "analyze_drift",
    { prompt, spec_chars: specContext.length, ticket_chars: ticketData.length },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned) as SyncDiff[];
    }
  );
}

export async function auditDesignVsSpec(
  specContext: string,
  designDescription: string,
  config: ConduitConfig
): Promise<AuditFinding[]> {
  const prompt = `You are auditing consistency between a product spec and Figma designs.

Compare the spec against the design description and flag mismatches:
- UI elements described in spec but missing from design
- Design elements not mentioned in spec
- Behavioral differences (e.g., spec says 3-step wizard, design shows 2 steps)
- Copy/label differences

Respond ONLY with a JSON array. No markdown, no preamble.

Each finding:
{
  "severity": "info" | "warning" | "error",
  "source": "figma" | "spec",
  "message": "short summary",
  "details": "longer explanation"
}

SPEC:
${specContext}

DESIGN DESCRIPTION:
${designDescription}`;

  return captured(
    "audit_design",
    { prompt, spec_chars: specContext.length, design_chars: designDescription.length },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned) as AuditFinding[];
    }
  );
}
