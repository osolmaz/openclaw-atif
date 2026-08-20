import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TrajectoryEvent } from "../src/models/bundle-v1.js";

export function event(
  params: Partial<TrajectoryEvent> & Pick<TrajectoryEvent, "seq" | "source" | "type" | "sessionId">,
): TrajectoryEvent {
  return {
    traceSchema: "openclaw-trajectory",
    schemaVersion: 1,
    traceId: params.sessionId,
    ts: `2026-01-01T00:00:${String(params.seq).padStart(2, "0")}.000Z`,
    ...params,
  };
}

export async function writeBundle(params: {
  root: string;
  name: string;
  sessionId: string;
  sessionKey: string;
  leafId?: string | null;
  events: TrajectoryEvent[];
  warnings?: {
    source: "session" | "runtime";
    code: string;
    count: number;
    rows: number[];
    message: string;
  }[];
}): Promise<string> {
  const directory = join(params.root, params.name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const runtimeEventCount = params.events.filter((item) => item.source === "runtime").length;
  const transcriptEventCount = params.events.filter((item) => item.source === "transcript").length;
  const manifest = {
    traceSchema: "openclaw-trajectory",
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    traceId: params.sessionId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    workspaceDir: "$WORKSPACE_DIR",
    leafId: params.leafId ?? "leaf-1",
    eventCount: params.events.length,
    runtimeEventCount,
    transcriptEventCount,
    sourceFiles: { session: params.sessionKey },
    ...(params.warnings ? { warnings: params.warnings } : {}),
  };
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  await writeFile(
    join(directory, "events.jsonl"),
    `${params.events.map((item) => JSON.stringify(item)).join("\n")}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(directory, "session-branch.json"),
    `${JSON.stringify({ header: { id: params.sessionId }, leafId: params.leafId ?? "leaf-1", entries: [] }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return directory;
}

export function rootEvents(
  sessionId = "root-session",
  childKey = "agent:main:subagent:child",
): TrajectoryEvent[] {
  return [
    event({
      seq: 1,
      source: "runtime",
      type: "trace.metadata",
      sessionId,
      data: { harness: { version: "2026.8.1" }, model: { provider: "openai", name: "gpt-test" } },
    }),
    event({
      seq: 2,
      source: "runtime",
      type: "context.compiled",
      sessionId,
      data: {
        systemPrompt: "You are a test agent.",
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
      entryId: "u1",
      data: { message: { role: "user", content: [{ type: "text", text: "Delegate this task." }] } },
    }),
    event({
      seq: 4,
      source: "transcript",
      type: "assistant.message",
      sessionId,
      entryId: "a1",
      data: {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [
            { type: "thinking", thinking: "I should delegate." },
            { type: "text", text: "Starting a child." },
            {
              type: "toolCall",
              id: "call-1",
              name: "sessions_spawn",
              arguments: { task: "child work" },
            },
          ],
          usage: { input: 10, cacheRead: 2, cacheWrite: 1, output: 4, cost: { total: 0.01 } },
          stopReason: "toolUse",
        },
      },
    }),
    event({
      seq: 5,
      source: "transcript",
      type: "tool.call",
      sessionId,
      entryId: "a1",
      data: {
        assistantEntryId: "a1",
        toolCallId: "call-1",
        name: "sessions_spawn",
        arguments: { task: "child work" },
      },
    }),
    event({
      seq: 6,
      source: "transcript",
      type: "tool.result",
      sessionId,
      entryId: "t1",
      data: {
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "sessions_spawn",
          content: JSON.stringify({ status: "accepted", childSessionKey: childKey }),
        },
      },
    }),
    event({
      seq: 7,
      source: "transcript",
      type: "session.compaction",
      sessionId,
      entryId: "c1",
      data: { summary: "Earlier work was summarized.", firstKeptEntryId: "u1", tokensBefore: 100 },
    }),
  ];
}

export function childEvents(sessionId = "child-session"): TrajectoryEvent[] {
  return [
    event({
      seq: 1,
      source: "runtime",
      type: "trace.metadata",
      sessionId,
      data: { harness: { version: "2026.8.1" }, model: { provider: "openai", name: "gpt-test" } },
    }),
    event({
      seq: 2,
      source: "transcript",
      type: "user.message",
      sessionId,
      entryId: "cu1",
      data: { message: { role: "user", content: "Do child work." } },
    }),
    event({
      seq: 3,
      source: "transcript",
      type: "assistant.message",
      sessionId,
      entryId: "ca1",
      data: {
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-test",
          content: [{ type: "text", text: "Done." }],
          usage: { input: 3, output: 1, cost: { total: 0.002 } },
          stopReason: "stop",
        },
      },
    }),
  ];
}
