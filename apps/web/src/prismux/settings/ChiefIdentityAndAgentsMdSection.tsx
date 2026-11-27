import {
  FileTextIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
  UserCheckIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { SETTINGS_CONTROL_MD, SettingsRow } from "../../components/settings/settingsLayout";
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
import { useResolveConfiguredProviderDisplayName } from "../providerDisplayName";

const CHIEF_IDENTITY_BEGIN_MARKER = "<!-- prismux:chief-identity:begin -->";
const CHIEF_IDENTITY_END_MARKER = "<!-- prismux:chief-identity:end -->";

/**
 * Splices only the daemon-managed Chief identity header block from `serverContent`
 * into an unsaved `dirtyContent` draft so renaming the Chief Secretary never discards
 * in-progress edits to the user's AGENTS.md instructions.
 */
export function mergeChiefIdentityHeaderIntoDirtyAgentsMd(
  dirtyContent: string,
  serverContent: string,
): string {
  const serverBegin = serverContent.indexOf(CHIEF_IDENTITY_BEGIN_MARKER);
  const serverEnd = serverContent.indexOf(CHIEF_IDENTITY_END_MARKER);
  if (serverBegin < 0 || serverEnd < serverBegin) {
    return dirtyContent;
  }
  const nextHeaderBlock = serverContent.slice(
    serverBegin,
    serverEnd + CHIEF_IDENTITY_END_MARKER.length,
  );
  const dirtyBegin = dirtyContent.indexOf(CHIEF_IDENTITY_BEGIN_MARKER);
  const dirtyEnd = dirtyContent.indexOf(CHIEF_IDENTITY_END_MARKER);
  if (dirtyBegin >= 0 && dirtyEnd >= dirtyBegin) {
    return (
      dirtyContent.slice(0, dirtyBegin) +
      nextHeaderBlock +
      dirtyContent.slice(dirtyEnd + CHIEF_IDENTITY_END_MARKER.length)
    );
  }
  return `${nextHeaderBlock}\n\n${dirtyContent.trimStart()}`;
}

export interface ActiveChiefSlotSnapshot {
  readonly provider: string;
  readonly providerLabel: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly dialMode: "agent" | "oracle" | "review";
}

export interface ChiefIdentityAndAgentsMdSectionProps {
  readonly daemon: Pick<PrismuxDaemonClient, "requestJson">;
  readonly secretaryName: string;
  readonly agentsMdPath: string;
  readonly activeProvider: string;
  readonly activeProviderLabel: string;
  readonly activeModel: string;
  readonly activeEffort: string;
  readonly activeDialMode: "agent" | "oracle" | "review";
  /** Optional ref tracking uncommitted Chief slot drafts so switching Provider/Model never re-renders AGENTS.md. */
  readonly activeSlotRef?: RefObject<ActiveChiefSlotSnapshot> | undefined;
  /** Optional render observer used by unit tests to verify strict memo isolation. */
  readonly onRender?: (() => void) | undefined;
  readonly onIdentityUpdated?:
    | ((next: { readonly secretaryName: string; readonly agentsMdPath: string }) => void)
    | undefined;
  readonly onError?: ((message: string) => void) | undefined;
  readonly onStatus?: ((message: string) => void) | undefined;
}

export const ChiefIdentityAndAgentsMdSection = memo(function ChiefIdentityAndAgentsMdSection({
  daemon,
  secretaryName,
  agentsMdPath,
  activeProvider,
  activeProviderLabel,
  activeModel,
  activeEffort,
  activeDialMode,
  activeSlotRef: _activeSlotRef,
  onRender,
  onIdentityUpdated,
  onError,
  onStatus,
}: ChiefIdentityAndAgentsMdSectionProps) {
  onRender?.();
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
  const [localError, setLocalError] = useState<string | null>(null);

  const mdContentRef = useRef(mdContent);
  mdContentRef.current = mdContent;
  const savedMdContentRef = useRef(savedMdContent);
  savedMdContentRef.current = savedMdContent;
  const mdRequestSeqRef = useRef(0);

  useEffect(() => {
    setNameInput(effectiveName);
  }, [effectiveName]);

  useEffect(() => {
    if (agentsMdPath.trim().length > 0) {
      setResolvedPath(agentsMdPath.trim());
    }
  }, [agentsMdPath]);

  const loadAgentsMd = useCallback(
    async (options?: { readonly preserveDirtyDraft?: boolean; readonly reportError?: boolean }) => {
      const requestSeq = ++mdRequestSeqRef.current;
      setLoadingMd(true);
      if (options?.reportError) {
        setLocalError(null);
      }
      try {
        const res = await daemon.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md");
        if (requestSeq !== mdRequestSeqRef.current) {
          return;
        }
        if (typeof res?.path === "string" && res.path.trim().length > 0) {
          setResolvedPath(res.path.trim());
        }
        if (typeof res?.content === "string") {
          const isDirty = mdContentRef.current !== savedMdContentRef.current;
          setSavedMdContent(res.content);
          if (options?.preserveDirtyDraft && isDirty) {
            setMdContent(
              mergeChiefIdentityHeaderIntoDirtyAgentsMd(mdContentRef.current, res.content),
            );
          } else {
            setMdContent(res.content);
          }
          setLocalError(null);
        }
      } catch (err) {
        if (requestSeq !== mdRequestSeqRef.current) {
          return;
        }
        if (options?.reportError) {
          const message = err instanceof Error ? err.message : String(err);
          setLocalError(`重新读取 AGENTS.md 失败：${message}`);
          onError?.(message);
        }
      } finally {
        if (requestSeq === mdRequestSeqRef.current) {
          setLoadingMd(false);
        }
      }
    },
    [daemon, onError],
  );

  useEffect(() => {
    void loadAgentsMd({ reportError: false });
  }, [loadAgentsMd]);

  const handleSaveName = useCallback(
    async (explicitName?: string) => {
      const nextName = normalizeChiefDisplayName(
        explicitName !== undefined ? explicitName : nameInput,
      );
      setSavingName(true);
      setLocalNotice(null);
      setLocalError(null);
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
        // Broadcast only the committed Chief slot (never uncommitted dropdown drafts) so topbar stays truthful.
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
        const hadDirtyAgentsMd = mdContentRef.current !== savedMdContentRef.current;
        const msg = hadDirtyAgentsMd
          ? `主秘书称呼已更新为「${finalName}」，顶部身份头已同步且未保存正文已保留。`
          : `主秘书称呼已更新为「${finalName}」，切换底层引擎时保持不变。`;
        setLocalNotice(msg);
        onStatus?.(msg);
        await loadAgentsMd({ preserveDirtyDraft: true, reportError: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLocalError(message);
        onError?.(message);
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
    const requestSeq = ++mdRequestSeqRef.current;
    setSavingMd(true);
    setLocalNotice(null);
    setLocalError(null);
    try {
      const res = await daemon.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md", {
        method: "PUT",
        body: JSON.stringify({ content: mdContent }),
      });
      if (requestSeq !== mdRequestSeqRef.current) {
        return;
      }
      const persisted = typeof res?.content === "string" ? res.content : mdContent;
      setMdContent(persisted);
      setSavedMdContent(persisted);
      if (typeof res?.path === "string" && res.path.trim().length > 0) {
        setResolvedPath(res.path.trim());
      }
      const msg = "主秘书指令已保存，切换底层引擎时自动沿用。";
      setLocalNotice(msg);
      onStatus?.(msg);
    } catch (err) {
      if (requestSeq !== mdRequestSeqRef.current) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setLocalError(message);
      onError?.(message);
    } finally {
      if (requestSeq === mdRequestSeqRef.current) {
        setSavingMd(false);
      }
    }
  }, [daemon, mdContent, onError, onStatus]);

  const handleResetAgentsMd = useCallback(async () => {
    const requestSeq = ++mdRequestSeqRef.current;
    setResettingMd(true);
    setLocalNotice(null);
    setLocalError(null);
    try {
      const res = await daemon.requestJson<DaemonChiefAgentsMdResponse>("/v1/chief/agents-md", {
        method: "PUT",
        body: JSON.stringify({ reset: true }),
      });
      if (requestSeq !== mdRequestSeqRef.current) {
        return;
      }
      const restored = typeof res?.content === "string" ? res.content : "";
      setMdContent(restored);
      setSavedMdContent(restored);
      if (typeof res?.path === "string" && res.path.trim().length > 0) {
        setResolvedPath(res.path.trim());
      }
      const restoredName = normalizeChiefDisplayName(res?.secretaryName ?? effectiveName);
      const msg = `已恢复默认指令模板并保留称呼「${restoredName}」。`;
      setLocalNotice(msg);
      onStatus?.(msg);
    } catch (err) {
      if (requestSeq !== mdRequestSeqRef.current) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setLocalError(message);
      onError?.(message);
    } finally {
      if (requestSeq === mdRequestSeqRef.current) {
        setResettingMd(false);
      }
    }
  }, [daemon, effectiveName, onError, onStatus]);

  const previewName = normalizeChiefDisplayName(nameInput);
  const mdDirty = mdContent !== savedMdContent;
  const { resolveName } = useResolveConfiguredProviderDisplayName();
  const chiefEngineListLabel = `${resolveName("codex")}、${resolveName("claudeAgent")}、${resolveName("antigravity")} 或 ${resolveName("dsh")}`;

  return (
    <>
      <SettingsRow
        id="chief-identity"
        title={
          <span className="inline-flex items-center gap-1.5">
            <UserCheckIcon className="size-3.5 text-primary" />
            <span>主秘书称呼</span>
            {isCustomChiefDisplayName(effectiveName) ? (
              <Badge variant="info" className="text-[10px]">
                {effectiveName}
              </Badge>
            ) : null}
          </span>
        }
        description={`对话中提及「${previewName}」或 @${previewName} 即可唤起，切换底层引擎（当前：${activeProviderLabel}）后保持不变。`}
        control={
          <div
            data-pmx-chief-identity-controls=""
            className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto"
          >
            <Input
              nativeInput
              size="sm"
              data-pmx-chief-name-input=""
              className={`${SETTINGS_CONTROL_MD} max-w-full`}
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
            {isCustomChiefDisplayName(effectiveName) || isCustomChiefDisplayName(nameInput) ? (
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
        id="chief-agents-md"
        title={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <FileTextIcon className="size-3.5 text-primary" />
            <span>主秘书人设与指令（AGENTS.md）</span>
            <Badge variant="success" className="gap-1 text-[10px]">
              <SparklesIcon className="size-2.5" />
              切换任意底层引擎不重置
            </Badge>
          </span>
        }
        description={`独立于底层引擎的专属人设与工作纪律，切换为 ${chiefEngineListLabel} 均自动沿用。`}
      >
        <div data-pmx-chief-agents-md-section="" className="mt-2.5 space-y-2.5 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">文件：</span>
              <code
                data-pmx-chief-agents-md-path=""
                className="truncate font-mono text-foreground/85"
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
                  void loadAgentsMd({ reportError: true });
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
            placeholder="在此编写主秘书的人设、语气、汇报格式与长期工作纪律……"
            className="w-full resize-y rounded-lg border border-border/80 bg-background/70 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/70 focus:ring-2 focus:ring-ring/40"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              修改称呼时仅自动更新顶部身份块，正文内容始终保留。
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

          {localError ? (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
            >
              {localError}
            </div>
          ) : null}

          {localNotice ? (
            <div className="rounded-md bg-emerald-500/10 px-3 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
              {localNotice}
            </div>
          ) : null}
        </div>
      </SettingsRow>
    </>
  );
});
