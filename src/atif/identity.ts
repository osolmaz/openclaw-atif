import { createHash } from "node:crypto";
import { ATIF_VERSION, OPENCLAW_BUNDLE_SCHEMA, OPENCLAW_BUNDLE_VERSION } from "../version.js";

const DOMAIN = "openclaw-atif-trajectory-v1";

export function trajectoryId(params: {
  sessionKey: string;
  sessionId: string;
  leafId: string | null;
  profile: string;
}): string {
  const input = [
    DOMAIN,
    OPENCLAW_BUNDLE_SCHEMA,
    String(OPENCLAW_BUNDLE_VERSION),
    params.sessionKey,
    params.sessionId,
    params.leafId ?? "",
    ATIF_VERSION,
    params.profile,
  ].join("\u0000");
  return `openclaw-${createHash("sha256").update(input).digest("hex").slice(0, 32)}`;
}
