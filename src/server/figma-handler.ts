import { readFileSync, existsSync } from "fs";
import type { ConduitConfig } from "../core/config.js";
import { getFigmaTree } from "../integrations/figma.js";
import { flattenTree, diffSnapshots, classifyChanges } from "../core/figma-classifier.js";
import { notifyDesignChange } from "../slack/notify.js";

interface FigmaWebhookPayload {
  event_type?: string;
  file_key?: string;
  file_name?: string;
}

export async function handleFigmaWebhook(payload: FigmaWebhookPayload, config: ConduitConfig): Promise<void> {
  if (payload.event_type !== "FILE_UPDATE") {
    console.log(`[figma] ignoring event: ${payload.event_type}`);
    return;
  }
  const fileId = payload.file_key;
  if (!fileId) {
    console.log("[figma] no file_key in payload — skipping");
    return;
  }

  const snapshotPath = `.conduit/snapshots/figma-${fileId}.json`;
  if (!existsSync(snapshotPath)) {
    console.log(`[figma] no prior snapshot for ${fileId} — taking baseline and skipping classification`);
    return;
  }
  const before = JSON.parse(readFileSync(snapshotPath, "utf-8"));

  const tree = await getFigmaTree(fileId);
  const after = flattenTree(fileId, tree.name, tree.nodes);

  const threshold = config.design?.significant_change_threshold;
  if (!threshold) {
    console.log("[figma] no threshold configured — skipping");
    return;
  }
  const deltas = diffSnapshots(before, after, threshold);
  if (deltas.length === 0) {
    console.log(`[figma] ${fileId}: no changes above threshold`);
    return;
  }
  console.log(`[figma] ${fileId}: ${deltas.length} deltas passed threshold`);

  const event = await classifyChanges(fileId, tree.nodes[0]?.id ?? "0:0", deltas, config);
  console.log(`[figma] ${fileId}: classification → ${event.classification}`);

  if (event.classification === "ignore") return;

  // Post a Slack alert so the PM can decide: accept & propagate, dismiss, or modify.
  // The agent decision (open_pr_now, ask_pm, etc.) is deferred to the button handler —
  // design changes surface to the PM first, unlike ticket changes which the agent
  // can route autonomously.
  const notified = await notifyDesignChange(event, config);
  if (notified) {
    console.log(`[figma] ${fileId}: Slack design-change alert posted`);
  } else {
    console.log(`[figma] ${fileId}: no active Slack session — design change logged but not alerted`);
  }
}
