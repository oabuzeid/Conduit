import type { App } from "@slack/bolt";
import { loadConfig } from "../../core/config.js";
import { getSession, startSession, saveSession } from "../session.js";
import { decideNextTurn } from "../conversation-agent.js";

export function registerAppMention(app: App): void {
  app.event("app_mention", async ({ event, say, client }) => {
    const config = loadConfig();
    const threadTs = event.thread_ts ?? event.ts;
    const channel = event.channel;
    const user = event.user;
    if (!user) return;

    // Strip the bot mention from the text
    const text = event.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();

    let session = getSession(threadTs);
    if (!session) {
      session = startSession({ thread_ts: threadTs, channel, user_id: user });
      await say({ thread_ts: threadTs, text: "Got it — let's dig in. One sec while I think." });
    } else {
      // Acknowledge so the user sees we're working
      await client.reactions.add({ channel, timestamp: event.ts, name: "eyes" }).catch(() => {});
    }

    const messageToProcess = text || "(no text after mention — what would you like me to do?)";

    try {
      const { reply } = await decideNextTurn(session, messageToProcess, config);
      saveSession(session);
      if (reply) await say({ thread_ts: threadTs, text: reply });
    } catch (err) {
      console.error("[slack/app-mention] agent error:", err);
      await say({ thread_ts: threadTs, text: `Hit an error: ${err instanceof Error ? err.message : String(err)}` });
    }
  });
}
