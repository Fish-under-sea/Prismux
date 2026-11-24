import type { EnvironmentId } from "@t3tools/contracts";
import { ArrowUpIcon, RotateCwIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { Spinner } from "../../components/ui/spinner";
import { toastManager } from "../../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import { cn } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatAgentBrandName } from "../agentBrand";
import {
  prismuxDaemonClient,
  type DaemonCliUpdateInstallResponse,
  type DaemonCliUpdateItemDto,
  type DaemonCliUpdatesCheckResponse,
} from "../daemonClient";

export type CliVersionBadgePhase =
  | "readonly"
  | "latest"
  | "checking"
  | "update-available"
  | "updating"
  | "error";

export interface ProviderCliUpdateApi {
  readonly checkCliUpdates: (options?: {
    force?: boolean;
    provider?: string;
  }) => Promise<DaemonCliUpdatesCheckResponse>;
  readonly installCliUpdate: (provider: string) => Promise<DaemonCliUpdateInstallResponse>;
  readonly refreshDiagnostics?: () => Promise<unknown>;
}

export interface ProviderCliVersionBadgeState {
  readonly checking: boolean;
  readonly updating: boolean;
  readonly checkItem: DaemonCliUpdateItemDto | null;
  readonly overrideCurrentVersion: string | null;
  readonly errorMessage: string | null;
  readonly hasAttemptedCheck: boolean;
}

export interface CliVersionBadgeViewModel {
  readonly phase: CliVersionBadgePhase;
  readonly currentVersionLabel: string | null;
  readonly latestVersionLabel: string | null;
  readonly buttonText: string;
  readonly tooltipText: string;
  readonly ariaLabel: string;
  readonly interactive: boolean;
}

const SEMVER_CLEAN_RE =
  /(?:^|[^0-9A-Za-z])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|[^0-9A-Za-z.-])/;

/**
 * Formats a version string consistently with a leading `v` (e.g. `"0.172.0"` -> `"v0.172.0"`,
 * `"2.1.331 (Claude Code)"` -> `"v2.1.331"`).
 */
export function formatCliVersionDisplay(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const match = SEMVER_CLEAN_RE.exec(trimmed);
  if (match?.[1]) {
    return `v${match[1]}`;
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function createInitialCliVersionBadgeState(
  initialCheckItem?: DaemonCliUpdateItemDto | null,
): ProviderCliVersionBadgeState {
  return {
    checking: false,
    updating: false,
    checkItem: initialCheckItem ?? null,
    overrideCurrentVersion: null,
    errorMessage: null,
    hasAttemptedCheck: initialCheckItem != null,
  };
}

export function resolveCliVersionBadgeViewModel(input: {
  readonly providerLabel: string;
  readonly currentVersionProp?: string | null | undefined;
  readonly readOnly?: boolean | undefined;
  readonly state: ProviderCliVersionBadgeState;
}): CliVersionBadgeViewModel | null {
  const { providerLabel, currentVersionProp, readOnly = false, state } = input;
  const effectiveCurrentRaw =
    state.overrideCurrentVersion ??
    state.checkItem?.currentVersion ??
    currentVersionProp ??
    null;
  const currentVersionLabel = formatCliVersionDisplay(effectiveCurrentRaw);
  const latestVersionLabel = formatCliVersionDisplay(state.checkItem?.latestVersion);
  const updateSupported = state.checkItem ? state.checkItem.updateSupported : true;
  const hasUpdate = Boolean(
    !readOnly &&
      updateSupported &&
      state.checkItem?.hasUpdate &&
      latestVersionLabel &&
      latestVersionLabel !== currentVersionLabel,
  );

  if (state.updating) {
    const targetText = latestVersionLabel ? `至 ${latestVersionLabel}` : "至最新版本";
    return {
      phase: "updating",
      currentVersionLabel,
      latestVersionLabel,
      buttonText: "更新中…",
      tooltipText: `正在后台静默更新 ${providerLabel} ${targetText}…`,
      ariaLabel: `正在原地自动更新 ${providerLabel}`,
      interactive: false,
    };
  }

  if (state.errorMessage && !readOnly && updateSupported) {
    return {
      phase: "error",
      currentVersionLabel,
      latestVersionLabel,
      buttonText: latestVersionLabel ? `重试 ${latestVersionLabel}` : "更新失败 · 重试",
      tooltipText: `更新失败：${state.errorMessage} · 点击重试原地自动更新`,
      ariaLabel: `${providerLabel} 更新失败，点击重试`,
      interactive: true,
    };
  }

  if (hasUpdate && latestVersionLabel) {
    const fromLabel = currentVersionLabel ?? "当前版本";
    return {
      phase: "update-available",
      currentVersionLabel,
      latestVersionLabel,
      buttonText: `更新 ${latestVersionLabel}`,
      tooltipText: `当前 ${fromLabel} → 最新 ${latestVersionLabel} · 点击立即原地自动更新`,
      ariaLabel: `将 ${providerLabel} 从 ${fromLabel} 原地更新至 ${latestVersionLabel}`,
      interactive: true,
    };
  }

  if (!currentVersionLabel) {
    return null;
  }

  if (readOnly || !updateSupported) {
    return {
      phase: "readonly",
      currentVersionLabel,
      latestVersionLabel: null,
      buttonText: currentVersionLabel,
      tooltipText: `${providerLabel} ${currentVersionLabel}`,
      ariaLabel: `${providerLabel} 当前版本 ${currentVersionLabel}`,
      interactive: false,
    };
  }

  if (state.checking) {
    return {
      phase: "checking",
      currentVersionLabel,
      latestVersionLabel,
      buttonText: currentVersionLabel,
      tooltipText: `正在检查 ${providerLabel} 是否有新版本…`,
      ariaLabel: `正在检查 ${providerLabel} 更新`,
      interactive: false,
    };
  }

  return {
    phase: "latest",
    currentVersionLabel,
    latestVersionLabel,
    buttonText: currentVersionLabel,
    tooltipText: "已是最新 · 点击检查更新",
    ariaLabel: `${providerLabel} ${currentVersionLabel}，已是最新，点击检查更新`,
    interactive: true,
  };
}

const DEFAULT_CLI_UPDATE_API: ProviderCliUpdateApi = {
  checkCliUpdates: (options) => prismuxDaemonClient.checkCliUpdates(options),
  installCliUpdate: (provider) => prismuxDaemonClient.installCliUpdate(provider),
  refreshDiagnostics: () => prismuxDaemonClient.fetchDiagnosticsServices(true),
};

export interface ProviderCliVersionBadgeProps {
  /** Provider driver kind or instanceId (e.g. "codex", "claudeAgent", "gemini", "opencode", "omp", "antigravity"). */
  readonly provider: string;
  /** Current installed CLI version reported by T3 ServerProvider snapshot (e.g. "0.172.0"). */
  readonly currentVersion?: string | null | undefined;
  /** Human-readable provider display name for tooltips & toasts (e.g. "Codex"). */
  readonly displayName?: string | null | undefined;
  /** Optional T3 environmentId so successful updates automatically refresh live ServerProvider snapshots. */
  readonly environmentId?: EnvironmentId | undefined;
  /** When true (e.g. remote read-only session), renders a quiet read-only version label. */
  readonly readOnly?: boolean | undefined;
  /** Invoked after a successful in-place auto-update so host UI can refresh provider status. */
  readonly onUpdated?: ((result: DaemonCliUpdateInstallResponse) => void) | undefined;
  /** Optional injected Daemon API client (for tests). */
  readonly cliUpdateApi?: ProviderCliUpdateApi | undefined;
  /** Optional pre-populated check item (for SSR / deterministic tests). */
  readonly initialCheckItem?: DaemonCliUpdateItemDto | null | undefined;
  /** Skip automatic background check on mount (defaults to false). */
  readonly disableAutoCheck?: boolean | undefined;
  /** Optional className for wrapper alignment. */
  readonly className?: string | undefined;
}

/**
 * In-place Provider CLI version badge & one-click silent auto-updater:
 * - Up-to-date: calm monospace version (`v0.172.0`); click to force re-check (`已是最新 · 点击检查更新`).
 * - Update available: seamlessly morphs in place into a high-contrast pill button (`↑ 更新 v0.173.0`).
 * - Clicking runs background silent update via Prismux Daemon (`更新中…`) with zero popups/redirects,
 *   then refreshes the displayed version, diagnostics cache, and provider status.
 */
export const ProviderCliVersionBadge = memo(function ProviderCliVersionBadge(
  props: ProviderCliVersionBadgeProps,
) {
  const {
    provider,
    currentVersion,
    displayName,
    environmentId,
    readOnly = false,
    onUpdated,
    cliUpdateApi = DEFAULT_CLI_UPDATE_API,
    initialCheckItem = null,
    disableAutoCheck = false,
    className,
  } = props;

  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const providerLabel = formatAgentBrandName(provider, displayName);
  const [state, setState] = useState<ProviderCliVersionBadgeState>(() =>
    createInitialCliVersionBadgeState(initialCheckItem),
  );
  const checkingRef = useRef(false);
  const updatingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset local state when switching selected provider card
  useEffect(() => {
    checkingRef.current = false;
    updatingRef.current = false;
    setState(createInitialCliVersionBadgeState(initialCheckItem));
  }, [initialCheckItem, provider]);

  const runCheck = useCallback(
    async (force: boolean) => {
      if (readOnly || checkingRef.current || updatingRef.current) return;
      checkingRef.current = true;
      setState((prev) => ({
        ...prev,
        checking: true,
        ...(force ? { errorMessage: null } : {}),
      }));
      try {
        const res = await cliUpdateApi.checkCliUpdates({ force, provider });
        if (!mountedRef.current) return;
        const matched = res.item ?? res.items[0] ?? null;
        setState((prev) => ({
          ...prev,
          checking: false,
          hasAttemptedCheck: true,
          checkItem: matched,
          errorMessage: null,
        }));
      } catch {
        // Silent graceful degradation when Daemon is offline or unreachable
        if (!mountedRef.current) return;
        setState((prev) => ({
          ...prev,
          checking: false,
          hasAttemptedCheck: true,
        }));
      } finally {
        checkingRef.current = false;
      }
    },
    [cliUpdateApi, provider, readOnly],
  );

  // Automatic silent check on mount (backed by Daemon's 15-min cache)
  useEffect(() => {
    if (disableAutoCheck || readOnly || initialCheckItem !== null) return;
    void runCheck(false);
  }, [disableAutoCheck, initialCheckItem, provider, readOnly, runCheck]);

  const runInstall = useCallback(async () => {
    if (readOnly || updatingRef.current) return;
    updatingRef.current = true;
    setState((prev) => ({
      ...prev,
      updating: true,
      checking: false,
      errorMessage: null,
    }));
    try {
      const result = await cliUpdateApi.installCliUpdate(provider);
      if (!mountedRef.current) return;
      const resolvedNewVersion =
        result.newVersion ?? result.item?.currentVersion ?? result.latestVersion;
      const versionBadgeText = formatCliVersionDisplay(resolvedNewVersion) ?? "最新版本";
      setState((prev) => ({
        ...prev,
        updating: false,
        checkItem: result.item ?? prev.checkItem,
        overrideCurrentVersion: resolvedNewVersion ?? prev.overrideCurrentVersion,
        errorMessage: null,
        hasAttemptedCheck: true,
      }));
      toastManager.add({
        type: "success",
        title: `${providerLabel} 已自动更新至 ${versionBadgeText}`,
        description: "服务体检与提供方状态已同步刷新。",
      });
      onUpdated?.(result);
      // Background T3 provider + Daemon diagnostics refresh (non-blocking)
      if (environmentId) {
        void refreshServerProviders({
          environmentId,
          input: { refreshModels: true },
        }).catch(() => undefined);
      }
      void cliUpdateApi.refreshDiagnostics?.().catch(() => undefined);
    } catch (error) {
      if (!mountedRef.current) return;
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "自动更新失败，请检查网络连接或稍后重试。";
      setState((prev) => ({
        ...prev,
        updating: false,
        errorMessage: message,
      }));
      toastManager.add({
        type: "error",
        title: `${providerLabel} 自动更新失败`,
        description: message,
      });
    } finally {
      updatingRef.current = false;
    }
  }, [cliUpdateApi, environmentId, onUpdated, provider, providerLabel, readOnly, refreshServerProviders]);

  const viewModel = resolveCliVersionBadgeViewModel({
    providerLabel,
    currentVersionProp: currentVersion,
    readOnly,
    state,
  });

  if (!viewModel) {
    return null;
  }

  if (viewModel.phase === "readonly") {
    return (
      <code
        data-cli-version-badge={provider}
        data-cli-version-state="readonly"
        className={cn(
          "font-mono text-xs tabular-nums text-muted-foreground select-text",
          className,
        )}
      >
        {viewModel.buttonText}
      </code>
    );
  }

  if (viewModel.phase === "updating") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              disabled
              aria-busy="true"
              aria-label={viewModel.ariaLabel}
              data-cli-version-badge={provider}
              data-cli-version-state="updating"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "inline-flex h-6 shrink-0 cursor-wait items-center gap-1.5 rounded-full border px-2 font-mono text-[11px] font-medium tabular-nums transition-colors",
                "border-primary/35 bg-primary/12 text-primary",
                "dark:border-sky-400/35 dark:bg-sky-500/18 dark:text-sky-200",
                "[[data-pmx-glass='1']_&]:border-sky-300/40 [[data-pmx-glass='1']_&]:bg-sky-500/22 [[data-pmx-glass='1']_&]:text-white [[data-pmx-glass='1']_&]:backdrop-blur-md",
                className,
              )}
            >
              <Spinner size="sm" className="size-3 shrink-0" />
              <span>{viewModel.buttonText}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{viewModel.tooltipText}</TooltipPopup>
      </Tooltip>
    );
  }

  if (viewModel.phase === "update-available") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={viewModel.ariaLabel}
              data-cli-version-badge={provider}
              data-cli-version-state="update-available"
              data-cli-latest-version={viewModel.latestVersionLabel ?? undefined}
              onClick={(event) => {
                event.stopPropagation();
                void runInstall();
              }}
              className={cn(
                "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 font-mono text-[11px] font-semibold tabular-nums transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
                "border-primary/40 bg-primary/12 text-primary shadow-2xs hover:border-primary/60 hover:bg-primary/20",
                "dark:border-sky-400/45 dark:bg-sky-500/18 dark:text-sky-200 dark:hover:border-sky-300/70 dark:hover:bg-sky-500/28",
                "[[data-pmx-glass='1']_&]:border-sky-300/50 [[data-pmx-glass='1']_&]:bg-sky-500/26 [[data-pmx-glass='1']_&]:text-white [[data-pmx-glass='1']_&]:shadow-[0_1px_10px_rgba(56,189,248,0.24)] [[data-pmx-glass='1']_&]:backdrop-blur-md [[data-pmx-glass='1']_&]:hover:bg-sky-500/38",
                className,
              )}
            >
              <ArrowUpIcon className="size-3 shrink-0" aria-hidden="true" />
              <span>{viewModel.buttonText}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{viewModel.tooltipText}</TooltipPopup>
      </Tooltip>
    );
  }

  if (viewModel.phase === "error") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={viewModel.ariaLabel}
              data-cli-version-badge={provider}
              data-cli-version-state="error"
              onClick={(event) => {
                event.stopPropagation();
                void runInstall();
              }}
              className={cn(
                "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 font-mono text-[11px] font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "border-destructive/45 bg-destructive/10 text-destructive hover:bg-destructive/18",
                "dark:border-rose-400/45 dark:bg-rose-500/18 dark:text-rose-200 dark:hover:bg-rose-500/28",
                "[[data-pmx-glass='1']_&]:border-rose-300/50 [[data-pmx-glass='1']_&]:bg-rose-500/25 [[data-pmx-glass='1']_&]:text-white [[data-pmx-glass='1']_&]:backdrop-blur-md",
                className,
              )}
            >
              <RotateCwIcon className="size-3 shrink-0" aria-hidden="true" />
              <span>{viewModel.buttonText}</span>
            </button>
          }
        />
        <TooltipPopup side="top">{viewModel.tooltipText}</TooltipPopup>
      </Tooltip>
    );
  }

  // `latest` or `checking` — quiet monospace version matching Figure 2, clickable to silently re-check
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            disabled={viewModel.phase === "checking"}
            aria-busy={viewModel.phase === "checking" || undefined}
            aria-label={viewModel.ariaLabel}
            data-cli-version-badge={provider}
            data-cli-version-state={viewModel.phase}
            onMouseEnter={() => {
              if (!state.hasAttemptedCheck && !disableAutoCheck) {
                void runCheck(false);
              }
            }}
            onClick={(event) => {
              event.stopPropagation();
              void runCheck(true);
            }}
            className={cn(
              "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 font-mono text-xs tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
              "dark:text-muted-foreground dark:hover:bg-white/[0.08] dark:hover:text-foreground",
              "[[data-pmx-glass='1']_&]:text-white/80 [[data-pmx-glass='1']_&]:hover:bg-white/14 [[data-pmx-glass='1']_&]:hover:text-white",
              viewModel.phase === "checking" && "cursor-wait opacity-80",
              className,
            )}
          >
            {viewModel.phase === "checking" ? (
              <Spinner size="sm" className="size-2.5 shrink-0 opacity-75" />
            ) : null}
            <span>{viewModel.buttonText}</span>
          </button>
        }
      />
      <TooltipPopup side="top">{viewModel.tooltipText}</TooltipPopup>
    </Tooltip>
  );
});
