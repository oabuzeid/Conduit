import Anthropic from "@anthropic-ai/sdk";
import type { ConduitConfig } from "./config.js";
import type { AgentDecision, AgentInput } from "./events.js";
import { captured } from "./capture.js";

export interface AgentContext {
  pending_changes?: AgentInput[];
  recent_self_writes?: Array<{ kind: string; ticket_id?: string; pr_number?: number; at: string }>;
  spec_section_content?: string;
}

const client = new Anthropic();

export async function decide(
  input: AgentInput,
  context: AgentContext,
  config: ConduitConfig
): Promise<AgentDecision> {
  const prompt = buildPrompt(input, context);

  return captured(
    "agent_decision",
    { prompt, input_source: input.source },
    { model: config.ai.model },
    async () => {
      const response = await client.messages.create({
        model: config.ai.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      return JSON.parse(cleaned) as AgentDecision;
    }
  );
}

function buildPrompt(input: AgentInput, context: AgentContext): string {
  return `You are the investigation agent for Conduit. A change just arrived from ${input.source}. Decide what to do.

ACTIONS AVAILABLE:
- "open_pr_now": the change is concrete, well-scoped, and the spec should be updated. Provide pr_payload { target_spec_file, branch_name, edit_summary }.
- "batch_with_pending": this change is related to other pending changes (see context). Provide batch_key — a stable string that groups related changes.
- "ask_pm": the change is ambiguous, contradicts the spec in a non-obvious way, or has multiple plausible interpretations. Provide question — a single direct question for the PM.
- "pause_loop_detected": this change looks like it originated from a recent Conduit-written change. Provide loop_evidence — what made you think so.
- "no_action": the change is too minor (typo, formatting, status flip), or it already matches the spec.

DECISION RULES:
- Prefer "open_pr_now" when the change is substantive AND the path forward is clear.
- Choose "ask_pm" over "open_pr_now" when the spec would need a judgment call (which side is authoritative, which copy to keep, what the new behavior should be).
- Choose "batch_with_pending" only if there is at least one pending change that shares a clear theme. The batch_key should be stable: two related changes should produce the same key.
- Choose "pause_loop_detected" if the ticket_id or pr_number in recent_self_writes matches this event within the last 5 minutes.
- "no_action" is the right answer more often than people think. Status changes, label-only edits, and whitespace-only diffs do not need a spec PR.

INPUT EVENT:
${JSON.stringify(input, null, 2)}

CONTEXT:
${JSON.stringify(context, null, 2)}

Respond ONLY with a JSON object matching this shape. No markdown, no preamble:
{
  "action": "open_pr_now" | "batch_with_pending" | "ask_pm" | "pause_loop_detected" | "no_action",
  "reasoning": "2-3 sentences explaining the choice",
  "pr_payload": { "target_spec_file": "string", "branch_name": "string", "edit_summary": "string" },
  "batch_key": "string",
  "question": "string",
  "loop_evidence": "string"
}

Include only the optional fields that correspond to the chosen action.`;
}
