import {
  CheckCircle2Icon,
  CloudIcon,
  KeyRoundIcon,
  LockIcon,
  RefreshCwIcon,
  SaveIcon,
  WifiIcon,
  XCircleIcon,
} from "lucide-react";
import { memo, startTransition, useCallback, useEffect, useState, type ReactNode } from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/utils";
import type { PrismuxDaemonClient } from "../daemonClient";

interface SyncChannelReportItem {
  readonly channel: string;
  readonly ok: boolean;
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly reachable?: boolean;
  readonly latencyMs: number | null;
  readonly uploaded?: number;
  readonly downloaded?: number;
  readonly conflictDetected?: boolean;
  readonly message?: string;
  readonly error?: string;
}

interface SyncOperationReport {
  readonly kind: "sync" | "test";
  readonly ok: boolean;
  readonly timestamp: number;
  readonly uploaded?: number;
  readonly downloaded?: number;
  readonly conflictDetected?: boolean;
  readonly etag?: string | null;
  readonly message: string;
  readonly channels: readonly SyncChannelReportItem[];
}

type SyncDomainKey =
  | "privateMemory"
  | "workspaceMemory"
  | "socialMemory"
  | "commandsAndMcp"
  | "plugins"
  | "appearancePresets"
  | "usageLedger";

type SyncMatrixState = Record<SyncDomainKey, { upload: boolean; download: boolean }>;

interface WebDavFormState {
  enabled: boolean;
  endpointUrl: string;
  username: string;
  remotePath: string;
  password: string;
  hasSecret: boolean;
}

interface S3FormState {
  enabled: boolean;
  endpointUrl: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  hasSecret: boolean;
}

interface GitHubFormState {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  token: string;
  hasSecret: boolean;
}

interface CachedSyncSnapshot {
  readonly hasPassphrase: boolean;
  readonly syncConfigPath: string;
  readonly syncPortable: boolean;
  readonly syncMatrix: SyncMatrixState;
  readonly webdav: WebDavFormState;
  readonly s3: S3FormState;
  readonly github: GitHubFormState;
}

export interface PrismuxSyncEngineSectionProps {
  readonly daemon: Pick<
    PrismuxDaemonClient,
    "requestJson" | "triggerSyncNow" | "testSyncConnection"
  >;
  readonly refreshTick: number;
  readonly onRender?: (() => void) | undefined;
  readonly onSynced?: () => void;
  readonly onError?: (message: string) => void;
  readonly onStatus?: (message: string) => void;
}

const SYNC_DOMAIN_META: ReadonlyArray<{
  readonly key: SyncDomainKey;
  readonly label: string;
  readonly desc: string;
}> = [
  { key: "privateMemory", label: "私人主秘书记忆", desc: "private/chief 个人偏好与决策记忆" },
  { key: "workspaceMemory", label: "工作区项目记忆", desc: "workspace/* 跨机器工程约定" },
  { key: "socialMemory", label: "社交隔离记忆", desc: "social/* 群聊/外部隔离域记忆" },
  { key: "commandsAndMcp", label: "命令与 MCP 配置", desc: "自定义指令与外部服务声明" },
  { key: "plugins", label: "插件清单与设置", desc: "已装插件记录（不含裸密钥）" },
  { key: "appearancePresets", label: "外观与玻璃预设", desc: "主题胶囊、玻璃参数与壁纸偏好" },
  { key: "usageLedger", label: "用量账本", desc: "Token 与工场执行统计记录" },
];

const DEFAULT_SYNC_MATRIX: SyncMatrixState = {
  privateMemory: { upload: true, download: true },
  workspaceMemory: { upload: true, download: true },
  socialMemory: { upload: false, download: false },
  commandsAndMcp: { upload: true, download: true },
  plugins: { upload: true, download: true },
  appearancePresets: { upload: true, download: true },
  usageLedger: { upload: true, download: true },
};

const DEFAULT_WEBDAV: WebDavFormState = {
  enabled: false,
  endpointUrl: "",
  username: "",
  remotePath: "/prismux/vault.prismux-backup",
  password: "",
  hasSecret: false,
};

const DEFAULT_S3: S3FormState = {
  enabled: false,
  endpointUrl: "",
  region: "us-east-1",
  bucket: "",
  forcePathStyle: true,
  accessKeyId: "",
  secretAccessKey: "",
  hasSecret: false,
};

const DEFAULT_GITHUB: GitHubFormState = {
  enabled: false,
  owner: "",
  repo: "",
  branch: "main",
  filePath: "prismux-vault.prismux-backup",
  token: "",
  hasSecret: false,
};

const syncSnapshotCache = new WeakMap<object, CachedSyncSnapshot>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseSyncMatrix(raw: unknown): SyncMatrixState {
  const rec = asRecord(raw);
  const next: SyncMatrixState = { ...DEFAULT_SYNC_MATRIX };
  if (!rec) return next;
  for (const meta of SYNC_DOMAIN_META) {
    const entry = asRecord(rec[meta.key]);
    if (entry) {
      next[meta.key] = {
        upload: asBoolean(entry.upload, next[meta.key].upload),
        download: asBoolean(entry.download, next[meta.key].download),
      };
    }
  }
  return next;
}

function parseSyncChannelResults(raw: unknown): SyncChannelReportItem[] {
  const root = asRecord(raw);
  const candidate = Array.isArray(root?.channels)
    ? root.channels
    : Array.isArray(root?.results)
      ? root.results
      : asRecord(root?.channels)
        ? Object.entries(asRecord(root?.channels)!).map(([channel, value]) => ({
            channel,
            ...(asRecord(value) ?? {}),
          }))
        : asRecord(root?.results)
          ? Object.entries(asRecord(root?.results)!).map(([channel, value]) => ({
              channel,
              ...(asRecord(value) ?? {}),
            }))
          : [];

  const parsed: SyncChannelReportItem[] = [];
  for (const item of candidate) {
    const rec = asRecord(item);
    if (!rec) continue;
    const channel = asString(rec.channel, "unknown");
    const latencyRaw = rec.latencyMs;
    const uploadedRaw = rec.uploaded;
    const downloadedRaw = rec.downloaded;
    const messageRaw = asString(rec.message);
    const errorRaw = asString(rec.error);
    parsed.push({
      channel,
      ok: asBoolean(rec.ok, false),
      enabled: asBoolean(rec.enabled, true),
      configured: asBoolean(rec.configured, true),
      ...(typeof rec.reachable === "boolean" ? { reachable: rec.reachable } : {}),
      latencyMs:
        typeof latencyRaw === "number" && Number.isFinite(latencyRaw)
          ? Math.max(0, Math.round(latencyRaw))
          : null,
      ...(typeof uploadedRaw === "number" && Number.isFinite(uploadedRaw)
        ? { uploaded: uploadedRaw }
        : {}),
      ...(typeof downloadedRaw === "number" && Number.isFinite(downloadedRaw)
        ? { downloaded: downloadedRaw }
        : {}),
      ...(typeof rec.conflictDetected === "boolean"
        ? { conflictDetected: rec.conflictDetected }
        : {}),
      ...(messageRaw ? { message: messageRaw } : {}),
      ...(errorRaw ? { error: errorRaw } : {}),
    });
  }
  return parsed;
}

function formatOperationTimestamp(timestampMs: number): string {
  try {
    return new Date(timestampMs).toLocaleString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(timestampMs);
  }
}

function channelDisplayName(channel: string): string {
  switch (channel) {
    case "webdav":
      return "WebDAV";
    case "s3":
      return "S3 对象存储";
    case "github":
      return "GitHub 私有仓库";
    default:
      return channel;
  }
}

function extractSyncSnapshot(
  syncRes: unknown,
  fallback: CachedSyncSnapshot,
): CachedSyncSnapshot | null {
  const syncRoot = asRecord(syncRes);
  if (!syncRoot) return null;
  const vaultPaths = asRecord(syncRoot.vaultPaths);
  const statusObj = asRecord(syncRoot.status);
  const channels = asRecord(syncRoot.channels);
  const wd = asRecord(channels?.webdav);
  const s3Rec = asRecord(channels?.s3);
  const gh = asRecord(channels?.github);

  return {
    hasPassphrase: asBoolean(syncRoot.hasPassphrase, false),
    syncConfigPath: asString(syncRoot.configPath),
    syncPortable:
      asBoolean(vaultPaths?.portableMode, false) || asBoolean(statusObj?.portableMode, false),
    syncMatrix: parseSyncMatrix(syncRoot.syncMatrix),
    webdav: wd
      ? {
          enabled: asBoolean(wd.enabled, false),
          endpointUrl: asString(wd.endpointUrl),
          username: asString(wd.username),
          remotePath: asString(wd.remotePath, fallback.webdav.remotePath),
          password: "",
          hasSecret: asBoolean(wd.hasSecret, false),
        }
      : fallback.webdav,
    s3: s3Rec
      ? {
          enabled: asBoolean(s3Rec.enabled, false),
          endpointUrl: asString(s3Rec.endpointUrl),
          region: asString(s3Rec.region, "us-east-1"),
          bucket: asString(s3Rec.bucket),
          forcePathStyle: asBoolean(s3Rec.forcePathStyle, true),
          accessKeyId: asString(s3Rec.accessKeyId),
          secretAccessKey: "",
          hasSecret: asBoolean(s3Rec.hasSecret, false),
        }
      : fallback.s3,
    github: gh
      ? {
          enabled: asBoolean(gh.enabled, false),
          owner: asString(gh.owner),
          repo: asString(gh.repo),
          branch: asString(gh.branch, "main"),
          filePath: asString(gh.filePath, fallback.github.filePath),
          token: "",
          hasSecret: asBoolean(gh.hasSecret, false),
        }
      : fallback.github,
  };
}

function CollapsibleSyncChannelBody({
  channel,
  open,
  children,
}: {
  readonly channel: "webdav" | "s3" | "github";
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      data-pmx-sync-channel={channel}
      data-pmx-sync-channel-expanded={open ? "true" : "false"}
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Isolated memoized E2EE Sync section (Argon2id + AEAD, WebDAV / S3 / GitHub
 * independent channel forms, and 7-domain Upload/Download matrix).
 * Never re-renders when switching Chief Provider / Model / Reasoning Effort.
 */
export const PrismuxSyncEngineSection = memo(function PrismuxSyncEngineSection({
  daemon,
  refreshTick,
  onRender,
  onSynced,
  onError,
  onStatus,
}: PrismuxSyncEngineSectionProps) {
  onRender?.();

  const cached = syncSnapshotCache.get(daemon as object);
  const [hasPassphrase, setHasPassphrase] = useState(cached?.hasPassphrase ?? false);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [syncConfigPath, setSyncConfigPath] = useState(cached?.syncConfigPath ?? "");
  const [syncPortable, setSyncPortable] = useState(cached?.syncPortable ?? false);
  const [syncMatrix, setSyncMatrix] = useState<SyncMatrixState>(
    cached?.syncMatrix ?? DEFAULT_SYNC_MATRIX,
  );
  const [webdav, setWebdav] = useState<WebDavFormState>(cached?.webdav ?? DEFAULT_WEBDAV);
  const [s3, setS3] = useState<S3FormState>(cached?.s3 ?? DEFAULT_S3);
  const [github, setGithub] = useState<GitHubFormState>(cached?.github ?? DEFAULT_GITHUB);
  const [savingSync, setSavingSync] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [testingSync, setTestingSync] = useState(false);
  const [syncOperationReport, setSyncOperationReport] = useState<SyncOperationReport | null>(null);

  const hydrateSyncResponse = useCallback(
    (syncRes: unknown) => {
      const fallback: CachedSyncSnapshot = syncSnapshotCache.get(daemon as object) ?? {
        hasPassphrase: false,
        syncConfigPath: "",
        syncPortable: false,
        syncMatrix: DEFAULT_SYNC_MATRIX,
        webdav: DEFAULT_WEBDAV,
        s3: DEFAULT_S3,
        github: DEFAULT_GITHUB,
      };
      const snapshot = extractSyncSnapshot(syncRes, fallback);
      if (!snapshot) return;
      syncSnapshotCache.set(daemon as object, snapshot);
      startTransition(() => {
        setHasPassphrase(snapshot.hasPassphrase);
        setSyncConfigPath(snapshot.syncConfigPath);
        setSyncPortable(snapshot.syncPortable);
        setSyncMatrix(snapshot.syncMatrix);
        setWebdav(snapshot.webdav);
        setS3(snapshot.s3);
        setGithub(snapshot.github);
      });
    },
    [daemon],
  );

  const loadSyncStatus = useCallback(async () => {
    try {
      const syncRes = await daemon.requestJson<unknown>("/v1/sync/status");
      hydrateSyncResponse(syncRes);
    } catch (err) {
      onError?.(`同步状态：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [daemon, hydrateSyncResponse, onError]);

  useEffect(() => {
    void loadSyncStatus();
  }, [loadSyncStatus, refreshTick]);

  const handleSaveSyncConfig = useCallback(async () => {
    setSavingSync(true);
    try {
      const payload: Record<string, unknown> = {
        ...(passphraseInput.length > 0 ? { passphrase: passphraseInput } : {}),
        syncMatrix,
        channels: {
          webdav: {
            enabled: webdav.enabled,
            endpointUrl: webdav.endpointUrl.trim(),
            username: webdav.username.trim(),
            remotePath: webdav.remotePath.trim(),
            ...(webdav.password.length > 0 ? { password: webdav.password } : {}),
          },
          s3: {
            enabled: s3.enabled,
            endpointUrl: s3.endpointUrl.trim(),
            region: s3.region.trim() || "us-east-1",
            bucket: s3.bucket.trim(),
            forcePathStyle: s3.forcePathStyle,
            accessKeyId: s3.accessKeyId.trim(),
            ...(s3.secretAccessKey.length > 0 ? { secretAccessKey: s3.secretAccessKey } : {}),
          },
          github: {
            enabled: github.enabled,
            owner: github.owner.trim(),
            repo: github.repo.trim(),
            branch: github.branch.trim() || "main",
            filePath: github.filePath.trim(),
            ...(github.token.length > 0 ? { token: github.token } : {}),
          },
        },
      };
      const res = await daemon.requestJson<unknown>("/v1/sync/config", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      hydrateSyncResponse(res);
      setPassphraseInput("");
      onStatus?.("Prismux 端到端加密同步配置已保存（敏感凭据已加密入库，页面已清空明文输入）。");
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSync(false);
    }
  }, [daemon, github, hydrateSyncResponse, onError, onStatus, passphraseInput, s3, syncMatrix, webdav]);

  const handleTriggerSyncNow = useCallback(async () => {
    setSyncingNow(true);
    try {
      const res = await daemon.triggerSyncNow({
        direction: "both",
        ...(passphraseInput.length > 0 ? { passphrase: passphraseInput } : {}),
      });
      const timestamp =
        typeof res.syncedAt === "number"
          ? res.syncedAt
          : typeof res.timestamp === "number"
            ? res.timestamp
            : Date.now();
      const channels = parseSyncChannelResults(res);
      const uploaded = typeof res.uploaded === "number" ? res.uploaded : undefined;
      const downloaded = typeof res.downloaded === "number" ? res.downloaded : undefined;
      const conflictDetected =
        typeof res.conflictDetected === "boolean" ? res.conflictDetected : undefined;
      const etag = typeof res.etag === "string" ? res.etag : null;
      const message =
        res.message ||
        res.error ||
        (res.ok ? "端到端加密同步已完成。" : "加密同步未全部成功，请检查通道详情。");
      setSyncOperationReport({
        kind: "sync",
        ok: Boolean(res.ok),
        timestamp,
        ...(uploaded !== undefined ? { uploaded } : {}),
        ...(downloaded !== undefined ? { downloaded } : {}),
        ...(conflictDetected !== undefined ? { conflictDetected } : {}),
        etag,
        message,
        channels,
      });
      if (res.ok) {
        onStatus?.(message);
        await loadSyncStatus();
        onSynced?.();
      } else {
        onError?.(message);
      }
    } catch (err) {
      const msgText = err instanceof Error ? err.message : String(err);
      onError?.(msgText);
      setSyncOperationReport({
        kind: "sync",
        ok: false,
        timestamp: Date.now(),
        message: msgText,
        channels: [],
      });
    } finally {
      setSyncingNow(false);
    }
  }, [daemon, loadSyncStatus, onError, onStatus, onSynced, passphraseInput]);

  const handleTestSyncConnection = useCallback(async () => {
    setTestingSync(true);
    try {
      const res = await daemon.testSyncConnection({});
      const timestamp =
        typeof res.testedAt === "number"
          ? res.testedAt
          : typeof res.timestamp === "number"
            ? res.timestamp
            : Date.now();
      const channels = parseSyncChannelResults(res);
      const message =
        res.message ||
        res.error ||
        (res.ok ? "已启用通道全部连通。" : "部分或全部同步通道未连通，请检查配置。");
      setSyncOperationReport({
        kind: "test",
        ok: Boolean(res.ok),
        timestamp,
        message,
        channels,
      });
      if (res.ok) {
        onStatus?.(message);
      } else {
        onError?.(message);
      }
    } catch (err) {
      const msgText = err instanceof Error ? err.message : String(err);
      onError?.(msgText);
      setSyncOperationReport({
        kind: "test",
        ok: false,
        timestamp: Date.now(),
        message: msgText,
        channels: [],
      });
    } finally {
      setTestingSync(false);
    }
  }, [daemon, onError, onStatus]);

  return (
    <SettingsSection
      id="prismux-e2ee-sync"
      title="Prismux 端到端加密同步（Argon2id + AEAD）"
      headerAction={
        <div className="flex items-center gap-1.5">
          <Badge variant={hasPassphrase ? "success" : "warning"}>
            {hasPassphrase ? "主口令已密封" : "尚未设置主口令"}
          </Badge>
          {syncPortable ? <Badge variant="info">便携模式 data/</Badge> : null}
        </div>
      }
    >
      <p className="px-4 py-2.5 text-xs text-muted-foreground">
        本地加密密封后再上传至 WebDAV / S3 / GitHub 独立通道；支持 If-Match 乐观锁与 60s 停滞看门狗。敏感口令与 Token 仅支持只写更新，绝不回显明文。
      </p>
      <SettingsRow
        title="即时同步与通道连通性"
        description="手动执行一次端到端加密同步，或对已启用的 WebDAV / S3 / GitHub 通道进行脱敏连通性探测。"
        control={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={testingSync || syncingNow || savingSync}
              onClick={() => {
                void handleTestSyncConnection();
              }}
            >
              <WifiIcon className="size-3.5" />
              {testingSync ? "检测连通中…" : "测试通道连通性"}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={syncingNow || testingSync || savingSync}
              onClick={() => {
                void handleTriggerSyncNow();
              }}
            >
              <RefreshCwIcon className={syncingNow ? "size-3.5 animate-spin" : "size-3.5"} />
              {syncingNow ? "加密同步中…" : "立即加密同步"}
            </Button>
          </div>
        }
      >
        {syncOperationReport ? (
          <div
            data-sync-operation-kind={syncOperationReport.kind}
            className={
              syncOperationReport.ok
                ? "mt-2.5 mb-2 space-y-2 rounded-lg border border-emerald-500/35 bg-emerald-500/5 px-3 py-2.5 text-xs"
                : "mt-2.5 mb-2 space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs"
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                {syncOperationReport.ok ? (
                  <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                ) : (
                  <XCircleIcon className="size-3.5 text-destructive" />
                )}
                <span>
                  {syncOperationReport.kind === "sync" ? "加密同步结果" : "通道连通性结果"}
                </span>
                <Badge variant={syncOperationReport.ok ? "success" : "error"} className="text-[10px]">
                  {syncOperationReport.ok ? "成功" : "异常"}
                </Badge>
                {syncOperationReport.conflictDetected ? (
                  <Badge variant="warning" className="text-[10px]">
                    检测到并发冲突
                  </Badge>
                ) : null}
              </div>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatOperationTimestamp(syncOperationReport.timestamp)}
              </span>
            </div>

            <p className="text-[11px] text-foreground/90">{syncOperationReport.message}</p>

            {syncOperationReport.kind === "sync" &&
            (syncOperationReport.uploaded !== undefined ||
              syncOperationReport.downloaded !== undefined ||
              syncOperationReport.etag) ? (
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                {syncOperationReport.uploaded !== undefined ? (
                  <span>上传：{syncOperationReport.uploaded}</span>
                ) : null}
                {syncOperationReport.downloaded !== undefined ? (
                  <span>下载：{syncOperationReport.downloaded}</span>
                ) : null}
                {syncOperationReport.etag ? (
                  <span className="truncate">ETag：{syncOperationReport.etag}</span>
                ) : null}
              </div>
            ) : null}

            {syncOperationReport.channels.length > 0 ? (
              <div className="grid gap-1.5 sm:grid-cols-3">
                {syncOperationReport.channels.map((ch) => (
                  <div
                    key={ch.channel}
                    className="rounded-md border border-border/60 bg-background/65 px-2.5 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-medium text-foreground">
                        {channelDisplayName(ch.channel)}
                      </span>
                      <Badge
                        variant={
                          !ch.enabled ? "secondary" : ch.ok ? "success" : "error"
                        }
                        className="text-[10px]"
                      >
                        {!ch.enabled ? "未启用" : ch.ok ? "正常" : "失败"}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {ch.latencyMs !== null ? <span>{ch.latencyMs} ms</span> : null}
                      {ch.uploaded !== undefined ? <span>↑{ch.uploaded}</span> : null}
                      {ch.downloaded !== undefined ? <span>↓{ch.downloaded}</span> : null}
                    </div>
                    {ch.error || ch.message ? (
                      <p className="mt-0.5 break-all text-[10px] text-muted-foreground">
                        {ch.error ?? ch.message}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </SettingsRow>
      <SettingsRow
        title="端到端主加密口令（Passphrase）"
        description={
          syncConfigPath
            ? `配置文件：${syncConfigPath}（留空保存将保留现有加密口令）`
            : "用于派生 Argon2id 密封密钥，留空保存将保持现有口令不变。"
        }
        control={
          <div className="flex w-full items-center gap-2 sm:w-72">
            <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              nativeInput
              type="password"
              size="sm"
              autoComplete="new-password"
              placeholder={hasPassphrase ? "已保存（输入新口令以更新）" : "输入端到端主口令"}
              value={passphraseInput}
              onChange={(event) => setPassphraseInput(event.target.value)}
            />
          </div>
        }
      />

      {/* Independent Channel 1: WebDAV */}
      <SettingsRow
        className={webdav.enabled ? undefined : "py-3"}
        title={
          <span className="inline-flex items-center gap-2">
            <CloudIcon className="size-3.5 text-muted-foreground" />
            <span>WebDAV 通道</span>
            {webdav.hasSecret ? <Badge variant="outline">已保存密码</Badge> : null}
          </span>
        }
        description="兼容坚果云 / Nextcloud / Alist 等支持 ETag / If-Match 的 WebDAV 服务。"
        control={
          <Switch
            aria-label="启用 WebDAV 同步通道"
            data-pmx-sync-channel-switch="webdav"
            checked={webdav.enabled}
            onCheckedChange={(checked) =>
              setWebdav((prev) => ({ ...prev, enabled: Boolean(checked) }))
            }
          />
        }
      >
        <CollapsibleSyncChannelBody channel="webdav" open={webdav.enabled}>
          <div className="mt-2.5 grid gap-2 pb-2 sm:grid-cols-2">
            <Input
              nativeInput
              size="sm"
              placeholder="Endpoint URL（例如 https://dav.example.com/dav）"
              value={webdav.endpointUrl}
              onChange={(event) =>
                setWebdav((prev) => ({ ...prev, endpointUrl: event.target.value }))
              }
            />
            <Input
              nativeInput
              size="sm"
              placeholder="远端路径（例如 /prismux/vault.prismux-backup）"
              value={webdav.remotePath}
              onChange={(event) =>
                setWebdav((prev) => ({ ...prev, remotePath: event.target.value }))
              }
            />
            <Input
              nativeInput
              size="sm"
              placeholder="用户名"
              value={webdav.username}
              onChange={(event) =>
                setWebdav((prev) => ({ ...prev, username: event.target.value }))
              }
            />
            <Input
              nativeInput
              type="password"
              size="sm"
              autoComplete="new-password"
              placeholder={webdav.hasSecret ? "密码已加密保存（留空不变）" : "应用专用密码"}
              value={webdav.password}
              onChange={(event) =>
                setWebdav((prev) => ({ ...prev, password: event.target.value }))
              }
            />
          </div>
        </CollapsibleSyncChannelBody>
      </SettingsRow>

      {/* Independent Channel 2: S3 */}
      <SettingsRow
        className={s3.enabled ? undefined : "py-3"}
        title={
          <span className="inline-flex items-center gap-2">
            <CloudIcon className="size-3.5 text-muted-foreground" />
            <span>S3 兼容对象存储通道</span>
            {s3.hasSecret ? <Badge variant="outline">已保存 SecretKey</Badge> : null}
          </span>
        }
        description="兼容 Cloudflare R2 / AWS S3 / 阿里云 OSS / MinIO 兼容端点。"
        control={
          <Switch
            aria-label="启用 S3 同步通道"
            data-pmx-sync-channel-switch="s3"
            checked={s3.enabled}
            onCheckedChange={(checked) =>
              setS3((prev) => ({ ...prev, enabled: Boolean(checked) }))
            }
          />
        }
      >
        <CollapsibleSyncChannelBody channel="s3" open={s3.enabled}>
          <div className="mt-2.5 space-y-2 pb-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch
                size="sm"
                checked={s3.forcePathStyle}
                onCheckedChange={(checked) =>
                  setS3((prev) => ({ ...prev, forcePathStyle: Boolean(checked) }))
                }
              />
              Force Path-Style
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                nativeInput
                size="sm"
                placeholder="Endpoint URL"
                value={s3.endpointUrl}
                onChange={(event) =>
                  setS3((prev) => ({ ...prev, endpointUrl: event.target.value }))
                }
              />
              <Input
                nativeInput
                size="sm"
                placeholder="Region（例如 auto / us-east-1）"
                value={s3.region}
                onChange={(event) => setS3((prev) => ({ ...prev, region: event.target.value }))}
              />
              <Input
                nativeInput
                size="sm"
                placeholder="Bucket 名称"
                value={s3.bucket}
                onChange={(event) => setS3((prev) => ({ ...prev, bucket: event.target.value }))}
              />
              <Input
                nativeInput
                size="sm"
                placeholder="Access Key ID"
                value={s3.accessKeyId}
                onChange={(event) =>
                  setS3((prev) => ({ ...prev, accessKeyId: event.target.value }))
                }
              />
              <Input
                nativeInput
                type="password"
                size="sm"
                className="sm:col-span-2"
                autoComplete="new-password"
                placeholder={
                  s3.hasSecret ? "Secret Access Key 已加密保存（留空不变）" : "Secret Access Key"
                }
                value={s3.secretAccessKey}
                onChange={(event) =>
                  setS3((prev) => ({ ...prev, secretAccessKey: event.target.value }))
                }
              />
            </div>
          </div>
        </CollapsibleSyncChannelBody>
      </SettingsRow>

      {/* Independent Channel 3: GitHub */}
      <SettingsRow
        className={github.enabled ? undefined : "py-3"}
        title={
          <span className="inline-flex items-center gap-2">
            <LockIcon className="size-3.5 text-muted-foreground" />
            <span>GitHub 私有仓库通道</span>
            {github.hasSecret ? <Badge variant="outline">已保存 Token</Badge> : null}
          </span>
        }
        description="通过 GitHub Contents API 同步端到端密文包，无需本机 git 进程。"
        control={
          <Switch
            aria-label="启用 GitHub 同步通道"
            data-pmx-sync-channel-switch="github"
            checked={github.enabled}
            onCheckedChange={(checked) =>
              setGithub((prev) => ({ ...prev, enabled: Boolean(checked) }))
            }
          />
        }
      >
        <CollapsibleSyncChannelBody channel="github" open={github.enabled}>
          <div className="mt-2.5 grid gap-2 pb-2 sm:grid-cols-2">
            <Input
              nativeInput
              size="sm"
              placeholder="Owner（GitHub 用户名或组织）"
              value={github.owner}
              onChange={(event) =>
                setGithub((prev) => ({ ...prev, owner: event.target.value }))
              }
            />
            <Input
              nativeInput
              size="sm"
              placeholder="私有仓库名（Repo）"
              value={github.repo}
              onChange={(event) =>
                setGithub((prev) => ({ ...prev, repo: event.target.value }))
              }
            />
            <Input
              nativeInput
              size="sm"
              placeholder="分支（默认 main）"
              value={github.branch}
              onChange={(event) =>
                setGithub((prev) => ({ ...prev, branch: event.target.value }))
              }
            />
            <Input
              nativeInput
              size="sm"
              placeholder="密文文件路径（例如 prismux-vault.prismux-backup）"
              value={github.filePath}
              onChange={(event) =>
                setGithub((prev) => ({ ...prev, filePath: event.target.value }))
              }
            />
            <Input
              nativeInput
              type="password"
              size="sm"
              className="sm:col-span-2"
              autoComplete="new-password"
              placeholder={
                github.hasSecret
                  ? "Personal Access Token 已加密保存（留空不变）"
                  : "Fine-grained PAT（仅需目标私有仓库 Contents 权限）"
              }
              value={github.token}
              onChange={(event) =>
                setGithub((prev) => ({ ...prev, token: event.target.value }))
              }
            />
          </div>
        </CollapsibleSyncChannelBody>
      </SettingsRow>

      {/* Sync Matrix */}
      <SettingsRow
        title="同步域矩阵（Upload / Download 独立控制）"
        description="按数据域细粒度控制允许上传与下载的内容，社交隔离记忆默认关闭同步。"
      >
        <div className="mt-2.5 space-y-2 pb-2">
          {SYNC_DOMAIN_META.map((meta) => {
            const entry = syncMatrix[meta.key];
            return (
              <div
                key={meta.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{meta.label}</div>
                  <div className="text-[11px] text-muted-foreground">{meta.desc}</div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <Switch
                      size="sm"
                      checked={entry.upload}
                      onCheckedChange={(checked) =>
                        setSyncMatrix((prev) => ({
                          ...prev,
                          [meta.key]: { ...prev[meta.key], upload: Boolean(checked) },
                        }))
                      }
                    />
                    上传
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <Switch
                      size="sm"
                      checked={entry.download}
                      onCheckedChange={(checked) =>
                        setSyncMatrix((prev) => ({
                          ...prev,
                          [meta.key]: { ...prev[meta.key], download: Boolean(checked) },
                        }))
                      }
                    />
                    下载
                  </label>
                </div>
              </div>
            );
          })}

          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              disabled={savingSync}
              onClick={() => {
                void handleSaveSyncConfig();
              }}
            >
              <SaveIcon className="size-3.5" />
              {savingSync ? "正在加密保存…" : "保存加密同步配置"}
            </Button>
          </div>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
});
