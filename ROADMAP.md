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

Over time, Conduit logs how teams edit its outputs, identifies patterns, and proposes prompt updates that pass an eval harness before shipping.

## Why this isn't replaceable by a Claude conversation with MCPs

A Claude chat with Linear/Figma MCPs can generate tickets. It cannot:

- Run continuously without human prompting (webhook listener)
- Open PRs as a side-effect of a webhook
- Maintain state across sessions
- Run in CI
- Log every interaction and learn from edits over time
- Be installed by other teams without prompting expertise

v0.1 (one-way generation) is replaceable. v0.2 and beyond are not.

## Phasing

v0.1 through v0.2 are engine work for developers. v0.3 is the first phase a real PM will use. v0.4 adds learning on top of v0.3's usage data. v0.5 adds more user surfaces.

### v0.1 — Foundation ✅

Audience: developer building or forking the project.

Goal: A working CLI that generates tickets from a spec and detects drift. Validates the AI quality and integration layer before adding agentic logic.

Components:
- Spec parser (markdown → structured sections)
- AI ticket generation
- Pluggable `TicketProvider` interface (Linear, Jira)
- Figma comment posting
- State tracking with content hashes
- Drift detection (`conduit sync`)
- Figma audit (`conduit audit`)
- GitHub Action for PR sync checks

### v0.1.x — Engine improvements ✅

Audience: developer.

Goal: Address known gaps in v0.1's flexibility before adding agentic logic on top. These changes establish the configuration surface that v0.2's agent will operate over.

Components:

1. **Configurable ticket breakdown** — Choose how conduit organizes generated tickets per project. `by_section` mirrors the spec's heading structure (the original behavior). `by_layer` groups stories by execution layer — backend, frontend, design — so each layer's work lives in its own ticket. `by_component` groups by UI or system component, bundling backend + frontend + design work per component into a single story. `custom` lets you describe the grouping rule in your own words. Set under `ai.breakdown.mode` in conduit.yaml. Stories are the atomic unit; engineers decide how to split a story into tasks themselves.

2. **Project-level acceptance criteria format** — Decide once per project how acceptance criteria should be written, instead of re-specifying it in every spec. Pick the format (Given/When/Then, plain bullets, or numbered list), choose whether AC may restate story context, and choose whether AC reference Figma frame names. Set under `ai.ac_format` in conduit.yaml.

3. **Default tone and ticket-writing rules baked into the AI prompt** — Tickets come out concise and consistent without prompt-tuning each run. The prompt now enforces: every ticket describes real implementation work (no "overview" or "background" tickets that just restate the PRD); spec sections that are explicit lists of open questions ("Design Questions," "Open Questions") become one "decide and document this" ticket per question, rather than build tickets that guess at answers; and acceptance criteria exclude anything the spec marks as unresolved. This removes most of the manual cleanup the first generation run typically required.

4. **Per-project significant-change threshold for Figma** — Define what counts as a Figma change worth surfacing — minimum frames added, minimum frames removed, minimum characters of text changed, and whether to ignore changes inside nested components. Set under `design.significant_change_threshold` in conduit.yaml. Consumed by v0.2's design-side classifier, so day-to-day design tweaks don't trigger alerts.

### v0.2 — Agentic engine + capture layer

Audience: developer.

Goal: Make the LLM the orchestrator. Log every interaction so v0.4's learning loop has data to work with.

Components:

1. **Reverse-direction analyzer** (`src/core/reverse-analyzer.ts`) — given a ticket and its mapped spec section, produce a markdown diff describing how they've diverged.

2. **Spec PR generator** (`src/core/spec-pr.ts`) — apply the diff to the spec file, open a GitHub PR with PM-grade descriptions: source (which ticket, which Figma frame), what changed, what Conduit will propagate after merge. Uses Octokit.

3. **Investigation agent** (`src/core/agent.ts`) — when a webhook fires, the LLM decides the action: open a PR now, batch with other recent changes, ping the PM in Slack, or pause for loop detection. This is the agentic component. Its input contract must be designed together with #8's output contract before either is built — see note below.

4. **Webhook listener service** (`src/server/`) — Express server with `/webhook/linear`, `/webhook/jira`, `/webhook/figma` endpoints. New CLI: `conduit serve --port 3000`. Deployable to Cloud Run or Fly.io.

5. **Merge-propagation** — listen for `pull_request.closed` events. When a Conduit-opened PR merges, run downstream sync.

6. **Loop prevention** — tag every change Conduit makes (in the ticket label set, the PR description, and Figma comments) with a fixed marker. Skip processing webhooks for changes carrying that marker. Tag-based is simpler than full hash attribution and sufficient for v0.2; hash-based attribution can come later if needed.

7. **Artifact capture layer** — every run writes a job record to a local JSON file: full spec context, prompt sent to Claude, raw response, draft tickets, post-edit ticket state 24-48h later. No learning logic — just disciplined logging. v0.4 migrates this to SQLite when the learning loop is built.

8. **Design-side change classifier** — hybrid structural + semantic diffing for Figma webhook events. A structural pre-filter detects added frames, removed frames, and material text changes; anything that passes the per-project threshold (set in v0.1.x) is sent to Claude for semantic classification: `new_screen_added`, `screen_removed`, `significant_copy_change`, or `ignore`. Outputs a structured change description that feeds the investigation agent (#3). Keeps Claude off the cheap-to-detect cases and reserves it for the judgment calls. Its output contract must be designed together with #3's input contract before either is built — see note below.

**Design note: #3 and #8 share a contract.** The classifier's output is the agent's input. If they're designed separately, the agent will end up either over-prompting (re-classifying what the classifier already decided) or under-informed (missing the structured fields it needs to route). Before building either, sketch the JSON shape that #8 emits and #3 consumes — what fields, what enum values, what's required vs. optional. Treat the contract as the first artifact of v0.2.

v0.2 stays CLI- and YAML-only. No user-facing surface.

### v0.2.x — Engine follow-ups

Audience: developer.

Goal: Quality and configurability improvements layered on top of v0.2. Scoped after v0.2 ships so the agentic loop lands first and these don't block it.

Components:

1. **Multi-destination ticket routing** — `conduit.yaml` supports per-spec or per-section ticket destinations. State model tracks destination per ticket, not per project. Useful once one Conduit instance serves multiple teams.

2. **PRD ambiguity scanner** — pre-generation step that flags vague verbs ("automatically," "smoothly"), undefined terms, missing edge cases, and conflicting requirements between sections. Runs before `generate` so the PM can tighten the spec first.

3. **Acceptance criteria regression detector** — when a ticket is edited externally, compare new AC against the original. Flag any that were weakened or removed. Runs during `sync`.

### v0.3 — Slack workflow (the product launches here)

Audience: real PMs using the product for the first time.

Goal: Make Conduit usable by non-technical PMs through a conversational Slack interface. This is the phase where Conduit stops being engine work and starts being a product.

Components:

1. **Conduit Slack app** — OAuth flow, slash commands (`/conduit start`, `/conduit continue`), interactive components, event subscriptions, message threading.

2. **Project setup flow** — user starts a thread, Conduit asks for the spec (paste, file upload, or repo link), proposes a breakdown, asks where tickets should go, asks for AC format preferences, asks for any extra context (Figma links, PDFs, external docs).

3. **Breakdown preview and edit** — Conduit proposes the ticket breakdown in the thread. User can approve, modify ("split by backend/frontend"), or rewrite individual ticket titles before generation.

4. **Destination selection** — user picks which Linear team or Jira project the tickets should be created in. Conduit remembers per-project defaults.

5. **Context attachment** — user can paste Figma links, attach PDFs, drop Slack message links. Conduit ingests these as extra context for ticket generation.

6. **Confirmation and follow-up** — Conduit posts a confirmation with links to created tickets. User can request edits, additions, or full regeneration from the same thread.

7. **Spec PR approval flow** — when v0.2's agent proposes a spec PR, the user approves or requests changes in Slack rather than via GitHub UI.

8. **Tone override** — user can change tone from the Slack thread ("make these more concise"). Default tone remains opinionated.

9. **"Conduit is learning your team's patterns" placeholder** — surface a weekly thread message even before the actual learning loop is wired up. This is the UI shell v0.4 will attach real learning to. Keeps the product feeling alive and gives users a touchpoint for the eventual learning features.

10. **Design-change Slack alerts** — when v0.2's classifier surfaces a significant Figma change, Conduit posts to the relevant project thread with a one-line summary and the structured change description. Three actions: accept and propagate (Conduit opens a spec PR and, after merge, updates the affected tickets), dismiss (suppress this change), or modify (edit the proposed spec change before propagation). This is the first time a real PM sees the design-side sync loop close end-to-end.

v0.3 is the most important release. It's the only phase a non-technical PM will ever touch. The success of the project depends on how good v0.3 feels to use.

### v0.4 — Learning loop on captured data

Audience: PMs (invisible — surfaces through v0.3's UI shell).

Goal: Make Conduit measurably better over time using the data v0.2 captured and v0.3 generated through real usage.

This phase is intentionally scoped *after* v0.3 because the learning loop has nothing useful to learn from until real teams are interacting with the product. Building it earlier would mean aggregating patterns from test runs, which is noise, not signal.

Components:

1. **Structured diff layer** — field-level comparison between Conduit's draft and the final ticket after team edits. Title, description, AC, labels.

2. **Pattern aggregator** — weekly job that surfaces top edit patterns to v0.3's UI shell. "I noticed 3 patterns. Want me to adjust? [Apply] [Reject]."

3. **Eval harness** — held-out set of (spec, expected ticket) pairs. Every prompt change runs against the eval before shipping. Without this, the learning loop drifts and quality degrades silently.

4. **Self-improvement mechanism** — propose prompt updates from aggregated patterns. Validate via eval. Surface to user for approval before shipping.

5. **Meeting transcript ingestion** — drop a Granola, Otter, or Zoom transcript into Conduit (via Slack file upload). Agent extracts decisions, proposes spec updates, flags decisions that contradict existing spec content.

6. **Decision log auto-generation** — agent watches Slack channels and ticket comments. Detects decision phrases ("we're going with option B," "punting to Q2"). Writes structured ADRs to a `decisions/` folder.

7. **Stakeholder summary generator** — weekly digest of changes across all projects, in three flavors: leadership, engineering, design.

8. **Stale work detector with action proposals** — agent finds tickets that haven't moved in N days, reads the ticket, checks linked PRs and Slack mentions, proposes specific actions.

9. **Roadmap reality checker** — compares stated roadmap against actual ticket flow and PR velocity.

### v0.5 — Additional user surfaces

Audience: PMs who want surfaces beyond Slack.

Goal: Make Conduit accessible in more places.

- Tauri menu bar app for manual sync and recent activity
- Browser extension to trigger Conduit from Linear, Jira, or Figma pages
- Notion as a spec source (read PRDs from Notion alongside markdown)

## Why this is designed to be forked

The thesis (spec as merge point, agent-directed routing, learning loop) is general. The implementation choices (Linear, Jira, Figma, markdown, SQLite, Slack) are specific. Teams will want different combinations:

- A startup might want Notion specs, Linear tickets, Figma designs
- A team on Atlassian stack might need Confluence specs and Jira tickets
- A solo founder might want HTML specs and Linear only

The pluggable provider interface (`src/integrations/types.ts`) makes adding a new system a one-hour job. Same pattern extends to spec sources, design tools, and decision sources.
