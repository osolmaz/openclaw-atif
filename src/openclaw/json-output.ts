/* eslint-disable complexity -- Bounded final-JSON recovery checks line candidates explicitly. */
import { asRecord } from "../json.js";

const MAX_JSON_START_CANDIDATES = 64;

export function parseFinalJsonObject(output: string): Record<string, unknown> {
  const direct = tryObject(output);
  if (direct) return direct;
  const starts: number[] = [];
  let lineStart = 0;
  for (let index = 0; index <= output.length; index += 1) {
    if (index !== output.length && output[index] !== "\n") continue;
    const line = output.slice(lineStart, index);
    if (line.startsWith("{")) {
      starts.push(lineStart);
      if (starts.length > MAX_JSON_START_CANDIDATES) starts.shift();
    }
    lineStart = index + 1;
  }
  for (const start of starts.reverse()) {
    const candidate = tryObject(output.slice(start));
    if (candidate) return candidate;
  }
  throw new Error("OpenClaw output did not end with a JSON object");
}

function tryObject(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}
