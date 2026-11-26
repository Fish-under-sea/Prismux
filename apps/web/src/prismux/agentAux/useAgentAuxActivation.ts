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
  type DaemonAgentAuxInspectResponse,
} from "../daemonClient";
import {
  buildAgentAuxViewModel,
  shouldAutoOpenAgentAux,
  type AgentAuxProjectionLike,
  type AgentAuxThreadShellLike,
  type AgentAuxViewModel,
} from "./agentAux.logic";
import {
  toAgentAuxOverviewEntry,
  type AgentAuxOverviewEntryData,
} from "./AgentAuxPanel";

export const AGENT_AUX_POLL_INTERVAL_MS = 12_000;

const ACTIVE_AUX_STATUSES = new Set([
  "running",
  "streaming",
  "in_progress",
  "active",
  "working",
  "pending",
  "queued",
  "starting",
  "thinking",
  "tool_calling",
]);

function isActiveStatusValue(raw: unknown): boolean {
  return typeof raw === "string" && ACTIVE_AUX_STATUSES.has(raw.trim().toLowerCase());
}

/**
 * Determines whether the active thread (or any of its direct child subagents) is currently
 * executing so `/v1/agent-aux/inspect` polling stays strictly gated.
 */
export function isAgentAuxThreadActivelyRunning(
  projection: AgentAuxProjectionLike | null | undefined,
  relationshipShells?: ReadonlyArray<AgentAuxThreadShellLike> | undefined,
): boolean {
  if (projection && typeof projection === "object") {
    const rec = projection as unknown as Record<string, unknown>;
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
        if (isActiveStatusValue((subagent as Record<string, unknown>)?.status)) {
          return true;
        }
      }
    }
  }
  if (Array.isArray(relationshipShells)) {
    for (const shell of relationshipShells) {
      const rec = shell as unknown as Record<string, unknown>;
      if (
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

const autoOpenedActivationKeys = new Set<string>();

export function resetAgentAuxAutoOpenMemoryForTest(): void {
  autoOpenedActivationKeys.clear();
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
    const direct = sanitizeNativeSessionId(
      (thread as Record<string, unknown>).providerSessionId,
    );
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
    relationshipShells,
    isProviderNativeSubagent = false,
  } = input;

  const [snapshotState, setSnapshotState] = useState<{
    readonly threadKey: string | null;
    readonly snapshot: DaemonAgentAuxInspectResponse | null;
  }>({ threadKey: null, snapshot: null });
  const [isLoading, setIsLoading] = useState(false);
  const fetchSeqRef = useRef(0);

  const threadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const daemonSnapshot = snapshotState.threadKey === threadKey ? snapshotState.snapshot : null;

  const isAuxPanelOpen = useRightPanelStore((state) => {
    if (!threadKey) return false;
    const panel = state.byThreadKey[threadKey];
    return Boolean(panel?.isOpen && panel.activeSurfaceId === "agent-aux");
  });
  const isThreadRunning = isAgentAuxThreadActivelyRunning(projection, relationshipShells);
  const shouldPollAux =
    isServerThread && Boolean(activeThreadRef) && (isThreadRunning || isAuxPanelOpen);
  const providerSessionId = extractAgentAuxProviderSessionId(projection);

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

  const fetchSnapshot = useStableCallback(
    async (params?: {
      readonly targetThreadKey?: string | null;
      readonly targetProvider?: string | null | undefined;
      readonly targetSessionId?: string | null;
      readonly targetCwd?: string | null | undefined;
    }) => {
      const effectiveThreadKey = params ? (params.targetThreadKey ?? null) : threadKey;
      const effectiveProvider = params ? params.targetProvider : provider;
      const effectiveSessionId = params ? (params.targetSessionId ?? null) : providerSessionId;
      const effectiveCwd = params ? params.targetCwd : cwd;
      if (!isServerThread || !activeThreadRef || !effectiveThreadKey) {
        setSnapshotState({ threadKey: effectiveThreadKey, snapshot: null });
        return;
      }
      if (!effectiveSessionId && !effectiveCwd?.trim()) {
        setSnapshotState({ threadKey: effectiveThreadKey, snapshot: null });
        return;
      }
      const seq = ++fetchSeqRef.current;
      setIsLoading(true);
      try {
        const result = await inspectAgentAux({
          provider: effectiveProvider ?? null,
          sessionId: effectiveSessionId,
          cwd: effectiveCwd ?? null,
        });
        if (fetchSeqRef.current === seq) {
          setSnapshotState({ threadKey: effectiveThreadKey, snapshot: result });
        }
      } catch {
        if (fetchSeqRef.current === seq) {
          setSnapshotState({ threadKey: effectiveThreadKey, snapshot: null });
        }
      } finally {
        if (fetchSeqRef.current === seq) {
          setIsLoading(false);
        }
      }
    },
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages 12s daemon polling timer gated to running threads or an open agent-aux panel
  useEffect(() => {
    if (!shouldPollAux) return;
    const params = {
      targetThreadKey: threadKey,
      targetProvider: provider,
      targetSessionId: providerSessionId,
      targetCwd: cwd,
    };
    void fetchSnapshot(params);
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetchSnapshot(params);
    }, AGENT_AUX_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [shouldPollAux, threadKey, provider, providerSessionId, cwd, fetchSnapshot]);

  const model = buildAgentAuxViewModel({
    provider,
    threadId: activeThreadRef?.threadId ?? null,
    daemonSnapshot,
    projection,
    relationshipShells,
    nativeChildWork: nativeChildWorkQuery.data?.children,
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
    });
    if (!compositeKey) return;

    autoOpenedActivationKeys.add(compositeKey);
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
  }, [activeThreadRef, embedded, isServerThread, model, threadKey]);

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
    void fetchSnapshot();
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
