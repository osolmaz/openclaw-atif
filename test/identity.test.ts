import { describe, expect, it } from "vitest";
import { trajectoryId } from "../src/atif/identity.js";

describe("trajectoryId", () => {
  it("is deterministic and generation-aware", () => {
    const base = {
      sessionKey: "agent:main:main",
      sessionId: "one",
      leafId: "leaf",
      profile: "openclaw-support-v1",
    };
    expect(trajectoryId(base)).toBe(trajectoryId(base));
    expect(trajectoryId({ ...base, sessionId: "two" })).not.toBe(trajectoryId(base));
    expect(trajectoryId({ ...base, leafId: "other" })).not.toBe(trajectoryId(base));
    expect(trajectoryId({ ...base, profile: "other" })).not.toBe(trajectoryId(base));
    expect(trajectoryId({ ...base, leafId: null })).toBe(
      "openclaw-ece5935d5de4fefb87a361f1856c4db0",
    );
  });
});
