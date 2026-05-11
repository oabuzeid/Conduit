# Project Status

**Current version:** v0.1.0 — Foundation phase

## What this codebase contains

This repository contains v0.1 only. v0.1 is a working CLI for one-way spec-to-ticket generation, drift detection, and Figma audit.

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

**v0.2 — Agentic sync engine + capture layer:**
- ❌ Investigation agent (LLM directs control flow on webhook receipt)
- ❌ Reverse-direction analysis (ticket changes → spec diff)
- ❌ Spec PR generator
- ❌ Webhook listener service
- ❌ Merge-propagation
- ❌ Loop prevention
- ❌ PRD ambiguity scanner
- ❌ Acceptance criteria regression detector
- ❌ Artifact capture layer (logs all LLM interactions for v0.3)

**v0.3 — Learning loop + cross-tool extraction:**
- ❌ Structured diff layer
- ❌ Pattern aggregator
- ❌ Eval harness
- ❌ Self-improvement loop
- ❌ Meeting transcript ingestion
- ❌ Decision log auto-generation
- ❌ Stakeholder summary generator
- ❌ Stale work detector with action proposals
- ❌ Roadmap reality checker

**v0.4 — Delivery surface:**
- ❌ Slack notifications and quick-action buttons
- ❌ Tauri menu bar app
- ❌ Browser extension
- ❌ Notion as a spec source

The agentic sync engine described in the README is v0.2 and v0.3. v0.1 is the working baseline they will be built on.

## Why v0.1 ships standalone

v0.1 is independently useful: it generates tickets from specs, posts Figma comments, and detects drift. Teams can use it today as a one-way generator with manual sync checks.

Shipping v0.1 alone validates the AI quality, integration layer, and state model before adding the agentic and learning logic on top.

## v0.2 status

Not started. See [ROADMAP.md](ROADMAP.md) for the full build order.
