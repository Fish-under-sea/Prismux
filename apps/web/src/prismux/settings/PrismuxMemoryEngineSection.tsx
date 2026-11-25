import { Link } from "@tanstack/react-router";
import { ActivityIcon, ArrowRightIcon, DatabaseIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";

import {
  SETTINGS_CONTROL_SM,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
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
import { cn } from "../../lib/utils";
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
  readonly dbSizeBytes: number | null;
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
  /** Whether to embed the Obsidian import card inside this section (false in 3-tab RC.2 layout). */
  readonly includeObsidian?: boolean;
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

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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

function formatDbSize(bytes: number | null): string {
  if (bytes === null) return "本地单文件";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
    dbSizeBytes: asNullableNumber(root?.dbSizeBytes ?? root?.sizeBytes),
  };
}

/**
 * Isolated memoized Memory Engine section (compact single-line KPI strip,
 * namespace filter + hybrid search, flattened <= 2 card layers).
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
  includeObsidian = false,
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
  const [selectedNamespace, setSelectedNamespace] = useState("all");
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

  const namespaceOptions = useMemo(() => {
    const names = new Set<string>(["private/chief"]);
    if (memoryStats) {
      for (const ns of Object.keys(memoryStats.byNamespace)) {
        if (ns.trim().length > 0) names.add(ns);
      }
    }
    return [...names];
  }, [memoryStats]);

  const handleSearchMemory = useCallback(
    async (overrideNamespace?: string) => {
      const q = searchQuery.trim();
      const targetNs = overrideNamespace ?? selectedNamespace;
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
          body: JSON.stringify({
            query: q,
            limit: limitNum,
            ...(targetNs !== "all" ? { namespaces: [targetNs] } : {}),
          }),
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
    },
    [daemon, onError, searchLimit, searchQuery, selectedNamespace],
  );

  const isHybridReady = memoryStats?.retrievalMode === "fts5+sqlite-vec";

  return (
    <SettingsSection
      id="prismux-memory-engine"
      title="本地混合记忆库"
      headerAction={
        <Badge variant={isHybridReady ? "success" : "warning"} size="sm">
          {isHybridReady ? "语义 + 全文混合检索" : "全文检索模式"}
        </Badge>
      }
    >
      {/* Compact single-line KPI & vector status strip (Layer 2 borderless tint, zero nested bordered cards) */}
      <div className="space-y-3 px-4 py-3.5 sm:px-5">
        <div
          data-memory-retrieval-mode={memoryStats?.retrievalMode ?? "unknown"}
          data-pmx-memory-kpi-strip=""
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-foreground/[0.03] px-3.5 py-2.5 text-xs dark:bg-white/[0.04]"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <DatabaseIcon className="size-3.5 text-primary" />
              <span>条目</span>
              <strong className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {memoryStats ? memoryStats.totalEntries : "—"}
              </strong>
            </span>
            <span className="text-border" aria-hidden="true">
              ·
            </span>
            <span
              className="inline-flex items-center gap-1.5 text-muted-foreground"
              title={memoryStats?.dbPath ?? "~/.prismux/data/memory.db"}
            >
              <span>存储</span>
              <span className="font-mono text-xs text-foreground">
                {formatDbSize(memoryStats?.dbSizeBytes ?? null)}
              </span>
            </span>
            <span className="text-border" aria-hidden="true">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ActivityIcon
                className={cn(
                  "size-3.5 shrink-0",
                  isHybridReady ? "text-emerald-500" : "text-amber-500",
                )}
              />
              <span className="font-medium text-foreground">
                {isHybridReady ? "向量扩展已就绪" : "全文模式运行中"}
              </span>
            </span>
          </div>

          <Button
            size="xs"
            variant="ghost"
            render={<Link to="/settings/maintenance" hash="diagnostics" />}
          >
            <span>服务诊断</span>
            <ArrowRightIcon className="size-3" />
          </Button>
        </div>

        {/* Clickable namespace distribution filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheckIcon className="size-3.5 text-emerald-500" />
          <span>空间分布：</span>
          {memoryStats && Object.keys(memoryStats.byNamespace).length > 0 ? (
            Object.entries(memoryStats.byNamespace).map(([ns, count]) => {
              const active = selectedNamespace === ns;
              return (
                <button
                  key={ns}
                  type="button"
                  onClick={() => {
                    const nextNs = active ? "all" : ns;
                    setSelectedNamespace(nextNs);
                    if (searchQuery.trim().length > 0) {
                      void handleSearchMemory(nextNs);
                    }
                  }}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors",
                    active
                      ? "border-primary/60 bg-primary/15 text-foreground"
                      : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {ns}: {count}
                </button>
              );
            })
          ) : (
            <span>暂无写入记录</span>
          )}
        </div>
      </div>

      {/* Real-time hybrid search with namespace filter */}
      <SettingsRow
        id="memory-search"
        title="记忆检索"
        description="按关键词或语义查询已保存的长期记忆，并可按命名空间筛选。"
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
            <div className={`${SETTINGS_CONTROL_SM} max-w-full shrink-0`}>
              <Select
                modal={false}
                value={selectedNamespace}
                onValueChange={(val) => {
                  if (val) setSelectedNamespace(val);
                }}
              >
                <SelectTrigger size="sm" aria-label="按命名空间筛选" data-pmx-memory-ns-filter="">
                  <SelectValue>
                    {selectedNamespace === "all" ? "全部空间" : selectedNamespace}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value="all">全部空间</SelectItem>
                  {namespaceOptions.map((ns) => (
                    <SelectItem key={ns} value={ns}>
                      {ns}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="w-full sm:w-28">
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
              {searchingMemory ? "检索中…" : "检索"}
            </Button>
          </div>

          {searchMeta ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>
                  命中 {memoryHits.length} 条（候选 {searchMeta.totalCandidates}）
                </span>
                {searchMeta.degradedToFtsOnly ? (
                  <Badge variant="secondary" size="sm">
                    当前使用全文检索
                  </Badge>
                ) : null}
              </div>
              {memoryHits.length === 0 ? (
                <div className="rounded-lg bg-foreground/[0.025] px-3 py-2.5 text-xs text-muted-foreground dark:bg-white/[0.03]">
                  未检索到匹配记忆条目。
                </div>
              ) : (
                <div className="max-h-64 divide-y divide-border/50 overflow-y-auto rounded-lg bg-foreground/[0.025] pr-1 dark:bg-white/[0.03]">
                  {memoryHits.map((hit) => (
                    <div
                      key={hit.id || `${hit.namespace}-${hit.title}`}
                      className="px-3 py-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{hit.title}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {hit.namespace}
                          </Badge>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {hit.score.toFixed(2)}
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

      {includeObsidian ? (
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
      ) : null}
    </SettingsSection>
  );
});
