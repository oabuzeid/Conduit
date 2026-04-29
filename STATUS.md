# Project Status

**Current version:** v0.1.0 — Foundation phase

## What's in this codebase

This repository contains **v0.1 only**. v0.1 is the foundation phase: a working CLI for one-way spec-to-ticket generation, plus drift detection and Figma audit. It's useful on its own, but it's not the full product vision.

## What v0.1 includes

- ✅ Spec parser (markdown → structured sections)
- ✅ AI-powered ticket generation
- ✅ Linear integration
- ✅ Jira integration
- ✅ Figma comment posting on generate
- ✅ State tracking with content hashes
- ✅ Drift detection (`specbot sync`)
- ✅ Figma audit (`specbot audit`)
- ✅ GitHub Action for PR sync checks
- ✅ Pluggable provider interface for forkers

## What v0.1 does NOT include

These are explicitly **not built** yet — they're in v0.2:

- ❌ Reverse-direction analysis (ticket changes → spec diff)
- ❌ Automatic spec PR generation
- ❌ Webhook listener service
- ❌ Continuous/automatic sync
- ❌ Merge-propagation
- ❌ Loop prevention

If you came here looking for the bidirectional sync engine described in the README — that's v0.2. v0.1 is the substrate it will sit on top of.

## Why ship v0.1 standalone

v0.1 is independently useful: it generates tickets from specs, posts Figma comments, and detects drift. Teams can use it today as a one-way generator with manual sync checks.

Shipping it standalone also lets the AI quality, integration layer, and state model get validated before the harder bidirectional logic gets built on top.

## When v0.2 lands

v0.2 work hasn't started yet. See [ROADMAP.md](ROADMAP.md) for the full phasing strategy and build order.

If you want to track or contribute to v0.2 development, watch this repo or check the [issues](../../issues) tab.
