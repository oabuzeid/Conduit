# Conduit

A spec-arbitrated sync engine for product teams.

> This repository contains v0.1 only. v0.1 is the foundation phase: a CLI for one-way spec-to-ticket generation, plus drift detection. The bidirectional sync engine described below is the v0.2 plan and is not yet implemented. See [STATUS.md](STATUS.md) for what is built and what is planned, and [ROADMAP.md](ROADMAP.md) for the full plan.

## The idea

Most product teams have three systems that should agree but rarely do: the spec (PRD, markdown doc), the tickets (Linear, Jira), and the designs (Figma). When any one changes, the others fall out of date.

Conduit's approach: route every change through the spec. Any side can propose changes — a ticket edit in Linear, a frame change in Figma — and conduit opens a PR against the spec. The PM reviews and merges. Once merged, conduit propagates the change to the other sides.

This avoids three-way live sync conflicts while keeping teams bidirectionally aware.

## How it differs

- Not just a generator: Most AI ticket tools are one-shot: PRD in, tickets out. Conduit maintains the relationship over time.
- Not omnidirectional: Three-way live sync between docs, tickets, and designs creates conflicts that have no clear resolution. Conduit routes every change through the spec.
- Not a chat workflow: A webhook listener that runs continuously and opens PRs without human prompting is not something a Claude conversation can do.
- Pluggable: Adding a new ticket system, design tool, or doc source means implementing one interface and registering it.

## What works today (v0.1)

| Command | What it does |
|---------|-------------|
| `conduit init` | Create config and example spec |
| `conduit generate` | Specs → AI → tickets (Linear/Jira) + Figma comments |
| `conduit generate --dry-run -v` | Preview without pushing |
| `conduit sync` | Detect drift between specs and tickets |
| `conduit audit` | Compare Figma designs against specs |

These commands are the basis for v0.2. v0.2 adds the webhook listener service that runs continuously and proposes spec PRs automatically.

## Quick start

Conduit is not yet on npm. Install from source:

```bash
git clone https://github.com/oabuzeid/Conduit.git
cd Conduit
npm install && npm run build
npm link                              # makes the `conduit` command available

cd /path/to/your-project
conduit init                          # scaffolds conduit.yaml + specs/

# Configure secrets — copy .env.example to .env and fill in values, or export directly
export ANTHROPIC_API_KEY="sk-ant-..."
export LINEAR_API_KEY="lin_api_..."   # or JIRA_HOST / JIRA_EMAIL / JIRA_API_TOKEN

conduit generate --dry-run -v
conduit generate
```

## Configuration

```yaml
# conduit.yaml
specs:
  - "specs/**/*.md"

tickets:
  provider: linear       # linear | jira
  project: "ENG"
  labels: ["conduit-managed"]

design:                   # optional
  provider: figma
  file_id: "your-file-id"

ai:
  model: "claude-sonnet-4-20250514"
  breakdown:
    mode: "by_section"            # by_section | by_layer | by_component | custom
  ac_format:
    format: "given_when_then"     # given_when_then | bullets | numbered
    include_background: false     # if true, AC may restate story context
    include_figma_links: false    # forward-looking; takes effect once generate ingests Figma in v0.2
```

## How v0.1 works

Spec as source of truth. H1 sections map to Epics. How H2 sections become Stories depends on `ai.breakdown.mode` — by spec section, by execution layer, by component, or by a custom rule you supply. Stories are the atomic unit; engineers split work into tasks themselves. Checkbox items in the spec fold into the parent story's acceptance criteria where they imply testable behavior.

Pluggable providers. Linear and Jira are built in. To add a new provider, implement one interface and register it.

Figma integration. On `generate`, conduit posts comments on matching frames. On `audit`, it compares the tree against your spec.

State tracking. `.conduit/state.json` maps spec sections to ticket IDs with content hashes. v0.2 uses this for loop prevention and reverse-direction analysis.

GitHub Action. Runs sync on PRs that touch spec files and comments the result on the PR.

## Env vars

| Variable | For | Description |
|----------|-----|-------------|
| `ANTHROPIC_API_KEY` | All | Claude API key |
| `LINEAR_API_KEY` | Linear | Linear API key |
| `JIRA_HOST` | Jira | e.g., `company.atlassian.net` |
| `JIRA_EMAIL` | Jira | Atlassian email |
| `JIRA_API_TOKEN` | Jira | Atlassian API token |
| `FIGMA_ACCESS_TOKEN` | Figma | Figma personal access token |

## Project plan

For why this project exists, how it is phased, and where it is going:

- [ROADMAP.md](ROADMAP.md) — phasing, rationale, and design choices
- [STATUS.md](STATUS.md) — what is built and what is planned

## Contributing

Conduit is designed to be forked. The most useful contributions are:

1. New ticket providers — implement `TicketProvider` from `src/integrations/types.ts`, register in `registry.ts`
2. New spec sources — currently markdown files. Notion, Coda, and Confluence are reasonable additions.
3. New design tools — Figma is built in. Sketch, Adobe XD, and Penpot can be added the same way.
4. Better AI prompts — the prompts in `src/core/ai-engine.ts` have the largest effect on output quality.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT
