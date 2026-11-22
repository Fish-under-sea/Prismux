import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  CloudIcon,
  DatabaseIcon,
  FolderOpenIcon,
  KeyRoundIcon,
  LockIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "lucide-react";

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
import { Switch } from "../../components/ui/switch";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";

type DialModeValue = "agent" | "oracle" | "review";

interface ChiefStateView {
  readonly threadId: string;
  readonly provider: string;
  readonly model: string;
  readonly dialMode: DialModeValue;
  readonly availableProviders: readonly string[];
  readonly t3Connected: boolean;
  readonly updatedAt: number | null;
}

interface MemoryStatsView {
  readonly callerScope: string;
  readonly totalEntries: number;
  readonly vectorSearchEnabled: boolean;
  readonly byNamespace: Readonly<Record<string, number>>;
  readonly byKind: Readonly<Record<string, number>>;
  readonly latestUpdatedAt: number | null;
  readonly dbPath: string;
}

interface MemoryHitView {
  readonly id: string;
  readonly namespace: string;
  readonly kind: string;
  readonly title: string;
  readonly content: string;
  readonly score: number;
  readonly matchSource: string;
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

const DIAL_MODES: ReadonlyArray<{
  readonly value: DialModeValue;
  readonly label: string;
  readonly desc: string;
}> = [
  { value: "agent", label: "Agent · 自主执行", desc: "读写工作区、执行命令与自主闭环" },
  { value: "oracle", label: "Oracle · 深度架构", desc: "高推理深度规划、方案研判与代码审计" },
  { value: "review", label: "Review · 只读挑刺", desc: "只读检查 Diff、拦截风险与验收把关" },
];

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

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNumberRecord(value: unknown): Record<string, number> {
  const rec = asRecord(value);
  if (!rec) return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(rec)) {
    if (typeof val === "number" && Number.isFinite(val)) {
      out[key] = val;
    }
  }
  return out;
}

function asDialMode(value: unknown, fallback: DialModeValue = "agent"): DialModeValue {
  return value === "agent" || value === "oracle" || value === "review" ? value : fallback;
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

/**
 * MP-04: /settings/memory-sync
 * Unified real-data control center for:
 * 1. Chief Thread Slot & Agent/Oracle/Review 3-mode dial (/v1/chief, /v1/chief/switch)
 * 2. Single-file SQLite WAL + FTS5 + sqlite-vec hybrid memory & Obsidian Vault import
 * 3. Magpie E2EE Sync (Argon2id + AEAD) with independent WebDAV / S3 / GitHub toggles
 *    and write-only secret inputs (plaintext credentials are never echoed back).
 */
export function PrismuxMemorySyncSettingsPage() {
  const { daemon, daemonInfo, chiefProvider, dialMode, switchChief } = usePrismuxRuntime();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // 1. Chief Slot state
  const [chief, setChief] = useState<ChiefStateView>({
    threadId: "",
    provider: chiefProvider || "claude",
    model: "",
    dialMode: dialMode || "agent",
    availableProviders: ["claude", "codex", "gemini", "custom"],
    t3Connected: false,
    updatedAt: null,
  });
  const [selectedProvider, setSelectedProvider] = useState(chiefProvider || "claude");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedDial, setSelectedDial] = useState<DialModeValue>(dialMode || "agent");
  const [savingChief, setSavingChief] = useState(false);

  // 2. Memory state
  const [memoryStats, setMemoryStats] = useState<MemoryStatsView | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState("10");
  const [searchingMemory, setSearchingMemory] = useState(false);
  const [memoryHits, setMemoryHits] = useState<MemoryHitView[]>([]);
  const [searchMeta, setSearchMeta] = useState<{
    totalCandidates: number;
    degradedToFtsOnly: boolean;
  } | null>(null);
  const [obsidianVaultPath, setObsidianVaultPath] = useState("");
  const [obsidianNamespace, setObsidianNamespace] = useState("private/chief");
  const [obsidianDryRun, setObsidianDryRun] = useState(false);
  const [importingObsidian, setImportingObsidian] = useState(false);
  const [obsidianReport, setObsidianReport] = useState<string | null>(null);

  // 3. Magpie Sync state
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState("");
  const [syncConfigPath, setSyncConfigPath] = useState("");
  const [syncPortable, setSyncPortable] = useState(false);
  const [syncMatrix, setSyncMatrix] = useState<SyncMatrixState>(DEFAULT_SYNC_MATRIX);
  const [webdav, setWebdav] = useState<WebDavFormState>({
    enabled: false,
    endpointUrl: "",
    username: "",
    remotePath: "/prismux/vault.prismux-backup",
    password: "",
    hasSecret: false,
  });
  const [s3, setS3] = useState<S3FormState>({
    enabled: false,
    endpointUrl: "",
    region: "us-east-1",
    bucket: "",
    forcePathStyle: true,
    accessKeyId: "",
    secretAccessKey: "",
    hasSecret: false,
  });
  const [github, setGithub] = useState<GitHubFormState>({
    enabled: false,
    owner: "",
    repo: "",
    branch: "main",
    filePath: "prismux-vault.prismux-backup",
    token: "",
    hasSecret: false,
  });
  const [savingSync, setSavingSync] = useState(false);

  const hydrateSyncResponse = useCallback((syncRes: unknown) => {
    const syncRoot = asRecord(syncRes);
    if (!syncRoot) return;
    setHasPassphrase(asBoolean(syncRoot.hasPassphrase, false));
    setSyncConfigPath(asString(syncRoot.configPath));
    const vaultPaths = asRecord(syncRoot.vaultPaths);
    const statusObj = asRecord(syncRoot.status);
    setSyncPortable(
      asBoolean(vaultPaths?.portableMode, false) || asBoolean(statusObj?.portableMode, false),
    );
    setSyncMatrix(parseSyncMatrix(syncRoot.syncMatrix));

    const channels = asRecord(syncRoot.channels);
    const wd = asRecord(channels?.webdav);
    if (wd) {
      setWebdav((prev) => ({
        ...prev,
        enabled: asBoolean(wd.enabled, false),
        endpointUrl: asString(wd.endpointUrl),
        username: asString(wd.username),
        remotePath: asString(wd.remotePath, prev.remotePath),
        password: "",
        hasSecret: asBoolean(wd.hasSecret, false),
      }));
    }
    const s3Rec = asRecord(channels?.s3);
    if (s3Rec) {
      setS3((prev) => ({
        ...prev,
        enabled: asBoolean(s3Rec.enabled, false),
        endpointUrl: asString(s3Rec.endpointUrl),
        region: asString(s3Rec.region, "us-east-1"),
        bucket: asString(s3Rec.bucket),
        forcePathStyle: asBoolean(s3Rec.forcePathStyle, true),
        accessKeyId: asString(s3Rec.accessKeyId),
        secretAccessKey: "",
        hasSecret: asBoolean(s3Rec.hasSecret, false),
      }));
    }
    const gh = asRecord(channels?.github);
    if (gh) {
      setGithub((prev) => ({
        ...prev,
        enabled: asBoolean(gh.enabled, false),
        owner: asString(gh.owner),
        repo: asString(gh.repo),
        branch: asString(gh.branch, "main"),
        filePath: asString(gh.filePath, prev.filePath),
        token: "",
        hasSecret: asBoolean(gh.hasSecret, false),
      }));
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const errors: string[] = [];

    try {
      const [chiefRes, statsRes, syncRes] = await Promise.allSettled([
        daemon.requestJson<unknown>("/v1/chief"),
        daemon.requestJson<unknown>("/v1/memory/stats"),
        daemon.requestJson<unknown>("/v1/sync/status"),
      ]);

      if (chiefRes.status === "fulfilled") {
        const root = asRecord(chiefRes.value);
        const slot = asRecord(root?.slot);
        const provider = asString(slot?.provider, chiefProvider || "claude");
        const model = asString(slot?.model);
        const mode = asDialMode(root?.dialMode, dialMode || "agent");
        const providers = Array.isArray(root?.availableProviders)
          ? root.availableProviders.filter((p): p is string => typeof p === "string")
          : ["claude", "codex", "gemini", "custom"];
        setChief({
          threadId: asString(slot?.threadId),
          provider,
          model,
          dialMode: mode,
          availableProviders: providers.length > 0 ? providers : ["claude", "codex", "gemini", "custom"],
          t3Connected: asBoolean(root?.t3Connected, false),
          updatedAt: typeof slot?.updatedAt === "number" ? slot.updatedAt : null,
        });
        setSelectedProvider(provider);
        setSelectedModel(model);
        setSelectedDial(mode);
      } else {
        errors.push(`主秘书状态：${chiefRes.reason instanceof Error ? chiefRes.reason.message : String(chiefRes.reason)}`);
      }

      if (statsRes.status === "fulfilled") {
        const root = asRecord(statsRes.value);
        setMemoryStats({
          callerScope: asString(root?.callerScope, "owner_chief"),
          totalEntries: asNumber(root?.totalEntries, 0),
          vectorSearchEnabled: asBoolean(root?.vectorSearchEnabled, false),
          byNamespace: asNumberRecord(root?.byNamespace),
          byKind: asNumberRecord(root?.byKind),
          latestUpdatedAt: typeof root?.latestUpdatedAt === "number" ? root.latestUpdatedAt : null,
          dbPath: asString(root?.dbPath, "~/.prismux/data/memory.db"),
        });
      } else {
        errors.push(`记忆库统计：${statsRes.reason instanceof Error ? statsRes.reason.message : String(statsRes.reason)}`);
      }

      if (syncRes.status === "fulfilled") {
        hydrateSyncResponse(syncRes.value);
      } else {
        errors.push(`同步状态：${syncRes.reason instanceof Error ? syncRes.reason.message : String(syncRes.reason)}`);
      }

      if (errors.length > 0) {
        setErrorMsg(errors.join(" ｜ "));
      }
    } finally {
      setLoading(false);
    }
  }, [chiefProvider, daemon, dialMode, hydrateSyncResponse]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveChief = useCallback(async () => {
    setSavingChief(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await switchChief({ provider: selectedProvider, dialMode: selectedDial });
      await daemon.requestJson<unknown>("/v1/chief/switch", {
        method: "POST",
        body: JSON.stringify({
          provider: selectedProvider,
          ...(selectedModel.trim().length > 0 ? { model: selectedModel.trim() } : {}),
          dialMode: selectedDial,
        }),
      });
      setStatusMsg(`主秘书槽位已切换为 ${selectedProvider}（档位：${selectedDial}）。`);
      await loadAll();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingChief(false);
    }
  }, [daemon, loadAll, selectedDial, selectedModel, selectedProvider, switchChief]);

  const handleSearchMemory = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setMemoryHits([]);
      setSearchMeta(null);
      return;
    }
    setSearchingMemory(true);
    setErrorMsg(null);
    try {
      const limitNum = Math.min(50, Math.max(1, Number.parseInt(searchLimit, 10) || 10));
      const res = await daemon.requestJson<unknown>("/v1/memory/search", {
        method: "POST",
        body: JSON.stringify({ query: q, limit: limitNum }),
      });
      const root = asRecord(res);
      const rawHits = Array.isArray(root?.hits) ? root.hits : [];
      const parsed: MemoryHitView[] = [];
      for (const item of rawHits) {
        const hit = asRecord(item);
        const entry = asRecord(hit?.entry);
        if (!hit || !entry) continue;
        parsed.push({
          id: asString(entry.id),
          namespace: asString(entry.namespace, "private/chief"),
          kind: asString(entry.kind, "note"),
          title: asString(entry.title, "(无标题)"),
          content: asString(entry.content),
          score: asNumber(hit.score, 0),
          matchSource: asString(hit.matchSource, "fts"),
        });
      }
      setMemoryHits(parsed);
      setSearchMeta({
        totalCandidates: asNumber(root?.totalCandidates, parsed.length),
        degradedToFtsOnly: asBoolean(root?.degradedToFtsOnly, false),
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchingMemory(false);
    }
  }, [daemon, searchLimit, searchQuery]);

  const handlePickObsidianFolder = useCallback(async () => {
    const bridge = window.desktopBridge;
    const picked =
      (await bridge?.pickFolder?.()) ??
      (await bridge?.prismux?.pickWallpaperDirectory?.()) ??
      null;
    if (picked) {
      setObsidianVaultPath(picked);
    }
  }, []);

  const handleImportObsidian = useCallback(async () => {
    const vaultPath = obsidianVaultPath.trim();
    if (!vaultPath) {
      setErrorMsg("请先输入或选择本地 Obsidian Vault 目录路径。");
      return;
    }
    setImportingObsidian(true);
    setErrorMsg(null);
    setObsidianReport(null);
    try {
      const res = await daemon.requestJson<unknown>("/v1/memory/import-obsidian", {
        method: "POST",
        body: JSON.stringify({
          vaultPath,
          ...(obsidianNamespace.trim() ? { targetNamespace: obsidianNamespace.trim() } : {}),
          dryRun: obsidianDryRun,
        }),
      });
      const root = asRecord(res);
      const imported = asNumber(root?.imported ?? root?.inserted, 0);
      const updated = asNumber(root?.updated, 0);
      const skipped = asNumber(root?.skipped, 0);
      const scanned = asNumber(root?.scanned ?? root?.totalFiles, imported + updated + skipped);
      setObsidianReport(
        `${obsidianDryRun ? "[Dry-Run 预览] " : ""}扫描 ${scanned} 篇笔记 · 导入 ${imported} · 更新 ${updated} · 跳过 ${skipped}`,
      );
      if (!obsidianDryRun) {
        await loadAll();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingObsidian(false);
    }
  }, [daemon, loadAll, obsidianDryRun, obsidianNamespace, obsidianVaultPath]);

  const handleSaveSyncConfig = useCallback(async () => {
    setSavingSync(true);
    setErrorMsg(null);
    setStatusMsg(null);
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
      setStatusMsg("Magpie 端到端加密同步配置已保存（敏感凭据已加密入库，页面已清空明文输入）。");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSync(false);
    }
  }, [daemon, github, hydrateSyncResponse, passphraseInput, s3, syncMatrix, webdav]);

  return (
    <SettingsPageContainer width="wide">
      <div id="prismux-memory-sync" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-card/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <DatabaseIcon className="size-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            主秘书槽位 · 单文件 SQLite 记忆中枢 · Magpie 端到端加密同步
          </span>
          <Badge variant={daemonInfo.ready ? "success" : "warning"}>
            {daemonInfo.ready ? "Daemon 在线" : "Daemon 未连接"}
          </Badge>
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={loading}
          onClick={() => {
            void loadAll();
          }}
        >
          <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
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

      {/* Section 1: Chief Thread Slot & 3-mode Dial */}
      <SettingsSection
        id="prismux-chief-slot"
        title="主秘书槽位（Chief Thread Slot）与三档拨盘"
        headerAction={
          <Badge variant={chief.t3Connected ? "success" : "outline"} className="gap-1">
            <BotIcon className="size-3" />
            {chief.t3Connected ? "T3 Server 已桥接" : "本地独立运行"}
          </Badge>
        }
      >
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          任意代理均可热切换接任 24h 主秘书槽位，并通过 Agent / Oracle / Review 三档拨盘即时切换执行权限与深度。
        </p>
        <SettingsRow
          title="当前主秘书 Provider"
          description={
            chief.threadId
              ? `活动槽位线程：${chief.threadId}`
              : "选择接任主秘书槽位的代理引擎（热切换不丢失上下文）"
          }
          control={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="w-40">
                <Select
                  value={selectedProvider}
                  onValueChange={(val) => {
                    if (val) setSelectedProvider(val);
                  }}
                >
                  <SelectTrigger size="sm">
                    <SelectValue>{selectedProvider}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {chief.availableProviders.map((prov) => (
                      <SelectItem key={prov} value={prov}>
                        {prov}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <Input
                nativeInput
                size="sm"
                className="w-44 font-mono"
                placeholder="可选模型覆盖（留空默认）"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
              />
            </div>
          }
        />

        <SettingsRow
          title="Handoff 三档拨盘（Agent / Oracle / Review）"
          description="切换主秘书当前的工作档位，并同步更新工具栏实时状态。"
        >
          <div className="mt-2.5 space-y-3 pb-2">
            <div className="grid gap-2 sm:grid-cols-3">
              {DIAL_MODES.map((item) => {
                const active = selectedDial === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSelectedDial(item.value)}
                    className={
                      active
                        ? "rounded-lg border border-primary bg-primary/10 px-3 py-2.5 text-left transition-colors"
                        : "rounded-lg border border-border bg-background/60 px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
                    }
                  >
                    <div className="text-xs font-semibold text-foreground">{item.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{item.desc}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={savingChief}
                onClick={() => {
                  void handleSaveChief();
                }}
              >
                <SaveIcon className="size-3.5" />
                {savingChief ? "切换中…" : "应用主秘书槽位与档位"}
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Section 2: Single-file SQLite Hybrid Memory Engine */}
      <SettingsSection
        id="prismux-memory-engine"
        title="单文件 SQLite 混合记忆库（WAL + FTS5 + sqlite-vec）"
        headerAction={
          <Badge variant={memoryStats?.vectorSearchEnabled ? "success" : "secondary"}>
            {memoryStats?.vectorSearchEnabled ? "sqlite-vec 向量已启用" : "FTS5 纯词法模式"}
          </Badge>
        }
      >
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          零 PostgreSQL / Qdrant / MinIO 外部依赖；传输层强制注入 _callerScope，qq_group:&lt;gid&gt; 物理绑定 social/qq-group-&lt;gid&gt; 隔离域。
        </p>
        <div className="space-y-3 px-4 py-3.5">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">记忆总条目</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                {memoryStats?.totalEntries ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">当前调用者域</div>
              <div className="mt-0.5 font-mono text-xs font-medium text-foreground">
                {memoryStats?.callerScope ?? "owner_chief"}
              </div>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2 sm:col-span-2">
              <div className="text-[11px] text-muted-foreground">单文件存储路径</div>
              <div className="mt-0.5 truncate font-mono text-xs text-foreground" title={memoryStats?.dbPath}>
                {memoryStats?.dbPath ?? "~/.prismux/data/memory.db"}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheckIcon className="size-3.5 text-emerald-500" />
            <span>三域分布：</span>
            {memoryStats && Object.keys(memoryStats.byNamespace).length > 0 ? (
              Object.entries(memoryStats.byNamespace).map(([ns, count]) => (
                <Badge key={ns} variant="outline" className="font-mono text-[11px] tabular-nums">
                  {ns}: {count}
                </Badge>
              ))
            ) : (
              <span>暂无写入记录</span>
            )}
          </div>
        </div>

        {/* Real-time hybrid search */}
        <SettingsRow
          title="实时混合记忆检索"
          description="直接调用 POST /v1/memory/search 执行 FTS5 + 向量混合召回测试。"
        >
          <div className="mt-2.5 space-y-3 pb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                nativeInput
                size="sm"
                className="flex-1"
                placeholder="输入关键词或语义查询语句…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleSearchMemory();
                  }
                }}
              />
              <div className="w-28">
                <Select value={searchLimit} onValueChange={(v) => v && setSearchLimit(v)}>
                  <SelectTrigger size="sm">
                    <SelectValue>前 {searchLimit} 条</SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="5">前 5 条</SelectItem>
                    <SelectItem value="10">前 10 条</SelectItem>
                    <SelectItem value="20">前 20 条</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
              <Button
                size="sm"
                disabled={searchingMemory || searchQuery.trim().length === 0}
                onClick={() => {
                  void handleSearchMemory();
                }}
              >
                <SearchIcon className="size-3.5" />
                {searchingMemory ? "检索中…" : "检索记忆"}
              </Button>
            </div>

            {searchMeta ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>
                    命中 {memoryHits.length} 条（候选 {searchMeta.totalCandidates}）
                  </span>
                  {searchMeta.degradedToFtsOnly ? (
                    <Badge variant="secondary">已降级为 FTS5 词法检索</Badge>
                  ) : null}
                </div>
                {memoryHits.length === 0 ? (
                  <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
                    未检索到匹配记忆条目。
                  </div>
                ) : (
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {memoryHits.map((hit) => (
                      <div
                        key={hit.id || `${hit.namespace}-${hit.title}`}
                        className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{hit.title}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {hit.namespace}
                            </Badge>
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              {hit.matchSource} · {hit.score.toFixed(3)}
                            </Badge>
                          </div>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                          {hit.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </SettingsRow>

        {/* Obsidian Vault Migration */}
        <SettingsRow
          title="Obsidian Vault 历史笔记迁移"
          description="一次性将本地 Markdown 笔记库导入单文件 SQLite 记忆库，运行时不依赖本地 Obsidian 客户端。"
        >
          <div className="mt-2.5 space-y-2.5 pb-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                nativeInput
                size="sm"
                className="flex-1 font-mono"
                placeholder="例如：D:\Notes\ObsidianVault"
                value={obsidianVaultPath}
                onChange={(event) => setObsidianVaultPath(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void handlePickObsidianFolder();
                }}
              >
                <FolderOpenIcon className="size-3.5" />
                浏览目录
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>目标命名空间</span>
                  <Input
                    nativeInput
                    size="compact"
                    className="w-40 font-mono"
                    value={obsidianNamespace}
                    onChange={(event) => setObsidianNamespace(event.target.value)}
                  />
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    size="sm"
                    checked={obsidianDryRun}
                    onCheckedChange={(checked) => setObsidianDryRun(Boolean(checked))}
                  />
                  仅 Dry-Run 预览统计
                </label>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={importingObsidian || obsidianVaultPath.trim().length === 0}
                onClick={() => {
                  void handleImportObsidian();
                }}
              >
                <UploadIcon className="size-3.5" />
                {importingObsidian ? "导入中…" : obsidianDryRun ? "预览扫描" : "导入至记忆库"}
              </Button>
            </div>
            {obsidianReport ? (
              <div className="rounded-md border border-success/30 bg-success/10 px-3 py-1.5 text-xs text-success-foreground">
                {obsidianReport}
              </div>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Section 3: Magpie E2EE Sync Engine */}
      <SettingsSection
        id="prismux-magpie-sync"
        title="Magpie 端到端加密同步（Argon2id + AEAD）"
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
              checked={webdav.enabled}
              onCheckedChange={(checked) =>
                setWebdav((prev) => ({ ...prev, enabled: Boolean(checked) }))
              }
            />
          }
        >
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
        </SettingsRow>

        {/* Independent Channel 2: S3 */}
        <SettingsRow
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
              checked={s3.enabled}
              onCheckedChange={(checked) =>
                setS3((prev) => ({ ...prev, enabled: Boolean(checked) }))
              }
            />
          }
        >
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
        </SettingsRow>

        {/* Independent Channel 3: GitHub */}
        <SettingsRow
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
              checked={github.enabled}
              onCheckedChange={(checked) =>
                setGithub((prev) => ({ ...prev, enabled: Boolean(checked) }))
              }
            />
          }
        >
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
    </SettingsPageContainer>
  );
}
