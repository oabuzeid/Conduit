import type { App } from "@slack/bolt";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { loadConfig } from "../../core/config.js";
import { getSession, startSession, saveSession } from "../session.js";
import { decideNextTurn } from "../conversation-agent.js";
import { executeTool } from "../tools/index.js";

interface SlackFile {
  id?: string;
  name?: string;
  filetype?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

export function registerAppMention(app: App): void {
  app.event("app_mention", async ({ event, client }) => {
    const config = loadConfig();
    const threadTs = event.thread_ts ?? event.ts;
    const channel = event.channel;
    const user = event.user;
    if (!user) return;

    debugDump("app_mention", event);

    const text = event.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
    let session = getSession(threadTs);
    const isNewSession = !session;
    if (!session) session = startSession({ thread_ts: threadTs, channel, user_id: user });

    // Post a placeholder we will edit in place once the agent finishes.
    // Single visible message per turn — no separate ack + reply spam.
    const placeholder = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: isNewSession ? ":thought_balloon: Reading the spec…" : ":thought_balloon: Thinking…",
    });
    const placeholderTs = placeholder.ts!;

    // Collect attached files from BOTH event.files (when the app_mention payload carries them)
    // and from message text URLs like <https://files.slack.com/...|name.md> (when Slack delivers
    // them inline). Slack's behavior varies by channel type, file-upload UX, and Enterprise
    // settings — covering both is the only reliable path.
    const filesFromEvent = (event as { files?: SlackFile[] }).files ?? [];
    const inlineFileMatches = [...text.matchAll(/<(https:\/\/files\.slack\.com\/[^|>]+)(?:\|([^>]+))?>/g)];
    const inlineFiles: SlackFile[] = inlineFileMatches.map((m) => ({
      url_private: m[1],
      url_private_download: m[1],
      name: m[2],
    }));
    const allFiles = [...filesFromEvent, ...inlineFiles];

    const ingested: string[] = [];
    const skipped: string[] = [];
    const ingestErrors: string[] = [];
    for (const file of allFiles) {
      const fetchUrl = file.url_private_download || file.url_private;
      if (!fetchUrl) continue;
      if (!isTextLike(file, fetchUrl)) {
        skipped.push(`${file.name ?? fetchUrl} (not a .md/.txt file)`);
        continue;
      }
      try {
        const content = await downloadSlackFile(fetchUrl);
        await executeTool("ingest_spec", { source: "paste", content }, session, config);
        ingested.push(file.name ?? "(unnamed)");
      } catch (err) {
        ingestErrors.push(`${file.name ?? "file"}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`[slack/app-mention] thread=${threadTs} files: event=${filesFromEvent.length} inline=${inlineFiles.length} ingested=${ingested.length} skipped=${skipped.length} errors=${ingestErrors.length}`);

    let messageToProcess: string;
    if (ingested.length) {
      messageToProcess = `[Pre-loaded attached file(s): ${ingested.join(", ")}. Spec is now in the session.]\n\n${text || "(no other instructions from the user — proceed with the usual flow: scan first, surface defaults, then ask before generating)"}`;
    } else if (allFiles.length > 0) {
      // User attached SOMETHING but we couldn't load it. Pass that fact to the agent so it can be specific instead of vague.
      messageToProcess = `[The user attached a file but I couldn't fetch its content. ${ingestErrors.length ? `Reason: ${ingestErrors.join("; ")}.` : skipped.length ? `Skipped — wrong file type: ${skipped.join("; ")}.` : "Slack didn't include the file content in the event payload."}]\n\n${text || "(no other instructions)"}`;
    } else {
      messageToProcess = text || "(no text after mention)";
    }

    let reply = "";
    try {
      const result = await decideNextTurn(session, messageToProcess, config);
      reply = result.reply;
      saveSession(session);
    } catch (err) {
      console.error("[slack/app-mention] agent error:", err);
      reply = `Hit an error: ${err instanceof Error ? err.message : String(err)}`;
    }

    await client.chat.update({
      channel,
      ts: placeholderTs,
      text: reply || "(no reply generated — try rephrasing.)",
    });
  });
}

function isTextLike(file: SlackFile, fetchUrl: string): boolean {
  const ft = (file.filetype ?? "").toLowerCase();
  const mt = (file.mimetype ?? "").toLowerCase();
  const name = (file.name ?? "").toLowerCase();
  const urlLower = fetchUrl.toLowerCase();
  return (
    ft === "md" || ft === "markdown" || ft === "text" || ft === "txt" || ft === "plain_text" ||
    mt.startsWith("text/") ||
    name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".markdown") ||
    urlLower.endsWith(".md") || urlLower.endsWith(".txt") || urlLower.endsWith(".markdown")
  );
}

async function downloadSlackFile(urlPrivate: string): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");
  const res = await fetch(urlPrivate, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  // Slack returns an HTML login page for url_private requests that fail auth — don't feed that to the parser.
  if (contentType.includes("text/html") && (body.includes("<html") || body.includes("<!DOCTYPE"))) {
    throw new Error("Slack returned an HTML login page — bot token may be missing files:read scope or the file is restricted");
  }
  return body;
}

function debugDump(kind: string, payload: unknown): void {
  if (process.env.CONDUIT_DEBUG_SLACK !== "1") return;
  try {
    if (!existsSync(".conduit/debug")) mkdirSync(".conduit/debug", { recursive: true });
    writeFileSync(`.conduit/debug/slack-${kind}-${Date.now()}.json`, JSON.stringify(payload, null, 2));
  } catch {}
}
