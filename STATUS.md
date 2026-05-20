# Project Status

**Current version:** v0.1.0 — Foundation phase

## What this codebase contains

This repository contains v0.1 only. v0.1 is a working CLI for one-way spec-to-ticket generation, drift detection, and Figma audit. It is engine work for developers, not a product PMs would use directly. The product launches in v0.3 (Slack workflow).

## What v0.1 includes

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

## What v0.1 does not include

These are not built yet:

**v0.1.x — Engine UX improvements ✅**
- ✅ Configurable ticket breakdown (`by_section` | `by_layer` | `by_component` | `custom`; stories are the atomic unit — no subtasks emitted)
- ✅ Project-level acceptance criteria format (`ac_format`: format type, include_background, include_figma_links — no artificial cap on AC count)
- ✅ Default opinionated tone hard-coded in AI engine prompts (also encodes the three ticket-writing rules from CLAUDE.md: no context-only tickets, ignore open questions in AC, decision-style tickets for open-question sections)
- ✅ Per-project significant-change threshold for Figma (consumed by v0.2's design-side classifier)

**v0.2 — Agentic engine + capture layer:** ✅
- ✅ Reverse-direction analysis (ticket changes → spec diff)
- ✅ Spec PR generator
- ✅ Investigation agent (LLM directs control flow on webhook receipt) — shares I/O contract with the design-side classifier
- ✅ Webhook listener service (`conduit serve --port 3000`; Jira / GitHub / Figma handlers; HMAC verification optional)
- ✅ Merge-propagation
- ✅ Loop prevention (tag-based; hash-based attribution deferred)
- ✅ Artifact capture layer (JSON file logging; SQLite migration deferred to v0.4)
- ✅ Design-side change classifier (structural pre-filter + Claude semantic classification of Figma webhook events) — shares I/O contract with the investigation agent

**v0.2.x — Engine follow-ups:**
- ❌ Multi-destination ticket routing
- ❌ PRD ambiguity scanner
- ❌ Acceptance criteria regression detector

**v0.3 — Slack workflow (the product launches here):**
- ❌ Conduit Slack app
- ❌ Conversational project setup
- ❌ Breakdown preview and edit
- ❌ Destination selection
- ❌ Context attachment (Figma links, PDFs, external docs)
- ❌ Confirmation and follow-up
- ❌ Spec PR approval flow in Slack
- ❌ Tone override from Slack
- ❌ Learning placeholder UI
- ❌ Design-change Slack alerts (accept/dismiss/modify proposed changes from Figma)

**v0.4 — Learning loop on captured data:**
- ❌ Structured diff layer
- ❌ Pattern aggregator
- ❌ Eval harness
- ❌ Self-improvement loop
- ❌ Meeting transcript ingestion
- ❌ Decision log auto-generation
- ❌ Stakeholder summary generator
- ❌ Stale work detector with action proposals
- ❌ Roadmap reality checker

**v0.5 — Additional user surfaces:**
- ❌ Tauri menu bar app
- ❌ Browser extension
- ❌ Notion as a spec source

The agentic, learning sync engine described in the README is v0.2 through v0.4. v0.1 is the working baseline they will be built on.

## Why v0.1 ships standalone

v0.1 is independently useful: it generates tickets from specs, posts Figma comments, and detects drift. Developers can use it today as a one-way generator with manual sync checks.

Shipping v0.1 alone validates the AI quality, integration layer, and state model before adding the agentic and learning logic on top.

## v0.2 status

Not started. See [ROADMAP.md](ROADMAP.md) for the full build order.
