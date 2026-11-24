import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_MODEL,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ProjectId,
  type ProviderInstanceId,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  Loader2Icon,
  MessageSquareIcon,
  SendHorizontalIcon,
  XIcon,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { cn, newMessageId, newThreadId } from "~/lib/utils";
import { useComposerDraftStore } from "../../composerDraftStore";
import { ComposerHandleContext } from "../../composerHandleContext";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import type { SideChatParentPanel } from "../../lib/sideChatPane";
import {
  AgentBrandLogo,
  formatAgentBrandName,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
} from "../../prismux/agentBrand";
import {
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import {
  useRightPanelStore,
  type AgentSessionSurface,
} from "../../rightPanelStore";
import {
  useProjects,
  useVisibleThreadShells,
  waitForThreadShell,
} from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../../types";
import { BackgroundThreadContext } from "../chat/backgroundThread";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import type { ModelEsque } from "../chat/providerIconUtils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const ChatView = lazy(() => import("../ChatView"));

export interface RightPanelAgentSessionPaneProps {
  /** Host thread that owns the right panel (null when hosted in standalone fallback drawer). */
  readonly hostThreadRef: ScopedThreadRef | null;
  readonly surface: AgentSessionSurface;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly sideChatParentPanel: SideChatParentPanel | null;
  readonly onUpdateSurface: (
    patch: Partial<Omit<AgentSessionSurface, "id" | "kind">>,
  ) => void;
  readonly onClose: () => void;
}

/**
 * Interactive multi-agent session surface hosted smoothly inside the Right Panel
 * (sharing `rightSidebar` liquid glass, resize handle, and concave stage corners).
 * Starts as a sleek real interactive composer + model picker + recent threads list,
 * creates a real T3 thread in-place on first send without disrupting the main pane,
 * and supports one-click promotion to the main workspace window.
 */
export const RightPanelAgentSessionPane = memo(function RightPanelAgentSessionPane(
  props: RightPanelAgentSessionPaneProps,
) {
  const {
    hostThreadRef,
    surface,
    activeProjectRef,
    sideChatParentPanel,
    onUpdateSurface,
    onClose,
  } = props;

  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const visibleThreads = useVisibleThreadShells();
  const environmentServerConfigs = useAtomValue(environmentServerConfigsAtom);
  const { defaultProjectRef, handleNewThread } = useHandleNewThread();
  const { scratchEnvironmentId, openScratchProject, startScratchThread } = useScratchProject();
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rawTitleTrimmed = surface.title?.trim() ?? "";
  const sanitizedSurfaceTitle =
    rawTitleTrimmed.length > 0 &&
    !["新会话", "会话", "新标签页", "new thread", "new session", "new chat"].includes(
      rawTitleTrimmed.toLowerCase(),
    )
      ? rawTitleTrimmed
      : undefined;
  const fallbackBrandName = formatAgentBrandName(
    surface.providerId || sanitizedSurfaceTitle || "codex",
    sanitizedSurfaceTitle,
  );

  const resolvedEnvironmentId: EnvironmentId | null =
    surface.environmentId ??
    activeProjectRef?.environmentId ??
    hostThreadRef?.environmentId ??
    defaultProjectRef?.environmentId ??
    primaryEnvironmentId ??
    null;

  const resolvedProjectId: ProjectId | null =
    activeProjectRef?.projectId ?? defaultProjectRef?.projectId ?? null;

  const { instanceEntries, modelOptionsByInstance } = useMemo(() => {
    const serverConfig = resolvedEnvironmentId
      ? environmentServerConfigs.get(resolvedEnvironmentId)
      : [...environmentServerConfigs.values()][0];
    const providers = serverConfig?.providers ?? [];
    const settings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
    const entries: ReadonlyArray<ProviderInstanceEntry> = providerInstanceEntriesFor(
      providers,
      settings,
      resolvedProjectId,
    );
    const optionsMap = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>();
    for (const entry of entries) {
      optionsMap.set(entry.instanceId, entry.models);
    }
    return { instanceEntries: entries, modelOptionsByInstance: optionsMap };
  }, [environmentServerConfigs, resolvedEnvironmentId, resolvedProjectId]);

  const matchedEntry = useMemo(() => {
    if (surface.instanceId) {
      const exact = instanceEntries.find((entry) => entry.instanceId === surface.instanceId);
      if (exact) return exact;
    }
    const targetName = fallbackBrandName.toLowerCase();
    return (
      instanceEntries.find(
        (entry) =>
          entry.enabled &&
          resolveProviderEntryDisplayName(entry).toLowerCase() === targetName,
      ) ??
      instanceEntries.find((entry) => entry.enabled) ??
      instanceEntries[0] ??
      null
    );
  }, [fallbackBrandName, instanceEntries, surface.instanceId]);

  const brandName = matchedEntry
    ? resolveProviderEntryDisplayName(matchedEntry)
    : fallbackBrandName;

  const activeInstanceId = matchedEntry?.instanceId ?? null;
  const activeModel =
    surface.model ??
    matchedEntry?.models.find((m) => m.isDefault && !m.isCustom)?.slug ??
    matchedEntry?.models[0]?.slug ??
    DEFAULT_MODEL;

  const relatedThreads = useMemo(() => {
    const targetBrandId = resolveAgentBrandId(
      matchedEntry?.driverKind ?? surface.providerId ?? brandName,
    );
    const targetLower = brandName.toLowerCase();
    return [...visibleThreads]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .filter((thread) => {
        if (
          hostThreadRef &&
          thread.environmentId === hostThreadRef.environmentId &&
          thread.id === hostThreadRef.threadId
        ) {
          return false;
        }
        const instanceId = thread.modelSelection?.instanceId ?? null;
        if (!instanceId) return false;
        if (matchedEntry && instanceId === matchedEntry.instanceId) return true;
        const entry = instanceEntries.find((candidate) => candidate.instanceId === instanceId);
        if (targetBrandId !== "custom") {
          return resolveAgentBrandId(entry?.driverKind ?? instanceId) === targetBrandId;
        }
        const label = entry
          ? resolveProviderEntryDisplayName(entry)
          : formatAgentBrandName(instanceId);
        return label.toLowerCase() === targetLower;
      })
      .slice(0, 3);
  }, [brandName, hostThreadRef, instanceEntries, matchedEntry, surface.providerId, visibleThreads]);

  const resolveProjectRefForCreation = async (): Promise<ScopedProjectRef | null> => {
    const firstOpen = projects.find((project) => project.archivedAt == null);
    const direct =
      activeProjectRef ??
      defaultProjectRef ??
      (firstOpen ? scopeProjectRef(firstOpen.environmentId, firstOpen.id) : null);
    if (direct) return direct;
    const scratchEnv = scratchEnvironmentId(resolvedEnvironmentId);
    if (!scratchEnv) return null;
    const scratchProject = await openScratchProject(scratchEnv);
    return scratchProject ? scopeProjectRef(scratchProject.environmentId, scratchProject.id) : null;
  };

  const handlePromoteToMain = async () => {
    if (surface.environmentId && surface.threadId) {
      const targetRef = scopeThreadRef(surface.environmentId, surface.threadId);
      onClose();
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(targetRef),
      });
      return;
    }

    const trimmedDraft = prompt.trim();
    const projectRef = await resolveProjectRefForCreation();
    if (projectRef) {
      const opened = await handleNewThread(projectRef, {
        ...(trimmedDraft ? { prompt: trimmedDraft } : {}),
      });
      if (opened && activeInstanceId && activeModel) {
        useComposerDraftStore
          .getState()
          .setModelSelection(
            opened.draftId,
            { instanceId: activeInstanceId, model: activeModel },
            { replaceOptions: true },
          );
      }
      onClose();
      return;
    }

    const scratchEnv = scratchEnvironmentId(resolvedEnvironmentId);
    if (scratchEnv) {
      await startScratchThread(scratchEnv);
      onClose();
    }
  };

  const handleSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;
    setErrorMessage(null);
    setSending(true);
    try {
      const projectRef = await resolveProjectRefForCreation();
      if (!projectRef || !activeInstanceId) {
        await handlePromoteToMain();
        return;
      }

      const targetThreadId = newThreadId();
      const createdAt = new Date().toISOString();
      const title = trimmed.length > 44 ? `${trimmed.slice(0, 44)}…` : trimmed;
      const modelSelection = createModelSelection(activeInstanceId, activeModel || DEFAULT_MODEL);

      const result = await startThreadTurn({
        environmentId: projectRef.environmentId,
        input: {
          threadId: targetThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: trimmed,
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: DEFAULT_INTERACTION_MODE,
          bootstrap: {
            createThread: {
              projectId: projectRef.projectId,
              title,
              modelSelection,
              runtimeMode: DEFAULT_RUNTIME_MODE,
              interactionMode: DEFAULT_INTERACTION_MODE,
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });

      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const err = squashAtomCommandFailure(result);
          setErrorMessage(err instanceof Error ? err.message : "启动会话失败，请稍后重试。");
        }
        return;
      }

      const targetRef = scopeThreadRef(projectRef.environmentId, targetThreadId);
      await waitForThreadShell(targetRef).catch(() => false);
      setPrompt("");
      onUpdateSurface({
        title,
        environmentId: projectRef.environmentId,
        threadId: targetThreadId,
        instanceId: activeInstanceId,
        model: activeModel,
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const embeddedParentPanel: SideChatParentPanel | null = useMemo(() => {
    if (sideChatParentPanel) return sideChatParentPanel;
    const fallbackRef =
      hostThreadRef ??
      (surface.environmentId && surface.threadId
        ? scopeThreadRef(surface.environmentId, surface.threadId)
        : null);
    if (!fallbackRef) return null;
    return {
      hostRef: fallbackRef,
      openToolDiff: () => {
        useRightPanelStore.getState().open(fallbackRef, "diff");
      },
      runShellCommand: () => {
        useRightPanelStore.getState().openTerminal(fallbackRef, "default");
      },
    };
  }, [hostThreadRef, sideChatParentPanel, surface.environmentId, surface.threadId]);

  const hasBoundServerThread = Boolean(
    surface.environmentId && surface.threadId && embeddedParentPanel,
  );

  return (
    <div
      data-right-panel-agent-session={surface.id}
      data-right-panel-agent-provider={surface.providerId}
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-transparent"
    >
      {/* Compact Right-Sidebar Session Action Strip */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <AgentBrandLogo provider={surface.providerId || brandName} size={13} className="shrink-0" />
          <span className="truncate text-xs font-medium text-foreground">{surface.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  data-right-panel-promote-main="1"
                  aria-label="转为主窗口"
                  onClick={() => void handlePromoteToMain()}
                  className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ArrowUpRightIcon className="size-3" aria-hidden />
                  <span>转为主窗口</span>
                </Button>
              }
            />
            <TooltipPopup side="bottom">将此会话移入主窗口打开</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  data-right-panel-agent-close="1"
                  aria-label="关闭右侧会话"
                  onClick={onClose}
                  className="size-6 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-3.5" aria-hidden />
                </Button>
              }
            />
            <TooltipPopup side="bottom">关闭</TooltipPopup>
          </Tooltip>
        </div>
      </div>

      {hasBoundServerThread && surface.environmentId && surface.threadId && embeddedParentPanel ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <BackgroundThreadContext value>
            <ComposerHandleContext value={null}>
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                    <span>正在加载会话…</span>
                  </div>
                }
              >
                <ChatView
                  key={`${surface.environmentId}:${surface.threadId}`}
                  environmentId={surface.environmentId}
                  threadId={surface.threadId}
                  routeKind="server"
                  embedded={embeddedParentPanel}
                />
              </Suspense>
            </ComposerHandleContext>
          </BackgroundThreadContext>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-between overflow-y-auto px-3.5 py-4">
          {/* Upper breathing header + optional recent threads */}
          <div className="my-auto flex flex-col items-center gap-4 py-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl border border-border/60 bg-muted/35 [[data-pmx-glass='1']_&]:border-white/20 [[data-pmx-glass='1']_&]:bg-white/10">
                <AgentBrandLogo provider={surface.providerId || brandName} size={22} />
              </div>
              <div className="space-y-0.5">
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                  与 {brandName} 开始并行会话
                </h3>
                <p className="text-[11.5px] text-muted-foreground">
                  直接在右侧边栏提问或协作，随时可转为主窗口
                </p>
              </div>
            </div>

            {relatedThreads.length > 0 ? (
              <div className="flex w-full flex-col gap-1">
                <div className="px-1 text-[10.5px] font-medium text-muted-foreground/85">
                  或在此处继续 {brandName} 最近会话
                </div>
                {relatedThreads.map((thread) => (
                  <button
                    key={`${thread.environmentId}:${thread.id}`}
                    type="button"
                    onClick={() =>
                      onUpdateSurface({
                        title: thread.title || brandName,
                        environmentId: thread.environmentId,
                        threadId: thread.id,
                      })
                    }
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border/55 bg-muted/20 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [[data-pmx-glass='1']_&]:border-white/15 [[data-pmx-glass='1']_&]:bg-white/[0.06] [[data-pmx-glass='1']_&]:hover:bg-white/[0.12]"
                  >
                    <MessageSquareIcon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{thread.title || "未命名会话"}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Bottom-docked real interactive composer card */}
          <div className="flex shrink-0 flex-col gap-1.5 pt-2">
            {errorMessage ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive"
              >
                {errorMessage}
              </div>
            ) : null}
            <div
              data-pmx-glass-zone="composer"
              className="flex w-full flex-col gap-2 rounded-xl border border-border/70 bg-card/80 p-2.5 shadow-xs"
            >
              <textarea
                rows={3}
                value={prompt}
                disabled={sending}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`向 ${brandName} 提问或下发并行任务…`}
                aria-label={`向 ${brandName} 发送消息`}
                data-right-panel-agent-input="1"
                className="w-full resize-none bg-transparent text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/75"
              />
              <div className="flex items-center justify-between gap-2 pt-0.5">
                <div className="min-w-0">
                  {activeInstanceId && instanceEntries.length > 0 ? (
                    <ProviderModelPicker
                      environmentId={resolvedEnvironmentId}
                      activeInstanceId={activeInstanceId}
                      model={activeModel}
                      lockedProvider={null}
                      instanceEntries={instanceEntries}
                      modelOptionsByInstance={modelOptionsByInstance}
                      scopeToActiveAgent
                      isComposerOwned
                      size="sm"
                      onInstanceModelChange={(nextInstanceId, nextModel) => {
                        const nextEntry = instanceEntries.find(
                          (entry) => entry.instanceId === nextInstanceId,
                        );
                        const nextBrand = nextEntry
                          ? resolveProviderEntryDisplayName(nextEntry)
                          : brandName;
                        onUpdateSurface({
                          instanceId: nextInstanceId,
                          providerId: nextEntry?.driverKind ?? surface.providerId,
                          model: nextModel,
                          title: nextBrand,
                        });
                      }}
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <AgentBrandLogo provider={surface.providerId || brandName} size={12} />
                      {brandName}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  size="xs"
                  disabled={sending || prompt.trim().length === 0}
                  onClick={() => void handleSubmit()}
                  data-right-panel-agent-send="1"
                  className="h-6.5 gap-1 rounded-full px-2.5 text-[11px]"
                >
                  {sending ? (
                    <Loader2Icon className="size-3 animate-spin" aria-hidden />
                  ) : (
                    <SendHorizontalIcon className="size-3" aria-hidden />
                  )}
                  <span>{sending ? "启动中…" : "发送"}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
