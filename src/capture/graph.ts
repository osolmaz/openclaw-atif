/* eslint-disable complexity -- Graph validation enumerates all contract failures. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { asRecord, readNonBlankString } from "../json.js";
import type {
  BundleGraphManifest,
  CapturedFamily,
  RelationshipEvidence,
  RelationshipKind,
  SourceNode,
} from "../models/family.js";
import { loadOpenClawBundle } from "../openclaw/bundle-v1.js";
import { stableCompactStringify } from "../stable-json.js";
import { DEFAULT_PROFILE } from "../version.js";

const RELATIONSHIP_KINDS = new Set<RelationshipKind>([
  "native-subagent",
  "acp-child",
  "visible-child",
  "fork",
  "rotation",
  "cron",
  "adopted",
  "unknown-child",
]);

export function parseBundleGraph(value: unknown): BundleGraphManifest {
  const record = asRecord(value);
  if (record?.schema !== "openclaw-atif-bundle-graph-v1")
    throw new Error("Unsupported bundle graph schema");
  const rootKey = readNonBlankString(record.rootKey);
  const openclawVersion = readNonBlankString(record.openclawVersion);
  if (!rootKey || !openclawVersion || !Array.isArray(record.nodes))
    throw new Error("Bundle graph is missing root identity or nodes");
  const nodes = record.nodes.map((value, index) => {
    const node = asRecord(value);
    const sessionKey = readNonBlankString(node?.sessionKey);
    const bundleDir = readNonBlankString(node?.bundleDir);
    const parentKey = readNonBlankString(node?.parentKey);
    const relationshipKind = readNonBlankString(node?.relationshipKind) as
      | RelationshipKind
      | undefined;
    const toolCallId = readNonBlankString(node?.toolCallId);
    if (!sessionKey || !bundleDir) throw new Error(`Bundle graph node ${String(index)} is invalid`);
    if (relationshipKind && !RELATIONSHIP_KINDS.has(relationshipKind))
      throw new Error(`Bundle graph node ${String(index)} has invalid relationshipKind`);
    return {
      sessionKey,
      bundleDir,
      ...(parentKey ? { parentKey } : {}),
      ...(relationshipKind ? { relationshipKind } : {}),
      ...(toolCallId ? { toolCallId } : {}),
    };
  });
  return {
    schema: "openclaw-atif-bundle-graph-v1",
    rootKey,
    openclawVersion,
    profile: readNonBlankString(record.profile),
    nodes,
  };
}

async function resolveBundle(root: string, relativePath: string): Promise<string> {
  if (isAbsolute(relativePath)) throw new Error("Bundle graph paths must be relative");
  const realRoot = await realpath(root);
  const candidate = await realpath(join(realRoot, relativePath));
  const location = relative(realRoot, candidate);
  if (!location || location.startsWith("..") || isAbsolute(location))
    throw new Error("Bundle graph path escaped bundle root");
  return candidate;
}

export async function loadCapturedFamilyFromGraph(
  graphPath: string,
  bundleRoot: string,
): Promise<CapturedFamily> {
  const graph = parseBundleGraph(JSON.parse(await readFile(graphPath, "utf8")) as unknown);
  if (graph.nodes.length === 0 || graph.nodes.length > 128)
    throw new Error("Bundle graph has an invalid node count");
  const nodes = new Map<string, SourceNode>();
  const relationships: RelationshipEvidence[] = [];
  for (const graphNode of graph.nodes) {
    if (nodes.has(graphNode.sessionKey))
      throw new Error(`Duplicate bundle graph session: ${graphNode.sessionKey}`);
    const bundle = await loadOpenClawBundle(await resolveBundle(bundleRoot, graphNode.bundleDir));
    if (bundle.manifest.sessionKey && bundle.manifest.sessionKey !== graphNode.sessionKey)
      throw new Error(`Bundle graph key mismatch: ${graphNode.sessionKey}`);
    const row = { key: graphNode.sessionKey, sessionId: bundle.manifest.sessionId };
    const source: SourceNode = {
      key: graphNode.sessionKey,
      sessionId: bundle.manifest.sessionId,
      row,
      bundle,
    };
    if (graphNode.parentKey) {
      const relationship: RelationshipEvidence = {
        parentKey: graphNode.parentKey,
        childKey: graphNode.sessionKey,
        kind: graphNode.relationshipKind ?? "unknown-child",
        listing: true,
        ...(graphNode.toolCallId
          ? { spawn: { toolCallId: graphNode.toolCallId, childSessionKey: graphNode.sessionKey } }
          : {}),
      };
      source.parentKey = graphNode.parentKey;
      source.relationship = relationship;
      relationships.push(relationship);
    }
    nodes.set(source.key, source);
  }
  if (!nodes.has(graph.rootKey)) throw new Error("Bundle graph root is missing");
  const roots = [...nodes.values()].filter((node) => !node.parentKey);
  if (roots.length !== 1 || roots[0]?.key !== graph.rootKey)
    throw new Error("Bundle graph must have one declared root");
  for (const relationship of relationships)
    if (!nodes.has(relationship.parentKey))
      throw new Error(`Bundle graph parent is missing: ${relationship.parentKey}`);
  const hash = createHash("sha256").update(stableCompactStringify(graph)).digest("hex");
  return {
    rootKey: graph.rootKey,
    openclawVersion: graph.openclawVersion,
    profile: graph.profile ?? DEFAULT_PROFILE,
    nodes,
    relationships,
    diagnostics: [],
    listingBeforeHash: hash,
    listingAfterHash: hash,
    stable: true,
  };
}
