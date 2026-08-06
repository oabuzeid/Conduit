import type { KnownBlock } from "@slack/types";
import type { SpecPRAlertData, DesignChangeAlertData } from "./alert-store.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Spec-PR alerts ──────────────────────────────────────────────

export function renderSpecPRAlert(alert: SpecPRAlertData): KnownBlock[] {
  const source =
    "ticket_id" in alert.triggering_event
      ? `${alert.triggering_event.source} ticket \`${alert.triggering_event.ticket_id}\``
      : `Figma file \`${alert.triggering_event.file_id}\``;

  const summary =
    "narrative_summary" in alert.triggering_event
      ? alert.triggering_event.narrative_summary
      : alert.triggering_event.semantic_summary;

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📝 *Spec PR opened* — <${alert.pr_url}|PR #${alert.pr_number}>`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Source:* ${source}\n*Edit:* ${esc(alert.edit_summary)}\n\n${esc(summary).slice(0, 2500)}`,
      },
    },
    {
      type: "actions",
      block_id: `spec_pr_actions_${alert.id}`,
      elements: [
        {
          type: "button",
          action_id: "spec_pr_approve",
          style: "primary",
          text: { type: "plain_text", text: "Approve & merge" },
          value: alert.id,
        },
        {
          type: "button",
          action_id: "spec_pr_changes",
          text: { type: "plain_text", text: "Request changes" },
          value: alert.id,
        },
      ],
    },
  ];
  return blocks;
}

export function renderResolvedSpecPRAlert(alert: SpecPRAlertData, statusLine: string): KnownBlock[] {
  return renderSpecPRAlert(alert)
    .filter((b) => !("block_id" in b && (b.block_id ?? "").startsWith("spec_pr_actions")))
    .concat({ type: "context", elements: [{ type: "mrkdwn", text: statusLine }] });
}

// ─── Design-change alerts ────────────────────────────────────────

export function renderDesignChangeAlert(alert: DesignChangeAlertData): KnownBlock[] {
  const ev = alert.event;
  const classLabel =
    ev.classification === "new_screen_added" ? "🆕 New screen added" :
    ev.classification === "screen_removed" ? "🗑️ Screen removed" :
    ev.classification === "significant_copy_change" ? "✏️ Significant copy change" :
    ev.classification;

  const affectedSections = ev.affected_spec_sections.length > 0
    ? ev.affected_spec_sections.map((s) => `\`${s.file}\` → "${esc(s.section)}"`).join(", ")
    : "_(no mapped spec section)_";

  const deltaLines: string[] = [];
  for (const d of ev.structural_deltas.slice(0, 8)) {
    if (d.kind === "frame_added") deltaLines.push(`+ Added frame: *${esc(d.frame_name)}*`);
    else if (d.kind === "frame_removed") deltaLines.push(`− Removed frame: *${esc(d.frame_name)}*`);
    else if (d.kind === "text_changed") deltaLines.push(`~ Text changed in *${esc(d.frame_name)}* (${d.chars_changed ?? 0} chars)`);
  }
  if (ev.structural_deltas.length > 8) deltaLines.push(`…and ${ev.structural_deltas.length - 8} more`);

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🎨 *Figma change detected* — ${classLabel}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${esc(ev.semantic_summary)}\n\n*Affected spec:* ${affectedSections}`,
      },
    },
  ];

  if (deltaLines.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: deltaLines.join("\n").slice(0, 2900),
      },
    });
  }

  blocks.push({
    type: "actions",
    block_id: `design_actions_${alert.id}`,
    elements: [
      {
        type: "button",
        action_id: "design_accept",
        style: "primary",
        text: { type: "plain_text", text: "Accept & propagate" },
        value: alert.id,
      },
      {
        type: "button",
        action_id: "design_dismiss",
        text: { type: "plain_text", text: "Dismiss" },
        value: alert.id,
      },
      {
        type: "button",
        action_id: "design_modify",
        text: { type: "plain_text", text: "Modify" },
        value: alert.id,
      },
    ],
  });

  return blocks;
}

export function renderResolvedDesignChangeAlert(alert: DesignChangeAlertData, statusLine: string): KnownBlock[] {
  return renderDesignChangeAlert(alert)
    .filter((b) => !("block_id" in b && (b.block_id ?? "").startsWith("design_actions")))
    .concat({ type: "context", elements: [{ type: "mrkdwn", text: statusLine }] });
}
