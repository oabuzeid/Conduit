# Contributing to specbot

Specbot is designed to be extended. This document describes how.

## Adding a new ticket provider

To add support for a new ticket system (Asana, Notion, ClickUp, etc.):

1. Create an integration file at `src/integrations/your-provider.ts`.
2. Implement the `TicketProvider` interface from `src/integrations/types.ts`. It has 6 methods:
   - `resolveProject()` — turn a config key into an internal project ID
   - `ensureLabel()` — create or find a label
   - `createTicket()` — create a ticket
   - `updateTicket()` — update a ticket
   - `getTicketsByLabel()` — list tickets for sync
   - `ticketsToPromptContext()` — serialize tickets for the AI
3. Register it in `src/integrations/registry.ts`. Add one line to the `providers` map.
4. Add env vars to `.env.example` and document them in the README.
5. Test with `specbot generate --dry-run` against your provider.

The Linear and Jira providers are reference implementations.

## Adding a new design tool

To add support beyond Figma (Sketch, Adobe XD, etc.):

1. Create a file at `src/integrations/your-design-tool.ts`.
2. Export two functions:
   - A tree fetcher that returns the design's node hierarchy.
   - A function that converts the tree to plain text for the AI engine.
3. Update `src/commands/audit.ts` to dispatch based on `config.design.provider`.

## Improving AI prompts

The prompts in `src/core/ai-engine.ts` have the largest effect on output quality. If the generated tickets are not detailed enough, miss edge cases, or have formatting issues:

1. Run `specbot generate --dry-run -v` to see the current output.
2. Edit the prompt in the relevant function (`generateTickets`, `analyzeDrift`, `auditDesignVsSpec`).
3. Test again and compare.

PRs that include before/after examples are preferred.

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/specbot.git
cd specbot
npm install
cp .env.example .env   # fill in your API keys
npm run build           # compile TypeScript
npm run dev -- generate --dry-run  # run without building
```

## Code conventions

- TypeScript with strict mode. ESM imports with `.js` extensions.
- Interfaces over types for public API shapes.
- `ora` spinners for async CLI operations. `chalk` for colored output.
- AI prompts request JSON-only responses. Strip markdown fences before parsing.
- No classes except for provider implementations. Prefer functions elsewhere.

## Writing style for documentation

See the "Writing style for `.md` files" section in [CLAUDE.md](CLAUDE.md). The same rules apply to PR descriptions and commit bodies.

## Submitting a PR

1. Fork the repo and create a branch.
2. Make your changes.
3. Run `npm run build` to verify TypeScript compiles.
4. Test manually with `--dry-run`.
5. Open a PR describing what you changed and why.
