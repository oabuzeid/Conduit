import Anthropic from "@anthropic-ai/sdk";
import { diffChars } from "diff";
import type { ConduitConfig, FigmaChangeThreshold } from "./config.js";
import type {
  DesignChangeEvent,
  DesignChangeClassification,
  StructuralDelta,
} from "./events.js";
import type { FigmaNode } from "../integrations/figma.js";
import { captured } from "./capture.js";

export interface FigmaSnapshot {
  file_id: string;
  file_name: string;
  fetched_at: string;
  nodes: FlatNode[];
}

interface FlatNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  parent_id?: string;
  is_top_level: boolean;
}

const anthropic = new Anthropic();

export function flattenTree(fileId: string, fileName: string, nodes: FigmaNode[]): FigmaSnapshot {
  const flat: FlatNode[] = [];
  const walk = (node: FigmaNode, parent_id?: string, depth = 0): void => {
    flat.push({
      id: node.id,
      name: node.name,
      type: node.type,
      characters: node.characters,
      parent_id,
      is_top_level: depth <= 1,
    });
    if (node.children) {
      for (const child of node.children) walk(child, node.id, depth + 1);
    }
  };
  for (const root of nodes) walk(root, undefined, 0);
  return { file_id: fileId, file_name: fileName, fetched_at: new Date().toISOString(), nodes: flat };
}

export function diffSnapshots(
  before: FigmaSnapshot,
  after: FigmaSnapshot,
  threshold: FigmaChangeThreshold
): StructuralDelta[] {
  const isFrameLike = (n: FlatNode): boolean =>
    n.type === "FRAME" || n.type === "COMPONENT" || n.type === "SECTION";
  const inScope = (n: FlatNode): boolean =>
    threshold.track_top_level_only ? n.is_top_level : true;

  const beforeById = new Map(before.nodes.map((n) => [n.id, n]));
  const afterById = new Map(after.nodes.map((n) => [n.id, n]));

  const deltas: StructuralDelta[] = [];

  for (const node of after.nodes) {
    if (!isFrameLike(node) || !inScope(node)) continue;
    if (!beforeById.has(node.id)) {
      deltas.push({ kind: "frame_added", node_id: node.id, frame_name: node.name });
    }
  }
  for (const node of before.nodes) {
    if (!isFrameLike(node) || !inScope(node)) continue;
    if (!afterById.has(node.id)) {
      deltas.push({ kind: "frame_removed", node_id: node.id, frame_name: node.name });
    }
  }
  for (const node of after.nodes) {
    if (node.type !== "TEXT") continue;
    const prev = beforeById.get(node.id);
    if (!prev || prev.type !== "TEXT") continue;
    const beforeText = prev.characters ?? "";
    const afterText = node.characters ?? "";
    if (beforeText === afterText) continue;
    const charsChanged = diffChars(beforeText, afterText)
      .filter((p) => p.added || p.removed)
      .reduce((sum, p) => sum + (p.count ?? 0), 0);
    deltas.push({
      kind: "text_changed",
      node_id: node.id,
      frame_name: containingFrameName(after, node.id),
      before: beforeText,
      after: afterText,
      chars_changed: charsChanged,
    });
  }

  return applyThreshold(deltas, threshold);
}

function applyThreshold(deltas: StructuralDelta[], t: FigmaChangeThreshold): StructuralDelta[] {
  const added = deltas.filter((d) => d.kind === "frame_added").length;
  const removed = deltas.filter((d) => d.kind === "frame_removed").length;
  const significantText = deltas.filter(
    (d) => d.kind === "text_changed" && (d.chars_changed ?? 0) >= t.min_text_chars_changed
  );

  const passes =
    added >= t.min_frames_added || removed >= t.min_frames_removed || significantText.length > 0;
  if (!passes) return [];

  return [
    ...deltas.filter((d) => d.kind === "frame_added" || d.kind === "frame_removed"),
    ...significantText,
  ];
}

function containingFrameName(snapshot: FigmaSnapshot, node_id: string): string {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  let cur = byId.get(node_id);
  while (cur) {
    if (cur.type === "FRAME" || cur.type === "COMPONENT" || cur.type === "SECTION") {
      return cur.name;
    }
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return "(unknown frame)";
}

export async function classifyChanges(
  fileId: string,
  rootNodeId: string,
  deltas: StructuralDelta[],
  config: ConduitConfig
): Promise<DesignChangeEvent> {
  if (deltas.length === 0) {
    return {
      source: "figma",
      file_id: fileId,
      root_node_id: rootNodeId,
      classification: "ignore",
      structural_deltas: [],
      semantic_summary: "No structural changes passed the configured threshold.",
      affected_spec_sections: [],
      detected_at: new Date().toISOString(),
    };
  }

  const prompt = `You are classifying a set of Figma changes that just passed the structural threshold filter. Your job is to decide what kind of change this is and write a one-paragraph semantic summary.

CLASSIFICATIONS:
- "new_screen_added": one or more new top-level frames represent a new screen, flow step, or major UI surface.
- "screen_removed": one or more top-level frames that previously held a screen or flow step have been removed.
- "significant_copy_change": text content within existing frames changed in a way that alters meaning (not just typo fixes or punctuation).
- "ignore": the changes are cosmetic or technical (renames, regrouping, layout cleanup) with no product implication.

Respond ONLY with a JSON object. No markdown, no preamble:
{
  "classification": "new_screen_added" | "screen_removed" | "significant_copy_change" | "ignore",
  "semantic_summary": "1-2 sentences explaining what changed and why it matters from a product perspective."
}

STRUCTURAL DELTAS:
${JSON.stringify(deltas, null, 2)}`;

  const result = await captured(
    "classify_design_change",
    { prompt, delta_count: deltas.length },
    { model: config.ai.model },
    async () => {
      const response = await anthropic.messages.create({
        model: config.ai.model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      return JSON.parse(text.replace(/```json|```/g, "").trim()) as {
        classification: DesignChangeClassification;
        semantic_summary: string;
      };
    }
  );

  return {
    source: "figma",
    file_id: fileId,
    root_node_id: rootNodeId,
    classification: result.classification,
    structural_deltas: deltas,
    semantic_summary: result.semantic_summary,
    affected_spec_sections: [],
    detected_at: new Date().toISOString(),
  };
}
