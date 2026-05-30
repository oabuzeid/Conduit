import type { App } from "@slack/bolt";
import { handlePing } from "./ping.js";
import { handleHelp } from "./help.js";
import { handleStart } from "./start.js";

export function registerSlashCommand(app: App): void {
  app.command("/conduit", async ({ command, ack, respond, client }) => {
    await ack();
    const text = (command.text ?? "").trim();
    const [sub, ...rest] = text.split(/\s+/);
    switch (sub) {
      case "":
      case "help":
        await handleHelp(command, respond);
        return;
      case "ping":
        await handlePing(command, respond);
        return;
      case "start":
        await handleStart(command, respond, client, rest.join(" "));
        return;
      default:
        await respond({
          response_type: "ephemeral",
          text: `Unknown subcommand: \`${sub}\`. Try \`/conduit help\`.`,
        });
    }
  });
}
