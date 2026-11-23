import { useRef, type CSSProperties } from "react";
import { T } from "gt-react";
import { FolderPlusIcon, MessageSquareDashedIcon, PlusIcon, SendHorizontalIcon } from "lucide-react";

import { openCommandPalette } from "../commandPaletteBus";
import { isElectron } from "../env";
import { useScratchProject } from "../hooks/useScratchProject";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import {
  AgyWelcomeGreeting,
  AgyWelcomeSuggestions,
  resolveCurrentUserDisplayName,
  useWelcomeLanguage,
  type AgyWelcomeSuggestionItem,
} from "../prismux/AgyWelcomeHero";
import { ChatWidthDragHandles } from "../prismux/ChatWidthDragHandles";
import { useChatContentWidth } from "../prismux/chatWidthController";
import { Button } from "./ui/button";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import {
  PrismuxStageFrame,
  useWorkspaceTopbarPortal,
} from "./workspace/WorkspaceTopbarPortalContext";

export function NoActiveThreadState() {
  const topbarPortal = useWorkspaceTopbarPortal();
  const welcomeLang = useWelcomeLanguage();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const primaryEnvironment =
    environments.find((env) => env.environmentId === primaryEnvironmentId) ?? environments[0] ?? null;
  const serverConfig = primaryEnvironment?.serverConfig ?? null;
  const userName = resolveCurrentUserDisplayName({
    keybindingsConfigPath: serverConfig?.keybindingsConfigPath,
    scratchWorkspaceRoot: serverConfig?.scratchWorkspaceRoot,
    newProjectsRoot: serverConfig?.newProjectsRoot,
    cwd: serverConfig?.cwd,
    hostname: serverConfig?.hostname,
  });

  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const chatWidth = useChatContentWidth();

  const handleQuickStart = () => {
    if (scratchTargetEnvironmentId !== null) {
      void startScratchThread(scratchTargetEnvironmentId);
      return;
    }
    openCommandPalette();
  };

  const suggestions: readonly AgyWelcomeSuggestionItem[] =
    welcomeLang === "zh"
      ? [
          {
            id: "new-scratch-session",
            label: "立即开启一条新对话，从当前思路继续",
            prompt: "",
            action: handleQuickStart,
          },
          {
            id: "switch-recent-thread",
            label: "从命令面板快速搜索并恢复最近会话",
            prompt: "",
            action: () => openCommandPalette(),
          },
          {
            id: "open-workspace-project",
            label: "添加或切换本地项目工作区",
            prompt: "",
            action: () => openCommandPalette({ open: "add-project" }),
          },
        ]
      : [
          {
            id: "new-scratch-session",
            label: "Start a new conversation right away",
            prompt: "",
            action: handleQuickStart,
          },
          {
            id: "switch-recent-thread",
            label: "Search and resume a recent thread via command palette",
            prompt: "",
            action: () => openCommandPalette(),
          },
          {
            id: "open-workspace-project",
            label: "Add or switch to a local project workspace",
            prompt: "",
            action: () => openCommandPalette({ open: "add-project" }),
          },
        ];

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent [[data-pmx-wallpaper='1']_&]:bg-transparent [[data-pmx-wallpaper-visible='1']_&]:bg-transparent">
        {topbarPortal.managed ? null : (
          <WorkspacePageHeader electron={isElectron}>
            {isElectron ? (
              <span className="text-xs text-muted-foreground/50">
                <T>No active thread</T>
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                  <T>No active thread</T>
                </span>
              </div>
            )}
          </WorkspacePageHeader>
        )}

        <PrismuxStageFrame
          rightPanelOpen={topbarPortal.standaloneRightPanelOpen}
          innerRef={stageRef}
          innerStyle={
            {
              "--pmx-chat-content-max-width": chatWidth.maxWidthCss,
              "--chat-content-max-width": chatWidth.maxWidthCss,
            } as CSSProperties
          }
        >
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pt-8 pb-4">
            <AgyWelcomeGreeting userName={userName} />
          </div>

          <div className="w-full shrink-0 px-4 pb-6 sm:px-8 sm:pb-8">
            <div
              data-pmx-welcome-bottom="1"
              className="mx-auto flex w-full max-w-(--pmx-chat-content-max-width,var(--chat-content-max-width,960px)) flex-col"
            >
              <AgyWelcomeSuggestions suggestions={suggestions} />

              <div
                data-pmx-glass-zone="composer"
                data-pmx-composer-layout="agy"
                className="w-full"
              >
                <div data-pmx-composer-top-tray="1" className="justify-between">
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="h-6 gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => openCommandPalette({ open: "add-project" })}
                    >
                      <FolderPlusIcon className="size-3.5" />
                      <T>Add project</T>
                    </Button>
                    {scratchTargetEnvironmentId !== null ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="h-6 gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={handleQuickStart}
                      >
                        <MessageSquareDashedIcon className="size-3.5" />
                        <T>Start without a project</T>
                      </Button>
                    ) : null}
                  </div>
                  {serverConfig?.hostname ? (
                    <span className="truncate font-mono text-[11px] text-muted-foreground/80">
                      {serverConfig.hostname}
                    </span>
                  ) : null}
                </div>

                <div
                  data-pmx-composer-inner-card="1"
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={handleQuickStart}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
                  >
                    <PlusIcon className="size-4 shrink-0 opacity-75" />
                    <span className="truncate">选择已有会话，或点击此处直接开始新对话…</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleQuickStart}
                    aria-label="开始新对话"
                    className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <SendHorizontalIcon className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <ChatWidthDragHandles
            stageRef={stageRef}
            widthPct={chatWidth.widthPct}
            onCommitWidthPct={chatWidth.commitWidthPct}
          />
        </PrismuxStageFrame>
      </div>
    </SidebarInset>
  );
}
