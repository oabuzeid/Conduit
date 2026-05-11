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
  commands/
    init.ts                   — scaffold config + example spec
    generate.ts               — specs → AI → tickets + Figma comments
    sync.ts                   — drift detection
    audit.ts                  — Figma vs spec comparison
  core/
    config.ts                 — YAML config loader
    spec-parser.ts            — markdown → structured sections
    ai-engine.ts              — Claude API (generate, drift, audit)
    state.ts                  — .conduit/state.json mapping with content hashes
  integrations/
    types.ts                  — TicketProvider interface
    registry.ts               — provider name → implementation
    linear-provider.ts        — Linear GraphQL
    jira-provider.ts          — Jira REST v3
    figma.ts                  — Figma API (read tree, post comments)
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
```

## Env vars

ANTHROPIC_API_KEY (required), LINEAR_API_KEY (Linear), JIRA_HOST + JIRA_EMAIL + JIRA_API_TOKEN (Jira), FIGMA_ACCESS_TOKEN (Figma)

## Roadmap

See ROADMAP.md for the full version. Build order summary below.

The phases are organized around audience. v0.1 through v0.2 are engine work for developers. v0.3 is the first phase a real product team can use. v0.4 adds learning on top of v0.3's usage data. v0.5 adds more user surfaces.

### v0.1.x — Engine UX improvements (next, small release)

Audience: developer.

1. Configurable ticket breakdown — `breakdown` config: `by_section`, `by_layer`, `by_component`, `custom`. This becomes the action space the v0.2 agent operates over.
2. Project-level acceptance criteria format — replace `detail_level` with `ac_format` object (include_background, include_figma_links, format, max_count). Configured once per project, not per ticket.
3. Default opinionated tone hard-coded in AI engine prompts. Override available in YAML but not in example config.
4. Per-project significant-change threshold for Figma — `conduit.yaml` config. Consumed by v0.2's design-side change classifier to decide which Figma changes are worth surfacing.

### v0.2 — Agentic engine + capture layer

Audience: developer. No user-facing surface.

1. Reverse-direction analyzer (`src/core/reverse-analyzer.ts`) — ticket diff vs. mapped spec section
2. Spec PR generator (`src/core/spec-pr.ts`) using Octokit — PM-grade PR descriptions
3. Investigation agent (`src/core/agent.ts`) — LLM directs control flow on webhook events
4. Webhook listener service (`src/server/`) — Express, `/webhook/linear`, `/webhook/jira`, `/webhook/figma`. CLI: `conduit serve --port 3000`
5. Multi-destination ticket routing — per-spec or per-section destinations
6. Merge-propagation — listen for spec PR merges, run downstream sync
7. Loop prevention — hash-based change attribution
8. PRD ambiguity scanner — pre-generation step
9. AC regression detector — flag weakened acceptance criteria
10. Artifact capture layer — every run logged to SQLite. No learning yet, just capture. v0.4 will use this.
11. Design-side change classifier — hybrid structural + semantic diffing for Figma webhook events. Structural pre-filter (added/removed frames, material text changes) gates a Claude classification call: `new_screen_added`, `screen_removed`, `significant_copy_change`, or `ignore`. Threshold set per project in v0.1.x. Feeds the investigation agent.

### v0.3 — Slack workflow (the product launches here)

Audience: real PMs. This is the most important phase.

1. Conduit Slack app — OAuth, slash commands, interactive components, event subscriptions
2. Project setup flow — start a thread, paste spec, Conduit asks the configuration questions
3. Breakdown preview and edit — Conduit proposes, user approves or modifies in thread
4. Destination selection — user picks Linear team or Jira project
5. Context attachment — Figma links, PDFs, external docs ingested as extra context
6. Confirmation and follow-up — links to created tickets, edit requests from thread
7. Spec PR approval flow — v0.2's agent proposes spec PRs; user approves in Slack
8. Tone override from Slack — default tone stays opinionated; user can override
9. "Conduit is learning your team's patterns" placeholder — UI shell for v0.4
10. Design-change Slack alerts — when v0.2's classifier flags a significant Figma change, surface it in the project thread. Actions: accept and propagate (spec PR + downstream ticket updates), dismiss, or modify before propagation.

v0.3 success determines project success. It's the only phase non-technical PMs touch.

### v0.4 — Learning loop on captured data

Audience: PMs (invisible — surfaces through v0.3's UI shell).

Scoped after v0.3 because the learning loop needs real usage data. Building it earlier would mean aggregating patterns from test runs (noise, not signal).

1. Structured diff layer — field-level draft vs. final comparison
2. Pattern aggregator — weekly job surfaces top edit patterns via v0.3's UI shell
3. Eval harness — held-out (spec, expected ticket) pairs; every prompt change must pass before shipping
4. Self-improvement mechanism — propose prompt updates from patterns, eval-gated, user-approved
5. Meeting transcript ingestion (via Slack file upload) — Granola/Otter/Zoom → extracted decisions → spec PRs
6. Decision log auto-generation — Slack/ticket-comment scanning → ADRs in `decisions/`
7. Stakeholder summary generator — weekly leadership/eng/design digests
8. Stale work detector with action proposals
9. Roadmap reality checker

### v0.5 — Additional user surfaces

Audience: PMs.

- Tauri menu bar app
- Browser extension
- Notion as a spec source

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
- Default tone in prompts: concise, direct, no figures of speech, no jargon. User can override but only via Slack from v0.3 onward.
