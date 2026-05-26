import Anthropic from "@anthropic-ai/sdk";
import type { ConduitConfig } from "./config.js";
import { captured } from "./capture.js";

export interface AcRegressionFinding {
  ticket_id: string;
  ticket_title: string;
  severity: "minor" | "major";
  removed: string[];
  weakened: Array<{ before: string; after: string; why: string }>;
  summary: string;
}

const client = new Anthropic();

export async function detectAcRegression(
  ticket: { id: string; title: string; current_description: string },
  spec_section_content: string | null,
  config: ConduitConfig
): Promise<AcRegressionFinding | null> {
  if (!spec_section_content) return null;

  const prompt = `You are checking whether a ticket's current acceptance criteria are weaker than what the mapped spec section implies. A ticket has been edited externally; we want to flag regressions BEFORE they reach implementation.

MAPPED SPEC SECTION (the source of truth for what the ticket should cover):
${spec_section_content}

CURRENT TICKET DESCRIPTION (post-edit, the AC may be embedded as a list or prose):
${ticket.current_description}

Determine which behaviors the spec requires that are now:
- "removed": the requirement is genuinely absent from the ticket — not paraphrased, not implicit, not covered by a stricter superset. Read the ticket charitably. If the spec says "X if condition Y" and the ticket says "X for all cases," that is NOT a regression (stricter behavior subsumes the conditional). If the spec says "route to claims when total ≥ \$100" and the ticket says "totals ≥ \$100 route to claims," that is NOT a regression even if the surrounding phrasing differs.
- "weakened": still mentioned but reworded in a way that loosens the requirement (e.g., "must" → "should", "all X" → "some X", "always" → "usually", a constraint dropped). Subtle rewording that preserves the same behavior is NOT weakening.

Then assign severity: "major" if any genuinely removed/weakened behavior touches user-facing behavior, safety, or compliance; "minor" otherwise.

If nothing is genuinely removed or weakened, set severity to "minor" and leave the arrays empty. False positives are worse than false negatives — when in doubt, leave it alone.

Respond with JSON only. No markdown, no preamble:
{
  "severity": "minor" | "major",
  "removed": ["string"],
  "weakened": [{ "before": "string", "after": "string", "why": "string" }],
  "summary": "1-2 sentence overview"
}`;

  const result = await captured(
    "analyze_reverse_diff",
    { prompt, ticket_id: ticket.id, op: "ac_regression" },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const t = response.content[0].type === "text" ? response.content[0].text : "";
      return JSON.parse(t.replace(/```json|```/g, "").trim()) as Omit<AcRegressionFinding, "ticket_id" | "ticket_title">;
    }
  );

  if (result.removed.length === 0 && result.weakened.length === 0) return null;
  return { ticket_id: ticket.id, ticket_title: ticket.title, ...result };
}
