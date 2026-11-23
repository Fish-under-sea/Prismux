import {
  FileTextIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
  UserCheckIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SettingsRow } from "../../components/settings/settingsLayout";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  DEFAULT_CHIEF_DISPLAY_NAME,
  isCustomChiefDisplayName,
  normalizeChiefDisplayName,
} from "../chiefMention";
import type {
  DaemonChiefAgentsMdResponse,
  DaemonChiefProfileUpdateResponse,
  PrismuxDaemonClient,
} from "../daemonClient";
import { emitChiefSlotUpdated } from "../PrismuxChiefStatusPill";

export interface ChiefIdentityAndAgentsMdSectionProps {
  readonly daemon: Pick<PrismuxDaemonClient, "requestJson">;
  readonly secretaryName: string;
  readonly agentsMdPath: string;
  readonly activeProvider: string;
  readonly activeProviderLabel: string;
  readonly activeModel: string;
  readonly activeEffort: string;
  readonly activeDialMode: "agent" | "oracle" | "review";
  readonly onIdentityUpdated?: (next: {
    readonly secretaryName: string;
    readonly agentsMdPath: string;
  }) => void;
  readonly onError?: (message: string) => void;
  readonly onStatus?: (message: string) => void;
}

export function ChiefIdentityAndAgentsMdSection({
  daemon,
  secretaryName,
  agentsMdPath,
  activeProvider,
  activeProviderLabel,
  activeModel,
  activeEffort,
  activeDialMode,
  onIdentityUpdated,
  onError,
  onStatus,
}: ChiefIdentityAndAgentsMdSectionProps) {
  const effectiveName = normalizeChiefDisplayName(secretaryName);
  const [nameInput, setNameInput] = useState(effectiveName);
  const [savingName, setSavingName] = useState(false);

  const [resolvedPath, setResolvedPath] = useState(
    agentsMdPath.trim() || "~/.prismux/chief/AGENTS.md",
  );
  const [mdContent, setMdContent] = useState("");
  const [savedMdContent, setSavedMdContent] = useState("");
  const [loadingMd, setLoadingMd] = useState(false);
  const [savingMd, setSavingMd] = useState(false);
  const [resettingMd, setResettingMd] = useState(false);
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  useEffect(() => {
    setNameInput(effectiveName);
  }, [effectiveName]);

  useEffect(() => {
    if (agentsMdPath.trim().length > 0) {
      setResolvedPath(agentsMdPath.trim());
    }
  }, [agentsMdPath]);

  const loadAgentsMd = useCallback(async () => {
    setLoadingMd(true);
    try {
      const res = await daemon.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md");
      if (typeof res?.path === "string" && res.path.trim().length > 0) {
        setResolvedPath(res.path.trim());
      }
      if (typeof res?.content === "string") {
        setMdContent(res.content);
        setSavedMdContent(res.content);
      }
    } catch {
      // Keep UI responsive when daemon is starting up or offline in unit tests.
    } finally {
      setLoadingMd(false);
    }
  }, [daemon]);

  useEffect(() => {
    void loadAgentsMd();
  }, [loadAgentsMd]);

  const handleSaveName = useCallback(
    async (explicitName?: string) => {
      const nextName = normalizeChiefDisplayName(
        explicitName !== undefined ? explicitName : nameInput,
      );
      setSavingName(true);
      setLocalNotice(null);
      try {
        const res = await daemon.requestJson<DaemonChiefProfileUpdateResponse>(
          "/v1/chief/profile",
          {
            method: "PUT",
            body: JSON.stringify({ secretaryName: nextName }),
          },
        );
        const finalName = normalizeChiefDisplayName(
          res?.secretaryName ?? res?.slot?.secretaryName ?? nextName,
        );
        const finalPath =
          (res?.agentsMdPath ?? res?.slot?.agentsMdPath ?? resolvedPath).trim() ||
          "~/.prismux/chief/AGENTS.md";
        setNameInput(finalName);
        setResolvedPath(finalPath);
        emitChiefSlotUpdated({
          provider: activeProvider,
          model: activeModel || null,
          reasoningEffort: activeEffort || null,
          dialMode: activeDialMode,
          secretaryName: finalName,
          agentsMdPath: finalPath,
        });
        onIdentityUpdated?.({
          secretaryName: finalName,
          agentsMdPath: finalPath,
        });
        const msg = `主秘书称呼已更新为「${finalName}」，已同步写入独立 AGENTS.md 身份头（切换底层引擎时保持不变）。`;
        setLocalNotice(msg);
        onStatus?.(msg);
        await loadAgentsMd();
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      } finally {
        setSavingName(false);
      }
    },
    [
      activeDialMode,
      activeEffort,
      activeModel,
      activeProvider,
      daemon,
      loadAgentsMd,
      nameInput,
      onError,
      onIdentityUpdated,
      onStatus,
      resolvedPath,
    ],
  );

  const handleSaveAgentsMd = useCallback(async () => {
    setSavingMd(true);
    setLocalNotice(null);
    try {
      const res = await daemon.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md", {
        method: "PUT",
        body: JSON.stringify({ content: mdContent }),
      });
      const persisted = typeof res?.content === "string" ? res.content : mdContent;
      setMdContent(persisted);
      setSavedMdContent(persisted);
      if (typeof res?.path === "string" && res.path.trim().length > 0) {
        setResolvedPath(res.path.trim());
      }
      const msg = `已保存独立主秘书指令文件（${res?.path ?? resolvedPath}），切换任意底层引擎均不会重置。`;
      setLocalNotice(msg);
      onStatus?.(msg);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingMd(false);
    }
  }, [daemon, mdContent, onError, onStatus, resolvedPath]);

  const handleResetAgentsMd = useCallback(async () => {
    setResettingMd(true);
    setLocalNotice(null);
    try {
      const res = await daemon.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md", {
        method: "PUT",
        body: JSON.stringify({ reset: true }),
      });
      const restored = typeof res?.content === "string" ? res.content : "";
      setMdContent(restored);
      setSavedMdContent(restored);
      const msg = `已将独立 AGENTS.md 恢复为默认模板（保留当前称呼「${effectiveName}」）。`;
      setLocalNotice(msg);
      onStatus?.(msg);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setResettingMd(false);
    }
  }, [daemon, effectiveName, onError, onStatus]);

  const previewName = normalizeChiefDisplayName(nameInput);
  const mdDirty = mdContent !== savedMdContent;

  return (
    <>
      <SettingsRow
        title={
          <span className="inline-flex items-center gap-1.5">
            <UserCheckIcon className="size-3.5 text-primary" />
            <span>主秘书称呼（自定义名称）</span>
            {isCustomChiefDisplayName(effectiveName) ? (
              <Badge variant="info" className="text-[10px]">
                {effectiveName}
              </Badge>
            ) : null}
          </span>
        }
        description={`支持中英文昵称（如「猫猫」「小棱」「Aria」）；在对话中喊「${previewName}」或 @${previewName} 即可直接唤起主秘书，切换底层引擎（当前：${activeProviderLabel}）后身份不变。`}
        control={
          <div
            data-pmx-chief-identity-controls=""
            className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto"
          >
            <Input
              nativeInput
              size="sm"
              data-pmx-chief-name-input=""
              className="w-full sm:w-44"
              maxLength={32}
              placeholder="主秘书 / 猫猫 / 小棱 / Aria"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleSaveName();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={savingName}
              onClick={() => {
                void handleSaveName();
              }}
            >
              <SaveIcon className="size-3.5" />
              {savingName ? "保存中…" : "保存称呼"}
            </Button>
            {isCustomChiefDisplayName(effectiveName) ||
            isCustomChiefDisplayName(nameInput) ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={savingName}
                onClick={() => {
                  void handleSaveName(DEFAULT_CHIEF_DISPLAY_NAME);
                }}
                title="恢复默认称呼「主秘书」"
              >
                <RotateCcwIcon className="size-3" />
                恢复默认
              </Button>
            ) : null}
          </div>
        }
      />

      <SettingsRow
        title={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <FileTextIcon className="size-3.5 text-primary" />
            <span>独立主秘书指令（AGENTS.md）</span>
            <Badge variant="success" className="gap-1 text-[10px]">
              <SparklesIcon className="size-2.5" />
              切换任意底层引擎不重置
            </Badge>
          </span>
        }
        description="主秘书拥有完全独立于底层 CLI 引擎的专属人格、称呼与工作纪律指令文件；无论把底层引擎切换为 Codex、Claude Code、Antigravity 还是 oh-my-pi，都会自动继承同一份规则。"
      >
        <div
          data-pmx-chief-agents-md-section=""
          className="mt-2.5 space-y-2.5 pb-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-1.5 text-[11px]">
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span className="shrink-0">文件路径：</span>
              <code
                data-pmx-chief-agents-md-path=""
                className="truncate font-mono text-foreground/90"
                title={resolvedPath}
              >
                {resolvedPath}
              </code>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {mdDirty ? (
                <Badge variant="warning" className="text-[10px]">
                  未保存修改
                </Badge>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={loadingMd}
                onClick={() => {
                  void loadAgentsMd();
                }}
              >
                <RefreshCwIcon className={loadingMd ? "size-3 animate-spin" : "size-3"} />
                重新读取
              </Button>
            </div>
          </div>

          <textarea
            data-pmx-chief-agents-md-editor=""
            aria-label="主秘书独立 AGENTS.md 指令编辑器"
            rows={9}
            spellCheck={false}
            value={mdContent}
            onChange={(event) => setMdContent(event.target.value)}
            placeholder="在此编写主秘书的专属人格、语气、汇报格式与长期工作纪律……（修改称呼时仅自动更新顶部受控身份块，不会覆盖正文）"
            className="w-full resize-y rounded-lg border border-border/80 bg-background/70 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/70 focus:ring-2 focus:ring-ring/40"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              提示：顶部受控身份块会在改名时自动刷新，正文内容始终保留；支持随时热切引擎零丢失。
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resettingMd || savingMd}
                onClick={() => {
                  void handleResetAgentsMd();
                }}
              >
                <RotateCcwIcon className="size-3.5" />
                {resettingMd ? "恢复中…" : "恢复默认模板"}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={savingMd || resettingMd || mdContent.trim().length === 0}
                onClick={() => {
                  void handleSaveAgentsMd();
                }}
              >
                <SaveIcon className="size-3.5" />
                {savingMd ? "保存中…" : "保存 AGENTS.md"}
              </Button>
            </div>
          </div>

          {localNotice ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/8 px-3 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
              {localNotice}
            </div>
          ) : null}
        </div>
      </SettingsRow>
    </>
  );
}
