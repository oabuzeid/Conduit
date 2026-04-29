# Specbot

**A spec-arbitrated sync engine for product teams.**

> ⚠️ **This repository contains v0.1 only.** v0.1 is the foundation phase: a working CLI for one-way spec-to-ticket generation, plus drift detection. The full bidirectional sync engine described below is the v0.2 vision and is **not yet implemented**. See [STATUS.md](STATUS.md) for what's built vs. planned, and [ROADMAP.md](ROADMAP.md) for the full strategy.

## The Idea

Most product teams have three systems that should agree but rarely do: the **spec** (PRD, markdown doc), the **tickets** (Linear, Jira), and the **designs** (Figma). When any one changes, the others go stale.

Specbot's approach: **route every change through the spec as a deliberate merge point.** Any side can *propose* changes — a ticket edit in Linear, a frame change in Figma — and specbot opens a PR against the spec. The PM reviews and merges. Once merged, downstream sync propagates the change to the other sides.

This sidesteps the conflict-resolution chaos of true three-way live sync while still giving teams bidirectional awareness.

## How It's Different

- **Not just a generator.** Most AI ticket tools are one-shot: PRD in, tickets out. Specbot maintains the relationship over time.
- **Not omnidirectional.** Three-way live sync between docs, tickets, and designs creates impossible conflicts. Specbot routes everything through the spec as a deliberate architectural choice.
- **Not a chat workflow.** A continuously running webhook listener that opens PRs without human prompting is something a Claude conversation fundamentally can't do.
- **Pluggable from the ground up.** Adding a new ticket system, design tool, or doc source is a one-hour job — implement an interface, register it, done.

## What Works Today (v0.1)

| Command | What it does |
|---------|-------------|
| `specbot init` | Scaffold config and example spec |
| `specbot generate` | Specs → AI → tickets (Linear/Jira) + Figma comments |
| `specbot generate --dry-run -v` | Preview without pushing |
| `specbot sync` | Detect drift between specs and tickets |
| `specbot audit` | Compare Figma designs against specs |

These commands are the foundation. v0.2 builds the webhook listener service that runs continuously and proposes spec PRs automatically.

## Quick Start

```bash
npm install -g specbot
cd your-project
specbot init

export ANTHROPIC_API_KEY="sk-ant-..."
export LINEAR_API_KEY="lin_api_..."   # or JIRA_* vars

specbot generate --dry-run -v
specbot generate
```

## Configuration

```yaml
# specbot.yaml
specs:
  - "specs/**/*.md"

tickets:
  provider: linear       # linear | jira
  project: "ENG"
  labels: ["specbot-managed"]

design:                   # optional
  provider: figma
  file_id: "your-file-id"

ai:
  model: "claude-sonnet-4-20250514"
  detail_level: "standard"   # minimal | standard | thorough
```

## How v0.1 Works

**Spec as source of truth.** H1 = epic, H2 = story, checkboxes = tasks.

**Pluggable providers.** Linear and Jira built in. New ones = implement one interface + register.

**Figma integration.** On generate, posts comments on matching frames. On audit, compares the tree against your spec.

**State tracking.** `.specbot/state.json` maps spec sections to ticket IDs with content hashes. This is the foundation for v0.2's loop-prevention and reverse-direction analysis.

**GitHub Action.** Auto-syncs on PRs touching spec files, comments results on the PR.

## Env Vars

| Variable | For | Description |
|----------|-----|-------------|
| `ANTHROPIC_API_KEY` | All | Claude API key |
| `LINEAR_API_KEY` | Linear | Linear API key |
| `JIRA_HOST` | Jira | e.g., `company.atlassian.net` |
| `JIRA_EMAIL` | Jira | Atlassian email |
| `JIRA_API_TOKEN` | Jira | Atlassian API token |
| `FIGMA_ACCESS_TOKEN` | Figma | Figma personal access token |

## Project Strategy

For the full thinking on why this project exists, how it's phased, and where it's headed, see:

- **[ROADMAP.md](ROADMAP.md)** — strategy, phasing, rationale, and design choices
- **[STATUS.md](STATUS.md)** — what's built vs. planned in this codebase

## Contributing

Specbot is designed to be forkable. The most valuable contributions are:

1. **New ticket providers** — implement `TicketProvider` from `src/integrations/types.ts`, register in `registry.ts`
2. **New spec sources** — currently markdown files; Notion, Coda, Confluence are natural extensions
3. **New design tools** — Figma is built in; Sketch, Adobe XD, Penpot would each take an afternoon
4. **Better AI prompts** — the prompts in `src/core/ai-engine.ts` have the biggest impact on output quality

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT
