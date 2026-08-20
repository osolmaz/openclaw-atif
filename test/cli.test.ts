import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { completedExitCode, parseCliArgs, runCli } from "../src/cli.js";
import { childEvents, writeBundle } from "./helpers.js";

describe("CLI", () => {
  it("parses export options", () => {
    const parsed = parseCliArgs([
      "export",
      "--session-key",
      "agent:main:main",
      "--output",
      "out",
      "--json",
    ]);
    expect(parsed.command).toBe("export");
    expect(parsed.values.get("session-key")).toBe("agent:main:main");
    expect(parsed.flags.has("json")).toBe(true);
  });

  it("rejects unknown and duplicate options", () => {
    expect(() => parseCliArgs(["export", "--wat"])).toThrow("Unknown option");
    expect(() => parseCliArgs(["export", "--output", "a", "--output", "b"])).toThrow(
      "more than once",
    );
  });

  it("converts a bundle graph through the installed command contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-cli-"));
    await writeBundle({
      root,
      name: "bundle",
      sessionId: "session",
      sessionKey: "agent:main:main",
      events: childEvents("session"),
    });
    const graph = join(root, "graph.json");
    await writeFile(
      graph,
      JSON.stringify({
        schema: "openclaw-atif-bundle-graph-v1",
        rootKey: "agent:main:main",
        openclawVersion: "test",
        nodes: [{ sessionKey: "agent:main:main", bundleDir: "bundle" }],
      }),
    );
    const output = join(root, "output");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await runCli([
      "convert",
      "--graph",
      graph,
      "--bundle-root",
      root,
      "--output",
      output,
      "--json",
    ]);
    expect(code).toBe(0);
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('"status":"complete"');
    stdout.mockRestore();
  });

  it("gives a received signal priority over a completed export status", () => {
    expect(completedExitCode("complete", 130)).toBe(130);
    expect(completedExitCode("partial", 143)).toBe(143);
    expect(completedExitCode("complete", undefined)).toBe(0);
    expect(completedExitCode("partial", undefined)).toBe(2);
  });

  it("returns one for invalid command input", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await runCli(["convert", "--output", "out"])).toBe(1);
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain("--graph is required");
    stderr.mockRestore();
  });
});
