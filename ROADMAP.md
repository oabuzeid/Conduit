# Roadmap

This document explains the strategy behind specbot — why it exists, how it's phased, and where it's headed. If you're trying to understand the project's direction or considering forking, start here.

## The Problem

Product teams maintain three systems that should agree but rarely do:

- **The spec** — the PRD, the markdown doc, the source of intent
- **The tickets** — Linear, Jira, the engineering work breakdown
- **The designs** — Figma frames and components

When any one changes, the others go stale. The PM updates the spec; tickets don't reflect it. The designer iterates in Figma; the spec doesn't capture it. An engineer modifies a ticket scope; nobody updates the spec or design.

Existing tools take one of two approaches, both of which fall short:

**One-way generators** (PRD → tickets) abandon you the moment the spec changes. They're glorified import scripts.

**Omnidirectional sync** (everything writes to everything) creates impossible conflict resolution. When the spec says "3-step wizard," Figma shows 2 steps, and the ticket says 4 — which one wins? You either get silent overwrites or you build a merge UI, which is its own product.

## The Specbot Thesis

**Route every change through the spec as a deliberate merge point.**

Any side can *propose* changes. A ticket edit in Linear, a frame change in Figma — specbot detects it and opens a PR against the spec file in your repo. The PM reviews the spec PR, decides what's authoritative, and merges. Once merged, downstream sync propagates the change to the other sides.

This is bidirectional awareness without the conflict-resolution chaos. The spec PR is the human checkpoint; the rest is automation.

## Why This Is Hard to Build as a Chat Workflow

A reasonable question: if Claude has Linear, Jira, and Figma MCP connectors, why build a separate tool? The answer is that conversations can't:

- Run continuously without human prompting (webhook listeners)
- Open PRs as a side-effect of a webhook firing
- Maintain state across sessions (which spec sections map to which tickets)
- Run in CI (a GitHub Action can't open a Claude session)
- Be installed and configured by other teams without prompting expertise

The CLI in v0.1 does ticket generation, which Claude can do directly. The persistent service in v0.2 is what makes specbot meaningfully different. v0.1 is the substrate; v0.2 is the actual product.

## Phasing

### v0.1 — Foundation (current)

**Goal:** Build the substrate that v0.2 will sit on top of.

This phase establishes the spec parser, AI generation pipeline, pluggable provider interface, state tracking, and basic drift detection. It also ships a working CLI so the project is immediately useful, even though the architectural USP isn't fully realized yet.

**What's built:**

- Spec parser (markdown → structured sections)
- AI ticket generation with quality acceptance criteria
- Pluggable `TicketProvider` interface (Linear and Jira implemented)
- Figma comment posting on generate
- State tracking with sha256 content hashes
- Drift detection (`specbot sync`)
- Figma audit (`specbot audit`)
- GitHub Action for sync checks on PRs

**What v0.1 deliberately doesn't do:**

- React to changes in tickets or Figma automatically
- Open spec PRs when downstream systems change
- Run as a continuous service
- Anything bidirectional

This is intentional. v0.1 is meant to validate the AI quality, the integration layer, and the state model before adding the harder bidirectional logic on top.

### v0.2 — The actual product (next)

**Goal:** Build the spec-arbitrated sync engine.

This is where specbot becomes meaningfully different from anything else on the market. The v0.1 components are reused; new components are added on top.

**Build order:**

1. **Reverse-direction analyzer** (`src/core/reverse-analyzer.ts`) — given a ticket and its mapped spec section, produce a markdown diff describing how they've diverged.

2. **Spec PR generator** (`src/core/spec-pr.ts`) — apply the diff to the spec file, open a GitHub PR with the source (which ticket, which Figma frame) as PR context. Uses Octokit.

3. **Webhook listener service** (`src/server/`) — Express server with three endpoints (`/webhook/linear`, `/webhook/jira`, `/webhook/figma`). On webhook receipt, look up the spec mapping, run reverse analyzer, generate spec PR. New CLI command: `specbot serve --port 3000`. Deployable as Docker container or to Cloud Run / Fly.io.

4. **Merge-propagation** — listen for `pull_request.closed` events on spec PRs. When a specbot-opened PR merges, run `generate` to propagate the change to other sides. Update state.json with new content hashes.

5. **Loop prevention** — tag every change specbot makes with a hash in metadata. Skip processing webhooks for changes specbot itself just wrote. Partial groundwork is already in state.json.

**Design choices for v0.2:**

- **Spec as merge point** is the architectural choice that defines specbot. We could let Linear webhooks update the spec directly without a PR, but that loses the human review checkpoint. The PR is the feature, not friction.

- **GitHub PRs as the merge UI.** We're not building a custom merge tool. PRs already have review, comments, line-level diffs, and CI hooks. Reusing them keeps specbot focused.

- **Stateless reverse analyzer.** The analyzer should be a pure function: take a ticket + a spec section, return a diff. State lives in `.specbot/state.json` and the spec git history.

### v0.3 — Delivery surface

**Goal:** Make the v0.2 engine accessible without a terminal.

Once the engine works, the surface area for non-technical PMs and designers becomes the focus.

**Planned:**

- **Slack notifications** when spec PRs are opened, with quick-action buttons (approve, request changes, dismiss).
- **Tauri menu bar app** that triggers sync manually, shows recent activity, and pings you when a spec PR is waiting.
- **Browser extension** to trigger sync from Linear, Jira, or Figma pages directly.
- **Notion as a spec source** — read PRDs from Notion instead of (or alongside) markdown files in a repo.

These are all delivery polish. The engine is the product; this phase is about making it accessible.

### Beyond v0.3

Open questions for the long term:

- **Spec quality scoring.** Before generating tickets, audit the spec for ambiguity, missing edge cases, undefined terms. Help PMs catch problems before engineering review.
- **Decision log generation.** Watch ticket comments and Figma comments. Extract decisions ("we're going with option B because X") and write them to a `decisions/` folder as ADRs.
- **Roadmap reality checker.** Compare your stated roadmap against actual ticket flow and PR velocity. Surface where reality has diverged from intent.

These are adjacent ideas that share the same "PM tools that maintain state and run continuously" thesis. Whether they land in specbot or as separate forks is an open question.

## Why Specbot Is Designed to Be Forked

The core thesis (spec as merge point) is general. The implementation choices (Linear, Jira, Figma, markdown specs in git) are specific. Different teams will want different combinations:

- A startup might want Notion specs, Linear tickets, and Penpot designs
- An enterprise might need Confluence specs, Jira tickets, and Sketch
- A solo founder might want markdown specs and just Linear, no design tool

The pluggable provider interface (`src/integrations/types.ts`) is meant to make these forks a one-hour job, not a rewrite. The same applies to spec sources and design tools — the same interface pattern extends naturally to those.

If your team needs something that doesn't exist yet, the fastest path is fork → implement the interface → contribute back if it's general enough.
