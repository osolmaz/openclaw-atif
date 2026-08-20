#!/usr/bin/env node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { convertOpenClawBundles } from "../dist/exporter.js";

const root = process.cwd();
const bundlesRoot = join(root, "fixtures", "bundles");
const goldenRoot = join(root, "fixtures", "golden");
await rm(bundlesRoot, { recursive: true, force: true });
await rm(goldenRoot, { recursive: true, force: true });
await mkdir(bundlesRoot, { recursive: true });
await mkdir(goldenRoot, { recursive: true });

function event({ seq, source, type, sessionId, entryId, data }) {
  return {
    traceSchema: "openclaw-trajectory",
    schemaVersion: 1,
    traceId: sessionId,
    source,
    type,
    ts: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    seq,
    sessionId,
    ...(entryId ? { entryId } : {}),
    ...(data ? { data } : {}),
  };
}

async function writeBundle(directory, sessionKey, sessionId, events) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = {
    traceSchema: "openclaw-trajectory",
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    traceId: sessionId,
    sessionId,
    sessionKey,
    workspaceDir: "$WORKSPACE_DIR",
    leafId: "leaf-1",
    eventCount: events.length,
    runtimeEventCount: events.filter((value) => value.source === "runtime").length,
    transcriptEventCount: events.filter((value) => value.source === "transcript").length,
    sourceFiles: { session: sessionKey },
  };
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  await writeFile(
    join(directory, "events.jsonl"),
    `${events.map((value) => JSON.stringify(value)).join("\n")}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "session-branch.json"),
    `${JSON.stringify({ header: { id: sessionId }, leafId: "leaf-1", entries: [] }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function childEvents(sessionId) {
  return [
    event({
      seq: 1,
      source: "runtime",
      type: "trace.metadata",
      sessionId,
      data: { harness: { version: "2026.7.1-2" }, model: { provider: "openai", name: "gpt-test" } },
    }),
    event({
      seq: 2,
      source: "transcript",
      type: "user.message",
      sessionId,
      entryId: "u",
      data: { message: { role: "user", content: "Do the delegated work." } },
    }),
    event({
      seq: 3,
      source: "transcript",
      type: "assistant.message",
      sessionId,
      entryId: "a",
      data: {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [{ type: "text", text: "Done." }],
          usage: { input: 3, output: 1, cost: { total: 0.002 } },
        },
      },
    }),
  ];
}

function rootEvents(sessionId, childKey) {
  return [
    event({
      seq: 1,
      source: "runtime",
      type: "trace.metadata",
      sessionId,
      data: { harness: { version: "2026.7.1-2" }, model: { provider: "openai", name: "gpt-test" } },
    }),
    event({
      seq: 2,
      source: "runtime",
      type: "context.compiled",
      sessionId,
      data: {
        systemPrompt: "Synthetic system prompt",
        tools: [
          {
            type: "function",
            function: { name: "sessions_spawn", parameters: { type: "object" } },
          },
        ],
      },
    }),
    event({
      seq: 3,
      source: "transcript",
      type: "user.message",
      sessionId,
      entryId: "u",
      data: { message: { role: "user", content: "Delegate this task." } },
    }),
    event({
      seq: 4,
      source: "transcript",
      type: "assistant.message",
      sessionId,
      entryId: "a",
      data: {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [{ type: "text", text: "Starting a child." }],
          usage: { input: 10, cacheRead: 2, output: 4, cost: { total: 0.01 } },
        },
      },
    }),
    event({
      seq: 5,
      source: "transcript",
      type: "tool.call",
      sessionId,
      entryId: "a",
      data: {
        assistantEntryId: "a",
        toolCallId: "spawn-1",
        name: "sessions_spawn",
        arguments: { task: "child work" },
      },
    }),
    event({
      seq: 6,
      source: "transcript",
      type: "tool.result",
      sessionId,
      entryId: "r",
      data: {
        message: {
          role: "toolResult",
          toolCallId: "spawn-1",
          toolName: "sessions_spawn",
          content: JSON.stringify({ childSessionKey: childKey, status: "accepted" }),
        },
      },
    }),
  ];
}

async function generateFamily(name, version, childKey, relationshipKind, exactReference) {
  const familyRoot = join(bundlesRoot, name);
  await writeBundle(
    join(familyRoot, "root"),
    "agent:main:main",
    `${name}-root-session`,
    rootEvents(`${name}-root-session`, childKey),
  );
  await writeBundle(
    join(familyRoot, "child"),
    childKey,
    `${name}-child-session`,
    childEvents(`${name}-child-session`),
  );
  const graph = {
    schema: "openclaw-atif-bundle-graph-v1",
    rootKey: "agent:main:main",
    openclawVersion: version,
    nodes: [
      { sessionKey: "agent:main:main", bundleDir: "root" },
      {
        sessionKey: childKey,
        bundleDir: "child",
        parentKey: "agent:main:main",
        relationshipKind,
        ...(exactReference ? { toolCallId: "spawn-1" } : {}),
      },
    ],
  };
  const graphPath = join(familyRoot, "graph.json");
  await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
  await convertOpenClawBundles({
    graph: graphPath,
    bundleRoot: familyRoot,
    output: join(goldenRoot, name),
  });
}

await generateFamily(
  "legacy-jsonl",
  "2026.7.1-2",
  "agent:main:subagent:child",
  "native-subagent",
  true,
);
await generateFamily("sqlite", "2026.8.1-beta.2", "agent:main:acp:child", "acp-child", false);
