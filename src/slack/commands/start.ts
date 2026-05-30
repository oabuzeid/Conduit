import type { SlashCommand, RespondFn } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { startSession } from "../session.js";

export async function handleStart(command: SlashCommand, respond: RespondFn, client: WebClient, _initialHint: string): Promise<void> {
  // Post a public-to-channel opener that becomes the thread root.
  const result = await client.chat.postMessage({
    channel: command.channel_id,
    text: `<@${command.user_id}> started a Conduit session. Reply in this thread with the spec you want to break into tickets (paste markdown, or give me a file path like \`specs/foo.md\`). I'll ask follow-ups as we go.`,
  });

  if (!result.ok || !result.ts) {
    await respond({ response_type: "ephemeral", text: "Could not post in this channel — am I a member? Try `/invite @Conduit`." });
    return;
  }

  startSession({ thread_ts: result.ts, channel: command.channel_id, user_id: command.user_id });

  await respond({
    response_type: "ephemeral",
    text: "Started — head to the thread I just opened.",
  });
}
