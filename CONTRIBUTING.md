# Contributing to Specbot

Thanks for considering a contribution! Specbot is designed to be extended — here's how.

## Adding a new ticket provider

This is the most common extension. To add support for a new ticket system (e.g., Asana, Notion, ClickUp):

1. **Create an integration file** at `src/integrations/your-provider.ts`
2. **Implement the `TicketProvider` interface** from `src/integrations/types.ts` — it has 6 methods:
   - `resolveProject()` — turn a config key into an internal project ID
   - `ensureLabel()` — create or find a label
   - `createTicket()` — create a ticket
   - `updateTicket()` — update a ticket
   - `getTicketsByLabel()` — list tickets for sync
   - `ticketsToPromptContext()` — serialize tickets for the AI
3. **Register it** in `src/integrations/registry.ts` — add one line to the `providers` map
4. **Add env vars** to `.env.example` and document them in the README
5. **Test** with `specbot generate --dry-run` against your provider

The Linear and Jira providers are good reference implementations.

## Adding a new design tool

To add support beyond Figma (e.g., Sketch, Adobe XD):

1. **Create a file** at `src/integrations/your-design-tool.ts`
2. **Export two functions**:
   - A tree/structure fetcher that returns the design's node hierarchy
   - A function that converts the tree to plain text for the AI engine
3. **Update `src/commands/audit.ts`** to dispatch based on `config.design.provider`

## Improving AI prompts

The prompts in `src/core/ai-engine.ts` are the most impactful thing to improve. If you find the generated tickets aren't detailed enough, miss edge cases, or have formatting issues:

1. Run `specbot generate --dry-run -v` to see current output
2. Edit the prompt in the relevant function (`generateTickets`, `analyzeDrift`, `auditDesignVsSpec`)
3. Test again and compare

PRs that improve prompt quality with before/after examples are very welcome.

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

- TypeScript with strict mode, ESM imports with `.js` extensions
- Interfaces over types for public API shapes
- `ora` spinners for async CLI operations, `chalk` for colored output
- AI prompts request JSON-only responses; clean markdown fences before parsing
- No classes except for provider implementations (prefer functions elsewhere)

## Submitting a PR

1. Fork the repo and create a branch
2. Make your changes
3. Run `npm run build` to verify TypeScript compiles
4. Test manually with `--dry-run`
5. Open a PR with a description of what you changed and why
