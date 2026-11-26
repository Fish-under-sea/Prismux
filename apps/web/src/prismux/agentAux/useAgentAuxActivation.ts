import { scopedThreadKey } from "@prismux/client-runtime/environment";
import type {
  OrchestrationV2GetNativeChildWorkResult,
  ScopedThreadRef,
} from "@prismux/core-contracts";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { useRightPanelStore } from "../../rightPanelStore";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import {
  inspectAgentAux,
  subscribeAgentAuxEvents,
  type DaemonAgentAuxInspectResponse,
} from "../daemonClient";
import { useAgentAuxLocale } from "./agentAux.i18n";
import {
  buildAgentAuxViewModel,
  shouldAutoOpenAgentAux,
  type AgentAuxProjectionLike,
  type AgentAuxThreadShellLike,
  type AgentAuxViewModel,
} from "./agentAux.logic";
import { toAgentAuxOverviewEntry, type AgentAuxOverviewEntryData } from "./AgentAuxPanel";

export const AGENT_AUX_POLL_INTERVAL_MS = 12_000;
export const AGENT_AUX_ACTIVE_POLL_INTERVAL_MS = 2_500;
export const AGENT_AUX_BACKGROUND_POLL_INTERVAL_MS = 5_000;

const ACTIVE_AUX_STATUSES = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "streaming",
  "in_progress",
  "active",
  "working",
  "pending",
  "thinking",
  "tool_calling",
  "waiting",
]);

const SWARM_TOOL_NAME_RE = /\b(?:swarm|post_message|read_board|swarm_wait)\b/i;
const SWARM_FILE_PATH_RE = /\.system_generated[/\\]swarm[/\\](?:plan|swarm|members)\.json$/i;
const AGY_SWARM_PATH_CONV_RE =
  /(?:antigravity(?:-[a-z0-9_-]+)?)[/\\]brain[/\\]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[/\\]\.system_generated[/\\]swarm/i;

function isActiveStatusValue(raw: unknown): boolean {
  return typeof raw === "string" && ACTIVE_AUX_STATUSES.has(raw.trim().toLowerCase());
}

/**
 * Determines whether the active thread (or any of its direct child subagents) is currently
 * executing by inspecting real `OrchestrationV2ThreadProjection` (`runs`, `attempts`,
 * `providerTurns`, `turnItems`) and `OrchestrationV2ThreadShell` (`threadShell`).
 */
export function isAgentAuxThreadActivelyRunning(
  projection: AgentAuxProjectionLike | null | undefined,
  relationshipShells?: ReadonlyArray<AgentAuxThreadShellLike> | undefined,
  threadShell?: AgentAuxThreadShellLike | null | undefined,
): boolean {
  // 1. Real OrchestrationV2ThreadShell fields
  if (threadShell && typeof threadShell === "object") {
    const s = threadShell as unknown as Record<string, unknown>;
    if (
      Boolean(s.activeRunId) ||
      isActiveStatusValue(s.status) ||
      isActiveStatusValue(s.activityRunStatus) ||
      isActiveStatusValue((s.runtime as Record<string, unknown> | undefined)?.status) ||
      isActiveStatusValue((s.latestRun as Record<string, unknown> | undefined)?.status)
    ) {
      return true;
    }
  }

  // 2. Real OrchestrationV2ThreadProjection arrays + legacy fields
  if (projection && typeof projection === "object") {
    const rec = projection as unknown as Record<string, unknown>;

    const runs = Array.isArray(rec.runs) ? rec.runs : [];
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const r = runs[i] as Record<string, unknown> | undefined;
      if (r && isActiveStatusValue(r.status)) return true;
    }

    const attempts = Array.isArray(rec.attempts) ? rec.attempts : [];
    for (let i = attempts.length - 1; i >= 0; i -= 1) {
      const a = attempts[i] as Record<string, unknown> | undefined;
      if (a && isActiveStatusValue(a.status)) return true;
    }

    const providerTurns = Array.isArray(rec.providerTurns) ? rec.providerTurns : [];
    for (let i = providerTurns.length - 1; i >= 0; i -= 1) {
      const t = providerTurns[i] as Record<string, unknown> | undefined;
      if (t && isActiveStatusValue(t.status)) return true;
    }

    const turnItems = Array.isArray(rec.turnItems) ? rec.turnItems : [];
    const scanStart = Math.max(0, turnItems.length - 40);
    for (let i = turnItems.length - 1; i >= scanStart; i -= 1) {
      const item = turnItems[i] as Record<string, unknown> | undefined;
      if (item && (item.status === "in_progress" || item.status === "running")) {
        return true;
      }
    }

    // Backward-compatible legacy checks
    const thread =
      rec.thread && typeof rec.thread === "object" ? (rec.thread as Record<string, unknown>) : null;
    if (
      isActiveStatusValue(thread?.status) ||
      isActiveStatusValue(rec.status) ||
      isActiveStatusValue((rec.runtime as Record<string, unknown> | undefined)?.status) ||
      isActiveStatusValue((rec.latestRun as Record<string, unknown> | undefined)?.status) ||
      isActiveStatusValue((rec.session as Record<string, unknown> | undefined)?.status)
    ) {
      return true;
    }
    if (rec.activeTurn && typeof rec.activeTurn === "object") {
      const turnStatus = (rec.activeTurn as Record<string, unknown>).status;
      if (turnStatus === undefined || isActiveStatusValue(turnStatus)) {
        return true;
      }
    }
    if (Array.isArray(projection.subagents)) {
      for (const subagent of projection.subagents) {
        if (isActiveStatusValue((subagent as unknown as Record<string, unknown>)?.status)) {
          return true;
        }
      }
    }
  }

  // 3. Direct child relationship shells
  if (Array.isArray(relationshipShells)) {
    for (const shell of relationshipShells) {
      const rec = shell as unknown as Record<string, unknown>;
      if (
        Boolean(rec.activeRunId) ||
        isActiveStatusValue(rec.activityRunStatus) ||
        isActiveStatusValue((rec.runtime as Record<string, unknown> | undefined)?.status) ||
        isActiveStatusValue((rec.latestRun as Record<string, unknown> | undefined)?.status) ||
        isActiveStatusValue((rec.source as Record<string, unknown> | undefined)?.status) ||
        isActiveStatusValue(rec.status)
      ) {
        return true;
      }
    }
  }
  return false;
}

export interface SwarmProjectionSignals {
  readonly swarmSignalCount: number;
  readonly extractedBrainConvId: string | null;
}

function collectStringsShallow(value: unknown, out: string[], depth = 0): void {
  if (depth > 2 || value == null) return;
  if (typeof value === "string") {
    if (value.length > 0 && value.length <= 4096) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 16); i += 1) {
      collectStringsShallow(value[i], out, depth + 1);
    }
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    for (let i = 0; i < Math.min(entries.length, 16); i += 1) {
      const entry = entries[i];
      if (entry) collectStringsShallow(entry[1], out, depth + 1);
    }
  }
}

/**
 * Scans the tail of `projection.turnItems` (bounded to last 200 items) to detect AGY `/swarm`
 * tool calls (`swarm`, `post_message`, `read_board`, `swarm_wait`) and extract the exact
 * `antigravity-cli/brain/<uuid>/.system_generated/swarm/` conversation UUID fallback.
 */
export function extractSwarmSignalsFromProjection(
  projection: AgentAuxProjectionLike | null | undefined,
): SwarmProjectionSignals {
  if (!projection || typeof projection !== "object") {
    return { swarmSignalCount: 0, extractedBrainConvId: null };
  }
  const turnItems = Array.isArray(projection.turnItems) ? projection.turnItems : [];
  if (turnItems.length === 0) {
    return { swarmSignalCount: 0, extractedBrainConvId: null };
  }

  let swarmSignalCount = 0;
  let extractedBrainConvId: string | null = null;
  const start = Math.max(0, turnItems.length - 200);

  for (let i = start; i < turnItems.length; i += 1) {
    const item = turnItems[i] as Record<string, unknown> | undefined;
    if (!item || typeof item !== "object") continue;

    const itemType = typeof item.type === "string" ? item.type : "";
    let matchedSignal = false;

    const toolLabelCandidates = [item.toolName, item.name, item.title, item.command];
    for (const cand of toolLabelCandidates) {
      if (typeof cand === "string" && SWARM_TOOL_NAME_RE.test(cand)) {
        matchedSignal = true;
        break;
      }
    }

    const pathCandidates: string[] = [];
    if (typeof item.fileName === "string") pathCandidates.push(item.fileName);
    if (typeof item.path === "string") pathCandidates.push(item.path);
    if (typeof item.filePath === "string") pathCandidates.push(item.filePath);
    if (Array.isArray(item.changes)) {
      for (const ch of item.changes) {
        if (ch && typeof ch === "object") {
          const p =
            (ch as Record<string, unknown>).path ?? (ch as Record<string, unknown>).fileName;
          if (typeof p === "string") pathCandidates.push(p);
        }
      }
    }

    for (const p of pathCandidates) {
      if (SWARM_FILE_PATH_RE.test(p)) {
        matchedSignal = true;
      }
      const uuidMatch = AGY_SWARM_PATH_CONV_RE.exec(p);
      if (uuidMatch?.[1]) {
        extractedBrainConvId = uuidMatch[1];
        matchedSignal = true;
      }
    }

    // Check tool inputs/outputs & agent_message text for brain/<uuid>/.system_generated/swarm paths
    if (
      !extractedBrainConvId ||
      itemType === "dynamic_tool" ||
      itemType === "mcp_tool" ||
      itemType === "file_change" ||
      itemType === "agent_message"
    ) {
      const textFragments: string[] = [];
      collectStringsShallow(item.input, textFragments);
      collectStringsShallow(item.arguments, textFragments);
      collectStringsShallow(item.output, textFragments);
      collectStringsShallow(item.text, textFragments);
      collectStringsShallow(item.content, textFragments);
      for (const frag of textFragments) {
        const uuidMatch = AGY_SWARM_PATH_CONV_RE.exec(frag);
        if (uuidMatch?.[1]) {
          extractedBrainConvId = uuidMatch[1];
          matchedSignal = true;
          break;
        }
      }
    }

    if (matchedSignal) {
      swarmSignalCount += 1;
    }
  }

  return { swarmSignalCount, extractedBrainConvId };
}

export const MAX_AUTO_OPENED_ACTIVATION_KEYS = 200;
const autoOpenedActivationKeys = new Set<string>();

export function recordAutoOpenedActivationKey(compositeKey: string): void {
  autoOpenedActivationKeys.delete(compositeKey);
  autoOpenedActivationKeys.add(compositeKey);
  while (autoOpenedActivationKeys.size > MAX_AUTO_OPENED_ACTIVATION_KEYS) {
    const oldestKey = autoOpenedActivationKeys.values().next().value;
    if (oldestKey === undefined) break;
    autoOpenedActivationKeys.delete(oldestKey);
  }
}

export function resetAgentAuxAutoOpenMemoryForTest(): void {
  autoOpenedActivationKeys.clear();
}

export function getAutoOpenedActivationKeyCountForTest(): number {
  return autoOpenedActivationKeys.size;
}

export function hasAutoOpenedActivationKeyForTest(compositeKey: string): boolean {
  return autoOpenedActivationKeys.has(compositeKey);
}

function sanitizeNativeSessionId(raw: unknown): string | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length >= 6 && trimmed.length <= 160 ? trimmed : null;
  }
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.nativeId === "string") {
      return sanitizeNativeSessionId(rec.nativeId);
    }
    if (typeof rec.id === "string") {
      return sanitizeNativeSessionId(rec.id);
    }
  }
  return null;
}

export function extractAgentAuxProviderSessionId(
  projection: AgentAuxProjectionLike | null | undefined,
): string | null {
  if (!projection || typeof projection !== "object") return null;
  const rec = projection as unknown as Record<string, unknown>;
  const providerThreads = Array.isArray(rec.providerThreads) ? rec.providerThreads : [];
  for (let i = providerThreads.length - 1; i >= 0; i -= 1) {
    const entry = providerThreads[i];
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const nativeId = sanitizeNativeSessionId(item.nativeThreadRef);
    if (nativeId) return nativeId;
    const sessionId = sanitizeNativeSessionId(item.providerSessionId);
    if (sessionId) return sessionId;
  }
  const thread = rec.thread;
  if (thread && typeof thread === "object") {
    const direct = sanitizeNativeSessionId((thread as Record<string, unknown>).providerSessionId);
    if (direct) return direct;
  }
  return null;
}

export interface UseAgentAuxActivationInput {
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly isServerThread: boolean;
  readonly embedded?: boolean;
  readonly provider: string | null | undefined;
  readonly cwd: string | null | undefined;
  readonly projection: AgentAuxProjectionLike | null | undefined;
  readonly threadShell?: AgentAuxThreadShellLike | null | undefined;
  readonly relationshipShells?: ReadonlyArray<AgentAuxThreadShellLike> | undefined;
  readonly isProviderNativeSubagent?: boolean;
}

export interface UseAgentAuxActivationResult {
  readonly model: AgentAuxViewModel;
  readonly overviewEntry: AgentAuxOverviewEntryData | null;
  readonly isLoading: boolean;
  readonly refresh: () => void;
  readonly openAuxPanel: () => void;
}

export function useAgentAuxActivation(
  input: UseAgentAuxActivationInput,
): UseAgentAuxActivationResult {
  const {
    activeThreadRef,
    isServerThread,
    embedded = false,
    provider,
    cwd,
    projection,
    threadShell,
    relationshipShells,
    isProviderNativeSubagent = false,
  } = input;

  const locale = useAgentAuxLocale();

  const [snapshotState, setSnapshotState] = useState<{
    readonly threadKey: string | null;
    readonly snapshot: DaemonAgentAuxInspectResponse | null;
  }>({ threadKey: null, snapshot: null });
  const [isLoading, setIsLoading] = useState(false);
  const [sseFailedForKey, setSseFailedForKey] = useState<string | null>(null);
  const [docVisible, setDocVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );

  const fetchSeqRef = useRef(0);
  const etagRef = useRef<{ readonly key: string; readonly value: string | null }>({
    key: "",
    value: null,
  });
  const prevRunningRef = useRef<boolean>(false);

  const threadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const daemonSnapshot = snapshotState.threadKey === threadKey ? snapshotState.snapshot : null;

  const isAuxPanelOpen = useRightPanelStore((state) => {
    if (!threadKey) return false;
    const panel = state.byThreadKey[threadKey];
    return Boolean(panel?.isOpen && panel.activeSurfaceId === "agent-aux");
  });

  const isThreadRunning = isAgentAuxThreadActivelyRunning(
    projection,
    relationshipShells,
    threadShell,
  );

  const swarmSignals = extractSwarmSignalsFromProjection(projection);

  const providerSessionId = extractAgentAuxProviderSessionId(projection);
  // Priority 1: exact brain/<uuid> path from plan.json/turnItems; Priority 2: providerThreads nativeId
  const effectiveSessionId = swarmSignals.extractedBrainConvId ?? providerSessionId;

  const nativeChildWorkAtom =
    isServerThread && activeThreadRef && isProviderNativeSubagent
      ? orchestrationEnvironment.nativeChildWork({
          environmentId: activeThreadRef.environmentId,
          input: { threadId: activeThreadRef.threadId },
        })
      : null;

  const nativeChildWorkQuery = useEnvironmentQuery<
    OrchestrationV2GetNativeChildWorkResult,
    unknown
  >(nativeChildWorkAtom);

  // Track page visibility to pause/resume live SSE streams cleanly
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to DOM visibilitychange event
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      setDocVisible(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const fetchSnapshot = useStableCallback(
    async (params?: {
      readonly targetThreadKey?: string | null;
      readonly targetProvider?: string | null | undefined;
      readonly targetSessionId?: string | null;
      readonly targetCwd?: string | null | undefined;
      readonly force?: boolean;
    }) => {
      const effectiveThreadKey = params ? (params.targetThreadKey ?? null) : threadKey;
      const effectiveProvider = params ? params.targetProvider : provider;
      const targetSid = params ? (params.targetSessionId ?? null) : effectiveSessionId;
      const effectiveCwd = params ? params.targetCwd : cwd;
      if (!isServerThread || !activeThreadRef || !effectiveThreadKey) {
        etagRef.current = { key: "", value: null };
        setSnapshotState({ threadKey: effectiveThreadKey, snapshot: null });
        return;
      }
      if (!targetSid && !effectiveCwd?.trim()) {
        etagRef.current = { key: "", value: null };
        setSnapshotState({ threadKey: effectiveThreadKey, snapshot: null });
        return;
      }
      const seq = ++fetchSeqRef.current;
      const currentStreamKey = `${effectiveThreadKey}:${targetSid ?? ""}`;
      const cachedEtag =
        !params?.force && etagRef.current.key === currentStreamKey ? etagRef.current.value : null;
      if (params?.force) {
        setIsLoading(true);
      }
      try {
        const result = await inspectAgentAux({
          provider: effectiveProvider ?? null,
          sessionId: targetSid,
          cwd: effectiveCwd ?? null,
          etag: cachedEtag,
        });
        if (fetchSeqRef.current === seq) {
          if (result.etag) {
            etagRef.current = { key: currentStreamKey, value: result.etag };
          }
          if (result.unchanged === true) {
            // Keep existing full snapshot intact on 304/unchanged fast path
            setSnapshotState((prev) =>
              prev.threadKey === effectiveThreadKey && prev.snapshot
                ? prev
                : { threadKey: effectiveThreadKey, snapshot: result },
            );
          } else {
            setSnapshotState({ threadKey: effectiveThreadKey, snapshot: result });
          }
        }
      } catch {
        if (fetchSeqRef.current === seq && params?.force) {
          setSnapshotState({ threadKey: effectiveThreadKey, snapshot: null });
        }
      } finally {
        if (fetchSeqRef.current === seq) {
          setIsLoading(false);
        }
      }
    },
  );

  const streamKey = `${threadKey ?? ""}:${effectiveSessionId ?? ""}`;
  const sseUnavailable = sseFailedForKey === streamKey;
  const signalCount = swarmSignals.swarmSignalCount;

  // Tier 1: Immediate one-shot probe on mount, sessionId/signal change, and turn settle (zero idle timers!)
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- performs one-shot daemon inspect when thread/signals mount or settle
  useEffect(() => {
    if (!isServerThread || !activeThreadRef || !threadKey) return;
    if (!effectiveSessionId && !cwd?.trim()) return;
    void fetchSnapshot({
      targetThreadKey: threadKey,
      targetProvider: provider,
      targetSessionId: effectiveSessionId,
      targetCwd: cwd,
      force: signalCount > 0,
    });
  }, [
    isServerThread,
    activeThreadRef,
    threadKey,
    provider,
    effectiveSessionId,
    cwd,
    signalCount,
    fetchSnapshot,
  ]);

  // Also run a single settle inspect when a running turn finishes (captures final [done] & retired members)
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- triggers single post-turn settle inspect
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = isThreadRunning;
    if (wasRunning && !isThreadRunning && isServerThread && activeThreadRef && threadKey) {
      void fetchSnapshot({
        targetThreadKey: threadKey,
        targetProvider: provider,
        targetSessionId: effectiveSessionId,
        targetCwd: cwd,
      });
    }
  }, [
    isThreadRunning,
    isServerThread,
    activeThreadRef,
    threadKey,
    provider,
    effectiveSessionId,
    cwd,
    fetchSnapshot,
  ]);

  const shouldStreamLive =
    isServerThread &&
    Boolean(activeThreadRef) &&
    Boolean(effectiveSessionId || cwd?.trim()) &&
    docVisible &&
    (isAuxPanelOpen ||
      isThreadRunning ||
      swarmSignals.swarmSignalCount > 0 ||
      Boolean(daemonSnapshot?.hasLiveWork));

  // Tier 2: Live SSE push via GET /v1/agent-aux/events (~250ms latency)
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages SSE subscription lifecycle for active swarms / open panel
  useEffect(() => {
    if (!shouldStreamLive || sseUnavailable || !threadKey) return;
    const unsubscribe = subscribeAgentAuxEvents(
      {
        provider: provider ?? null,
        sessionId: effectiveSessionId,
        cwd: cwd ?? null,
      },
      (snapshot) => {
        if (snapshot.etag) {
          etagRef.current = { key: streamKey, value: snapshot.etag };
        }
        if (snapshot.unchanged !== true) {
          setSnapshotState({ threadKey, snapshot });
        }
      },
      {
        onOpen: () => {
          setSseFailedForKey((prev) => (prev === streamKey ? null : prev));
        },
        onError: () => {
          setSseFailedForKey(streamKey);
        },
      },
    );
    return unsubscribe;
  }, [shouldStreamLive, sseUnavailable, streamKey, threadKey, provider, effectiveSessionId, cwd]);

  // Tier 3: Adaptive polling fallback ONLY when SSE is unavailable/disconnected
  const fallbackPollIntervalMs =
    !shouldStreamLive || !sseUnavailable
      ? null
      : isAuxPanelOpen && (isThreadRunning || Boolean(daemonSnapshot?.hasLiveWork))
        ? AGENT_AUX_ACTIVE_POLL_INTERVAL_MS
        : isThreadRunning || swarmSignals.swarmSignalCount > 0
          ? AGENT_AUX_BACKGROUND_POLL_INTERVAL_MS
          : isAuxPanelOpen
            ? AGENT_AUX_POLL_INTERVAL_MS
            : null;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages adaptive ETag fallback polling timer when SSE is unavailable
  useEffect(() => {
    if (fallbackPollIntervalMs === null || !threadKey) return;
    const params = {
      targetThreadKey: threadKey,
      targetProvider: provider,
      targetSessionId: effectiveSessionId,
      targetCwd: cwd,
    };
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetchSnapshot(params);
    }, fallbackPollIntervalMs);
    return () => window.clearInterval(timer);
  }, [fallbackPollIntervalMs, threadKey, provider, effectiveSessionId, cwd, fetchSnapshot]);

  const model = buildAgentAuxViewModel({
    provider,
    threadId: activeThreadRef?.threadId ?? null,
    daemonSnapshot,
    projection,
    threadShell,
    relationshipShells,
    nativeChildWork: nativeChildWorkQuery.data?.children,
    locale,
  });

  const overviewEntry = toAgentAuxOverviewEntry(model);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- pushes active agent-aux metadata and one-shot auto-open into external zustand right-panel store
  useEffect(() => {
    if (!activeThreadRef || !model.active || !model.kind) return;
    const store = useRightPanelStore.getState();

    store.updateAgentAux(activeThreadRef, {
      title: model.title || model.badgeLabel,
      auxKind: model.kind,
      provider: model.provider,
      activeCount: model.activeCount,
    });

    const compositeKey = shouldAutoOpenAgentAux({
      isServerThread,
      embedded,
      threadKey,
      model,
      autoOpenedKeys: autoOpenedActivationKeys,
      swarmSignalCount: swarmSignals.swarmSignalCount,
    });
    if (!compositeKey) return;

    recordAutoOpenedActivationKey(compositeKey);
    store.openAgentAux(
      activeThreadRef,
      {
        title: model.title || model.badgeLabel,
        auxKind: model.kind,
        provider: model.provider,
        activeCount: model.activeCount,
      },
      true,
    );
  }, [activeThreadRef, embedded, isServerThread, model, threadKey, swarmSignals.swarmSignalCount]);

  const openAuxPanel = () => {
    if (!activeThreadRef || !model.active || !model.kind) return;
    useRightPanelStore.getState().openAgentAux(activeThreadRef, {
      title: model.title || model.badgeLabel,
      auxKind: model.kind,
      provider: model.provider,
      activeCount: model.activeCount,
    });
  };

  const refresh = () => {
    setSseFailedForKey(null);
    void fetchSnapshot({ force: true });
    if (nativeChildWorkAtom) nativeChildWorkQuery.refresh();
  };

  return {
    model,
    overviewEntry,
    isLoading,
    refresh,
    openAuxPanel,
  };
}
