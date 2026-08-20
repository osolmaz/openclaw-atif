import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureOpenClawFamily } from "../src/capture/family.js";
import { exportOpenClawFamily } from "../src/exporter.js";
import { childEvents, rootEvents, writeBundle } from "./helpers.js";

async function fakeOpenClaw() {
  const root = await mkdtemp(join(tmpdir(), "openclaw-atif-capture-"));
  const bundles = join(root, "bundles");
  await writeBundle({
    root: bundles,
    name: "root",
    sessionId: "root-session",
    sessionKey: "agent:main:main",
    events: rootEvents(),
  });
  await writeBundle({
    root: bundles,
    name: "child",
    sessionId: "child-session",
    sessionKey: "agent:main:subagent:child",
    events: childEvents(),
  });
  const listing = {
    sessions: [
      { key: "agent:main:main", sessionId: "root-session", updatedAt: 1 },
      {
        key: "agent:main:subagent:child",
        sessionId: "child-session",
        updatedAt: 1,
        parentSessionKey: "agent:main:main",
      },
    ],
    hasMore: false,
  };
  const script = join(root, "openclaw.mjs");
  await writeFile(
    script,
    `#!/usr/bin/env node
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2026.8.1-test"); process.exit(0); }
if (args[0] === "doctor" && args.includes("--help")) { console.log("--session-sqlite"); process.exit(0); }
if (args[0] === "doctor") { console.log(JSON.stringify({ ok: true, mode: args[2] })); process.exit(0); }
if (args[0] === "sessions" && args[1] === "export-trajectory" && args.includes("--help")) { console.log("openclaw sessions export-trajectory"); process.exit(0); }
if (args[0] === "sessions" && args.includes("--all-agents")) { console.log(${JSON.stringify(JSON.stringify(listing))}); process.exit(0); }
if (args[0] === "sessions" && args[1] === "export-trajectory") {
  const key = args[args.indexOf("--session-key") + 1];
  const workspace = args[args.indexOf("--workspace") + 1];
  const output = args[args.indexOf("--output") + 1];
  const destination = join(workspace, ".openclaw", "trajectory-exports", output);
  await mkdir(join(workspace, ".openclaw", "trajectory-exports"), { recursive: true });
  await cp(join(process.env.BUNDLE_ROOT, key.includes(":subagent:") ? "child" : "root"), destination, { recursive: true });
  console.log(JSON.stringify({ outputDir: destination, sessionId: key.includes(":subagent:") ? "child-session" : "root-session", files: ["manifest.json", "events.jsonl", "session-branch.json"] }));
  process.exit(0);
}
process.exit(2);
`,
  );
  await chmod(script, 0o700);
  return { root, bundles, script };
}

describe("captureOpenClawFamily", () => {
  it("captures and reconciles a stable public session family", async () => {
    const fake = await fakeOpenClaw();
    const staging = join(fake.root, "staging");
    await (await import("node:fs/promises")).mkdir(staging, { mode: 0o700 });
    const family = await captureOpenClawFamily({
      executable: fake.script,
      openclawVersion: "2026.8.1-test",
      stagingRoot: staging,
      sessionKey: "agent:main:main",
      command: { env: { ...process.env, BUNDLE_ROOT: fake.bundles } },
    });
    expect(family.stable).toBe(true);
    expect(family.nodes.size).toBe(2);
    expect(family.relationships[0]?.spawn?.toolCallId).toBe("call-1");
  });

  it("runs the complete public export pipeline", async () => {
    const fake = await fakeOpenClaw();
    const output = join(fake.root, "output");
    const result = await exportOpenClawFamily({
      executable: fake.script,
      sessionKey: "agent:main:main",
      output,
      command: { env: { ...process.env, BUNDLE_ROOT: fake.bundles } },
    });
    expect(result.status).toBe("complete");
    expect(result.receipt.source.openclawVersion).toBe("2026.8.1-test");
    expect(result.receipt.source.openclawExecutableSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("uses explicit migration-on-copy when the source executable lacks export", async () => {
    const fake = await fakeOpenClaw();
    const legacy = join(fake.root, "legacy");
    await (await import("node:fs/promises")).mkdir(legacy);
    await writeFile(join(legacy, "sessions.json"), "{}\n");
    const source = join(fake.root, "old-openclaw.mjs");
    await writeFile(
      source,
      '#!/usr/bin/env node\nif (process.argv[2] === "--version") { console.log("old"); process.exit(0); } process.exit(2);\n',
    );
    await chmod(source, 0o700);
    const result = await exportOpenClawFamily({
      executable: source,
      migrationExecutable: fake.script,
      migrateCopy: true,
      legacyStateDir: legacy,
      sessionKey: "agent:main:main",
      output: join(fake.root, "migrated-output"),
      command: { env: { ...process.env, BUNDLE_ROOT: fake.bundles } },
    });
    expect(result.status).toBe("complete");
    expect(result.receipt.legacyMigration?.commands).toHaveLength(4);
  });

  it("rejects unsupported export without explicit migration inputs", async () => {
    const fake = await fakeOpenClaw();
    const source = join(fake.root, "old-openclaw.mjs");
    await writeFile(
      source,
      '#!/usr/bin/env node\nif (process.argv[2] === "--version") { console.log("old"); process.exit(0); } process.exit(2);\n',
    );
    await chmod(source, 0o700);
    await expect(
      exportOpenClawFamily({
        executable: source,
        sessionKey: "agent:main:main",
        output: join(fake.root, "out"),
      }),
    ).rejects.toThrow("migration-on-copy");
  });

  it("enforces family node and depth limits", async () => {
    const fake = await fakeOpenClaw();
    for (const limits of [{ maxNodes: 1 }, { maxDepth: 0 }]) {
      const staging = join(fake.root, `staging-${Object.keys(limits)[0] ?? "limit"}`);
      await (await import("node:fs/promises")).mkdir(staging, { mode: 0o700 });
      await expect(
        captureOpenClawFamily({
          executable: fake.script,
          openclawVersion: "test",
          stagingRoot: staging,
          sessionId: "root-session",
          ...limits,
          command: { env: { ...process.env, BUNDLE_ROOT: fake.bundles } },
        }),
      ).rejects.toThrow("limit");
    }
  });

  it("requires an exact root selection", async () => {
    const fake = await fakeOpenClaw();
    const staging = join(fake.root, "staging");
    await (await import("node:fs/promises")).mkdir(staging, { mode: 0o700 });
    await expect(
      captureOpenClawFamily({
        executable: fake.script,
        openclawVersion: "test",
        stagingRoot: staging,
        sessionKey: "missing",
        command: { env: { ...process.env, BUNDLE_ROOT: fake.bundles } },
      }),
    ).rejects.toThrow("not found");
  });
});
