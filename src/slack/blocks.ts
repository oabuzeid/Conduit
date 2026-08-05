import type { KnownBlock } from "@slack/types";
import type { Session } from "./session.js";

// Slack mrkdwn requires escaping these three characters so ticket titles that
// contain them render literally instead of being interpreted as markup/entities.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Slack caps a single section's text at 3000 chars. Chunk the breakdown tree
// across multiple section blocks so large breakdowns don't get rejected.
function chunkLines(lines: string[], limit = 2900): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const line of lines) {
    if (cur.length + line.length + 1 > limit) {
      if (cur) chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Renders the current draft breakdown as Block Kit blocks with Approve / Modify
 * buttons. The reply text (the agent's message for this turn) leads; the ticket
 * tree and an action row follow. Buttons carry the thread_ts so the action
 * handler can reload the session — the draft is always read live from the
 * session at click time, so these blocks stay correct even if the PM edits the
 * breakdown after they were posted.
 */
export function renderBreakdownBlocks(session: Session, replyText: string, destination: string): KnownBlock[] {
  const tickets = session.draft_tickets ?? [];
  const epics = tickets.filter((t) => t.type === "epic");
  const stories = tickets.filter((t) => t.type === "story");
  const blocks: KnownBlock[] = [];

  const trimmed = replyText.trim();
  if (trimmed) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: trimmed.slice(0, 2900) } });
  }

  const lines: string[] = [];
  for (const e of epics) {
    lines.push(`*📦 ${esc(e.title)}*`);
    for (const s of stories.filter((s) => s.parent_title === e.title)) {
      lines.push(`   • ${esc(s.title)}`);
    }
  }
  const orphans = stories.filter((s) => !s.parent_title || !epics.some((e) => e.title === s.parent_title));
  for (const s of orphans) lines.push(`• ${esc(s.title)} _(no epic)_`);

  if (lines.length === 0) {
    lines.push("_(no tickets in the draft)_");
  }
  for (const chunk of chunkLines(lines)) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `${tickets.length} tickets · ${epics.length} epics · ${stories.length} stories → *${esc(destination)}*`,
      },
    ],
  });

  blocks.push({
    type: "actions",
    block_id: "breakdown_actions",
    elements: [
      {
        type: "button",
        action_id: "breakdown_approve",
        style: "primary",
        text: { type: "plain_text", text: "Approve & push" },
        value: session.thread_ts,
      },
      {
        type: "button",
        action_id: "breakdown_modify",
        text: { type: "plain_text", text: "Modify" },
        value: session.thread_ts,
      },
    ],
  });

  return blocks;
}

/**
 * The breakdown blocks with the action row replaced by a status line — used
 * after a button is clicked so the buttons can't be pressed twice.
 */
export function renderResolvedBreakdownBlocks(
  session: Session,
  replyText: string,
  destination: string,
  statusLine: string
): KnownBlock[] {
  const blocks = renderBreakdownBlocks(session, replyText, destination).filter(
    (b) => !("block_id" in b && b.block_id === "breakdown_actions")
  );
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: statusLine }] });
  return blocks;
}
