import { describe, expect, it } from "vitest";
import { listingFingerprint, parseSessionListing, selectRoot } from "../src/capture/listing.js";

describe("session listing", () => {
  const listing = parseSessionListing({
    limitApplied: null,
    sessions: [
      { key: "a", sessionId: "one" },
      { key: "b", sessionId: "two" },
    ],
    hasMore: false,
  });

  it("selects exact keys and unique concrete IDs", () => {
    expect(selectRoot(listing, { sessionKey: "b" }).sessionId).toBe("two");
    expect(selectRoot(listing, { sessionId: "one" }).key).toBe("a");
  });

  it("rejects missing, ambiguous, and conflicting selection", () => {
    expect(() => selectRoot(listing, {})).toThrow("exactly one");
    expect(() => selectRoot(listing, { sessionKey: "a", sessionId: "one" })).toThrow("exactly one");
    expect(() => selectRoot(listing, { sessionKey: "missing" })).toThrow("not found");
    const duplicate = parseSessionListing({
      sessions: [
        { key: "a", sessionId: "same" },
        { key: "b", sessionId: "same" },
      ],
    });
    expect(() => selectRoot(duplicate, { sessionId: "same" })).toThrow("ambiguous");
  });

  it("accepts unrelated sparse rows but requires a concrete ID for the selected root", () => {
    const sparse = parseSessionListing({
      sessions: [
        { key: "stale", sessionId: null, updatedAt: null },
        { key: "root", sessionId: "concrete", updatedAt: 1 },
      ],
    });
    expect(selectRoot(sparse, { sessionKey: "root" }).sessionId).toBe("concrete");
    expect(() => selectRoot(sparse, { sessionKey: "stale" })).toThrow("concrete session ID");
  });

  it("rejects truncated listings", () => {
    expect(() => parseSessionListing({ sessions: [], hasMore: true })).toThrow("incomplete");
  });

  it("fingerprints relevant fields independent of row order", () => {
    expect(listingFingerprint(listing.sessions)).toBe(
      listingFingerprint([...listing.sessions].reverse()),
    );
    expect(listingFingerprint([{ key: "a", sessionId: "changed" }])).not.toBe(
      listingFingerprint([{ key: "a", sessionId: "one" }]),
    );
  });
});
