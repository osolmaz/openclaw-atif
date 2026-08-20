/* eslint-disable complexity -- The normalization test checks all completeness classes in one fixture. */
import { describe, expect, it } from "vitest";
import type { CapturedFamily } from "../src/models/family.js";
import { normalizeFamily } from "../src/normalize/family.js";
import { event } from "./helpers.js";

describe("normalizeFamily completeness", () => {
  it("reports unsupported events, source warnings, epoch timestamps, and non-ATIF relationships", () => {
    const key = "agent:main:main";
    const child = "agent:main:visible:child";
    const events = [
      event({
        seq: 1,
        source: "runtime",
        type: "runtime.future",
        sessionId: "session",
        data: { truncated: true, droppedFields: ["payload"] },
      }),
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
              supplemental: new Map([
                ["metadata.json", { generatedAt: "one", facts: { stable: true } }],
              ]),
              sourceHashes: {
                "manifest.json": "volatile-one",
                "metadata.json": "volatile-metadata-one",
                "events.jsonl": "stable",
              },
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
        "source-event-truncated",
        "unsupported-transcript-event",
        "unsupported-export-event",
        "relationship-not-represented-in-atif",
        "family-not-stable",
      ]),
    );
    expect(normalized.openclawExecutableSha256).toBe("abc");
    const normalizedNode = normalized.nodes.get(key);
    expect(normalizedNode?.sourceHashes["manifest.json"]).toBeUndefined();
    const semanticManifestHash = normalizedNode?.sourceHashes["manifest.semantic-v1"];
    const semanticMetadataHash = normalizedNode?.sourceHashes["metadata.json#semantic-v1"];
    expect(semanticManifestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(semanticMetadataHash).toMatch(/^[a-f0-9]{64}$/u);

    const bundle = captured.nodes.get(key)?.bundle;
    if (!bundle) throw new Error("test bundle is missing");
    bundle.manifest.generatedAt = "later";
    bundle.supplemental = new Map([
      ["metadata.json", { generatedAt: "two", facts: { stable: true } }],
    ]);
    bundle.sourceHashes = {
      "manifest.json": "volatile-two",
      "metadata.json": "volatile-metadata-two",
      "events.jsonl": "stable",
    };
    const repeatedHashes = normalizeFamily(captured).nodes.get(key)?.sourceHashes;
    expect(repeatedHashes?.["manifest.semantic-v1"]).toBe(semanticManifestHash);
    expect(repeatedHashes?.["metadata.json#semantic-v1"]).toBe(semanticMetadataHash);
  });
});
