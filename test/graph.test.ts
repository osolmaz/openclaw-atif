import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCapturedFamilyFromGraph, parseBundleGraph } from "../src/capture/graph.js";
import { childEvents, writeBundle } from "./helpers.js";

describe("bundle graph", () => {
  it("rejects malformed graph fields", () => {
    expect(() => parseBundleGraph(null)).toThrow("schema");
    expect(() => parseBundleGraph({ schema: "wrong" })).toThrow("schema");
    expect(() => parseBundleGraph({ schema: "openclaw-atif-bundle-graph-v1", nodes: [] })).toThrow(
      "identity",
    );
    expect(() =>
      parseBundleGraph({
        schema: "openclaw-atif-bundle-graph-v1",
        rootKey: "root",
        openclawVersion: "test",
        nodes: [{ sessionKey: "root", bundleDir: "bundle", relationshipKind: "bad" }],
      }),
    ).toThrow("relationshipKind");
  });

  it("rejects absolute and escaping bundle paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-graph-"));
    const outside = await mkdtemp(join(tmpdir(), "openclaw-atif-outside-"));
    await writeBundle({
      root: outside,
      name: "bundle",
      sessionId: "s",
      sessionKey: "root",
      events: childEvents("s"),
    });
    for (const bundleDir of [join(outside, "bundle"), "../outside"]) {
      const graph = join(root, `graph-${bundleDir.includes("/") ? "path" : "relative"}.json`);
      await writeFile(
        graph,
        JSON.stringify({
          schema: "openclaw-atif-bundle-graph-v1",
          rootKey: "root",
          openclawVersion: "test",
          nodes: [{ sessionKey: "root", bundleDir }],
        }),
      );
      await expect(loadCapturedFamilyFromGraph(graph, root)).rejects.toThrow();
    }
  });

  it("rejects duplicate nodes, missing parents, and wrong roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-graph-"));
    await writeBundle({
      root,
      name: "bundle",
      sessionId: "s",
      sessionKey: "root",
      events: childEvents("s"),
    });
    const cases = [
      {
        rootKey: "root",
        nodes: [
          { sessionKey: "root", bundleDir: "bundle" },
          { sessionKey: "root", bundleDir: "bundle" },
        ],
      },
      {
        rootKey: "root",
        nodes: [{ sessionKey: "root", bundleDir: "bundle", parentKey: "missing" }],
      },
      { rootKey: "missing", nodes: [{ sessionKey: "root", bundleDir: "bundle" }] },
    ];
    for (const [index, value] of cases.entries()) {
      const graph = join(root, `graph-${String(index)}.json`);
      await writeFile(
        graph,
        JSON.stringify({
          schema: "openclaw-atif-bundle-graph-v1",
          openclawVersion: "test",
          ...value,
        }),
      );
      await expect(loadCapturedFamilyFromGraph(graph, root)).rejects.toThrow();
    }
  });
});
