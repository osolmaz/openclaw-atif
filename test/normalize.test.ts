import { describe, expect, it } from "vitest";
import type { CapturedFamily } from "../src/models/family.js";
import { normalizeFamily } from "../src/normalize/family.js";
import { event } from "./helpers.js";

describe("normalizeFamily completeness", () => {
  it("reports unsupported events, source warnings, epoch timestamps, and non-ATIF relationships", () => {
    const key = "agent:main:main";
    const child = "agent:main:visible:child";
    const events = [
      event({ seq: 1, source: "runtime", type: "runtime.future", sessionId: "session" }),
      event({
        seq: 2,
        source: "transcript",
        type: "transcript.future",
        sessionId: "session",
        entryId: "future",
        ts: "1970-01-01T00:00:00.000Z",
      }),
      event({ seq: 3, source: "export", type: "export.future", sessionId: "session" }),
    ];
    const captured: CapturedFamily = {
      rootKey: key,
      openclawVersion: "test",
      openclawExecutableSha256: "abc",
      profile: "openclaw-support-v1",
      nodes: new Map([
        [
          key,
          {
            key,
            sessionId: "session",
            row: { key, sessionId: "session" },
            bundle: {
              directory: "bundle",
              manifest: {
                traceSchema: "openclaw-trajectory",
                schemaVersion: 1,
                generatedAt: "now",
                traceId: "session",
                sessionId: "session",
                sessionKey: key,
                workspaceDir: "$WORKSPACE_DIR",
                leafId: "leaf",
                eventCount: 3,
                runtimeEventCount: 1,
                transcriptEventCount: 1,
                sourceFiles: { session: key },
                warnings: [
                  {
                    source: "session",
                    code: "invalid-session-row",
                    count: 1,
                    rows: [1],
                    message: "bad row",
                  },
                ],
              },
              events,
              sessionBranch: {},
              supplemental: new Map(),
              sourceHashes: {},
            },
          },
        ],
      ]),
      relationships: [{ parentKey: key, childKey: child, kind: "visible-child", listing: true }],
      diagnostics: [],
      listingBeforeHash: "before",
      listingAfterHash: "after",
      stable: false,
    };
    const normalized = normalizeFamily(captured);
    const codes = normalized.diagnostics.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "openclaw-invalid-session-row",
        "source-fallback-timestamp",
        "unsupported-runtime-event",
        "unsupported-transcript-event",
        "unsupported-export-event",
        "relationship-not-represented-in-atif",
        "family-not-stable",
      ]),
    );
    expect(normalized.openclawExecutableSha256).toBe("abc");
  });
});
