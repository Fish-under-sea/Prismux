import {
  CheckCircle2Icon,
  CheckSquareIcon,
  FolderOpenIcon,
  ShieldAlertIcon,
  SparklesIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { SettingsRow } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { normalizeChiefDisplayName } from "../chiefMention";
import type {
  DaemonObsidianCuratedItemDto,
  DaemonObsidianCuratedKind,
  DaemonObsidianImportCommitResponse,
  DaemonObsidianImportPlanResponse,
  PrismuxDaemonClient,
} from "../daemonClient";

export interface ObsidianAgentImportCardProps {
  readonly daemon: Pick<PrismuxDaemonClient, "requestJson">;
  readonly secretaryName: string;
  readonly activeProvider: string;
  readonly activeProviderLabel: string;
  readonly activeModel: string;
  readonly onCommitted?: () => void | Promise<void>;
  readonly onError?: (message: string) => void;
  readonly onStatus?: (message: string) => void;
}

const CURATED_KIND_META: Readonly<
  Record<
    DaemonObsidianCuratedKind,
    { readonly label: string; readonly variant: "info" | "success" | "warning" | "secondary" | "outline" }
  >
> = {
  preference: { label: "个人偏好", variant: "info" },
  decision: { label: "架构决策", variant: "warning" },
  project: { label: "项目脉络", variant: "success" },
  experience: { label: "经验踩坑", variant: "secondary" },
  knowledge: { label: "知识事实", variant: "outline" },
};

export function ObsidianAgentImportCard({
  daemon,
  secretaryName,
  activeProvider,
  activeProviderLabel,
  activeModel,
  onCommitted,
  onError,
  onStatus,
}: ObsidianAgentImportCardProps) {
  const effectiveSecretaryName = normalizeChiefDisplayName(secretaryName);
  const [vaultPath, setVaultPath] = useState("");
  const [namespace, setNamespace] = useState("private/chief");
  const [useAgentCuration, setUseAgentCuration] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [plan, setPlan] = useState<DaemonObsidianImportPlanResponse | null>(null);
  const [items, setItems] = useState<DaemonObsidianCuratedItemDto[]>([]);
  const [commitReport, setCommitReport] = useState<string | null>(null);

  const selectedCount = useMemo(
    () => items.filter((item) => item.selected).length,
    [items],
  );

  const handlePickFolder = useCallback(async () => {
    const bridge = window.desktopBridge;
    const picked =
      (await bridge?.pickFolder?.()) ??
      (await bridge?.prismux?.pickWallpaperDirectory?.()) ??
      null;
    if (picked) {
      setVaultPath(picked);
    }
  }, []);

  const handleRunPlan = useCallback(async () => {
    const trimmedVault = vaultPath.trim();
    if (!trimmedVault) {
      onError?.("请先输入或选择本地 Obsidian Vault 目录路径。");
      return;
    }
    setPlanning(true);
    setCommitReport(null);
    try {
      const trimmedNs = namespace.trim() || "private/chief";
      const res = await daemon.requestJson<DaemonObsidianImportPlanResponse>(
        "/v1/memory/import-obsidian/plan",
        {
          method: "POST",
          body: JSON.stringify({
            vaultPath: trimmedVault,
            namespace: trimmedNs,
            useAgentCuration,
            provider: activeProvider,
            ...(activeModel.trim().length > 0 ? { model: activeModel.trim() } : {}),
          }),
        },
      );
      setPlan(res);
      setItems(Array.isArray(res?.items) ? res.items : []);
      const modeText =
        res.curationSource === "agent"
          ? `主秘书 Agent（${res.curatorLabel ?? `${effectiveSecretaryName} · ${activeProviderLabel}`}）智能提炼`
          : "本地结构化整理（安全回退）";
      onStatus?.(
        `已完成 ${modeText}：扫描 ${res.stats.scannedFiles} 篇笔记，提炼 ${res.items.length} 条候选记忆，请审核勾选后写入记忆库。`,
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  }, [
    activeModel,
    activeProvider,
    activeProviderLabel,
    daemon,
    effectiveSecretaryName,
    namespace,
    onError,
    onStatus,
    useAgentCuration,
    vaultPath,
  ]);

  const handleToggleItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    setItems((prev) => prev.map((item) => ({ ...item, selected: true })));
  }, []);

  const handleInvertSelection = useCallback(() => {
    setItems((prev) => prev.map((item) => ({ ...item, selected: !item.selected })));
  }, []);

  const handleCommit = useCallback(async () => {
    if (selectedCount === 0) {
      onError?.("请至少勾选 1 条候选记忆再写入单文件记忆库。");
      return;
    }
    setCommitting(true);
    try {
      const res = await daemon.requestJson<DaemonObsidianImportCommitResponse>(
        "/v1/memory/import-obsidian/commit",
        {
          method: "POST",
          body: JSON.stringify({
            items,
            namespace: namespace.trim() || "private/chief",
          }),
        },
      );
      const summary = `已写入 ${res.committedCount} 条结构化记忆至 ${res.namespace}（跳过未勾选 ${res.skippedCount} 条）。`;
      setCommitReport(summary);
      onStatus?.(summary);
      await onCommitted?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }, [daemon, items, namespace, onCommitted, onError, onStatus, selectedCount]);

  return (
    <SettingsRow
      title={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <SparklesIcon className="size-3.5 text-primary" />
          <span>Obsidian Vault 智能迁移（Agent 整理后审校入库）</span>
        </span>
      }
      description="先由主秘书按「一条一事实」原则筛选、去重、脱敏并分类提炼结构化记忆，再由你勾选审核确认后写入单文件 SQLite 记忆库，避免整库散乱 Markdown 污染长期记忆。"
    >
      <div data-pmx-obsidian-agent-import="" className="mt-2.5 space-y-3 pb-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            nativeInput
            size="sm"
            data-pmx-obsidian-vault-input=""
            className="flex-1 font-mono"
            placeholder="例如：D:\Notes\ObsidianVault"
            value={vaultPath}
            onChange={(event) => setVaultPath(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void handlePickFolder();
            }}
          >
            <FolderOpenIcon className="size-3.5" />
            浏览目录
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-border/70 bg-background/50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <label
              data-pmx-obsidian-agent-toggle=""
              className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground"
            >
              <Switch
                size="sm"
                checked={useAgentCuration}
                onCheckedChange={(checked) => setUseAgentCuration(Boolean(checked))}
              />
              <span>由主秘书 Agent 智能整理后再入库（推荐）</span>
            </label>
            <Badge variant="outline" className="text-[10.5px]">
              当前整理员：{effectiveSecretaryName} · {activeProviderLabel}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>目标命名空间</span>
            <Input
              nativeInput
              size="compact"
              className="w-36 font-mono"
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            自动跳过 .obsidian / .trash 与空白模板，并提前脱敏 Token / API Key；运行时不依赖本地 Obsidian 客户端。
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-pmx-obsidian-plan-button=""
            disabled={planning || committing || vaultPath.trim().length === 0}
            onClick={() => {
              void handleRunPlan();
            }}
          >
            <SparklesIcon className={planning ? "size-3.5 animate-pulse" : "size-3.5"} />
            {planning
              ? "正在智能扫描与整理…"
              : useAgentCuration
                ? "Agent 智能扫描与整理"
                : "本地结构化扫描预览"}
          </Button>
        </div>

        {plan ? (
          <div
            data-pmx-obsidian-plan-review=""
            className="space-y-2.5 rounded-xl border border-border/80 bg-card/60 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge
                  variant={plan.curationSource === "agent" ? "success" : "secondary"}
                  className="text-[10.5px]"
                >
                  {plan.curationSource === "agent"
                    ? `Agent 智能提炼 · ${plan.curatorLabel ?? effectiveSecretaryName}`
                    : "本地结构化提炼（安全回退）"}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10.5px] tabular-nums">
                  扫描 {plan.stats.scannedFiles} 篇
                </Badge>
                <Badge variant="outline" className="font-mono text-[10.5px] tabular-nums">
                  提炼 {items.length} 条
                </Badge>
                {plan.stats.dedupedCount > 0 ? (
                  <Badge variant="outline" className="font-mono text-[10.5px] tabular-nums">
                    去重 {plan.stats.dedupedCount}
                  </Badge>
                ) : null}
                {plan.stats.filteredNoiseCount > 0 ? (
                  <Badge variant="outline" className="font-mono text-[10.5px] tabular-nums">
                    过滤空模板 {plan.stats.filteredNoiseCount}
                  </Badge>
                ) : null}
                {plan.stats.redactedSecretCount > 0 ? (
                  <Badge variant="warning" className="gap-1 font-mono text-[10.5px] tabular-nums">
                    <ShieldAlertIcon className="size-3" />
                    已脱敏凭据 {plan.stats.redactedSecretCount}
                  </Badge>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={handleSelectAll}
                  disabled={items.length === 0}
                >
                  全选
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={handleInvertSelection}
                  disabled={items.length === 0}
                >
                  反选
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setPlan(null);
                    setItems([]);
                  }}
                >
                  <Trash2Icon className="size-3" />
                  清空
                </Button>
              </div>
            </div>

            {plan.curationSource === "structured-fallback" && plan.fallbackReason ? (
              <div className="rounded-md border border-border/60 bg-background/50 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                说明：{plan.fallbackReason}
              </div>
            ) : null}

            {items.length === 0 ? (
              <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-3 text-center text-xs text-muted-foreground">
                未发现可入库的有效记忆条目（所有文件均为空白模板或已被去重过滤）。
              </div>
            ) : (
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {items.map((item) => {
                  const kindMeta = CURATED_KIND_META[item.kind] ?? CURATED_KIND_META.knowledge;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleToggleItem(item.id)}
                      className={
                        item.selected
                          ? "flex w-full items-start gap-2.5 rounded-lg border border-primary/45 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/8"
                          : "flex w-full items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-left opacity-70 transition-colors hover:opacity-100"
                      }
                    >
                      <span className="mt-0.5 shrink-0 text-primary">
                        {item.selected ? (
                          <CheckSquareIcon className="size-4" />
                        ) : (
                          <SquareIcon className="size-4 text-muted-foreground" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="text-xs font-medium text-foreground">
                            {item.title}
                          </span>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant={kindMeta.variant} className="text-[10px]">
                              {kindMeta.label}
                            </Badge>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {item.namespace}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          {item.summary}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/85">
                          <span className="font-mono">来源：{item.sourceFile}</span>
                          {item.tags.slice(0, 5).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[9.5px]"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
              <span className="text-[11px] text-muted-foreground">
                已勾选 <strong className="text-foreground">{selectedCount}</strong> / {items.length}{" "}
                条候选记忆；仅勾选条目会被写入单文件 SQLite 记忆库。
              </span>
              <Button
                type="button"
                size="sm"
                data-pmx-obsidian-commit-button=""
                disabled={committing || selectedCount === 0}
                onClick={() => {
                  void handleCommit();
                }}
              >
                <UploadIcon className="size-3.5" />
                {committing
                  ? "正在写入记忆库…"
                  : `确认写入记忆库 (${selectedCount} 条)`}
              </Button>
            </div>
          </div>
        ) : null}

        {commitReport ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2Icon className="size-3.5 shrink-0" />
            <span>{commitReport}</span>
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}
