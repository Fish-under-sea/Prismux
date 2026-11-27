/* oxlint-disable prismux/no-untranslated-copy -- Prismux-native Chinese overnight factory settings UI */
import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@prismux/core-contracts";
import type { UnifiedSettings } from "@prismux/core-contracts/settings";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  ArrowRightLeftIcon,
  BookOpenIcon,
  BotIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  Clock3Icon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderGit2Icon,
  GitBranchIcon,
  KeyRoundIcon,
  ListTodoIcon,
  LockIcon,
  MailCheckIcon,
  MailIcon,
  MoonStarIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SearchCheckIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SquareIcon,
  TerminalIcon,
  Trash2Icon,
  Unlink2Icon,
  WifiIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

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
  type DaemonOvernightTaskDto,
  type PrismuxDaemonClient,
} from "../daemonClient";
import { useOptionalPrismuxRuntime } from "../PrismuxRuntimeProvider";
import {
  SUBSCRIPTION_WAIVER_ANCHOR_ID,
  useSubscriptionWaiverState,
  type SubscriptionWaiverState,
} from "../SubscriptionRiskWaiverSection";
import {
  AGENT_MAIL_DOC_URL,
  AGENT_MAIL_INSTALL_CMD,
  AGENT_MAIL_OFFICIAL_PROMPT,
  AGENT_MAIL_PORTAL_URL,
  GMAIL_APP_PASSWORD_LINKS,
  GMAIL_OAUTH_QUICK_LINKS,
  GMAIL_OAUTH_SCOPES_TEXT,
  GMAIL_OAUTH_TUTORIAL_STEPS,
  NETEASE_DOMAIN_PRESETS,
  OVERNIGHT_DEFAULT_MODEL_SENTINEL,
  OVERNIGHT_MAIL_PRESETS,
  applyNeteaseDomain,
  applyOvernightEmailInput,
  applyOvernightMailPreset,
  buildAgentMailActionTestPayload,
  buildOvernightConnectionChecklist,
  buildOvernightLiveProviderOptions,
  buildOvernightMailSavePayload,
  buildOvernightModelOptions,
  buildOvernightStrategySavePayload,
  createDefaultOvernightDraft,
  evaluateGmailOAuthReadiness,
  evaluateOvernightAgyCompliance,
  extractAgentMailStatusFromSnapshot,
  formatOvernightExecutionStageLabel,
  formatOvernightRunStatusBadge,
  formatOvernightTimestamp,
  hydrateOvernightDraftFromSnapshot,
  isMailChannelConfigured,
  isSafeHttpsUrl,
  parseAgentMailTestResponse,
  parseAllowedSendersInput,
  resolveDefaultTestRecipient,
  resolveGmailOAuthRedirectUri,
  resolveMailSectionViewMode,
  shouldAutoCollapseAgentMailSetup,
  shouldDefaultExpandMailChannel,
  shouldDefaultExpandStrategy,
  toDaemonOvernightPatch,
  toggleMailSectionState,
  toggleTutorialStepCompletion,
  type GmailOAuthTutorialStepNumber,
  type OvernightFactoryDraft,
  type OvernightNeteaseDomain,
} from "./overnightFactory.logic";

const PMX_ACCENT_ICON_STYLE = {
  color: "var(--pmx-accent-text, var(--primary))",
} as const;
const PMX_ACCENT_BADGE_STYLE = {
  backgroundColor: "var(--pmx-accent-soft, color-mix(in srgb, var(--primary) 14%, transparent))",
  color: "var(--pmx-accent-text, var(--primary))",
} as const;

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
> &
  Partial<
    Pick<
      PrismuxDaemonClient,
      | "fetchOvernightStatus"
      | "fetchOvernightTasks"
      | "createOvernightTask"
      | "deleteOvernightTask"
      | "runOvernightTask"
      | "runOvernightNow"
      | "cancelOvernightRun"
      | "retryOvernightRun"
      | "deleteOvernightRun"
    >
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
  readonly initialTasksOverride?: readonly DaemonOvernightTaskDto[];
  readonly initialMailSetupExpandedOverride?: boolean;
  readonly workspaceOptionsOverride?: ReadonlyArray<{
    readonly title: string;
    readonly cwd: string;
  }>;
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
  initialTasksOverride,
  initialMailSetupExpandedOverride,
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
  readonly initialTasksOverride?: readonly DaemonOvernightTaskDto[];
  readonly initialMailSetupExpandedOverride?: boolean;
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
  const [tasks, setTasks] = useState<readonly DaemonOvernightTaskDto[]>(
    () => initialTasksOverride ?? [],
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
  const [testRecipientInput, setTestRecipientInput] = useState<string>(() =>
    initialSnapshotOverride
      ? resolveDefaultTestRecipient(hydrateOvernightDraftFromSnapshot(initialSnapshotOverride))
      : "",
  );
  const [oauthPendingUrl, setOauthPendingUrl] = useState<string | null>(null);

  // Mail channel expand state: standalone defaults expanded for unconfigured mailboxes, while
  // verified Agent Mail automatically collapses to the compact verified + test-only view unless
  // the user explicitly clicks "展开配置 / 切换邮箱" (`userExpandedSetup`).
  const [mailExpanded, setMailExpanded] = useState<boolean>(() =>
    standalone
      ? true
      : initialSnapshotOverride
        ? shouldDefaultExpandMailChannel(initialSnapshotOverride, false)
        : false,
  );
  const [userExpandedSetup, setUserExpandedSetup] = useState<boolean>(
    () => initialMailSetupExpandedOverride ?? false,
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
  const lastFocusProbeAtRef = useRef<number>(0);

  const [loading, setLoading] = useState<boolean>(false);
  const [detectingEnv, setDetectingEnv] = useState<boolean>(false);
  const [savingMail, setSavingMail] = useState<boolean>(false);
  const [testingMail, setTestingMail] = useState<boolean>(false);
  const [sendingReport, setSendingReport] = useState<boolean>(false);
  const [startingOAuth, setStartingOAuth] = useState<boolean>(false);
  const [disconnectingGmail, setDisconnectingGmail] = useState<boolean>(false);
  const [savingStrategy, setSavingStrategy] = useState<boolean>(false);
  const [pollingNow, setPollingNow] = useState<boolean>(false);

  // Task Workbench composer & run action states
  const [taskTitle, setTaskTitle] = useState<string>("");
  const [taskPrompt, setTaskPrompt] = useState<string>("");
  const [taskWorkspaceDir, setTaskWorkspaceDir] = useState<string>(
    () =>
      initialSnapshotOverride?.config.strategy.targetWorkspaceDir || workspaceOptions[0]?.cwd || "",
  );
  const [taskProviderOverride, setTaskProviderOverride] = useState<string>("__default__");
  const [taskVerifyCommand, setTaskVerifyCommand] = useState<string>("");
  const [taskSendReport, setTaskSendReport] = useState<boolean>(true);
  const [taskAllowNoFileChanges, setTaskAllowNoFileChanges] = useState<boolean>(false);
  const [runningNow, setRunningNow] = useState<boolean>(false);
  const [creatingTask, setCreatingTask] = useState<boolean>(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [expandedRunLogs, setExpandedRunLogs] = useState<Record<string, boolean>>({});

  // Tencent Agent Mail (agently-cli) interactive setup state
  const [installingAgentMail, setInstallingAgentMail] = useState<boolean>(false);
  const [loggingInAgentMail, setLoggingInAgentMail] = useState<boolean>(false);
  const [checkingAgentMail, setCheckingAgentMail] = useState<boolean>(false);
  const [agentMailPromptOpen, setAgentMailPromptOpen] = useState<boolean>(false);
  const [agentMailActionDetail, setAgentMailActionDetail] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- cleanup pending clipboard copy badge timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleOpenWaiverSettings = () => {
    void navigate({
      to: "/settings/providers",
      hash: SUBSCRIPTION_WAIVER_ANCHOR_ID,
    });
  };

  const handleOpenProvidersSettings = () => {
    void navigate({
      to: "/settings/providers",
    });
  };

  const handleOpenHttpsUrl = (url: string) => {
    if (!isSafeHttpsUrl(url)) return;
    onOpenExternalUrl(url);
  };

  const handleCopyText = async (key: string, value: string, label: string) => {
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
  };

  const applySnapshot = (snapshot: DaemonOvernightConfigSnapshot, syncCollapse = false) => {
    const nextDraft = hydrateOvernightDraftFromSnapshot(snapshot);
    setDraft(nextDraft);
    setCredentialsFile(snapshot.credentialsFile);
    setLastPollAt(snapshot.runtime.lastPollAt);
    setLastPollError(snapshot.runtime.lastPollError);
    if (snapshot.runtime.lastTestResult) {
      setTestResult(snapshot.runtime.lastTestResult);
    }
    const defaultRecipient = resolveDefaultTestRecipient(nextDraft);
    if (defaultRecipient) {
      setTestRecipientInput((prev) => (prev.trim().length > 0 ? prev : defaultRecipient));
    }
    if (nextDraft.targetWorkspaceDir) {
      setTaskWorkspaceDir((prev) => (prev.trim().length > 0 ? prev : nextDraft.targetWorkspaceDir));
    }
    if (syncCollapse) {
      setMailExpanded(shouldDefaultExpandMailChannel(snapshot, standalone));
      setUserExpandedSetup(false);
      setStrategyExpanded(shouldDefaultExpandStrategy(snapshot));
      setOauthTutorialOpen(!snapshot.config.gmail.connected);
    }
    return nextDraft;
  };

  const loadAll = async (syncCollapse = false, forceRefresh = false) => {
    if (forceRefresh) {
      setDetectingEnv(true);
    } else {
      setLoading(true);
    }
    setErrorMsg(null);
    try {
      const [snap, runsResp, tasksResp] = await Promise.all([
        daemon.fetchOvernightConfig(forceRefresh),
        daemon.fetchOvernightRuns(30),
        daemon.fetchOvernightTasks
          ? daemon.fetchOvernightTasks().catch(() => ({ ok: true as const, tasks: [] }))
          : Promise.resolve({ ok: true as const, tasks: [] as DaemonOvernightTaskDto[] }),
      ]);
      const nextDraft = applySnapshot(snap, syncCollapse);
      setRuns(runsResp.runs);
      setTasks(tasksResp.tasks);
      setLastPollAt(runsResp.lastPollAt ?? snap.runtime.lastPollAt);
      setLastPollError(runsResp.lastPollError ?? snap.runtime.lastPollError);
      if (forceRefresh) {
        const am = extractAgentMailStatusFromSnapshot(snap);
        if (am.cliInstalled && am.authorizedEmail) {
          setStatusMsg(
            `环境检测完成：已检测到 agently-cli${am.version ? ` v${am.version}` : ""}，Agent 邮箱已配置（${am.authorizedEmail}）。`,
          );
        } else if (isMailChannelConfigured(nextDraft)) {
          setStatusMsg("环境检测完成：邮箱通道已配置并处于就绪状态。");
        } else if (am.cliInstalled) {
          setStatusMsg(
            `环境检测完成：已检测到 agently-cli${am.version ? ` v${am.version}` : ""}，请点击「发起 OAuth 浏览器授权」完成登录。`,
          );
        } else {
          setStatusMsg("环境检测完成：暂未检测到已登录的 Agent 邮箱或已保存的邮箱凭据。");
        }
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "加载夜间工场与邮箱配置失败，请确认 Daemon 已启动。",
      );
    } finally {
      setLoading(false);
      setDetectingEnv(false);
    }
  };

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- fetch initial daemon overnight config, tasks, and runs once on mount with active environment probe
  useEffect(() => {
    if (initialSnapshotOverride) return;
    let cancelled = false;
    void (async () => {
      try {
        const [snap, runsResp, tasksResp] = await Promise.all([
          daemon.fetchOvernightConfig(true),
          daemon.fetchOvernightRuns(30),
          daemon.fetchOvernightTasks
            ? daemon.fetchOvernightTasks().catch(() => ({ ok: true as const, tasks: [] }))
            : Promise.resolve({ ok: true as const, tasks: [] as DaemonOvernightTaskDto[] }),
        ]);
        if (cancelled) return;
        const nextDraft = hydrateOvernightDraftFromSnapshot(snap);
        setDraft(nextDraft);
        setCredentialsFile(snap.credentialsFile);
        setLastPollAt(runsResp.lastPollAt ?? snap.runtime.lastPollAt);
        setLastPollError(runsResp.lastPollError ?? snap.runtime.lastPollError);
        if (snap.runtime.lastTestResult) {
          setTestResult(snap.runtime.lastTestResult);
        }
        const defaultRecipient = resolveDefaultTestRecipient(nextDraft);
        if (defaultRecipient) {
          setTestRecipientInput((prev) => (prev.trim().length > 0 ? prev : defaultRecipient));
        }
        if (nextDraft.targetWorkspaceDir) {
          setTaskWorkspaceDir((prev) =>
            prev.trim().length > 0 ? prev : nextDraft.targetWorkspaceDir,
          );
        }
        setMailExpanded(shouldDefaultExpandMailChannel(snap, standalone));
        setStrategyExpanded(shouldDefaultExpandStrategy(snap));
        setOauthTutorialOpen(!snap.config.gmail.connected);
        setRuns(runsResp.runs);
        setTasks(tasksResp.tasks);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error ? err.message : "加载夜间工场与邮箱配置失败，请确认 Daemon 已启动。",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [daemon, initialSnapshotOverride, standalone]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- silently re-probe external CLI/config changes when window regains focus
  useEffect(() => {
    if (initialSnapshotOverride || typeof window === "undefined") return;
    let cancelled = false;
    const syncExternalEnv = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastFocusProbeAtRef.current < 3000) return;
      lastFocusProbeAtRef.current = now;
      void (async () => {
        try {
          const snap = await daemon.fetchOvernightConfig(true);
          if (cancelled) return;
          const am = extractAgentMailStatusFromSnapshot(snap);
          setDraft((prev) => {
            const hasTypedImapSecret = prev.imapPasswordInput.trim().length > 0;
            const hasTypedSmtpSecret = prev.smtpPasswordInput.trim().length > 0;
            const hasTypedGmailSecret = prev.gmailClientSecretInput.trim().length > 0;
            const shouldPromoteAgentMail =
              !hasTypedImapSecret &&
              !hasTypedSmtpSecret &&
              !hasTypedGmailSecret &&
              !isMailChannelConfigured(prev) &&
              am.cliInstalled &&
              Boolean(am.authorizedEmail);
            return {
              ...prev,
              ...(shouldPromoteAgentMail
                ? {
                    mode: "imap" as const,
                    emailProvider: "agent_mail" as const,
                    preset: "agent_mail" as const,
                  }
                : {}),
              agentMailCliInstalled: am.cliInstalled,
              agentMailVersion: am.version ?? prev.agentMailVersion,
              agentMailCliPath: am.cliPath ?? prev.agentMailCliPath,
              agentMailLoggedIn: Boolean(am.loggedIn || (am.cliInstalled && am.authorizedEmail)),
              agentMailConfigured: Boolean(
                am.configured || (am.cliInstalled && am.authorizedEmail),
              ),
              agentMailAuthorizedEmail: am.authorizedEmail,
              agentMailAddress: am.authorizedEmail || prev.agentMailAddress,
              agentMailScopes: am.scopes ? [...am.scopes] : prev.agentMailScopes,
              agentMailDailySendQuota: am.dailySendQuota ?? prev.agentMailDailySendQuota,
              agentMailAuthInProgress: am.authInProgress,
              agentMailPendingAuthUrl: am.pendingAuthUrl,
              agentMailLastError: am.lastError,
              gmailConnected: snap.config.gmail.connected,
              gmailBoundEmail: snap.config.gmail.boundEmail || prev.gmailBoundEmail,
              gmailConnectedAt: snap.config.gmail.connectedAt,
              hasImapPassword: snap.secrets.hasImapPassword,
              hasSmtpPassword: snap.secrets.hasSmtpPassword,
              hasGmailClientSecret: snap.secrets.hasGmailClientSecret,
              hasGmailRefreshToken: snap.secrets.hasGmailRefreshToken,
            };
          });
          if (am.authorizedEmail) {
            setTestRecipientInput((prev) => (prev.trim().length > 0 ? prev : am.authorizedEmail!));
          }
        } catch {
          // Ignore transient background focus refresh failures.
        }
      })();
    };
    window.addEventListener("focus", syncExternalEnv);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", syncExternalEnv);
    }
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncExternalEnv);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", syncExternalEnv);
      }
    };
  }, [daemon, initialSnapshotOverride]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- poll daemon config every 3s while agently-cli OAuth browser authorization is in progress
  useEffect(() => {
    if (!draft.agentMailAuthInProgress || initialSnapshotOverride) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const snap = await daemon.fetchOvernightConfig(true);
          if (cancelled) return;
          const am = extractAgentMailStatusFromSnapshot(snap);
          setDraft((prev) => ({
            ...prev,
            ...(am.authorizedEmail
              ? {
                  mode: "imap" as const,
                  emailProvider: "agent_mail" as const,
                  preset: "agent_mail" as const,
                }
              : {}),
            agentMailCliInstalled: am.cliInstalled,
            agentMailVersion: am.version ?? prev.agentMailVersion,
            agentMailCliPath: am.cliPath ?? prev.agentMailCliPath,
            agentMailLoggedIn: Boolean(am.loggedIn || (am.cliInstalled && am.authorizedEmail)),
            agentMailConfigured: Boolean(am.configured || (am.cliInstalled && am.authorizedEmail)),
            agentMailAuthorizedEmail: am.authorizedEmail,
            agentMailAddress: am.authorizedEmail || prev.agentMailAddress,
            agentMailScopes: am.scopes ? [...am.scopes] : prev.agentMailScopes,
            agentMailDailySendQuota: am.dailySendQuota ?? prev.agentMailDailySendQuota,
            agentMailAuthInProgress: am.authInProgress,
            agentMailPendingAuthUrl: am.pendingAuthUrl,
            agentMailLastError: am.lastError,
          }));
          if (!am.authInProgress) {
            if (am.authorizedEmail) {
              setTestRecipientInput((prev) =>
                prev.trim().length > 0 ? prev : am.authorizedEmail!,
              );
              setStatusMsg(`邮箱地址 ${am.authorizedEmail} 已授权并配置完成，可以直接收发邮件了。`);
              setErrorMsg(null);
            } else if (am.lastError) {
              setErrorMsg(am.lastError);
            }
          }
        } catch {
          // Transient polling error ignored; next tick retries.
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [daemon, draft.agentMailAuthInProgress, initialSnapshotOverride]);

  const hasActiveRuns = runs.some((r) => r.status === "queued" || r.status === "running");

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- poll runs & tasks every 2s while an overnight task is queued or actively running
  useEffect(() => {
    if (!hasActiveRuns || initialSnapshotOverride) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const [runsResp, tasksResp] = await Promise.all([
            daemon.fetchOvernightRuns(30),
            daemon.fetchOvernightTasks
              ? daemon.fetchOvernightTasks().catch(() => null)
              : Promise.resolve(null),
          ]);
          if (cancelled) return;
          setRuns(runsResp.runs);
          if (tasksResp) {
            setTasks(tasksResp.tasks);
          }
        } catch {
          // Transient live polling error ignored; next tick retries.
        }
      })();
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [daemon, hasActiveRuns, initialSnapshotOverride]);

  const providerOptions = buildOvernightLiveProviderOptions({ serverProviders, settings });
  const liveConfiguredProviders = providerOptions.filter((item) => !item.isChief);
  const firstCompliantProvider = liveConfiguredProviders.find((item) => !item.isAntigravity);
  const activeProviderOption = providerOptions.find((item) => item.id === draft.agentProvider);
  const modelOptions = buildOvernightModelOptions({
    selectedProvider: activeProviderOption,
    currentModel: draft.agentModel,
  });
  const agyCompliance = evaluateOvernightAgyCompliance({
    agentProvider: draft.agentProvider,
    chiefProvider,
    waiver,
  });

  const handleSaveMail = async () => {
    setSavingMail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = toDaemonOvernightPatch(buildOvernightMailSavePayload(draft));
      const updated = await daemon.updateOvernightConfig(payload);
      applySnapshot(updated, false);
      setStatusMsg(
        draft.preset === "agent_mail"
          ? "Agent 邮箱配置已保存。"
          : "邮箱配置已保存，敏感授权码/密钥已以 0600 权限加密密封写入本地凭据库。",
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "保存邮箱配置失败。");
    } finally {
      setSavingMail(false);
    }
  };

  const applyAgentMailParsedResult = (parsed: ReturnType<typeof parseAgentMailTestResponse>) => {
    setDraft((prev) => ({
      ...prev,
      ...(parsed.authorizedEmail
        ? {
            mode: "imap" as const,
            emailProvider: "agent_mail" as const,
            preset: "agent_mail" as const,
          }
        : {}),
      agentMailCliInstalled: parsed.installed || prev.agentMailCliInstalled,
      agentMailVersion: parsed.version ?? prev.agentMailVersion,
      agentMailCliPath: parsed.cliPath ?? prev.agentMailCliPath,
      agentMailLoggedIn: Boolean(parsed.loggedIn || parsed.authorizedEmail),
      agentMailConfigured: Boolean(parsed.configured || parsed.authorizedEmail),
      agentMailAuthorizedEmail: parsed.authorizedEmail ?? prev.agentMailAuthorizedEmail,
      agentMailAddress: parsed.authorizedEmail || prev.agentMailAddress,
      agentMailScopes: parsed.agentMail?.scopes
        ? [...parsed.agentMail.scopes]
        : prev.agentMailScopes,
      agentMailDailySendQuota: parsed.agentMail?.dailySendQuota ?? prev.agentMailDailySendQuota,
      agentMailAuthInProgress: parsed.authInProgress,
      agentMailPendingAuthUrl: parsed.authUrl,
      agentMailLastError: parsed.ok ? null : parsed.message,
    }));
    if (parsed.authorizedEmail) {
      setTestRecipientInput((prev) => (prev.trim().length > 0 ? prev : parsed.authorizedEmail!));
    }
  };

  const handleTestMail = async () => {
    setTestingMail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payload = toDaemonOvernightPatch(buildOvernightMailSavePayload(draft));
      const res = await daemon.testOvernightMail(payload);
      setTestResult(res);
      if (draft.preset === "agent_mail" || draft.emailProvider === "agent_mail") {
        const parsed = parseAgentMailTestResponse(res);
        applyAgentMailParsedResult(parsed);
      }
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

  const handleInstallAgentMail = async () => {
    setInstallingAgentMail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setAgentMailActionDetail(null);
    try {
      const res = await daemon.testOvernightMail(buildAgentMailActionTestPayload("install"));
      const parsed = parseAgentMailTestResponse(res);
      applyAgentMailParsedResult(parsed);
      const outputSnippet = (parsed.stdout || parsed.stderr).trim();
      if (outputSnippet) {
        setAgentMailActionDetail(outputSnippet);
      }
      if (parsed.ok) {
        setStatusMsg(parsed.message);
      } else {
        setErrorMsg(parsed.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "安装 agently-cli 失败。");
    } finally {
      setInstallingAgentMail(false);
    }
  };

  const handleStartAgentMailLogin = async () => {
    setLoggingInAgentMail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.testOvernightMail(buildAgentMailActionTestPayload("login"));
      const parsed = parseAgentMailTestResponse(res);
      applyAgentMailParsedResult(parsed);
      if (parsed.ok) {
        setStatusMsg(parsed.message);
      } else {
        setErrorMsg(parsed.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "发起 Agent 邮箱 OAuth 授权失败。");
    } finally {
      setLoggingInAgentMail(false);
    }
  };

  const handleCheckAgentMailStatus = async () => {
    setCheckingAgentMail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.testOvernightMail(buildAgentMailActionTestPayload("status"));
      const parsed = parseAgentMailTestResponse(res);
      setTestResult(res);
      applyAgentMailParsedResult(parsed);
      if (parsed.ok) {
        setStatusMsg(parsed.message);
      } else {
        setErrorMsg(parsed.message);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "检测 agently-cli 授权身份失败。");
    } finally {
      setCheckingAgentMail(false);
    }
  };

  const handleSendTestReport = async () => {
    setSendingReport(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const recipient = testRecipientInput.trim() || resolveDefaultTestRecipient(draft);
      const payload = toDaemonOvernightPatch({
        ...buildOvernightMailSavePayload(draft),
        ...(recipient ? { recipient } : {}),
      });
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

  const effectiveTaskProvider =
    taskProviderOverride === "__default__" ? draft.agentProvider : taskProviderOverride;
  const taskAgyCompliance = evaluateOvernightAgyCompliance({
    agentProvider: effectiveTaskProvider,
    chiefProvider,
    waiver,
  });

  const handleRunNow = async () => {
    if (!daemon.runOvernightNow) {
      setErrorMsg("当前 Daemon 版本不支持手动立即执行夜间任务。");
      return;
    }
    const workspaceDir = taskWorkspaceDir.trim() || draft.targetWorkspaceDir.trim();
    const prompt = taskPrompt.trim();
    if (!workspaceDir) {
      setErrorMsg("请先选择或填写目标本地 Git 工作区路径。");
      return;
    }
    if (!prompt) {
      setErrorMsg("请填写任务目标 / Prompt 后再执行。");
      return;
    }
    if (taskAgyCompliance.blocked) {
      setErrorMsg(taskAgyCompliance.warningMessage);
      return;
    }
    setRunningNow(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.runOvernightNow({
        title: taskTitle.trim() || prompt.slice(0, 48),
        prompt,
        workspaceDir,
        provider: effectiveTaskProvider,
        ...(draft.agentModel.trim() ? { model: draft.agentModel.trim() } : {}),
        ...(taskVerifyCommand.trim() ? { verifyCommand: taskVerifyCommand.trim() } : {}),
        sendEmailReport: taskSendReport,
        allowNoFileChanges: taskAllowNoFileChanges,
      });
      setRuns((prev) => [res.run, ...prev.filter((r) => r.id !== res.run.id)]);
      setExpandedRunLogs((prev) => ({ ...prev, [res.run.id]: true }));
      setStatusMsg(res.message || "任务已提交至隔离 Worktree 后台执行，可实时查看阶段与日志。");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "立即执行夜间任务失败。");
    } finally {
      setRunningNow(false);
    }
  };

  const handleCreateTask = async () => {
    if (!daemon.createOvernightTask) {
      setErrorMsg("当前 Daemon 版本不支持夜间任务队列管理。");
      return;
    }
    const workspaceDir = taskWorkspaceDir.trim() || draft.targetWorkspaceDir.trim();
    const prompt = taskPrompt.trim();
    if (!workspaceDir) {
      setErrorMsg("请先选择或填写目标本地 Git 工作区路径。");
      return;
    }
    if (!prompt) {
      setErrorMsg("请填写任务目标 / Prompt 后再加入队列。");
      return;
    }
    if (taskAgyCompliance.blocked) {
      setErrorMsg(taskAgyCompliance.warningMessage);
      return;
    }
    setCreatingTask(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.createOvernightTask({
        title: taskTitle.trim() || prompt.slice(0, 48),
        prompt,
        workspaceDir,
        provider: effectiveTaskProvider,
        ...(draft.agentModel.trim() ? { model: draft.agentModel.trim() } : {}),
        ...(taskVerifyCommand.trim() ? { verifyCommand: taskVerifyCommand.trim() } : {}),
        sendEmailReport: taskSendReport,
        allowNoFileChanges: taskAllowNoFileChanges,
        triggerMode: "manual",
      });
      setTasks((prev) => [res.task, ...prev.filter((t) => t.id !== res.task.id)]);
      setTaskTitle("");
      setTaskPrompt("");
      setStatusMsg(`已将任务「${res.task.title}」加入夜间工场队列，可随时一键运行或交由定时调度。`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "创建夜间任务失败。");
    } finally {
      setCreatingTask(false);
    }
  };

  const handleRunSavedTask = async (task: DaemonOvernightTaskDto) => {
    if (!daemon.runOvernightTask) return;
    setBusyTaskId(task.id);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await daemon.runOvernightTask(task.id);
      setRuns((prev) => [res.run, ...prev.filter((r) => r.id !== res.run.id)]);
      setExpandedRunLogs((prev) => ({ ...prev, [res.run.id]: true }));
      setStatusMsg(res.message || `已启动队列任务「${task.title}」。`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `启动任务「${task.title}」失败。`);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDeleteSavedTask = async (task: DaemonOvernightTaskDto) => {
    if (!daemon.deleteOvernightTask) return;
    setBusyTaskId(task.id);
    setErrorMsg(null);
    try {
      await daemon.deleteOvernightTask(task.id);
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
      setStatusMsg(`已删除队列任务「${task.title}」。`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `删除任务「${task.title}」失败。`);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleCancelRun = async (runId: string) => {
    if (!daemon.cancelOvernightRun) return;
    setBusyRunId(runId);
    setErrorMsg(null);
    try {
      const res = await daemon.cancelOvernightRun(runId);
      setRuns((prev) => prev.map((r) => (r.id === runId ? res.run : r)));
      setStatusMsg(res.message || "已发送取消信号。");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "取消任务运行失败。");
    } finally {
      setBusyRunId(null);
    }
  };

  const handleRetryRun = async (runId: string) => {
    if (!daemon.retryOvernightRun) return;
    setBusyRunId(runId);
    setErrorMsg(null);
    try {
      const res = await daemon.retryOvernightRun(runId);
      setRuns((prev) => [res.run, ...prev.filter((r) => r.id !== res.run.id)]);
      setExpandedRunLogs((prev) => ({ ...prev, [res.run.id]: true }));
      setStatusMsg(res.message || "已重新提交执行。");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "重新运行任务失败。");
    } finally {
      setBusyRunId(null);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!daemon.deleteOvernightRun) return;
    setBusyRunId(runId);
    setErrorMsg(null);
    try {
      await daemon.deleteOvernightRun(runId);
      setRuns((prev) => prev.filter((r) => r.id !== runId));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "删除运行记录失败。");
    } finally {
      setBusyRunId(null);
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
  const agentMailAutoCollapsed = shouldAutoCollapseAgentMailSetup({
    draft,
    userExpandedSetup,
  });
  const mailViewMode = resolveMailSectionViewMode({
    draft,
    mailExpanded,
    userExpandedSetup,
  });
  const handleToggleMailSection = () => {
    const next = toggleMailSectionState({
      draft,
      mailExpanded,
      userExpandedSetup,
    });
    setMailExpanded(next.mailExpanded);
    setUserExpandedSetup(next.userExpandedSetup);
  };
  const connectionChecklist = buildOvernightConnectionChecklist(draft, testResult);
  const defaultTestRecipient = resolveDefaultTestRecipient(draft);
  const isAgentMailSelected =
    draft.mode === "imap" &&
    (draft.preset === "agent_mail" || draft.emailProvider === "agent_mail");
  const activeAgentMailEmail = (draft.agentMailAuthorizedEmail || draft.agentMailAddress).trim();
  const activeNeteaseSpec = NETEASE_DOMAIN_PRESETS[draft.neteaseDomain];
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
      <Badge variant="outline">
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
          className="flex items-center gap-2 rounded-xl border border-success/35 bg-success/10 px-3.5 py-2.5 text-xs text-foreground"
        >
          <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />
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
      {/* KPI 1: 工场状态与时间窗口 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-border/75 bg-card/75 px-3.5 py-2.5 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MoonStarIcon
              className="size-3.5 shrink-0"
              style={PMX_ACCENT_ICON_STYLE}
              aria-hidden="true"
            />
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

      {/* KPI 2: 触发规则与白名单 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-border/75 bg-card/75 px-3.5 py-2.5 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldCheckIcon
              className="size-3.5 shrink-0 text-success-foreground"
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

      {/* KPI 3: 运行记录与最近拉取 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-border/75 bg-card/75 px-3.5 py-2.5 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock3Icon
              className="size-3.5 shrink-0"
              style={PMX_ACCENT_ICON_STYLE}
              aria-hidden="true"
            />
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

      {/* KPI 4: 邮箱收发通道 */}
      <div
        data-pmx-work-panel-card="1"
        className="flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-border/75 bg-card/75 px-3.5 py-2.5 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MailIcon
              className="size-3.5 shrink-0"
              style={PMX_ACCENT_ICON_STYLE}
              aria-hidden="true"
            />
            邮箱收发通道
          </span>
          <Badge
            data-testid="overnight-kpi-mail-badge"
            variant={mailConfigured ? "success" : "secondary"}
          >
            {mailConfigured ? "已配置 · 已就绪" : "待配置"}
          </Badge>
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="truncate text-sm font-semibold text-foreground">
            {draft.mode === "gmail-oauth2"
              ? draft.gmailConnected && draft.gmailBoundEmail
                ? draft.gmailBoundEmail
                : "Gmail OAuth2"
              : isAgentMailSelected
                ? activeAgentMailEmail || "Agent 邮箱 · agently-cli"
                : draft.email.trim() || `${activePresetSpec.label} · IMAP/SMTP`}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {draft.mode === "gmail-oauth2"
              ? draft.gmailConnected
                ? "Google OAuth2 · 已在线绑定"
                : "Google OAuth2 · 待完成浏览器授权"
              : isAgentMailSelected
                ? activeAgentMailEmail
                  ? `agent.qq.com · 已配置${draft.agentMailVersion ? ` (v${draft.agentMailVersion})` : ""}`
                  : draft.agentMailCliInstalled
                    ? `agent.qq.com · 已装 CLI${draft.agentMailVersion ? ` v${draft.agentMailVersion}` : ""}，待授权`
                    : "agent.qq.com · 待安装 agently-cli"
                : `${activePresetSpec.label} · ${draft.imapHost || "自定义主机"}:${draft.imapPort || "993"}`}
          </div>
        </div>
      </div>
    </div>
  );

  const renderMailTestRow = (options: { readonly includeSaveButton: boolean }) => (
    <div
      data-testid="overnight-mail-test-row"
      className={cn(
        "flex flex-wrap items-center gap-2.5",
        options.includeSaveButton && "border-t border-border/60 pt-3",
      )}
    >
      {options.includeSaveButton ? (
        <Button
          type="button"
          size="sm"
          variant="default"
          data-testid="overnight-save-mail-btn"
          disabled={savingMail}
          aria-busy={savingMail}
          onClick={() => void handleSaveMail()}
        >
          <SaveIcon className="size-3.5" />
          {savingMail ? "保存中..." : "保存邮箱配置"}
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant={options.includeSaveButton ? "outline" : "default"}
        data-testid="overnight-test-mail-btn"
        data-pmx-work-panel-control={options.includeSaveButton ? "1" : undefined}
        disabled={testingMail}
        aria-busy={testingMail}
        onClick={() => void handleTestMail()}
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
      >
        <SendIcon className="size-3.5" />
        {sendingReport ? "发送中..." : "发送测试早报"}
      </Button>

      <span
        aria-hidden="true"
        className={cn(
          "hidden h-4 w-px shrink-0 bg-border/75",
          options.includeSaveButton ? "lg:inline-block" : "md:inline-block",
        )}
      />

      <div
        data-testid="overnight-test-recipient-group"
        className="flex min-w-60 flex-1 items-center gap-2 sm:max-w-sm"
      >
        <label
          htmlFor="overnight-test-recipient-input"
          className="shrink-0 whitespace-nowrap text-xs font-medium text-muted-foreground"
        >
          测试收件人：
        </label>
        <Input
          id="overnight-test-recipient-input"
          size="sm"
          type="email"
          data-testid="overnight-test-recipient-input"
          data-pmx-work-panel-control="1"
          value={testRecipientInput}
          onChange={(e) => setTestRecipientInput(e.target.value)}
          placeholder={defaultTestRecipient || "留空默认发往当前配置邮箱"}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  );

  const mailTestResultBlock = testResult ? (
    <div
      data-testid="overnight-mail-test-result"
      data-pmx-work-panel-card="1"
      className={cn(
        "space-y-2 rounded-xl border px-3.5 py-2.5 text-xs",
        testResult.ok
          ? "border-success/35 bg-success/10 text-foreground"
          : "border-destructive/40 bg-destructive/10 text-foreground",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium">
          {testResult.ok ? (
            <CheckCircle2Icon className="size-4 text-success-foreground" />
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
          className={cn(
            "rounded-lg border bg-card/75 px-2.5 py-1.5",
            testResult.inbound.ok ? "border-success/30" : "border-destructive/40",
          )}
        >
          <div className="flex items-center justify-between font-medium">
            <span className="flex items-center gap-1">
              {testResult.inbound.ok ? (
                <CheckCircle2Icon className="size-3.5 text-success-foreground" />
              ) : (
                <XCircleIcon className="size-3.5 text-destructive" />
              )}
              收信通道（Inbound）
            </span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {testResult.inbound.latencyMs} ms
            </span>
          </div>
          <div className="mt-0.5 text-muted-foreground">{testResult.inbound.message}</div>
          {testResult.inbound.hint ? (
            <div
              data-testid="overnight-inbound-hint"
              className="mt-1.5 rounded-md border border-warning/35 bg-warning/10 px-2 py-1 text-2xs leading-relaxed text-foreground"
            >
              修复建议：{testResult.inbound.hint}
            </div>
          ) : null}
        </div>
        <div
          data-pmx-work-panel-card="1"
          className={cn(
            "rounded-lg border bg-card/75 px-2.5 py-1.5",
            testResult.outbound.ok ? "border-success/30" : "border-destructive/40",
          )}
        >
          <div className="flex items-center justify-between font-medium">
            <span className="flex items-center gap-1">
              {testResult.outbound.ok ? (
                <CheckCircle2Icon className="size-3.5 text-success-foreground" />
              ) : (
                <XCircleIcon className="size-3.5 text-destructive" />
              )}
              发信通道（Outbound）
            </span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {testResult.outbound.latencyMs} ms
            </span>
          </div>
          <div className="mt-0.5 text-muted-foreground">{testResult.outbound.message}</div>
          {testResult.outbound.hint ? (
            <div
              data-testid="overnight-outbound-hint"
              className="mt-1.5 rounded-md border border-warning/35 bg-warning/10 px-2 py-1 text-2xs leading-relaxed text-foreground"
            >
              修复建议：{testResult.outbound.hint}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  const mailBindingSection = (
    <OvernightSectionCard
      standalone={standalone}
      id="overnight-mail-binding"
      title="邮箱通道与收发测试"
      icon={<MailIcon className="size-4" style={PMX_ACCENT_ICON_STYLE} />}
      headerAction={
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            data-testid="overnight-mail-section-badge"
            variant={mailConfigured ? "success" : "secondary"}
          >
            {mailConfigured
              ? draft.mode === "gmail-oauth2"
                ? `Gmail 已配置${draft.gmailBoundEmail ? ` · ${draft.gmailBoundEmail}` : ""}`
                : isAgentMailSelected
                  ? `Agent 邮箱已配置${activeAgentMailEmail ? ` · ${activeAgentMailEmail}` : ""}`
                  : `IMAP/SMTP 已配置${draft.email ? ` · ${draft.email}` : ""}`
              : mailViewMode === "expanded_setup"
                ? "待配置邮箱通道"
                : "通道未配置（已折叠）"}
          </Badge>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="overnight-redetect-env-btn"
            data-pmx-work-panel-control="1"
            disabled={detectingEnv}
            aria-busy={detectingEnv}
            onClick={() => void loadAll(false, true)}
          >
            <SearchCheckIcon
              className={cn("size-3.5", detectingEnv && "animate-pulse motion-reduce:animate-none")}
            />
            {detectingEnv ? "检测中..." : "重新检测环境"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="overnight-mail-toggle-btn"
            data-pmx-work-panel-control="1"
            aria-expanded={mailViewMode === "expanded_setup"}
            onClick={handleToggleMailSection}
          >
            {mailViewMode === "expanded_setup" ? (
              <>
                <ChevronDownIcon className="size-3.5" />
                收起配置
              </>
            ) : agentMailAutoCollapsed ? (
              <>
                <ChevronRightIcon className="size-3.5" />
                展开配置 / 切换邮箱
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
      <div
        data-testid="overnight-mail-section"
        data-mail-view-mode={mailViewMode}
        className="space-y-3.5 p-4"
      >
        {mailViewMode === "agent_mail_verified_compact" ? (
          <>
            {/* Sleek Verified Agent Mail Summary Bar (original onboarding/presets auto-collapsed) */}
            <div
              data-testid="overnight-agent-mail-verified-summary"
              data-pmx-work-panel-card="1"
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border/75 bg-muted/20 px-3.5 py-2.5 text-xs"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <CheckCircle2Icon
                  className="size-4 shrink-0 text-success-foreground"
                  aria-hidden="true"
                />
                <span className="font-medium text-foreground">Agent 邮箱已验证</span>
                <code
                  data-testid="overnight-agent-mail-verified-address"
                  className="rounded-md border border-border/70 bg-card/85 px-2 py-0.5 font-mono text-xs font-semibold text-foreground"
                >
                  {activeAgentMailEmail}
                </code>
                <Badge data-testid="overnight-agent-mail-cli-badge" variant="secondary">
                  {`agently-cli 已安装${draft.agentMailVersion ? ` v${draft.agentMailVersion}` : ""}`}
                </Badge>
                {draft.agentMailDailySendQuota !== null ? (
                  <Badge variant="outline">日发信额度 {draft.agentMailDailySendQuota}</Badge>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-testid="overnight-agent-mail-copy-address-btn"
                  data-pmx-work-panel-control="1"
                  onClick={() =>
                    void handleCopyText(
                      "agent-mail-address",
                      activeAgentMailEmail,
                      "Agent 邮箱地址",
                    )
                  }
                >
                  {copiedKey === "agent-mail-address" ? (
                    <>
                      <CheckIcon className="size-3.5 text-success-foreground" />
                      已复制
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3.5" />
                      复制邮箱
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Test Pathway ONLY: buttons left + inline recipient input right on SAME ROW */}
            {renderMailTestRow({ includeSaveButton: false })}
            {mailTestResultBlock}
          </>
        ) : mailViewMode === "collapsed_summary" ? (
          <div
            data-pmx-work-panel-card="1"
            className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border/65 bg-muted/20 px-3.5 py-2.5 text-xs text-muted-foreground"
          >
            <div className="flex flex-wrap items-center gap-2">
              <MailIcon className="size-4 shrink-0" style={PMX_ACCENT_ICON_STYLE} />
              <span>
                当前接入方式：
                <strong className="font-medium text-foreground">
                  {draft.mode === "gmail-oauth2"
                    ? "Gmail OAuth2"
                    : isAgentMailSelected
                      ? "Agent 邮箱（agent.qq.com）"
                      : "IMAP / SMTP 通用邮箱"}
                </strong>
                {" · 凭据文件："}
                <code className="rounded bg-muted/75 px-1.5 py-0.5 font-mono text-xs text-foreground">
                  {credentialsFile}
                </code>
              </span>
            </div>
            <Button type="button" size="xs" variant="default" onClick={() => setMailExpanded(true)}>
              配置收发邮箱
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              支持通用 IMAP / SMTP（内置谷歌邮箱 Gmail / QQ / Agent 邮箱 / Outlook / 网易 163 & 126
              / 自定义预设）与 Google OAuth2 授权。所有授权码与密钥仅写加密落盘，界面永不回显明文。
            </p>

            {/* 4-Step Visual Connection Status Checklist (expanded setup view) */}
            <div
              data-testid="overnight-connection-checklist"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
            >
              {connectionChecklist.map((step, index) => (
                <div
                  key={step.id}
                  data-testid={`overnight-checklist-${step.id}`}
                  data-status={step.status}
                  data-pmx-work-panel-card="1"
                  className={cn(
                    "flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-xs",
                    step.status === "passed"
                      ? "border-success/35 bg-success/10 text-foreground"
                      : step.status === "error"
                        ? "border-destructive/45 bg-destructive/10 text-foreground"
                        : step.status === "warning"
                          ? "border-warning/40 bg-warning/10 text-foreground"
                          : "border-border/65 bg-muted/20 text-muted-foreground",
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {step.status === "passed" ? (
                      <CheckCircle2Icon
                        className="size-3.5 text-success-foreground"
                        aria-hidden="true"
                      />
                    ) : step.status === "error" ? (
                      <XCircleIcon className="size-3.5 text-destructive" aria-hidden="true" />
                    ) : step.status === "warning" ? (
                      <AlertTriangleIcon className="size-3.5 text-warning" aria-hidden="true" />
                    ) : (
                      <CircleIcon
                        className="size-3.5 text-muted-foreground/70"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="truncate font-semibold text-foreground">
                      {index + 1}. {step.label}
                    </div>
                    <div className="line-clamp-2 text-2xs leading-snug text-muted-foreground">
                      {step.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Mode Switcher: IMAP / SMTP 通用邮箱 FIRST (left), Gmail OAuth2 SECOND (right) */}
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
                      emailProvider:
                        selected === "gmail-oauth2"
                          ? "gmail_oauth2"
                          : prev.preset === "agent_mail"
                            ? "agent_mail"
                            : "imap_smtp",
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

            {/* Generic IMAP / SMTP & Agent Mail Preset Workbench (Default) */}
            {draft.mode === "imap" ? (
              <div
                data-testid="overnight-imap-form"
                data-pmx-work-panel-card="1"
                className="space-y-3.5 rounded-xl border border-border/75 bg-muted/20 p-3.5"
              >
                {/* Exact 6-Card Mailbox Preset Grid (3x2 Balanced Grid) */}
                <div className="space-y-2">
                  <div className="text-xs font-medium text-foreground">国内 / 国际邮箱一键预设</div>
                  <div
                    data-testid="overnight-mailbox-presets-grid"
                    className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    {OVERNIGHT_MAIL_PRESETS.map((preset) => {
                      const active = draft.preset === preset.id;
                      const subtitleText =
                        preset.id === "netease" && active ? activeNeteaseSpec.note : preset.note;
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
                            "cursor-pointer rounded-lg border px-3 py-2 text-left text-xs transition-all motion-reduce:transition-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            active
                              ? "border-primary/70 bg-primary/15 font-semibold text-foreground shadow-sm ring-1 ring-primary/30"
                              : "border-border/80 bg-card/80 text-foreground/90 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                          )}
                        >
                          <div className="truncate">{preset.label}</div>
                          <div
                            className={cn(
                              "mt-0.5 truncate text-2xs font-normal",
                              active ? "text-foreground/75" : "text-muted-foreground",
                            )}
                          >
                            {subtitleText}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Self-contained Tencent Agent Mail (agent.qq.com) Setup Card */}
                {isAgentMailSelected ? (
                  <div
                    data-testid="overnight-agent-mail-card"
                    data-pmx-work-panel-card="1"
                    className="space-y-3.5 rounded-xl border border-primary/30 bg-card/75 p-4 text-xs text-foreground"
                  >
                    {/* Top Status Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/60 pb-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <BotIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="font-semibold text-foreground">
                          Agent 邮箱（agent.qq.com）
                        </span>
                        <Badge
                          data-testid="overnight-agent-mail-cli-badge"
                          variant={draft.agentMailCliInstalled ? "success" : "secondary"}
                        >
                          {draft.agentMailCliInstalled
                            ? `agently-cli 已安装${draft.agentMailVersion ? ` v${draft.agentMailVersion}` : ""}`
                            : "未安装 CLI"}
                        </Badge>
                        <Badge
                          data-testid="overnight-agent-mail-auth-badge"
                          variant={
                            activeAgentMailEmail
                              ? "success"
                              : draft.agentMailAuthInProgress
                                ? "warning"
                                : "outline"
                          }
                        >
                          {activeAgentMailEmail
                            ? "已配置 · 已授权"
                            : draft.agentMailAuthInProgress
                              ? "等待浏览器授权..."
                              : "未授权"}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        data-testid="overnight-agent-mail-portal-btn"
                        data-pmx-work-panel-control="1"
                        onClick={() => handleOpenHttpsUrl(AGENT_MAIL_PORTAL_URL)}
                      >
                        <ExternalLinkIcon className="size-3.5" />
                        打开 agent.qq.com ↗
                      </Button>
                    </div>

                    {/* Authorized Identity Highlight */}
                    {activeAgentMailEmail ? (
                      <div
                        data-testid="overnight-agent-mail-address"
                        className="space-y-1.5 rounded-lg border border-border/75 bg-muted/25 px-3 py-2 text-xs text-foreground"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />
                            <span>已配置 Agent 邮箱：</span>
                            <code className="rounded bg-card/80 px-1.5 py-0.5 font-mono font-semibold text-foreground">
                              {activeAgentMailEmail}
                            </code>
                            {draft.agentMailDailySendQuota !== null ? (
                              <Badge variant="outline">
                                日发信额度 {draft.agentMailDailySendQuota}
                              </Badge>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            data-pmx-work-panel-control="1"
                            onClick={() =>
                              void handleCopyText(
                                "agent-mail-address",
                                activeAgentMailEmail,
                                "Agent 邮箱地址",
                              )
                            }
                          >
                            {copiedKey === "agent-mail-address" ? (
                              <>
                                <CheckIcon className="size-3.5 text-success-foreground" />
                                已复制
                              </>
                            ) : (
                              <>
                                <CopyIcon className="size-3.5" />
                                复制邮箱
                              </>
                            )}
                          </Button>
                        </div>
                        {draft.agentMailCliPath || draft.agentMailScopes.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-2xs text-muted-foreground">
                            {draft.agentMailCliPath ? (
                              <span className="truncate font-mono">
                                CLI: {draft.agentMailCliPath}
                              </span>
                            ) : null}
                            {draft.agentMailScopes.length > 0 ? (
                              <span>权限：{draft.agentMailScopes.join(", ")}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="leading-relaxed text-muted-foreground">
                        腾讯 QQ 邮箱专为 AI Agent 打造的原生邮箱，无需配置 IMAP / SMTP
                        授权码。按下方 3 步完成 CLI 安装与 OAuth 浏览器授权即可直接收发邮件。
                      </p>
                    )}

                    {/* 3-Step Guided Action Bar */}
                    <div className="grid gap-2.5 md:grid-cols-3">
                      {/* Step 1: Install / Update CLI */}
                      <div
                        data-pmx-work-panel-card="1"
                        className="flex flex-col justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 p-3"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-foreground">1. 安装 / 更新 CLI</div>
                          <code className="block truncate rounded bg-card/80 px-2 py-1 font-mono text-2xs text-muted-foreground">
                            {AGENT_MAIL_INSTALL_CMD}
                          </code>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="default"
                            data-testid="overnight-agent-mail-install-btn"
                            disabled={installingAgentMail}
                            aria-busy={installingAgentMail}
                            onClick={() => void handleInstallAgentMail()}
                          >
                            <DownloadIcon className="size-3.5" />
                            {installingAgentMail ? "安装中..." : "一键安装 / 更新 CLI"}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            data-testid="overnight-agent-mail-copy-install-btn"
                            data-pmx-work-panel-control="1"
                            onClick={() =>
                              void handleCopyText(
                                "agent-mail-install-cmd",
                                AGENT_MAIL_INSTALL_CMD,
                                "安装命令",
                              )
                            }
                          >
                            {copiedKey === "agent-mail-install-cmd" ? (
                              <CheckIcon className="size-3.5 text-success-foreground" />
                            ) : (
                              <CopyIcon className="size-3.5" />
                            )}
                            复制命令
                          </Button>
                        </div>
                      </div>

                      {/* Step 2: OAuth Login */}
                      <div
                        data-pmx-work-panel-card="1"
                        className="flex flex-col justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 p-3"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-foreground">
                            2. 发起 OAuth 浏览器授权
                          </div>
                          <div className="text-2xs leading-relaxed text-muted-foreground">
                            后台启动{" "}
                            <code className="font-mono text-foreground">
                              agently-cli auth login
                            </code>
                            ，浏览器授权完成后自动回填邮箱。
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="default"
                            data-testid="overnight-agent-mail-login-btn"
                            disabled={loggingInAgentMail}
                            aria-busy={loggingInAgentMail}
                            onClick={() => void handleStartAgentMailLogin()}
                          >
                            <KeyRoundIcon className="size-3.5" />
                            {loggingInAgentMail ? "正在获取授权链接..." : "发起 OAuth 浏览器授权"}
                          </Button>
                        </div>
                      </div>

                      {/* Step 3: Verify Identity */}
                      <div
                        data-pmx-work-panel-card="1"
                        className="flex flex-col justify-between gap-2 rounded-lg border border-border/70 bg-muted/25 p-3"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-foreground">3. 检测授权身份</div>
                          <div className="text-2xs leading-relaxed text-muted-foreground">
                            运行 <code className="font-mono text-foreground">agently-cli +me</code>{" "}
                            验证已绑定的 @agent.qq.com 邮箱地址。
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            data-testid="overnight-agent-mail-status-btn"
                            data-pmx-work-panel-control="1"
                            disabled={checkingAgentMail}
                            aria-busy={checkingAgentMail}
                            onClick={() => void handleCheckAgentMailStatus()}
                          >
                            <RefreshCwIcon
                              className={cn(
                                "size-3.5",
                                checkingAgentMail && "animate-spin motion-reduce:animate-none",
                              )}
                            />
                            {checkingAgentMail ? "检测中..." : "检测授权身份（agently-cli +me）"}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Verbatim Unmodified Opaque OAuth URL Display */}
                    {draft.agentMailPendingAuthUrl ? (
                      <div
                        data-testid="overnight-agent-mail-oauth-box"
                        className="space-y-2 rounded-lg border border-primary/40 bg-primary/10 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">
                            请点击或复制以下链接在浏览器中完成授权：
                          </span>
                          {draft.agentMailAuthInProgress ? (
                            <Badge variant="warning">等待浏览器授权，自动刷新中...</Badge>
                          ) : null}
                        </div>
                        <pre
                          data-testid="overnight-agent-mail-oauth-url"
                          className="overflow-x-auto rounded-md border border-border/75 bg-card/90 px-3 py-2 font-mono text-2xs break-all whitespace-pre-wrap text-foreground select-all"
                        >
                          <code>{draft.agentMailPendingAuthUrl}</code>
                        </pre>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="xs"
                            variant="default"
                            data-testid="overnight-agent-mail-open-auth-btn"
                            onClick={() => handleOpenHttpsUrl(draft.agentMailPendingAuthUrl!)}
                          >
                            <ExternalLinkIcon className="size-3.5" />
                            在浏览器打开授权 ↗
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            data-testid="overnight-agent-mail-copy-auth-btn"
                            data-pmx-work-panel-control="1"
                            onClick={() =>
                              void handleCopyText(
                                "agent-mail-oauth-url",
                                draft.agentMailPendingAuthUrl!,
                                "授权链接",
                              )
                            }
                          >
                            {copiedKey === "agent-mail-oauth-url" ? (
                              <>
                                <CheckIcon className="size-3.5 text-success-foreground" />
                                已复制授权链接
                              </>
                            ) : (
                              <>
                                <CopyIcon className="size-3.5" />
                                复制授权链接
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {/* Optional CLI Action Output / Error Feedback */}
                    {agentMailActionDetail ? (
                      <pre className="max-h-32 overflow-auto rounded-lg border border-border/70 bg-muted/40 px-3 py-2 font-mono text-2xs whitespace-pre-wrap text-muted-foreground">
                        {agentMailActionDetail}
                      </pre>
                    ) : null}

                    {/* Compact Collapsible Official Agent Prompt Tip */}
                    <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
                      <button
                        type="button"
                        data-testid="overnight-agent-mail-prompt-toggle"
                        aria-expanded={agentMailPromptOpen}
                        onClick={() => setAgentMailPromptOpen((prev) => !prev)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <span className="flex items-center gap-1.5">
                          <TerminalIcon className="size-3.5 text-primary" aria-hidden="true" />
                          <span>让 AI Agent 自动安装并配置（一键复制官方接入提示词）</span>
                        </span>
                        {agentMailPromptOpen ? (
                          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                      {agentMailPromptOpen ? (
                        <div
                          data-testid="overnight-agent-mail-prompt-body"
                          className="space-y-2 border-t border-border/60 bg-card/75 px-3 py-2.5"
                        >
                          <code className="block rounded-md bg-muted/75 px-2.5 py-1.5 font-mono text-2xs break-all text-foreground select-all">
                            {AGENT_MAIL_OFFICIAL_PROMPT}
                          </code>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              data-testid="overnight-agent-mail-copy-prompt-btn"
                              data-pmx-work-panel-control="1"
                              onClick={() =>
                                void handleCopyText(
                                  "agent-mail-official-prompt",
                                  AGENT_MAIL_OFFICIAL_PROMPT,
                                  "官方 Agent 接入提示词",
                                )
                              }
                            >
                              {copiedKey === "agent-mail-official-prompt" ? (
                                <>
                                  <CheckIcon className="size-3.5 text-success-foreground" />
                                  已复制提示词
                                </>
                              ) : (
                                <>
                                  <CopyIcon className="size-3.5" />
                                  复制官方接入提示词
                                </>
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              data-pmx-work-panel-control="1"
                              onClick={() => handleOpenHttpsUrl(AGENT_MAIL_DOC_URL)}
                            >
                              <ExternalLinkIcon className="size-3.5" />
                              查看 cli-setup.md ↗
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Contextual NetEase 163.com / 126.com Inline Segmented Switch */}
                    {draft.preset === "netease" ? (
                      <div
                        data-testid="overnight-netease-domain-bar"
                        data-pmx-work-panel-card="1"
                        className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-xs text-foreground"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-semibold text-foreground">
                            网易邮箱域名切换（163.com / 126.com）
                          </div>
                          <div className="text-2xs text-muted-foreground">
                            当前服务器：{activeNeteaseSpec.note} · 输入 @126.com 或 @163.com
                            邮箱时也会自动切换主机
                          </div>
                        </div>
                        <ToggleGroup
                          variant="segmented"
                          aria-label="网易邮箱域名"
                          data-testid="overnight-netease-domain-switch"
                          value={[draft.neteaseDomain]}
                          onValueChange={(next) => {
                            const selected = next[0];
                            if (selected === "163.com" || selected === "126.com") {
                              setDraft((prev) =>
                                applyNeteaseDomain(prev, selected as OvernightNeteaseDomain),
                              );
                            }
                          }}
                        >
                          <Toggle value="163.com" data-testid="overnight-netease-domain-163">
                            163.com
                          </Toggle>
                          <Toggle value="126.com" data-testid="overnight-netease-domain-126">
                            126.com
                          </Toggle>
                        </ToggleGroup>
                      </div>
                    ) : null}

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
                              Gmail 通用邮箱登录需先开启 Google 两步验证，再生成一个 16
                              位「应用专用密码 (App Password)」，直接填入下方 IMAP/SMTP
                              授权码即可完成绑定。
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
                              data-pmx-work-panel-control={
                                link.id === "apppasswords" ? undefined : "1"
                              }
                              onClick={() => handleOpenHttpsUrl(link.url)}
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
                        <span className="text-xs font-medium text-foreground">
                          发件 / 收件邮箱地址
                        </span>
                        <Input
                          size="sm"
                          data-pmx-work-panel-control="1"
                          type="email"
                          data-testid="overnight-imap-email-input"
                          value={draft.email}
                          onChange={(e) =>
                            setDraft((prev) => applyOvernightEmailInput(prev, e.target.value))
                          }
                          placeholder={
                            draft.preset === "gmail"
                              ? "you@gmail.com"
                              : draft.preset === "netease"
                                ? "you@163.com / you@126.com"
                                : "you@qq.com / you@163.com / you@126.com / you@gmail.com"
                          }
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
                          size="sm"
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
                          <span className="text-xs font-semibold text-foreground">
                            IMAP 收信服务器
                          </span>
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
                            size="sm"
                            data-pmx-work-panel-control="1"
                            data-testid="overnight-imap-host-input"
                            value={draft.imapHost}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, imapHost: e.target.value }))
                            }
                            placeholder="imap.qq.com"
                            className="col-span-2"
                          />
                          <Input
                            size="sm"
                            data-pmx-work-panel-control="1"
                            data-testid="overnight-imap-port-input"
                            value={draft.imapPort}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, imapPort: e.target.value }))
                            }
                            placeholder="993"
                          />
                        </div>
                      </div>

                      <div
                        data-pmx-work-panel-card="1"
                        className="space-y-2 rounded-lg border border-border/70 bg-card/65 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">
                            SMTP 发信服务器
                          </span>
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
                            size="sm"
                            data-pmx-work-panel-control="1"
                            data-testid="overnight-smtp-host-input"
                            value={draft.smtpHost}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, smtpHost: e.target.value }))
                            }
                            placeholder="smtp.qq.com"
                            className="col-span-2"
                          />
                          <Input
                            size="sm"
                            data-pmx-work-panel-control="1"
                            data-testid="overnight-smtp-port-input"
                            value={draft.smtpPort}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, smtpPort: e.target.value }))
                            }
                            placeholder="465"
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
                          size="sm"
                          data-pmx-work-panel-control="1"
                          type="password"
                          autoComplete="new-password"
                          value={draft.smtpPasswordInput}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, smtpPasswordInput: e.target.value }))
                          }
                          placeholder="输入独立 SMTP 授权码（留空默认复用 IMAP 授权码）"
                          className="max-w-md"
                        />
                      ) : null}
                    </div>
                  </>
                )}
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
                      如果你只想快速用 Gmail 收发夜间工场邮件，直接切到通用邮箱预设并填入 16
                      位应用专用密码即可。
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
                    className="shrink-0"
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
                    >
                      <Unlink2Icon className="size-3.5" />
                      解除绑定
                    </Button>
                  ) : null}
                </div>

                {draft.gmailConnected && draft.gmailBoundEmail ? (
                  <div className="rounded-lg border border-success/35 bg-success/10 px-3 py-2 text-xs text-foreground">
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
                    <span className="text-xs text-muted-foreground">
                      按顺序点开 4 步即可拿到密钥
                    </span>
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
                        className="justify-between"
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
                                "flex cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-all motion-reduce:transition-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                isActive
                                  ? "border-primary/70 bg-primary/15 font-semibold text-foreground shadow-sm ring-1 ring-primary/30"
                                  : isDone
                                    ? "border-success/45 bg-success/12 text-foreground hover:bg-success/20"
                                    : "border-border/75 bg-card/80 text-foreground/90 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                              )}
                            >
                              {isDone ? (
                                <CheckIcon
                                  className={cn(
                                    "size-3 shrink-0",
                                    !isActive && "text-success-foreground",
                                  )}
                                  style={isActive ? PMX_ACCENT_ICON_STYLE : undefined}
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
                          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-surface px-3 py-2 text-xs text-foreground">
                            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                            <span className="leading-relaxed">
                              {currentTutorialStepSpec.pitfall}
                            </span>
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
                              >
                                {copiedKey === "oauth-scopes" ? (
                                  <>
                                    <CheckIcon className="size-3.5 text-success-foreground" />
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
                            <code className="block break-all rounded-md bg-muted/75 px-2.5 py-1.5 font-mono text-2xs text-foreground">
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
                              >
                                {copiedKey === "tutorial-redirect" ? (
                                  <>
                                    <CheckIcon className="size-3.5 text-success-foreground" />
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
                              className="block break-all rounded-md bg-muted/75 px-2.5 py-1.5 font-mono text-2xs text-foreground"
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
                                  <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />
                                ) : (
                                  <CircleIcon className="size-4 shrink-0 text-muted-foreground" />
                                )}
                                <span className="text-xs text-foreground">
                                  Client ID：{oauthReadiness.clientIdReady ? "已填写" : "待填写"}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5">
                                {oauthReadiness.clientSecretReady ? (
                                  <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />
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
                      size="sm"
                      data-pmx-work-panel-control="1"
                      data-testid="overnight-gmail-client-id-input"
                      value={draft.gmailClientId}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, gmailClientId: e.target.value }))
                      }
                      placeholder="xxxx.apps.googleusercontent.com"
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
                      size="sm"
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
                        size="sm"
                        data-pmx-work-panel-control="1"
                        data-testid="overnight-gmail-redirect-uri-input"
                        value={draft.gmailRedirectUri}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, gmailRedirectUri: e.target.value }))
                        }
                        placeholder={defaultRedirectUri}
                        className="min-w-0 flex-1"
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
                        className="shrink-0"
                      >
                        {copiedKey === "field-redirect" ? (
                          <>
                            <CheckIcon className="size-3.5 text-success-foreground" />
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
                    >
                      <RefreshCwIcon className="size-3.5" />
                      已完成授权，同步状态
                    </Button>
                  ) : null}
                </div>
              </div>
            )}

            {/* Bottom Mail Action Buttons + Inline Right-Side Test Recipient (SAME ROW) */}
            {renderMailTestRow({ includeSaveButton: true })}

            {/* Connectivity Probe Inline Report */}
            {mailTestResultBlock}
          </div>
        )}
      </div>
    </OvernightSectionCard>
  );

  const taskWorkbenchSection = (
    <OvernightSectionCard
      standalone={standalone}
      id="overnight-tasks"
      title="夜间任务队列与立即执行"
      icon={<ListTodoIcon className="size-4" style={PMX_ACCENT_ICON_STYLE} />}
      headerAction={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={tasks.length > 0 ? "success" : "secondary"}>队列 {tasks.length} 项</Badge>
          {hasActiveRuns ? <Badge variant="warning">执行中</Badge> : null}
        </div>
      }
    >
      <div data-testid="overnight-task-workbench" className="space-y-4 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          直接下发夜间编码任务或加入待办队列：每个任务都在隔离 Git Worktree 分支运行，受
          LifecycleHook 安全门禁与个人 AGY 无人值守硬拦截保护，完工后自动记录 diff、日志并发送早报。
        </p>

        {/* Task Composer Card */}
        <div
          data-pmx-work-panel-card="1"
          className="space-y-3 rounded-xl border border-border/75 bg-muted/20 p-3.5"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-foreground">任务标题（可选）</span>
              <Input
                size="sm"
                data-pmx-work-panel-control="1"
                data-testid="overnight-task-title-input"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="例如：补全邮件发信单测与修复暗色对比度"
              />
            </label>

            <div className="space-y-1">
              <span className="block text-xs font-medium text-foreground">
                执行代理（遵守 AGY 无人值守硬拦截）
              </span>
              <Select
                modal={false}
                value={taskProviderOverride}
                onValueChange={(nextValue) => {
                  if (typeof nextValue === "string") {
                    setTaskProviderOverride(nextValue);
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  data-testid="overnight-task-provider-select"
                  data-pmx-work-panel-control="1"
                  className="w-full"
                >
                  <SelectValue>
                    <span className="truncate">
                      {taskProviderOverride === "__default__"
                        ? `跟随工场默认策略（${activeProviderOption?.label ?? draft.agentProvider}）`
                        : (providerOptions.find((p) => p.id === taskProviderOverride)?.label ??
                          taskProviderOverride)}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false} className="max-h-72">
                  <SelectItem value="__default__">
                    跟随工场默认策略（{activeProviderOption?.label ?? draft.agentProvider}）
                  </SelectItem>
                  {providerOptions
                    .filter((prov) => !prov.isAntigravity)
                    .map((prov) => (
                      <SelectItem key={prov.id} value={prov.id}>
                        {prov.label}
                      </SelectItem>
                    ))}
                </SelectPopup>
              </Select>
            </div>
          </div>

          {/* Workspace Selector */}
          <div className="space-y-1.5">
            <label className="space-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <FolderGit2Icon className="size-3.5 text-primary" />
                目标本地 Git 仓库路径
              </span>
              <Input
                size="sm"
                data-pmx-work-panel-control="1"
                data-testid="overnight-task-workspace-input"
                value={taskWorkspaceDir}
                onChange={(e) => setTaskWorkspaceDir(e.target.value)}
                placeholder={draft.targetWorkspaceDir || "例如 D:\\Projects\\Prismux"}
              />
            </label>
            {workspaceOptions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-2xs text-muted-foreground">快速填入工作区：</span>
                {workspaceOptions.slice(0, 5).map((proj) => (
                  <button
                    key={proj.cwd}
                    type="button"
                    data-pmx-work-panel-control="1"
                    onClick={() => setTaskWorkspaceDir(proj.cwd)}
                    className="cursor-pointer rounded-md border border-border/75 bg-card/80 px-2 py-0.5 text-xs text-foreground/90 transition-colors hover:border-primary/50 hover:bg-accent/60"
                  >
                    {proj.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Goal Prompt */}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-foreground">任务目标 / Prompt</span>
            <Textarea
              size="sm"
              data-pmx-work-panel-control="1"
              data-testid="overnight-task-prompt-input"
              rows={3}
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              placeholder="描述要完成的编码改动、测试要求与交付边界（工场将在独立 Worktree 分支执行，绝不自动 push）..."
            />
          </label>

          {/* Optional Verify Command + Switches */}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-foreground">验收测试命令（可选）</span>
              <Input
                size="sm"
                data-pmx-work-panel-control="1"
                data-testid="overnight-task-verify-input"
                value={taskVerifyCommand}
                onChange={(e) => setTaskVerifyCommand(e.target.value)}
                placeholder="例如 pnpm test（留空跳过自定义验收命令）"
              />
            </label>
            <div className="flex flex-col justify-end gap-2 pb-0.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <Switch checked={taskSendReport} onCheckedChange={setTaskSendReport} />
                <span>完工 / 失败后发送邮件早报（邮箱已就绪时生效）</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={taskAllowNoFileChanges}
                  onCheckedChange={setTaskAllowNoFileChanges}
                />
                <span>允许只读巡检 / 无代码改动也标记完工</span>
              </label>
            </div>
          </div>

          {taskAgyCompliance.blocked ? (
            <div
              role="alert"
              data-testid="overnight-task-agy-guard"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-foreground"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <ShieldAlertIcon className="size-4 shrink-0 text-destructive" />
                <span className="truncate">{taskAgyCompliance.warningTitle}</span>
              </div>
              <Button
                type="button"
                size="xs"
                variant="destructive-outline"
                onClick={handleOpenWaiverSettings}
              >
                查看风控策略
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button
              type="button"
              size="sm"
              variant="default"
              data-testid="overnight-run-now-btn"
              disabled={runningNow || taskAgyCompliance.blocked || !daemon.runOvernightNow}
              aria-busy={runningNow}
              onClick={() => void handleRunNow()}
            >
              <PlayIcon className="size-3.5" />
              {runningNow ? "正在启动..." : "立即执行 / 试跑"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="overnight-create-task-btn"
              data-pmx-work-panel-control="1"
              disabled={creatingTask || taskAgyCompliance.blocked || !daemon.createOvernightTask}
              aria-busy={creatingTask}
              onClick={() => void handleCreateTask()}
            >
              <PlusIcon className="size-3.5" />
              {creatingTask ? "保存中..." : "加入夜间任务队列"}
            </Button>
          </div>
        </div>

        {/* Saved Task Queue */}
        {tasks.length > 0 ? (
          <div data-testid="overnight-task-list" className="space-y-2">
            <div className="text-xs font-semibold text-foreground">已保存的夜间任务队列</div>
            {tasks.map((task) => {
              const isBusy = busyTaskId === task.id;
              const lastBadge = task.lastRunStatus
                ? formatOvernightRunStatusBadge(task.lastRunStatus)
                : null;
              return (
                <div
                  key={task.id}
                  data-testid="overnight-task-row"
                  data-pmx-work-panel-card="1"
                  className="flex flex-wrap items-start justify-between gap-2.5 rounded-xl border border-border/70 bg-card/75 px-3 py-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-semibold text-foreground">{task.title}</span>
                      <Badge variant="outline">{task.provider || "默认代理"}</Badge>
                      <Badge variant="secondary">
                        {task.triggerMode === "scheduled"
                          ? "定时值守"
                          : task.triggerMode === "email"
                            ? "邮件触发"
                            : "手动队列"}
                      </Badge>
                      {lastBadge ? (
                        <Badge variant={lastBadge.variant}>{lastBadge.label}</Badge>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
                      {task.prompt}
                    </p>
                    <div className="truncate font-mono text-2xs text-muted-foreground">
                      {task.workspaceDir}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      variant="default"
                      data-testid="overnight-task-run-btn"
                      disabled={isBusy || !daemon.runOvernightTask}
                      onClick={() => void handleRunSavedTask(task)}
                    >
                      <PlayIcon className="size-3" />
                      立即运行
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      data-testid="overnight-task-delete-btn"
                      data-pmx-work-panel-control="1"
                      disabled={isBusy || !daemon.deleteOvernightTask}
                      onClick={() => void handleDeleteSavedTask(task)}
                      aria-label={`删除任务 ${task.title}`}
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </OvernightSectionCard>
  );

  const strategySection = (
    <OvernightSectionCard
      standalone={standalone}
      id="overnight-strategy"
      title="夜间工场执行策略"
      icon={<ShieldCheckIcon className="size-4" style={PMX_ACCENT_ICON_STYLE} />}
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
          默认关闭以保护本地代码仓库；仅允许白名单发件人携带触发标签立项，并在隔离 Worktree
          分支提交代码与 Oracle 只读审校。
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
              <span>
                安全保护：{draft.localWorktreeOnlyNoPush ? "仅本地分支不 push" : "已放开"}
              </span>
            </div>
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-pmx-work-panel-control="1"
              onClick={() => setStrategyExpanded(true)}
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
                  size="sm"
                  data-pmx-work-panel-control="1"
                  data-testid="overnight-trigger-tag-input"
                  value={draft.triggerTag}
                  onChange={(e) => setDraft((prev) => ({ ...prev, triggerTag: e.target.value }))}
                  placeholder="#factory"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium text-foreground">轮询间隔（分钟）</span>
                <Input
                  size="sm"
                  data-pmx-work-panel-control="1"
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.pollIntervalMinutes}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, pollIntervalMinutes: e.target.value }))
                  }
                />
              </label>
            </div>

            {/* Sender Whitelist */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <ShieldAlertIcon className="size-3.5 text-warning" />
                  发件人白名单（一行一个邮箱，物理防陌生人邮件触发编码）
                </span>
                <Badge variant={parsedWhitelistCount > 0 ? "success" : "warning"}>
                  {parsedWhitelistCount > 0
                    ? `已放行 ${parsedWhitelistCount} 个发件人`
                    : "空名单将拦截全部邮件"}
                </Badge>
              </div>
              <Textarea
                size="sm"
                data-pmx-work-panel-control="1"
                data-testid="overnight-whitelist-textarea"
                rows={3}
                value={draft.allowedSendersText}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, allowedSendersText: e.target.value }))
                }
                placeholder={"your-email@qq.com\nbackup@gmail.com\n*@your-team.dev"}
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
                      size="sm"
                      data-pmx-work-panel-control="1"
                      type="time"
                      value={draft.windowStart}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, windowStart: e.target.value }))
                      }
                      className="w-28"
                    />
                  </label>
                  <span className="pb-1.5 text-xs text-muted-foreground">-</span>
                  <label className="space-y-1">
                    <span className="block text-xs text-muted-foreground">结束时间</span>
                    <Input
                      size="sm"
                      data-pmx-work-panel-control="1"
                      type="time"
                      value={draft.windowEnd}
                      onChange={(e) => setDraft((prev) => ({ ...prev, windowEnd: e.target.value }))}
                      className="w-28"
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
                  size="sm"
                  data-pmx-work-panel-control="1"
                  data-testid="overnight-workspace-input"
                  value={draft.targetWorkspaceDir}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, targetWorkspaceDir: e.target.value }))
                  }
                  placeholder="例如 D:\Projects\Prismux"
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
                      className="cursor-pointer rounded-md border border-border/75 bg-card/80 px-2 py-0.5 text-xs text-foreground/90 transition-all motion-reduce:transition-none hover:border-primary/50 hover:bg-accent/60 hover:text-foreground active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {proj.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Live Configured Agent Provider & Live Model Selector */}
            <div className="grid gap-3 2xl:grid-cols-2">
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
                        <Tooltip key={prov.id}>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                data-testid="overnight-provider-antigravity"
                                data-agy-blocked="true"
                                aria-disabled="true"
                                onClick={handleOpenWaiverSettings}
                                className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-destructive/55 bg-muted/45 px-2.5 py-1 text-xs text-muted-foreground opacity-60 transition-all motion-reduce:transition-none hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-destructive"
                              />
                            }
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
                              className="inline-flex items-center rounded-md border border-destructive bg-background/95 px-1.5 py-0.5 text-2xs leading-none font-semibold text-destructive shadow-xs"
                            >
                              {agyCompliance.badgeLabel}
                            </span>
                          </TooltipTrigger>
                          <TooltipPopup side="top" sideOffset={6}>
                            {agyCompliance.waiverAllowed
                              ? "24h 无人值守夜间工场禁止使用个人版 Antigravity，点击前往查看合规策略"
                              : "Antigravity 个人订阅需先签署免责协议且夜间无人值守不可用，点击前往签署与查看合规"}
                          </TooltipPopup>
                        </Tooltip>
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
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all motion-reduce:transition-none active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          active
                            ? "border-primary/70 bg-primary/15 font-semibold text-foreground shadow-sm ring-1 ring-primary/30"
                            : "border-border/80 bg-card/80 text-foreground/90 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                        )}
                      >
                        {prov.isChief ? (
                          <BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
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
                    <span>
                      当前暂无已启用的实时智能体提供方，可先使用「跟随主秘书槽位」或前往配置。
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      data-testid="overnight-open-providers-settings-btn"
                      data-pmx-work-panel-control="1"
                      onClick={handleOpenProvidersSettings}
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
                      agentModel: nextValue === OVERNIGHT_DEFAULT_MODEL_SENTINEL ? "" : nextValue,
                    }));
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    data-testid="overnight-agent-model-select"
                    data-pmx-work-panel-control="1"
                    className="w-full"
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
                          {activeProviderOption?.isChief ? "跟随主秘书默认模型" : "跟随提供方默认"}
                        </span>
                        <span className="text-2xs text-muted-foreground">
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
                            <span className="text-2xs text-muted-foreground">{model.subtitle}</span>
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
                    >
                      改用 {firstCompliantProvider.label}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive-outline"
                    data-testid="overnight-agy-waiver-jump-btn"
                    onClick={handleOpenWaiverSettings}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    需签署免责 · 前往设置
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Oracle Review & Local Worktree Safety Switches */}
            <div className="grid gap-2.5 2xl:grid-cols-2">
              <label
                data-pmx-work-panel-card="1"
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/75 bg-card/75 px-3.5 py-2.5 transition-colors motion-reduce:transition-none hover:border-border"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <BotIcon className="size-3.5 text-primary" />
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
                    <ShieldCheckIcon className="size-3.5 text-success-foreground" />
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
      title="运行历史与实时日志"
      icon={<Clock3Icon className="size-4" style={PMX_ACCENT_ICON_STYLE} />}
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
          展示手动触发与入站邮件立项的夜间工场任务、实时执行阶段与步骤日志、Worktree
          交付分支、Oracle 审校摘要与邮件回执。
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
            <div className="mt-2.5 text-xs font-semibold text-foreground">暂无夜间工场执行记录</div>
            <div className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              在左侧「立即执行 / 试跑」下发任务，或发送带{" "}
              <code className="rounded bg-muted/75 px-1 py-0.5 font-mono text-foreground">
                {draft.triggerTag}
              </code>{" "}
              主题的邮件并点击「立即拉取邮件」即可查看实时阶段、步骤日志与完工早报。
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "space-y-2.5",
              standalone
                ? "xl:max-h-[calc(100dvh-18rem)] xl:overflow-y-auto xl:pr-1"
                : "xl:max-h-[40rem] xl:overflow-y-auto xl:pr-1",
            )}
          >
            {runs.map((run) => {
              const badge = formatOvernightRunStatusBadge(run.status);
              const isRunning = run.status === "queued" || run.status === "running";
              const isRunBusy = busyRunId === run.id;
              const logs = run.logs ?? [];
              const logsOpen = expandedRunLogs[run.id] ?? isRunning;
              const sourceLabel =
                run.source === "manual"
                  ? run.taskId
                    ? "队列任务"
                    : "手动试跑"
                  : run.source === "scheduled"
                    ? "定时调度"
                    : "邮件触发";
              return (
                <div
                  key={run.id}
                  data-testid="overnight-run-row"
                  data-pmx-work-panel-card="1"
                  className="space-y-2 rounded-xl border border-border/75 bg-card/75 px-3.5 py-3 transition-colors motion-reduce:transition-none hover:border-border"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {run.subject}
                        </span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {run.stage && isRunning ? (
                          <Badge data-testid="overnight-run-stage-badge" variant="outline">
                            {formatOvernightExecutionStageLabel(run.stage)}
                          </Badge>
                        ) : null}
                        {run.source ? <Badge variant="secondary">{sourceLabel}</Badge> : null}
                        {run.provider ? <Badge variant="outline">{run.provider}</Badge> : null}
                        {run.reportSent ? <Badge variant="outline">已回发早报</Badge> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>来源：{run.sender}</span>
                        <span>·</span>
                        <span className="tabular-nums">
                          {formatOvernightTimestamp(run.createdAt)}
                        </span>
                        {run.branchName ? (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/70 px-1.5 py-0.5 font-mono text-2xs text-foreground">
                              <GitBranchIcon className="size-3" />
                              {run.branchName}
                            </span>
                          </>
                        ) : null}
                        {run.changedFilesCount > 0 ? (
                          <span className="tabular-nums">· {run.changedFilesCount} 个文件改动</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {isRunning && daemon.cancelOvernightRun ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive-outline"
                          data-testid="overnight-run-cancel-btn"
                          disabled={isRunBusy}
                          onClick={() => void handleCancelRun(run.id)}
                        >
                          <SquareIcon className="size-3" />
                          取消运行
                        </Button>
                      ) : null}
                      {!isRunning && run.prompt && daemon.retryOvernightRun ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          data-testid="overnight-run-retry-btn"
                          data-pmx-work-panel-control="1"
                          disabled={isRunBusy}
                          onClick={() => void handleRetryRun(run.id)}
                        >
                          <RotateCcwIcon className="size-3" />
                          重跑
                        </Button>
                      ) : null}
                      {run.deepLink ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          data-pmx-work-panel-control="1"
                          onClick={() => onOpenExternalUrl(run.deepLink!)}
                        >
                          <ExternalLinkIcon className="size-3" />
                          审查分支
                        </Button>
                      ) : null}
                      {!isRunning && daemon.deleteOvernightRun ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          data-testid="overnight-run-delete-btn"
                          disabled={isRunBusy}
                          aria-label={`删除运行记录 ${run.subject}`}
                          onClick={() => void handleDeleteRun(run.id)}
                        >
                          <Trash2Icon className="size-3" />
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {run.errorMessage &&
                  (run.status === "failed" ||
                    run.status === "blocked_policy" ||
                    run.status === "cancelled") ? (
                    <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                      {run.errorMessage}
                    </div>
                  ) : null}

                  {run.oracleSummary ? (
                    <div className="rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1.5 text-xs leading-relaxed text-foreground/90">
                      <span className="mr-1.5 font-medium" style={PMX_ACCENT_ICON_STYLE}>
                        Oracle 摘要：
                      </span>
                      {run.oracleSummary}
                    </div>
                  ) : null}

                  {run.changedFiles && run.changedFiles.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {run.changedFiles.slice(0, 6).map((file) => (
                        <code
                          key={file.path}
                          className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-2xs text-foreground"
                        >
                          {file.path} (+{file.additions}/-{file.deletions})
                        </code>
                      ))}
                      {run.changedFiles.length > 6 ? (
                        <span className="text-2xs text-muted-foreground">
                          +{run.changedFiles.length - 6} 个文件
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {logs.length > 0 ? (
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        data-testid="overnight-run-logs-toggle"
                        onClick={() =>
                          setExpandedRunLogs((prev) => ({ ...prev, [run.id]: !logsOpen }))
                        }
                        className="inline-flex cursor-pointer items-center gap-1 text-2xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <TerminalIcon className="size-3" />
                        {logsOpen
                          ? `收起执行日志 (${logs.length})`
                          : `展开执行日志 (${logs.length})`}
                      </button>
                      {logsOpen ? (
                        <div
                          data-testid="overnight-run-logs"
                          className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/65 bg-muted/40 p-2 font-mono text-2xs"
                        >
                          {logs.map((entry) => (
                            <div
                              key={`${run.id}-${entry.timestamp}-${entry.stage}-${entry.message}`}
                              className={cn(
                                "flex items-start gap-2 leading-snug",
                                entry.level === "error"
                                  ? "text-destructive"
                                  : entry.level === "warn"
                                    ? "text-warning"
                                    : "text-foreground/85",
                              )}
                            >
                              <span className="shrink-0 text-muted-foreground tabular-nums">
                                [{formatOvernightExecutionStageLabel(entry.stage)}]
                              </span>
                              <span className="min-w-0 flex-1 break-all">{entry.message}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
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
            {/* Unified Compact Full-Bleed Header Bar: aligned 1:1 with Tasks / Board / Scheduled Tasks */}
            <header className="flex flex-none flex-wrap items-center justify-between gap-2.5 border-b border-border/65 px-4 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg"
                  style={PMX_ACCENT_BADGE_STYLE}
                >
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
                >
                  <RefreshCwIcon
                    className={cn(
                      "size-3.5",
                      pollingNow && "animate-spin motion-reduce:animate-none",
                    )}
                  />
                  {pollingNow ? "拉取中..." : "立即拉取邮件"}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-pmx-work-panel-control="1"
                  disabled={detectingEnv}
                  aria-busy={detectingEnv}
                  onClick={() => void loadAll(false, true)}
                >
                  <SearchCheckIcon
                    className={cn(
                      "size-3.5",
                      detectingEnv && "animate-pulse motion-reduce:animate-none",
                    )}
                  />
                  {detectingEnv ? "检测中..." : "重新检测环境"}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-pmx-work-panel-control="1"
                  disabled={loading}
                  aria-busy={loading}
                  onClick={() => void loadAll(false)}
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

            {/* Full-Bleed Edge-to-Edge Body (Overnight Factory FIRST, Mail Channel full-width below) */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-gutter-both">
              <div className="flex w-full min-w-0 flex-col gap-4">
                {alertBanners}
                {kpiStrip}

                <div
                  data-testid="overnight-workbench-grid"
                  className="grid w-full min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-12"
                >
                  <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
                    {taskWorkbenchSection}
                  </div>
                  <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
                    {runsHistorySection}
                    {strategySection}
                  </div>
                </div>

                <div data-testid="overnight-mail-band" className="w-full min-w-0">
                  {mailBindingSection}
                </div>
              </div>
            </div>
          </div>
        </PrismuxStageFrame>
      </SidebarInset>
    );
  }

  return (
    <SettingsPageContainer width="full" className="gap-5">
      {/* Top Status Banner */}
      <div
        id="prismux-overnight-factory"
        data-pmx-overnight-settings-page=""
        data-pmx-work-panel-card="1"
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-card/75 px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={PMX_ACCENT_BADGE_STYLE}
          >
            <MoonStarIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            夜间全自动工场（Overnight Factory）与邮箱绑定
          </span>
          {statusBadges}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-pmx-work-panel-control="1"
            disabled={detectingEnv}
            aria-busy={detectingEnv}
            onClick={() => void loadAll(false, true)}
          >
            <SearchCheckIcon
              className={cn("size-3.5", detectingEnv && "animate-pulse motion-reduce:animate-none")}
            />
            {detectingEnv ? "检测中..." : "重新检测环境"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-pmx-work-panel-control="1"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void loadAll(false)}
          >
            <RefreshCwIcon
              className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")}
            />
            刷新状态
          </Button>
        </div>
      </div>

      {alertBanners}
      {kpiStrip}

      <div
        data-testid="overnight-workbench-grid"
        className="grid w-full min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-12"
      >
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">{taskWorkbenchSection}</div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          {runsHistorySection}
          {strategySection}
        </div>
      </div>

      <div data-testid="overnight-mail-band" className="w-full min-w-0">
        {mailBindingSection}
      </div>
    </SettingsPageContainer>
  );
}

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
  initialTasksOverride,
  initialMailSetupExpandedOverride,
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
    <PrismuxOvernightFactoryShell
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
      {...(initialTasksOverride !== undefined ? { initialTasksOverride } : {})}
      {...(initialMailSetupExpandedOverride !== undefined
        ? { initialMailSetupExpandedOverride }
        : {})}
      workspaceOptions={workspaceOptions}
      onOpenExternalUrl={onOpenExternalUrl ?? defaultOpenExternalUrl}
    />
  );
}
