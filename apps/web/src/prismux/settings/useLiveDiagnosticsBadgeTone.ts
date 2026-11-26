import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";

import type { DiagnosticsBadgeTone } from "../../components/sidebar/prismuxSidebarQuickNav.logic";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
} from "../../providerInstances";
import { environmentPresentations } from "../../state/presentation";
import type { PrismuxDaemonClient } from "../daemonClient";
import { resolveServerProviderUsageKind } from "../statusBar/statusBarUsage";
import {
  createDiagnosticsRefreshController,
  getLatestNormalizedDiagnosticsReport,
  isDiagnosticsViewPathname,
  publishDiagnosticsReport,
  resolveNormalizedDiagnosticsBadgeTone,
  subscribeDiagnosticsRefreshRequest,
  subscribeDiagnosticsReport,
  type DiagnosticsRefreshController,
  type DiagnosticsRefreshReason,
} from "./prismuxDiagnostics.logic";

/** Minimum cooldown (5 minutes) for passive non-forced visibility refreshes. */
export const DIAGNOSTICS_BADGE_PASSIVE_COOLDOWN_MS = 5 * 60_000;

export function shouldForceRefreshForBadgeReason(reason: DiagnosticsRefreshReason): boolean {
  return reason === "manual" || reason === "plugin-mutated";
}

export function collectConfiguredDiagnosticsProviderIds(
  presentations: ReadonlyMap<
    string,
    {
      readonly serverConfig: {
        readonly providers?: ReadonlyArray<
          Parameters<typeof deriveProviderInstanceEntries>[0][number]
        >;
        readonly settings?: Parameters<typeof brandProviderInstanceEntries>[1];
      } | null;
    }
  >,
): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const presentation of presentations.values()) {
    const config = presentation.serverConfig;
    const providers = config?.providers;
    if (!Array.isArray(providers) || providers.length === 0) continue;
    const derived = deriveProviderInstanceEntries(providers);
    const entries = config?.settings
      ? brandProviderInstanceEntries(derived, config.settings)
      : derived;
    for (const provider of providers) {
      if (!provider.enabled) continue;
      const kind = resolveServerProviderUsageKind(provider, entries).trim().toLowerCase();
      if (!kind || seen.has(kind)) continue;
      seen.add(kind);
      ids.push(kind);
    }
  }
  ids.sort();
  return ids;
}

/**
 * Syncs the sidebar diagnostics badge using cached daemon reads scoped to configured providers.
 * Forced refreshes only run on explicit user/plugin triggers; passive visibility uses a 5m cooldown.
 */
export function useLiveDiagnosticsBadgeTone(
  daemon: PrismuxDaemonClient | null,
  daemonReady: boolean,
  pathname: string,
  configuredProvidersOverride?: readonly string[],
): DiagnosticsBadgeTone {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const configuredProviders =
    configuredProvidersOverride !== undefined
      ? configuredProvidersOverride
      : collectConfiguredDiagnosticsProviderIds(presentations);

  const [tone, setTone] = useState<DiagnosticsBadgeTone>(() =>
    resolveNormalizedDiagnosticsBadgeTone(getLatestNormalizedDiagnosticsReport()),
  );
  const inFlightRef = useRef(false);
  const controllerRef = useRef<DiagnosticsRefreshController | null>(null);

  const runFetch = useStableCallback(async (force: boolean) => {
    if (!daemon || !daemonReady || inFlightRef.current) return;
    inFlightRef.current = true;
    const queryOptions = configuredProviders.length > 0 ? { providers: configuredProviders } : {};
    try {
      const response = force
        ? await daemon.refreshDiagnosticsServices(queryOptions)
        : await daemon.fetchDiagnosticsServices({ force: false, ...queryOptions });
      const report = publishDiagnosticsReport(response);
      setTone(resolveNormalizedDiagnosticsBadgeTone(report));
    } catch {
      // Leave existing tone intact if Daemon diagnostics is temporarily unreachable.
    } finally {
      inFlightRef.current = false;
    }
  });

  const handleRefreshRequest = useStableCallback((reason: DiagnosticsRefreshReason) => {
    if (isDiagnosticsViewPathname(pathname)) return;
    const controller = controllerRef.current;
    if (!controller) return;
    const isExplicit = shouldForceRefreshForBadgeReason(reason);
    controller.trigger(reason, { bypassCooldown: isExplicit });
  });

  const handleVisibilityReturn = useStableCallback(() => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (isDiagnosticsViewPathname(pathname)) return;
    controllerRef.current?.trigger("visibility");
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to shared diagnostics report pub/sub outside React
  useEffect(() => {
    controllerRef.current = createDiagnosticsRefreshController(
      (reason) => {
        void runFetch(shouldForceRefreshForBadgeReason(reason));
      },
      { cooldownMs: DIAGNOSTICS_BADGE_PASSIVE_COOLDOWN_MS },
    );
    return subscribeDiagnosticsReport(({ report }) => {
      setTone(resolveNormalizedDiagnosticsBadgeTone(report));
      controllerRef.current?.markRefreshed();
    });
  }, [runFetch]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- fetches initial read-only cached daemon badge summary when daemon connects
  useEffect(() => {
    if (!daemon || !daemonReady) return;
    const existing = getLatestNormalizedDiagnosticsReport();
    if (existing) {
      controllerRef.current?.markRefreshed();
      return;
    }
    controllerRef.current?.markRefreshed();
    void runFetch(false);
  }, [daemon, daemonReady, runFetch]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to explicit diagnostics refresh broadcasts from outside this hook
  useEffect(() => {
    if (!daemon || !daemonReady) return;
    return subscribeDiagnosticsRefreshRequest(handleRefreshRequest);
  }, [daemon, daemonReady, handleRefreshRequest]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- registers document visibilitychange listener for 5m passive cache re-read
  useEffect(() => {
    if (!daemon || !daemonReady) return;
    if (typeof document === "undefined") return;

    document.addEventListener("visibilitychange", handleVisibilityReturn);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityReturn);
    };
  }, [daemon, daemonReady, handleVisibilityReturn]);

  return tone;
}
