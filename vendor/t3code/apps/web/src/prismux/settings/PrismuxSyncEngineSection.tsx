import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CloudIcon,
  KeyRoundIcon,
  LockIcon,
  RefreshCwIcon,
  SaveIcon,
  WifiIcon,
  XCircleIcon,
} from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/utils";
import type { PrismuxDaemonClient } from "../daemonClient";

export type SyncChannelKey = "webdav" | "s3" | "github";

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

interface InlineFeedback {
  readonly ok: boolean;
  readonly message: string;
}

type SavingScope = "all" | "passphrase" | "matrix" | SyncChannelKey | null;

type SyncDomainKey =
  | "privateMemory"
  | "workspaceMemory"
  | "socialMemory"
  | "commandsAndMcp"
  | "plugins"
  | "appearancePresets"
  | "usageLedger";

type SyncMatrixState = Record<SyncDomainKey, { upload: boolean; download: boolean }>;

export interface WebDavFormState {
  enabled: boolean;
  endpointUrl: string;
  username: string;
  remotePath: string;
  password: string;
  hasSecret: boolean;
}

export interface S3FormState {
  enabled: boolean;
  endpointUrl: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  hasSecret: boolean;
}

export interface GitHubFormState {
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

const DEFAULT_SYNC_SNAPSHOT: CachedSyncSnapshot = {
  hasPassphrase: false,
  syncConfigPath: "",
  syncPortable: false,
  syncMatrix: DEFAULT_SYNC_MATRIX,
  webdav: DEFAULT_WEBDAV,
  s3: DEFAULT_S3,
  github: DEFAULT_GITHUB,
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

function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateWebDavForm(form: WebDavFormState): string | null {
  if (!form.enabled) return null;
  const endpoint = form.endpointUrl.trim();
  if (endpoint.length === 0) {
    return "启用 WebDAV 通道时必须填写 Endpoint URL。";
  }
  if (!isValidHttpUrl(endpoint)) {
    return "WebDAV 通道的 Endpoint URL 格式无效，请以 http:// 或 https:// 开头。";
  }
  return null;
}

export function validateS3Form(form: S3FormState): string | null {
  if (!form.enabled) return null;
  const endpoint = form.endpointUrl.trim();
  const bucket = form.bucket.trim();
  const missing: string[] = [];
  if (endpoint.length === 0) missing.push("Endpoint URL");
  if (bucket.length === 0) missing.push("Bucket 名称");
  if (missing.length > 0) {
    return `启用 S3 对象存储通道时必须填写：${missing.join("、")}。`;
  }
  if (!isValidHttpUrl(endpoint)) {
    return "S3 对象存储通道的 Endpoint URL 格式无效，请以 http:// 或 https:// 开头。";
  }
  return null;
}

export function validateGitHubForm(form: GitHubFormState): string | null {
  if (!form.enabled) return null;
  const owner = form.owner.trim();
  const repo = form.repo.trim();
  const missing: string[] = [];
  if (owner.length === 0) missing.push("Owner（GitHub 用户名或组织）");
  if (repo.length === 0) missing.push("私有仓库名（Repo）");
  if (missing.length > 0) {
    return `启用 GitHub 私有仓库通道时必须填写：${missing.join("、")}。`;
  }
  return null;
}

export function validateEnabledSyncChannels(state: {
  readonly webdav: WebDavFormState;
  readonly s3: S3FormState;
  readonly github: GitHubFormState;
}): string | null {
  return (
    validateWebDavForm(state.webdav) ??
    validateS3Form(state.s3) ??
    validateGitHubForm(state.github)
  );
}

function isWebDavDirtyAgainst(current: WebDavFormState, saved: WebDavFormState): boolean {
  return (
    current.enabled !== saved.enabled ||
    current.endpointUrl.trim() !== saved.endpointUrl.trim() ||
    current.username.trim() !== saved.username.trim() ||
    (current.remotePath.trim() || DEFAULT_WEBDAV.remotePath) !==
      (saved.remotePath.trim() || DEFAULT_WEBDAV.remotePath) ||
    current.password.length > 0
  );
}

function isS3DirtyAgainst(current: S3FormState, saved: S3FormState): boolean {
  return (
    current.enabled !== saved.enabled ||
    current.endpointUrl.trim() !== saved.endpointUrl.trim() ||
    (current.region.trim() || "us-east-1") !== (saved.region.trim() || "us-east-1") ||
    current.bucket.trim() !== saved.bucket.trim() ||
    current.forcePathStyle !== saved.forcePathStyle ||
    current.accessKeyId.trim() !== saved.accessKeyId.trim() ||
    current.secretAccessKey.length > 0
  );
}

function isGitHubDirtyAgainst(current: GitHubFormState, saved: GitHubFormState): boolean {
  return (
    current.enabled !== saved.enabled ||
    current.owner.trim() !== saved.owner.trim() ||
    current.repo.trim() !== saved.repo.trim() ||
    (current.branch.trim() || "main") !== (saved.branch.trim() || "main") ||
    (current.filePath.trim() || DEFAULT_GITHUB.filePath) !==
      (saved.filePath.trim() || DEFAULT_GITHUB.filePath) ||
    current.token.length > 0
  );
}

function isSyncMatrixDirtyAgainst(current: SyncMatrixState, saved: SyncMatrixState): boolean {
  return SYNC_DOMAIN_META.some(
    (meta) =>
      current[meta.key].upload !== saved[meta.key].upload ||
      current[meta.key].download !== saved[meta.key].download,
  );
}

function buildWebDavPayload(form: WebDavFormState): Record<string, unknown> {
  return {
    enabled: form.enabled,
    endpointUrl: form.endpointUrl.trim(),
    username: form.username.trim(),
    remotePath: form.remotePath.trim() || DEFAULT_WEBDAV.remotePath,
    ...(form.password.length > 0 ? { password: form.password } : {}),
  };
}

function buildS3Payload(form: S3FormState): Record<string, unknown> {
  return {
    enabled: form.enabled,
    endpointUrl: form.endpointUrl.trim(),
    region: form.region.trim() || "us-east-1",
    bucket: form.bucket.trim(),
    forcePathStyle: form.forcePathStyle,
    accessKeyId: form.accessKeyId.trim(),
    ...(form.secretAccessKey.length > 0 ? { secretAccessKey: form.secretAccessKey } : {}),
  };
}

function buildGitHubPayload(form: GitHubFormState): Record<string, unknown> {
  return {
    enabled: form.enabled,
    owner: form.owner.trim(),
    repo: form.repo.trim(),
    branch: form.branch.trim() || "main",
    filePath: form.filePath.trim() || DEFAULT_GITHUB.filePath,
    ...(form.token.length > 0 ? { token: form.token } : {}),
  };
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
      : { ...DEFAULT_WEBDAV },
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
      : { ...DEFAULT_S3 },
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
      : { ...DEFAULT_GITHUB },
  };
}

function SyncFieldLabel({
  label,
  required = false,
  className,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
        {required ? <span className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function CollapsibleSyncChannelBody({
  channel,
  open,
  children,
}: {
  readonly channel: SyncChannelKey;
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

function SyncChannelCardFooter({
  channel,
  isDirty,
  savingThisChannel,
  testingThisChannel,
  isBusy,
  feedback,
  onTest,
  onSave,
}: {
  readonly channel: SyncChannelKey;
  readonly isDirty: boolean;
  readonly savingThisChannel: boolean;
  readonly testingThisChannel: boolean;
  readonly isBusy: boolean;
  readonly feedback: InlineFeedback | null;
  readonly onTest: () => void;
  readonly onSave: () => void;
}) {
  return (
    <div
      data-pmx-sync-channel-footer={channel}
      className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5 pb-1.5"
    >
      <div className="min-w-0 flex-1 text-[11px]">
        {feedback ? (
          <span
            data-pmx-sync-channel-feedback={channel}
            data-pmx-sync-feedback-state={feedback.ok ? "success" : "error"}
            className={cn(
              "inline-flex items-center gap-1.5 break-all",
              feedback.ok ? "text-success-foreground" : "text-destructive",
            )}
          >
            {feedback.ok ? (
              <CheckCircle2Icon className="size-3.5 shrink-0" />
            ) : (
              <AlertTriangleIcon className="size-3.5 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </span>
        ) : isDirty ? (
          <span className="inline-flex items-center gap-1 text-warning-foreground">
            <AlertTriangleIcon className="size-3 shrink-0" />
            <span>有未保存修改（测试连通性时将自动保存）</span>
          </span>
        ) : (
          <span className="text-muted-foreground">修改配置后可直接保存或立即测试此通道</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-pmx-sync-test-channel={channel}
          disabled={isBusy}
          onClick={onTest}
        >
          <WifiIcon className="size-3.5" />
          {testingThisChannel ? "测试中…" : "测试此通道"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={isDirty ? "default" : "outline"}
          data-pmx-sync-save-channel={channel}
          disabled={isBusy}
          onClick={onSave}
        >
          <SaveIcon className="size-3.5" />
          {savingThisChannel ? "保存中…" : "保存此通道配置"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Isolated memoized E2EE Sync section (Argon2id + AEAD, WebDAV / S3 / GitHub
 * independent channel forms with contextual footer saves, inline passphrase save,
 * header matrix save, and auto-save before connectivity probe / sync).
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

  const initialSnapshot = syncSnapshotCache.get(daemon as object) ?? DEFAULT_SYNC_SNAPSHOT;
  const [savedSnapshot, setSavedSnapshot] = useState<CachedSyncSnapshot>(initialSnapshot);
  const [hasPassphrase, setHasPassphrase] = useState(initialSnapshot.hasPassphrase);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [syncConfigPath, setSyncConfigPath] = useState(initialSnapshot.syncConfigPath);
  const [syncPortable, setSyncPortable] = useState(initialSnapshot.syncPortable);
  const [syncMatrix, setSyncMatrix] = useState<SyncMatrixState>(initialSnapshot.syncMatrix);
  const [webdav, setWebdav] = useState<WebDavFormState>(initialSnapshot.webdav);
  const [s3, setS3] = useState<S3FormState>(initialSnapshot.s3);
  const [github, setGithub] = useState<GitHubFormState>(initialSnapshot.github);

  const [savingScope, setSavingScope] = useState<SavingScope>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [testingScope, setTestingScope] = useState<"all" | SyncChannelKey | null>(null);
  const [syncOperationReport, setSyncOperationReport] = useState<SyncOperationReport | null>(null);
  const [topFeedback, setTopFeedback] = useState<InlineFeedback | null>(null);
  const [passphraseFeedback, setPassphraseFeedback] = useState<InlineFeedback | null>(null);
  const [matrixFeedback, setMatrixFeedback] = useState<InlineFeedback | null>(null);
  const [channelFeedback, setChannelFeedback] = useState<
    Record<SyncChannelKey, InlineFeedback | null>
  >({
    webdav: null,
    s3: null,
    github: null,
  });

  const isPassphraseDirty = passphraseInput.length > 0;
  const isWebdavDirty = useMemo(
    () => isWebDavDirtyAgainst(webdav, savedSnapshot.webdav),
    [webdav, savedSnapshot.webdav],
  );
  const isS3Dirty = useMemo(() => isS3DirtyAgainst(s3, savedSnapshot.s3), [s3, savedSnapshot.s3]);
  const isGithubDirty = useMemo(
    () => isGitHubDirtyAgainst(github, savedSnapshot.github),
    [github, savedSnapshot.github],
  );
  const isMatrixDirty = useMemo(
    () => isSyncMatrixDirtyAgainst(syncMatrix, savedSnapshot.syncMatrix),
    [syncMatrix, savedSnapshot.syncMatrix],
  );
  const isDirty = isPassphraseDirty || isWebdavDirty || isS3Dirty || isGithubDirty || isMatrixDirty;
  const isBusy = savingScope !== null || syncingNow || testingScope !== null;

  const hydrateSyncResponse = useCallback(
    (
      syncRes: unknown,
      scope: "all" | "passphrase" | "matrix" | SyncChannelKey = "all",
    ): CachedSyncSnapshot | null => {
      const fallback = syncSnapshotCache.get(daemon as object) ?? DEFAULT_SYNC_SNAPSHOT;
      const snapshot = extractSyncSnapshot(syncRes, fallback);
      if (!snapshot) return null;

      if (scope === "all") {
        syncSnapshotCache.set(daemon as object, snapshot);
        startTransition(() => {
          setSavedSnapshot(snapshot);
          setHasPassphrase(snapshot.hasPassphrase);
          setSyncConfigPath(snapshot.syncConfigPath);
          setSyncPortable(snapshot.syncPortable);
          setSyncMatrix(snapshot.syncMatrix);
          setWebdav(snapshot.webdav);
          setS3(snapshot.s3);
          setGithub(snapshot.github);
        });
        return snapshot;
      }

      setSavedSnapshot((prev) => {
        const merged: CachedSyncSnapshot = {
          ...prev,
          hasPassphrase: snapshot.hasPassphrase,
          syncConfigPath: snapshot.syncConfigPath || prev.syncConfigPath,
          syncPortable: snapshot.syncPortable,
          ...(scope === "matrix" ? { syncMatrix: snapshot.syncMatrix } : {}),
          ...(scope === "webdav" ? { webdav: snapshot.webdav } : {}),
          ...(scope === "s3" ? { s3: snapshot.s3 } : {}),
          ...(scope === "github" ? { github: snapshot.github } : {}),
        };
        syncSnapshotCache.set(daemon as object, merged);
        return merged;
      });
      setHasPassphrase(snapshot.hasPassphrase);
      if (snapshot.syncConfigPath) setSyncConfigPath(snapshot.syncConfigPath);
      setSyncPortable(snapshot.syncPortable);
      if (scope === "matrix") {
        setSyncMatrix(snapshot.syncMatrix);
      } else if (scope === "webdav") {
        setWebdav(snapshot.webdav);
      } else if (scope === "s3") {
        setS3(snapshot.s3);
      } else if (scope === "github") {
        setGithub(snapshot.github);
      }
      return snapshot;
    },
    [daemon],
  );

  const loadSyncStatus = useCallback(async () => {
    try {
      const syncRes = await daemon.requestJson<unknown>("/v1/sync/status");
      hydrateSyncResponse(syncRes, "all");
    } catch (err) {
      onError?.(`同步状态：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [daemon, hydrateSyncResponse, onError]);

  useEffect(() => {
    void loadSyncStatus();
  }, [loadSyncStatus, refreshTick]);

  const setSingleChannelFeedback = useCallback(
    (channel: SyncChannelKey, next: InlineFeedback | null) => {
      setChannelFeedback((prev) => ({ ...prev, [channel]: next }));
    },
    [],
  );

  const persistFullConfig = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const validationErr = validateEnabledSyncChannels({ webdav, s3, github });
    if (validationErr) {
      return { ok: false, error: validationErr };
    }
    const payload: Record<string, unknown> = {
      ...(passphraseInput.length > 0 ? { passphrase: passphraseInput } : {}),
      syncMatrix,
      channels: {
        webdav: buildWebDavPayload(webdav),
        s3: buildS3Payload(s3),
        github: buildGitHubPayload(github),
      },
    };
    try {
      const res = await daemon.requestJson<unknown>("/v1/sync/config", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      hydrateSyncResponse(res, "all");
      setPassphraseInput("");
      setPassphraseFeedback(null);
      setMatrixFeedback(null);
      setChannelFeedback({ webdav: null, s3: null, github: null });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [daemon, github, hydrateSyncResponse, passphraseInput, s3, syncMatrix, webdav]);

  const handleSaveAllSyncConfig = useCallback(async () => {
    setSavingScope("all");
    setTopFeedback(null);
    try {
      const result = await persistFullConfig();
      if (!result.ok) {
        setTopFeedback({ ok: false, message: result.error });
        onError?.(result.error);
        return;
      }
      const successMsg =
        "Prismux 端到端加密同步配置已保存（敏感凭据已加密入库，页面已清空明文输入）。";
      setTopFeedback({ ok: true, message: successMsg });
      onStatus?.(successMsg);
    } finally {
      setSavingScope(null);
    }
  }, [onError, onStatus, persistFullConfig]);

  const handleSavePassphrase = useCallback(async () => {
    if (passphraseInput.length === 0) return;
    setSavingScope("passphrase");
    setPassphraseFeedback(null);
    try {
      const res = await daemon.requestJson<unknown>("/v1/sync/config", {
        method: "PUT",
        body: JSON.stringify({ passphrase: passphraseInput }),
      });
      hydrateSyncResponse(res, "passphrase");
      setPassphraseInput("");
      const successMsg = "端到端主加密口令已加密保存（页面已清空明文输入）。";
      setPassphraseFeedback({ ok: true, message: successMsg });
      onStatus?.(successMsg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPassphraseFeedback({ ok: false, message: msg });
      onError?.(msg);
    } finally {
      setSavingScope(null);
    }
  }, [daemon, hydrateSyncResponse, onError, onStatus, passphraseInput]);

  const persistSingleChannel = useCallback(
    async (channel: SyncChannelKey): Promise<{ ok: true } | { ok: false; error: string }> => {
      const validationErr =
        channel === "webdav"
          ? validateWebDavForm(webdav)
          : channel === "s3"
            ? validateS3Form(s3)
            : validateGitHubForm(github);
      if (validationErr) {
        return { ok: false, error: validationErr };
      }

      const channelPayload =
        channel === "webdav"
          ? buildWebDavPayload(webdav)
          : channel === "s3"
            ? buildS3Payload(s3)
            : buildGitHubPayload(github);

      try {
        const res = await daemon.requestJson<unknown>("/v1/sync/config", {
          method: "PUT",
          body: JSON.stringify({
            channels: {
              [channel]: channelPayload,
            },
          }),
        });
        hydrateSyncResponse(res, channel);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [daemon, github, hydrateSyncResponse, s3, webdav],
  );

  const handleSaveChannel = useCallback(
    async (channel: SyncChannelKey) => {
      setSavingScope(channel);
      setSingleChannelFeedback(channel, null);
      setTopFeedback(null);
      try {
        const result = await persistSingleChannel(channel);
        if (!result.ok) {
          setSingleChannelFeedback(channel, { ok: false, message: result.error });
          onError?.(result.error);
          return;
        }
        const label = channelDisplayName(channel);
        const successMsg = `${label}通道配置已加密保存（敏感凭据已入库）。`;
        setSingleChannelFeedback(channel, { ok: true, message: successMsg });
        onStatus?.(successMsg);
      } finally {
        setSavingScope(null);
      }
    },
    [onError, onStatus, persistSingleChannel, setSingleChannelFeedback],
  );

  const handleSaveSyncMatrix = useCallback(async () => {
    setSavingScope("matrix");
    setMatrixFeedback(null);
    try {
      const res = await daemon.requestJson<unknown>("/v1/sync/config", {
        method: "PUT",
        body: JSON.stringify({ syncMatrix }),
      });
      hydrateSyncResponse(res, "matrix");
      const successMsg = "同步域矩阵配置已保存。";
      setMatrixFeedback({ ok: true, message: successMsg });
      onStatus?.(successMsg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMatrixFeedback({ ok: false, message: msg });
      onError?.(msg);
    } finally {
      setSavingScope(null);
    }
  }, [daemon, hydrateSyncResponse, onError, onStatus, syncMatrix]);

  const handleTestSingleChannel = useCallback(
    async (channel: SyncChannelKey) => {
      setTestingScope(channel);
      setSingleChannelFeedback(channel, null);
      setTopFeedback(null);
      try {
        const channelDirty =
          channel === "webdav" ? isWebdavDirty : channel === "s3" ? isS3Dirty : isGithubDirty;

        // Always validate enabled channel before testing; auto-save unsaved channel edits first.
        const validationErr =
          channel === "webdav"
            ? validateWebDavForm(webdav)
            : channel === "s3"
              ? validateS3Form(s3)
              : validateGitHubForm(github);
        if (validationErr) {
          setSingleChannelFeedback(channel, { ok: false, message: validationErr });
          setSyncOperationReport({
            kind: "test",
            ok: false,
            timestamp: Date.now(),
            message: validationErr,
            channels: [],
          });
          onError?.(validationErr);
          return;
        }

        if (channelDirty) {
          const saveRes = await persistSingleChannel(channel);
          if (!saveRes.ok) {
            setSingleChannelFeedback(channel, { ok: false, message: saveRes.error });
            setSyncOperationReport({
              kind: "test",
              ok: false,
              timestamp: Date.now(),
              message: saveRes.error,
              channels: [],
            });
            onError?.(saveRes.error);
            return;
          }
        }

        const res = await daemon.testSyncConnection({ channels: [channel] });
        const timestamp =
          typeof res.testedAt === "number"
            ? res.testedAt
            : typeof res.timestamp === "number"
              ? res.timestamp
              : Date.now();
        const channels = parseSyncChannelResults(res);
        const targetResult = channels.find((c) => c.channel === channel) ?? channels[0];
        const message =
          targetResult?.error ||
          targetResult?.message ||
          res.message ||
          res.error ||
          (res.ok
            ? `${channelDisplayName(channel)}通道连通正常。`
            : `${channelDisplayName(channel)}通道连通失败，请检查配置。`);

        setSyncOperationReport({
          kind: "test",
          ok: Boolean(res.ok),
          timestamp,
          message,
          channels,
        });
        setSingleChannelFeedback(channel, {
          ok: Boolean(res.ok),
          message:
            targetResult?.latencyMs !== null && targetResult?.latencyMs !== undefined && res.ok
              ? `${message}（${targetResult.latencyMs} ms）`
              : message,
        });
        if (res.ok) {
          onStatus?.(message);
        } else {
          onError?.(message);
        }
      } catch (err) {
        const msgText = err instanceof Error ? err.message : String(err);
        setSingleChannelFeedback(channel, { ok: false, message: msgText });
        setSyncOperationReport({
          kind: "test",
          ok: false,
          timestamp: Date.now(),
          message: msgText,
          channels: [],
        });
        onError?.(msgText);
      } finally {
        setTestingScope(null);
      }
    },
    [
      daemon,
      github,
      isGithubDirty,
      isS3Dirty,
      isWebdavDirty,
      onError,
      onStatus,
      persistSingleChannel,
      s3,
      setSingleChannelFeedback,
      webdav,
    ],
  );

  const handleTestSyncConnection = useCallback(async () => {
    setTestingScope("all");
    setTopFeedback(null);
    try {
      const validationErr = validateEnabledSyncChannels({ webdav, s3, github });
      if (validationErr) {
        setSyncOperationReport({
          kind: "test",
          ok: false,
          timestamp: Date.now(),
          message: validationErr,
          channels: [],
        });
        onError?.(validationErr);
        return;
      }

      if (isDirty) {
        const saveRes = await persistFullConfig();
        if (!saveRes.ok) {
          setSyncOperationReport({
            kind: "test",
            ok: false,
            timestamp: Date.now(),
            message: saveRes.error,
            channels: [],
          });
          onError?.(saveRes.error);
          return;
        }
      }

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
      setTestingScope(null);
    }
  }, [daemon, github, isDirty, onError, onStatus, persistFullConfig, s3, webdav]);

  const handleTriggerSyncNow = useCallback(async () => {
    setSyncingNow(true);
    setTopFeedback(null);
    const typedPassphrase = passphraseInput;
    try {
      const validationErr = validateEnabledSyncChannels({ webdav, s3, github });
      if (validationErr) {
        setSyncOperationReport({
          kind: "sync",
          ok: false,
          timestamp: Date.now(),
          message: validationErr,
          channels: [],
        });
        onError?.(validationErr);
        return;
      }

      if (isDirty) {
        const saveRes = await persistFullConfig();
        if (!saveRes.ok) {
          setSyncOperationReport({
            kind: "sync",
            ok: false,
            timestamp: Date.now(),
            message: saveRes.error,
            channels: [],
          });
          onError?.(saveRes.error);
          return;
        }
      }

      const res = await daemon.triggerSyncNow({
        direction: "both",
        ...(typedPassphrase.length > 0 ? { passphrase: typedPassphrase } : {}),
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
  }, [
    daemon,
    github,
    isDirty,
    loadSyncStatus,
    onError,
    onStatus,
    onSynced,
    passphraseInput,
    persistFullConfig,
    s3,
    webdav,
  ]);

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

      {/* Top Row: Instant Sync & Connectivity Probe (+ Dirty Save-All Pill) */}
      <SettingsRow
        title="即时同步与通道连通性"
        description="手动执行一次端到端加密同步，或对已启用的 WebDAV / S3 / GitHub 通道进行脱敏连通性探测（如有未保存修改将自动保存后再执行）。"
        control={
          <div className="flex flex-wrap items-center gap-2">
            {isDirty ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-pmx-sync-save-all=""
                data-pmx-sync-dirty="true"
                className="border-warning/45 bg-warning/10 text-warning-foreground hover:bg-warning/20"
                disabled={isBusy}
                onClick={() => {
                  void handleSaveAllSyncConfig();
                }}
              >
                <SaveIcon className="size-3.5" />
                {savingScope === "all" ? "正在保存…" : "有未保存修改 · 保存全部"}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-pmx-sync-test-all=""
              disabled={isBusy}
              onClick={() => {
                void handleTestSyncConnection();
              }}
            >
              <WifiIcon className="size-3.5" />
              {testingScope === "all" ? "检测连通中…" : "测试通道连通性"}
            </Button>
            <Button
              type="button"
              size="sm"
              data-pmx-sync-now=""
              disabled={isBusy}
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
        {topFeedback ? (
          <div
            data-pmx-sync-save-feedback={topFeedback.ok ? "success" : "error"}
            className={cn(
              "mt-2 mb-1.5 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
              topFeedback.ok
                ? "border-success/35 bg-success/10 text-success-foreground"
                : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            {topFeedback.ok ? (
              <CheckCircle2Icon className="size-3.5 shrink-0" />
            ) : (
              <XCircleIcon className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 break-all">{topFeedback.message}</span>
          </div>
        ) : null}

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
                        variant={!ch.enabled ? "secondary" : ch.ok ? "success" : "error"}
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

      {/* Master Encryption Passphrase with Inline Save */}
      <SettingsRow
        title="端到端主加密口令（Passphrase）"
        description={
          syncConfigPath
            ? `配置文件：${syncConfigPath}（留空保存将保留现有加密口令）`
            : "用于派生 Argon2id 密封密钥，留空保存将保持现有口令不变。"
        }
        status={
          passphraseFeedback ? (
            <span
              data-pmx-sync-passphrase-feedback={passphraseFeedback.ok ? "success" : "error"}
              className={cn(
                "inline-flex items-center gap-1 text-[11px]",
                passphraseFeedback.ok
                  ? "text-success-foreground"
                  : "text-destructive",
              )}
            >
              {passphraseFeedback.ok ? (
                <CheckCircle2Icon className="size-3 shrink-0" />
              ) : (
                <AlertTriangleIcon className="size-3 shrink-0" />
              )}
              <span>{passphraseFeedback.message}</span>
            </span>
          ) : undefined
        }
        control={
          <div className="flex w-full items-center gap-2 sm:w-96">
            <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              nativeInput
              type="password"
              size="sm"
              data-pmx-sync-passphrase-input=""
              autoComplete="new-password"
              placeholder={hasPassphrase ? "已保存（输入新口令以更新）" : "输入端到端主口令"}
              value={passphraseInput}
              onChange={(event) => {
                setPassphraseInput(event.target.value);
                setPassphraseFeedback(null);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant={passphraseInput.length > 0 ? "default" : "outline"}
              data-pmx-sync-save-passphrase=""
              disabled={passphraseInput.length === 0 || isBusy}
              onClick={() => {
                void handleSavePassphrase();
              }}
            >
              <SaveIcon className="size-3.5" />
              {savingScope === "passphrase" ? "保存中…" : "保存口令"}
            </Button>
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
            {isWebdavDirty ? (
              <Badge variant="warning" size="sm">
                未保存
              </Badge>
            ) : null}
          </span>
        }
        description="兼容坚果云 / Nextcloud / Alist 等支持 ETag / If-Match 的 WebDAV 服务。"
        control={
          <div className="flex items-center gap-2">
            {!webdav.enabled && isWebdavDirty ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                data-pmx-sync-save-channel-collapsed="webdav"
                disabled={isBusy}
                onClick={() => {
                  void handleSaveChannel("webdav");
                }}
              >
                <SaveIcon className="size-3" />
                {savingScope === "webdav" ? "保存中…" : "保存关闭"}
              </Button>
            ) : null}
            <Switch
              aria-label="启用 WebDAV 同步通道"
              data-pmx-sync-channel-switch="webdav"
              checked={webdav.enabled}
              onCheckedChange={(checked) => {
                setWebdav((prev) => ({ ...prev, enabled: Boolean(checked) }));
                setSingleChannelFeedback("webdav", null);
              }}
            />
          </div>
        }
      >
        <CollapsibleSyncChannelBody channel="webdav" open={webdav.enabled}>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <SyncFieldLabel label="Endpoint URL" required>
              <Input
                nativeInput
                size="sm"
                data-pmx-sync-input="webdav.endpointUrl"
                placeholder="例如 https://dav.example.com/dav"
                value={webdav.endpointUrl}
                onChange={(event) => {
                  setWebdav((prev) => ({ ...prev, endpointUrl: event.target.value }));
                  setSingleChannelFeedback("webdav", null);
                }}
              />
            </SyncFieldLabel>
            <SyncFieldLabel label="远端路径">
              <Input
                nativeInput
                size="sm"
                data-pmx-sync-input="webdav.remotePath"
                placeholder="例如 /prismux/vault.prismux-backup"
                value={webdav.remotePath}
                onChange={(event) => {
                  setWebdav((prev) => ({ ...prev, remotePath: event.target.value }));
                  setSingleChannelFeedback("webdav", null);
                }}
              />
            </SyncFieldLabel>
            <SyncFieldLabel label="用户名">
              <Input
                nativeInput
                size="sm"
                data-pmx-sync-input="webdav.username"
                placeholder="WebDAV 登录用户名"
                value={webdav.username}
                onChange={(event) => {
                  setWebdav((prev) => ({ ...prev, username: event.target.value }));
                  setSingleChannelFeedback("webdav", null);
                }}
              />
            </SyncFieldLabel>
            <SyncFieldLabel label="应用专用密码">
              <Input
                nativeInput
                type="password"
                size="sm"
                data-pmx-sync-input="webdav.password"
                autoComplete="new-password"
                placeholder={webdav.hasSecret ? "密码已加密保存（留空不变）" : "输入应用专用密码"}
                value={webdav.password}
                onChange={(event) => {
                  setWebdav((prev) => ({ ...prev, password: event.target.value }));
                  setSingleChannelFeedback("webdav", null);
                }}
              />
            </SyncFieldLabel>
          </div>
          <SyncChannelCardFooter
            channel="webdav"
            isDirty={isWebdavDirty}
            savingThisChannel={savingScope === "webdav"}
            testingThisChannel={testingScope === "webdav"}
            isBusy={isBusy}
            feedback={channelFeedback.webdav}
            onTest={() => {
              void handleTestSingleChannel("webdav");
            }}
            onSave={() => {
              void handleSaveChannel("webdav");
            }}
          />
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
            {isS3Dirty ? (
              <Badge variant="warning" size="sm">
                未保存
              </Badge>
            ) : null}
          </span>
        }
        description="兼容 Cloudflare R2 / AWS S3 / 阿里云 OSS / MinIO 兼容端点。"
        control={
          <div className="flex items-center gap-2">
            {!s3.enabled && isS3Dirty ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                data-pmx-sync-save-channel-collapsed="s3"
                disabled={isBusy}
                onClick={() => {
                  void handleSaveChannel("s3");
                }}
              >
                <SaveIcon className="size-3" />
                {savingScope === "s3" ? "保存中…" : "保存关闭"}
              </Button>
            ) : null}
            <Switch
              aria-label="启用 S3 同步通道"
              data-pmx-sync-channel-switch="s3"
              checked={s3.enabled}
              onCheckedChange={(checked) => {
                setS3((prev) => ({ ...prev, enabled: Boolean(checked) }));
                setSingleChannelFeedback("s3", null);
              }}
            />
          </div>
        }
      >
        <CollapsibleSyncChannelBody channel="s3" open={s3.enabled}>
          <div className="mt-2.5 space-y-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Switch
                size="sm"
                checked={s3.forcePathStyle}
                onCheckedChange={(checked) => {
                  setS3((prev) => ({ ...prev, forcePathStyle: Boolean(checked) }));
                  setSingleChannelFeedback("s3", null);
                }}
              />
              Force Path-Style
            </label>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <SyncFieldLabel label="Endpoint URL" required>
                <Input
                  nativeInput
                  size="sm"
                  data-pmx-sync-input="s3.endpointUrl"
                  placeholder="例如 https://s3.example.com"
                  value={s3.endpointUrl}
                  onChange={(event) => {
                    setS3((prev) => ({ ...prev, endpointUrl: event.target.value }));
                    setSingleChannelFeedback("s3", null);
                  }}
                />
              </SyncFieldLabel>
              <SyncFieldLabel label="Region">
                <Input
                  nativeInput
                  size="sm"
                  data-pmx-sync-input="s3.region"
                  placeholder="例如 auto / us-east-1"
                  value={s3.region}
                  onChange={(event) => {
                    setS3((prev) => ({ ...prev, region: event.target.value }));
                    setSingleChannelFeedback("s3", null);
                  }}
                />
              </SyncFieldLabel>
              <SyncFieldLabel label="Bucket" required>
                <Input
                  nativeInput
                  size="sm"
                  data-pmx-sync-input="s3.bucket"
                  placeholder="对象存储桶名称"
                  value={s3.bucket}
                  onChange={(event) => {
                    setS3((prev) => ({ ...prev, bucket: event.target.value }));
                    setSingleChannelFeedback("s3", null);
                  }}
                />
              </SyncFieldLabel>
              <SyncFieldLabel label="Access Key ID">
                <Input
                  nativeInput
                  size="sm"
                  data-pmx-sync-input="s3.accessKeyId"
                  placeholder="输入 Access Key ID"
                  value={s3.accessKeyId}
                  onChange={(event) => {
                    setS3((prev) => ({ ...prev, accessKeyId: event.target.value }));
                    setSingleChannelFeedback("s3", null);
                  }}
                />
              </SyncFieldLabel>
              <SyncFieldLabel label="Secret Access Key" className="sm:col-span-2">
                <Input
                  nativeInput
                  type="password"
                  size="sm"
                  data-pmx-sync-input="s3.secretAccessKey"
                  autoComplete="new-password"
                  placeholder={
                    s3.hasSecret ? "Secret Access Key 已加密保存（留空不变）" : "输入 Secret Access Key"
                  }
                  value={s3.secretAccessKey}
                  onChange={(event) => {
                    setS3((prev) => ({ ...prev, secretAccessKey: event.target.value }));
                    setSingleChannelFeedback("s3", null);
                  }}
                />
              </SyncFieldLabel>
            </div>
          </div>
          <SyncChannelCardFooter
            channel="s3"
            isDirty={isS3Dirty}
            savingThisChannel={savingScope === "s3"}
            testingThisChannel={testingScope === "s3"}
            isBusy={isBusy}
            feedback={channelFeedback.s3}
            onTest={() => {
              void handleTestSingleChannel("s3");
            }}
            onSave={() => {
              void handleSaveChannel("s3");
            }}
          />
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
            {isGithubDirty ? (
              <Badge variant="warning" size="sm">
                未保存
              </Badge>
            ) : null}
          </span>
        }
        description="通过 GitHub Contents API 同步端到端密文包，无需本机 git 进程。"
        control={
          <div className="flex items-center gap-2">
            {!github.enabled && isGithubDirty ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                data-pmx-sync-save-channel-collapsed="github"
                disabled={isBusy}
                onClick={() => {
                  void handleSaveChannel("github");
                }}
              >
                <SaveIcon className="size-3" />
                {savingScope === "github" ? "保存中…" : "保存关闭"}
              </Button>
            ) : null}
            <Switch
              aria-label="启用 GitHub 同步通道"
              data-pmx-sync-channel-switch="github"
              checked={github.enabled}
              onCheckedChange={(checked) => {
                setGithub((prev) => ({ ...prev, enabled: Boolean(checked) }));
                setSingleChannelFeedback("github", null);
              }}
            />
          </div>
        }
      >
        <CollapsibleSyncChannelBody channel="github" open={github.enabled}>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
            <SyncFieldLabel label="Owner" required>
              <Input
                nativeInput
                size="sm"
                data-pmx-sync-input="github.owner"
                placeholder="GitHub 用户名或组织，例如 Fish-under-sea"
                value={github.owner}
                onChange={(event) => {
                  setGithub((prev) => ({ ...prev, owner: event.target.value }));
                  setSingleChannelFeedback("github", null);
                }}
              />
            </SyncFieldLabel>
            <SyncFieldLabel label="私有仓库名" required>
              <Input
                nativeInput
                size="sm"
                data-pmx-sync-input="github.repo"
                placeholder="仓库名（Repo），例如 prismux-vault"
                value={github.repo}
                onChange={(event) => {
                  setGithub((prev) => ({ ...prev, repo: event.target.value }));
                  setSingleChannelFeedback("github", null);
                }}
              />
            </SyncFieldLabel>
            <SyncFieldLabel label="分支">
              <Input
                nativeInput
                size="sm"
                data-pmx-sync-input="github.branch"
                placeholder="默认 main"
                value={github.branch}
                onChange={(event) => {
                  setGithub((prev) => ({ ...prev, branch: event.target.value }));
                  setSingleChannelFeedback("github", null);
                }}
              />
            </SyncFieldLabel>
            <SyncFieldLabel label="密文文件路径">
              <Input
                nativeInput
                size="sm"
                data-pmx-sync-input="github.filePath"
                placeholder="例如 prismux-vault.prismux-backup"
                value={github.filePath}
                onChange={(event) => {
                  setGithub((prev) => ({ ...prev, filePath: event.target.value }));
                  setSingleChannelFeedback("github", null);
                }}
              />
            </SyncFieldLabel>
            <SyncFieldLabel label="Personal Access Token" className="sm:col-span-2">
              <Input
                nativeInput
                type="password"
                size="sm"
                data-pmx-sync-input="github.token"
                autoComplete="new-password"
                placeholder={
                  github.hasSecret
                    ? "Personal Access Token 已加密保存（留空不变）"
                    : "Fine-grained PAT（仅需目标私有仓库 Contents 读写权限）"
                }
                value={github.token}
                onChange={(event) => {
                  setGithub((prev) => ({ ...prev, token: event.target.value }));
                  setSingleChannelFeedback("github", null);
                }}
              />
            </SyncFieldLabel>
          </div>
          <SyncChannelCardFooter
            channel="github"
            isDirty={isGithubDirty}
            savingThisChannel={savingScope === "github"}
            testingThisChannel={testingScope === "github"}
            isBusy={isBusy}
            feedback={channelFeedback.github}
            onTest={() => {
              void handleTestSingleChannel("github");
            }}
            onSave={() => {
              void handleSaveChannel("github");
            }}
          />
        </CollapsibleSyncChannelBody>
      </SettingsRow>

      {/* Sync Matrix with Compact Inline Header Save Action */}
      <SettingsRow
        title="同步域矩阵（Upload / Download 独立控制）"
        description="按数据域细粒度控制允许上传与下载的内容，社交隔离记忆默认关闭同步。"
        control={
          isMatrixDirty || matrixFeedback ? (
            <div className="flex flex-wrap items-center gap-2">
              {matrixFeedback ? (
                <span
                  data-pmx-sync-matrix-feedback={matrixFeedback.ok ? "success" : "error"}
                  className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    matrixFeedback.ok
                      ? "text-success-foreground"
                      : "text-destructive",
                  )}
                >
                  {matrixFeedback.ok ? (
                    <CheckCircle2Icon className="size-3.5 shrink-0" />
                  ) : (
                    <AlertTriangleIcon className="size-3.5 shrink-0" />
                  )}
                  <span>{matrixFeedback.message}</span>
                </span>
              ) : null}
              {isMatrixDirty ? (
                <>
                  <Badge variant="warning" size="sm">
                    未保存
                  </Badge>
                  <Button
                    type="button"
                    size="sm"
                    data-pmx-sync-save-matrix=""
                    disabled={isBusy}
                    onClick={() => {
                      void handleSaveSyncMatrix();
                    }}
                  >
                    <SaveIcon className="size-3.5" />
                    {savingScope === "matrix" ? "保存中…" : "保存矩阵"}
                  </Button>
                </>
              ) : null}
            </div>
          ) : undefined
        }
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
                      data-pmx-sync-matrix-switch={`${meta.key}.upload`}
                      checked={entry.upload}
                      onCheckedChange={(checked) => {
                        setSyncMatrix((prev) => ({
                          ...prev,
                          [meta.key]: { ...prev[meta.key], upload: Boolean(checked) },
                        }));
                        setMatrixFeedback(null);
                      }}
                    />
                    上传
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <Switch
                      size="sm"
                      data-pmx-sync-matrix-switch={`${meta.key}.download`}
                      checked={entry.download}
                      onCheckedChange={(checked) => {
                        setSyncMatrix((prev) => ({
                          ...prev,
                          [meta.key]: { ...prev[meta.key], download: Boolean(checked) },
                        }));
                        setMatrixFeedback(null);
                      }}
                    />
                    下载
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
});
