import type { App } from "@slack/bolt";
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
}

export function registerAppMention(app: App): void {
  app.event("app_mention", async ({ event, say, client }) => {
    const config = loadConfig();
    const threadTs = event.thread_ts ?? event.ts;
    const channel = event.channel;
    const user = event.user;
    if (!user) return;

    const text = event.text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();

    let session = getSession(threadTs);
    if (!session) {
      session = startSession({ thread_ts: threadTs, channel, user_id: user });
      await say({ thread_ts: threadTs, text: "Got it — let's dig in. One sec while I think." });
    } else {
      await client.reactions.add({ channel, timestamp: event.ts, name: "eyes" }).catch(() => {});
    }

    // Auto-ingest attached markdown/text files BEFORE the agent runs, so the
    // agent doesn't need to ask. Pre-ingestion keeps the file content out of
    // chat history (which replays every turn) — only a short notice survives.
    const ingested: string[] = [];
    const ingestErrors: string[] = [];
    const files = (event as { files?: SlackFile[] }).files ?? [];
    for (const file of files) {
      if (!isTextLike(file)) continue;
      if (!file.url_private) continue;
      try {
        const content = await downloadSlackFile(file.url_private);
        await executeTool("ingest_spec", { source: "paste", content }, session, config);
        ingested.push(file.name ?? "(unnamed)");
      } catch (err) {
        ingestErrors.push(`${file.name ?? "file"}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let messageToProcess = text || "(no text after mention)";
    if (ingested.length) {
      messageToProcess = `[I pre-loaded the file(s) you attached: ${ingested.join(", ")}. The spec is ready in the session.]\n\n${text || "(the user did not include other instructions — proceed with the usual flow: scan first, then ask before generating)"}`;
    }
    if (ingestErrors.length) {
      await say({ thread_ts: threadTs, text: `Heads up — couldn't load: ${ingestErrors.join("; ")}` });
    }

    try {
      const { reply } = await decideNextTurn(session, messageToProcess, config);
      saveSession(session);
      if (reply) await say({ thread_ts: threadTs, text: reply });
    } catch (err) {
      console.error("[slack/app-mention] agent error:", err);
      await say({ thread_ts: threadTs, text: `Hit an error: ${err instanceof Error ? err.message : String(err)}` });
    }
  });
}

function isTextLike(file: SlackFile): boolean {
  const ft = (file.filetype ?? "").toLowerCase();
  const mt = (file.mimetype ?? "").toLowerCase();
  const name = (file.name ?? "").toLowerCase();
  return (
    ft === "md" ||
    ft === "markdown" ||
    ft === "text" ||
    ft === "txt" ||
    mt.startsWith("text/") ||
    name.endsWith(".md") ||
    name.endsWith(".txt") ||
    name.endsWith(".markdown")
  );
}

async function downloadSlackFile(urlPrivate: string): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");
  const res = await fetch(urlPrivate, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status} ${res.statusText}`);
  return await res.text();
}
