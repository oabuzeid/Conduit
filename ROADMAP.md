# Roadmap

This document describes why specbot exists, how it is phased, and where it is going. Read this first if you want to understand the project direction or are considering a fork.

## The problem

Product teams maintain three systems that should agree but rarely do:

- The spec — the PRD
- The tickets — Linear, Jira, the engineering work breakdown
- The designs — Figma frames and components

When any one changes, the others fall out of date. The PM updates the spec and tickets do not reflect it. The designer or PM iterates in Figma and the spec does not capture it. An engineer changes a ticket's scope and nobody updates the spec or design.

Existing tools take one of two approaches:

One-way generators (PRD → tickets) become inconsistent as soon as the spec changes. Tickets fall out of date after a PRD change.

Omnidirectional sync (every system writes to every other) creates conflicts that have no clear resolution. When the spec says "3-step wizard", Figma shows 2 steps, and the ticket says 4 — which one wins? You get either silent overwrites or a custom merge UI, and a merge UI is its own product.

## The specbot approach

Route every change through the spec.

Any side can propose changes. A ticket edit in Linear, a frame change in Figma — specbot detects it and opens a PR against the spec file in your repo. The PM reviews the spec PR, decides what is authoritative, and merges. Once merged, specbot propagates the change to the other sides.

This gives bidirectional awareness without ambiguous conflicts. The spec PR is the human review step. The rest is automation.

## Why this is hard to build as a chat workflow

If Claude has Linear, Jira, and Figma MCP connectors, why build a separate tool? Conversations can't:

- Run continuously without human prompting (webhook listeners)
- Open PRs in response to a webhook firing
- Maintain state across sessions (which spec sections map to which tickets)
- Run in CI (a GitHub Action can't open a Claude session)
- Be installed and configured by other teams without prompting expertise

The CLI in v0.1 does ticket generation, which Claude can do directly. The persistent service in v0.2 is what makes specbot different. v0.1 is the basis. v0.2 is the sync engine.

## Phasing

### v0.1 — Foundation (current)

Goal: build the baseline that v0.2 will use.

This phase ships the spec parser, AI generation pipeline, pluggable provider interface, state tracking, and basic drift detection. It also ships a working CLI so the project is useful on its own, even before the bidirectional sync engine exists.

What's built:

- Spec parser (markdown → structured sections)
- AI ticket generation with acceptance criteria
- Pluggable `TicketProvider` interface (Linear and Jira implemented)
- Figma comment posting on generate
- State tracking with sha256 content hashes
- Drift detection (`specbot sync`)
- Figma audit (`specbot audit`)
- GitHub Action for sync checks on PRs

What v0.1 does not do:

- React to changes in tickets or Figma automatically
- Open spec PRs when downstream systems change
- Run as a continuous service
- Anything bidirectional

This is by design. v0.1 validates the AI quality, the integration layer, and the state model before the bidirectional logic is added.

### v0.2 — The sync engine (next)

Goal: build the spec-arbitrated sync engine.

v0.1 components are reused. New components are added.

Build order:

1. **Reverse-direction analyzer** (`src/core/reverse-analyzer.ts`) — given a ticket and its mapped spec section, produce a markdown diff describing how they've diverged.

2. **Spec PR generator** (`src/core/spec-pr.ts`) — apply the diff to the spec file, open a GitHub PR with the source (which ticket, which Figma frame) as PR context. Uses Octokit.

3. **Webhook listener service** (`src/server/`) — Express server with three endpoints (`/webhook/linear`, `/webhook/jira`, `/webhook/figma`). On webhook receipt, look up the spec mapping, run reverse analyzer, generate spec PR. New CLI command: `specbot serve --port 3000`. Deployable as Docker container or to Cloud Run / Fly.io.

4. **Merge-propagation** — listen for `pull_request.closed` events on spec PRs. When a specbot-opened PR merges, run `generate` to propagate the change to other sides. Update state.json with new content hashes.

5. **Loop prevention** — tag every change specbot makes with a hash in metadata. Skip processing webhooks for changes specbot itself just wrote. Partial groundwork is already in state.json.

Design choices for v0.2:

- Spec as merge point is the design choice that defines specbot. Letting Linear webhooks update the spec directly, without a PR, would remove the human review step. The PR is required.

- GitHub PRs as the merge UI. Specbot does not build a custom merge tool. PRs already have review, comments, line-level diffs, and CI hooks.

- Stateless reverse analyzer. The analyzer is a pure function: take a ticket and a spec section, return a diff. State lives in `.specbot/state.json` and the spec's git history.

### v0.3 — Delivery surface

Goal: make the v0.2 engine usable without a terminal.

Planned:

- Slack notifications when spec PRs are opened, with action buttons (approve, request changes, dismiss).
- Tauri menu bar app that triggers sync manually, shows recent activity, and notifies when a spec PR is waiting.
- Browser extension to trigger sync from Linear, Jira, or Figma pages directly.
- Notion as a spec source — read PRDs from Notion in addition to or instead of markdown files in a repo.

The engine is the product. This phase makes it accessible.

### Beyond v0.3

Open questions:

- Spec quality scoring. Before generating tickets, audit the spec for ambiguity, missing edge cases, and undefined terms.
- Decision log generation. Read ticket comments and Figma comments. Extract decisions ("we're going with option B because X") and write them to a `decisions/` folder as ADRs.
- Roadmap reality checker. Compare the stated roadmap against actual ticket flow and PR rate. Show where reality has diverged from intent.

These share the same approach: PM tools that maintain state and run continuously. Whether they belong in specbot or in separate forks is open.

## Why specbot is designed to be forked

The core idea (spec as merge point) is general. The implementation choices (Linear, Jira, Figma, markdown specs in git) are specific. Different teams will want different combinations:

- A startup might want Notion specs, Linear tickets, and Penpot designs
- An enterprise might need Confluence specs, Jira tickets, and Sketch
- A solo founder might want markdown specs and only Linear, no design tool

The pluggable provider interface (`src/integrations/types.ts`) makes a fork a small change, not a rewrite. The same pattern extends to spec sources and design tools.

If your team needs something that does not exist yet: fork, implement the interface, and contribute the change back if it is general.
