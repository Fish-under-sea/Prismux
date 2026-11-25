import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@prismux/core-contracts";
import type { UnifiedSettings } from "@prismux/core-contracts/settings";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ArrowRightLeftIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  Clock3Icon,
  CopyIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  GitBranchIcon,
  KeyRoundIcon,
  LockIcon,
  MailCheckIcon,
  MailIcon,
  MoonStarIcon,
  RefreshCwIcon,
  SaveIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  Unlink2Icon,
  WifiIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SettingsPageContainer, SettingsSection } from "../../components/settings/settingsLayout";
import { useNavigateToMainApp } from "../../components/sidebar/mainAppLocation";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { SidebarInset } from "../../components/ui/sidebar";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../components/ui/tooltip";
import {
  PrismuxStageFrame,
  useWorkspaceTopbarPortal,
} from "../../components/workspace/WorkspaceTopbarPortalContext";
import { usePrimarySettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { primaryServerProvidersAtom } from "../../state/server";
import { AgentBrandLogo } from "../agentBrand";
import {
  prismuxDaemonClient,
  type DaemonOvernightConfigSnapshot,
  type DaemonOvernightInboundMode,
  type DaemonOvernightMailTestResponse,
  type DaemonOvernightRunRecordDto,
  type PrismuxDaemonClient,
} from "../daemonClient";
import { useOptionalPrismuxRuntime } from "../PrismuxRuntimeProvider";
import {
  SUBSCRIPTION_WAIVER_ANCHOR_ID,
  useSubscriptionWaiverState,
  type SubscriptionWaiverState,
} from "../SubscriptionRiskWaiverSection";
import {
  GMAIL_APP_PASSWORD_LINKS,
  GMAIL_OAUTH_QUICK_LINKS,
  GMAIL_OAUTH_SCOPES_TEXT,
  GMAIL_OAUTH_TUTORIAL_STEPS,
  OVERNIGHT_DEFAULT_MODEL_SENTINEL,
  OVERNIGHT_MAIL_PRESETS,
  applyOvernightMailPreset,
  buildOvernightLiveProviderOptions,
  buildOvernightMailSavePayload,
  buildOvernightModelOptions,
  buildOvernightStrategySavePayload,
  createDefaultOvernightDraft,
  evaluateGmailOAuthReadiness,
  evaluateOvernightAgyCompliance,
  formatOvernightRunStatusBadge,
  formatOvernightTimestamp,
  hydrateOvernightDraftFromSnapshot,
  isMailChannelConfigured,
  isSafeHttpsUrl,
  parseAllowedSendersInput,
  resolveGmailOAuthRedirectUri,
  shouldDefaultExpandMailChannel,
  shouldDefaultExpandStrategy,
  toggleTutorialStepCompletion,
  type GmailOAuthTutorialStepNumber,
  type OvernightFactoryDraft,
} from "./overnightFactory.logic";

type OvernightDaemonSubset = Pick<
  PrismuxDaemonClient,
  | "fetchOvernightConfig"
  | "updateOvernightConfig"
  | "testOvernightMail"
  | "sendOvernightTestReport"
  | "pollOvernightNow"
  | "fetchOvernightRuns"
  | "startOvernightGmailOAuth"
  | "disconnectOvernightGmail"
>;

export interface PrismuxOvernightFactorySettingsPageProps {
  /** Render inside a standalone work-panel PrismuxStageFrame (auto-enabled on `/overnight-factory`). */
  readonly standalone?: boolean;
  /** Optional overrides for isolated unit tests without full runtime context. */
  readonly daemonOverride?: OvernightDaemonSubset;
  readonly daemonReadyOverride?: boolean;
  readonly daemonBaseUrlOverride?: string;
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider>;
  readonly settingsOverride?: UnifiedSettings | null;
  readonly waiverOverride?: SubscriptionWaiverState;
  readonly chiefProviderOverride?: string;
  readonly initialSnapshotOverride?: DaemonOvernightConfigSnapshot;
  readonly initialRunsOverride?: readonly DaemonOvernightRunRecordDto[];
  readonly workspaceOptionsOverride?: ReadonlyArray<{ readonly title: string; readonly cwd: string }>;
  readonly onOpenExternalUrl?: (url: string) => void;
}

function defaultOpenExternalUrl(url: string): void {
  if (typeof window === "undefined") return;
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // Fallback ignored in restricted environments.
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
  return false;
}

function isOvernightFactoryEscapeTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  return target.isContentEditable || target.closest("[role='dialog']") !== null;
}

function OvernightSectionCard({
  standalone,
  id,
  title,
  icon,
  headerAction,
  className,
  children,
}: {
  readonly standalone: boolean;
  readonly id: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly headerAction?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  if (!standalone) {
    return (
      <SettingsSection id={id} title={title} icon={icon} headerAction={headerAction}>
        {children}
      </SettingsSection>
    );
  }

  return (
    <section
      id={id}
      data-pmx-work-panel-card="1"
      className={cn(
        "overflow-hidden rounded-xl border border-border/75 bg-card/75 shadow-xs/5",
        className,
      )}
    >
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2.5 border-b border-border/60 bg-muted/20 px-4 py-2.5">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {headerAction ? (
          <div className="flex flex-wrap items-center justify-end gap-2">{headerAction}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PrismuxOvernightFactoryShell({
  standalone,
  daemon,
  daemonReady,
  daemonBaseUrl,
  serverProviders,
  settings,
  waiver,
  chiefProvider,
  initialSnapshotOverride,
  initialRunsOverride,
  workspaceOptions,
  onOpenExternalUrl,
}: {
  readonly standalone: boolean;
  readonly daemon: OvernightDaemonSubset;
  readonly daemonReady: boolean;
  readonly daemonBaseUrl: string;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings | null;
  readonly waiver: SubscriptionWaiverState;
  readonly chiefProvider: string;
  readonly initialSnapshotOverride?: DaemonOvernightConfigSnapshot;
  readonly initialRunsOverride?: readonly DaemonOvernightRunRecordDto[];
  readonly workspaceOptions: ReadonlyArray<{ readonly title: string; readonly cwd: string }>;
  readonly onOpenExternalUrl: (url: string) => void;
}) {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const topbarPortal = useWorkspaceTopbarPortal();
  const [draft, setDraft] = useState<OvernightFactoryDraft>(() =>
    initialSnapshotOverride
      ? hydrateOvernightDraftFromSnapshot(initialSnapshotOverride)
      : createDefaultOvernightDraft(),
  );
  const [runs, setRuns] = useState<readonly DaemonOvernightRunRecordDto[]>(
    () => initialRunsOverride ?? [],
  );
  const [credentialsFile, setCredentialsFile] = useState<string>(
    initialSnapshotOverride?.credentialsFile ?? "~/.prismux/credentials/overnight-factory.enc",
  );
  const [lastPollAt, setLastPollAt] = useState<number | null>(
    initialSnapshotOverride?.runtime.lastPollAt ?? null,
  );
  const [lastPollError, setLastPollError] = useState<string | null>(
    initialSnapshotOverride?.runtime.lastPollError ?? null,
  );
  const [testResult, setTestResult] = useState<DaemonOvernightMailTestResponse | null>(
    initialSnapshotOverride?.runtime.lastTestResult ?? null,
  );
  const [oauthPendingUrl, setOauthPendingUrl] = useState<string | null>(null);

  // In standalone `/overnight-factory` workbench, Block A defaults EXPANDED so the user sees the
  // ready-to-use Generic IMAP/SMTP form immediately without an extra click.
  const [mailExpanded, setMailExpanded] = useState<boolean>(() =>
    standalone
      ? true
      : initialSnapshotOverride
        ? shouldDefaultExpandMailChannel(initialSnapshotOverride, false)
        : false,
  );
  const [strategyExpanded, setStrategyExpanded] = useState<boolean>(() =>
    initialSnapshotOverride ? shouldDefaultExpandStrategy(initialSnapshotOverride) : false,
  );

  // Interactive Google OAuth2 guided tutorial state (default open when Gmail OAuth2 is unconnected).
  const [oauthTutorialOpen, setOauthTutorialOpen] = useState<boolean>(
    () => !(initialSnapshotOverride?.config.gmail.connected ?? false),
  );
  const [activeTutorialStep, setActiveTutorialStep] = useState<GmailOAuthTutorialStepNumber>(1);
  const [completedTutorialSteps, setCompletedTutorialSteps] = useState<
    GmailOAuthTutorialStepNumber[]
  >([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [savingMail, setSavingMail] = useState<boolean>(false);
  const [testingMail, setTestingMail] = useState<boolean>(false);
  const [sendingReport, setSendingReport] = useState<boolean>(false);
  const [startingOAuth, setStartingOAuth] = useState<boolean>(false);
  const [disconnectingGmail, setDisconnectingGmail] = useState<boolean>(false);
  const [savingStrategy, setSavingStrategy] = useState<boolean>(false);
  const [pollingNow, setPollingNow] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleOpenWaiverSettings = useCallback(() => {
    void navigate({
      to: "/settings/providers",
      hash: SUBSCRIPTION_WAIVER_ANCHOR_ID,
    });
  }, [navigate]);

  const handleOpenProvidersSettings = useCallback(() => {
    void navigate({
      to: "/settings/providers",
    });
  }, [navigate]);

  const handleOpenHttpsUrl = useCallback(
    (url: string) => {
      if (!isSafeHttpsUrl(url)) return;
      onOpenExternalUrl(url);
    },
    [onOpenExternalUrl],
  );

  const handleCopyText = useCallback(async (key: string, value: string, label: string) => {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedKey(key);
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopiedKey(null);
        copiedTimerRef.current = null;
      }, 2000);
      setStatusMsg(`已复制${label}到剪贴板。`);
    } else {
      setErrorMsg(`无法自动复制${label}，请手动选中文本框内容复制。`);
    }
  }, []);

  const applySnapshot = useCallback(
    (snapshot: DaemonOvernightConfigSnapshot, syncCollapse = false) => {
      setDraft(hydrateOvernightDraftFromSnapshot(snapshot));
      setCredentialsFile(snapshot.credentialsFile);
      setLastPollAt(snapshot.runtime.lastPollAt);
      setLastPollError(snapshot.runtime.lastPollError);
      if (snapshot.runtime.lastTestResult) {
        setTestResult(snapshot.runtime.lastTestResult);
      }
      if (syncCollapse) {
        setMailExpanded(shouldDefaultExpandMailChannel(snapshot, standalone));
        setStrategyExpanded(shouldDefaultExpandStrategy(snapshot));
        setOauthTutorialOpen(!snapshot.config.gmail.connected);
      }
    },
    [standalone],
  );

  const loadAll = useCallback(
    async (syncCollapse = false) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const [snap, runsResp] = await Promise.all([
          daemon.fetchOvernightConfig(),
          daemon.fetchOvernightRuns(30),
        ]);
        applySnapshot(snap, syncCollapse);
        setRuns(runsResp.runs);
        setLastPollAt(runsResp.lastPollAt ?? snap.runtime.lastPollAt);
        setLastPollError(runsResp.lastPollError ?? snap.runtime.lastPollError);
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : "加载夜间工场与邮箱配置失败，请确认 Daemon 已启动。",
        );
      } finally {
        setLoading(false);
      }
    },
    [applySnapshot, daemon],
  );

  useEffect(() => {
    if (initialSnapshotOverride) return;
    void loadAll(true);
  }, [initialSnapshotOverride, loadAll]);

  const providerOptions = useMemo(
    () => buildOvernightLiveProviderOptions({ serverProviders, settings }),
    [serverProviders, settings],
  );
  const liveConfiguredProviders = useMemo(
    () => providerOptions.filter((item) => !item.isChief),
    [providerOptions],
  );
  const firstCompliantProvider = useMemo(
    () => liveConfiguredProviders.find((item) => !item.isAntigravity),
    [liveConfiguredProviders],
  );
  const activeProviderOption = useMemo(
    () => providerOptions.find((item) => item.id === draft.agentProvider),
    [draft.agentProvider, providerOptions],
  );
  const modelOptions = useMemo(
    () =>
      buildOvernightModelOptions({
        selectedProvider: activeProviderOption,
        currentModel: draft.agentModel,
      }),
    [activeProviderOption, draft.agentModel],
  );
  const agyCompliance = useMemo(
    () =>
      evaluateOvernightAgyCompliance({
        agentProvider: draft.agentProvider,
        chiefProvider,
        waiver,
      }),
    [chiefProvider, draft.agentProvider, waiver],
  );

  const handleSaveMail = async () => {
    setSavingMail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = buildOvernightMailSavePayload(draft);
      const updated = await daemon.updateOvernightConfig(payload);
      applySnapshot(updated, false);
      setStatusMsg("邮箱配置已保存，敏感授权码/密钥已以 0600 权限加密密封写入本地凭据库。");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "保存邮箱配置失败。");
    } finally {
      setSavingMail(false);
    }
  };

  const handleTestMail = async () => {
    setTestingMail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = buildOvernightMailSavePayload(draft);
      const res = await daemon.testOvernightMail(payload);
      setTestResult(res);
      if (res.ok) {
        setStatusMsg(res.message);
      } else {
        setErrorMsg(res.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "邮箱收发连通性测试失败。");
    } finally {
      setTestingMail(false);
    }
  };

  const handleSendTestReport = async () => {
    setSendingReport(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = buildOvernightMailSavePayload(draft);
      const res = await daemon.sendOvernightTestReport(payload);
      setStatusMsg(`${res.message}（Message-ID: ${res.messageId}）`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "发送测试早报失败。");
    } finally {
      setSendingReport(false);
    }
  };

  const handleStartGmailOAuth = async () => {
    setStartingOAuth(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.startOvernightGmailOAuth({
        ...(draft.gmailClientId.trim() ? { clientId: draft.gmailClientId.trim() } : {}),
        ...(draft.gmailClientSecretInput.trim()
          ? { clientSecret: draft.gmailClientSecretInput.trim() }
          : {}),
        ...(draft.gmailRedirectUri.trim() ? { redirectUri: draft.gmailRedirectUri.trim() } : {}),
      });
      setOauthPendingUrl(res.authUrl);
      setDraft((prev) => ({
        ...prev,
        gmailRedirectUri: res.redirectUri,
        gmailClientSecretInput: "",
        hasGmailClientSecret: true,
      }));
      onOpenExternalUrl(res.authUrl);
      setStatusMsg(
        "已在系统浏览器打开 Google OAuth2 授权页面，完成同意后点击「刷新状态」即可同步绑定邮箱。",
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "启动 Gmail OAuth2 授权失败。");
    } finally {
      setStartingOAuth(false);
    }
  };

  const handleDisconnectGmail = async () => {
    setDisconnectingGmail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const updated = await daemon.disconnectOvernightGmail();
      applySnapshot(updated, false);
      setOauthPendingUrl(null);
      setOauthTutorialOpen(true);
      setStatusMsg("已解除 Gmail OAuth2 绑定并清除本地密封的 Refresh Token。");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "解除 Gmail 绑定失败。");
    } finally {
      setDisconnectingGmail(false);
    }
  };

  const handleSaveStrategy = async () => {
    if (agyCompliance.blocked) {
      setErrorMsg(agyCompliance.warningMessage);
      return;
    }
    setSavingStrategy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = buildOvernightStrategySavePayload(draft);
      const updated = await daemon.updateOvernightConfig(payload);
      applySnapshot(updated, false);
      setStatusMsg(
        updated.config.enabled
          ? "夜间工场执行策略已保存并启动后台轮询调度。"
          : "夜间工场执行策略已保存（当前保持关闭待命状态）。",
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "保存执行策略失败。");
    } finally {
      setSavingStrategy(false);
    }
  };

  const handleToggleMasterEnabled = async (nextEnabled: boolean) => {
    setDraft((prev) => ({ ...prev, enabled: nextEnabled }));
    if (nextEnabled) {
      setStrategyExpanded(true);
    }
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const updated = await daemon.updateOvernightConfig({ enabled: nextEnabled });
      applySnapshot(updated, false);
      setStatusMsg(
        nextEnabled
          ? "已启用夜间全自动工场（将在允许时段按轮询间隔监听匹配邮件）。"
          : "已关闭夜间全自动工场并暂停后台邮件轮询。",
      );
    } catch (err) {
      setDraft((prev) => ({ ...prev, enabled: !nextEnabled }));
      setErrorMsg(err instanceof Error ? err.message : "切换夜间工场启用状态失败。");
    }
  };

  const handlePollNow = async () => {
    setPollingNow(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.pollOvernightNow();
      setLastPollAt(res.polledAt);
      setLastPollError(null);
      const runsResp = await daemon.fetchOvernightRuns(30);
      setRuns(runsResp.runs);
      setStatusMsg(res.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "立即拉取邮件失败。";
      setLastPollError(msg);
      setErrorMsg(msg);
    } finally {
      setPollingNow(false);
    }
  };

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- window Escape key listener closes standalone work panel when no input/dialog owns focus
  useEffect(() => {
    if (!standalone) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isOvernightFactoryEscapeTarget(event.target)) return;
      event.preventDefault();
      void navigateToMainApp();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [navigateToMainApp, standalone]);

  const mailConfigured = isMailChannelConfigured(draft);
  const parsedWhitelistCount = parseAllowedSendersInput(draft.allowedSendersText).length;
  const activePresetSpec =
    OVERNIGHT_MAIL_PRESETS.find((item) => item.id === draft.preset) ?? OVERNIGHT_MAIL_PRESETS[0]!;

  const defaultRedirectUri = resolveGmailOAuthRedirectUri({ daemonBaseUrl });
  const effectiveRedirectUri = resolveGmailOAuthRedirectUri({
    draftRedirectUri: draft.gmailRedirectUri,
    daemonBaseUrl,
  });
  const oauthReadiness = evaluateGmailOAuthReadiness(draft);
  const currentTutorialStepSpec =
    GMAIL_OAUTH_TUTORIAL_STEPS.find((item) => item.step === activeTutorialStep) ??
    GMAIL_OAUTH_TUTORIAL_STEPS[0]!;
  const completedStepCount = completedTutorialSteps.length;
  const isCurrentStepCompleted = completedTutorialSteps.includes(activeTutorialStep);

  const trimmedAgentModel = draft.agentModel.trim();
  const activeModelOption = modelOptions.find((m) => m.slug === trimmedAgentModel);
  const selectedModelSelectValue =
    trimmedAgentModel.length > 0 ? trimmedAgentModel : OVERNIGHT_DEFAULT_MODEL_SENTINEL;

  const statusBadges = (
    <>
      <Badge variant={daemonReady ? "success" : "warning"}>
        {daemonReady ? "Daemon 在线" : "Daemon 离线"}
      </Badge>
      <Badge variant={draft.enabled ? "success" : "secondary"}>
        {draft.enabled ? "已启用" : "默认关闭 · 待命"}
      </Badge>
      <Badge variant="outline" className="gap-1">
        <LockIcon className="size-3" />
        凭据 0600 加密密封
      </Badge>
    </>
  );

  const alertBanners = (
    <>
      {errorMsg ? (
        <div
          role="alert"
          data-pmx-work-panel-card="1"
          className="flex items-center gap-2 rounded-xl border border-destructive/45 bg-destructive/12 px-3.5 py-2.5 text-xs text-destructive"
        >
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-all">{errorMsg}</span>
        </div>
      ) : null}

      {statusMsg ? (
        <div
          role="status"
          aria-live="polite"
          data-pmx-work-panel-card="1"
          className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/12 px-3.5 py-2.5 text-xs text-foreground"
        >
          <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="min-w-0 flex-1">{statusMsg}</span>
        </div>
      ) : null}
    </>
  );

  const kpiStrip = (
    <div
      data-testid="overnight-kpi-strip"
      className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {/* KPI 1: 邮箱收发通道 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-border/75 bg-card/75 px-3.5 py-3 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MailIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            邮箱收发通道
          </span>
          <Badge variant={mailConfigured ? "success" : "secondary"}>
            {mailConfigured ? "已就绪" : "待配置"}
          </Badge>
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-semibold text-foreground">
            {draft.mode === "gmail-oauth2"
              ? draft.gmailConnected && draft.gmailBoundEmail
                ? draft.gmailBoundEmail
                : "Gmail OAuth2"
              : draft.email.trim() || `${activePresetSpec.label} · IMAP/SMTP`}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {draft.mode === "gmail-oauth2"
              ? draft.gmailConnected
                ? "Google OAuth2 · 已在线绑定"
                : "Google OAuth2 · 待完成浏览器授权"
              : `${activePresetSpec.label} · ${draft.imapHost || "自定义主机"}:${draft.imapPort || "993"}`}
          </div>
        </div>
      </div>

      {/* KPI 2: 工场状态与时间窗口 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-border/75 bg-card/75 px-3.5 py-3 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MoonStarIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            工场状态与时间窗口
          </span>
          <Switch
            aria-label="快捷切换启用夜间全自动工场"
            data-testid="overnight-kpi-enabled-switch"
            checked={draft.enabled}
            onCheckedChange={(checked) => void handleToggleMasterEnabled(checked)}
          />
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-semibold text-foreground">
            {draft.enabled ? "已启用 · 后台值守中" : "默认关闭 · 待命"}
          </div>
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            {draft.windowMode === "always"
              ? "全天候执行"
              : `${draft.windowStart}–${draft.windowEnd}`}
            {` · 每 ${draft.pollIntervalMinutes || "5"} 分钟轮询`}
          </div>
        </div>
      </div>

      {/* KPI 3: 触发规则与白名单 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-border/75 bg-card/75 px-3.5 py-3 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldCheckIcon
              className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            触发规则与白名单
          </span>
          <Badge variant={parsedWhitelistCount > 0 ? "success" : "warning"}>
            {parsedWhitelistCount > 0 ? `${parsedWhitelistCount} 位白名单` : "未设白名单"}
          </Badge>
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
            <code className="rounded bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground">
              {draft.triggerTag || "#factory"}
            </code>
            <span className="truncate text-xs font-normal text-muted-foreground tabular-nums">
              {parsedWhitelistCount > 0
                ? `允许 ${parsedWhitelistCount} 个发件人立项`
                : "空名单拦截全部邮件"}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {draft.localWorktreeOnlyNoPush
              ? "安全护栏：仅本地 Worktree，绝不 push"
              : "注意：已放开仅本地 Worktree 护栏"}
          </div>
        </div>
      </div>

      {/* KPI 4: 运行记录与最近拉取 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-2 rounded-xl border border-border/75 bg-card/75 px-3.5 py-3 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock3Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            运行记录与最近拉取
          </span>
          <Badge variant={lastPollError ? "error" : runs.length > 0 ? "success" : "secondary"}>
            {lastPollError ? "拉取异常" : `${runs.length} 条记录`}
          </Badge>
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-semibold text-foreground tabular-nums">
            {runs.length > 0 ? `累计 ${runs.length} 次夜间任务` : "暂无执行记录"}
          </div>
          <div
            className={cn(
              "truncate text-xs tabular-nums",
              lastPollError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {lastPollError
              ? `错误：${lastPollError}`
              : `上次拉取：${formatOvernightTimestamp(lastPollAt)}`}
          </div>
        </div>
      </div>
    </div>
  );

  const mailBindingSection = (
    <OvernightSectionCard
      standalone={standalone}
      id="overnight-mail-binding"
      title="区块 A · 邮箱登录与收发绑定"
      icon={<MailIcon className="size-4 text-primary" />}
      headerAction={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={mailConfigured ? "success" : "secondary"}>
            {mailConfigured
              ? draft.mode === "gmail-oauth2"
                ? `Gmail 已绑定${draft.gmailBoundEmail ? ` · ${draft.gmailBoundEmail}` : ""}`
                : `IMAP/SMTP 已配置${draft.email ? ` · ${draft.email}` : ""}`
              : mailExpanded
                ? "待配置邮箱通道"
                : "通道未配置（已折叠）"}
          </Badge>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="overnight-mail-toggle-btn"
            data-pmx-work-panel-control="1"
            aria-expanded={mailExpanded}
            onClick={() => setMailExpanded((prev) => !prev)}
            className="h-7 rounded-lg active:translate-y-px"
          >
            {mailExpanded ? (
              <>
                <ChevronDownIcon className="size-3.5" />
                收起配置
              </>
            ) : (
              <>
                <ChevronRightIcon className="size-3.5" />
                展开配置
              </>
            )}
          </Button>
        </div>
      }
    >
      <div data-testid="overnight-mail-section" className="space-y-4 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          默认使用通用 IMAP / SMTP 邮箱绑定（内置 QQ / 163 / 谷歌邮箱 Gmail / Outlook / 自定义预设），也支持 Google OAuth2 授权。所有授权码与密钥仅写加密落盘，界面永不回显明文。
        </p>

        {/* Compact Summary Bar when collapsed */}
        {!mailExpanded ? (
          <div
            data-pmx-work-panel-card="1"
            className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border/65 bg-muted/20 px-3.5 py-2.5 text-xs text-muted-foreground"
          >
            <div className="flex flex-wrap items-center gap-2">
              <MailIcon className="size-4 shrink-0 text-primary/80" />
              <span>
                当前接入方式：
                <strong className="font-medium text-foreground">
                  {draft.mode === "gmail-oauth2" ? "Gmail OAuth2" : "IMAP / SMTP 通用邮箱"}
                </strong>
                {" · 凭据文件："}
                <code className="rounded bg-muted/75 px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {credentialsFile}
                </code>
              </span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="default"
              onClick={() => setMailExpanded(true)}
              className="h-7 rounded-lg active:translate-y-px"
            >
              配置收发邮箱
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mode Switcher — IMAP / SMTP 通用邮箱 FIRST (left), Gmail OAuth2 SECOND (right) */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-medium text-foreground">接入方式</div>
                <div className="truncate text-xs text-muted-foreground">
                  所有密码/授权码/Client Secret 仅写入 {credentialsFile}（0600 加密密封）
                </div>
              </div>
              <ToggleGroup
                variant="segmented"
                aria-label="邮箱接入方式"
                data-testid="overnight-mail-mode-switcher"
                value={[draft.mode]}
                onValueChange={(next) => {
                  const selected = next[0];
                  if (selected === "gmail-oauth2" || selected === "imap") {
                    setDraft((prev) => ({
                      ...prev,
                      mode: selected as DaemonOvernightInboundMode,
                    }));
                  }
                }}
              >
                <Toggle value="imap" data-testid="overnight-mode-imap">
                  IMAP / SMTP 通用邮箱
                </Toggle>
                <Toggle value="gmail-oauth2" data-testid="overnight-mode-gmail">
                  Gmail OAuth2
                </Toggle>
              </ToggleGroup>
            </div>

            {/* Generic IMAP / SMTP Mode (Default) */}
            {draft.mode === "imap" ? (
              <div
                data-testid="overnight-imap-form"
                data-pmx-work-panel-card="1"
                className="space-y-3.5 rounded-xl border border-border/75 bg-muted/20 p-3.5"
              >
                {/* One-click Presets */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-foreground">国内 / 国际邮箱一键预设</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {OVERNIGHT_MAIL_PRESETS.map((preset) => {
                      const active = draft.preset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          data-testid={`overnight-preset-${preset.id}`}
                          data-pmx-work-panel-control={active ? undefined : "1"}
                          aria-pressed={active}
                          onClick={() =>
                            setDraft((prev) => applyOvernightMailPreset(prev, preset.id))
                          }
                          className={cn(
                            "cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition-all motion-reduce:transition-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "border-primary bg-primary font-semibold text-primary-foreground shadow-xs"
                              : "border-border/80 bg-card/80 text-foreground/90 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                          )}
                        >
                          <div className="truncate">{preset.label}</div>
                          <div
                            className={cn(
                              "mt-0.5 truncate text-[11px]",
                              active ? "text-primary-foreground/85" : "text-muted-foreground",
                            )}
                          >
                            {preset.note}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Contextual Gmail App Password Banner */}
                {draft.preset === "gmail" ? (
                  <div
                    data-testid="overnight-gmail-imap-hint"
                    data-pmx-work-panel-card="1"
                    className="space-y-2.5 rounded-xl border border-primary/35 bg-primary/10 px-3.5 py-3 text-xs text-foreground"
                  >
                    <div className="flex items-start gap-2">
                      <KeyRoundIcon
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="font-semibold text-foreground">
                          谷歌邮箱 (Gmail) 通用接入指南（无需配置 Google Cloud OAuth）
                        </div>
                        <p className="leading-relaxed text-foreground/90">
                          Gmail 通用邮箱登录需先开启 Google 两步验证，再生成一个 16 位「应用专用密码 (App Password)」，直接填入下方 IMAP/SMTP 授权码即可完成绑定。
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-6">
                      {GMAIL_APP_PASSWORD_LINKS.map((link) => (
                        <Button
                          key={link.id}
                          type="button"
                          size="xs"
                          variant={link.id === "apppasswords" ? "default" : "outline"}
                          data-testid={`overnight-gmail-imap-${link.id}-btn`}
                          data-pmx-work-panel-control={link.id === "apppasswords" ? undefined : "1"}
                          onClick={() => handleOpenHttpsUrl(link.url)}
                          className="h-7 rounded-lg active:translate-y-px"
                        >
                          <ExternalLinkIcon className="size-3.5" />
                          {link.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Email & Write-only Auth Code */}
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-foreground">发件 / 收件邮箱地址</span>
                    <Input
                      data-pmx-work-panel-control="1"
                      type="email"
                      data-testid="overnight-imap-email-input"
                      value={draft.email}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          email: e.target.value,
                          imapUsername: e.target.value,
                          smtpUsername: e.target.value,
                        }))
                      }
                      placeholder={
                        draft.preset === "gmail"
                          ? "you@gmail.com"
                          : "you@qq.com / you@163.com / you@gmail.com"
                      }
                      className="h-8 rounded-lg text-xs"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                      <span>邮箱授权码 / 密码（仅写加密密封）</span>
                      <Badge
                        data-testid="overnight-imap-secret-badge"
                        variant={draft.hasImapPassword ? "success" : "secondary"}
                      >
                        {draft.hasImapPassword ? "已密封保存" : "未配置"}
                      </Badge>
                    </span>
                    <Input
                      data-pmx-work-panel-control="1"
                      type="password"
                      autoComplete="new-password"
                      data-testid="overnight-imap-password-input"
                      value={draft.imapPasswordInput}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, imapPasswordInput: e.target.value }))
                      }
                      placeholder={
                        draft.hasImapPassword
                          ? "已密封保存（留空保留原授权码，输入新值则覆盖）"
                          : draft.preset === "gmail"
                            ? "请输入 16 位 Google 应用专用密码"
                            : "请输入邮箱客户端专用授权码"
                      }
                      className="h-8 rounded-lg font-mono text-xs"
                    />
                  </label>
                </div>

                {/* IMAP & SMTP Host / Port / TLS */}
                <div className="grid gap-3 md:grid-cols-2">
                  <div
                    data-pmx-work-panel-card="1"
                    className="space-y-2 rounded-lg border border-border/70 bg-card/65 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">IMAP 收信服务器</span>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <span>SSL/TLS</span>
                        <Switch
                          checked={draft.imapSecure}
                          onCheckedChange={(checked) =>
                            setDraft((prev) => ({ ...prev, imapSecure: checked }))
                          }
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        data-pmx-work-panel-control="1"
                        data-testid="overnight-imap-host-input"
                        value={draft.imapHost}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, imapHost: e.target.value }))
                        }
                        placeholder="imap.qq.com"
                        className="col-span-2 h-8 rounded-lg font-mono text-xs"
                      />
                      <Input
                        data-pmx-work-panel-control="1"
                        data-testid="overnight-imap-port-input"
                        value={draft.imapPort}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, imapPort: e.target.value }))
                        }
                        placeholder="993"
                        className="h-8 rounded-lg font-mono text-xs tabular-nums"
                      />
                    </div>
                  </div>

                  <div
                    data-pmx-work-panel-card="1"
                    className="space-y-2 rounded-lg border border-border/70 bg-card/65 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">SMTP 发信服务器</span>
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <span>SSL/TLS</span>
                        <Switch
                          checked={draft.smtpSecure}
                          onCheckedChange={(checked) =>
                            setDraft((prev) => ({ ...prev, smtpSecure: checked }))
                          }
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        data-pmx-work-panel-control="1"
                        data-testid="overnight-smtp-host-input"
                        value={draft.smtpHost}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, smtpHost: e.target.value }))
                        }
                        placeholder="smtp.qq.com"
                        className="col-span-2 h-8 rounded-lg font-mono text-xs"
                      />
                      <Input
                        data-pmx-work-panel-control="1"
                        data-testid="overnight-smtp-port-input"
                        value={draft.smtpPort}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, smtpPort: e.target.value }))
                        }
                        placeholder="465"
                        className="h-8 rounded-lg font-mono text-xs tabular-nums"
                      />
                    </div>
                  </div>
                </div>

                {/* Optional Separate SMTP Password */}
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={draft.useSeparateSmtpPassword}
                      onCheckedChange={(checked) =>
                        setDraft((prev) => ({ ...prev, useSeparateSmtpPassword: checked }))
                      }
                    />
                    <span>使用与 IMAP 不同的独立 SMTP 授权码</span>
                  </label>
                  {draft.useSeparateSmtpPassword ? (
                    <Input
                      data-pmx-work-panel-control="1"
                      type="password"
                      autoComplete="new-password"
                      value={draft.smtpPasswordInput}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, smtpPasswordInput: e.target.value }))
                      }
                      placeholder="输入独立 SMTP 授权码（留空默认复用 IMAP 授权码）"
                      className="h-8 max-w-md rounded-lg font-mono text-xs"
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              /* Gmail OAuth2 Mode */
              <div
                data-testid="overnight-gmail-form"
                data-pmx-work-panel-card="1"
                className="space-y-4 rounded-xl border border-border/75 bg-muted/20 p-3.5"
              >
                {/* Quick-Tip Comparison Banner: Switch to Generic Gmail App Password */}
                <div
                  data-testid="overnight-gmail-oauth-switch-banner"
                  data-pmx-work-panel-card="1"
                  className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-primary/35 bg-primary/10 px-3.5 py-2.5 text-xs text-foreground"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="font-semibold text-foreground">
                      个人 Gmail 推荐更简方案：无需创建 Google Cloud OAuth 项目
                    </div>
                    <p className="text-foreground/85">
                      如果你只想快速用 Gmail 收发夜间工场邮件，直接切到通用邮箱预设并填入 16 位应用专用密码即可。
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    data-testid="overnight-switch-to-gmail-imap-btn"
                    data-pmx-work-panel-control="1"
                    onClick={() =>
                      setDraft((prev) =>
                        applyOvernightMailPreset({ ...prev, mode: "imap" }, "gmail"),
                      )
                    }
                    className="h-7 shrink-0 rounded-lg active:translate-y-px"
                  >
                    <ArrowRightLeftIcon className="size-3.5" />
                    改用通用邮箱 · 谷歌邮箱 (应用专用密码，1 分钟完成)
                  </Button>
                </div>

                {/* OAuth Status Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <MailCheckIcon className="size-4 text-primary" />
                    <span className="text-xs font-semibold text-foreground">
                      Gmail OAuth2 授权状态
                    </span>
                    <Badge variant={draft.gmailConnected ? "success" : "secondary"}>
                      {draft.gmailConnected ? "已在线绑定" : "未绑定"}
                    </Badge>
                    <Badge variant={draft.hasGmailRefreshToken ? "success" : "outline"}>
                      {draft.hasGmailRefreshToken ? "Refresh Token 已密封保存" : "Token 未配置"}
                    </Badge>
                  </div>
                  {draft.gmailConnected ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      data-pmx-work-panel-control="1"
                      disabled={disconnectingGmail}
                      aria-busy={disconnectingGmail}
                      onClick={() => void handleDisconnectGmail()}
                      className="h-7 rounded-lg active:translate-y-px"
                    >
                      <Unlink2Icon className="size-3.5" />
                      解除绑定
                    </Button>
                  ) : null}
                </div>

                {draft.gmailConnected && draft.gmailBoundEmail ? (
                  <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-foreground">
                    已绑定邮箱：
                    <strong className="font-mono font-semibold">{draft.gmailBoundEmail}</strong>
                    {draft.gmailConnectedAt ? (
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                        （绑定于 {formatOvernightTimestamp(draft.gmailConnectedAt)}）
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* Direct Quick-Jump Bar: 直达获取 OAuth 凭据 */}
                <div
                  data-testid="overnight-gmail-oauth-quick-links"
                  data-pmx-work-panel-card="1"
                  className="space-y-2 rounded-xl border border-border/70 bg-card/65 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      直达获取 OAuth 凭据（Google Cloud 官方控制台）
                    </span>
                    <span className="text-xs text-muted-foreground">按顺序点开 4 步即可拿到密钥</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {GMAIL_OAUTH_QUICK_LINKS.map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        size="xs"
                        variant="outline"
                        data-testid={`overnight-oauth-quick-${item.id}`}
                        data-pmx-work-panel-control="1"
                        onClick={() => handleOpenHttpsUrl(item.url)}
                        className="h-8 justify-between rounded-lg px-2.5 text-xs active:translate-y-px"
                      >
                        <span className="truncate">{item.label}</span>
                        <ExternalLinkIcon className="size-3.5 shrink-0 opacity-75" />
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Interactive Step-by-Step Guided Tutorial */}
                <div
                  data-testid="overnight-gmail-oauth-tutorial"
                  data-pmx-work-panel-card="1"
                  className="overflow-hidden rounded-xl border border-border/75 bg-card/75"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/25 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <BookOpenIcon className="size-4 text-primary" aria-hidden="true" />
                      <span className="text-xs font-semibold text-foreground">
                        Google OAuth2 互动获取教程
                      </span>
                      <Badge
                        data-testid="overnight-oauth-tutorial-progress-badge"
                        variant={completedStepCount === 5 ? "success" : "secondary"}
                        className="tabular-nums"
                      >
                        已完成 {completedStepCount} / 5 步
                      </Badge>
                    </div>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      data-testid="overnight-oauth-tutorial-toggle"
                      data-pmx-work-panel-control="1"
                      aria-expanded={oauthTutorialOpen}
                      onClick={() => setOauthTutorialOpen((prev) => !prev)}
                      className="h-7 rounded-lg active:translate-y-px"
                    >
                      {oauthTutorialOpen ? (
                        <>
                          <ChevronDownIcon className="size-3.5" />
                          收起教程
                        </>
                      ) : (
                        <>
                          <ChevronRightIcon className="size-3.5" />
                          展开互动教程
                        </>
                      )}
                    </Button>
                  </div>

                  {oauthTutorialOpen ? (
                    <div data-testid="overnight-oauth-tutorial-body" className="space-y-3 p-3.5">
                      {/* Progress bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>点击下方步骤自由跳转，每步完成后可打勾记录进度</span>
                          <span className="font-mono font-medium text-foreground tabular-nums">
                            {Math.round((completedStepCount / 5) * 100)}%
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-label="Google OAuth2 配置教程进度"
                          aria-valuemin={0}
                          aria-valuemax={5}
                          aria-valuenow={completedStepCount}
                          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-200 motion-reduce:transition-none"
                            style={{ width: `${(completedStepCount / 5) * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* 5 Clickable Step Pills */}
                      <div
                        role="tablist"
                        aria-label="Google OAuth2 获取步骤"
                        className="grid grid-cols-2 gap-1.5 sm:grid-cols-5"
                      >
                        {GMAIL_OAUTH_TUTORIAL_STEPS.map((item) => {
                          const isActive = activeTutorialStep === item.step;
                          const isDone = completedTutorialSteps.includes(item.step);
                          return (
                            <button
                              key={item.step}
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              aria-current={isActive ? "step" : undefined}
                              data-testid={`overnight-oauth-step-pill-${item.step}`}
                              data-pmx-work-panel-control={isActive ? undefined : "1"}
                              onClick={() => setActiveTutorialStep(item.step)}
                              className={cn(
                                "flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all motion-reduce:transition-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isActive
                                  ? "border-primary bg-primary font-semibold text-primary-foreground shadow-xs"
                                  : isDone
                                    ? "border-emerald-500/45 bg-emerald-500/12 text-foreground hover:bg-emerald-500/20"
                                    : "border-border/75 bg-card/80 text-foreground/90 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                              )}
                            >
                              {isDone ? (
                                <CheckIcon
                                  className={cn(
                                    "size-3 shrink-0",
                                    isActive
                                      ? "text-primary-foreground"
                                      : "text-emerald-600 dark:text-emerald-400",
                                  )}
                                />
                              ) : null}
                              <span className="truncate">{item.shortLabel}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Active Step Panel */}
                      <div
                        data-testid={`overnight-oauth-step-panel-${currentTutorialStepSpec.step}`}
                        data-pmx-work-panel-card="1"
                        className="space-y-3 rounded-xl border border-border/70 bg-muted/25 p-3.5 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-foreground">
                            {currentTutorialStepSpec.title}
                          </div>
                          <p className="leading-relaxed text-foreground/90">
                            {currentTutorialStepSpec.description}
                          </p>
                        </div>

                        {currentTutorialStepSpec.pitfall ? (
                          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/12 px-3 py-2 text-xs text-foreground">
                            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                            <span className="leading-relaxed">{currentTutorialStepSpec.pitfall}</span>
                          </div>
                        ) : null}

                        {/* Step 3 Scopes Copy Box */}
                        {currentTutorialStepSpec.step === 3 ? (
                          <div className="space-y-1.5 rounded-lg border border-border/70 bg-card/80 p-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-foreground">
                                所需 Gmail API Scope（一键复制）
                              </span>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                data-testid="overnight-copy-oauth-scopes-btn"
                                data-pmx-work-panel-control="1"
                                onClick={() =>
                                  void handleCopyText(
                                    "oauth-scopes",
                                    GMAIL_OAUTH_SCOPES_TEXT,
                                    "Gmail OAuth Scope",
                                  )
                                }
                                className="h-7 rounded-lg active:translate-y-px"
                              >
                                {copiedKey === "oauth-scopes" ? (
                                  <>
                                    <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                                    已复制 Scope
                                  </>
                                ) : (
                                  <>
                                    <CopyIcon className="size-3.5" />
                                    复制 Scope
                                  </>
                                )}
                              </Button>
                            </div>
                            <code className="block break-all rounded-md bg-muted/75 px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                              {GMAIL_OAUTH_SCOPES_TEXT}
                            </code>
                          </div>
                        ) : null}

                        {/* Step 4 Dynamic Live Redirect URI Copy Box */}
                        {currentTutorialStepSpec.step === 4 ? (
                          <div className="space-y-1.5 rounded-lg border border-border/70 bg-card/80 p-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-foreground">
                                Authorized redirect URI（已获授权的重定向 URI）
                              </span>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                data-testid="overnight-tutorial-copy-redirect-btn"
                                data-pmx-work-panel-control="1"
                                onClick={() =>
                                  void handleCopyText(
                                    "tutorial-redirect",
                                    effectiveRedirectUri,
                                    "回调地址",
                                  )
                                }
                                className="h-7 rounded-lg active:translate-y-px"
                              >
                                {copiedKey === "tutorial-redirect" ? (
                                  <>
                                    <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                                    已复制回调地址
                                  </>
                                ) : (
                                  <>
                                    <CopyIcon className="size-3.5" />
                                    复制回调地址
                                  </>
                                )}
                              </Button>
                            </div>
                            <code
                              data-testid="overnight-tutorial-redirect-uri-code"
                              className="block break-all rounded-md bg-muted/75 px-2.5 py-1.5 font-mono text-[11px] text-foreground"
                            >
                              {effectiveRedirectUri}
                            </code>
                          </div>
                        ) : null}

                        {/* Step 5 Live Readiness Check & Inline Launch Action */}
                        {currentTutorialStepSpec.step === 5 ? (
                          <div
                            data-testid="overnight-oauth-step5-readiness"
                            className="space-y-2.5 rounded-lg border border-border/70 bg-card/80 p-3"
                          >
                            <div className="font-medium text-foreground">
                              实时表单就绪检测（与下方表单实时同步）
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5">
                                {oauthReadiness.clientIdReady ? (
                                  <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                <span className="text-xs text-foreground">
                                  Client ID：{oauthReadiness.clientIdReady ? "已填写" : "待填写"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5">
                                {oauthReadiness.clientSecretReady ? (
                                  <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                <span className="text-xs text-foreground">
                                  Client Secret：
                                  {oauthReadiness.clientSecretReady
                                    ? draft.gmailClientSecretInput.trim()
                                      ? "已填写待密封"
                                      : "已密封保存"
                                    : "待填写"}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-0.5">
                              <Button
                                type="button"
                                size="xs"
                                variant="default"
                                data-testid="overnight-tutorial-start-oauth-btn"
                                disabled={!oauthReadiness.canStartOAuth || startingOAuth}
                                aria-busy={startingOAuth}
                                onClick={() => void handleStartGmailOAuth()}
                                className="h-7 rounded-lg active:translate-y-px"
                              >
                                <ExternalLinkIcon className="size-3.5" />
                                {startingOAuth ? "正在启动授权..." : "保存凭据并启动浏览器授权"}
                              </Button>
                              {!oauthReadiness.canStartOAuth ? (
                                <span className="text-xs text-muted-foreground">
                                  请先在下方表单填入 Client ID 与 Client Secret 后即可一键授权
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {/* Action + Step Completion + Prev/Next */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {currentTutorialStepSpec.actionLabel &&
                            currentTutorialStepSpec.actionUrl ? (
                              <Button
                                type="button"
                                size="xs"
                                variant="default"
                                data-testid={`overnight-oauth-step-action-${currentTutorialStepSpec.step}`}
                                onClick={() =>
                                  handleOpenHttpsUrl(currentTutorialStepSpec.actionUrl!)
                                }
                                className="h-7 rounded-lg active:translate-y-px"
                              >
                                <ExternalLinkIcon className="size-3.5" />
                                {currentTutorialStepSpec.actionLabel}
                              </Button>
                            ) : null}

                            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/75 bg-card/80 px-2.5 py-1 text-xs font-medium text-foreground select-none hover:border-primary/45">
                              <input
                                type="checkbox"
                                data-testid={`overnight-oauth-step-complete-${currentTutorialStepSpec.step}`}
                                checked={isCurrentStepCompleted}
                                onChange={() =>
                                  setCompletedTutorialSteps((prev) =>
                                    toggleTutorialStepCompletion(prev, activeTutorialStep),
                                  )
                                }
                                className="size-3.5 accent-primary"
                              />
                              <span>标记完成</span>
                            </label>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              data-testid="overnight-oauth-step-prev"
                              data-pmx-work-panel-control="1"
                              disabled={activeTutorialStep <= 1}
                              onClick={() =>
                                setActiveTutorialStep(
                                  (prev) => Math.max(1, prev - 1) as GmailOAuthTutorialStepNumber,
                                )
                              }
                              className="h-7 rounded-lg active:translate-y-px"
                            >
                              <ChevronLeftIcon className="size-3.5" />
                              上一步
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              data-testid="overnight-oauth-step-next"
                              data-pmx-work-panel-control="1"
                              disabled={activeTutorialStep >= 5}
                              onClick={() =>
                                setActiveTutorialStep(
                                  (prev) => Math.min(5, prev + 1) as GmailOAuthTutorialStepNumber,
                                )
                              }
                              className="h-7 rounded-lg active:translate-y-px"
                            >
                              下一步
                              <ChevronRightIcon className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* OAuth Credentials Form */}
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-foreground">OAuth Client ID</span>
                    <Input
                      data-pmx-work-panel-control="1"
                      data-testid="overnight-gmail-client-id-input"
                      value={draft.gmailClientId}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, gmailClientId: e.target.value }))
                      }
                      placeholder="xxxx.apps.googleusercontent.com"
                      className="h-8 rounded-lg font-mono text-xs"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
                      <span>OAuth Client Secret（仅写密封）</span>
                      <Badge variant={draft.hasGmailClientSecret ? "success" : "secondary"}>
                        {draft.hasGmailClientSecret ? "已密封保存" : "未配置"}
                      </Badge>
                    </span>
                    <Input
                      data-pmx-work-panel-control="1"
                      data-testid="overnight-gmail-client-secret-input"
                      type="password"
                      autoComplete="new-password"
                      value={draft.gmailClientSecretInput}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          gmailClientSecretInput: e.target.value,
                        }))
                      }
                      placeholder={
                        draft.hasGmailClientSecret
                          ? "已密封保存（留空保留原密钥，输入新值则覆盖）"
                          : "输入 Google OAuth Client Secret"
                      }
                      className="h-8 rounded-lg font-mono text-xs"
                    />
                  </label>

                  <div className="space-y-1 md:col-span-2">
                    <label
                      htmlFor="overnight-gmail-redirect-uri-input"
                      className="block text-xs font-medium text-foreground"
                    >
                      Redirect URI（本地回调地址，留空自动使用当前 Daemon 地址）
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="overnight-gmail-redirect-uri-input"
                        data-pmx-work-panel-control="1"
                        data-testid="overnight-gmail-redirect-uri-input"
                        value={draft.gmailRedirectUri}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, gmailRedirectUri: e.target.value }))
                        }
                        placeholder={defaultRedirectUri}
                        className="h-8 min-w-0 flex-1 rounded-lg font-mono text-xs"
                      />
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        data-testid="overnight-copy-redirect-uri-btn"
                        data-pmx-work-panel-control="1"
                        onClick={() =>
                          void handleCopyText("field-redirect", effectiveRedirectUri, "回调地址")
                        }
                        className="h-8 shrink-0 rounded-lg px-2.5 active:translate-y-px"
                      >
                        {copiedKey === "field-redirect" ? (
                          <>
                            <CheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                            已复制
                          </>
                        ) : (
                          <>
                            <CopyIcon className="size-3.5" />
                            复制回调地址
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    data-testid="overnight-gmail-login-btn"
                    disabled={startingOAuth}
                    aria-busy={startingOAuth}
                    onClick={() => void handleStartGmailOAuth()}
                    className="rounded-lg active:translate-y-px"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    {startingOAuth ? "正在生成授权链接..." : "一键浏览器登录绑定 Gmail"}
                  </Button>
                  {oauthPendingUrl ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-pmx-work-panel-control="1"
                      onClick={() => void loadAll(false)}
                      className="rounded-lg active:translate-y-px"
                    >
                      <RefreshCwIcon className="size-3.5" />
                      已完成授权，同步状态
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Bottom Mail Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="default"
                data-testid="overnight-save-mail-btn"
                disabled={savingMail}
                aria-busy={savingMail}
                onClick={() => void handleSaveMail()}
                className="rounded-lg active:translate-y-px"
              >
                <SaveIcon className="size-3.5" />
                {savingMail ? "保存中..." : "保存邮箱配置"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="overnight-test-mail-btn"
                data-pmx-work-panel-control="1"
                disabled={testingMail}
                aria-busy={testingMail}
                onClick={() => void handleTestMail()}
                className="rounded-lg active:translate-y-px"
              >
                <WifiIcon className="size-3.5" />
                {testingMail ? "测试连接中..." : "测试收发连通性"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="overnight-send-report-btn"
                data-pmx-work-panel-control="1"
                disabled={sendingReport}
                aria-busy={sendingReport}
                onClick={() => void handleSendTestReport()}
                className="rounded-lg active:translate-y-px"
              >
                <SendIcon className="size-3.5" />
                {sendingReport ? "发送中..." : "发送测试早报"}
              </Button>
            </div>

            {/* Connectivity Probe Inline Report */}
            {testResult ? (
              <div
                data-testid="overnight-mail-test-result"
                data-pmx-work-panel-card="1"
                className={cn(
                  "space-y-2 rounded-xl border px-3.5 py-2.5 text-xs",
                  testResult.ok
                    ? "border-emerald-500/35 bg-emerald-500/10 text-foreground"
                    : "border-destructive/40 bg-destructive/10 text-foreground",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-medium">
                    {testResult.ok ? (
                      <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <XCircleIcon className="size-4 text-destructive" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    总耗时 {testResult.durationMs} ms
                  </span>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div
                    data-pmx-work-panel-card="1"
                    className="rounded-lg border border-border/65 bg-card/75 px-2.5 py-1.5"
                  >
                    <div className="flex items-center justify-between font-medium">
                      <span>收信通道（Inbound）</span>
                      <span className="font-mono text-muted-foreground tabular-nums">
                        {testResult.inbound.latencyMs} ms
                      </span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">{testResult.inbound.message}</div>
                  </div>
                  <div
                    data-pmx-work-panel-card="1"
                    className="rounded-lg border border-border/65 bg-card/75 px-2.5 py-1.5"
                  >
                    <div className="flex items-center justify-between font-medium">
                      <span>发信通道（Outbound）</span>
                      <span className="font-mono text-muted-foreground tabular-nums">
                        {testResult.outbound.latencyMs} ms
                      </span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {testResult.outbound.message}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </OvernightSectionCard>
  );

  const strategySection = (
    <OvernightSectionCard
      standalone={standalone}
      id="overnight-strategy"
      title="区块 B · 夜间工场执行策略"
      icon={<ShieldCheckIcon className="size-4 text-primary" />}
      headerAction={
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
            <span>启用工场</span>
            <Switch
              data-testid="overnight-enabled-switch"
              checked={draft.enabled}
              onCheckedChange={(checked) => void handleToggleMasterEnabled(checked)}
            />
          </label>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="overnight-strategy-toggle-btn"
            data-pmx-work-panel-control="1"
            aria-expanded={strategyExpanded}
            onClick={() => setStrategyExpanded((prev) => !prev)}
            className="h-7 rounded-lg active:translate-y-px"
          >
            {strategyExpanded ? (
              <>
                <ChevronDownIcon className="size-3.5" />
                收起策略
              </>
            ) : (
              <>
                <ChevronRightIcon className="size-3.5" />
                展开策略
              </>
            )}
          </Button>
        </div>
      }
    >
      <div data-testid="overnight-strategy-section" className="space-y-4 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          默认关闭以保护本地代码仓库；仅允许白名单发件人携带触发标签立项，并在隔离 Worktree 分支提交代码与 Oracle 只读审校。
        </p>
        {!strategyExpanded ? (
          <div
            data-pmx-work-panel-card="1"
            className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border/65 bg-muted/20 px-3.5 py-2.5 text-xs text-muted-foreground"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span>
                触发标签：<code className="font-mono text-foreground">{draft.triggerTag}</code>
              </span>
              <span>·</span>
              <span className="tabular-nums">白名单：{parsedWhitelistCount} 个发件人</span>
              <span>·</span>
              <span className="tabular-nums">
                时段：
                {draft.windowMode === "always"
                  ? "全天运行"
                  : `${draft.windowStart}–${draft.windowEnd}`}
              </span>
              <span>·</span>
              <span>安全保护：{draft.localWorktreeOnlyNoPush ? "仅本地分支不 push" : "已放开"}</span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-pmx-work-panel-control="1"
              onClick={() => setStrategyExpanded(true)}
              className="h-7 rounded-lg active:translate-y-px"
            >
              编辑执行策略
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs font-medium text-foreground">触发主题前缀 / 标签</span>
                <Input
                  data-pmx-work-panel-control="1"
                  data-testid="overnight-trigger-tag-input"
                  value={draft.triggerTag}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, triggerTag: e.target.value }))
                  }
                  placeholder="#factory"
                  className="h-8 rounded-lg font-mono text-xs"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium text-foreground">轮询间隔（分钟）</span>
                <Input
                  data-pmx-work-panel-control="1"
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.pollIntervalMinutes}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, pollIntervalMinutes: e.target.value }))
                  }
                  className="h-8 rounded-lg font-mono text-xs tabular-nums"
                />
              </label>
            </div>

            {/* Sender Whitelist */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <ShieldAlertIcon className="size-3.5 text-amber-500" />
                  发件人白名单（一行一个邮箱，物理防陌生人邮件触发编码）
                </span>
                <Badge variant={parsedWhitelistCount > 0 ? "success" : "warning"}>
                  {parsedWhitelistCount > 0
                    ? `已放行 ${parsedWhitelistCount} 个发件人`
                    : "空名单将拦截全部邮件"}
                </Badge>
              </div>
              <Textarea
                data-pmx-work-panel-control="1"
                data-testid="overnight-whitelist-textarea"
                rows={3}
                value={draft.allowedSendersText}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, allowedSendersText: e.target.value }))
                }
                placeholder={"your-email@qq.com\nbackup@gmail.com\n*@your-team.dev"}
                className="rounded-lg font-mono text-xs"
              />
            </div>

            {/* Execution Window */}
            <div
              data-pmx-work-panel-card="1"
              className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border/75 bg-muted/20 p-3.5"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Clock3Icon className="size-3.5 text-primary" />
                  允许执行时段
                </div>
                <ToggleGroup
                  variant="segmented"
                  aria-label="允许执行时段"
                  value={[draft.windowMode]}
                  onValueChange={(next) => {
                    const val = next[0];
                    if (val === "scheduled" || val === "always") {
                      setDraft((prev) => ({ ...prev, windowMode: val }));
                    }
                  }}
                >
                  <Toggle value="scheduled">指定夜间时段</Toggle>
                  <Toggle value="always">全天运行</Toggle>
                </ToggleGroup>
              </div>

              {draft.windowMode === "scheduled" ? (
                <div className="flex items-center gap-2">
                  <label className="space-y-1">
                    <span className="block text-xs text-muted-foreground">开始时间</span>
                    <Input
                      data-pmx-work-panel-control="1"
                      type="time"
                      value={draft.windowStart}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, windowStart: e.target.value }))
                      }
                      className="h-8 w-28 rounded-lg font-mono text-xs tabular-nums"
                    />
                  </label>
                  <span className="pb-1.5 text-xs text-muted-foreground">—</span>
                  <label className="space-y-1">
                    <span className="block text-xs text-muted-foreground">结束时间</span>
                    <Input
                      data-pmx-work-panel-control="1"
                      type="time"
                      value={draft.windowEnd}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, windowEnd: e.target.value }))
                      }
                      className="h-8 w-28 rounded-lg font-mono text-xs tabular-nums"
                    />
                  </label>
                </div>
              ) : null}
            </div>

            {/* Workspace Directory */}
            <div className="space-y-2">
              <label className="space-y-1">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <FolderGit2Icon className="size-3.5 text-primary" />
                  目标工作区目录（本地 Git 仓库路径）
                </span>
                <Input
                  data-pmx-work-panel-control="1"
                  data-testid="overnight-workspace-input"
                  value={draft.targetWorkspaceDir}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, targetWorkspaceDir: e.target.value }))
                  }
                  placeholder="例如 D:\Projects\Prismux"
                  className="h-8 rounded-lg font-mono text-xs"
                />
              </label>
              {workspaceOptions.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">快速选择当前工作区：</span>
                  {workspaceOptions.slice(0, 5).map((proj) => (
                    <button
                      key={proj.cwd}
                      type="button"
                      data-pmx-work-panel-control="1"
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, targetWorkspaceDir: proj.cwd }))
                      }
                      className="cursor-pointer rounded-md border border-border/75 bg-card/80 px-2 py-0.5 text-xs text-foreground/90 transition-all motion-reduce:transition-none hover:border-primary/50 hover:bg-accent/60 hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {proj.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Live Configured Agent Provider & Live Model Selector */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    执行代理（仅展示已启用提供方）
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    已启用 {liveConfiguredProviders.length} 项
                  </span>
                </div>
                <div
                  data-testid="overnight-live-provider-list"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  {providerOptions.map((prov) => {
                    if (prov.isAntigravity) {
                      return (
                        <button
                          key={prov.id}
                          type="button"
                          data-testid="overnight-provider-antigravity"
                          data-agy-blocked="true"
                          aria-disabled="true"
                          title={
                            agyCompliance.waiverAllowed
                              ? "24h 无人值守夜间工场禁止使用个人版 Antigravity，点击前往查看合规策略"
                              : "Antigravity 个人订阅需先签署免责协议且夜间无人值守不可用，点击前往签署与查看合规"
                          }
                          onClick={handleOpenWaiverSettings}
                          className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-destructive/55 bg-muted/45 px-2.5 py-1 text-xs text-muted-foreground opacity-60 transition-all motion-reduce:transition-none hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                        >
                          <span className="inline-flex items-center gap-1.5 grayscale">
                            <AgentBrandLogo
                              provider="antigravity"
                              size={14}
                              monochrome
                              className="shrink-0"
                            />
                            <span>{prov.label}</span>
                          </span>
                          <span
                            data-testid="overnight-provider-antigravity-waiver-badge"
                            className="inline-flex items-center rounded-md border border-destructive bg-background/95 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-destructive shadow-xs"
                          >
                            {agyCompliance.badgeLabel}
                          </span>
                        </button>
                      );
                    }

                    const active = draft.agentProvider === prov.id;
                    return (
                      <button
                        key={prov.id}
                        type="button"
                        data-testid={`overnight-provider-${prov.id}`}
                        data-pmx-work-panel-control={active ? undefined : "1"}
                        aria-pressed={active}
                        onClick={() =>
                          setDraft((prev) => {
                            const keepsModel =
                              prev.agentModel.trim().length > 0 &&
                              prov.models.some((m) => m.slug === prev.agentModel.trim());
                            return {
                              ...prev,
                              agentProvider: prov.id,
                              agentModel: keepsModel ? prev.agentModel : "",
                            };
                          })
                        }
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all motion-reduce:transition-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "border-primary bg-primary font-semibold text-primary-foreground shadow-xs"
                            : "border-border/80 bg-card/80 text-foreground/90 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                        )}
                      >
                        {prov.isChief ? (
                          <SparklesIcon className="size-3.5 shrink-0" aria-hidden="true" />
                        ) : (
                          <AgentBrandLogo
                            provider={prov.brandProvider}
                            size={14}
                            className="shrink-0"
                          />
                        )}
                        <span>{prov.label}</span>
                      </button>
                    );
                  })}
                </div>

                {liveConfiguredProviders.length === 0 ? (
                  <div
                    data-testid="overnight-no-live-providers-hint"
                    data-pmx-work-panel-card="1"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground"
                  >
                    <span>当前暂无已启用的实时智能体提供方，可先使用「跟随主秘书槽位」或前往配置。</span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      data-testid="overnight-open-providers-settings-btn"
                      data-pmx-work-panel-control="1"
                      onClick={handleOpenProvidersSettings}
                      className="h-7 rounded-lg active:translate-y-px"
                    >
                      前往配置智能体
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  指定模型（实时同步所选提供方已配置模型）
                </span>
                <Select
                  modal={false}
                  value={selectedModelSelectValue}
                  onValueChange={(nextValue) => {
                    if (typeof nextValue !== "string") return;
                    setDraft((prev) => ({
                      ...prev,
                      agentModel:
                        nextValue === OVERNIGHT_DEFAULT_MODEL_SENTINEL ? "" : nextValue,
                    }));
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    data-testid="overnight-agent-model-select"
                    data-pmx-work-panel-control="1"
                    className="h-8 w-full rounded-lg text-xs"
                  >
                    <SelectValue>
                      <span className="truncate">
                        {trimmedAgentModel.length === 0
                          ? activeProviderOption?.isChief
                            ? "跟随主秘书默认模型"
                            : "跟随提供方默认"
                          : (activeModelOption?.label ?? `已保存：${trimmedAgentModel}`)}
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false} className="max-h-72">
                    <SelectItem value={OVERNIGHT_DEFAULT_MODEL_SENTINEL}>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {activeProviderOption?.isChief
                            ? "跟随主秘书默认模型"
                            : "跟随提供方默认"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {activeProviderOption?.isChief
                            ? "自动继承主秘书槽位当前配置的执行模型"
                            : `使用 ${activeProviderOption?.label ?? "所选提供方"} 的默认模型`}
                        </span>
                      </div>
                    </SelectItem>
                    {modelOptions.map((model) => (
                      <SelectItem key={model.slug} value={model.slug}>
                        <div className="flex flex-col">
                          <span className="font-medium">{model.label}</span>
                          {model.subtitle ? (
                            <span className="text-[11px] text-muted-foreground">
                              {model.subtitle}
                            </span>
                          ) : null}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {activeProviderOption?.isChief
                    ? "当前将继承主秘书槽位的实时引擎与默认模型。"
                    : activeProviderOption && activeProviderOption.models.length > 0
                      ? `已同步 ${activeProviderOption.label} 的 ${activeProviderOption.models.length} 个实时配置模型。`
                      : "当前提供方暂无额外模型清单，将使用提供方默认模型。"}
                </p>
              </div>
            </div>

            {/* AGY Unattended / Unsigned Compliance Warning Strip */}
            {agyCompliance.blocked ? (
              <div
                role="alert"
                data-testid="overnight-agy-compliance-warning"
                data-pmx-work-panel-card="1"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive bg-destructive/10 px-3.5 py-3 text-xs text-foreground"
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <ShieldAlertIcon
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-semibold text-destructive">
                      {agyCompliance.warningTitle}
                    </div>
                    <p className="leading-relaxed text-foreground/90">
                      {agyCompliance.warningMessage}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {firstCompliantProvider ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      data-testid="overnight-agy-switch-compliant-btn"
                      data-pmx-work-panel-control="1"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          agentProvider: firstCompliantProvider.id,
                          agentModel: "",
                        }))
                      }
                      className="h-7 rounded-lg active:translate-y-px"
                    >
                      改用 {firstCompliantProvider.label}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    data-testid="overnight-agy-waiver-jump-btn"
                    onClick={handleOpenWaiverSettings}
                    className="h-7 rounded-lg border-destructive bg-background/95 font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive active:translate-y-px"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    需签署免责 · 前往设置
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Oracle Review & Local Worktree Safety Switches */}
            <div className="grid gap-2.5 md:grid-cols-2">
              <label
                data-pmx-work-panel-card="1"
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/75 bg-card/75 px-3.5 py-2.5 transition-colors motion-reduce:transition-none hover:border-border"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <SparklesIcon className="size-3.5 text-primary" />
                    Oracle 只读挑刺审校
                  </div>
                  <div className="text-xs leading-relaxed text-muted-foreground">
                    编码提交后自动启动只读 Oracle 审阅 Diff、单测与安全风险并写入早报
                  </div>
                </div>
                <Switch
                  checked={draft.oracleReviewEnabled}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, oracleReviewEnabled: checked }))
                  }
                />
              </label>

              <label
                data-pmx-work-panel-card="1"
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/75 bg-card/75 px-3.5 py-2.5 transition-colors motion-reduce:transition-none hover:border-border"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <ShieldCheckIcon className="size-3.5 text-emerald-500" />
                    安全保护：仅提交本地隔离 Worktree 分支
                  </div>
                  <div className="text-xs leading-relaxed text-muted-foreground">
                    绝不自动执行 git push，所有改动留在本地独立分支待次日人工审阅合并
                  </div>
                </div>
                <Switch
                  checked={draft.localWorktreeOnlyNoPush}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, localWorktreeOnlyNoPush: checked }))
                  }
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="default"
                data-testid="overnight-save-strategy-btn"
                disabled={savingStrategy || agyCompliance.blocked}
                aria-busy={savingStrategy}
                onClick={() => void handleSaveStrategy()}
                className="rounded-lg active:translate-y-px"
              >
                <SaveIcon className="size-3.5" />
                {savingStrategy ? "保存中..." : "保存执行策略"}
              </Button>
              {agyCompliance.blocked ? (
                <span className="text-xs text-destructive">
                  当前执行代理触发 Antigravity 无人值守风控拦截，请先改选合规代理再保存。
                </span>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </OvernightSectionCard>
  );

  const runsHistorySection = (
    <OvernightSectionCard
      standalone={standalone}
      id="overnight-runs"
      title="区块 C · 运行历史与完工早报"
      icon={<Clock3Icon className="size-4 text-primary" />}
      headerAction={
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
            上次拉取：{formatOvernightTimestamp(lastPollAt)}
          </span>
          <Button
            type="button"
            size="xs"
            variant="default"
            data-testid="overnight-poll-now-btn"
            disabled={pollingNow}
            aria-busy={pollingNow}
            onClick={() => void handlePollNow()}
            className="h-7 rounded-lg active:translate-y-px"
          >
            <RefreshCwIcon
              className={cn("size-3.5", pollingNow && "animate-spin motion-reduce:animate-none")}
            />
            {pollingNow ? "拉取中..." : "立即拉取邮件"}
          </Button>
        </div>
      }
    >
      <div data-testid="overnight-runs-section" className="space-y-3 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          展示近期入站邮件触发的夜间工场任务、Worktree 交付分支、Oracle 审校摘要与桌面端深度审阅链接。
        </p>
        {lastPollError ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/12 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-all">最近一次拉取失败：{lastPollError}</span>
          </div>
        ) : null}

        {runs.length === 0 ? (
          <div
            data-pmx-work-panel-card="1"
            className="flex flex-col items-center rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center"
          >
            <span className="inline-flex size-10 items-center justify-center rounded-xl border border-border/70 bg-card/75 text-muted-foreground">
              <MoonStarIcon className="size-5" aria-hidden="true" />
            </span>
            <div className="mt-2.5 text-xs font-semibold text-foreground">
              暂无夜间工场执行记录
            </div>
            <div className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              配置邮箱与白名单后，发送带{" "}
              <code className="rounded bg-muted/75 px-1 py-0.5 font-mono text-foreground">
                {draft.triggerTag}
              </code>{" "}
              主题的邮件或点击右上角「立即拉取邮件」即可查看执行历史与完工早报。
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "space-y-2.5",
              standalone && "xl:max-h-[calc(100dvh-18rem)] xl:overflow-y-auto xl:pr-1",
            )}
          >
            {runs.map((run) => {
              const badge = formatOvernightRunStatusBadge(run.status);
              return (
                <div
                  key={run.id}
                  data-testid="overnight-run-row"
                  data-pmx-work-panel-card="1"
                  className="space-y-2 rounded-xl border border-border/75 bg-card/75 px-3.5 py-3 transition-colors motion-reduce:transition-none hover:border-border"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {run.subject}
                        </span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {run.reportSent ? <Badge variant="outline">已回发早报</Badge> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>发件人：{run.sender}</span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {formatOvernightTimestamp(run.createdAt)}
                        </span>
                        {run.branchName ? (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                              <GitBranchIcon className="size-3" />
                              {run.branchName}
                            </span>
                          </>
                        ) : null}
                        {run.changedFilesCount > 0 ? (
                          <span className="tabular-nums">
                            · {run.changedFilesCount} 个文件改动
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {run.deepLink ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        data-pmx-work-panel-control="1"
                        onClick={() => onOpenExternalUrl(run.deepLink!)}
                        className="h-7 rounded-lg active:translate-y-px"
                      >
                        <ExternalLinkIcon className="size-3" />
                        审查分支
                      </Button>
                    ) : null}
                  </div>

                  {run.oracleSummary ? (
                    <div className="rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1.5 text-xs leading-relaxed text-foreground/90">
                      <span className="mr-1.5 font-medium text-primary">Oracle 摘要：</span>
                      {run.oracleSummary}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </OvernightSectionCard>
  );

  if (standalone) {
    return (
      <SidebarInset className="h-dvh min-w-0 flex-1 overflow-hidden">
        <PrismuxStageFrame
          glassZone="workPanels"
          rightPanelOpen={topbarPortal.standaloneRightPanelOpen}
        >
          <div
            id="prismux-overnight-factory"
            data-pmx-overnight-settings-page=""
            data-testid="prismux-overnight-factory-page"
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            {/* Unified Compact Full-Bleed Header Bar — aligned 1:1 with Tasks / Board / Scheduled Tasks */}
            <header className="flex flex-none flex-wrap items-center justify-between gap-2.5 border-b border-border/65 px-4 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/14 text-primary">
                  <MoonStarIcon className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                    夜间全自动工场（Overnight Factory）与邮箱绑定
                  </h1>
                  {statusBadges}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="default"
                  data-testid="overnight-header-poll-now-btn"
                  disabled={pollingNow}
                  aria-busy={pollingNow}
                  onClick={() => void handlePollNow()}
                  className="h-7 rounded-lg active:translate-y-px"
                >
                  <RefreshCwIcon
                    className={cn("size-3.5", pollingNow && "animate-spin motion-reduce:animate-none")}
                  />
                  {pollingNow ? "拉取中..." : "立即拉取邮件"}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-pmx-work-panel-control="1"
                  disabled={loading}
                  aria-busy={loading}
                  onClick={() => void loadAll(false)}
                  className="h-7 rounded-lg active:translate-y-px"
                >
                  <RefreshCwIcon
                    className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}
                  />
                  刷新状态
                </Button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost-muted"
                        size="icon-sm"
                        data-testid="overnight-factory-close-button"
                        onClick={() => void navigateToMainApp()}
                        aria-label="关闭夜间全自动工场"
                      />
                    }
                  >
                    <XIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom" sideOffset={6}>
                    返回主会话 (Esc)
                  </TooltipPopup>
                </Tooltip>
              </div>
            </header>

            {/* Full-Bleed Edge-to-Edge Body (no narrow centered max-w-5xl container) */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-gutter-both">
              <div className="flex w-full min-w-0 flex-col gap-4">
                {alertBanners}
                {kpiStrip}

                <div
                  data-testid="overnight-workbench-grid"
                  className="grid w-full min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-12"
                >
                  <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
                    {mailBindingSection}
                    {strategySection}
                  </div>
                  <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-0 xl:col-span-5">
                    {runsHistorySection}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PrismuxStageFrame>
      </SidebarInset>
    );
  }

  return (
    <SettingsPageContainer width="wide">
      {/* Top Status Banner */}
      <div
        id="prismux-overnight-factory"
        data-pmx-overnight-settings-page=""
        data-pmx-work-panel-card="1"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-card/75 px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/14 text-primary">
            <MoonStarIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            夜间全自动工场（Overnight Factory）与邮箱绑定
          </span>
          {statusBadges}
        </div>

        <Button
          type="button"
          size="xs"
          variant="outline"
          data-pmx-work-panel-control="1"
          disabled={loading}
          aria-busy={loading}
          onClick={() => void loadAll(false)}
          className="h-7 rounded-lg active:translate-y-px"
        >
          <RefreshCwIcon
            className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}
          />
          刷新状态
        </Button>
      </div>

      {alertBanners}
      {mailBindingSection}
      {strategySection}
      {runsHistorySection}
    </SettingsPageContainer>
  );
}

const MemoizedOvernightFactoryShell = memo(PrismuxOvernightFactoryShell);

export function PrismuxOvernightFactorySettingsPage({
  standalone,
  daemonOverride,
  daemonReadyOverride,
  daemonBaseUrlOverride,
  serverProvidersOverride,
  settingsOverride,
  waiverOverride,
  chiefProviderOverride,
  initialSnapshotOverride,
  initialRunsOverride,
  workspaceOptionsOverride,
  onOpenExternalUrl,
}: PrismuxOvernightFactorySettingsPageProps = {}) {
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isStandaloneWorkPanel = standalone ?? pathname === "/overnight-factory";
  const runtime = useOptionalPrismuxRuntime();
  const projects = useProjects();
  const liveServerProviders = useAtomValue(primaryServerProvidersAtom);
  const primarySettings = usePrimarySettings();
  const liveWaiver = useSubscriptionWaiverState(runtime?.daemon ?? prismuxDaemonClient);

  const daemon = daemonOverride ?? runtime?.daemon ?? prismuxDaemonClient;
  const daemonReady = daemonReadyOverride ?? runtime?.daemonInfo.ready ?? false;
  const daemonBaseUrl =
    daemonBaseUrlOverride ??
    runtime?.daemonInfo.baseUrl ??
    prismuxDaemonClient.getCachedConnectionInfo().baseUrl;
  const serverProviders = serverProvidersOverride ?? liveServerProviders;
  const settings = settingsOverride !== undefined ? settingsOverride : primarySettings;
  const waiver = waiverOverride ?? liveWaiver;
  const chiefProvider = chiefProviderOverride ?? runtime?.chiefProvider ?? "";
  const workspaceOptions =
    workspaceOptionsOverride ??
    projects.map((p) => ({
      title: p.title,
      cwd: p.workspaceRoot,
    }));

  return (
    <MemoizedOvernightFactoryShell
      standalone={isStandaloneWorkPanel}
      daemon={daemon}
      daemonReady={daemonReady}
      daemonBaseUrl={daemonBaseUrl}
      serverProviders={serverProviders}
      settings={settings}
      waiver={waiver}
      chiefProvider={chiefProvider}
      {...(initialSnapshotOverride !== undefined ? { initialSnapshotOverride } : {})}
      {...(initialRunsOverride !== undefined ? { initialRunsOverride } : {})}
      workspaceOptions={workspaceOptions}
      onOpenExternalUrl={onOpenExternalUrl ?? defaultOpenExternalUrl}
    />
  );
}
