# Changelog

All notable changes to specbot will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for v0.2 — Spec-arbitrated bidirectional sync engine

- Reverse-direction analyzer (ticket changes → spec diff)
- Spec PR generator (open GitHub PRs against the spec repo)
- Webhook listener service (`specbot serve`)
- Merge-propagation (downstream sync after spec PR merges)
- Loop prevention via change attribution

See [ROADMAP.md](ROADMAP.md) for the full v0.2 design.

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
- State tracking with sha256 content hashes (`.specbot/state.json`)
- Drift detection between specs and existing tickets
- Figma audit (compare design tree against spec)
- GitHub Action for auto-sync on PRs touching spec files
- Sample spec for testing (`specs/vehicle-photo-quality.md`)

### Notes

v0.1 does not implement bidirectional sync, webhook listeners, or automatic spec PR generation. Those are v0.2 goals. v0.1 provides the basis (parser, AI engine, provider interface, state model) that v0.2 will use.
