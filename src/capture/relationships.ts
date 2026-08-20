/* eslint-disable complexity -- Relationship evidence parsing is explicit and bounded. */
import { asRecord, readNonBlankString } from "../json.js";
import type { SessionListingRow, TrajectoryEvent } from "../models/bundle-v1.js";
import type { RelationshipEvidence, RelationshipKind, SpawnEvidence } from "../models/family.js";

const CHILD_FIELD_NAMES = new Set(["childSessionKey", "sessionKey"]);

function collectStructuredChildKeys(
  value: unknown,
  fieldName?: string,
  found = new Set<string>(),
): Set<string> {
  if (fieldName && CHILD_FIELD_NAMES.has(fieldName)) {
    const candidate = readNonBlankString(value);
    if (candidate) found.add(candidate);
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredChildKeys(item, fieldName, found);
    return found;
  }
  const record = asRecord(value);
  if (record) {
    for (const [key, item] of Object.entries(record)) collectStructuredChildKeys(item, key, found);
  }
  return found;
}

function parseExactJsonText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function toolResultPayload(message: Record<string, unknown>): unknown[] {
  const values: unknown[] = [message, message.details, parseExactJsonText(message.content)];
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      const record = asRecord(part);
      if (record?.type === "text") values.push(parseExactJsonText(record.text));
    }
  }
  return values;
}

export function extractSpawnEvidence(events: readonly TrajectoryEvent[]): SpawnEvidence[] {
  const callNames = new Map<string, string>();
  for (const event of events) {
    if (event.type === "tool.call") {
      const id = readNonBlankString(event.data?.toolCallId);
      const name = readNonBlankString(event.data?.name);
      if (id && name) callNames.set(id, name);
    }
  }
  const evidence: SpawnEvidence[] = [];
  for (const event of events) {
    if (event.type !== "tool.result") continue;
    const message = asRecord(event.data?.message);
    if (!message) continue;
    const callId =
      readNonBlankString(message.toolCallId) ?? readNonBlankString(message.tool_call_id);
    if (!callId) continue;
    const toolName = readNonBlankString(message.toolName) ?? callNames.get(callId);
    if (toolName !== "sessions_spawn") continue;
    const children = new Set<string>();
    for (const payload of toolResultPayload(message))
      collectStructuredChildKeys(payload, undefined, children);
    for (const childSessionKey of children) {
      evidence.push({ toolCallId: callId, childSessionKey, eventId: event.entryId });
    }
  }
  return [
    ...new Map(
      evidence.map((item) => [`${item.toolCallId}\u0000${item.childSessionKey}`, item]),
    ).values(),
  ].sort((left, right) =>
    `${left.toolCallId}\u0000${left.childSessionKey}`.localeCompare(
      `${right.toolCallId}\u0000${right.childSessionKey}`,
    ),
  );
}

export function isAcpListingRow(row: SessionListingRow): boolean {
  const kind = (row.kind ?? row.sessionKind ?? "").toLowerCase();
  return (
    row.acpOwned === true ||
    row.acpRuntime === true ||
    (typeof row.acpRuntime === "object" && row.acpRuntime !== null) ||
    kind.includes("acp")
  );
}

export function classifyRelationship(
  row: SessionListingRow,
  hasSpawnEvidence = false,
): RelationshipKind {
  const kind = (row.kind ?? row.sessionKind ?? "").toLowerCase();
  if (
    row.forkedFromParent === true ||
    (row.forkSource !== undefined && row.forkSource !== null) ||
    row.forkSourceSessionId ||
    kind.includes("fork")
  )
    return "fork";
  if (isAcpListingRow(row)) return "acp-child";
  if (kind.includes("subagent") || hasSpawnEvidence) return "native-subagent";
  if (kind.includes("visible")) return "visible-child";
  if (kind.includes("cron")) return "cron";
  if (kind.includes("adopt")) return "adopted";
  return "unknown-child";
}

export function discoverRelationships(params: {
  parent: SessionListingRow;
  rows: readonly SessionListingRow[];
  events: readonly TrajectoryEvent[];
}): RelationshipEvidence[] {
  const spawnByChild = new Map(
    extractSpawnEvidence(params.events).map((item) => [item.childSessionKey, item]),
  );
  const candidateKeys = new Set<string>();
  for (const row of params.rows) {
    if (row.parentSessionKey === params.parent.key || row.spawnedBy === params.parent.key)
      candidateKeys.add(row.key);
  }
  for (const key of spawnByChild.keys()) candidateKeys.add(key);
  const rowByKey = new Map(params.rows.map((row) => [row.key, row]));
  return [...candidateKeys].sort().map((childKey) => {
    const row = rowByKey.get(childKey);
    return {
      parentKey: params.parent.key,
      childKey,
      kind: row ? classifyRelationship(row, spawnByChild.has(childKey)) : "unknown-child",
      listing:
        row !== undefined &&
        (row.parentSessionKey === params.parent.key || row.spawnedBy === params.parent.key),
      spawn: spawnByChild.get(childKey),
    } satisfies RelationshipEvidence;
  });
}
