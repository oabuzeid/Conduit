#!/usr/bin/env node
// Drive the Slack conversation agent through a multi-turn exchange
// without touching Slack. Useful for verifying the tool-use loop
// before live-testing in a real workspace.

import "dotenv/config";
import { decideNextTurn } from "../dist/slack/conversation-agent.js";
import { startSession, saveSession, getSession } from "../dist/slack/session.js";
import { loadConfig } from "../dist/core/config.js";
import { rmSync, existsSync } from "fs";

if (existsSync(".conduit/sessions.json")) rmSync(".conduit/sessions.json");

const config = loadConfig();
const thread_ts = "synthetic-" + Date.now();
const session = startSession({ thread_ts, channel: "C-test", user_id: "U-test" });

async function turn(userMsg) {
  const fresh = getSession(thread_ts);
  console.log("\n👤 USER:", userMsg);
  const result = await decideNextTurn(fresh, userMsg, config);
  saveSession(fresh);
  console.log("🤖 BOT:", result.reply);
  console.log(`(tools called: ${result.tool_calls_made})`);
}

await turn("Hi — I want to break down a spec into tickets. The file is at specs/automated-mileage-incidentals.sample.md");
await turn("Yeah let's see the high-severity findings, but skip generation for now");
await turn("OK, generate the tickets. Don't push yet.");
await turn("Looks pretty good. Don't push — let's stop here.");

console.log("\n--- final session ---");
const final = getSession(thread_ts);
console.log({
  spec_loaded: !!final.spec_text,
  spec_chars: final.spec_text?.length,
  scan_findings: final.scan_findings_count,
  draft_tickets: final.draft_tickets?.length,
  pushed: !!final.pushed_ticket_ids?.length,
  history_turns: final.history.length,
});
