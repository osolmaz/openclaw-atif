---
title: "OpenClaw to ATIF mapping"
author: "Onur Solmaz <2453968+osolmaz@users.noreply.github.com>"
date: "2026-08-20"
---

# OpenClaw to ATIF mapping

## Messages

- `user.message` becomes a user step.
- `assistant.message` becomes an agent step.
- `tool.result` attaches to the agent step with the exact matching tool call ID.
- An unmatched result becomes a system observation with no source call ID and a warning.

Observed empty content remains empty. The mapper does not add explanatory placeholders.

## Runtime facts

`trace.metadata`, `context.compiled`, `prompt.submitted`, `model.fallback_step`, `model.completed`, `trace.artifacts`, and `session.ended` supply agent configuration, context, outcome, and provenance only when they can be associated by exact source identity.

Runtime and transcript copies of the same dialogue are not emitted twice.

## Session events

Compaction and branch summaries become system context-management steps. Model and thinking changes affect later agent steps. Labels, reset, session info, and custom events remain typed source metadata or explicit system steps according to whether they affected model context.

Retained tails are not duplicated.

## Tools

Tool calls retain exact IDs, names, and JSON arguments. Results pair only by exact call ID. Malformed arguments remain raw source metadata instead of guessed JSON.

Only an exact structured `sessions_spawn` result can attach a `subagent_trajectory_ref` to an observation. The matching call arguments and typed listing lineage distinguish visible sessions, native subagents, and ACP children; key text alone does not decide the relationship.

## Subagents and other relationships

Native subagents and ACP children can be recursively embedded. Listing-only descendants are embedded without an invented step reference and make the export partial.

Forks, visible sessions, cron runs, adopted sessions, and session rotations remain distinct relationship kinds.

An ACP child represents the OpenClaw wrapper transcript. It does not claim to contain the external harness's hidden internal trajectory.

## Metrics

Per-step metrics use finite provider-reported values. `prompt_tokens` is the sum of uncached input, cache reads, and cache writes under the OpenClaw usage contract. Cache reads also populate `cached_tokens`, and cache writes remain visible in `extra`.

Each trajectory's final metrics cover only its own steps. The receipt contains a separately scoped family aggregate.

## Unsupported or missing data

Rewards, inferred retry causes, hidden reasoning, token IDs, log probabilities, copied-context ranges, continuation links, inactive leaves, and old generations are omitted unless the public source proves them. Each omission has a stable receipt code.
