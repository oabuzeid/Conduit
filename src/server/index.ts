import express, { type Request, type Response, type RequestHandler } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { loadConfig } from "../core/config.js";
import { handleJiraWebhook } from "./jira-handler.js";
import { handleGitHubWebhook } from "./github-handler.js";
import { handleFigmaWebhook } from "./figma-handler.js";

export interface ServerOptions {
  port: number;
}

export function startServer(opts: ServerOptions): void {
  const config = loadConfig();
  const app = express();

  app.use(
    express.json({
      limit: "5mb",
      verify: (req: Request, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/webhook/jira", verifyJira, asyncRoute(async (req, res) => {
    await handleJiraWebhook(req.body, config);
    res.status(202).json({ ok: true });
  }));

  app.post("/webhook/github", verifyGitHub, asyncRoute(async (req, res) => {
    await handleGitHubWebhook(req.headers["x-github-event"] as string | undefined, req.body, config);
    res.status(202).json({ ok: true });
  }));

  app.post("/webhook/figma", asyncRoute(async (req, res) => {
    await handleFigmaWebhook(req.body, config);
    res.status(202).json({ ok: true });
  }));

  app.post("/webhook/linear", (_req, res) => {
    res.status(501).json({ error: "Linear webhooks not yet implemented" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: err.message });
  });

  app.listen(opts.port, () => {
    console.log(`Conduit listening on http://localhost:${opts.port}`);
    console.log(`Endpoints: /webhook/jira  /webhook/github  /webhook/figma  /healthz`);
    if (!process.env.JIRA_WEBHOOK_SECRET) {
      console.warn("  WARNING: JIRA_WEBHOOK_SECRET not set — Jira webhook signatures will not be verified.");
    }
    if (!process.env.GITHUB_WEBHOOK_SECRET) {
      console.warn("  WARNING: GITHUB_WEBHOOK_SECRET not set — GitHub webhook signatures will not be verified.");
    }
  });
}

function asyncRoute(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const verifyJira: RequestHandler = (req, res, next) => {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) return next();
  const sig = req.header("x-hub-signature");
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!sig || !raw) {
    res.status(401).json({ error: "missing signature" });
    return;
  }
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  if (!safeEqual(sig, expected)) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  next();
};

const verifyGitHub: RequestHandler = (req, res, next) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return next();
  const sig = req.header("x-hub-signature-256");
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!sig || !raw) {
    res.status(401).json({ error: "missing signature" });
    return;
  }
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  if (!safeEqual(sig, expected)) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }
  next();
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
