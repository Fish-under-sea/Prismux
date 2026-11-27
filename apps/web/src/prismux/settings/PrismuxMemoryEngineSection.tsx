import { Link } from "@tanstack/react-router";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  DatabaseIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import {
  PrismuxDaemonError,
  type DaemonObsidianCuratedKind,
  type PrismuxDaemonClient,
} from "../daemonClient";
import type { ActiveChiefSlotSnapshot } from "./ChiefIdentityAndAgentsMdSection";
import { ObsidianAgentImportCard } from "./ObsidianAgentImportCard";

type MemoryRetrievalModeValue = "fts5+sqlite-vec" | "fts5-only";
export type MemoryDomainFilter = "all" | "chief" | "workspace" | "qq_group";

const MEMORY_KIND_OPTIONS: ReadonlyArray<{
  readonly value: DaemonObsidianCuratedKind;
  readonly label: string;
}> = [
  { value: "preference", label: "个人偏好" },
  { value: "decision", label: "架构决策" },
  { value: "project", label: "项目脉络" },
  { value: "knowledge", label: "知识事实" },
  { value: "experience", label: "经验踩坑" },
];

const MEMORY_KIND_LABELS: Readonly<Record<string, string>> = {
  preference: "个人偏好",
  decision: "架构决策",
  project: "项目脉络",
  knowledge: "知识事实",
  experience: "经验踩坑",
  note: "笔记",
};

const VALID_MEMORY_NAMESPACE_RE =
  /^(?:private\/chief|workspace\/[a-z0-9._-]+|social\/qq-group-[a-z0-9_-]+)$/i;

export function isValidMemoryNamespaceInput(ns: string): boolean {
  return VALID_MEMORY_NAMESPACE_RE.test(ns.trim());
}

export function classifyMemoryNamespaceDomain(
  ns: string,
): Exclude<MemoryDomainFilter, "all"> | null {
  const trimmed = ns.trim();
  if (trimmed === "private/chief") return "chief";
  if (trimmed.startsWith("workspace/")) return "workspace";
  if (trimmed.startsWith("social/qq-group-")) return "qq_group";
  return null;
}

export function resolveMemoryNamespacesForFilter(input: {
  readonly domain: MemoryDomainFilter;
  readonly exactNamespace: string;
  readonly byNamespace: Readonly<Record<string, number>> | null | undefined;
}): {
  readonly namespaces?: string[];
  readonly emptyDomain?: boolean;
} {
  const exact = input.exactNamespace.trim();
  if (exact.length > 0 && exact !== "all") {
    return { namespaces: [exact] };
  }
  if (input.domain === "all") {
    return {};
  }
  if (input.domain === "chief") {
    return { namespaces: ["private/chief"] };
  }
  const allNamespaces = Object.keys(input.byNamespace ?? {});
  const prefix = input.domain === "workspace" ? "workspace/" : "social/qq-group-";
  const matched = allNamespaces.filter((ns) => ns.startsWith(prefix));
  if (matched.length === 0) {
    return { emptyDomain: true };
  }
  return { namespaces: matched };
}

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
  readonly tags: readonly string[];
  readonly score: number;
  readonly matchSource: string;
  readonly updatedAt: number | null;
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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

function formatMemoryTimestamp(ts: number | null): string | null {
  if (ts === null || !Number.isFinite(ts) || ts <= 0) return null;
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function parseTagsInput(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,，\s]+/)
        .map((part) => part.trim().replace(/^#/, ""))
        .filter((part) => part.length > 0),
    ),
  );
}

function normalizeMemoryKind(raw: string): DaemonObsidianCuratedKind {
  return raw === "preference" ||
    raw === "decision" ||
    raw === "project" ||
    raw === "knowledge" ||
    raw === "experience"
    ? raw
    : "knowledge";
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

function parseMemorySearchHits(raw: unknown): {
  readonly hits: MemoryHitView[];
  readonly totalCandidates: number;
  readonly degradedToFtsOnly: boolean;
} {
  const root = asRecord(raw);
  const rawList = Array.isArray(root?.hits)
    ? root.hits
    : Array.isArray(root?.results)
      ? root.results
      : Array.isArray(root?.items)
        ? root.items
        : [];
  const parsed: MemoryHitView[] = [];
  for (const item of rawList) {
    const record = asRecord(item);
    if (!record) continue;
    const entry = asRecord(record.entry) ?? record;
    const id = asString(entry.id);
    const content = asString(entry.content);
    if (!id && !content) continue;
    parsed.push({
      id,
      namespace: asString(entry.namespace, "private/chief"),
      kind: asString(entry.kind, "knowledge"),
      title: asString(entry.title).trim() || "(无标题)",
      content,
      tags: asStringArray(entry.tags),
      score: asNumber(record.score, 0),
      matchSource: asString(record.matchSource, "fts"),
      updatedAt: asNullableNumber(entry.updatedAt ?? entry.createdAt),
    });
  }
  return {
    hits: parsed,
    totalCandidates: asNumber(root?.totalCandidates ?? root?.total, parsed.length),
    degradedToFtsOnly: asBoolean(root?.degradedToFtsOnly, false),
  };
}

/**
 * Isolated memoized Memory Engine section (compact single-line KPI strip,
 * 3-domain + namespace filter, hybrid search/browse, and manual add/edit/delete).
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
  const [selectedDomain, setSelectedDomain] = useState<MemoryDomainFilter>("all");
  const [selectedNamespace, setSelectedNamespace] = useState("all");
  const [searchLimit, setSearchLimit] = useState("10");
  const [searchingMemory, setSearchingMemory] = useState(false);
  const [memoryHits, setMemoryHits] = useState<MemoryHitView[]>([]);
  const [searchMeta, setSearchMeta] = useState<{
    totalCandidates: number;
    degradedToFtsOnly: boolean;
  } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  // Manual create form state
  const [createOpen, setCreateOpen] = useState(false);
  const [createNamespace, setCreateNamespace] = useState("private/chief");
  const [createKind, setCreateKind] = useState<DaemonObsidianCuratedKind>("knowledge");
  const [createTitle, setCreateTitle] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [createTags, setCreateTags] = useState("");
  const [savingCreate, setSavingCreate] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<DaemonObsidianCuratedKind>("knowledge");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Two-step delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteUnsupported, setDeleteUnsupported] = useState(false);

  const statsSeqRef = useRef(0);
  const searchSeqRef = useRef(0);
  const memoryStatsRef = useRef<MemoryStatsView | null>(memoryStats);
  memoryStatsRef.current = memoryStats;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const selectedDomainRef = useRef(selectedDomain);
  selectedDomainRef.current = selectedDomain;
  const selectedNamespaceRef = useRef(selectedNamespace);
  selectedNamespaceRef.current = selectedNamespace;
  const searchLimitRef = useRef(searchLimit);
  searchLimitRef.current = searchLimit;

  const loadMemoryStats = useCallback(async (): Promise<MemoryStatsView | null> => {
    const seq = ++statsSeqRef.current;
    try {
      const res = await daemon.requestJson<unknown>("/v1/memory/stats");
      if (seq !== statsSeqRef.current) {
        return memoryStatsRef.current;
      }
      const parsed = parseMemoryStatsResponse(res);
      memoryStatsCache.set(daemon as object, parsed);
      memoryStatsRef.current = parsed;
      startTransition(() => {
        setMemoryStats(parsed);
      });
      return parsed;
    } catch (err) {
      if (seq === statsSeqRef.current) {
        const message = `记忆库统计：${err instanceof Error ? err.message : String(err)}`;
        setLocalError(message);
        onError?.(message);
      }
      return null;
    }
  }, [daemon, onError]);

  const executeSearchMemory = useCallback(
    async (options?: {
      readonly query?: string;
      readonly domain?: MemoryDomainFilter;
      readonly namespace?: string;
      readonly limit?: string;
      readonly statsOverride?: MemoryStatsView | null;
      readonly silentError?: boolean;
    }) => {
      const seq = ++searchSeqRef.current;
      const q = (options?.query ?? searchQueryRef.current).trim();
      const targetDomain = options?.domain ?? selectedDomainRef.current;
      const targetNs = options?.namespace ?? selectedNamespaceRef.current;
      const effectiveStats =
        options?.statsOverride !== undefined ? options.statsOverride : memoryStatsRef.current;

      const resolvedFilter = resolveMemoryNamespacesForFilter({
        domain: targetDomain,
        exactNamespace: targetNs,
        byNamespace: effectiveStats?.byNamespace,
      });

      if (resolvedFilter.emptyDomain) {
        setMemoryHits([]);
        setSearchMeta({ totalCandidates: 0, degradedToFtsOnly: false });
        setSearchingMemory(false);
        return;
      }

      setSearchingMemory(true);
      if (!options?.silentError) {
        setLocalError(null);
      }
      try {
        const limitNum = Math.min(
          50,
          Math.max(1, Number.parseInt(options?.limit ?? searchLimitRef.current, 10) || 10),
        );
        const res = await daemon.requestJson<unknown>("/v1/memory/search", {
          method: "POST",
          body: JSON.stringify({
            query: q,
            limit: limitNum,
            ...(resolvedFilter.namespaces && resolvedFilter.namespaces.length > 0
              ? { namespaces: resolvedFilter.namespaces }
              : {}),
          }),
        });
        if (seq !== searchSeqRef.current) {
          return;
        }
        const parsed = parseMemorySearchHits(res);
        setMemoryHits(parsed.hits);
        setSearchMeta({
          totalCandidates: parsed.totalCandidates,
          degradedToFtsOnly: parsed.degradedToFtsOnly,
        });
      } catch (err) {
        if (seq !== searchSeqRef.current) {
          return;
        }
        if (!options?.silentError) {
          const message = err instanceof Error ? err.message : String(err);
          setLocalError(`记忆检索失败：${message}`);
          onError?.(message);
        }
      } finally {
        if (seq === searchSeqRef.current) {
          setSearchingMemory(false);
        }
      }
    },
    [daemon, onError],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stats = await loadMemoryStats();
      if (cancelled) return;
      await executeSearchMemory({
        statsOverride: stats,
        silentError: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [executeSearchMemory, loadMemoryStats, refreshTick]);

  const namespaceOptions = useMemo(() => {
    const names = new Set<string>(["private/chief"]);
    if (memoryStats) {
      for (const ns of Object.keys(memoryStats.byNamespace)) {
        if (ns.trim().length > 0) names.add(ns);
      }
    }
    return [...names];
  }, [memoryStats]);

  const domainCounts = useMemo(() => {
    const counts = {
      all: memoryStats?.totalEntries ?? 0,
      chief: 0,
      workspace: 0,
      qq_group: 0,
    };
    if (memoryStats) {
      for (const [ns, count] of Object.entries(memoryStats.byNamespace)) {
        const domain = classifyMemoryNamespaceDomain(ns);
        if (domain) {
          counts[domain] += count;
        }
      }
    }
    return counts;
  }, [memoryStats]);

  const handleSelectDomain = useCallback(
    (nextDomain: MemoryDomainFilter) => {
      setSelectedDomain(nextDomain);
      setSelectedNamespace("all");
      void executeSearchMemory({ domain: nextDomain, namespace: "all" });
    },
    [executeSearchMemory],
  );

  const handleSelectNamespace = useCallback(
    (nextNs: string) => {
      const domain = nextNs === "all" ? "all" : (classifyMemoryNamespaceDomain(nextNs) ?? "all");
      setSelectedNamespace(nextNs);
      setSelectedDomain(domain);
      void executeSearchMemory({ domain, namespace: nextNs });
    },
    [executeSearchMemory],
  );

  const handleCreateMemory = useCallback(async () => {
    const trimmedNs = createNamespace.trim() || "private/chief";
    const trimmedContent = createContent.trim();
    const trimmedTitle = createTitle.trim();
    if (!isValidMemoryNamespaceInput(trimmedNs)) {
      const msg =
        "命名空间格式无效，仅支持 private/chief、workspace/<名称> 或 social/qq-group-<群号>。";
      setLocalError(msg);
      onError?.(msg);
      return;
    }
    if (!trimmedContent) {
      const msg = "请填写记忆正文内容。";
      setLocalError(msg);
      onError?.(msg);
      return;
    }
    setSavingCreate(true);
    setLocalError(null);
    setLocalNotice(null);
    try {
      await daemon.requestJson<unknown>("/v1/memory/upsert", {
        method: "POST",
        body: JSON.stringify({
          namespace: trimmedNs,
          kind: createKind,
          title: trimmedTitle || trimmedContent.slice(0, 32),
          content: trimmedContent,
          tags: parseTagsInput(createTags),
          source: "manual-ui",
        }),
      });
      setCreateTitle("");
      setCreateContent("");
      setCreateTags("");
      setCreateOpen(false);
      const msg = `已写入新记忆至 ${trimmedNs}。`;
      setLocalNotice(msg);
      onStatus?.(msg);
      const stats = await loadMemoryStats();
      await executeSearchMemory({ statsOverride: stats });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalError(`新增记忆失败：${message}`);
      onError?.(message);
    } finally {
      setSavingCreate(false);
    }
  }, [
    createContent,
    createKind,
    createNamespace,
    createTags,
    createTitle,
    daemon,
    executeSearchMemory,
    loadMemoryStats,
    onError,
    onStatus,
  ]);

  const handleStartEdit = useCallback((hit: MemoryHitView) => {
    setConfirmDeleteId(null);
    setEditingId(hit.id);
    setEditKind(normalizeMemoryKind(hit.kind));
    setEditTitle(hit.title === "(无标题)" ? "" : hit.title);
    setEditContent(hit.content);
    setEditTags(hit.tags.join(", "));
    setLocalError(null);
  }, []);

  const handleSaveEdit = useCallback(
    async (hit: MemoryHitView) => {
      const trimmedContent = editContent.trim();
      if (!trimmedContent) {
        const msg = "记忆正文不能为空。";
        setLocalError(msg);
        onError?.(msg);
        return;
      }
      setSavingEdit(true);
      setLocalError(null);
      setLocalNotice(null);
      try {
        await daemon.requestJson<unknown>("/v1/memory/upsert", {
          method: "POST",
          body: JSON.stringify({
            id: hit.id,
            namespace: hit.namespace,
            kind: editKind,
            title: editTitle.trim() || trimmedContent.slice(0, 32),
            content: trimmedContent,
            tags: parseTagsInput(editTags),
            source: "manual-ui",
          }),
        });
        setEditingId(null);
        const msg = `已更新记忆「${editTitle.trim() || hit.title}」。`;
        setLocalNotice(msg);
        onStatus?.(msg);
        const stats = await loadMemoryStats();
        await executeSearchMemory({ statsOverride: stats });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLocalError(`更新记忆失败：${message}`);
        onError?.(message);
      } finally {
        setSavingEdit(false);
      }
    },
    [
      daemon,
      editContent,
      editKind,
      editTags,
      editTitle,
      executeSearchMemory,
      loadMemoryStats,
      onError,
      onStatus,
    ],
  );

  const handleDeleteMemory = useCallback(
    async (hit: MemoryHitView) => {
      if (!hit.id) return;
      setDeletingId(hit.id);
      setLocalError(null);
      setLocalNotice(null);
      try {
        await daemon.requestJson<unknown>(
          `/v1/memory/entries/${encodeURIComponent(hit.id.trim())}`,
          {
            method: "DELETE",
          },
        );
        setConfirmDeleteId(null);
        setMemoryHits((prev) => prev.filter((item) => item.id !== hit.id));
        const msg = `已删除记忆「${hit.title}」。`;
        setLocalNotice(msg);
        onStatus?.(msg);
        const stats = await loadMemoryStats();
        await executeSearchMemory({ statsOverride: stats, silentError: true });
      } catch (err) {
        setConfirmDeleteId(null);
        const status = err instanceof PrismuxDaemonError ? err.status : null;
        const code = err instanceof PrismuxDaemonError ? err.code : "";
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (code === "MEMORY_NOT_FOUND") {
          setMemoryHits((prev) => prev.filter((item) => item.id !== hit.id));
          const notice = `记忆「${hit.title}」已不存在或已被删除，列表已同步刷新。`;
          setLocalNotice(notice);
          onStatus?.(notice);
          const stats = await loadMemoryStats();
          await executeSearchMemory({ statsOverride: stats, silentError: true });
          return;
        }
        const isRouteMissing =
          (status === 404 && code !== "MEMORY_NOT_FOUND") ||
          status === 405 ||
          status === 501 ||
          /route not found|cannot delete|unsupported/i.test(rawMsg);
        if (isRouteMissing) {
          setDeleteUnsupported(true);
          const hint = "当前守护进程版本暂未开放单条记忆删除接口，可先使用「编辑」修改该条目内容。";
          setLocalError(hint);
          onError?.(hint);
        } else {
          setLocalError(`删除记忆失败：${rawMsg}`);
          onError?.(rawMsg);
        }
      } finally {
        setDeletingId(null);
      }
    },
    [daemon, executeSearchMemory, loadMemoryStats, onError, onStatus],
  );

  const isHybridReady = memoryStats?.retrievalMode === "fts5+sqlite-vec";

  return (
    <SettingsSection
      id="prismux-memory-engine"
      title="本地混合记忆库"
      headerAction={
        <div className="flex items-center gap-2">
          <Badge variant={isHybridReady ? "success" : "warning"} size="sm">
            {isHybridReady ? "语义 + 全文混合检索" : "全文检索模式"}
          </Badge>
          <Button
            type="button"
            size="xs"
            variant={createOpen ? "secondary" : "outline"}
            data-pmx-memory-add-toggle=""
            onClick={() => {
              setCreateOpen((prev) => !prev);
              setLocalError(null);
            }}
          >
            <PlusIcon className="size-3" />
            {createOpen ? "收起录入" : "新增记忆"}
          </Button>
        </div>
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
                  isHybridReady
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400",
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

        {/* Three-domain isolation quick filters */}
        <div
          data-pmx-memory-domain-filter=""
          className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <ShieldCheckIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>三域筛选：</span>
          {(
            [
              { id: "all", label: "全部域", count: domainCounts.all },
              { id: "chief", label: "主秘书私密", count: domainCounts.chief },
              { id: "workspace", label: "工作区", count: domainCounts.workspace },
              { id: "qq_group", label: "QQ 群隔离", count: domainCounts.qq_group },
            ] as const
          ).map((item) => {
            const active = selectedDomain === item.id && selectedNamespace === "all";
            return (
              <button
                key={item.id}
                type="button"
                data-pmx-memory-domain-pill={item.id}
                onClick={() => handleSelectDomain(item.id)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] tabular-nums transition-colors",
                  active
                    ? "border-primary/60 bg-primary/15 font-medium text-foreground"
                    : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <span>{item.label}</span>
                <span className="font-mono text-[10px] opacity-80">{item.count}</span>
              </button>
            );
          })}
        </div>

        {/* Clickable namespace distribution filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>空间分布：</span>
          {memoryStats && Object.keys(memoryStats.byNamespace).length > 0 ? (
            Object.entries(memoryStats.byNamespace).map(([ns, count]) => {
              const active = selectedNamespace === ns;
              return (
                <button
                  key={ns}
                  type="button"
                  data-pmx-memory-ns-pill={ns}
                  onClick={() => handleSelectNamespace(active ? "all" : ns)}
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

        {createOpen ? (
          <div
            data-pmx-memory-create-form=""
            className="space-y-2.5 rounded-lg border border-border/70 bg-background/65 p-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">手动录入长期记忆</span>
              <span className="text-[11px] text-muted-foreground">
                自动写入本地单文件 SQLite 记忆库并立即生效
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">命名空间</label>
                <Input
                  nativeInput
                  size="sm"
                  data-pmx-memory-create-ns=""
                  className="font-mono"
                  placeholder="private/chief 或 workspace/my-repo"
                  value={createNamespace}
                  onChange={(event) => setCreateNamespace(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">记忆分类</label>
                <Select
                  modal={false}
                  value={createKind}
                  onValueChange={(val) => {
                    if (val) setCreateKind(normalizeMemoryKind(val));
                  }}
                >
                  <SelectTrigger size="sm" data-pmx-memory-create-kind="">
                    <SelectValue>{MEMORY_KIND_LABELS[createKind] ?? createKind}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {MEMORY_KIND_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                nativeInput
                size="sm"
                data-pmx-memory-create-title=""
                placeholder="标题（可选，留空自动摘取正文首句）"
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
              />
              <Input
                nativeInput
                size="sm"
                data-pmx-memory-create-tags=""
                placeholder="标签（可选，逗号或空格分隔）"
                value={createTags}
                onChange={(event) => setCreateTags(event.target.value)}
              />
            </div>
            <textarea
              data-pmx-memory-create-content=""
              aria-label="记忆正文"
              rows={3}
              placeholder="输入需要主秘书长期记住的偏好、项目约束或架构决策…"
              value={createContent}
              onChange={(event) => setCreateContent(event.target.value)}
              className="w-full resize-y rounded-lg border border-border/80 bg-background/70 px-3 py-2 text-xs leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/70 focus:ring-2 focus:ring-ring/40"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={savingCreate}
                onClick={() => setCreateOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="xs"
                data-pmx-memory-create-submit=""
                disabled={savingCreate || createContent.trim().length === 0}
                onClick={() => {
                  void handleCreateMemory();
                }}
              >
                <CheckIcon className="size-3" />
                {savingCreate ? "写入中…" : "保存记忆"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Real-time hybrid search & browse with namespace filter */}
      <SettingsRow
        id="memory-search"
        title="记忆检索与管理"
        description="支持关键词/语义检索或留空浏览最近记忆，并可按三域与命名空间筛选、编辑条目。"
      >
        <div className="mt-2.5 space-y-3 pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              nativeInput
              size="sm"
              data-pmx-memory-search-input=""
              className="flex-1"
              placeholder="输入关键词或语义查询语句（留空则按时间列出最近记忆）…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void executeSearchMemory();
                }
              }}
            />
            <div className={`${SETTINGS_CONTROL_SM} max-w-full shrink-0`}>
              <Select
                modal={false}
                value={selectedNamespace}
                onValueChange={(val) => {
                  if (val) handleSelectNamespace(val);
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
              <Select
                modal={false}
                value={searchLimit}
                onValueChange={(v) => {
                  if (!v) return;
                  setSearchLimit(v);
                  void executeSearchMemory({ limit: v });
                }}
              >
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
              data-pmx-memory-search-button=""
              disabled={searchingMemory}
              onClick={() => {
                void executeSearchMemory();
              }}
            >
              <SearchIcon className="size-3.5" />
              {searchingMemory ? "检索中…" : "检索"}
            </Button>
          </div>

          {localError ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
            >
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              <span>{localError}</span>
            </div>
          ) : null}

          {localNotice ? (
            <div className="rounded-md bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
              {localNotice}
            </div>
          ) : null}

          {searchMeta ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>
                  {searchQuery.trim().length > 0
                    ? `命中 ${memoryHits.length} 条（候选 ${searchMeta.totalCandidates}）`
                    : `已展示最近 ${memoryHits.length} 条记忆`}
                </span>
                {searchMeta.degradedToFtsOnly ? (
                  <Badge variant="secondary" size="sm">
                    当前使用全文检索
                  </Badge>
                ) : null}
              </div>
              {memoryHits.length === 0 ? (
                <div
                  data-pmx-memory-empty-state=""
                  className="rounded-lg bg-foreground/[0.025] px-3 py-3 text-xs text-muted-foreground dark:bg-white/[0.03]"
                >
                  {searchQuery.trim().length > 0
                    ? "未检索到匹配记忆条目，可尝试更换关键词或切换筛选域。"
                    : "当前筛选范围内暂无记忆条目，可点击右上角「新增记忆」手动录入。"}
                </div>
              ) : (
                <div
                  data-pmx-memory-hit-list=""
                  className="max-h-80 divide-y divide-border/50 overflow-y-auto rounded-lg bg-foreground/[0.025] pr-1 dark:bg-white/[0.03]"
                >
                  {memoryHits.map((hit) => {
                    const isEditing = editingId === hit.id;
                    const isConfirmingDelete = confirmDeleteId === hit.id;
                    const formattedTime = formatMemoryTimestamp(hit.updatedAt);
                    return (
                      <div
                        key={hit.id || `${hit.namespace}-${hit.title}`}
                        data-pmx-memory-hit-id={hit.id}
                        className="px-3 py-2.5 text-xs"
                      >
                        {isEditing ? (
                          <div data-pmx-memory-edit-form={hit.id} className="space-y-2">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Input
                                nativeInput
                                size="sm"
                                value={editTitle}
                                placeholder="标题"
                                onChange={(event) => setEditTitle(event.target.value)}
                              />
                              <Select
                                modal={false}
                                value={editKind}
                                onValueChange={(val) => {
                                  if (val) setEditKind(normalizeMemoryKind(val));
                                }}
                              >
                                <SelectTrigger size="sm">
                                  <SelectValue>
                                    {MEMORY_KIND_LABELS[editKind] ?? editKind}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectPopup alignItemWithTrigger={false}>
                                  {MEMORY_KIND_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectPopup>
                              </Select>
                            </div>
                            <textarea
                              rows={3}
                              value={editContent}
                              onChange={(event) => setEditContent(event.target.value)}
                              className="w-full resize-y rounded-md border border-border/80 bg-background/80 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/70"
                            />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Input
                                nativeInput
                                size="compact"
                                className="max-w-xs"
                                placeholder="标签（逗号分隔）"
                                value={editTags}
                                onChange={(event) => setEditTags(event.target.value)}
                              />
                              <div className="flex items-center gap-1.5">
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  disabled={savingEdit}
                                  onClick={() => setEditingId(null)}
                                >
                                  <XIcon className="size-3" />
                                  取消
                                </Button>
                                <Button
                                  type="button"
                                  size="xs"
                                  data-pmx-memory-edit-save={hit.id}
                                  disabled={savingEdit || editContent.trim().length === 0}
                                  onClick={() => {
                                    void handleSaveEdit(hit);
                                  }}
                                >
                                  <CheckIcon className="size-3" />
                                  {savingEdit ? "保存中…" : "保存修改"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-foreground">{hit.title}</span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="text-[10px]">
                                  {MEMORY_KIND_LABELS[hit.kind] ?? hit.kind}
                                </Badge>
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {hit.namespace}
                                </Badge>
                                {hit.score > 0 ? (
                                  <Badge variant="secondary" className="font-mono text-[10px]">
                                    {hit.score.toFixed(2)}
                                  </Badge>
                                ) : null}
                                {formattedTime ? (
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {formattedTime}
                                  </span>
                                ) : null}
                                {hit.id ? (
                                  <Button
                                    type="button"
                                    size="xs"
                                    variant="ghost"
                                    data-pmx-memory-edit-btn={hit.id}
                                    onClick={() => handleStartEdit(hit)}
                                    title="编辑此记忆条目"
                                  >
                                    <PencilIcon className="size-3" />
                                    编辑
                                  </Button>
                                ) : null}
                                {hit.id && !deleteUnsupported ? (
                                  isConfirmingDelete ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="destructive-outline"
                                        data-pmx-memory-delete-confirm={hit.id}
                                        disabled={deletingId === hit.id}
                                        onClick={() => {
                                          void handleDeleteMemory(hit);
                                        }}
                                      >
                                        {deletingId === hit.id ? "删除中…" : "确认删除"}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        disabled={deletingId === hit.id}
                                        onClick={() => setConfirmDeleteId(null)}
                                      >
                                        取消
                                      </Button>
                                    </span>
                                  ) : (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="ghost"
                                      data-pmx-memory-delete-btn={hit.id}
                                      onClick={() => setConfirmDeleteId(hit.id)}
                                      title="删除此记忆条目"
                                    >
                                      <Trash2Icon className="size-3" />
                                      删除
                                    </Button>
                                  )
                                ) : null}
                              </div>
                            </div>
                            <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                              {hit.content}
                            </p>
                            {hit.tags.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                {hit.tags.slice(0, 6).map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
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
          onCommitted={async () => {
            const stats = await loadMemoryStats();
            await executeSearchMemory({ statsOverride: stats, silentError: true });
          }}
          onError={onError}
          onStatus={onStatus}
        />
      ) : null}
    </SettingsSection>
  );
});
