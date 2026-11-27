import {
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2RunAttempt,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { PopoverPopup } from "../ui/popover";
import {
  formatHonestCacheHitPercent,
  formatTurnUsageCompact,
  formatTurnUsageExact,
  resolveTurnUsageByRunId,
  TurnUsagePill,
  type ResolvedTurnUsageDisplay,
} from "./TurnUsagePopover";

const NOW = DateTime.makeUnsafe("2026-11-26T12:00:00.000Z");

function makeProviderThread(
  id: string,
  driver: string,
  providerInstanceId: string,
): OrchestrationV2ProviderThread {
  return {
    id: ProviderThreadId.make(id),
    driver: ProviderDriverKind.make(driver),
    providerInstanceId: ProviderInstanceId.make(providerInstanceId),
    providerSessionId: null,
    appThreadId: null,
    ownerNodeId: null,
    nativeThreadRef: null,
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: 1,
    lastRunOrdinal: 1,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    contextUsage: null,
    nativeMetadata: null,
    goal: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeAttempt(
  id: string,
  runId: RunId,
  providerThreadId: string,
  providerInstanceId: string,
  providerTurnId: string | null = null,
): OrchestrationV2RunAttempt {
  return {
    id: RunAttemptId.make(id),
    runId,
    attemptOrdinal: 1,
    rootNodeId: NodeId.make(`node-${id}`),
    providerInstanceId: ProviderInstanceId.make(providerInstanceId),
    providerThreadId: ProviderThreadId.make(providerThreadId),
    providerTurnId: providerTurnId ? ProviderTurnId.make(providerTurnId) : null,
    reason: "initial",
    status: "completed",
    startedAt: NOW,
    completedAt: NOW,
  };
}

function makeProviderTurn(
  overrides: Omit<
    Partial<OrchestrationV2ProviderTurn>,
    "id" | "providerThreadId" | "runAttemptId" | "turnTokenUsage"
  > & {
    readonly id: string;
    readonly providerThreadId: string;
    readonly runAttemptId: string;
    readonly turnTokenUsage?: {
      readonly inputTokens: number;
      readonly cachedInputTokens?: number;
      readonly cacheCreationTokens?: number;
      readonly outputTokens: number;
      readonly reasoningTokens?: number;
      readonly usageStatus: "complete" | "unavailable";
    };
  },
): OrchestrationV2ProviderTurn {
  return {
    id: ProviderTurnId.make(overrides.id),
    providerThreadId: ProviderThreadId.make(overrides.providerThreadId),
    nodeId: NodeId.make(`node-${overrides.id}`),
    runAttemptId: RunAttemptId.make(overrides.runAttemptId),
    nativeTurnRef: null,
    ordinal: overrides.ordinal ?? 1,
    status: "completed",
    startedAt: NOW,
    completedAt: NOW,
    ...(overrides.model !== undefined ? { model: overrides.model } : {}),
    ...(overrides.tokenUsage !== undefined ? { tokenUsage: overrides.tokenUsage } : {}),
    ...(overrides.turnTokenUsage !== undefined
      ? {
          turnTokenUsage: {
            usageScope: "main_agent" as const,
            hasSubagents: false,
            ...overrides.turnTokenUsage,
          } as NonNullable<OrchestrationV2ProviderTurn["turnTokenUsage"]>,
        }
      : {}),
  };
}

describe("TurnUsagePopover formatting, multi-agent aggregation & 3-theme markup", () => {
  it("formats compact pill counts, exact comma totals, and honest cache hit percentages", () => {
    expect(formatTurnUsageCompact(0)).toBe("0");
    expect(formatTurnUsageCompact(420)).toBe("420");
    expect(formatTurnUsageCompact(12_400)).toBe("12.4K");
    expect(formatTurnUsageCompact(10_000)).toBe("10K");
    expect(formatTurnUsageCompact(766_591)).toBe("767K");
    expect(formatTurnUsageCompact(999_600)).toBe("1M");
    expect(formatTurnUsageCompact(1_250_000)).toBe("1.25M");

    expect(formatTurnUsageExact(766_591)).toBe("766,591 tok");
    expect(formatTurnUsageExact(26_411)).toBe("26,411 tok");
    expect(formatTurnUsageExact(0)).toBe("0 tok");

    expect(formatHonestCacheHitPercent(null)).toBeNull();
    expect(formatHonestCacheHitPercent(0)).toBe("0%");
    expect(formatHonestCacheHitPercent(720_604 / (26_411 + 720_604 + 14_807))).toBe("94.6%");
    // Strictly sub-100% rates must never round up to 100%
    expect(formatHonestCacheHitPercent(0.9995)).toBe("99.9%");
    expect(formatHonestCacheHitPercent(0.99999)).toBe("99.9%");
    expect(formatHonestCacheHitPercent(1)).toBe("100%");
  });

  it("aggregates providerTurns across all 6 agent drivers and suppresses zero-token runs", () => {
    const runDsh = RunId.make("run-dsh");
    const runCodex = RunId.make("run-codex");
    const runClaude = RunId.make("run-claude");
    const runAgy = RunId.make("run-agy");
    const runOpencode = RunId.make("run-opencode");
    const runPi = RunId.make("run-pi");
    const runZero = RunId.make("run-zero");

    const providerThreads: ReadonlyArray<OrchestrationV2ProviderThread> = [
      makeProviderThread("pt-dsh", "acp", "acp_dsh"),
      makeProviderThread("pt-codex", "codex", "codex"),
      makeProviderThread("pt-claude", "claudeAgent", "claudeAgent"),
      makeProviderThread("pt-agy", "acp", "acp_antigravity"),
      makeProviderThread("pt-opencode", "opencode", "opencode"),
      makeProviderThread("pt-pi", "pi", "pi"),
    ];

    const attempts: ReadonlyArray<OrchestrationV2RunAttempt> = [
      makeAttempt("att-dsh", runDsh, "pt-dsh", "acp_dsh"),
      makeAttempt("att-codex", runCodex, "pt-codex", "codex"),
      makeAttempt("att-claude", runClaude, "pt-claude", "claudeAgent"),
      makeAttempt("att-agy", runAgy, "pt-agy", "acp_antigravity"),
      makeAttempt("att-opencode", runOpencode, "pt-opencode", "opencode"),
      makeAttempt("att-pi", runPi, "pt-pi", "pi"),
      makeAttempt("att-zero", runZero, "pt-codex", "codex"),
    ];

    const providerTurns: ReadonlyArray<OrchestrationV2ProviderTurn> = [
      // Fig 10 exact numbers (split across 2 calls in the same run)
      makeProviderTurn({
        id: "turn-dsh-1",
        providerThreadId: "pt-dsh",
        runAttemptId: "att-dsh",
        model: "anthropic/claude-opus-4-7",
        turnTokenUsage: {
          inputTokens: 500_000,
          cachedInputTokens: 480_000,
          cacheCreationTokens: 10_000,
          outputTokens: 2_000,
          usageStatus: "complete",
        },
      }),
      makeProviderTurn({
        id: "turn-dsh-2",
        providerThreadId: "pt-dsh",
        runAttemptId: "att-dsh",
        ordinal: 2,
        model: "anthropic/claude-opus-4-7",
        turnTokenUsage: {
          inputTokens: 261_822,
          cachedInputTokens: 240_604,
          cacheCreationTokens: 4_807,
          outputTokens: 2_769,
          usageStatus: "complete",
        },
      }),
      makeProviderTurn({
        id: "turn-codex-1",
        providerThreadId: "pt-codex",
        runAttemptId: "att-codex",
        model: "gpt-5.4",
        turnTokenUsage: {
          inputTokens: 40_000,
          cachedInputTokens: 32_000,
          outputTokens: 1_500,
          reasoningTokens: 400,
          usageStatus: "complete",
        },
      }),
      makeProviderTurn({
        id: "turn-claude-1",
        providerThreadId: "pt-claude",
        runAttemptId: "att-claude",
        model: "claude-sonnet-4-6",
        turnTokenUsage: {
          inputTokens: 20_000,
          cachedInputTokens: 12_000,
          cacheCreationTokens: 3_000,
          outputTokens: 900,
          usageStatus: "complete",
        },
      }),
      makeProviderTurn({
        id: "turn-agy-1",
        providerThreadId: "pt-agy",
        runAttemptId: "att-agy",
        model: "antigravity/gemini-3-pro",
        tokenUsage: {
          usedTokens: 18_500,
          inputTokens: 15_000,
          cachedInputTokens: 10_000,
          outputTokens: 3_500,
          updatedAt: "2026-11-26T12:00:00.000Z",
        },
      }),
      makeProviderTurn({
        id: "turn-opencode-1",
        providerThreadId: "pt-opencode",
        runAttemptId: "att-opencode",
        model: "gpt-5.3",
        turnTokenUsage: {
          inputTokens: 9_000,
          outputTokens: 600,
          usageStatus: "complete",
        },
      }),
      makeProviderTurn({
        id: "turn-pi-1",
        providerThreadId: "pt-pi",
        runAttemptId: "att-pi",
        model: "claude-opus-4-6",
        turnTokenUsage: {
          inputTokens: 15_000,
          cachedInputTokens: 9_000,
          outputTokens: 1_200,
          usageStatus: "complete",
        },
      }),
      // Zero / unavailable turn must be suppressed
      makeProviderTurn({
        id: "turn-zero-1",
        providerThreadId: "pt-codex",
        runAttemptId: "att-zero",
        turnTokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          usageStatus: "unavailable",
        },
      }),
    ];

    const byRun = resolveTurnUsageByRunId({ providerTurns, attempts, providerThreads });

    const dsh = byRun.get(runDsh);
    expect(dsh).toBeDefined();
    expect(dsh!.providerModelLabel).toBe("anthropic/claude-opus-4-7");
    expect(dsh!.uncachedInputTokens).toBe(26_411);
    expect(dsh!.cachedInputTokens).toBe(720_604);
    expect(dsh!.cacheCreationTokens).toBe(14_807);
    expect(dsh!.outputTokens).toBe(4_769);
    expect(dsh!.totalTokens).toBe(766_591);
    expect(formatTurnUsageCompact(dsh!.totalTokens)).toBe("767K");
    expect(formatHonestCacheHitPercent(dsh!.cacheHitRate)).toBe("94.6%");
    expect(dsh!.isEstimated).toBe(false);

    expect(byRun.get(runCodex)?.providerModelLabel).toBe("codex/gpt-5.4");
    expect(byRun.get(runCodex)?.reasoningTokens).toBe(400);
    expect(byRun.get(runClaude)?.providerModelLabel).toBe("claude/claude-sonnet-4-6");
    expect(byRun.get(runAgy)?.providerModelLabel).toBe("antigravity/gemini-3-pro");
    expect(byRun.get(runOpencode)?.providerModelLabel).toBe("opencode/gpt-5.3");
    expect(byRun.get(runPi)?.providerModelLabel).toBe("pi/claude-opus-4-6");
    expect(byRun.has(runZero)).toBe(false);
  });

  it("renders compact trigger pill with dynamic accent and never uses hardcoded dark-only #111215", () => {
    const usage: ResolvedTurnUsageDisplay = {
      runId: RunId.make("run-fig10"),
      providerModelLabel: "anthropic/claude-opus-4-7",
      totalTokens: 766_591,
      uncachedInputTokens: 26_411,
      cachedInputTokens: 720_604,
      cacheCreationTokens: 14_807,
      outputTokens: 4_769,
      reasoningTokens: 0,
      cacheHitRate: 720_604 / 761_822,
      isEstimated: false,
    };

    const html = renderToStaticMarkup(<TurnUsagePill usage={usage} locale="zh-CN" />);
    expect(html).toContain('data-turn-usage-pill="true"');
    expect(html).toContain("用量");
    expect(html).toContain("767K tok");
    expect(html).not.toContain("#111215");
    expect(html).not.toContain("bg-black");

    const enHtml = renderToStaticMarkup(<TurnUsagePill usage={usage} locale="en-US" />);
    expect(enHtml).toContain("Usage");
    expect(enHtml).toContain("767K tok");

    const zeroHtml = renderToStaticMarkup(
      <TurnUsagePill usage={{ ...usage, totalTokens: 0 }} locale="zh-CN" />,
    );
    expect(zeroHtml).toBe("");
  });

  it("anchors TurnUsagePopover at side='top' align='start' with collisionPadding=12 so it expands rightward and never overlaps the left sidebar", () => {
    const usage: ResolvedTurnUsageDisplay = {
      runId: RunId.make("run-align-start"),
      providerModelLabel: "anthropic/claude-opus-4-7",
      totalTokens: 766_591,
      uncachedInputTokens: 26_411,
      cachedInputTokens: 720_604,
      cacheCreationTokens: 14_807,
      outputTokens: 4_769,
      reasoningTokens: 0,
      cacheHitRate: 720_604 / 761_822,
      isEstimated: false,
    };

    const findElement = (
      node: ReactNode,
      predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
    ): ReactElement<Record<string, unknown>> | null => {
      for (const child of Children.toArray(node)) {
        if (!isValidElement(child)) continue;
        const element = child as ReactElement<Record<string, unknown>>;
        if (predicate(element)) return element;
        const nested = findElement(element.props.children as ReactNode, predicate);
        if (nested) return nested;
      }
      return null;
    };

    const renderTurnUsagePill = (
      TurnUsagePill as unknown as {
        type: (props: ComponentProps<typeof TurnUsagePill>) => ReactElement | null;
      }
    ).type;
    const popoverRoot = renderTurnUsagePill({ usage, locale: "zh-CN", defaultOpen: true });
    expect(popoverRoot).not.toBeNull();

    const popupElement = findElement(popoverRoot, (el) => el.type === PopoverPopup);
    expect(popupElement).not.toBeNull();
    const popupProps = popupElement!.props as ComponentProps<typeof PopoverPopup>;
    expect(popupProps.side).toBe("top");
    expect(popupProps.align).toBe("start");
    expect(popupProps.sideOffset).toBe(8);
    expect(popupProps.collisionPadding).toBe(12);
    expect(popupProps.padding).toBe("none");

    // Verify PopoverPopup forwards side/align/collisionPadding straight to Base UI Positioner.
    const renderedPortal = PopoverPopup(popupProps);
    const positioner = findElement(
      renderedPortal,
      (el) => el.props["data-slot"] === "popover-positioner",
    );
    expect(positioner).not.toBeNull();
    expect(positioner!.props.side).toBe("top");
    expect(positioner!.props.align).toBe("start");
    expect(positioner!.props.sideOffset).toBe(8);
    expect(positioner!.props.collisionPadding).toBe(12);

    // Geometry check: pill sits near the left edge of the chat pane right next to a 240px left sidebar.
    const computePopoverHorizontalBounds = (params: {
      readonly align: "start" | "center" | "end";
      readonly triggerLeft: number;
      readonly triggerWidth: number;
      readonly popoverWidth: number;
      readonly viewportWidth: number;
      readonly collisionPadding: number;
    }) => {
      const rawLeft =
        params.align === "start"
          ? params.triggerLeft
          : params.align === "end"
            ? params.triggerLeft + params.triggerWidth - params.popoverWidth
            : params.triggerLeft + (params.triggerWidth - params.popoverWidth) / 2;
      const minLeft = params.collisionPadding;
      const maxLeft = Math.max(
        minLeft,
        params.viewportWidth - params.collisionPadding - params.popoverWidth,
      );
      const left = Math.min(Math.max(rawLeft, minLeft), maxLeft);
      return { left, right: left + params.popoverWidth };
    };

    const sidebarRight = 240;
    const triggerLeft = 264;
    const triggerWidth = 96;
    const popoverWidth = 304;
    const resolvedAlign = positioner!.props.align as "start" | "center" | "end";
    const resolvedCollisionPadding = positioner!.props.collisionPadding as number;

    const desktopBounds = computePopoverHorizontalBounds({
      align: resolvedAlign,
      triggerLeft,
      triggerWidth,
      popoverWidth,
      viewportWidth: 1280,
      collisionPadding: resolvedCollisionPadding,
    });
    expect(desktopBounds.left).toBe(triggerLeft);
    expect(desktopBounds.left).toBeGreaterThanOrEqual(sidebarRight);
    expect(desktopBounds.right).toBe(triggerLeft + popoverWidth);

    // Narrow split pane: collisionPadding keeps the right edge safely 12px inside the viewport.
    const narrowBounds = computePopoverHorizontalBounds({
      align: resolvedAlign,
      triggerLeft,
      triggerWidth,
      popoverWidth,
      viewportWidth: 520,
      collisionPadding: resolvedCollisionPadding,
    });
    expect(narrowBounds.right).toBeLessThanOrEqual(520 - 12);
    expect(narrowBounds.left).toBeGreaterThanOrEqual(12);
  });

  it("defaults PopoverPopup collisionPadding to 12 for non-panel popovers, honors overrides, and keeps 0 for panel variant", () => {
    const findPositioner = (node: ReactNode): ReactElement<Record<string, unknown>> | null => {
      for (const child of Children.toArray(node)) {
        if (!isValidElement(child)) continue;
        const element = child as ReactElement<Record<string, unknown>>;
        if (element.props["data-slot"] === "popover-positioner") return element;
        const nested = findPositioner(element.props.children as ReactNode);
        if (nested) return nested;
      }
      return null;
    };

    const defaultPositioner = findPositioner(PopoverPopup({ children: null }));
    expect(defaultPositioner?.props.collisionPadding).toBe(12);

    const customPositioner = findPositioner(PopoverPopup({ children: null, collisionPadding: 20 }));
    expect(customPositioner?.props.collisionPadding).toBe(20);

    const panelPositioner = findPositioner(
      PopoverPopup({ children: null, variant: "panel", collisionPadding: 24 }),
    );
    expect(panelPositioner?.props.collisionPadding).toBe(0);
  });
});
