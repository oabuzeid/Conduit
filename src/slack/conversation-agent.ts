import Anthropic from "@anthropic-ai/sdk";
import type { ConduitConfig } from "../core/config.js";
import { captured } from "../core/capture.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools/index.js";
import type { Session } from "./session.js";

const client = new Anthropic();
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are Conduit, a product-management agent inside Slack. A PM is talking to you in a thread. Your job is to help them turn a spec into engineering tickets, then push the tickets to Jira or Linear.

You operate by deciding, each turn, whether to:
- Reply with a question or observation (text only)
- Call one or more tools to make progress
- Both — call tools, then reply with what you learned

Tools available to you do real work — they ingest specs, scan for ambiguity, generate ticket drafts, modify drafts, and push to the ticket provider. Use them when they help; don't narrate hypothetical actions instead of taking them.

Conversational tone: concise, direct, plain language. No marketing-speak, no figures of speech, no hedging. Talk to the PM like an experienced colleague. Ask one clear question at a time when you need input; don't fire off a list of clarifying questions.

Important workflow rules:
- Always call ingest_spec before scan_spec, generate_tickets, or push_tickets.
- Always call generate_tickets before update_breakdown or push_tickets.
- Run scan_spec proactively after ingest, and surface the high-severity findings to the PM — don't just generate over ambiguity silently.
- Don't push tickets without explicit confirmation from the PM ("yes", "looks good", "ship it", "send it", etc.). If unsure, ask.
- If the PM mentions a destination (project key, team name), call set_destination so it's recorded for this session.
- If the PM asks for a tone shift ("more concise", "less formal"), call set_tone; the next generate_tickets will respect it.
- If the PM pastes a Figma URL, doc link, or other reference, call attach_context.
- Don't repeat the full session state back to the PM; assume they remember the recent conversation.

Current session state (for your reference, don't repeat to PM):
{{SESSION_STATE}}`;

export interface AgentResult {
  reply: string;
  tool_calls_made: number;
}

export async function decideNextTurn(
  session: Session,
  userMessage: string,
  config: ConduitConfig
): Promise<AgentResult> {
  // History stores ONLY user messages and final assistant text replies across turns.
  // Intra-turn tool_use/tool_result blocks live only inside this function call —
  // they aren't replayed in future turns. The session state summary (passed as
  // SESSION_STATE in the system prompt) carries forward what tools have produced.

  return captured(
    "slack_conversation_turn",
    { thread_ts: session.thread_ts, user_message: userMessage, history_length: session.history.length },
    { model: config.ai.model },
    async () => {
      let reply = "";
      let toolCallsMade = 0;
      const claudeMessages: Anthropic.MessageParam[] = [];

      // Replay only text turns (user + final assistant replies)
      for (const turn of session.history) {
        if (turn.role === "user") claudeMessages.push({ role: "user", content: turn.content });
        else if (turn.role === "assistant") claudeMessages.push({ role: "assistant", content: turn.content });
      }
      // Add the new user message
      claudeMessages.push({ role: "user", content: userMessage });
      session.history.push({ role: "user", content: userMessage });

      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const response = await client.messages.create({
          model: config.ai.model,
          max_tokens: 4096,
          system: SYSTEM_PROMPT.replace("{{SESSION_STATE}}", JSON.stringify(summarizeSession(session), null, 2)),
          tools: TOOL_DEFINITIONS.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          })),
          messages: claudeMessages,
        });

        const textBlocks: string[] = [];
        const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        for (const block of response.content) {
          if (block.type === "text") textBlocks.push(block.text);
          if (block.type === "tool_use") toolUseBlocks.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
        }

        // Keep the raw assistant turn (with tool_use blocks) in the Claude-format
        // message list so tool_result blocks below have a matching tool_use.
        claudeMessages.push({ role: "assistant", content: response.content });

        if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
          reply = textBlocks.join("\n\n").trim();
          // Persist ONLY the final text reply across turns
          if (reply) session.history.push({ role: "assistant", content: reply });
          break;
        }

        // Execute tools, push results back into the in-turn conversation only
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const call of toolUseBlocks) {
          toolCallsMade++;
          let result: string;
          try {
            result = await executeTool(call.name, call.input, session, config);
          } catch (err) {
            result = `Tool ${call.name} threw: ${err instanceof Error ? err.message : String(err)}`;
          }
          toolResults.push({ type: "tool_result", tool_use_id: call.id, content: result });
        }
        claudeMessages.push({ role: "user", content: toolResults });
      }

      if (!reply) {
        reply = "(I ran out of reasoning steps — try rephrasing or asking me to retry.)";
        session.history.push({ role: "assistant", content: reply });
      }
      return { reply, tool_calls_made: toolCallsMade };
    }
  );
}

function summarizeSession(session: Session) {
  return {
    spec_loaded: !!session.spec_text,
    spec_file: session.spec_file_path,
    spec_chars: session.spec_text?.length ?? 0,
    destination_override: session.destination,
    tone_override: session.tone,
    attached_context_count: session.attached_urls.length,
    scan_findings_count: session.scan_findings_count,
    draft_tickets: session.draft_tickets?.length ?? 0,
    pushed: !!session.pushed_ticket_ids?.length,
    status: session.status,
  };
}
