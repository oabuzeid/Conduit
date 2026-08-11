# Project Status

**Current version:** v0.3.0 — Slack workflow (all phases complete)

## What this codebase contains

The engine (v0.1–v0.2.x) and the product layer (v0.3) are both complete. v0.1–v0.2.x is developer-facing engine work: one-way spec-to-ticket generation, drift detection, Figma audit, the agentic webhook engine, and the capture layer. v0.3 is the first PM-facing surface — a conversational Slack app — and is where the product launches. All four v0.3 phases have shipped. v0.4 (learning loop) is next.

## Engine (v0.1 – v0.2.x) — ✅ complete

**v0.1 — Foundation ✅**
- ✅ Spec parser (markdown → structured sections)
- ✅ AI ticket generation
- ✅ Linear integration
- ✅ Jira integration
- ✅ Figma comment posting on generate
- ✅ State tracking with content hashes
- ✅ Drift detection (`conduit sync`)
- ✅ Figma audit (`conduit audit`)
- ✅ GitHub Action for PR sync checks
- ✅ Pluggable provider interface for forkers

**v0.1.x — Engine UX improvements ✅**
- ✅ Configurable ticket breakdown (`by_section` | `by_layer` | `by_component` | `custom`; stories are the atomic unit — no subtasks emitted)
- ✅ Project-level acceptance criteria format (`ac_format`: format type, include_background, include_figma_links — no artificial cap on AC count)
- ✅ Default opinionated tone hard-coded in AI engine prompts (also encodes the three ticket-writing rules from CLAUDE.md)
- ✅ Per-project significant-change threshold for Figma (consumed by v0.2's design-side classifier)

**v0.2 — Agentic engine + capture layer ✅**
- ✅ Reverse-direction analysis (ticket changes → spec diff) — covers edited, created, deleted
- ✅ Spec PR generator
- ✅ Investigation agent (LLM directs control flow on webhook receipt)
- ✅ Webhook listener service (`conduit serve --port 3000`; Jira / GitHub / Figma handlers; HMAC verification optional)
- ✅ Merge-propagation
- ✅ Loop prevention (tag-based; hash-based attribution deferred)
- ✅ Artifact capture layer (JSON file logging; SQLite migration deferred to v0.4)
- ✅ Design-side change classifier (structural pre-filter + Claude semantic classification of Figma webhook events)

**v0.2.x — Engine follow-ups ✅**
- ✅ Per-project ticket routing (`routes` block in conduit.yaml; stories inherit parent epic's project)
- ✅ PRD ambiguity scanner (`conduit scan`)
- ✅ Acceptance criteria regression detector (runs during `conduit sync`)
- ✅ Frame/ticket → spec section auto-mapping
- ✅ Async webhook processing (handlers respond 202 in ~20ms; chain runs in background)

## v0.3 — Slack workflow — ✅ complete

The product launches here. v0.3 was phased A→D in code. All phases have shipped.

**Phase A — Slack app scaffold ✅**
- ✅ Bolt app + ExpressReceiver host, mounted on the `conduit serve` server
- ✅ `/conduit` slash command (`ping`, `help`)

**Phase B — agentic thread conversation ✅**
- ✅ `@conduit` mention starts a conversational session in-thread (tool-using agent, not a wizard)
- ✅ Tools: `ingest_spec` (paste / repo file path / public Google Doc URL), `scan_spec`, `set_destination`, `set_tone`, `attach_context` (Figma links), `generate_tickets`, `update_breakdown`, `push_tickets`
- ✅ Figma frame catalog wired into ticket generation with a strict no-invented-frame-refs guard
- ✅ Post-push ticket edits: `create_jira_ticket`, `change_jira_parent`
- ✅ `save_spec_to_repo` — commits Slack-originated specs to the repo so v0.2 reverse-sync works end-to-end; migrates session state mappings to the real path
- ✅ "Conduit is learning your team's patterns" placeholder text (help menu context block — the v0.4 UI shell)

**Phase C — interactive breakdown UI ✅**
- ✅ `present_breakdown` tool renders the draft as a Block Kit card with Approve & push / Modify buttons
- ✅ Approve button pushes tickets to the provider and resolves the card in-place
- ✅ Modify button invites free-text edits in-thread — the PM types changes and @conduit applies them

**Phase D — Slack-native approval alerts ✅**
- ✅ Spec-PR approval flow: when a Jira ticket change triggers a spec PR, Conduit posts it to the Slack thread with Approve & merge / Request changes buttons
- ✅ Design-change alerts: when the Figma classifier flags a significant change, Conduit posts it with Accept & propagate / Dismiss / Modify buttons
- ✅ Accept & propagate opens a spec PR, auto-merges it, and triggers downstream propagation
- ✅ Alert data stored by ID so button handlers can act on the original event

## v0.4+ — not started

See [ROADMAP.md](ROADMAP.md) for v0.4 (learning loop) and v0.5 (additional surfaces).
