import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  Clock3Icon,
  ExternalLinkIcon,
  FolderGit2Icon,
  GitBranchIcon,
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
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";

import { SettingsPageContainer, SettingsSection } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { Toggle, ToggleGroup } from "../../components/ui/toggle-group";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
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
  OVERNIGHT_AGENT_PROVIDERS,
  OVERNIGHT_MAIL_PRESETS,
  applyOvernightMailPreset,
  buildOvernightMailSavePayload,
  buildOvernightStrategySavePayload,
  createDefaultOvernightDraft,
  formatOvernightRunStatusBadge,
  formatOvernightTimestamp,
  hydrateOvernightDraftFromSnapshot,
  isMailChannelConfigured,
  parseAllowedSendersInput,
  shouldDefaultExpandMailChannel,
  shouldDefaultExpandStrategy,
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
  /** Optional overrides for isolated unit tests without full runtime context. */
  readonly daemonOverride?: OvernightDaemonSubset;
  readonly daemonReadyOverride?: boolean;
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

function PrismuxOvernightFactoryShell({
  daemon,
  daemonReady,
  initialSnapshotOverride,
  initialRunsOverride,
  workspaceOptions,
  onOpenExternalUrl,
}: {
  readonly daemon: OvernightDaemonSubset;
  readonly daemonReady: boolean;
  readonly initialSnapshotOverride?: DaemonOvernightConfigSnapshot;
  readonly initialRunsOverride?: readonly DaemonOvernightRunRecordDto[];
  readonly workspaceOptions: ReadonlyArray<{ readonly title: string; readonly cwd: string }>;
  readonly onOpenExternalUrl: (url: string) => void;
}) {
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

  // Unconfigured / disabled channels default collapsed for a clean, low-noise surface.
  const [mailExpanded, setMailExpanded] = useState<boolean>(() =>
    initialSnapshotOverride ? shouldDefaultExpandMailChannel(initialSnapshotOverride) : false,
  );
  const [strategyExpanded, setStrategyExpanded] = useState<boolean>(() =>
    initialSnapshotOverride ? shouldDefaultExpandStrategy(initialSnapshotOverride) : false,
  );

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
        setMailExpanded(shouldDefaultExpandMailChannel(snapshot));
        setStrategyExpanded(shouldDefaultExpandStrategy(snapshot));
      }
    },
    [],
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
      setStatusMsg("已解除 Gmail OAuth2 绑定并清除本地密封的 Refresh Token。");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "解除 Gmail 绑定失败。");
    } finally {
      setDisconnectingGmail(false);
    }
  };

  const handleSaveStrategy = async () => {
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

  const mailConfigured = isMailChannelConfigured(draft);
  const parsedWhitelistCount = parseAllowedSendersInput(draft.allowedSendersText).length;

  return (
    <SettingsPageContainer width="wide">
      {/* Top Status Banner */}
      <div
        id="prismux-overnight-factory"
        data-pmx-overnight-settings-page=""
        className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-card/75 px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <MoonStarIcon className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            夜间全自动工场（Overnight Factory）与邮箱绑定
          </span>
          <Badge variant={daemonReady ? "success" : "warning"}>
            {daemonReady ? "Daemon 在线" : "Daemon 未连接"}
          </Badge>
          <Badge variant={draft.enabled ? "success" : "secondary"}>
            {draft.enabled ? "工场运行中" : "默认关闭 · 待命"}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <LockIcon className="size-3" />
            凭据 0600 加密密封
          </Badge>
        </div>

        <Button
          size="xs"
          variant="outline"
          disabled={loading}
          onClick={() => void loadAll(false)}
        >
          <RefreshCwIcon className={cn("size-3.5", loading && "animate-spin")} />
          刷新状态
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

      {/* 区块 A · 邮箱登录与收发绑定 */}
      <SettingsSection
        id="overnight-mail-binding"
        title="区块 A · 邮箱登录与收发绑定"
        icon={<MailIcon className="size-4 text-primary" />}
        headerAction={
          <div className="flex items-center gap-2">
            <Badge variant={mailConfigured ? "success" : "secondary"}>
              {mailConfigured
                ? draft.mode === "gmail-oauth2"
                  ? `Gmail 已绑定${draft.gmailBoundEmail ? ` · ${draft.gmailBoundEmail}` : ""}`
                  : `IMAP/SMTP 已配置${draft.email ? ` · ${draft.email}` : ""}`
                : "通道未配置（已折叠）"}
            </Badge>
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-testid="overnight-mail-toggle-btn"
              aria-expanded={mailExpanded}
              onClick={() => setMailExpanded((prev) => !prev)}
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
          <p className="text-xs text-muted-foreground">
            支持 Gmail OAuth2 与通用 IMAP / SMTP（内置 QQ / 163 / Outlook 预设）。所有授权码与密钥仅写加密落盘，界面永不回显明文。
          </p>
          {/* Compact Summary Bar when collapsed */}
          {!mailExpanded ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <MailIcon className="size-4 text-primary/80" />
                <span>
                  当前接入方式：
                  <strong className="font-medium text-foreground">
                    {draft.mode === "gmail-oauth2" ? "Gmail OAuth2" : "IMAP / SMTP 通用邮箱"}
                  </strong>
                  {" · 凭据文件："}
                  <code className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {credentialsFile}
                  </code>
                </span>
              </div>
              <Button
                type="button"
                size="xs"
                variant="default"
                onClick={() => setMailExpanded(true)}
              >
                配置收发邮箱
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Mode Switcher (3-state highlighted segmented control) */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-foreground">接入方式</div>
                  <div className="text-[11px] text-muted-foreground">
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
                  <Toggle value="gmail-oauth2" data-testid="overnight-mode-gmail">
                    Gmail OAuth2
                  </Toggle>
                  <Toggle value="imap" data-testid="overnight-mode-imap">
                    IMAP / SMTP 通用邮箱
                  </Toggle>
                </ToggleGroup>
              </div>

              {/* Gmail OAuth2 Mode */}
              {draft.mode === "gmail-oauth2" ? (
                <div
                  data-testid="overnight-gmail-form"
                  className="space-y-3 rounded-lg border border-border/75 bg-muted/25 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
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
                        disabled={disconnectingGmail}
                        onClick={() => void handleDisconnectGmail()}
                      >
                        <Unlink2Icon className="size-3.5" />
                        解除绑定
                      </Button>
                    ) : null}
                  </div>

                  {draft.gmailConnected && draft.gmailBoundEmail ? (
                    <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-foreground">
                      已绑定邮箱：
                      <strong className="font-mono font-semibold">{draft.gmailBoundEmail}</strong>
                      {draft.gmailConnectedAt ? (
                        <span className="ml-2 text-[11px] text-muted-foreground">
                          （绑定于 {formatOvernightTimestamp(draft.gmailConnectedAt)}）
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-foreground">OAuth Client ID</span>
                      <Input
                        value={draft.gmailClientId}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, gmailClientId: e.target.value }))
                        }
                        placeholder="xxxx.apps.googleusercontent.com"
                        className="h-8 text-xs font-mono"
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
                        className="h-8 text-xs font-mono"
                      />
                    </label>

                    <label className="space-y-1 md:col-span-2">
                      <span className="text-xs font-medium text-foreground">
                        Redirect URI（本地回调地址，留空自动使用当前 Daemon 地址）
                      </span>
                      <Input
                        value={draft.gmailRedirectUri}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, gmailRedirectUri: e.target.value }))
                        }
                        placeholder="http://127.0.0.1:<daemonPort>/v1/overnight/oauth/gmail/callback"
                        className="h-8 text-xs font-mono"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      data-testid="overnight-gmail-login-btn"
                      disabled={startingOAuth}
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
                        onClick={() => void loadAll(false)}
                      >
                        <RefreshCwIcon className="size-3.5" />
                        已完成授权，同步状态
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                /* IMAP / SMTP Mode */
                <div
                  data-testid="overnight-imap-form"
                  className="space-y-3.5 rounded-lg border border-border/75 bg-muted/25 p-3.5"
                >
                  {/* One-click Presets */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-foreground">国内 / 国际邮箱一键预设</div>
                    <div className="flex flex-wrap gap-2">
                      {OVERNIGHT_MAIL_PRESETS.map((preset) => {
                        const active = draft.preset === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            data-testid={`overnight-preset-${preset.id}`}
                            aria-pressed={active}
                            onClick={() =>
                              setDraft((prev) => applyOvernightMailPreset(prev, preset.id))
                            }
                            className={cn(
                              "cursor-pointer rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
                              active
                                ? "border-primary bg-primary font-semibold text-primary-foreground shadow-xs"
                                : "border-border/80 bg-card text-foreground/85 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                            )}
                          >
                            <div>{preset.label}</div>
                            <div
                              className={cn(
                                "text-[10px]",
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

                  {/* Email & Write-only Auth Code */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-foreground">发件 / 收件邮箱地址</span>
                      <Input
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
                        placeholder="you@qq.com / you@163.com"
                        className="h-8 text-xs"
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
                            : "请输入邮箱客户端专用授权码"
                        }
                        className="h-8 text-xs font-mono"
                      />
                    </label>
                  </div>

                  {/* IMAP & SMTP Host / Port / TLS */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2 rounded-md border border-border/70 bg-card/60 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">IMAP 收信服务器</span>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
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
                          data-testid="overnight-imap-host-input"
                          value={draft.imapHost}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, imapHost: e.target.value }))
                          }
                          placeholder="imap.qq.com"
                          className="col-span-2 h-8 text-xs font-mono"
                        />
                        <Input
                          data-testid="overnight-imap-port-input"
                          value={draft.imapPort}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, imapPort: e.target.value }))
                          }
                          placeholder="993"
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 rounded-md border border-border/70 bg-card/60 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">SMTP 发信服务器</span>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
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
                          data-testid="overnight-smtp-host-input"
                          value={draft.smtpHost}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, smtpHost: e.target.value }))
                          }
                          placeholder="smtp.qq.com"
                          className="col-span-2 h-8 text-xs font-mono"
                        />
                        <Input
                          data-testid="overnight-smtp-port-input"
                          value={draft.smtpPort}
                          onChange={(e) =>
                            setDraft((prev) => ({ ...prev, smtpPort: e.target.value }))
                          }
                          placeholder="465"
                          className="h-8 text-xs font-mono"
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
                        type="password"
                        autoComplete="new-password"
                        value={draft.smtpPasswordInput}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, smtpPasswordInput: e.target.value }))
                        }
                        placeholder="输入独立 SMTP 授权码（留空默认复用 IMAP 授权码）"
                        className="h-8 max-w-md text-xs font-mono"
                      />
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
                  onClick={() => void handleSaveMail()}
                >
                  <SaveIcon className="size-3.5" />
                  {savingMail ? "保存中..." : "保存邮箱配置"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="overnight-test-mail-btn"
                  disabled={testingMail}
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
                  disabled={sendingReport}
                  onClick={() => void handleSendTestReport()}
                >
                  <SendIcon className="size-3.5" />
                  {sendingReport ? "发送中..." : "发送测试早报"}
                </Button>
              </div>

              {/* Connectivity Probe Inline Report */}
              {testResult ? (
                <div
                  data-testid="overnight-mail-test-result"
                  className={cn(
                    "space-y-2 rounded-lg border px-3.5 py-2.5 text-xs",
                    testResult.ok
                      ? "border-success/35 bg-success/10 text-foreground"
                      : "border-destructive/35 bg-destructive/10 text-foreground",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      {testResult.ok ? (
                        <CheckCircle2Icon className="size-4 text-success" />
                      ) : (
                        <XCircleIcon className="size-4 text-destructive" />
                      )}
                      <span>{testResult.message}</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      总耗时 {testResult.durationMs} ms
                    </span>
                  </div>
                  <div className="grid gap-2 text-[11px] sm:grid-cols-2">
                    <div className="rounded border border-border/60 bg-card/70 px-2.5 py-1.5">
                      <div className="flex items-center justify-between font-medium">
                        <span>收信通道（Inbound）</span>
                        <span className="font-mono text-muted-foreground">
                          {testResult.inbound.latencyMs} ms
                        </span>
                      </div>
                      <div className="mt-0.5 text-muted-foreground">{testResult.inbound.message}</div>
                    </div>
                    <div className="rounded border border-border/60 bg-card/70 px-2.5 py-1.5">
                      <div className="flex items-center justify-between font-medium">
                        <span>发信通道（Outbound）</span>
                        <span className="font-mono text-muted-foreground">
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
      </SettingsSection>

      {/* 区块 B · 夜间工场执行策略 */}
      <SettingsSection
        id="overnight-strategy"
        title="区块 B · 夜间工场执行策略"
        icon={<ShieldCheckIcon className="size-4 text-primary" />}
        headerAction={
          <div className="flex items-center gap-2.5">
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
          <p className="text-xs text-muted-foreground">
            默认关闭以保护本地代码仓库；仅允许白名单发件人携带触发标签立项，并在隔离 Worktree 分支提交代码与 Oracle 只读审校。
          </p>
          {!strategyExpanded ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  触发标签：<code className="font-mono text-foreground">{draft.triggerTag}</code>
                </span>
                <span>·</span>
                <span>白名单：{parsedWhitelistCount} 个发件人</span>
                <span>·</span>
                <span>
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
                    data-testid="overnight-trigger-tag-input"
                    value={draft.triggerTag}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, triggerTag: e.target.value }))
                    }
                    placeholder="#factory"
                    className="h-8 text-xs font-mono"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-foreground">轮询间隔（分钟）</span>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={draft.pollIntervalMinutes}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, pollIntervalMinutes: e.target.value }))
                    }
                    className="h-8 text-xs font-mono"
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
                  data-testid="overnight-whitelist-textarea"
                  rows={3}
                  value={draft.allowedSendersText}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, allowedSendersText: e.target.value }))
                  }
                  placeholder={"your-email@qq.com\nbackup@gmail.com\n*@your-team.dev"}
                  className="font-mono text-xs"
                />
              </div>

              {/* Execution Window */}
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border/75 bg-muted/25 p-3">
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
                      <span className="block text-[11px] text-muted-foreground">开始时间</span>
                      <Input
                        type="time"
                        value={draft.windowStart}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, windowStart: e.target.value }))
                        }
                        className="h-8 w-28 text-xs font-mono"
                      />
                    </label>
                    <span className="pb-1.5 text-xs text-muted-foreground">—</span>
                    <label className="space-y-1">
                      <span className="block text-[11px] text-muted-foreground">结束时间</span>
                      <Input
                        type="time"
                        value={draft.windowEnd}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, windowEnd: e.target.value }))
                        }
                        className="h-8 w-28 text-xs font-mono"
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              {/* Workspace Directory & Agent Provider/Model */}
              <div className="space-y-2">
                <label className="space-y-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <FolderGit2Icon className="size-3.5 text-primary" />
                    目标工作区目录（本地 Git 仓库路径）
                  </span>
                  <Input
                    data-testid="overnight-workspace-input"
                    value={draft.targetWorkspaceDir}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, targetWorkspaceDir: e.target.value }))
                    }
                    placeholder="例如 D:\Projects\Prismux"
                    className="h-8 text-xs font-mono"
                  />
                </label>
                {workspaceOptions.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">快速选择当前工作区：</span>
                    {workspaceOptions.slice(0, 5).map((proj) => (
                      <button
                        key={proj.cwd}
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, targetWorkspaceDir: proj.cwd }))
                        }
                        className="cursor-pointer rounded border border-border/75 bg-card px-2 py-0.5 text-[11px] text-foreground/85 transition-colors hover:border-primary/50 hover:bg-accent/60 hover:text-foreground"
                      >
                        {proj.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-foreground">执行代理（Provider）</span>
                  <div className="flex flex-wrap gap-1.5">
                    {OVERNIGHT_AGENT_PROVIDERS.map((prov) => {
                      const active = draft.agentProvider === prov.id;
                      return (
                        <button
                          key={prov.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setDraft((prev) => ({ ...prev, agentProvider: prov.id }))
                          }
                          className={cn(
                            "cursor-pointer rounded-md border px-2.5 py-1 text-xs transition-colors",
                            active
                              ? "border-primary bg-primary font-semibold text-primary-foreground shadow-xs"
                              : "border-border/80 bg-card text-foreground/85 hover:border-primary/45 hover:bg-accent/55 hover:text-foreground",
                          )}
                        >
                          {prov.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="space-y-1">
                  <span className="text-xs font-medium text-foreground">
                    指定模型（可选，留空跟随默认模型）
                  </span>
                  <Input
                    value={draft.agentModel}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, agentModel: e.target.value }))
                    }
                    placeholder="例如 gpt-5.4-codex / claude-sonnet-4"
                    className="h-8 text-xs font-mono"
                  />
                </label>
              </div>

              {/* Oracle Review & Local Worktree Safety Switches */}
              <div className="grid gap-2.5 md:grid-cols-2">
                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/75 bg-card/70 px-3.5 py-2.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <SparklesIcon className="size-3.5 text-primary" />
                      Oracle 只读挑刺审校
                    </div>
                    <div className="text-[11px] text-muted-foreground">
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

                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/75 bg-card/70 px-3.5 py-2.5">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <ShieldCheckIcon className="size-3.5 text-emerald-500" />
                      安全保护：仅提交本地隔离 Worktree 分支
                    </div>
                    <div className="text-[11px] text-muted-foreground">
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

              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  data-testid="overnight-save-strategy-btn"
                  disabled={savingStrategy}
                  onClick={() => void handleSaveStrategy()}
                >
                  <SaveIcon className="size-3.5" />
                  {savingStrategy ? "保存中..." : "保存执行策略"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* 区块 C · 运行历史与完工早报 */}
      <SettingsSection
        id="overnight-runs"
        title="区块 C · 运行历史与完工早报"
        icon={<Clock3Icon className="size-4 text-primary" />}
        headerAction={
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              上次拉取：{formatOvernightTimestamp(lastPollAt)}
            </span>
            <Button
              type="button"
              size="xs"
              variant="default"
              data-testid="overnight-poll-now-btn"
              disabled={pollingNow}
              onClick={() => void handlePollNow()}
            >
              <RefreshCwIcon className={cn("size-3.5", pollingNow && "animate-spin")} />
              {pollingNow ? "拉取中..." : "立即拉取邮件"}
            </Button>
          </div>
        }
      >
        <div data-testid="overnight-runs-section" className="space-y-2.5 p-4">
          <p className="text-xs text-muted-foreground">
            展示近期入站邮件触发的夜间工场任务、Worktree 交付分支、Oracle 审校摘要与桌面端深度审阅链接。
          </p>
          {lastPollError ? (
            <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              最近一次拉取失败：{lastPollError}
            </div>
          ) : null}

          {runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-7 text-center">
              <MoonStarIcon className="mx-auto size-6 text-muted-foreground/70" />
              <div className="mt-2 text-xs font-medium text-foreground">暂无夜间工场执行记录</div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                配置邮箱与白名单后，发送带{" "}
                <code className="font-mono text-foreground">{draft.triggerTag}</code>{" "}
                主题的邮件或点击右上角「立即拉取邮件」即可查看执行历史与完工早报。
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => {
                const badge = formatOvernightRunStatusBadge(run.status);
                return (
                  <div
                    key={run.id}
                    data-testid="overnight-run-row"
                    className="space-y-2 rounded-lg border border-border/75 bg-card/75 px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-xs font-semibold text-foreground">
                            {run.subject}
                          </span>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          {run.reportSent ? <Badge variant="outline">已回发早报</Badge> : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>发件人：{run.sender}</span>
                          <span>·</span>
                          <span>{formatOvernightTimestamp(run.createdAt)}</span>
                          {run.branchName ? (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-1 rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10.5px] text-foreground">
                                <GitBranchIcon className="size-3" />
                                {run.branchName}
                              </span>
                            </>
                          ) : null}
                          {run.changedFilesCount > 0 ? (
                            <span>· {run.changedFilesCount} 个文件改动</span>
                          ) : null}
                        </div>
                      </div>

                      {run.deepLink ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => onOpenExternalUrl(run.deepLink!)}
                        >
                          <ExternalLinkIcon className="size-3" />
                          审查分支
                        </Button>
                      ) : null}
                    </div>

                    {run.oracleSummary ? (
                      <div className="rounded-md border border-border/60 bg-muted/35 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-foreground/90">
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
      </SettingsSection>
    </SettingsPageContainer>
  );
}

const MemoizedOvernightFactoryShell = memo(PrismuxOvernightFactoryShell);

export function PrismuxOvernightFactorySettingsPage({
  daemonOverride,
  daemonReadyOverride,
  initialSnapshotOverride,
  initialRunsOverride,
  workspaceOptionsOverride,
  onOpenExternalUrl,
}: PrismuxOvernightFactorySettingsPageProps = {}) {
  const runtime = useOptionalPrismuxRuntime();
  const projects = useProjects();
  const daemon = daemonOverride ?? runtime?.daemon ?? prismuxDaemonClient;
  const daemonReady = daemonReadyOverride ?? runtime?.daemonInfo.ready ?? false;
  const workspaceOptions =
    workspaceOptionsOverride ??
    projects.map((p) => ({
      title: p.title,
      cwd: p.workspaceRoot,
    }));

  return (
    <MemoizedOvernightFactoryShell
      daemon={daemon}
      daemonReady={daemonReady}
      {...(initialSnapshotOverride !== undefined ? { initialSnapshotOverride } : {})}
      {...(initialRunsOverride !== undefined ? { initialRunsOverride } : {})}
      workspaceOptions={workspaceOptions}
      onOpenExternalUrl={onOpenExternalUrl ?? defaultOpenExternalUrl}
    />
  );
}
