# CLAUDE.md — Conduit

## What this is

Conduit is a spec-arbitrated, agent-directed sync engine for product teams. When specs, tickets, and designs fall out of sync, every change is routed through the spec as a merge point. An LLM agent decides how to route each change: open a PR now, batch with related changes, ask the PM, or pause for loop detection.

Over time, Conduit logs how teams edit its outputs, identifies patterns, and proposes prompt updates that pass an eval harness before shipping.

## Why this exists when Claude + MCP can do similar things

A Claude conversation with Linear/Jira and Figma MCPs can do most of what `conduit generate` does. It cannot:

- Run continuously without human prompting
- Open PRs as a webhook side-effect
- Maintain state across sessions
- Run in CI
- Log interactions and learn from edits over time
- Be installed by other teams without prompting expertise

v0.1's USP is foundational (Claude can still do it directly). v0.2 onward is where Conduit becomes meaningfully different.

## Structure

```
src/
  index.ts                    — CLI entry (commander.js)
  bootstrap.ts                — server bootstrap + env checks
  commands/
    init.ts                   — scaffold config + example spec
    generate.ts               — specs → AI → tickets + Figma comments
    sync.ts                   — drift detection
    audit.ts                  — Figma vs spec comparison
    scan.ts                   — PRD ambiguity scanner
  core/
    config.ts                 — YAML config loader
    spec-parser.ts            — markdown → structured sections
    ai-engine.ts              — Claude API (generate, drift, audit)
    state.ts                  — .conduit/state.json mapping with content hashes
    agent.ts                  — investigation agent (LLM routes webhook events)
    spec-pr.ts                — spec PR generator (Octokit)
    reverse-analyzer.ts       — ticket diff → spec diff
    figma-classifier.ts       — structural + semantic design-change classifier
    ambiguity-scanner.ts      — PRD ambiguity detection
    ac-regression.ts          — AC regression detector
    capture.ts                — artifact capture layer (JSON logging)
    events.ts                 — shared I/O contract (agent ↔ classifier)
    loop-guard.ts             — tag-based loop prevention
    merge-propagator.ts       — downstream sync after spec PR merge
    pending-prs.ts            — pending PR tracking
    router.ts                 — per-project ticket routing
    spec-fetcher.ts           — fetch specs from URLs (Google Docs)
    spec-mapper.ts            — frame/ticket → spec section mapping
  integrations/
    types.ts                  — TicketProvider interface
    registry.ts               — provider name → implementation
    linear-provider.ts        — Linear GraphQL
    jira-provider.ts          — Jira REST v3
    figma.ts                  — Figma API (read tree, post comments)
  server/
    index.ts                  — Express server + webhook routes
    jira-handler.ts           — Jira webhook → reverse analysis → spec PR
    github-handler.ts         — GitHub PR merge → downstream propagation
    figma-handler.ts          — Figma webhook → classifier → Slack alert
  slack/
    app.ts                    — Bolt app + action handlers (breakdown, spec-PR, design-change)
    session.ts                — per-thread conversation sessions
    conversation-agent.ts     — tool-using Claude agent for Slack threads
    blocks.ts                 — Block Kit breakdown card renderers
    alerts.ts                 — Block Kit spec-PR + design-change alert renderers
    alert-store.ts            — pending alert data store
    notify.ts                 — proactive Slack posting from webhook handlers
    commands/
      index.ts                — slash command dispatcher
      ping.ts                 — /conduit ping
      help.ts                 — /conduit help
      start.ts                — /conduit start
    events/
      app-mention.ts          — @conduit mention handler
    tools/
      index.ts                — 12 agent tools (ingest, scan, generate, push, etc.)
specs/
  vehicle-photo-quality.md    — sample spec for testing
.github/workflows/
  conduit-sync.yml            — auto-sync on PR
```

## Commands

```bash
npm run build
node dist/index.js init
node dist/index.js generate --dry-run -v
node dist/index.js generate
node dist/index.js sync
node dist/index.js audit
node dist/index.js scan
node dist/index.js serve --port 3000    # webhook listener + Slack app
```

## Env vars

ANTHROPIC_API_KEY (required), LINEAR_API_KEY (Linear), JIRA_HOST + JIRA_EMAIL + JIRA_API_TOKEN (Jira), FIGMA_ACCESS_TOKEN (Figma), GITHUB_TOKEN + CONDUIT_GITHUB_REPO (spec PRs), SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET (Slack app)

## Roadmap

See ROADMAP.md for the full version. v0.1 through v0.3 are complete; v0.4+ is next. Build order summary:

- **v0.1 ✅** — Foundation: CLI, spec parser, AI ticket generation, Linear + Jira + Figma integrations, drift detection, state tracking
- **v0.1.x ✅** — Engine UX: configurable breakdown modes, AC format, default tone + ticket-writing rules, Figma change threshold
- **v0.2 ✅** — Agentic engine: reverse-direction analyzer, spec PR generator, investigation agent, webhook listener, merge-propagation, loop prevention, capture layer, design-change classifier
- **v0.2.x ✅** — Engine follow-ups: per-project ticket routing, PRD ambiguity scanner, AC regression detector
- **v0.3 ✅** — Slack workflow (the product launches here): conversational agent, 12 tools, Block Kit breakdown with Approve/Modify buttons, spec-PR approval alerts, design-change alerts
- **v0.4** — Learning loop: structured diffs, pattern aggregation, eval harness, self-improvement, transcript ingestion
- **v0.5** — Additional surfaces: Tauri menu bar app, browser extension, Notion as a spec source

## Adding a new ticket provider

1. Create `src/integrations/your-provider.ts` implementing `TicketProvider`
2. Register in `registry.ts`
3. For v0.2, add `verifyWebhook(payload, signature)` to the interface

## Ticket-writing rules

These apply to any ticket conduit generates or updates, regardless of project. They are encoded in the `generate` prompt (`src/core/ai-engine.ts`) and in the Slack conversation agent's system prompt (`src/slack/conversation-agent.ts`).

- **Every ticket describes implementation work.** Do not emit overview, background, or context tickets that only restate the PRD. If a spec section produces no concrete change to make, no ticket should result from it. Borderline cases (Problems, Goals, Principles, Opportunity sections): only emit a ticket if the AC would be measurable or testable — never "the team understands X."
- **Ignore open questions when writing AC.** Anything the spec flags as unresolved — blockquote asides marked with `>`, items in "Open Questions" or "Design Questions" sections, MVP-scope items marked with `?` — must not appear in build-ticket AC. Track open questions in their own decision-style tickets whose deliverable is "produce a documented decision on X."
- **Don't invent product behavior to reconcile design/spec mismatches.** When a design shows different values, states, or copy than the spec, flag the discrepancy and ask which is authoritative. Do not introduce a feature (e.g. "the rate is per-trip configurable") to make both sides true. Spec wins by default; designs are usually the moving artifact.

## Documentation rules

### ROADMAP.md scope

ROADMAP.md describes what each version delivers for someone using conduit. It is not a changelog or implementation log.

Each item should:
- Name the feature in plain language
- Describe what it accomplishes from the end-user's perspective in a few short sentences — engineering jargon is fine if it reads like English, not commit-speak
- Mention where it lives if useful (config block, file, command) as a quick reference, not a catalog

Do not include:
- Implementation receipts (type signatures, default values, what-was-replaced-with-what)
- Justifications for design decisions — those belong in commits or PR descriptions
- "Why we did it this way" narrative beyond the version's one-line goal
- Back-references to fixes ("fixes the issue from v0.1.x")

The ✅ marker on a heading or item is enough to signal completion. No implementation narrative alongside.

## Conventions

- ESM with .js import extensions
- Interfaces over types for public APIs
- AI prompts return JSON only; strip markdown fences before parsing
- ora spinners for async, chalk for color
- State uses sha256 hashes (first 12 chars)
- v0.2+: log every LLM call with input and output (JSON file; SQLite migration deferred to v0.4)
- Default tone in prompts: concise, direct, no figures of speech, no jargon. User can override but only via Slack from v0.3 onward.
