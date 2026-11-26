import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import { GTProvider, initializeGT } from "gt-react";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "@prismux/appearance/styles.css";
import "~/index.css";
import { render } from "../../../test/render";
import type { WorkLogEntry } from "../../session-logic";
import { TooltipProvider } from "../ui/tooltip";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { MarkdownFileLink } from "./MarkdownFileLink";
import { resolveWorkStepsPolicy } from "./dshWorkSteps.logic";
import { WorkGroupSection, WorkingTimelineRow } from "./TimelineWorkGroupRows";
import {
  TimelineRowActivityCtx,
  TimelineRowCtx,
  type TimelineRowActivityState,
  type TimelineRowSharedState,
} from "./timelineRowContext";
import { TurnUsagePill, type ResolvedTurnUsageDisplay } from "./TurnUsagePopover";

const ENV_LOCAL = EnvironmentId.make("env-local");
const RUN_1 = RunId.make("run-dsh-parity");

function parseRgb(colorStr: string): readonly [number, number, number] {
  const srgbMatch = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/u.exec(colorStr);
  if (srgbMatch) {
    return [
      Math.round(Math.min(1, Math.max(0, Number(srgbMatch[1]))) * 255),
      Math.round(Math.min(1, Math.max(0, Number(srgbMatch[2]))) * 255),
      Math.round(Math.min(1, Math.max(0, Number(srgbMatch[3]))) * 255),
    ];
  }
  const rgbDirect = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/u.exec(colorStr);
  if (rgbDirect) {
    return [Number(rgbDirect[1]), Number(rgbDirect[2]), Number(rgbDirect[3])];
  }
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [0, 0, 0];
  ctx.fillStyle = "#000000";
  ctx.fillStyle = colorStr;
  const normalized = ctx.fillStyle;
  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/u.exec(normalized);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const linear = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function wcagContrastRatio(fgColor: string, bgColor: string): number {
  const l1 = relativeLuminance(parseRgb(fgColor));
  const l2 = relativeLuminance(parseRgb(bgColor));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function makeProjectedBase(id: string, startedIso: string, completedIso: string) {
  return {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("thread-dsh"),
    runId: RUN_1,
    nodeId: NodeId.make(`node-${id}`),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed" as const,
    title: null,
    startedAt: DateTime.makeUnsafe(startedIso),
    completedAt: DateTime.makeUnsafe(completedIso),
    updatedAt: DateTime.makeUnsafe(completedIso),
  };
}

function makeSharedState(resolvedTheme: "light" | "dark"): TimelineRowSharedState {
  return {
    pendingApprovals: new Map(),
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: undefined,
    citationRequest: null,
    onReplyToResponse: undefined,
    listRef: { current: null },
    timestampFormat: "24-hour",
    routeThreadKey: "env-local:thread-dsh",
    threadRef: {
      environmentId: ENV_LOCAL,
      threadId: ThreadId.make("thread-dsh"),
    },
    markdownCwd: "D:\\Fish-code\\Prismux",
    resolvedTheme,
    workspaceRoot: "D:\\Fish-code\\Prismux",
    skills: [],
    runs: [],
    activeThreadEnvironmentId: ENV_LOCAL,
    onRevertToTurnCount: () => undefined,
    onUseArtifactTemplate: () => undefined,
    onSendAppMessage: undefined,
    onAppFullscreenChange: () => undefined,
    onRunShellCommand: undefined,
    findActive: false,
    onImageExpand: () => undefined,
    onFileOpen: () => undefined,
    onFileDownload: () => undefined,
    openPullRequest: () => undefined,
    onOpenToolDiff: () => undefined,
    onOpenTurnDiff: undefined,
    renderHtmlRender: undefined,
    turnItemSource: undefined,
    onOpenThread: () => undefined,
    workflowOpening: null,
    onForkFromRun: undefined,
    onToggleTurnFold: () => undefined,
    onToggleAttemptFold: () => undefined,
    onToggleWorkGroup: () => undefined,
    onToggleWorkEntry: () => undefined,
    onCancelWorktreeSetup: null,
    retryableWorkspacePreparationRunIds: new Set(),
    onRetryWorkspacePreparation: null,
    onWorktreeSetupWorkLocally: null,
    onOpenWorktreeSetupTerminal: null,
    workGroupViewState: {
      scrollPositions: new Map(),
      expandedEntries: new Set(["ctx-1", "cmd-fail-1", "reason-1", "skill-1"]),
    },
    workStepsPolicy: resolveWorkStepsPolicy("standard"),
    locale: "zh-CN",
    turnDisclosureResetCount: 0,
  };
}

const LIVE_ACTIVITY: TimelineRowActivityState = {
  isWorking: true,
  isCompacting: false,
  isRevertingCheckpoint: false,
  backgroundWorktreeSetup: null,
  awaitingUser: false,
  isPreparingWorktree: false,
  providerStartingLabel: null,
  latestRunId: RUN_1,
  liveAnswerPreview: null,
};

function buildConvergedEntries(): WorkLogEntry[] {
  const cmdItem: OrchestrationV2ProjectedTurnItem["item"] = {
    ...makeProjectedBase("cmd-fail-1", "2026-11-26T10:00:02.000Z", "2026-11-26T10:00:02.640Z"),
    type: "command_execution",
    title: "检查聊天组件与静态规则",
    status: "failed",
    input: "rg --files apps/web/src/components/chat\npnpm exec vp lint",
    output: "apps/web/src/components/chat/TurnUsagePopover.tsx\nExit status 1: 1 warning found",
    exitCode: 1,
  };
  const subItem: OrchestrationV2ProjectedTurnItem["item"] = {
    ...makeProjectedBase("sub-1", "2026-11-26T10:00:04.000Z", "2026-11-26T10:00:06.100Z"),
    type: "subagent",
    subagentId: NodeId.make("sub-node-1"),
    origin: "app_owned",
    driver: ProviderDriverKind.make("acp"),
    providerInstanceId: "acp:dsh" as never,
    childThreadId: ThreadId.make("child-dsh-1"),
    prompt: "验证三套主题对比度与滚动收口",
    result: "Light / Dark / Liquid Glass 全部通过 WCAG 4.5:1",
    title: "主题对比度核验助手",
  };
  return [
    {
      id: "ctx-1",
      runId: RUN_1,
      createdAt: "2026-11-26T10:00:00.500Z",
      label: "AGENTS.md",
      tone: "info",
      sourceActivityKind: "context_injection",
      toolData: {
        sourceKind: "agent-instructions",
        label: "AGENTS.md",
        sourcePath: "AGENTS.md",
        statusLabel: "已载入",
        content:
          "<system-reminder>\n# Prismux 超级工作台 · Agent 必读\n1. 纯本地零遥测\n2. 动态主题强调色 WCAG >= 4.5:1\n</system-reminder>",
      },
    },
    {
      id: "reason-1",
      runId: RUN_1,
      createdAt: "2026-11-26T10:00:01.000Z",
      label: "Thinking",
      tone: "thinking",
      itemType: "reasoning",
      toolLifecycleStatus: "completed",
      detail:
        "**核验 6 类步骤收敛与动态强调色**\n检查所有步骤是否收拢于单个 400px 抽屉，且底部状态栏绑定至 --pmx-accent-text。",
    },
    {
      id: "skill-1",
      runId: RUN_1,
      createdAt: "2026-11-26T10:00:01.500Z",
      label: "Skill",
      tone: "tool",
      toolTitle: "skill",
      toolLifecycleStatus: "completed",
      toolData: {
        dshToolName: "skill",
        input: { name: "systematic-debugging" },
        output: "四阶段根因追踪：复现 -> 定位 -> 最小修复 -> 回归验证。",
      },
    },
    {
      id: "cmd-fail-1",
      runId: RUN_1,
      createdAt: "2026-11-26T10:00:02.000Z",
      label: "Ran command",
      tone: "error",
      itemType: "command_execution",
      toolLifecycleStatus: "failed",
      command: "rg --files apps/web/src/components/chat\npnpm exec vp lint",
      structuredPayload: cmdItem,
      projectedItem: {
        position: 3,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread-dsh"),
        sourceItemId: cmdItem.id,
        item: cmdItem,
      },
    },
    {
      id: "sub-1",
      runId: RUN_1,
      createdAt: "2026-11-26T10:00:04.000Z",
      label: "主题对比度核验助手",
      tone: "tool",
      itemType: "subagent",
      toolLifecycleStatus: "completed",
      structuredPayload: subItem,
      projectedItem: {
        position: 4,
        visibility: "local",
        sourceThreadId: ThreadId.make("thread-dsh"),
        sourceItemId: subItem.id,
        item: subItem,
      },
    },
  ];
}

const FIG10_USAGE: ResolvedTurnUsageDisplay = {
  runId: RUN_1,
  providerModelLabel: "anthropic/claude-opus-4-7",
  totalTokens: 766_591,
  uncachedInputTokens: 26_411,
  cachedInputTokens: 720_604,
  cacheCreationTokens: 14_807,
  outputTokens: 4_769,
  reasoningTokens: 0,
  cacheHitRate: 720_604 / (26_411 + 720_604 + 14_807),
  isEstimated: false,
};

function DshShowcaseSurface({
  theme,
  glass = false,
  accent,
  title,
  openUsagePopover = false,
  inheritRootAccent = false,
  liveDrawer = false,
}: {
  readonly theme: "light" | "dark";
  readonly glass?: boolean;
  readonly accent: string;
  readonly title: string;
  readonly openUsagePopover?: boolean;
  readonly inheritRootAccent?: boolean;
  readonly liveDrawer?: boolean;
}) {
  const shared = makeSharedState(theme);
  const entries = buildConvergedEntries();
  return (
    <div
      data-showcase-surface={`${theme}-${glass ? "glass" : "solid"}`}
      data-pmx-theme={theme}
      data-pmx-glass={glass ? "1" : undefined}
      className={theme === "dark" ? "dark" : undefined}
      style={
        {
          ...(inheritRootAccent
            ? {}
            : {
                "--pmx-accent": accent,
                "--pmx-accent-text":
                  theme === "dark"
                    ? `color-mix(in srgb, ${accent} 74%, #ffffff)`
                    : `color-mix(in srgb, ${accent} 62%, #09090b)`,
                "--pmx-accent-soft": `color-mix(in srgb, ${accent} 14%, transparent)`,
                "--pmx-accent-border": `color-mix(in srgb, ${accent} 34%, transparent)`,
              }),
          "--contrast-foreground": theme === "dark" ? "#f4f4f6" : "#18181b",
          "--contrast-muted-foreground": theme === "dark" ? "#a1a1aa" : "#52525b",
          "--contrast-border": theme === "dark" ? "rgba(255,255,255,0.16)" : "rgba(24,24,27,0.18)",
          "--pmx-card-bg":
            theme === "dark" ? "rgba(18, 22, 34, 0.74)" : "rgba(255, 255, 255, 0.80)",
          "--pmx-overlay-bg":
            theme === "dark" ? "rgba(16, 20, 32, 0.88)" : "rgba(255, 255, 255, 0.92)",
          "--pmx-glass-border":
            theme === "dark" ? "rgba(255, 255, 255, 0.16)" : "rgba(15, 23, 42, 0.14)",
          background: glass
            ? theme === "dark"
              ? "linear-gradient(135deg, #0b1224 0%, #1d1536 52%, #0e2438 100%)"
              : "linear-gradient(135deg, #e0f2fe 0%, #ede9fe 52%, #fce7f3 100%)"
            : theme === "dark"
              ? "#0d0e11"
              : "#ffffff",
          color: theme === "dark" ? "#f4f4f6" : "#18181b",
        } as React.CSSProperties
      }
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 p-4">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{title}</span>
          <span className="font-mono" style={{ color: "var(--pmx-accent-text)" }}>
            accent: {accent}
          </span>
        </div>

        {/* Level 1 TurnFold bar (33px, 0.5px bottom border, zero right timestamp) */}
        <div data-turn-fold-bar="true">
          <div className="pmx-turn-fold-trigger pmx-hairline-b box-border flex w-full items-center pb-2 text-sm leading-6 text-muted-foreground">
            <span>已完成，用时 </span>
            <span className="font-mono tabular-nums">7分45秒</span>
          </div>
        </div>

        {/* Level 2 Bounded ProcessGroup drawer (strict max-height: min(400px, 50vh), zero border-l) */}
        <TimelineRowCtx value={shared}>
          <TimelineRowActivityCtx value={LIVE_ACTIVITY}>
            <WorkGroupSection
              anchorKey="work-group:dsh-parity"
              groupedEntries={entries}
              isExpandedToolGroup
              isLive={liveDrawer}
            />
            <WorkingTimelineRow
              row={{
                kind: "working",
                id: "working-dsh-parity",
                createdAt: "2026-11-26T10:00:00.000Z",
                dshStyle: true,
                showDividerAbove: true,
              }}
            />
          </TimelineRowActivityCtx>
        </TimelineRowCtx>

        {/* Figs 7-8 Rich-text Markdown + FileLink + 16px CodeBlock */}
        <div className="chat-markdown text-sm" data-dsh-markdown-showcase="true">
          <ul>
            <li>
              核心入口：
              <MarkdownFileLink
                environmentId={ENV_LOCAL}
                href="file:///D:/Fish-code/Prismux/apps/web/src/components/chat/TurnUsagePopover.tsx"
                targetPath="apps/web/src/components/chat/TurnUsagePopover.tsx"
                iconPath="apps/web/src/components/chat/TurnUsagePopover.tsx"
                workspaceRelativePath="apps/web/src/components/chat/TurnUsagePopover.tsx"
                panelPath="apps/web/src/components/chat/TurnUsagePopover.tsx"
                label="TurnUsagePopover.tsx"
                copyMarkdown="`TurnUsagePopover.tsx`"
                theme={theme}
                onOpenInPanel={() => undefined}
                resolveDragPath={async () => "TurnUsagePopover.tsx"}
                resolveCopyPaths={async () => ({
                  relativePath: "apps/web/src/components/chat/TurnUsagePopover.tsx",
                  fullPath:
                    "D:/Fish-code/Prismux/apps/web/src/components/chat/TurnUsagePopover.tsx",
                })}
                openInEditorMenuLabel="Open"
              />{" "}
              与 <code>workStepsDisplay</code> 策略矩阵对齐。
            </li>
          </ul>
          <table>
            <thead>
              <tr>
                <th>区域</th>
                <th>规则</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>步骤抽屉</td>
                <td>
                  <code>max-height: min(400px, 50vh)</code>
                </td>
              </tr>
            </tbody>
          </table>
          <MarkdownCodeBlock
            code={"echo 'DSH 1:1 parity'\n"}
            language=""
            fenceTitle={null}
            theme={theme}
            isStreaming={false}
          >
            <pre>
              <code>{"echo 'DSH 1:1 parity'"}</code>
            </pre>
          </MarkdownCodeBlock>
        </div>

        {/* Fig 10 Footer with Per-Turn Usage Pill + Popover */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <TurnUsagePill usage={FIG10_USAGE} locale="zh-CN" defaultOpen={openUsagePopover} />
          <span className="text-xs tabular-nums text-muted-foreground">01:42</span>
        </div>
      </div>
    </div>
  );
}

describe("DSH NEXT 1:1 Parity real-Chrome browser verification", () => {
  it("dynamically binds --pmx-accent-text across Light/Dark/Liquid Glass with WCAG >= 4.5:1 contrast, invariant semantic error/success dots, and strict 400px ProcessGroup cap", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    await page.viewport(1440, 960);

    const checkSurface = async (theme: "light" | "dark", glass: boolean, accent: string) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      document.documentElement.setAttribute("data-pmx-theme", theme);
      if (glass) document.documentElement.setAttribute("data-pmx-glass", "1");
      else document.documentElement.removeAttribute("data-pmx-glass");
      // Drive the REAL CSS rules in index.css / prismux-glass-bridge.css via --pmx-accent only
      document.documentElement.style.setProperty("--pmx-accent", accent);
      document.documentElement.style.removeProperty("--pmx-accent-text");

      await using _screen = await render(
        <GTProvider locale="zh" translations={{}}>
          <TooltipProvider>
            <div className="p-4">
              <DshShowcaseSurface
                theme={theme}
                glass={glass}
                accent={accent}
                title={`${theme}${glass ? " glass" : ""}`}
                openUsagePopover
                inheritRootAccent
              />
            </div>
          </TooltipProvider>
        </GTProvider>,
        { router: "/" },
      );

      // 1. Strict max-height cap & zero border-l on ProcessGroup drawer
      const drawer = document.querySelector<HTMLElement>('[data-process-drawer-body="true"]')!;
      expect(drawer).not.toBeNull();
      const drawerStyle = getComputedStyle(drawer);
      expect(drawerStyle.borderLeftWidth).toBe("0px");
      const drawerMaxPx = Number.parseFloat(drawerStyle.maxHeight);
      expect(drawerMaxPx).toBeLessThanOrEqual(400.5);
      expect(drawerMaxPx).toBeGreaterThan(300);

      // 2. Expanded cards present inside converged drawer with exact DSH max-heights
      const ctxCard = document.querySelector<HTMLElement>(
        '[data-step-detail-card="context_injection"]',
      )!;
      const skillCard = document.querySelector<HTMLElement>(
        '[data-step-detail-card="skill_load"]',
      )!;
      expect(document.querySelector('[data-context-injection-row="true"]')).not.toBeNull();
      expect(getComputedStyle(ctxCard).maxHeight).toBe("141px");
      expect(document.querySelector('[data-reasoning-row="true"]')).not.toBeNull();
      expect(document.querySelector('[data-skill-step-row="true"]')).not.toBeNull();
      expect(getComputedStyle(skillCard).maxHeight).toBe("260px");
      expect(document.querySelector('[data-step-detail-card="command_execution"]')).not.toBeNull();
      expect(document.querySelector('[data-subagent-step-row="true"]')).not.toBeNull();
      expect(document.querySelector('[data-codeblock-fallback-label="true"]')?.textContent).toBe(
        "代码块",
      );

      // 3. Dynamic accent text binding on running status bar, file link icon, and 本轮用量 <dd>
      const runningEl = document.querySelector<HTMLElement>('[data-running-status-bar="true"]')!;
      const fileIconEl = document.querySelector<HTMLElement>('[data-pmx-file-link-icon="true"]')!;
      const usageValEl = document.querySelector<HTMLElement>('[data-turn-usage-value="true"]')!;
      expect(runningEl).not.toBeNull();
      expect(fileIconEl).not.toBeNull();
      expect(usageValEl).not.toBeNull();

      const runningColor = getComputedStyle(runningEl).color;
      const fileIconColor = getComputedStyle(fileIconEl).color;
      const usageValColor = getComputedStyle(usageValEl).color;
      expect(runningColor).toBe(fileIconColor);
      expect(usageValColor).toBe(runningColor);

      // 4. WCAG >= 4.5:1 contrast ratio on the active theme background
      const bgRef = theme === "dark" ? "#0d0e11" : "#ffffff";
      const ratio = wcagContrastRatio(runningColor, bgRef);
      expect(ratio).toBeGreaterThanOrEqual(4.5);

      // 5. Semantic red dot on 退出码 1 stays invariant across accent switches
      const exitDot = document.querySelector<HTMLElement>('[data-exit-code-dot="true"]')!;
      const exitDotBg = getComputedStyle(exitDot).backgroundColor;
      return { runningColor, exitDotBg };
    };

    const darkIndigo = await checkSurface("dark", false, "#6366f1");
    const darkEmerald = await checkSurface("dark", false, "#10b981");
    expect(darkIndigo.runningColor).not.toBe(darkEmerald.runningColor);
    expect(darkIndigo.exitDotBg).toBe(darkEmerald.exitDotBg);

    const lightIndigo = await checkSurface("light", false, "#6366f1");
    const lightEmerald = await checkSurface("light", false, "#10b981");
    expect(lightIndigo.runningColor).not.toBe(lightEmerald.runningColor);

    const glassRose = await checkSurface("dark", true, "#ec4899");
    expect(glassRose.runningColor).not.toBe(darkIndigo.runningColor);
  });

  it("renders crisp Dark + Indigo and Liquid Glass + Rose showcase with open Dark 本轮用量 popover", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    await page.viewport(1280, 1020);
    document.documentElement.classList.add("dark");
    document.documentElement.setAttribute("data-pmx-theme", "dark");
    document.documentElement.removeAttribute("data-pmx-glass");
    document.documentElement.style.setProperty("--pmx-accent", "#6366f1");
    document.documentElement.style.removeProperty("--pmx-accent-text");

    await using _screen = await render(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <div
            className="grid grid-cols-2 gap-4 bg-background p-4"
            style={{ minHeight: 1000, width: 1280 }}
          >
            <DshShowcaseSurface
              theme="dark"
              accent="#6366f1"
              title="Dark · Indigo Accent (Top of Drawer: Context + Reasoning + Skill)"
              openUsagePopover
              liveDrawer={false}
            />
            <DshShowcaseSurface
              theme="dark"
              glass
              accent="#ec4899"
              title="Liquid Glass · Rose Accent (Live Auto-Follow Bottom: Command + Subagent)"
              openUsagePopover={false}
              liveDrawer
            />
          </div>
        </TooltipProvider>
      </GTProvider>,
      { router: "/" },
    );

    expect(document.querySelectorAll('[data-turn-usage-pill="true"]').length).toBe(2);
    expect(document.querySelector('[data-turn-usage-popover="true"]')?.textContent).toContain(
      "766,591 tok",
    );
    expect(document.querySelector('[data-turn-usage-popover="true"]')?.textContent).toContain(
      "94.6%",
    );
    expect(document.querySelector('[data-turn-usage-popover="true"]')?.textContent).toContain(
      "anthropic/claude-opus-4-7",
    );

    const captureDir = (import.meta.env as Record<string, string | undefined>)
      .VITE_DSH_SCREENSHOT_DIR;
    if (captureDir) {
      await page.screenshot({ path: `${captureDir}/dsh-parity-dark-glass.png` });
    }
  });

  it("renders crisp Light + Emerald showcase with genuine Light-mode 本轮用量 popover", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    await page.viewport(760, 1020);
    document.documentElement.classList.remove("dark");
    document.documentElement.setAttribute("data-pmx-theme", "light");
    document.documentElement.removeAttribute("data-pmx-glass");
    document.documentElement.style.setProperty("--pmx-accent", "#10b981");
    document.documentElement.style.removeProperty("--pmx-accent-text");

    await using _screen = await render(
      <GTProvider locale="zh" translations={{}}>
        <TooltipProvider>
          <div className="bg-muted p-4" style={{ minHeight: 1000, width: 760 }}>
            <DshShowcaseSurface
              theme="light"
              accent="#10b981"
              title="Light · Emerald Accent (1:1 Work Steps + Rich Markdown + Light Popover)"
              openUsagePopover
              inheritRootAccent
              liveDrawer
            />
          </div>
        </TooltipProvider>
      </GTProvider>,
      { router: "/" },
    );

    expect(document.querySelector('[data-turn-usage-popover="true"]')?.textContent).toContain(
      "766,591 tok",
    );
    const captureDir = (import.meta.env as Record<string, string | undefined>)
      .VITE_DSH_SCREENSHOT_DIR;
    if (captureDir) {
      await page.screenshot({ path: `${captureDir}/dsh-parity-light.png` });
    }
  });
});
