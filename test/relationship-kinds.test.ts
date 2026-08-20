import { describe, expect, it } from "vitest";
import { classifyRelationship, extractSpawnEvidence } from "../src/capture/relationships.js";
import { event } from "./helpers.js";

describe("relationship kinds and structured payloads", () => {
  it.each([
    [{ key: "agent:main:other", sessionId: "x", acpOwned: true }, "acp-child"],
    [{ key: "agent:main:other", sessionId: "x", acpRuntime: true }, "acp-child"],
    [{ key: "agent:main:other", sessionId: "x", acpRuntime: { backend: "acpx" } }, "acp-child"],
    [{ key: "agent:main:acp:x", sessionId: "x", acpRuntime: false }, "unknown-child"],
    [{ key: "agent:main:x", sessionId: "x", forkedFromParent: true }, "fork"],
    [{ key: "agent:main:x", sessionId: "x", forkSourceSessionId: "parent" }, "fork"],
    [{ key: "agent:main:x", sessionId: "x", forkSource: null }, "unknown-child"],
    [{ key: "agent:main:x", sessionId: "x", kind: "visible-session" }, "visible-child"],
    [{ key: "agent:main:x", sessionId: "x", sessionKind: "cron" }, "cron"],
    [{ key: "agent:main:x", sessionId: "x", kind: "adopted" }, "adopted"],
    [{ key: "agent:main:x", sessionId: "x" }, "unknown-child"],
  ] as const)("classifies %j as %s", (row, kind) => {
    expect(classifyRelationship(row)).toBe(kind);
  });

  it("classifies an exact spawn relationship as a native subagent without key heuristics", () => {
    expect(classifyRelationship({ key: "opaque-child", sessionId: "x" }, true)).toBe(
      "native-subagent",
    );
  });

  it("reads known child fields from details, arrays, and exact text JSON", () => {
    const events = [
      event({
        seq: 1,
        source: "transcript",
        type: "tool.call",
        sessionId: "s",
        data: { toolCallId: "call", name: "sessions_spawn" },
      }),
      event({
        seq: 2,
        source: "transcript",
        type: "tool.result",
        sessionId: "s",
        entryId: "result",
        data: {
          message: {
            toolCallId: "call",
            details: { nested: [{ sessionKey: "agent:main:subagent:one" }] },
            content: [
              { type: "text", text: JSON.stringify({ childSessionKey: "agent:main:acp:two" }) },
              { type: "other", text: "ignored" },
            ],
          },
        },
      }),
    ];
    expect(extractSpawnEvidence(events).map((item) => item.childSessionKey)).toEqual([
      "agent:main:acp:two",
      "agent:main:subagent:one",
    ]);
  });

  it("ignores unrelated tools, missing call IDs, and malformed exact JSON", () => {
    const events = [
      event({
        seq: 1,
        source: "transcript",
        type: "tool.call",
        sessionId: "s",
        data: { toolCallId: "other", name: "read" },
      }),
      event({
        seq: 2,
        source: "transcript",
        type: "tool.result",
        sessionId: "s",
        data: { message: { toolCallId: "other", content: { childSessionKey: "ignored" } } },
      }),
      event({
        seq: 3,
        source: "transcript",
        type: "tool.result",
        sessionId: "s",
        data: { message: { toolName: "sessions_spawn", content: "{bad" } },
      }),
      event({
        seq: 4,
        source: "transcript",
        type: "tool.result",
        sessionId: "s",
        data: { message: "bad" },
      }),
    ];
    expect(extractSpawnEvidence(events)).toEqual([]);
  });
});
