import { describe, expect, it } from "vitest";
import { deduplicateDiagnostics } from "../src/diagnostics.js";

describe("deduplicateDiagnostics", () => {
  it("sorts, combines, and counts exact duplicate diagnostics", () => {
    expect(
      deduplicateDiagnostics([
        { code: "z", message: "last", count: 2 },
        { code: "a", message: "first", nodeKey: "node", eventId: "event" },
        { code: "a", message: "first", nodeKey: "node", eventId: "event", count: 3 },
      ]),
    ).toEqual([
      { code: "a", message: "first", nodeKey: "node", eventId: "event", count: 4 },
      { code: "z", message: "last", count: 2 },
    ]);
  });

  it("keeps different nodes and events separate", () => {
    expect(
      deduplicateDiagnostics([
        { code: "a", message: "same", nodeKey: "one" },
        { code: "a", message: "same", nodeKey: "two" },
        { code: "a", message: "same", eventId: "event" },
      ]),
    ).toHaveLength(3);
  });
});
