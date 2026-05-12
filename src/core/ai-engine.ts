import Anthropic from "@anthropic-ai/sdk";
import type { ConduitConfig } from "./config.js";

export interface GeneratedTicket {
  type: "epic" | "story" | "task";
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
  const detailInstructions: Record<string, string> = {
    minimal: "Keep descriptions brief (2-3 sentences). List 2-3 acceptance criteria per story.",
    standard: "Write clear descriptions (1 paragraph). List 3-5 acceptance criteria per story in Given/When/Then format.",
    thorough: "Write detailed descriptions with context and rationale. List 5-8 acceptance criteria per story in Given/When/Then format. Include edge cases.",
  };

  const response = await client.messages.create({
    model: config.ai.model,
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `You are a senior product manager breaking down a product spec into engineering tickets.

Tone: concise, direct, plain language. No figures of speech, no jargon, no marketing-speak. Active voice. Each sentence earns its place.

Given the following product spec, generate a structured set of tickets (epics, stories, and tasks) that engineering can execute against.

WHICH SECTIONS BECOME TICKETS

Every ticket you emit must describe a concrete change to implement. Do not emit a ticket for a spec section whose only purpose is context (Overview, Background, "Why this exists," "What we're solving"). If a section produces no implementation work, do not produce a ticket from it.

Borderline cases — Problems, Goals, Principles, Opportunity — only emit a ticket if the acceptance criteria would be measurable or testable. Never emit a ticket whose AC reduces to "the team understands X" or "stakeholders agree on Y."

Sections that are themselves open-question lists (e.g. "Design Questions," "Open Questions") should produce one ticket per question whose deliverable is "produce a documented decision on X." Do not presume an answer in the AC.

WRITING ACCEPTANCE CRITERIA

- Use Given / When / Then format.
- Acceptance criteria must reflect only what the spec has committed to. If the spec marks something as unresolved — blockquote asides starting with \`>\`, items in "Open Questions" / "Design Questions" sections, MVP-scope items with a trailing \`?\` — do not include it in build-ticket AC. Track unresolved items as separate decision tickets.
- ${detailInstructions[config.ai.detail_level]}
- Each story must have clear acceptance criteria.

STRUCTURE

- H1 sections map to Epics.
- H2 sections map to Stories under the nearest Epic.
- Checkbox items map to Tasks under the nearest Story.
- Preserve traceability: reference which spec file and section each ticket came from.

OUTPUT

Respond ONLY with a JSON array of ticket objects. No markdown, no preamble.

Each ticket object:
{
  "type": "epic" | "story" | "task",
  "title": "string",
  "description": "string",
  "acceptance_criteria": ["string"],
  "parent_title": "string or null",
  "labels": ["string"],
  "spec_ref": { "file": "string", "section_title": "string", "line": number }
}

SPEC:
${specContext}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as GeneratedTicket[];
}

export async function analyzeDrift(
  specContext: string,
  ticketData: string,
  config: ConduitConfig
): Promise<SyncDiff[]> {
  const response = await client.messages.create({
    model: config.ai.model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are analyzing drift between a product spec and existing engineering tickets.

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
${ticketData}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as SyncDiff[];
}

export async function auditDesignVsSpec(
  specContext: string,
  designDescription: string,
  config: ConduitConfig
): Promise<AuditFinding[]> {
  const response = await client.messages.create({
    model: config.ai.model,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are auditing consistency between a product spec and Figma designs.

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
${designDescription}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as AuditFinding[];
}
