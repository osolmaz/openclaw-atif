---
title: "OpenClaw ATIF implementation plan"
author: "Onur Solmaz <2453968+osolmaz@users.noreply.github.com>"
date: "2026-08-20"
---

# OpenClaw ATIF implementation plan

## Goal

Build one external TypeScript library and CLI that exports OpenClaw session families as Harbor ATIF-v1.7.

OpenClaw owns access to legacy JSONL and current SQLite storage. This package consumes only documented session-list JSON and `openclaw-trajectory` schema-v1 bundles.

## Architecture

1. Probe an explicit official `openclaw` executable and its public commands.
2. Resolve an exact root session key or a unique concrete session ID.
3. List all sessions and export the root through `openclaw sessions export-trajectory`.
4. Discover descendants from typed listing lineage and exact structured `sessions_spawn` results.
5. Export descendants breadth-first with fixed limits.
6. List sessions again and retry the full capture when relevant facts changed.
7. Normalize bundles into one storage-neutral `SessionFamilySnapshot`.
8. Convert the snapshot into one recursive ATIF-v1.7 trajectory.
9. Write `trajectory.json` and `receipt.json` through one owner-only atomic transaction.

The CLI also converts already captured bundles without running OpenClaw.

## Compatibility

The first release accepts OpenClaw trajectory bundle schema v1 and emits ATIF-v1.7.

OpenClaw 2026.7.1-2 provides the public export over legacy JSONL. OpenClaw 2026.8.1-beta.2 and current releases provide it over SQLite. Older archives can use an explicit migration-on-copy path with a caller-selected official OpenClaw executable. The copy uses targeted session migration commands when available and a documented non-interactive repair plus public-list verification otherwise. The original state is never modified.

Unknown bundle or ATIF versions fail closed.

## Identity and lineage

A `sessionKey` is a logical routing identity. A `sessionId` is one concrete transcript generation. A `leafId` identifies the exported active branch.

A trajectory ID is a domain-separated hash of the bundle schema, session key, session ID, leaf ID, ATIF version, and export profile.

Typed listing fields can prove that a child exists and identify its parent. Only an exact structured `sessions_spawn` result tied to a tool call can create an ATIF subagent reference. Listing-only children remain embedded but unresolved, and the receipt marks the family partial.

Native subagents and ACP children are separate relationship kinds. Forks, visible sessions, cron runs, adopted sessions, and rotations are not relabeled as subagents.

## Truthful mapping

The mapper preserves observed user and assistant content, reasoning, model data, tool calls and results, timestamps, usage, cost, errors, fallback events, compaction, branch summaries, labels, and custom events when the public bundle provides them.

Tool calls and results pair only by exact call ID. Orphan results use no source call ID and produce a warning.

The mapper does not invent placeholder messages, timestamps, retries, rewards, copied-context ranges, continuation edges, hidden reasoning, or external-harness internals.

Each trajectory reports only its own metrics. The receipt reports a separately scoped, deduplicated family aggregate.

## Completeness

A complete export requires stable before-and-after listings, all required bundles, valid schemas, resolved required relationships, and successful ATIF validation.

A partial export is valid ATIF with explicit omissions. It exits with status 2. Strict mode rejects partial output.

The receipt records source versions, hashes, selected leaves, redaction, warnings, omissions, unresolved relationships, metric scopes, validator results, and the output hash.

## Security and durability

OpenClaw bundles are already best-effort redacted support artifacts. This package records that boundary and can apply an additional named deterministic transform.

Temporary directories use mode `0700`. Files use mode `0600`. Subprocesses never use a shell. Final output uses same-filesystem staging, fsync, and atomic replacement. Identical output is an idempotent success. Different output requires an explicit force option.

Captured bundles and migration copies are removed unless the caller explicitly retains source bundles.

## Verification

Use synthetic fixtures only. Cover legacy and SQLite exports, native and ACP descendants, compaction, rotations, forks, missing spawn results, active changes, malformed bundles, interruption, permissions, and deterministic output.

Validate every golden artifact locally and with Harbor's pinned Pydantic trajectory model, `TrajectoryValidator`, and consumer loader. Run package, type, lint, coverage, mutation, Slophammer, audit, and installed-CLI smoke checks.

## Boundaries

Do not modify OpenClaw, Harbor, harbor-hf, or ATIF. Do not add a daemon, database, telemetry service, upload path, direct JSONL reader, or direct SQLite reader.
