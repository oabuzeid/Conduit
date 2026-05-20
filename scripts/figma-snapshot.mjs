#!/usr/bin/env node
// Snapshot a Figma file's current node tree so we can diff against it later.
//
// Usage: node scripts/figma-snapshot.mjs [file-id]
// Defaults to design.file_id from conduit.yaml.

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { getFigmaTree } from "../dist/integrations/figma.js";
import { flattenTree } from "../dist/core/figma-classifier.js";
import { loadConfig } from "../dist/core/config.js";

const config = loadConfig();
const fileId = process.argv[2] ?? config.design?.file_id;
if (!fileId) {
  console.error("Usage: node scripts/figma-snapshot.mjs <file-id>");
  process.exit(1);
}

const tree = await getFigmaTree(fileId);
const snapshot = flattenTree(fileId, tree.name, tree.nodes);

if (!existsSync(".conduit/snapshots")) mkdirSync(".conduit/snapshots", { recursive: true });
const path = `.conduit/snapshots/figma-${fileId}.json`;
writeFileSync(path, JSON.stringify(snapshot, null, 2));

console.log(`Saved Figma snapshot to ${path}`);
console.log(`File: ${tree.name}`);
console.log(`Total nodes: ${snapshot.nodes.length}`);
console.log(`Top-level frames: ${snapshot.nodes.filter((n) => n.is_top_level && (n.type === "FRAME" || n.type === "SECTION" || n.type === "COMPONENT")).length}`);
console.log(`Text nodes: ${snapshot.nodes.filter((n) => n.type === "TEXT").length}`);
