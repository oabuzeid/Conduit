import type { SlashCommand, RespondFn } from "@slack/bolt";

export async function handlePing(_command: SlashCommand, respond: RespondFn): Promise<void> {
  await respond({
    response_type: "ephemeral",
    text: "alive · conduit v0.3.0 (Phase A)",
  });
}
