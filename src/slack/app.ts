import { App, ExpressReceiver, type Installation, type InstallationQuery } from "@slack/bolt";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
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

  return { receiver, app };
}
