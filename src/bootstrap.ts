// This file MUST be imported first in src/index.ts, before any module that
// constructs an SDK client (Anthropic, Octokit, Slack bolt, etc) at top
// level. ESM imports run depth-first in source order, so the body of this
// file runs and populates process.env BEFORE those constructors fire.
//
// override:true so .env wins over the shell. Without override, a stale
// token left in the shell from a previous `source .env` silently overrides
// updated .env contents and produces cryptic 401/404 errors that look like
// permissions problems. In production deployments without a .env file
// (Docker, Cloud Run) override has no effect — container-provided env vars
// still apply.
import { config } from "dotenv";
config({ override: true });
