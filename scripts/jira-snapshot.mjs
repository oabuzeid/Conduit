#!/usr/bin/env node
// Snapshot a Jira ticket's current state so we can diff against it later.
//
// Usage: node scripts/jira-snapshot.mjs CTST-5

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "fs";

const key = process.argv[2];
if (!key) {
  console.error("Usage: node scripts/jira-snapshot.mjs <TICKET-KEY>");
  process.exit(1);
}

const host = process.env.JIRA_HOST;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_API_TOKEN;
if (!host || !email || !token) {
  console.error("JIRA_HOST / JIRA_EMAIL / JIRA_API_TOKEN must be set in .env");
  process.exit(1);
}

const auth = Buffer.from(`${email}:${token}`).toString("base64");
const res = await fetch(`https://${host}/rest/api/3/issue/${key}?fields=summary,description,labels,status`, {
  headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
});
if (!res.ok) {
  console.error(`Jira fetch failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}
const data = await res.json();

const snapshot = {
  id: data.key,
  title: data.fields.summary,
  description: extractText(data.fields.description),
  labels: data.fields.labels ?? [],
  status: data.fields.status?.name ?? "",
  acceptance_criteria: [],
};

if (!existsSync(".conduit/snapshots")) mkdirSync(".conduit/snapshots", { recursive: true });
const path = `.conduit/snapshots/${key}.json`;
writeFileSync(path, JSON.stringify(snapshot, null, 2));

console.log(`Saved snapshot of ${key} to ${path}`);
console.log("---");
console.log(`Title: ${snapshot.title}`);
console.log(`Status: ${snapshot.status}`);
console.log(`Labels: ${snapshot.labels.join(", ")}`);
console.log(`Description (first 400 chars):`);
console.log(snapshot.description.slice(0, 400) + (snapshot.description.length > 400 ? "..." : ""));

function extractText(adf) {
  if (!adf || typeof adf !== "object" || !adf.content) return "";
  const walk = (nodes) =>
    nodes
      .map((n) => {
        if (n.type === "text") return n.text ?? "";
        if (n.type === "hardBreak") return "\n";
        if (n.content) return walk(n.content);
        return "";
      })
      .join("");
  return adf.content
    .map((block) => {
      if (block.type === "bulletList" || block.type === "orderedList") {
        return (block.content ?? [])
          .map((li) => "- " + walk(li.content ?? []))
          .join("\n");
      }
      return walk(block.content ?? []);
    })
    .join("\n\n");
}
