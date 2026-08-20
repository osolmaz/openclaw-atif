/* eslint-disable complexity -- Bundle validation enumerates all public contract checks. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { asRecord } from "../json.js";
import {
  bundleManifestSchema,
  type OpenClawBundleV1,
  type TrajectoryEvent,
  trajectoryEventSchema,
} from "../models/bundle-v1.js";

const REQUIRED_FILES = ["manifest.json", "events.jsonl", "session-branch.json"] as const;
const OPTIONAL_FILES = new Set([
  "metadata.json",
  "artifacts.json",
  "prompts.json",
  "system-prompt.txt",
  "tools.json",
]);
const KNOWN_FILES = new Set<string>([...REQUIRED_FILES, ...OPTIONAL_FILES]);
export const DEFAULT_MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_EVENTS = 250_000;

async function readRegularFile(root: string, name: string, maxBytes: number): Promise<Buffer> {
  if (basename(name) !== name || name.includes(".."))
    throw new Error(`Unsafe bundle file name: ${name}`);
  const path = join(root, name);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink())
    throw new Error(`Bundle file must be a regular non-symlink: ${name}`);
  if (details.size > maxBytes) throw new Error(`Bundle file exceeds size limit: ${name}`);
  const realRoot = await realpath(root);
  const realFile = await realpath(path);
  const location = relative(realRoot, realFile);
  if (location.startsWith("..") || resolve(realFile) === resolve(realRoot))
    throw new Error(`Bundle file escaped its directory: ${name}`);
  return readFile(realFile);
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseJsonObject(content: Buffer, name: string): Record<string, unknown> {
  const parsed = asRecord(JSON.parse(content.toString("utf8")) as unknown);
  if (!parsed) throw new Error(`${name} must contain a JSON object`);
  return parsed;
}

function requiredContent(contents: ReadonlyMap<string, Buffer>, name: string): Buffer {
  const content = contents.get(name);
  if (!content) throw new Error(`Bundle is missing required file: ${name}`);
  return content;
}

function parseEvents(content: Buffer, maxEvents: number): TrajectoryEvent[] {
  const events: TrajectoryEvent[] = [];
  for (const [lineIndex, raw] of content.toString("utf8").split(/\r?\n/u).entries()) {
    const line = raw.trim();
    if (!line) continue;
    if (events.length >= maxEvents)
      throw new Error(`Bundle exceeds event limit ${String(maxEvents)}`);
    try {
      events.push(trajectoryEventSchema.parse(JSON.parse(line) as unknown));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown JSONL validation error";
      throw new Error(`Invalid events.jsonl row ${String(lineIndex + 1)}: ${detail}`, {
        cause: error,
      });
    }
  }
  return events;
}

export async function loadOpenClawBundle(
  directory: string,
  options: { maxBytes?: number; maxEvents?: number } = {},
): Promise<OpenClawBundleV1> {
  const root = await realpath(directory);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BUNDLE_BYTES;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const contents = new Map<string, Buffer>();
  for (const name of REQUIRED_FILES)
    contents.set(name, await readRegularFile(root, name, maxBytes));
  const manifest = bundleManifestSchema.parse(
    parseJsonObject(requiredContent(contents, "manifest.json"), "manifest.json"),
  );
  const declaredContents = new Map<string, number>();
  for (const item of manifest.contents ?? []) {
    if (!KNOWN_FILES.has(item.path))
      throw new Error(`Unsupported declared bundle file: ${item.path}`);
    if (declaredContents.has(item.path))
      throw new Error(`Bundle manifest declares a file more than once: ${item.path}`);
    declaredContents.set(item.path, item.bytes);
  }
  const optionalNames = new Set(manifest.supplementalFiles ?? []);
  for (const name of declaredContents.keys()) if (OPTIONAL_FILES.has(name)) optionalNames.add(name);
  for (const name of optionalNames) {
    if (!OPTIONAL_FILES.has(name)) throw new Error(`Unsupported supplemental bundle file: ${name}`);
    contents.set(name, await readRegularFile(root, name, maxBytes));
  }
  const totalBytes = [...contents.values()].reduce((sum, content) => sum + content.byteLength, 0);
  if (totalBytes > maxBytes) throw new Error("Bundle exceeds total size limit");
  for (const [name, bytes] of declaredContents) {
    const content = contents.get(name);
    if (content?.byteLength !== bytes)
      throw new Error(`Bundle file size does not match manifest: ${name}`);
  }
  const events = parseEvents(requiredContent(contents, "events.jsonl"), maxEvents);
  const runtimeCount = events.filter((event) => event.source === "runtime").length;
  const transcriptCount = events.filter((event) => event.source === "transcript").length;
  if (
    events.length !== manifest.eventCount ||
    runtimeCount !== manifest.runtimeEventCount ||
    transcriptCount !== manifest.transcriptEventCount
  ) {
    throw new Error("Bundle event counts do not match manifest");
  }
  const eventSessionKeys = new Set(
    events.flatMap((event) => (event.sessionKey === undefined ? [] : [event.sessionKey])),
  );
  if (eventSessionKeys.size > 1)
    throw new Error("Bundle events contain conflicting sessionKey values");
  const eventSessionKey = [...eventSessionKeys][0];
  for (const [index, event] of events.entries()) {
    if (event.seq !== index + 1)
      throw new Error(`Bundle event sequence is not contiguous at row ${String(index + 1)}`);
    if (event.sessionId !== manifest.sessionId)
      throw new Error(`Bundle event sessionId mismatch at row ${String(index + 1)}`);
    if (event.traceId !== manifest.traceId)
      throw new Error(`Bundle event traceId mismatch at row ${String(index + 1)}`);
    if (
      event.sessionKey !== undefined &&
      manifest.sessionKey !== undefined &&
      event.sessionKey !== manifest.sessionKey
    )
      throw new Error(`Bundle event sessionKey mismatch at row ${String(index + 1)}`);
  }
  const supplemental = new Map<string, unknown>();
  for (const [name, content] of contents) {
    if (REQUIRED_FILES.includes(name as (typeof REQUIRED_FILES)[number])) continue;
    supplemental.set(
      name,
      name.endsWith(".json") ? JSON.parse(content.toString("utf8")) : content.toString("utf8"),
    );
  }
  return {
    directory: root,
    manifest,
    ...((manifest.sessionKey ?? eventSessionKey)
      ? { observedSessionKey: manifest.sessionKey ?? eventSessionKey }
      : {}),
    events,
    sessionBranch: parseJsonObject(
      requiredContent(contents, "session-branch.json"),
      "session-branch.json",
    ),
    supplemental,
    sourceHashes: Object.fromEntries(
      [...contents].map(([name, content]) => [name, sha256(content)]),
    ),
  };
}
