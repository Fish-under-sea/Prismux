import { useRef, type CSSProperties } from "react";
import { workspaceAreaProps } from "../lib/workspaceFocus";
import { T, useGT } from "gt-react";
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

export function NoProjectsHero() {
  const gt = useGT();
  const topbarPortal = useWorkspaceTopbarPortal();
  const welcomeLang = useWelcomeLanguage();
  const contentArea = workspaceAreaProps("home", 1, gt("Home"));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const primaryEnvironment =
    environments.find((env) => env.environmentId === primaryEnvironmentId) ?? environments[0] ?? null;
  const serverConfig = primaryEnvironment?.serverConfig ?? null;
  const userName = resolveCurrentUserDisplayName({
    osUsername: serverConfig?.osUsername,
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

  const handleStartScratch = () => {
    if (scratchTargetEnvironmentId !== null) {
      void startScratchThread(scratchTargetEnvironmentId);
      return;
    }
    openCommandPalette({ open: "add-project" });
  };

  const suggestions: readonly AgyWelcomeSuggestionItem[] =
    welcomeLang === "zh"
      ? [
          {
            id: "add-local-workspace",
            label: "打开或添加本地代码仓库，开始协作开发",
            prompt: "",
            action: () => openCommandPalette({ open: "add-project" }),
          },
          {
            id: "start-scratch-chat",
            label:
              scratchTargetEnvironmentId !== null
                ? "无需项目直接发起轻量对话与方案构思"
                : "打开命令面板快速选择工作区或会话",
            prompt: "",
            action: handleStartScratch,
          },
          {
            id: "open-command-palette",
            label: "搜索历史线程、项目或系统设置",
            prompt: "",
            action: () => openCommandPalette(),
          },
        ]
      : [
          {
            id: "add-local-workspace",
            label: "Open or add a local repository to start coding",
            prompt: "",
            action: () => openCommandPalette({ open: "add-project" }),
          },
          {
            id: "start-scratch-chat",
            label:
              scratchTargetEnvironmentId !== null
                ? "Start a quick conversation without adding a project"
                : "Open the command palette to pick a workspace",
            prompt: "",
            action: handleStartScratch,
          },
          {
            id: "open-command-palette",
            label: "Search recent threads, projects, or settings",
            prompt: "",
            action: () => openCommandPalette(),
          },
        ];

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-sidebar [[data-pmx-glass='1']_&]:bg-transparent [[data-pmx-wallpaper='1']_&]:bg-transparent [[data-pmx-wallpaper-visible='1']_&]:bg-transparent">
        {/* Only render a standalone titlebar strip when outside WorkspaceSplitContainer's unified topbar. */}
        {isElectron && !topbarPortal.managed ? <WorkspacePageHeader electron /> : null}
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
          {/* Open transparent center breathing stage letting Z-0 wallpaper shine */}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pt-8 pb-4">
            <AgyWelcomeGreeting userName={userName} />
          </div>

          {/* Bottom-left 3 light suggestions + bottom-docked elongated AGY dual-layer launcher */}
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
                        onClick={handleStartScratch}
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
                    onClick={handleStartScratch}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
                  >
                    <PlusIcon className="size-4 shrink-0 opacity-75" />
                    <span className="truncate">
                      {scratchTargetEnvironmentId !== null
                        ? "点击直接开启新对话，或添加本地工作区…"
                        : "添加本地项目以开始你的第一个会话…"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleStartScratch}
                    aria-label={
                      scratchTargetEnvironmentId !== null
                        ? gt("Start without a project")
                        : gt("Add project")
                    }
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
            widthPx={chatWidth.widthPx}
            onCommitWidthPx={chatWidth.commitWidthPx}
          />
        </PrismuxStageFrame>
      </div>
    </SidebarInset>
  );
}
