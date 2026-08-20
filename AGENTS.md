# Repository guidance

- Use TypeScript and Node.js 24.11 or newer in the Node.js 24 release line.
- Keep OpenClaw storage interpretation inside OpenClaw. Do not parse private JSONL or SQLite layouts.
- Map only observed public bundle facts. Do not invent timestamps, messages, retries, rewards, or lineage.
- Keep output deterministic and owner-only.
- Run `npm run check`, `npm run mutate`, `npm run slophammer`, `npm run validate:harbor`, and `npm run smoke:cli` before release.
