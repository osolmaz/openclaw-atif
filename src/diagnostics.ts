import { compareCodeUnits } from "./ordering.js";

export type CompletenessStatus = "complete" | "partial";

export interface Diagnostic {
  code: string;
  message: string;
  nodeKey?: string;
  eventId?: string;
  count?: number;
}

export function deduplicateDiagnostics(values: readonly Diagnostic[]): Diagnostic[] {
  const entries = new Map<string, Diagnostic>();
  for (const value of values) {
    const key = [value.code, value.nodeKey ?? "", value.eventId ?? "", value.message].join(
      "\u0000",
    );
    const existing = entries.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + (value.count ?? 1);
    } else {
      entries.set(key, { ...value });
    }
  }
  return [...entries.values()].sort((left, right) =>
    compareCodeUnits(
      [left.code, left.nodeKey ?? "", left.eventId ?? "", left.message].join("\u0000"),
      [right.code, right.nodeKey ?? "", right.eventId ?? "", right.message].join("\u0000"),
    ),
  );
}
