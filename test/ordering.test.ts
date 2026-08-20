import { describe, expect, it } from "vitest";
import { compareCodeUnits } from "../src/ordering.js";

describe("compareCodeUnits", () => {
  it("uses stable code-unit order for ASCII and non-ASCII text", () => {
    const values = ["é", "z", "ä", "a", "😀", "中"];
    expect([...values].sort(compareCodeUnits)).toEqual(["a", "z", "ä", "é", "中", "😀"]);
    expect(compareCodeUnits("same", "same")).toBe(0);
  });
});
