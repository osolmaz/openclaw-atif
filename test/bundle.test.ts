import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOpenClawBundle } from "../src/openclaw/bundle-v1.js";
import { childEvents, writeBundle } from "./helpers.js";

async function standardBundle(root: string, name = "bundle") {
  return writeBundle({
    root,
    name,
    sessionId: "session",
    sessionKey: "agent:main:main",
    events: childEvents("session"),
  });
}

describe("loadOpenClawBundle", () => {
  it("loads and validates a public bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-bundle-"));
    const bundle = await loadOpenClawBundle(await standardBundle(root));
    expect(bundle.manifest.sessionId).toBe("session");
    expect(bundle.events).toHaveLength(3);
    expect(bundle.sourceHashes["events.jsonl"]).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects manifest count mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-bundle-"));
    const directory = await standardBundle(root);
    const manifestPath = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.eventCount = 99;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(loadOpenClawBundle(directory)).rejects.toThrow("event counts");
  });

  it("rejects symlinked required files", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-bundle-"));
    const directory = await standardBundle(root);
    const external = join(root, "external.json");
    await writeFile(external, "{}\n");
    await rm(join(directory, "session-branch.json"));
    await symlink(external, join(directory, "session-branch.json"));
    await expect(loadOpenClawBundle(directory)).rejects.toThrow("non-symlink");
  });

  it("rejects unknown bundle schema versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-bundle-"));
    const directory = await standardBundle(root);
    const manifestPath = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.schemaVersion = 2;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(loadOpenClawBundle(directory)).rejects.toThrow();
  });

  it("rejects noncontiguous sequences and session mismatches", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-bundle-"));
    const events = childEvents("session");
    if (events[1]) events[1].seq = 9;
    const sequence = await writeBundle({
      root,
      name: "sequence",
      sessionId: "session",
      sessionKey: "agent:main:main",
      events,
    });
    await expect(loadOpenClawBundle(sequence)).rejects.toThrow("sequence");

    const mismatchEvents = childEvents("session");
    if (mismatchEvents[1]) mismatchEvents[1].sessionId = "other";
    const mismatch = await writeBundle({
      root,
      name: "mismatch",
      sessionId: "session",
      sessionKey: "agent:main:main",
      events: mismatchEvents,
    });
    await expect(loadOpenClawBundle(mismatch)).rejects.toThrow("sessionId mismatch");
  });

  it("rejects malformed rows and file limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-bundle-"));
    const directory = await standardBundle(root);
    await writeFile(join(directory, "events.jsonl"), "not-json\n");
    await expect(loadOpenClawBundle(directory)).rejects.toThrow("row 1");

    const limited = await standardBundle(root, "limited");
    await expect(loadOpenClawBundle(limited, { maxBytes: 2 })).rejects.toThrow("size limit");
    await expect(loadOpenClawBundle(limited, { maxEvents: 1 })).rejects.toThrow("event limit");
  });

  it("loads declared supplemental JSON and text files", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-atif-bundle-"));
    const directory = await standardBundle(root);
    const manifestPath = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.supplementalFiles = ["metadata.json", "system-prompt.txt"];
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(directory, "metadata.json"), '{"version":"test"}');
    await writeFile(join(directory, "system-prompt.txt"), "system");
    const bundle = await loadOpenClawBundle(directory);
    expect(bundle.supplemental.get("metadata.json")).toEqual({ version: "test" });
    expect(bundle.supplemental.get("system-prompt.txt")).toBe("system");
  });
});
