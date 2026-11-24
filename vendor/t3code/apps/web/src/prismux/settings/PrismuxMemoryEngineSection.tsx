import { Link } from "@tanstack/react-router";
import { ActivityIcon, ArrowRightIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useState,
  type RefObject,
} from "react";

import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
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
import type { PrismuxDaemonClient } from "../daemonClient";
import type { ActiveChiefSlotSnapshot } from "./ChiefIdentityAndAgentsMdSection";
import { ObsidianAgentImportCard } from "./ObsidianAgentImportCard";

type MemoryRetrievalModeValue = "fts5+sqlite-vec" | "fts5-only";

export interface MemoryStatsView {
  readonly callerScope: string;
  readonly totalEntries: number;
  readonly vectorSearchEnabled: boolean;
  readonly sqliteVecLoaded: boolean;
  readonly retrievalMode: MemoryRetrievalModeValue;
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

export interface PrismuxMemoryEngineSectionProps {
  readonly daemon: Pick<PrismuxDaemonClient, "requestJson">;
  readonly refreshTick: number;
  readonly secretaryName: string;
  readonly activeProvider: string;
  readonly activeProviderLabel: string;
  readonly activeModel: string;
  readonly activeSlotRef?: RefObject<ActiveChiefSlotSnapshot> | undefined;
  readonly onRender?: (() => void) | undefined;
  readonly onObsidianRender?: (() => void) | undefined;
  readonly onError?: (message: string) => void;
  readonly onStatus?: (message: string) => void;
}

const memoryStatsCache = new WeakMap<object, MemoryStatsView>();

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

function parseMemoryStatsResponse(raw: unknown): MemoryStatsView {
  const root = asRecord(raw);
  const vectorSearchEnabled = asBoolean(root?.vectorSearchEnabled, false);
  const sqliteVecLoaded = asBoolean(root?.sqliteVecLoaded, vectorSearchEnabled);
  const retrievalMode: MemoryRetrievalModeValue =
    root?.retrievalMode === "fts5+sqlite-vec" || root?.retrievalMode === "fts5-only"
      ? root.retrievalMode
      : sqliteVecLoaded
        ? "fts5+sqlite-vec"
        : "fts5-only";
  return {
    callerScope: asString(root?.callerScope, "owner_chief"),
    totalEntries: asNumber(root?.totalEntries, 0),
    vectorSearchEnabled,
    sqliteVecLoaded,
    retrievalMode,
    byNamespace: asNumberRecord(root?.byNamespace),
    byKind: asNumberRecord(root?.byKind),
    latestUpdatedAt: typeof root?.latestUpdatedAt === "number" ? root.latestUpdatedAt : null,
    dbPath: asString(root?.dbPath, "~/.prismux/data/memory.db"),
  };
}

/**
 * Isolated memoized Memory Engine section (SQLite WAL + FTS5 + sqlite-vec stats,
 * real-time hybrid search, and Agent-curated Obsidian Vault migration).
 * Never re-renders when switching Chief Provider / Model / Reasoning Effort.
 */
export const PrismuxMemoryEngineSection = memo(function PrismuxMemoryEngineSection({
  daemon,
  refreshTick,
  secretaryName,
  activeProvider,
  activeProviderLabel,
  activeModel,
  activeSlotRef,
  onRender,
  onObsidianRender,
  onError,
  onStatus,
}: PrismuxMemoryEngineSectionProps) {
  onRender?.();

  const [memoryStats, setMemoryStats] = useState<MemoryStatsView | null>(
    () => memoryStatsCache.get(daemon as object) ?? null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState("10");
  const [searchingMemory, setSearchingMemory] = useState(false);
  const [memoryHits, setMemoryHits] = useState<MemoryHitView[]>([]);
  const [searchMeta, setSearchMeta] = useState<{
    totalCandidates: number;
    degradedToFtsOnly: boolean;
  } | null>(null);

  const loadMemoryStats = useCallback(async () => {
    try {
      const res = await daemon.requestJson<unknown>("/v1/memory/stats");
      const parsed = parseMemoryStatsResponse(res);
      memoryStatsCache.set(daemon as object, parsed);
      startTransition(() => {
        setMemoryStats(parsed);
      });
    } catch (err) {
      onError?.(`记忆库统计：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [daemon, onError]);

  useEffect(() => {
    void loadMemoryStats();
  }, [loadMemoryStats, refreshTick]);

  const handleSearchMemory = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) {
      setMemoryHits([]);
      setSearchMeta(null);
      return;
    }
    setSearchingMemory(true);
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
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setSearchingMemory(false);
    }
  }, [daemon, onError, searchLimit, searchQuery]);

  return (
    <SettingsSection
      id="prismux-memory-engine"
      title="单文件 SQLite 混合记忆库（WAL + FTS5 + sqlite-vec）"
      headerAction={
        <Badge
          variant={memoryStats?.retrievalMode === "fts5+sqlite-vec" ? "success" : "warning"}
        >
          {memoryStats?.retrievalMode === "fts5+sqlite-vec"
            ? "FTS5 + sqlite-vec 混合态"
            : "FTS5 降级态"}
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
              {memoryStats ? memoryStats.totalEntries : "—"}
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

        <div
          data-memory-retrieval-mode={memoryStats?.retrievalMode ?? "unknown"}
          className={
            memoryStats?.retrievalMode === "fts5+sqlite-vec"
              ? "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs"
              : "flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs"
          }
        >
          <div className="flex min-w-0 items-start gap-2">
            <ActivityIcon
              className={
                memoryStats?.retrievalMode === "fts5+sqlite-vec"
                  ? "mt-0.5 size-3.5 shrink-0 text-emerald-500"
                  : "mt-0.5 size-3.5 shrink-0 text-amber-500"
              }
            />
            <div className="min-w-0 space-y-0.5">
              <div className="font-medium text-foreground">
                {memoryStats?.retrievalMode === "fts5+sqlite-vec"
                  ? "当前检索态：FTS5 + sqlite-vec 混合检索已就绪"
                  : "当前检索态：FTS5 降级态（未加载 sqlite-vec 扩展）"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {memoryStats?.retrievalMode === "fts5+sqlite-vec"
                  ? "sqlite-vec 原生扩展已加载，支持词法 + 向量混合语义召回。"
                  : "当前环境未加载 sqlite-vec（如缺失 vec0.dll），系统已自动平滑回退为纯 FTS5 全文词法检索，所有记忆读写均正常且无数据兼容风险。"}
              </div>
            </div>
          </div>
          <Button
            size="xs"
            variant="outline"
            render={<Link to="/settings/diagnostics" />}
          >
            <span>服务体检</span>
            <ArrowRightIcon className="size-3" />
          </Button>
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
              <Select modal={false} value={searchLimit} onValueChange={(v) => v && setSearchLimit(v)}>
                <SelectTrigger size="sm">
                  <SelectValue>前 {searchLimit} 条</SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
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

      {/* Obsidian Vault Smart Agent Migration */}
      <ObsidianAgentImportCard
        daemon={daemon}
        secretaryName={secretaryName}
        activeProvider={activeProvider}
        activeProviderLabel={activeProviderLabel}
        activeModel={activeModel}
        activeSlotRef={activeSlotRef}
        onRender={onObsidianRender}
        onCommitted={loadMemoryStats}
        onError={onError}
        onStatus={onStatus}
      />
    </SettingsSection>
  );
});
