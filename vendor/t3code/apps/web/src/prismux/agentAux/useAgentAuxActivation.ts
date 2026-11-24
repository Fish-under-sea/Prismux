import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  OrchestrationV2GetNativeChildWorkResult,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const POLL_INTERVAL_MS = 4000;

// Module-level memory so auto-open fires strictly ONCE per (threadKey + activationKey),
// even if the user closes the right sidebar tab and switches back and forth.
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

  const [daemonSnapshot, setDaemonSnapshot] = useState<DaemonAgentAuxInspectResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fetchSeqRef = useRef(0);

  const threadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const providerSessionId = useMemo(
    () => extractAgentAuxProviderSessionId(projection),
    [projection],
  );

  // Read nativeChildWork only for server threads that are provider-native subagents
  const nativeChildWorkAtom = useMemo(() => {
    if (!isServerThread || !activeThreadRef || !isProviderNativeSubagent) return null;
    return orchestrationEnvironment.nativeChildWork({
      environmentId: activeThreadRef.environmentId,
      input: { threadId: activeThreadRef.threadId },
    });
  }, [isServerThread, activeThreadRef, isProviderNativeSubagent]);

  const nativeChildWorkQuery = useEnvironmentQuery<
    OrchestrationV2GetNativeChildWorkResult,
    unknown
  >(nativeChildWorkAtom);

  const fetchSnapshot = useCallback(async () => {
    if (!isServerThread || !activeThreadRef) {
      setDaemonSnapshot(null);
      return;
    }
    if (!providerSessionId && !cwd?.trim()) {
      setDaemonSnapshot(null);
      return;
    }
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    try {
      const result = await inspectAgentAux({
        provider: provider ?? null,
        sessionId: providerSessionId,
        cwd: cwd ?? null,
      });
      if (fetchSeqRef.current === seq) {
        setDaemonSnapshot(result);
      }
    } catch {
      // Daemon may be offline in standalone dev or test environments; keep T3 live subagents working.
      if (fetchSeqRef.current === seq) {
        setDaemonSnapshot(null);
      }
    } finally {
      if (fetchSeqRef.current === seq) {
        setIsLoading(false);
      }
    }
  }, [isServerThread, activeThreadRef, provider, providerSessionId, cwd]);

  // Reset snapshot on thread switch and poll periodically while mounted on server threads
  useEffect(() => {
    setDaemonSnapshot(null);
    if (!isServerThread || !activeThreadRef) return;
    void fetchSnapshot();
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetchSnapshot();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isServerThread, activeThreadRef, fetchSnapshot]);

  const model = useMemo(
    () =>
      buildAgentAuxViewModel({
        provider,
        threadId: activeThreadRef?.threadId ?? null,
        daemonSnapshot,
        projection,
        relationshipShells,
        nativeChildWork: nativeChildWorkQuery.data?.children,
      }),
    [
      provider,
      activeThreadRef?.threadId,
      daemonSnapshot,
      projection,
      relationshipShells,
      nativeChildWorkQuery.data?.children,
    ],
  );

  const overviewEntry = useMemo(() => toAgentAuxOverviewEntry(model), [model]);

  // Strict activation-only one-shot auto-popup + silent metadata sync when already open
  useEffect(() => {
    if (!activeThreadRef || !model.active || !model.kind) return;
    const store = useRightPanelStore.getState();

    // Keep open tab title/badge up to date without stealing focus or reopening
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
  }, [
    activeThreadRef,
    embedded,
    isServerThread,
    model,
    threadKey,
  ]);

  const openAuxPanel = useCallback(() => {
    if (!activeThreadRef || !model.active || !model.kind) return;
    useRightPanelStore.getState().openAgentAux(activeThreadRef, {
      title: model.title || model.badgeLabel,
      auxKind: model.kind,
      provider: model.provider,
      activeCount: model.activeCount,
    });
  }, [activeThreadRef, model]);

  const refresh = useCallback(() => {
    void fetchSnapshot();
    if (nativeChildWorkAtom) nativeChildWorkQuery.refresh();
  }, [fetchSnapshot, nativeChildWorkAtom, nativeChildWorkQuery]);

  return {
    model,
    overviewEntry,
    isLoading,
    refresh,
    openAuxPanel,
  };
}
