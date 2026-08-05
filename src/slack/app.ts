import { App, ExpressReceiver, type Installation, type InstallationQuery } from "@slack/bolt";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { loadConfig } from "../core/config.js";
import { getSession, saveSession } from "./session.js";
import { pushTickets, resolveDestination } from "./tools/index.js";
import { renderResolvedBreakdownBlocks } from "./blocks.js";
import { registerSlashCommand } from "./commands/index.js";
import { registerAppMention } from "./events/app-mention.js";

// Single-workspace installation store. Persists the bot token + team metadata
// to .conduit/slack-installation.json. When we move to enterprise / multi-
// workspace OAuth (planned, not yet implemented), this is the abstraction we
// extend; the storage backend swaps out and the rest of the app stays the same.
const INSTALL_PATH = ".conduit/slack-installation.json";

function readInstall(): Installation | null {
  if (!existsSync(INSTALL_PATH)) return null;
  return JSON.parse(readFileSync(INSTALL_PATH, "utf-8")) as Installation;
}

function writeInstall(installation: Installation): void {
  const dir = dirname(INSTALL_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(INSTALL_PATH, JSON.stringify(installation, null, 2), "utf-8");
}

const installationStore = {
  storeInstallation: async (installation: Installation) => {
    writeInstall(installation);
  },
  fetchInstallation: async (_query: InstallationQuery<boolean>) => {
    const stored = readInstall();
    if (stored) return stored;
    // Fall back to the dev token from .env so single-workspace setups work
    // before the OAuth Add-to-Slack flow is wired up.
    if (process.env.SLACK_BOT_TOKEN) {
      return {
        team: { id: "dev", name: "dev" },
        bot: {
          token: process.env.SLACK_BOT_TOKEN,
          userId: "dev",
          id: "dev",
          scopes: [],
        },
      } as unknown as Installation;
    }
    throw new Error("No Slack installation found and SLACK_BOT_TOKEN is not set");
  },
  deleteInstallation: async () => {
    // Single-workspace: deletion not surfaced. Multi-workspace will fill this in.
  },
};

export function buildSlackApp(): { receiver: ExpressReceiver; app: App } | null {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!signingSecret || !botToken) return null;

  const receiver = new ExpressReceiver({
    signingSecret,
    endpoints: {
      events: "/slack/events",
      commands: "/slack/commands",
    },
    installationStore,
  });

  const app = new App({
    token: botToken,
    receiver,
  });

  registerSlashCommand(app);
  registerAppMention(app);
  registerBreakdownActions(app);

  return { receiver, app };
}

function registerBreakdownActions(app: App): void {
  // Approve & push: push tickets immediately, then re-render the card as resolved.
  app.action("breakdown_approve", async ({ ack, body, client }) => {
    await ack();
    const threadTs = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
    if (!threadTs) return;
    const session = getSession(threadTs);
    if (!session) return;

    const config = loadConfig();
    const destination = resolveDestination(session, config);
    const channel = session.channel;

    let statusLine: string;
    try {
      const result = await pushTickets(session, config);
      // Persist the pushed state so the PM can still do follow-ups.
      saveSession(session);
      statusLine = `✅ Pushed by <@${body.user.id}>. ${result}`;
    } catch (err) {
      statusLine = `❌ Push failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    // Re-render the original message with resolved blocks (buttons removed).
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const originalText = (body as { message?: { text?: string } }).message?.text ?? "";
    if (messageTs) {
      const blocks = renderResolvedBreakdownBlocks(session, originalText, destination, statusLine);
      await client.chat.update({ channel, ts: messageTs, text: statusLine, blocks });
    }
  });

  // Modify: invite the PM to type edits, then re-render as resolved.
  app.action("breakdown_modify", async ({ ack, body, client }) => {
    await ack();
    const threadTs = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
    if (!threadTs) return;
    const session = getSession(threadTs);
    if (!session) return;

    const config = loadConfig();
    const destination = resolveDestination(session, config);
    const channel = session.channel;
    const statusLine = `✏️ Modify requested by <@${body.user.id}> — type your edits in this thread and @conduit to apply them.`;

    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    const originalText = (body as { message?: { text?: string } }).message?.text ?? "";
    if (messageTs) {
      const blocks = renderResolvedBreakdownBlocks(session, originalText, destination, statusLine);
      await client.chat.update({ channel, ts: messageTs, text: statusLine, blocks });
    }

    // Post a follow-up so the thread stays active and the PM knows what to do.
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "Tell me what to change — e.g. \"split the upload epic into backend and frontend\" or \"drop the analytics story.\" I'll update the breakdown and show it again.",
    });
  });
}
