import type { SlashCommand, RespondFn } from "@slack/bolt";

export async function handleHelp(_command: SlashCommand, respond: RespondFn): Promise<void> {
  await respond({
    response_type: "ephemeral",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Conduit · v0.3.0 (Phase C)" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*What I can do right now:*\n" +
            "• `@conduit` mention me in a thread with your spec — pasted, a repo file path, or a public Google Doc link — and we'll figure out the breakdown together. Natural conversation, not a form to fill out.\n" +
            "• I'll scan for ambiguity, take Figma links as context, let you pick the destination project and adjust tone, then show you the breakdown with *Approve & push* / *Modify* buttons.\n" +
            "• Approve pushes tickets to Jira or Linear in one click. Modify invites free-text edits — type what to change and I'll re-render.\n" +
            "• `/conduit ping` — confirm I'm alive · `/conduit help` — show this menu\n\n" +
            "*Coming next:*\n" +
            "• Spec-PR and design-change alerts you Approve / Reject in Slack instead of GitHub (Phase D)",
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
