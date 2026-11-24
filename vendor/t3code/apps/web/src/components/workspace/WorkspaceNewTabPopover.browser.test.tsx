import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { TooltipProvider } from "../ui/tooltip";
import { WorkspaceNewTabPopover } from "./WorkspaceNewTabPopover";
import type {
  QuickLaunchAgentOption,
  QuickLaunchHistoryThread,
} from "./workspaceQuickLaunch.logic";

const ENV_LOCAL = EnvironmentId.make("env-local");

const HISTORY_THREAD: QuickLaunchHistoryThread = {
  environmentId: ENV_LOCAL,
  threadId: ThreadId.make("thread-agy-1"),
  title: "排查壁纸渲染闪烁",
  projectName: "Prismux",
  providerId: "antigravity",
  instanceId: ProviderInstanceId.make("antigravity"),
};

const AGENTS: ReadonlyArray<QuickLaunchAgentOption> = [
  {
    id: "codex",
    instanceId: ProviderInstanceId.make("codex"),
    driverKind: "codex",
    brandId: "codex",
    displayName: "Codex",
    defaultModel: "gpt-5.4",
    subtitle: "gpt-5.4",
    available: true,
    recentThreads: [],
  },
  {
    id: "claudeAgent",
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driverKind: "claudeAgent",
    brandId: "claude-code",
    displayName: "Claude Code",
    defaultModel: "claude-sonnet-4-6",
    subtitle: "claude-sonnet-4-6",
    available: true,
    recentThreads: [],
  },
  {
    id: "antigravity",
    instanceId: ProviderInstanceId.make("antigravity"),
    driverKind: "antigravity",
    brandId: "antigravity",
    displayName: "Antigravity",
    defaultModel: "antigravity-default",
    subtitle: "antigravity-default",
    available: true,
    recentThreads: [HISTORY_THREAD],
  },
];

describe("WorkspaceNewTabPopover (browser interaction)", () => {
  it("launches Codex / Claude Code / Antigravity directly in the main workspace on primary row click", async () => {
    const onLaunchAgent = vi.fn();
    const onLaunchAgentInSplit = vi.fn();

    await using screen = await render(
      <TooltipProvider>
        <WorkspaceNewTabPopover
          paneId="pane-main"
          openTabs={[]}
          historyThreads={[HISTORY_THREAD]}
          agents={AGENTS}
          onActivateOpenTab={vi.fn()}
          onOpenHistoryThread={vi.fn()}
          onLaunchAgent={onLaunchAgent}
          onLaunchAgentInSplit={onLaunchAgentInSplit}
          onRunQuickTool={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenAgentSettings={vi.fn()}
        />
      </TooltipProvider>,
    );

    for (const brandId of ["codex", "claude-code", "antigravity"] as const) {
      await userEvent.click(screen.getByRole("button", { name: "新建标签页" }));
      const rowButton = document.querySelector<HTMLButtonElement>(
        `[data-workspace-agent-launch="${brandId}"]`,
      );
      expect(rowButton).not.toBeNull();
      await userEvent.click(rowButton!);
      expect(document.querySelector('[data-workspace-new-tab-popover="true"]')).toBeNull();
    }

    expect(onLaunchAgent).toHaveBeenCalledTimes(3);
    expect(onLaunchAgent.mock.calls.map(([agent, pane]) => [agent.brandId, pane])).toEqual([
      ["codex", "pane-main"],
      ["claude-code", "pane-main"],
      ["antigravity", "pane-main"],
    ]);
    expect(onLaunchAgentInSplit).not.toHaveBeenCalled();
  });

  it("handles clicks inside the body-portaled hover submenu without Base UI outside-press dismissing them", async () => {
    const onLaunchAgent = vi.fn();
    const onLaunchAgentInSplit = vi.fn();
    const onOpenHistoryThread = vi.fn();

    await using screen = await render(
      <TooltipProvider>
        <WorkspaceNewTabPopover
          paneId="pane-main"
          openTabs={[]}
          historyThreads={[HISTORY_THREAD]}
          agents={AGENTS}
          onActivateOpenTab={vi.fn()}
          onOpenHistoryThread={onOpenHistoryThread}
          onLaunchAgent={onLaunchAgent}
          onLaunchAgentInSplit={onLaunchAgentInSplit}
          onRunQuickTool={vi.fn()}
          onOpenUrl={vi.fn()}
          onOpenAgentSettings={vi.fn()}
        />
      </TooltipProvider>,
    );

    // 1. Open Codex submenu -> click "+ 新建 Codex 对话" -> must fire onLaunchAgent in main pane
    await userEvent.click(screen.getByRole("button", { name: "新建标签页" }));
    const codexSubTrigger = document.querySelector<HTMLButtonElement>(
      '[data-workspace-agent-submenu-trigger="codex"]',
    )!;
    await userEvent.click(codexSubTrigger);

    const newCodexBtn = document.querySelector<HTMLButtonElement>(
      '[data-workspace-agent-submenu-new="codex"]',
    );
    expect(newCodexBtn).not.toBeNull();
    await userEvent.click(newCodexBtn!);

    expect(onLaunchAgent).toHaveBeenCalledTimes(1);
    expect(onLaunchAgent).toHaveBeenCalledWith(AGENTS[0], "pane-main");
    expect(onLaunchAgentInSplit).not.toHaveBeenCalled();
    expect(document.querySelector('[data-workspace-new-tab-popover="true"]')).toBeNull();

    // 2. Open Claude Code submenu -> click "在右侧边栏打开 Claude Code" -> must fire onLaunchAgentInSplit
    await userEvent.click(screen.getByRole("button", { name: "新建标签页" }));
    await userEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-workspace-agent-submenu-trigger="claude-code"]',
      )!,
    );
    const sidebarClaudeBtn = document.querySelector<HTMLButtonElement>(
      '[data-workspace-agent-submenu-sidebar="claude-code"]',
    );
    expect(sidebarClaudeBtn).not.toBeNull();
    await userEvent.click(sidebarClaudeBtn!);

    expect(onLaunchAgentInSplit).toHaveBeenCalledTimes(1);
    expect(onLaunchAgentInSplit).toHaveBeenCalledWith(AGENTS[1], "pane-main");
    expect(document.querySelector('[data-workspace-new-tab-popover="true"]')).toBeNull();

    // 3. Open Antigravity submenu -> click recent history thread -> must fire onOpenHistoryThread
    await userEvent.click(screen.getByRole("button", { name: "新建标签页" }));
    await userEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-workspace-agent-submenu-trigger="antigravity"]',
      )!,
    );
    await expect.element(page.getByText("排查壁纸渲染闪烁")).toBeVisible();
    await userEvent.click(
      document.querySelector<HTMLButtonElement>(
        `[data-workspace-agent-submenu-thread="${HISTORY_THREAD.threadId}"]`,
      )!,
    );

    expect(onOpenHistoryThread).toHaveBeenCalledTimes(1);
    expect(onOpenHistoryThread).toHaveBeenCalledWith(HISTORY_THREAD, "pane-main");
  });
});
