# Repository guidance

- Use TypeScript and Node.js 22 or newer.
- Keep OpenClaw storage interpretation inside OpenClaw. Do not parse private JSONL or SQLite layouts.
- Map only observed public bundle facts. Do not invent timestamps, messages, retries, rewards, or lineage.
- Keep output deterministic and owner-only.
- Run `npm run check`, `npm run mutate`, `npm run slophammer`, `npm run validate:harbor`, and `npm run smoke:cli` before release.
