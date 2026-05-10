# CLAUDE.md — Specbot

## What this is

Specbot is a spec-arbitrated, agent-directed sync engine for product teams. When specs, tickets, and designs fall out of sync, every change is routed through the spec as a merge point. An LLM agent decides how to route each change: open a PR now, batch with related changes, ask the PM, or pause for loop detection.

Over time, specbot logs how teams edit its outputs, identifies patterns, and proposes prompt updates that pass an eval harness before shipping.

## Why this exists when Claude + MCP can do similar things

A Claude conversation with Linear and Figma MCPs can do most of what `specbot generate` does. It cannot:

- Run continuously without human prompting
- Open PRs as a webhook side-effect
- Maintain state across sessions
- Run in CI
- Log interactions and learn from edits over time
- Be installed by other teams without prompting expertise

v0.1's USP is weak (Claude can do it directly). v0.2 and v0.3's USPs are strong.

## What this becomes that Linear or Jira won't build

Linear and Jira will ship AI ticket generation within a year. They won't ship a tool that operates between their product, the design tool, the spec repo, and Slack. The cross-tool agent is the part that can't be commoditized.

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

See ROADMAP.md for the full version. Build order summary:

### v0.2 — Agentic sync engine + capture layer

1. Reverse-direction analyzer (`src/core/reverse-analyzer.ts`)
2. Spec PR generator (`src/core/spec-pr.ts`) using Octokit
3. Investigation agent (`src/core/agent.ts`) — LLM directs control flow
4. Webhook listener service (`src/server/`) — `specbot serve --port 3000`
5. Merge-propagation — listen for spec PR merges, run downstream sync
6. Loop prevention — hash-based change attribution
7. PRD ambiguity scanner — pre-generation step
8. AC regression detector — flag weakened acceptance criteria
9. Artifact capture layer — log every run to SQLite. No learning yet, just capture.

### v0.3 — Learning loop + cross-tool extraction

1. Structured diff layer
2. Pattern aggregator — weekly Slack/Linear post
3. Eval harness — held-out (spec, expected ticket) pairs
4. Self-improvement loop — eval-gated prompt updates
5. Meeting transcript ingestion — Granola/Otter/Zoom → spec PRs
6. Decision log auto-generation — Slack/ticket-comment scanning → ADRs
7. Stakeholder summary generator — weekly leadership/eng/design digests
8. Stale work detector with action proposals
9. Roadmap reality checker

### v0.4 — Delivery surface

Slack quick-actions, Tauri menu bar, browser extension, Notion as spec source.

## Adding a new ticket provider

1. Create `src/integrations/your-provider.ts` implementing `TicketProvider`
2. Register in `registry.ts`
3. For v0.2, add `verifyWebhook(payload, signature)` to the interface

## Conventions

- ESM with .js import extensions
- Interfaces over types for public APIs
- AI prompts return JSON only; strip markdown fences before parsing
- ora spinners for async, chalk for color
- State uses sha256 hashes (first 12 chars)
- v0.2+: log every LLM call with input and output to SQLite
