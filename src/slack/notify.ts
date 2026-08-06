import { WebClient } from "@slack/web-api";
import type { ConduitConfig } from "../core/config.js";
import type { SpecPRResult } from "../core/spec-pr.js";
import type { DesignChangeEvent, TicketChangeEvent } from "../core/events.js";
import type { AgentDecision } from "../core/events.js";
import { storeAlert } from "./alert-store.js";
import { renderSpecPRAlert, renderDesignChangeAlert } from "./alerts.js";
import { findSessionBySpecFile, findSessionByFigmaFile } from "./session.js";

function getClient(): WebClient | null {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  return new WebClient(token);
}

/**
 * Post a spec-PR alert to the Slack thread that owns the spec file.
 * Called from the Jira/Figma webhook handlers after openSpecPR() succeeds.
 * Returns true if an alert was posted, false if no matching session exists.
 */
export async function notifySpecPR(
  prResult: SpecPRResult,
  decision: AgentDecision & { pr_payload: NonNullable<AgentDecision["pr_payload"]> },
  triggeringEvent: TicketChangeEvent | DesignChangeEvent,
  repo: { owner: string; name: string },
  _config: ConduitConfig
): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.log("[slack/notify] SLACK_BOT_TOKEN not set — skipping spec-PR alert");
    return false;
  }

  const session = findSessionBySpecFile(decision.pr_payload.target_spec_file);
  if (!session) {
    console.log(`[slack/notify] no active Slack session for spec file ${decision.pr_payload.target_spec_file} — skipping alert`);
    return false;
  }

  const alertId = storeAlert({
    kind: "spec_pr",
    thread_ts: session.thread_ts,
    channel: session.channel,
    pr_number: prResult.pr_number,
    pr_url: prResult.pr_url,
    branch_name: prResult.branch_name,
    repo,
    edit_summary: decision.pr_payload.edit_summary,
    triggering_event: triggeringEvent,
  });

  const alert = {
    kind: "spec_pr" as const,
    id: alertId,
    thread_ts: session.thread_ts,
    channel: session.channel,
    pr_number: prResult.pr_number,
    pr_url: prResult.pr_url,
    branch_name: prResult.branch_name,
    repo,
    edit_summary: decision.pr_payload.edit_summary,
    triggering_event: triggeringEvent,
    created_at: new Date().toISOString(),
  };

  const blocks = renderSpecPRAlert(alert);
  await client.chat.postMessage({
    channel: session.channel,
    thread_ts: session.thread_ts,
    text: `Spec PR opened: ${decision.pr_payload.edit_summary}`,
    blocks,
  });

  console.log(`[slack/notify] posted spec-PR alert for PR #${prResult.pr_number} to thread ${session.thread_ts}`);
  return true;
}

/**
 * Post a design-change alert to the Slack thread that attached the Figma file.
 * Called from the Figma webhook handler after classification.
 * Returns true if an alert was posted, false if no matching session exists.
 */
export async function notifyDesignChange(
  event: DesignChangeEvent,
  _config: ConduitConfig
): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.log("[slack/notify] SLACK_BOT_TOKEN not set — skipping design-change alert");
    return false;
  }

  const session = findSessionByFigmaFile(event.file_id);
  if (!session) {
    console.log(`[slack/notify] no active Slack session for Figma file ${event.file_id} — skipping alert`);
    return false;
  }

  // Resolve the spec file and repo for a potential future spec PR.
  const specFilePath = session.spec_file_path;
  const repoEnv = process.env.CONDUIT_GITHUB_REPO;
  const repo = repoEnv?.includes("/")
    ? { owner: repoEnv.split("/")[0], name: repoEnv.split("/")[1] }
    : undefined;

  const alertId = storeAlert({
    kind: "design_change",
    thread_ts: session.thread_ts,
    channel: session.channel,
    event,
    spec_file_path: specFilePath,
    repo,
  });

  const alert = {
    kind: "design_change" as const,
    id: alertId,
    thread_ts: session.thread_ts,
    channel: session.channel,
    event,
    spec_file_path: specFilePath,
    repo,
    created_at: new Date().toISOString(),
  };

  const blocks = renderDesignChangeAlert(alert);
  const classLabel =
    event.classification === "new_screen_added" ? "New screen added" :
    event.classification === "screen_removed" ? "Screen removed" :
    event.classification === "significant_copy_change" ? "Significant copy change" :
    event.classification;

  await client.chat.postMessage({
    channel: session.channel,
    thread_ts: session.thread_ts,
    text: `Figma change detected: ${classLabel} — ${event.semantic_summary}`,
    blocks,
  });

  console.log(`[slack/notify] posted design-change alert for Figma file ${event.file_id} to thread ${session.thread_ts}`);
  return true;
}
