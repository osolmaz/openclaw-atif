---
title: "Export contract"
author: "Onur Solmaz <2453968+osolmaz@users.noreply.github.com>"
date: "2026-08-20"
---

# Export contract

## Commands

`openclaw-atif export` captures a session family through an official OpenClaw executable.

`openclaw-atif convert` converts existing OpenClaw trajectory bundles and a graph manifest.

Both commands call the same normalization, mapping, validation, and writer code.

## Outputs

The output directory contains:

- `trajectory.json`: one recursive ATIF-v1.7 document.
- `receipt.json`: source, completeness, privacy, metric, and validation evidence.

Complete output exits 0. Committed partial output exits 2. Fatal failure exits 1. Signal exits follow operating-system conventions.

## Source requirements

A bundle must contain regular, non-symlink files named `manifest.json`, `events.jsonl`, and `session-branch.json`.

The manifest must declare `traceSchema: openclaw-trajectory` and `schemaVersion: 1`. Counts and session identity must match the loaded events. Unknown versions are rejected.

Optional metadata, artifacts, prompts, system prompt, and tools files are loaded only when the manifest lists them.

Receipts hash stable source files directly. OpenClaw regenerates top-level `generatedAt` fields in the manifest, metadata, artifacts, and prompts captures. Receipts use named semantic hashes for those files after they remove only that volatile field. Raw bundle files remain private staging artifacts unless the caller explicitly keeps them.

## Completeness states

- `complete`: the family was stable and all required facts and references were exported and validated.
- `partial`: valid output exists, but one or more source facts, descendants, references, leaves, generations, or runtime events were unavailable. Capture retries transient session-generation and disappearing-child races before it emits this state.
- `failed`: no final output was committed.

Schema validity does not imply completeness.

## Privacy

OpenClaw's public bundle is support-redacted and bounded. The package does not recover removed values. It does not upload output.

The default profile is `openclaw-support-v1`. Additional profiles must be deterministic and named in the receipt.

## Writes

Directories use mode `0700` and files use mode `0600`. Output is validated before commit. Atomic writes occur in the destination filesystem. Recovery only touches package-owned transactions whose identity and expected hashes verify. If export and sensitive-staging cleanup both fail, the returned error reports both failures.
