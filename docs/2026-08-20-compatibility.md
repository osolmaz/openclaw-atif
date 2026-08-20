---
title: "Compatibility"
author: "Onur Solmaz <2453968+osolmaz@users.noreply.github.com>"
date: "2026-08-20"
---

# Compatibility

## OpenClaw

The first release consumes the documented `openclaw-trajectory` bundle schema v1.

The compatibility suite covers:

- OpenClaw 2026.7.1-2 with legacy JSONL storage.
- OpenClaw 2026.8.1-beta.2 with SQLite storage.
- A pinned current OpenClaw release.

The package does not interpret either storage layout. It invokes the OpenClaw version that owns the state and consumes its public bundle.

For an older archive without the export command, migration-on-copy uses a caller-selected official migration-capable OpenClaw executable. It uses the documented session SQLite inspect, dry-run, import, and validate sequence when available. Older command surfaces use documented non-interactive repair followed by a public session-list verification.

Before any migration command runs, a configured absolute `session.store` inside the source tree is rewritten to the corresponding copied path. Relative, unparseable, or external store targets are rejected. Migration commands cannot operate on the original store through copied configuration.

## ATIF and Harbor

The first release emits ATIF-v1.7 only.

Runtime validation is local. CI also validates against a pinned Harbor commit, Harbor's Pydantic trajectory model, `TrajectoryValidator`, and a real consumer load.

Adding a new OpenClaw bundle or ATIF version requires an explicit package release, fixtures for old and new behavior, and repeated Harbor conformance tests.
