/* eslint-disable complexity -- Source-format dispatch is intentionally explicit. */
import type { Diagnostic } from "../diagnostics.js";
import {
  asRecord,
  type JsonObject,
  readFiniteNumber,
  readNonBlankString,
  readString,
  toJsonObject,
} from "../json.js";
import type { TrajectoryEvent } from "../models/bundle-v1.js";
import type {
  NormalizedNode,
  RelationshipEvidence,
  SessionFamilySnapshot,
} from "../models/family.js";
import { ATIF_VERSION } from "../version.js";
import { trajectoryId } from "./identity.js";
import {
  type AtifAgent,
  type AtifContentPart,
  type AtifFinalMetrics,
  type AtifMetrics,
  type AtifObservationResult,
  type AtifStep,
  type AtifToolCall,
  type AtifTrajectory,
  validateAtifTrajectory,
} from "./schema.js";

export interface MappingResult {
  trajectory: AtifTrajectory;
  diagnostics: Diagnostic[];
}

type StepState = {
  steps: AtifStep[];
  ownerByCallId: Map<string, AtifStep>;
  diagnostics: Diagnostic[];
};

function contentParts(
  value: unknown,
  diagnostics: Diagnostic[],
  nodeKey: string,
  eventId?: string,
): string | AtifContentPart[] {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  const parts: AtifContentPart[] = [];
  for (const block of value) {
    const item = asRecord(block);
    if (!item) continue;
    const type = readString(item.type)?.toLowerCase();
    if (type === "text" && typeof item.text === "string")
      parts.push({ type: "text", text: item.text });
    if (type === "image") {
      const source = asRecord(item.source);
      const path = readNonBlankString(source?.path) ?? readNonBlankString(item.path);
      const mediaType = readString(source?.media_type ?? source?.mediaType ?? item.mediaType);
      if (
        path &&
        ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType ?? "")
      ) {
        parts.push({
          type: "image",
          source: {
            media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            path,
          },
        });
      } else {
        diagnostics.push({
          code: "image-content-omitted",
          message: "An image without an ATIF path was omitted",
          nodeKey,
          eventId,
        });
      }
    }
  }
  if (parts.length === 0) return "";
  if (parts.every((part) => part.type === "text"))
    return parts.map((part) => part.text ?? "").join("");
  return parts;
}

function reasoningContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const block of value) {
    const item = asRecord(block);
    const type = readString(item?.type)?.toLowerCase();
    if (!item || !type || !["reasoning", "thinking", "analysis"].includes(type)) continue;
    const text = readString(item.text) ?? readString(item.thinking) ?? readString(item.content);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function metricNumber(value: unknown): number | undefined {
  const number = readFiniteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function metricsFromMessage(message: Record<string, unknown>): AtifMetrics | undefined {
  const usage = asRecord(message.usage);
  if (!usage) return undefined;
  const input = metricNumber(usage.input);
  const output = metricNumber(usage.output);
  const cacheRead = metricNumber(usage.cacheRead);
  const cacheWrite = metricNumber(usage.cacheWrite);
  const costValue = asRecord(usage.cost)?.total ?? usage.cost;
  const cost = metricNumber(costValue);
  const metrics: AtifMetrics = {};
  if (input !== undefined || cacheRead !== undefined)
    metrics.prompt_tokens = Math.trunc((input ?? 0) + (cacheRead ?? 0));
  if (output !== undefined) metrics.completion_tokens = Math.trunc(output);
  if (cacheRead !== undefined) metrics.cached_tokens = Math.trunc(cacheRead);
  if (cost !== undefined) metrics.cost_usd = cost;
  if (cacheWrite !== undefined) metrics.extra = { cache_write_tokens: Math.trunc(cacheWrite) };
  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

function argumentsFrom(value: unknown): { arguments: JsonObject; extra?: JsonObject } {
  const object = toJsonObject(value);
  if (object) return { arguments: object };
  if (typeof value === "string") {
    try {
      const parsed = toJsonObject(JSON.parse(value) as unknown);
      if (parsed) return { arguments: parsed };
    } catch {
      // Preserve the exact unparsed value below.
    }
    return { arguments: {}, extra: { arguments_status: "unparsed", raw_arguments: value } };
  }
  return { arguments: {}, extra: { arguments_status: "unavailable" } };
}

function callsByAssistantEntry(events: readonly TrajectoryEvent[]): Map<string, AtifToolCall[]> {
  const values = new Map<string, AtifToolCall[]>();
  for (const event of events) {
    if (event.type !== "tool.call") continue;
    const owner = readNonBlankString(event.data?.assistantEntryId) ?? event.entryId;
    if (!owner) continue;
    const id = readString(event.data?.toolCallId) ?? "";
    const name = readString(event.data?.name) ?? "";
    const converted = argumentsFrom(event.data?.arguments);
    const call: AtifToolCall = {
      tool_call_id: id,
      function_name: name,
      arguments: converted.arguments,
    };
    if (converted.extra) call.extra = converted.extra;
    const current = values.get(owner) ?? [];
    current.push(call);
    values.set(owner, current);
  }
  return values;
}

function modelName(message: Record<string, unknown>): string | undefined {
  const model = readNonBlankString(message.model);
  const provider = readNonBlankString(message.provider);
  if (!model) return undefined;
  return provider && !model.includes("/") ? `${provider}/${model}` : model;
}

function timestamp(event: TrajectoryEvent): string | undefined {
  const date = new Date(event.ts);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function pushStep(state: StepState, step: Omit<AtifStep, "step_id">): AtifStep {
  const value: AtifStep = { ...step, step_id: state.steps.length + 1 };
  state.steps.push(value);
  return value;
}

function messageStep(
  event: TrajectoryEvent,
  node: NormalizedNode,
  state: StepState,
  calls: Map<string, AtifToolCall[]>,
): void {
  const message = asRecord(event.data?.message);
  if (!message) {
    state.diagnostics.push({
      code: "message-event-invalid",
      message: "Message event has no message object",
      nodeKey: node.key,
      eventId: event.entryId,
    });
    return;
  }
  if (event.type === "user.message") {
    pushStep(state, {
      source: "user",
      message: contentParts(message.content, state.diagnostics, node.key, event.entryId),
      ...(timestamp(event) ? { timestamp: timestamp(event) } : {}),
      extra: { openclaw: { entry_id: event.entryId ?? null, event_type: event.type } },
    });
    return;
  }
  if (event.type !== "assistant.message") return;
  const toolCalls = event.entryId ? calls.get(event.entryId) : undefined;
  const step = pushStep(state, {
    source: "agent",
    message: contentParts(message.content, state.diagnostics, node.key, event.entryId),
    ...(timestamp(event) ? { timestamp: timestamp(event) } : {}),
    ...(modelName(message) ? { model_name: modelName(message) } : {}),
    ...(reasoningContent(message.content)
      ? { reasoning_content: reasoningContent(message.content) }
      : {}),
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(metricsFromMessage(message) ? { metrics: metricsFromMessage(message) } : {}),
    llm_call_count: 1,
    extra: {
      openclaw: {
        entry_id: event.entryId ?? null,
        stop_reason: readString(message.stopReason) ?? null,
        error_message: readString(message.errorMessage) ?? null,
      },
    },
  });
  for (const call of toolCalls ?? []) {
    if (state.ownerByCallId.has(call.tool_call_id))
      state.diagnostics.push({
        code: "duplicate-tool-call-id",
        message: "Tool call ID was reused",
        nodeKey: node.key,
        eventId: event.entryId,
      });
    state.ownerByCallId.set(call.tool_call_id, step);
  }
}

function resultContent(
  message: Record<string, unknown>,
  state: StepState,
  node: NormalizedNode,
  event: TrajectoryEvent,
): string | AtifContentPart[] | null {
  const content = contentParts(message.content, state.diagnostics, node.key, event.entryId);
  return Array.isArray(content) || content !== "" ? content : null;
}

function resultStep(
  event: TrajectoryEvent,
  node: NormalizedNode,
  state: StepState,
  refsByCall: ReadonlyMap<string, AtifSubagentRefLike[]>,
): void {
  const message = asRecord(event.data?.message);
  if (!message) return;
  const callId = readNonBlankString(message.toolCallId) ?? readNonBlankString(message.tool_call_id);
  const owner = callId ? state.ownerByCallId.get(callId) : undefined;
  const result: AtifObservationResult = {
    source_call_id: owner && callId ? callId : null,
    content: resultContent(message, state, node, event),
    extra: {
      openclaw: {
        entry_id: event.entryId ?? null,
        tool_name: readString(message.toolName) ?? null,
        is_error: message.isError === true,
      },
    },
  };
  const refs = callId ? refsByCall.get(callId) : undefined;
  if (refs && refs.length > 0) result.subagent_trajectory_ref = refs;
  if (owner) {
    owner.observation ??= { results: [] };
    owner.observation.results.push(result);
    return;
  }
  state.diagnostics.push({
    code: "orphan-tool-result",
    message: "Tool result has no matching assistant tool call",
    nodeKey: node.key,
    eventId: event.entryId,
  });
  pushStep(state, {
    source: "system",
    message: "",
    ...(timestamp(event) ? { timestamp: timestamp(event) } : {}),
    observation: { results: [result] },
    extra: { openclaw: { event_type: "tool.result", orphan: true } },
  });
}

type AtifSubagentRefLike = {
  trajectory_id?: string;
  session_id?: string;
  trajectory_path?: string;
  extra?: JsonObject;
};

function contextStep(event: TrajectoryEvent, node: NormalizedNode, state: StepState): void {
  const data = toJsonObject(event.data) ?? {};
  let message = "";
  if (event.type === "session.compaction" || event.type === "session.branch_summary")
    message = readString(event.data?.summary) ?? "";
  if (event.type === "session.custom_message") {
    const content = contentParts(event.data?.content, state.diagnostics, node.key, event.entryId);
    message = typeof content === "string" ? content : "";
  }
  if (event.type === "context.compiled") message = readString(event.data?.systemPrompt) ?? "";
  pushStep(state, {
    source: "system",
    message,
    ...(timestamp(event) ? { timestamp: timestamp(event) } : {}),
    extra: { openclaw: { event_type: event.type, entry_id: event.entryId ?? null, data } },
  });
}

function shouldMapSystemEvent(type: string): boolean {
  return [
    "session.compaction",
    "session.reset",
    "session.branch_summary",
    "session.custom",
    "session.custom_message",
    "session.thinking_level_change",
    "session.model_change",
    "session.label",
    "session.info",
    "context.compiled",
    "model.fallback_step",
  ].includes(type);
}

function agentForNode(node: NormalizedNode, version: string): AtifAgent {
  const metadata = node.runtimeEvents.findLast((event) => event.type === "trace.metadata");
  const modelInfo = asRecord(metadata?.data?.model);
  const harness = asRecord(metadata?.data?.harness);
  const model = readNonBlankString(modelInfo?.name) ?? readNonBlankString(node.row.model);
  const provider =
    readNonBlankString(modelInfo?.provider) ?? readNonBlankString(node.row.modelProvider);
  const context = node.runtimeEvents.findLast((event) => event.type === "context.compiled");
  const tools = Array.isArray(context?.data?.tools)
    ? context.data.tools.map(toJsonObject).filter((item): item is JsonObject => item !== undefined)
    : undefined;
  return {
    name: "openclaw",
    version: readNonBlankString(harness?.version) ?? version,
    ...(model
      ? { model_name: provider && !model.includes("/") ? `${provider}/${model}` : model }
      : {}),
    ...(tools && tools.length > 0 ? { tool_definitions: tools } : {}),
    extra: {
      source_bundle: "openclaw-trajectory-v1",
      source_redacted: true,
      trace_metadata: toJsonObject(metadata?.data) ?? {},
    },
  };
}

function finalMetrics(steps: readonly AtifStep[]): AtifFinalMetrics {
  let prompt = 0;
  let completion = 0;
  let cached = 0;
  let cost = 0;
  let observedPrompt = false;
  let observedCompletion = false;
  let observedCached = false;
  let observedCost = false;
  for (const step of steps) {
    if (step.metrics?.prompt_tokens !== undefined) {
      prompt += step.metrics.prompt_tokens;
      observedPrompt = true;
    }
    if (step.metrics?.completion_tokens !== undefined) {
      completion += step.metrics.completion_tokens;
      observedCompletion = true;
    }
    if (step.metrics?.cached_tokens !== undefined) {
      cached += step.metrics.cached_tokens;
      observedCached = true;
    }
    if (step.metrics?.cost_usd !== undefined) {
      cost += step.metrics.cost_usd;
      observedCost = true;
    }
  }
  return {
    total_steps: steps.length,
    ...(observedPrompt ? { total_prompt_tokens: prompt } : {}),
    ...(observedCompletion ? { total_completion_tokens: completion } : {}),
    ...(observedCached ? { total_cached_tokens: cached } : {}),
    ...(observedCost ? { total_cost_usd: cost } : {}),
    extra: { scope: "own-trajectory-only" },
  };
}

function runtimeProvenance(node: NormalizedNode): JsonObject {
  const counts: JsonObject = {};
  const terminal: JsonObject[] = [];
  for (const event of node.runtimeEvents) {
    const current = counts[event.type];
    counts[event.type] = typeof current === "number" ? current + 1 : 1;
    if (["model.completed", "trace.artifacts", "session.ended"].includes(event.type)) {
      terminal.push({
        type: event.type,
        run_id: event.runId ?? null,
        data: toJsonObject(event.data) ?? {},
      });
    }
  }
  return { event_type_counts: counts, terminal_events: terminal };
}

function buildNode(params: {
  family: SessionFamilySnapshot;
  node: NormalizedNode;
  visiting: Set<string>;
  diagnostics: Diagnostic[];
}): AtifTrajectory {
  if (params.visiting.has(params.node.key))
    throw new Error(`Session family contains a cycle at ${params.node.key}`);
  params.visiting.add(params.node.key);
  const childPairs = params.node.childRelationships
    .filter((relationship) => ["native-subagent", "acp-child"].includes(relationship.kind))
    .map((relationship) => ({
      relationship,
      child: params.family.nodes.get(relationship.childKey),
    }))
    .filter(
      (pair): pair is { relationship: RelationshipEvidence; child: NormalizedNode } =>
        pair.child !== undefined,
    )
    .sort((left, right) => left.child.key.localeCompare(right.child.key));
  const children = childPairs.map(({ child }) =>
    buildNode({
      family: params.family,
      node: child,
      visiting: params.visiting,
      diagnostics: params.diagnostics,
    }),
  );
  const childTrajectoryByKey = new Map(
    childPairs.map((pair, index) => [pair.child.key, children[index]]),
  );
  const refsByCall = new Map<string, AtifSubagentRefLike[]>();
  for (const relationship of params.node.childRelationships) {
    const child = childTrajectoryByKey.get(relationship.childKey);
    if (!relationship.spawn || !child?.trajectory_id) continue;
    const refs = refsByCall.get(relationship.spawn.toolCallId) ?? [];
    refs.push({
      trajectory_id: child.trajectory_id,
      session_id: child.session_id,
      extra: { relationship_kind: relationship.kind },
    });
    refsByCall.set(relationship.spawn.toolCallId, refs);
  }
  const calls = callsByAssistantEntry(params.node.transcriptEvents);
  const state: StepState = {
    steps: [],
    ownerByCallId: new Map(),
    diagnostics: [...params.node.diagnostics],
  };
  const events = [
    ...params.node.runtimeEvents,
    ...params.node.transcriptEvents,
    ...params.node.exportEvents,
  ].sort((left, right) => left.seq - right.seq);
  for (const event of events) {
    if (event.type === "user.message" || event.type === "assistant.message")
      messageStep(event, params.node, state, calls);
    else if (event.type === "tool.result") resultStep(event, params.node, state, refsByCall);
    else if (shouldMapSystemEvent(event.type)) contextStep(event, params.node, state);
  }
  if (state.steps.length === 0) {
    pushStep(state, {
      source: "system",
      message: "",
      extra: { openclaw: { empty_session: true } },
    });
    state.diagnostics.push({
      code: "session-has-no-mapped-steps",
      message: "The public bundle had no mappable steps",
      nodeKey: params.node.key,
    });
  }
  params.diagnostics.push(...state.diagnostics);
  params.visiting.delete(params.node.key);
  const otherRelationships = params.node.childRelationships.filter(
    (relationship) => !["native-subagent", "acp-child"].includes(relationship.kind),
  );
  return {
    schema_version: ATIF_VERSION,
    session_id: params.node.sessionId,
    trajectory_id: trajectoryId({
      sessionKey: params.node.key,
      sessionId: params.node.sessionId,
      leafId: params.node.leafId,
      profile: params.family.profile,
    }),
    agent: agentForNode(params.node, params.family.openclawVersion),
    steps: state.steps,
    final_metrics: finalMetrics(state.steps),
    extra: {
      openclaw: {
        session_key: params.node.key,
        session_id: params.node.sessionId,
        leaf_id: params.node.leafId,
        source_redacted: true,
        wrapper_only: params.node.row.acpOwned === true || params.node.key.includes(":acp:"),
        bundle_warning_codes: params.node.bundleWarnings,
        runtime: runtimeProvenance(params.node),
        relationships: otherRelationships.map((relationship) => ({
          child_key: relationship.childKey,
          kind: relationship.kind,
          listing: relationship.listing,
        })),
      },
    },
    ...(children.length > 0 ? { subagent_trajectories: children } : {}),
  };
}

export function mapFamilyToAtif(family: SessionFamilySnapshot): MappingResult {
  const root = family.nodes.get(family.rootKey);
  if (!root) throw new Error("Session family root is missing");
  const diagnostics: Diagnostic[] = [...family.diagnostics];
  const trajectory = buildNode({ family, node: root, visiting: new Set(), diagnostics });
  validateAtifTrajectory(trajectory);
  return { trajectory, diagnostics };
}
