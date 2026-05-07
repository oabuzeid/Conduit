# Project status

Current version: v0.1.0 — Foundation phase.

## What is in this codebase

This repository contains v0.1 only. v0.1 is the foundation phase: a CLI for one-way spec-to-ticket generation, drift detection, and Figma audit. It is useful on its own. It is not the full project plan.

## What v0.1 includes

- Spec parser (markdown → structured sections)
- AI-driven ticket generation
- Linear integration
- Jira integration
- Figma comment posting on generate
- State tracking with content hashes
- Drift detection (`specbot sync`)
- Figma audit (`specbot audit`)
- GitHub Action for PR sync checks
- Pluggable provider interface

## What v0.1 does not include

These are not built yet. They are planned for v0.2:

- Reverse-direction analysis (ticket changes → spec diff)
- Automatic spec PR generation
- Webhook listener service
- Continuous, automatic sync
- Merge propagation
- Loop prevention

If you came here for the bidirectional sync engine described in the README, that is v0.2. v0.1 is the basis for it.

## Why ship v0.1 on its own

v0.1 is useful on its own: it generates tickets from specs, posts Figma comments, and detects drift. Teams can use it today as a one-way generator with manual sync checks.

Shipping it on its own also validates the AI quality, the integration layer, and the state model before the bidirectional logic is added.

## When v0.2 ships

v0.2 work has not started yet. See [ROADMAP.md](ROADMAP.md) for phasing and build order.

To track or contribute to v0.2, watch this repository or check the [issues](../../issues) tab.
