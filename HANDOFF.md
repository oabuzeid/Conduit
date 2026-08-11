# Handoff — resuming conduit

_Updated 2026-08-11 after completing v0.3. Read this together with `STATUS.md` (granular tracker) and `ROADMAP.md` (version-level plan)._

## TL;DR

**v0.3 is complete.** All four phases (A–D) are committed and pushed. The engine (v0.1–v0.2.x) and the product layer (v0.3 Slack workflow) are live.

v0.3 landed across four feature commits, ending with `41a5c6a` (Phase D — Slack-native spec-PR and design-change approval alerts). Everything since is documentation. Run `git log --oneline -5` for the current tip rather than trusting a SHA written here.

## Where the project stands

| Version | What | Status |
|---------|------|--------|
| v0.1 | Foundation: CLI, spec parser, AI generation, Linear + Jira + Figma | ✅ |
| v0.1.x | Engine UX: breakdown modes, AC format, tone, Figma threshold | ✅ |
| v0.2 | Agentic engine: reverse analyzer, spec PRs, agent, webhooks, classifier | ✅ |
| v0.2.x | Engine follow-ups: routing, ambiguity scanner, AC regression | ✅ |
| v0.3 | Slack workflow: conversational agent, breakdown buttons, approval alerts | ✅ |
| v0.4 | Learning loop: structured diffs, pattern aggregation, eval harness | ❌ not started |
| v0.5 | Additional surfaces: Tauri, browser extension, Notion | ❌ not started |

## v0.3 summary

The Slack app is the product. A PM @mentions Conduit in a thread, pastes or uploads a spec, and Conduit:

1. Scans for ambiguity
2. Generates a ticket breakdown
3. Shows it as a Block Kit card with Approve & push / Modify buttons
4. Pushes tickets to Jira or Linear on approval

When external changes happen:
- Jira ticket edits → spec PR → Slack alert with Approve & merge / Request changes
- Figma design changes → classifier → Slack alert with Accept & propagate / Dismiss / Modify

## Next steps

v0.4 (learning loop) is intentionally scoped after v0.3 because the learning loop needs real usage data. Key components:

1. Structured diff layer — field-level draft vs. final comparison
2. Pattern aggregator — weekly top-edit-pattern surfacing
3. Eval harness — (spec, expected ticket) pairs; prompt changes validated before shipping
4. Self-improvement — propose prompt updates from patterns, eval-gated, user-approved

## Conventions worth preserving

- **`ROADMAP.md` is version-level.** Whole versions get ✅ on the heading; items stay high-level.
- **`STATUS.md` is the granular tracker.** Phase-by-phase detail belongs here.
- **`CHANGELOG.md` follows Keep a Changelog format.** One entry per version.
- **`src/slack/commands/help.ts` is user-visible.** Real PMs read it — update when capabilities change.
- **Mark in-progress work honestly** (`🚧`) rather than rounding up to ✅.
- **Keep ROADMAP.md, STATUS.md, and GitHub in sync** with every code change.
- Ticket generation has a strict **no-invented-frame-refs guard** (`f67c4fd`) — don't loosen it.
