import { App, ExpressReceiver, type Installation, type InstallationQuery } from "@slack/bolt";
import { Octokit } from "@octokit/rest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { loadConfig } from "../core/config.js";
import { decide } from "../core/agent.js";
import { openSpecPR } from "../core/spec-pr.js";
import { getSession, saveSession } from "./session.js";
import { pushTickets, resolveDestination } from "./tools/index.js";
import { renderResolvedBreakdownBlocks } from "./blocks.js";
import { getAlert, removeAlert, type SpecPRAlertData, type DesignChangeAlertData } from "./alert-store.js";
import { renderResolvedSpecPRAlert, renderResolvedDesignChangeAlert } from "./alerts.js";
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
  registerAlertActions(app);

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

// ─── Phase D: spec-PR + design-change alert actions ──────────────

function registerAlertActions(app: App): void {
  // ── Spec-PR: Approve & merge ──
  app.action("spec_pr_approve", async ({ ack, body, client }) => {
    await ack();
    const alertId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
    if (!alertId) return;
    const alert = getAlert(alertId);
    if (!alert || alert.kind !== "spec_pr") return;
    const prAlert = alert as SpecPRAlertData;

    const token = process.env.GITHUB_TOKEN;
    let statusLine: string;
    if (!token) {
      statusLine = "❌ GITHUB_TOKEN not set — can't merge the PR. Merge it manually on GitHub.";
    } else {
      try {
        const octokit = new Octokit({ auth: token });
        await octokit.pulls.merge({
          owner: prAlert.repo.owner,
          repo: prAlert.repo.name,
          pull_number: prAlert.pr_number,
          merge_method: "squash",
        });
        statusLine = `✅ Merged by <@${body.user.id}>. Downstream propagation will run when the merge webhook fires.`;
      } catch (err) {
        statusLine = `❌ Merge failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    if (messageTs) {
      const blocks = renderResolvedSpecPRAlert(prAlert, statusLine);
      await client.chat.update({ channel: prAlert.channel, ts: messageTs, text: statusLine, blocks });
    }
    removeAlert(alertId);
  });

  // ── Spec-PR: Request changes ──
  app.action("spec_pr_changes", async ({ ack, body, client }) => {
    await ack();
    const alertId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
    if (!alertId) return;
    const alert = getAlert(alertId);
    if (!alert || alert.kind !== "spec_pr") return;
    const prAlert = alert as SpecPRAlertData;

    const statusLine = `✏️ Changes requested by <@${body.user.id}> — review the PR on GitHub or type your feedback in this thread.`;

    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    if (messageTs) {
      const blocks = renderResolvedSpecPRAlert(prAlert, statusLine);
      await client.chat.update({ channel: prAlert.channel, ts: messageTs, text: statusLine, blocks });
    }

    await client.chat.postMessage({
      channel: prAlert.channel,
      thread_ts: prAlert.thread_ts,
      text: `PR #${prAlert.pr_number} is waiting for your feedback. Review it on <${prAlert.pr_url}|GitHub> or type what needs to change here and @conduit to update the spec.`,
    });
    removeAlert(alertId);
  });

  // ── Design change: Accept & propagate ──
  app.action("design_accept", async ({ ack, body, client }) => {
    await ack();
    const alertId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
    if (!alertId) return;
    const alert = getAlert(alertId);
    if (!alert || alert.kind !== "design_change") return;
    const dcAlert = alert as DesignChangeAlertData;

    const config = loadConfig();
    let statusLine: string;

    if (!dcAlert.repo || !dcAlert.spec_file_path) {
      statusLine = "❌ No repo or spec file linked to this session — can't open a spec PR. Link a repo (CONDUIT_GITHUB_REPO) and save the spec to the repo first.";
    } else {
      try {
        // Ask the agent to produce a PR payload from the design change.
        const decision = await decide(dcAlert.event, {}, config);
        if (decision.action !== "open_pr_now" || !decision.pr_payload) {
          // Agent decided against a PR — surface its reasoning.
          statusLine = `ℹ️ Agent decided: ${decision.action}. ${decision.reasoning}`;
        } else {
          decision.pr_payload.target_spec_file = dcAlert.spec_file_path;
          const prResult = await openSpecPR(
            {
              decision: { ...decision, pr_payload: decision.pr_payload },
              triggering_event: dcAlert.event,
              spec_file_path: dcAlert.spec_file_path,
              repo: dcAlert.repo,
            },
            config
          );
          // Auto-merge the PR since the PM explicitly accepted.
          const token = process.env.GITHUB_TOKEN;
          if (token) {
            const octokit = new Octokit({ auth: token });
            try {
              await octokit.pulls.merge({
                owner: dcAlert.repo.owner,
                repo: dcAlert.repo.name,
                pull_number: prResult.pr_number,
                merge_method: "squash",
              });
              statusLine = `✅ Accepted by <@${body.user.id}>. Spec PR <${prResult.pr_url}|#${prResult.pr_number}> merged — downstream propagation will follow.`;
            } catch (mergeErr) {
              statusLine = `⚠️ Spec PR <${prResult.pr_url}|#${prResult.pr_number}> opened but merge failed: ${mergeErr instanceof Error ? mergeErr.message : String(mergeErr)}. Merge it manually.`;
            }
          } else {
            statusLine = `⚠️ Spec PR <${prResult.pr_url}|#${prResult.pr_number}> opened but GITHUB_TOKEN not set for merge. Merge it manually.`;
          }
        }
      } catch (err) {
        statusLine = `❌ Failed to propagate: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    if (messageTs) {
      const blocks = renderResolvedDesignChangeAlert(dcAlert, statusLine);
      await client.chat.update({ channel: dcAlert.channel, ts: messageTs, text: statusLine, blocks });
    }
    removeAlert(alertId);
  });

  // ── Design change: Dismiss ──
  app.action("design_dismiss", async ({ ack, body, client }) => {
    await ack();
    const alertId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
    if (!alertId) return;
    const alert = getAlert(alertId);
    if (!alert || alert.kind !== "design_change") return;
    const dcAlert = alert as DesignChangeAlertData;

    const statusLine = `🚫 Dismissed by <@${body.user.id}>. No spec changes will be made.`;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    if (messageTs) {
      const blocks = renderResolvedDesignChangeAlert(dcAlert, statusLine);
      await client.chat.update({ channel: dcAlert.channel, ts: messageTs, text: statusLine, blocks });
    }
    removeAlert(alertId);
  });

  // ── Design change: Modify before propagation ──
  app.action("design_modify", async ({ ack, body, client }) => {
    await ack();
    const alertId = (body as { actions?: Array<{ value?: string }> }).actions?.[0]?.value;
    if (!alertId) return;
    const alert = getAlert(alertId);
    if (!alert || alert.kind !== "design_change") return;
    const dcAlert = alert as DesignChangeAlertData;

    const statusLine = `✏️ Modify requested by <@${body.user.id}> — describe the spec change you want, then @conduit to apply it.`;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    if (messageTs) {
      const blocks = renderResolvedDesignChangeAlert(dcAlert, statusLine);
      await client.chat.update({ channel: dcAlert.channel, ts: messageTs, text: statusLine, blocks });
    }

    const ev = dcAlert.event;
    const affectedFiles = ev.affected_spec_sections.map((s) => `\`${s.file}\` → "${s.section}"`).join(", ") || "no mapped sections";
    await client.chat.postMessage({
      channel: dcAlert.channel,
      thread_ts: dcAlert.thread_ts,
      text: `Figma change: ${ev.semantic_summary}\n\nAffected spec: ${affectedFiles}\n\nDescribe how you want the spec updated — e.g. "add a new section for the loading state" or "update the copy in the upload section." @conduit will draft the spec PR with your edits.`,
    });
    // Alert stays removed — the PM continues via the conversational agent.
    removeAlert(alertId);
  });
}
