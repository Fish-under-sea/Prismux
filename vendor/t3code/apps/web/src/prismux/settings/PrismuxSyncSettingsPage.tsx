import { AlertTriangleIcon, CheckCircle2Icon, RefreshCwIcon } from "lucide-react";
import { memo, startTransition, useCallback, useRef, useState } from "react";

import { SettingsPageContainer } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { prismuxDaemonClient, type PrismuxDaemonClient } from "../daemonClient";
import { useOptionalPrismuxRuntime } from "../PrismuxRuntimeProvider";
import { PrismuxSyncEngineSection } from "./PrismuxSyncEngineSection";

type SyncPageDaemonSubset = Pick<
  PrismuxDaemonClient,
  "requestJson" | "triggerSyncNow" | "testSyncConnection"
>;

export interface PrismuxSyncSettingsPageProps {
  /** Optional overrides for isolated unit testing without full runtime context. */
  readonly daemonOverride?: SyncPageDaemonSubset;
  readonly daemonReadyOverride?: boolean;
  readonly onSectionRender?: (section: "sync") => void;
}

interface PrismuxSyncSettingsPageShellProps {
  readonly daemon: SyncPageDaemonSubset;
  readonly daemonReady: boolean;
  readonly onSectionRender?: ((section: "sync") => void) | undefined;
}

const PrismuxSyncSettingsPageShell = memo(function PrismuxSyncSettingsPageShell({
  daemon,
  daemonReady,
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
    <SettingsPageContainer width="wide">
      <div
        id="prismux-sync"
        data-pmx-sync-settings-page=""
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/70 px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <RefreshCwIcon className="size-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Prismux 端到端加密同步（Argon2id + AEAD）
          </span>
          <Badge variant={daemonReady ? "success" : "warning"}>
            {daemonReady ? "Daemon 在线" : "Daemon 未连接"}
          </Badge>
        </div>
        <Button size="xs" variant="outline" onClick={handleRefresh}>
          <RefreshCwIcon className="size-3.5" />
          刷新实时状态
        </Button>
      </div>

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
        refreshTick={refreshTick}
        onRender={handleSyncRender}
        onError={handleError}
        onStatus={handleStatus}
      />
    </SettingsPageContainer>
  );
});

/**
 * Dedicated `/settings/sync` control center for Prismux E2EE Sync (Argon2id + AEAD):
 * master passphrase, instant sync & connectivity probe, default-collapsed WebDAV / S3 / GitHub
 * channels, 7-domain sync matrix, and portable mode indicator.
 */
export function PrismuxSyncSettingsPage({
  daemonOverride,
  daemonReadyOverride,
  onSectionRender,
}: PrismuxSyncSettingsPageProps = {}) {
  const runtime = useOptionalPrismuxRuntime();
  const daemon = daemonOverride ?? runtime?.daemon ?? prismuxDaemonClient;
  const daemonReady = daemonReadyOverride ?? runtime?.daemonInfo.ready ?? false;

  return (
    <PrismuxSyncSettingsPageShell
      daemon={daemon}
      daemonReady={daemonReady}
      onSectionRender={onSectionRender}
    />
  );
}
