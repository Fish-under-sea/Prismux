import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { memo, startTransition, useCallback, useRef, useState } from "react";

import { SettingsPageContainer } from "../../components/settings/settingsLayout";
import { prismuxDaemonClient, type PrismuxDaemonClient } from "../daemonClient";
import { useOptionalPrismuxRuntime } from "../PrismuxRuntimeProvider";
import {
  PrismuxSyncEngineSection,
  type PrismuxSyncSettingsTabId,
  type SyncChannelKey,
} from "./PrismuxSyncEngineSection";

type SyncPageDaemonSubset = Pick<
  PrismuxDaemonClient,
  "requestJson" | "triggerSyncNow" | "testSyncConnection"
>;

export interface PrismuxSyncSettingsPageProps {
  /** Optional overrides for isolated unit testing without full runtime context. */
  readonly daemonOverride?: SyncPageDaemonSubset;
  readonly daemonReadyOverride?: boolean;
  readonly initialTabOverride?: PrismuxSyncSettingsTabId;
  readonly initialChannelOverride?: SyncChannelKey;
  readonly onSectionRender?: (section: "sync") => void;
}

interface PrismuxSyncSettingsPageShellProps {
  readonly daemon: SyncPageDaemonSubset;
  readonly daemonReady: boolean;
  readonly initialTabOverride?: PrismuxSyncSettingsTabId | undefined;
  readonly initialChannelOverride?: SyncChannelKey | undefined;
  readonly onSectionRender?: ((section: "sync") => void) | undefined;
}

const PrismuxSyncSettingsPageShell = memo(function PrismuxSyncSettingsPageShell({
  daemon,
  daemonReady,
  initialTabOverride,
  initialChannelOverride,
  onSectionRender,
}: PrismuxSyncSettingsPageShellProps) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const onSectionRenderRef = useRef(onSectionRender);
  onSectionRenderRef.current = onSectionRender;

  const handleSyncRender = useCallback(() => {
    onSectionRenderRef.current?.("sync");
  }, []);

  const handleError = useCallback((message: string | null) => {
    setErrorMsg(message);
  }, []);

  const handleStatus = useCallback((message: string | null) => {
    setStatusMsg(message);
  }, []);

  const handleRefresh = useCallback(() => {
    setErrorMsg(null);
    startTransition(() => {
      setRefreshTick((prev) => prev + 1);
    });
  }, []);

  return (
    <SettingsPageContainer width="readable">
      <div id="prismux-sync" data-pmx-sync-settings-page="" className="space-y-6">
        {errorMsg ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
          >
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 break-all">{errorMsg}</span>
          </div>
        ) : null}

        {statusMsg ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-lg border border-success/35 bg-success/10 px-3.5 py-2.5 text-xs text-success-foreground"
          >
            <CheckCircle2Icon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{statusMsg}</span>
          </div>
        ) : null}

        <PrismuxSyncEngineSection
          daemon={daemon}
          daemonReady={daemonReady}
          refreshTick={refreshTick}
          initialTabOverride={initialTabOverride}
          initialChannelOverride={initialChannelOverride}
          onRefresh={handleRefresh}
          onRender={handleSyncRender}
          onError={handleError}
          onStatus={handleStatus}
        />
      </div>
    </SettingsPageContainer>
  );
});

/**
 * Dedicated `/settings/sync` control center with single header (no duplicate outer card)
 * and 2 segmented tabs (`overview` | `channels`).
 */
export function PrismuxSyncSettingsPage({
  daemonOverride,
  daemonReadyOverride,
  initialTabOverride,
  initialChannelOverride,
  onSectionRender,
}: PrismuxSyncSettingsPageProps = {}) {
  const runtime = useOptionalPrismuxRuntime();
  const daemon = daemonOverride ?? runtime?.daemon ?? prismuxDaemonClient;
  const daemonReady = daemonReadyOverride ?? runtime?.daemonInfo.ready ?? false;

  return (
    <PrismuxSyncSettingsPageShell
      daemon={daemon}
      daemonReady={daemonReady}
      initialTabOverride={initialTabOverride}
      initialChannelOverride={initialChannelOverride}
      onSectionRender={onSectionRender}
    />
  );
}
