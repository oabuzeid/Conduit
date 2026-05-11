# Roadmap

## Problem

Product teams maintain three systems that should agree but rarely do:

- The spec (PRD, markdown doc)
- The tickets (Linear, Jira)
- The designs (Figma)

When one changes, the others go stale. Existing tools either generate tickets one-way from a spec (and stop syncing once the spec changes) or try to sync everything to everything (which creates conflicts when three sources can all write to each other).

## Approach

Route every change through the spec as a merge point. Use an LLM agent to direct the routing.

When a ticket or design changes, the agent decides whether to open a spec PR immediately, batch the change with other recent changes, ask the PM in Slack for clarification, or pause if it detects a possible loop. The PM reviews and merges spec PRs. After merge, downstream sync updates the other systems.

Over time, conduit logs how teams edit its outputs, identifies patterns, and proposes prompt updates that pass an eval harness before shipping.

## Why this isn't replaceable by a Claude conversation with MCPs

A Claude chat with Linear/Figma MCPs can generate tickets. It cannot:

- Run continuously without human prompting (webhook listener)
- Open PRs as a side-effect of a webhook
- Maintain state across sessions
- Run in CI
- Log every interaction and learn from edits over time
- Be installed by other teams without prompting expertise
  

## Phasing

### v0.1 — Foundation (built)

Goal: A working CLI that generates tickets from a spec and detects drift. Validates the AI quality and integration layer before adding agentic logic.

Built:
- Spec parser (markdown → structured sections)
- AI ticket generation
- Pluggable `TicketProvider` interface (Linear, Jira)
- Figma comment posting
- State tracking with content hashes
- Drift detection (`conduit sync`)
- Figma audit (`conduit audit`)
- GitHub Action for PR sync checks

Deliberately not in v0.1:
- Reaction to ticket or Figma changes
- Spec PR generation
- Continuous service
- Anything bidirectional or agentic

### v0.2 — Agentic sync engine + capture layer

Goal: Make the LLM the orchestrator. Log every interaction so v0.3 has training data.

Build order:

1. **Reverse-direction analyzer** (`src/core/reverse-analyzer.ts`) — given a ticket and its mapped spec section, produce a markdown diff describing how they've diverged.

2. **Spec PR generator** (`src/core/spec-pr.ts`) — apply the diff to the spec file, open a GitHub PR with PM-grade descriptions: source (which ticket, which Figma frame), what changed, what conduit will propagate after merge. Uses Octokit.

3. **Investigation agent** (`src/core/agent.ts`) — when a webhook fires, the LLM decides the action: open a PR now, batch with other recent changes, ping the PM in Slack, or pause for loop detection. This is the agentic component.

4. **Webhook listener service** (`src/server/`) — Express server with `/webhook/linear`, `/webhook/jira`, `/webhook/figma` endpoints. New CLI: `conduit serve --port 3000`. Deployable to Cloud Run or Fly.io.

5. **Merge-propagation** — listen for `pull_request.closed` events. When a conduit-opened PR merges, run downstream sync.

6. **Loop prevention** — tag every change conduit makes with a hash. Skip processing webhooks for changes conduit just wrote.

7. **PRD ambiguity scanner** — pre-generation step that flags vague verbs ("automatically," "smoothly"), undefined terms, missing edge cases, and conflicting requirements between sections.

8. **Acceptance criteria regression detector** — when a ticket is edited externally, compare new AC against the original. Flag any that were weakened or removed.

9. **Artifact capture layer** — every run writes a job folder: full spec context, prompt sent to Claude, raw response, draft tickets, post-edit ticket state 24-48h later. Stored in SQLite. No learning logic yet — just disciplined logging. v0.3 will use this data.

### v0.3 — Learning loop + cross-tool extraction

Goal: Conduit gets measurably better over time. Extends to meetings, Slack, and decisions across the full product surface.

Components:

1. **Structured diff layer** — field-level comparison between draft and final ticket. Title, description, AC, labels.

2. **Pattern aggregator** — weekly job that posts to Slack or Linear: "I noticed 3 patterns in how your team edits my tickets. Want me to adjust? [Show diff] [Apply] [Reject]."

3. **Eval harness** — held-out set of (spec, expected ticket) pairs. Every prompt change runs against the eval before shipping.

4. **Self-improvement loop** — propose prompt updates from aggregated patterns. Validate via eval. Surface to user for approval before shipping.

5. **Meeting transcript ingestion** — drop a Granola, Otter, or Zoom transcript into conduit. Agent extracts decisions, proposes spec updates, flags decisions that contradict existing spec content. Highest-impact v0.3 feature.

6. **Decision log auto-generation** — agent watches Slack channels and ticket comments. Detects decision phrases ("we're going with option B," "punting to Q2"). Writes structured ADRs to a `decisions/` folder.

7. **Stakeholder summary generator** — weekly digest of changes across all projects, in three flavors: leadership, engineering, design.

8. **Stale work detector with action proposals** — agent finds tickets that haven't moved in N days, reads the ticket, checks linked PRs and Slack mentions, proposes specific actions ("close as obsolete," "ping engineer X," "merge with ticket Y").

9. **Roadmap reality checker** — compares stated roadmap against actual ticket flow and PR velocity. Outputs honest assessments: "you committed to X this quarter, 30% of those tickets are in progress, 2 linked PRs are stalled."

### v0.4 — Delivery surface

Goal: Make v0.2 and v0.3 features accessible without a terminal.

- Slack notifications and quick-action buttons (approve, request changes, dismiss spec PRs)
- Tauri menu bar app for manual sync and recent activity
- Browser extension to trigger sync from Linear, Jira, or Figma pages
- Notion as a spec source

## Why this is designed to be forked

The thesis (spec as merge point, agent-directed routing, learning loop) is general. The implementation choices (Linear, Jira, Figma, markdown, SQLite) are specific. Teams will want different combinations:

- A startup might want Notion specs, Linear tickets, Claude designs
- An enterprise might need Confluence, Jira, Figma
- A solo founder might want markdown specs and Linear only

The pluggable provider interface (`src/integrations/types.ts`) makes adding a new system a one-hour job. Same pattern extends to spec sources, design tools, and (in v0.3) decision sources.
