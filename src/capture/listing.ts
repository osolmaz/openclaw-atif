import { createHash } from "node:crypto";
import {
  type SessionListing,
  type SessionListingRow,
  sessionListingSchema,
} from "../models/bundle-v1.js";
import { stableCompactStringify } from "../stable-json.js";

export function parseSessionListing(value: unknown): SessionListing {
  const listing = sessionListingSchema.parse(value);
  if (listing.hasMore === true) throw new Error("OpenClaw session listing is incomplete");
  return listing;
}

export function selectRoot(
  listing: SessionListing,
  selection: { sessionKey?: string; sessionId?: string },
): SessionListingRow {
  if ((selection.sessionKey ? 1 : 0) + (selection.sessionId ? 1 : 0) !== 1) {
    throw new Error("Select exactly one root with sessionKey or sessionId");
  }
  const matches = selection.sessionKey
    ? listing.sessions.filter((row) => row.key === selection.sessionKey)
    : listing.sessions.filter((row) => row.sessionId === selection.sessionId);
  if (matches.length === 0) throw new Error("OpenClaw root session was not found");
  if (matches.length !== 1) throw new Error("OpenClaw root session selection is ambiguous");
  const match = matches[0];
  if (!match) throw new Error("OpenClaw root session was not found");
  return match;
}

function fingerprintRow(row: SessionListingRow): Record<string, unknown> {
  return {
    key: row.key,
    sessionId: row.sessionId,
    agentId: row.agentId,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
    status: row.status,
    kind: row.kind ?? row.sessionKind,
    parentSessionKey: row.parentSessionKey,
    spawnedBy: row.spawnedBy,
    forkSourceSessionId: row.forkSourceSessionId,
    forkSourceEntryId: row.forkSourceEntryId,
    archivedAt: row.archivedAt,
    agentHarnessId: row.agentHarnessId,
    acpOwned: row.acpOwned,
  };
}

export function listingFingerprint(rows: readonly SessionListingRow[]): string {
  const canonical = rows
    .map(fingerprintRow)
    .sort((left, right) => String(left.key).localeCompare(String(right.key)));
  return createHash("sha256").update(stableCompactStringify(canonical)).digest("hex");
}
