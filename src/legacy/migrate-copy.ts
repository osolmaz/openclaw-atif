/* eslint-disable complexity -- Legacy migration selects one of two documented OpenClaw command surfaces. */
import { createHash } from "node:crypto";
import { chmod, cp, lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseStructuredOutput } from "../openclaw/capabilities.js";
import { type CommandOptions, runOpenClaw } from "../openclaw/process.js";

export interface LegacyMigrationReceipt {
  sourceFingerprintBefore: string;
  sourceFingerprintAfter: string;
  commands: { mode: string; stdoutSha256: string; stderrSha256: string }[];
}

async function assertNoSymlinks(root: string, current = root): Promise<void> {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const details = await lstat(path);
    if (details.isSymbolicLink())
      throw new Error(`Legacy migration source contains a symlink: ${relative(root, path)}`);
    if (details.isDirectory()) await assertNoSymlinks(root, path);
  }
}

async function treeFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const path = join(current, entry.name);
      const name = relative(root, path);
      const details = await lstat(path);
      hash.update(
        `${entry.isDirectory() ? "d" : "f"}\u0000${name}\u0000${String(details.mode & 0o777)}\u0000`,
      );
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) hash.update(await readFile(path));
      else throw new Error(`Unsupported legacy source entry: ${name}`);
    }
  }
  await visit(root);
  return hash.digest("hex");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function prepareLegacyMigrationCopy(params: {
  sourceStateDir: string;
  stagingRoot: string;
  executable: string;
  command?: CommandOptions;
}): Promise<{ stateDir: string; receipt: LegacyMigrationReceipt }> {
  const source = await realpath(params.sourceStateDir);
  const details = await lstat(source);
  if (!details.isDirectory() || details.isSymbolicLink())
    throw new Error("Legacy source state must be a regular directory");
  await assertNoSymlinks(source);
  const before = await treeFingerprint(source);
  const destination = join(params.stagingRoot, "legacy-state-copy");
  await mkdir(destination, { mode: 0o700 });
  await chmod(destination, 0o700);
  await cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
    preserveTimestamps: true,
  });
  const commands: LegacyMigrationReceipt["commands"] = [];
  const commandOptions = {
    ...params.command,
    env: { ...(params.command?.env ?? process.env), OPENCLAW_STATE_DIR: destination },
  };
  const help = await runOpenClaw(params.executable, ["doctor", "--help"], commandOptions);
  const targeted = `${help.stdout}\n${help.stderr}`.includes("--session-sqlite");
  const invocations: { mode: string; args: string[] }[] = targeted
    ? ["inspect", "dry-run", "import", "validate"].map((mode) => ({
        mode,
        args: ["doctor", "--session-sqlite", mode, "--session-sqlite-all-agents", "--json"],
      }))
    : [
        { mode: "fix", args: ["doctor", "--fix", "--non-interactive", "--yes"] },
        {
          mode: "sessions-list-verify",
          args: ["sessions", "--all-agents", "--limit", "all", "--json"],
        },
      ];
  for (const invocation of invocations) {
    const result = await runOpenClaw(params.executable, invocation.args, commandOptions);
    if (invocation.mode === "sessions-list-verify") {
      const listing = parseStructuredOutput(result.stdout);
      if (!Array.isArray(listing.sessions)) {
        throw new Error("Migrated legacy copy did not produce a public session listing");
      }
    }
    commands.push({
      mode: invocation.mode,
      stdoutSha256: digest(result.stdout),
      stderrSha256: digest(result.stderr),
    });
  }
  const after = await treeFingerprint(source);
  if (before !== after) throw new Error("Legacy source state changed during migration-on-copy");
  return {
    stateDir: destination,
    receipt: { sourceFingerprintBefore: before, sourceFingerprintAfter: after, commands },
  };
}
