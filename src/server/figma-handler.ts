import { readFileSync, existsSync } from "fs";
import type { ConduitConfig } from "../core/config.js";
import { getFigmaTree } from "../integrations/figma.js";
import { flattenTree, diffSnapshots, classifyChanges } from "../core/figma-classifier.js";
import { decide } from "../core/agent.js";

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

  const decision = await decide(event, {}, config);
  console.log(`[figma] ${fileId}: agent decision → ${decision.action}`);
  if (decision.reasoning) console.log(`        ${decision.reasoning}`);
  if (decision.question) console.log(`        question: ${decision.question}`);
  // Note: opening a spec PR from a Figma event needs explicit spec-file mapping
  // (no state.json entry for design changes). Deferred to v0.2.x improvements.
}
