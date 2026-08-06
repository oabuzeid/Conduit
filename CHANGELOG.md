# Changelog

All notable changes to conduit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for v0.4 — Learning loop on captured data

- Structured diff layer (field-level draft vs. final comparison)
- Pattern aggregator (weekly top-edit-pattern surfacing via the Slack UI shell)
- Eval harness (held-out spec/ticket pairs; every prompt change validated before shipping)
- Self-improvement mechanism (prompt updates from patterns, eval-gated, user-approved)

See [ROADMAP.md](ROADMAP.md) for the full plan.

## [0.3.0] — Slack workflow

The product launches here. Conversational Slack app that lets PMs turn specs into tickets and stay in sync — without leaving Slack.

### Added

- Bolt-based Slack app mounted on the `conduit serve` server
- `/conduit` slash commands: `ping`, `help`, `start`
- `@conduit` mention starts a tool-using conversational agent in-thread
- 12 agent tools: `ingest_spec` (paste / file path / Google Doc URL), `scan_spec`, `set_destination`, `set_tone`, `attach_context`, `generate_tickets`, `update_breakdown`, `present_breakdown`, `push_tickets`, `create_jira_ticket`, `change_jira_parent`, `save_spec_to_repo`
- Figma frame catalog wired into ticket generation with a strict no-invented-frame-refs guard
- Block Kit breakdown card with Approve & push / Modify buttons
- Spec-PR approval alerts: when a Jira change triggers a spec PR, Conduit posts it to the Slack thread with Approve & merge / Request changes buttons
- Design-change alerts: when the Figma classifier flags a significant change, Conduit posts it with Accept & propagate / Dismiss / Modify buttons
- Alert data store so button handlers can act on the original event
- Session lookup by spec file path and Figma file ID for proactive Slack posting
- "Conduit is learning your team's patterns" placeholder (v0.4 UI shell)

## [0.2.1] — Engine follow-ups

### Added

- Per-project ticket routing (`routes` block in conduit.yaml; stories inherit parent epic's project)
- PRD ambiguity scanner (`conduit scan`)
- Acceptance criteria regression detector (runs during `conduit sync`)
- Frame/ticket → spec section auto-mapping
- Async webhook processing (handlers respond 202 in ~20ms; chain runs in background)

## [0.2.0] — Agentic engine + capture layer

### Added

- Reverse-direction analyzer (ticket changes → spec diff; handles edited, created, deleted)
- Spec PR generator (Octokit-based, PM-grade PR descriptions)
- Investigation agent (LLM routes webhook events: open PR, batch, ask PM, or pause for loops)
- Webhook listener service (`conduit serve --port 3000`; Jira / GitHub / Figma handlers)
- Merge-propagation (downstream sync after spec PR merges)
- Loop prevention (tag-based change attribution)
- Artifact capture layer (JSON file logging; SQLite migration deferred to v0.4)
- Design-side change classifier (structural pre-filter + Claude semantic classification)

## [0.1.1] — Engine UX improvements

### Added

- Configurable ticket breakdown (`by_section` | `by_layer` | `by_component` | `custom`)
- Project-level acceptance criteria format (`ac_format` in conduit.yaml)
- Default opinionated tone and ticket-writing rules baked into AI prompts
- Per-project significant-change threshold for Figma

## [0.1.0] — Foundation

Initial release. One-way generation foundation for the spec-arbitrated sync engine.

### Added

- CLI with four commands: `init`, `generate`, `sync`, `audit`
- Markdown spec parser (H1 = epic, H2 = story, checkboxes = tasks)
- AI-powered ticket generation via Claude API
- Pluggable `TicketProvider` interface
- Linear integration (GraphQL)
- Jira integration (REST v3)
- Figma integration (read tree, post comments)
- State tracking with sha256 content hashes (`.conduit/state.json`)
- Drift detection between specs and existing tickets
- Figma audit (compare design tree against spec)
- GitHub Action for auto-sync on PRs touching spec files
- Sample spec for testing (`specs/vehicle-photo-quality.md`)
