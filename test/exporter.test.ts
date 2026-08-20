import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convertOpenClawBundles } from "../src/exporter.js";
import { childEvents, rootEvents, writeBundle } from "./helpers.js";

async function fixture(listingOnly = false) {
  const root = await mkdtemp(join(tmpdir(), "openclaw-atif-export-"));
  await writeBundle({
    root,
    name: "root",
    sessionId: "root-session",
    sessionKey: "agent:main:main",
    events: rootEvents(),
  });
  await writeBundle({
    root,
    name: "child",
    sessionId: "child-session",
    sessionKey: "agent:main:subagent:child",
    events: childEvents(),
  });
  const graph = join(root, "graph.json");
  await writeFile(
    graph,
    JSON.stringify({
      schema: "openclaw-atif-bundle-graph-v1",
      rootKey: "agent:main:main",
      openclawVersion: "2026.8.1",
      nodes: [
        { sessionKey: "agent:main:main", bundleDir: "root" },
        {
          sessionKey: "agent:main:subagent:child",
          bundleDir: "child",
          parentKey: "agent:main:main",
          relationshipKind: "native-subagent",
          ...(listingOnly ? {} : { toolCallId: "call-1" }),
        },
      ],
    }),
  );
  return { root, graph, output: join(root, "output") };
}

describe("convertOpenClawBundles", () => {
  it("writes a complete owner-only atomic export", async () => {
    const value = await fixture();
    const result = await convertOpenClawBundles({
      graph: value.graph,
      bundleRoot: value.root,
      output: value.output,
    });
    expect(result.status).toBe("complete");
    expect((await stat(value.output)).mode & 0o777).toBe(0o700);
    expect((await stat(join(value.output, "trajectory.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(value.output, "receipt.json"))).mode & 0o777).toBe(0o600);
    const receipt = JSON.parse(
      await readFile(join(value.output, "receipt.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(receipt.status).toBe("complete");
  });

  it("returns idempotent writes for identical output", async () => {
    const value = await fixture();
    await convertOpenClawBundles({
      graph: value.graph,
      bundleRoot: value.root,
      output: value.output,
    });
    const second = await convertOpenClawBundles({
      graph: value.graph,
      bundleRoot: value.root,
      output: value.output,
    });
    expect(second.writes.every((write) => write.idempotent)).toBe(true);
  });

  it("writes partial output with unresolved relationship evidence", async () => {
    const value = await fixture(true);
    const result = await convertOpenClawBundles({
      graph: value.graph,
      bundleRoot: value.root,
      output: value.output,
    });
    expect(result.status).toBe("partial");
    expect(result.receipt.relationships[0]?.referenceStatus).toBe("unresolved");
  });

  it("rejects partial output in strict mode before commit", async () => {
    const value = await fixture(true);
    await expect(
      convertOpenClawBundles({
        graph: value.graph,
        bundleRoot: value.root,
        output: value.output,
        requireComplete: true,
      }),
    ).rejects.toThrow("partial");
    await expect(stat(value.output)).rejects.toThrow();
  });
});
