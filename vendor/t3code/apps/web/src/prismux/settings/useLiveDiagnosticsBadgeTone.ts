import { useCallback, useEffect, useRef, useState } from "react";

import type { PrismuxDaemonClient } from "../daemonClient";
import {
  resolveDiagnosticsBadgeTone,
  type DiagnosticsBadgeTone,
} from "../../components/sidebar/prismuxSidebarQuickNav.logic";
import {
  createDiagnosticsRefreshController,
  DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS,
  getLatestDiagnosticsResponse,
  isDiagnosticsAutoRefreshSettingsPath,
  publishDiagnosticsReport,
  subscribeDiagnosticsRefreshRequest,
  subscribeDiagnosticsReport,
} from "./prismuxDiagnostics.logic";

const DIAGNOSTICS_ROUTE = "/settings/diagnostics";

/**
 * Keeps the left sidebar "Service Diagnostics" status dot live and in lockstep
 * with `/settings/diagnostics`, window focus / visibility hot-reloads (3s
 * cooldown), plugin mutations, and leaving provider/plugin settings pages.
 */
export function useLiveDiagnosticsBadgeTone(
  daemon: PrismuxDaemonClient | null,
  daemonReady: boolean,
  pathname: string,
): DiagnosticsBadgeTone {
  const [tone, setTone] = useState<DiagnosticsBadgeTone>(() =>
    resolveDiagnosticsBadgeTone(getLatestDiagnosticsResponse()),
  );
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const prevPathnameRef = useRef(pathname);
  const inFlightRef = useRef(false);

  const runFetch = useCallback(
    async (force: boolean) => {
      if (!daemon || !daemonReady || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const response = force
          ? await daemon.refreshDiagnosticsServices()
          : await daemon.fetchDiagnosticsServices(false);
        publishDiagnosticsReport(response);
        setTone(resolveDiagnosticsBadgeTone(response));
      } catch {
        // Leave existing tone intact if Daemon diagnostics is temporarily unreachable.
      } finally {
        inFlightRef.current = false;
      }
    },
    [daemon, daemonReady],
  );

  const controllerRef = useRef(
    createDiagnosticsRefreshController(
      () => {
        void runFetch(true);
      },
      { cooldownMs: DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS },
    ),
  );

  // Recreate controller callback binding whenever runFetch changes while preserving cooldown timestamp.
  useEffect(() => {
    const prevTimestamp = controllerRef.current.getLastTriggeredAt();
    const next = createDiagnosticsRefreshController(
      () => {
        void runFetch(true);
      },
      { cooldownMs: DIAGNOSTICS_AUTO_REFRESH_COOLDOWN_MS },
    );
    if (Number.isFinite(prevTimestamp)) {
      next.markRefreshed(prevTimestamp);
    }
    controllerRef.current = next;
  }, [runFetch]);

  // 1. Live sync whenever any diagnostics view publishes a fresh report.
  useEffect(() => {
    return subscribeDiagnosticsReport(({ response }) => {
      setTone(resolveDiagnosticsBadgeTone(response));
      controllerRef.current.markRefreshed();
    });
  }, []);

  // 2. Initial non-blocking probe when Daemon becomes ready (if not already populated).
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads read-only daemon badge summary when daemon becomes ready
  useEffect(() => {
    if (!daemon || !daemonReady) return;
    const existing = getLatestDiagnosticsResponse();
    if (existing) {
      setTone(resolveDiagnosticsBadgeTone(existing));
      return;
    }
    void runFetch(false);
  }, [daemon, daemonReady, runFetch]);

  // 3. Subscribe to explicit hot-reload broadcasts (e.g. plugin install/uninstall/toggle).
  useEffect(() => {
    if (!daemon || !daemonReady) return;
    return subscribeDiagnosticsRefreshRequest((reason) => {
      // When already on /settings/diagnostics, PrismuxDiagnosticsSection handles the refresh
      // and publishes the result back to this hook via subscribeDiagnosticsReport.
      if (pathnameRef.current === DIAGNOSTICS_ROUTE) return;
      controllerRef.current.trigger(reason, { bypassCooldown: true });
    });
  }, [daemon, daemonReady]);

  // 4. Auto hot-reload when returning to the Prismux window (debounced 3s).
  useEffect(() => {
    if (!daemon || !daemonReady) return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const handleFocus = () => {
      if (pathnameRef.current === DIAGNOSTICS_ROUTE) return;
      controllerRef.current.trigger("focus");
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (pathnameRef.current === DIAGNOSTICS_ROUTE) return;
      controllerRef.current.trigger("visibility");
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [daemon, daemonReady]);

  // 5. Auto hot-reload when leaving Provider / Plugin / Memory / Sync / Updates / Wallpaper settings.
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (!daemon || !daemonReady) return;
    if (prev === pathname) return;
    if (pathname === DIAGNOSTICS_ROUTE) return;
    if (isDiagnosticsAutoRefreshSettingsPath(prev)) {
      controllerRef.current.trigger("settings-left", { bypassCooldown: true });
    }
  }, [daemon, daemonReady, pathname]);

  return tone;
}
