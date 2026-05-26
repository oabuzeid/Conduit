import type { SlashCommand, RespondFn } from "@slack/bolt";

export async function handleHelp(_command: SlashCommand, respond: RespondFn): Promise<void> {
  await respond({
    response_type: "ephemeral",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Conduit · v0.3.0 (Phase A)" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*What I can do right now (Phase A):*\n" +
            "• `/conduit ping` — confirm I'm alive\n" +
            "• `/conduit help` — show this menu\n\n" +
            "*Coming next:*\n" +
            "• `/conduit start` — start a guided project setup in a thread (Phase B)\n" +
            "• Inline ticket previews you can edit before pushing (Phase C)\n" +
            "• Spec-PR and design-change alerts you approve or reject in Slack (Phase D)",
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "_Conduit is learning your team's patterns. Once you've used me for a few projects, I'll start suggesting prompt and breakdown adjustments tailored to how your team writes specs._",
          },
        ],
      },
    ],
  });
}
