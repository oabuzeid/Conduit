# CLAUDE.md — Specbot

## What this is

Specbot is a **spec-arbitrated sync engine** for product teams. The thesis: when specs, tickets, and designs fall out of sync, route every change through the spec as a merge point. Any side can propose changes; the spec PR is where humans review and arbitrate.

This avoids the chaos of three-way live sync (where Linear, Figma, and the spec can all write to each other) while still giving teams bidirectional awareness.

## Why this exists when Claude + MCP can do similar things

A Claude conversation with Linear/Figma MCPs connected can do most of what `specbot generate` does. What it can't do:

- Run continuously without human prompting (webhook listener)
- Open PRs against a repo as a side-effect of a Linear webhook firing
- Maintain state across sessions (which spec sections map to which tickets)
- Run in CI (GitHub Action can't open a Claude session)
- Be forked and configured by other teams

Specbot's USP isn't AI ticket generation — it's the **persistent service** that arbitrates between systems.

## Structure

```
src/
  index.ts                    — CLI entry (commander.js)
  commands/
    init.ts                   — scaffold config + example spec
    generate.ts               — specs → AI → tickets + Figma comments
    sync.ts                   — drift detection
    audit.ts                  — Figma vs spec comparison
  core/
    config.ts                 — YAML config loader
    spec-parser.ts            — markdown → structured sections
    ai-engine.ts              — Claude API (generate, drift, audit)
    state.ts                  — .specbot/state.json mapping with content hashes
  integrations/
    types.ts                  — TicketProvider interface
    registry.ts               — provider name → implementation
    linear-provider.ts        — Linear GraphQL
    jira-provider.ts          — Jira REST v3
    figma.ts                  — Figma API (read tree, post comments)
specs/
  vehicle-photo-quality.md    — sample spec for testing
.github/workflows/
  specbot-sync.yml            — auto-sync on PR
```

## Commands

```bash
npm run build
node dist/index.js init
node dist/index.js generate --dry-run -v
node dist/index.js generate
node dist/index.js sync
node dist/index.js audit
```

## Env vars

ANTHROPIC_API_KEY (required), LINEAR_API_KEY (Linear), JIRA_HOST + JIRA_EMAIL + JIRA_API_TOKEN (Jira), FIGMA_ACCESS_TOKEN (Figma)

## Roadmap

### v0.1 — Foundation (built)
One-way generation. This is the substrate v0.2 builds on.

### v0.2 — The actual product (next)
The spec-arbitrated sync engine itself.

**Build order:**

1. **Reverse-direction analyzer** (`src/core/reverse-analyzer.ts`)
   - Input: a ticket (Linear/Jira) and the spec section it maps to (from state.json)
   - Output: a markdown diff describing how the ticket has diverged from the spec
   - Uses the AI engine — same JSON-only response pattern as existing prompts

2. **Spec PR generator** (`src/core/spec-pr.ts`)
   - Input: a reverse diff
   - Action: clones the spec repo, applies the diff to the relevant spec file, opens a GitHub PR
   - PR body includes: source (which ticket/frame), what changed, what specbot will do downstream after merge
   - Uses Octokit for the GitHub API

3. **Webhook listener service** (`src/server/`)
   - Express server with three webhook endpoints: `/webhook/linear`, `/webhook/jira`, `/webhook/figma`
   - On webhook receipt: look up the spec mapping in state.json, run reverse analyzer, call spec PR generator
   - Deployable as Docker container or Cloud Run/Fly.io app
   - New CLI command: `specbot serve --port 3000`

4. **Merge-propagation** (GitHub webhook back to specbot)
   - Listen for `pull_request.closed` events on spec PRs
   - When a specbot-opened PR merges, run `generate` to propagate to other sides
   - Update state.json with new content hashes

5. **Loop prevention**
   - Tag every change specbot makes with a hash in metadata
   - Skip processing webhooks for changes specbot itself just wrote
   - Already partially supported via the spec_hash in state.json

### v0.3 — Delivery surface
- Slack notifications when spec PRs are opened
- Tauri menu bar app
- Browser extension
- Notion as a spec source

## Adding a new ticket provider

1. Create `src/integrations/your-provider.ts` implementing `TicketProvider`
2. Register in `registry.ts`
3. Done

For v0.2, providers also need to support emitting webhook events. The interface will need a `verifyWebhook(payload, signature)` method.

## Conventions

- ESM with .js import extensions
- Interfaces over types for public APIs
- AI prompts return JSON only; strip markdown fences before parsing
- ora spinners for async, chalk for color
- State uses sha256 hashes (first 12 chars) for change detection
