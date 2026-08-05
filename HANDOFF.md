# Handoff — resuming conduit

_Generated 2026-08-05, reconstructed from the Jul 26 working session. Read this together with `STATUS.md` (granular tracker) and `ROADMAP.md` (version-level plan)._

## TL;DR

The last session ended **mid-Phase-C, with work uncommitted**. The working tree compiles, but there is one **known inconsistency that will break the Slack agent at runtime** — see [The one thing that's broken](#the-one-thing-thats-broken). Fix that first, then finish Phase C.

Last commit on `main`: `ae1ccd6 feat(v0.3): save_spec_to_repo tool closes the reverse-sync gap` (pushed to `origin/main`, `github.com/oabuzeid/Conduit`).

## Where v0.3 stands

v0.3 (Slack workflow) is the release that matters — it's the first and only phase a non-technical PM actually touches. The ROADMAP defines it as 10 components; the build collapsed those into four phases.

| Phase | What it is | Status |
|-------|-----------|--------|
| **A** | Slack app scaffold, `/conduit ping` / `help` slash commands | ✅ committed |
| **B** | `@conduit` agentic thread conversation, 11 tools (spec ingest from paste/file/Google Doc, scan, destination, tone, Figma context, generate, edit, push, post-push Jira edits, `save_spec_to_repo`) | ✅ committed |
| **C** | Block Kit Approve/Modify buttons on the breakdown preview | 🚧 **in progress, uncommitted** |
| **D** | Slack-native spec-PR approval + design-change alerts (accept/dismiss/modify) | ❌ not started |

Phase C was sequenced before D deliberately: **D reuses C's button-action plumbing.** Keep that order.

Against the ROADMAP's 10 components: 1, 2, 4, 5, 6, 8, 9 are ✅; 3 (breakdown preview + edit) is partial — free-text editing works via `update_breakdown`, buttons are the missing half; 7 and 10 are Phase D.

## Uncommitted working tree

`git status` — nothing here is committed yet:

| File | State |
|------|-------|
| `src/slack/blocks.ts` | **new, untracked.** Exports `renderBreakdownBlocks()` and `renderResolvedBreakdownBlocks()`. Button `action_id`s: `breakdown_approve`, `breakdown_modify`. |
| `src/slack/session.ts` | modified — added `awaiting_approval?: boolean`, set by `present_breakdown` for one turn, read by the app-mention transport, then cleared. Deliberately excluded from the model-visible session summary. |
| `src/slack/tools/index.ts` | modified — added the `present_breakdown` **tool definition**, and reworded `push_tickets` to prefer the button path over a self-initiated push. |
| `STATUS.md` | modified — full rewrite (it previously claimed "this repository contains v0.1 only"). |
| `ROADMAP.md` | modified — v0.3 heading marked `🚧 in progress`. |
| `src/slack/commands/help.ts` | modified — live `/conduit help` menu said "Phase A"; updated to Phase B capabilities. |
| `.claude/agent-memory/` | untracked — senior-code-reviewer notes (`hotspots.md`, `conventions.md`). Decide whether to commit or gitignore. |

`npx tsc --noEmit` passes on this tree.

## The one thing that's broken

`present_breakdown` is **advertised to the model but has no executor.** The tool definition is in `TOOL_DEFINITIONS` (`src/slack/tools/index.ts:84`), but there is no matching `case "present_breakdown":` in the executor switch (`src/slack/tools/index.ts:140-150`). The session was cut off partway through exactly this edit.

Consequence: the conversation agent can and will call `present_breakdown`, and the call falls through the switch. Typecheck doesn't catch it — the definitions array and the switch aren't linked by type. **Don't run the Slack agent against a real PM until this is wired.**

## Next steps, in order

1. **Add the `present_breakdown` executor** — set `session.awaiting_approval = true` and return a short confirmation to the model. Export whatever the button handler needs from `tools/index.ts` (the push path in particular).
2. **Render the buttons.** `renderBreakdownBlocks()` currently has no callers. `src/slack/events/app-mention.ts` needs to check `awaiting_approval`, attach the blocks to the reply, and clear the flag.
3. **Register the action handlers** in `src/slack/app.ts` for `breakdown_approve` and `breakdown_modify`. No `.action()` handlers exist for them today — Approve should run the same push path as `push_tickets`; Modify should invite free-text edits. Re-render with `renderResolvedBreakdownBlocks()` afterward so the buttons don't stay live on a resolved card.
4. **Verify the build, then commit Phase C.**
5. **Phase D** — wire v0.2's spec-PR generator and Figma design-change classifier to post approval alerts into Slack threads instead of running headless.
6. **Update GitHub** to reflect v0.3 status. This was explicitly asked for last session and never happened — the session ended before any commit or push.

## Conventions worth preserving

- **`ROADMAP.md` is version-level.** Whole versions get ✅ on the heading; items stay high-level. No per-item ✅ churn, no implementation receipts.
- **`STATUS.md` is the granular tracker.** Phase-by-phase detail belongs here.
- **`src/slack/commands/help.ts` is user-visible.** Real PMs read it — it drifts stale easily and counts as a doc surface when phases ship.
- **Mark in-progress work honestly** (`🚧`) rather than rounding up to ✅.
- Ticket generation has a strict **no-invented-frame-refs guard** (`f67c4fd`) — don't loosen it when touching generation.
