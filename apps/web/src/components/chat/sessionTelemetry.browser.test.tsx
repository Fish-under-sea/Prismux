import type { ContextWindowSnapshot } from "@prismux/client-runtime/state/context-window";
import {
  UsageDay,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2Run,
  type OrchestrationV2Subagent,
  type ServerProvider,
} from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { useUsage } from "../../state/usage";
import {
  ComposerLiveTelemetryStripView,
  resolveComposerTelemetryDisplay,
} from "./ComposerLiveTelemetryStrip";
import {
  clearSessionTelemetryDetails,
  deriveSessionTelemetryDetail,
  getSessionTelemetryDetail,
} from "./sessionTelemetry.logic";
import { useSessionCallTelemetry } from "./useSessionCallTelemetry";

const PROVIDERS: readonly ServerProvider[] = [
  {
    instanceId: "inst-agy",
    driver: "antigravity",
    displayName: "Antigravity",
    enabled: true,
    models: [
      {
        slug: "MODEL_PLACEHOLDER_M535",
        name: "Gemini 4 Neon (XHigh)",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "MODEL_PLACEHOLDER_M536",
        name: "Gemini 4 Hydrogen (XHigh)",
        isCustom: false,
        capabilities: null,
      },
    ],
  } as unknown as ServerProvider,
];

function buildActiveMultiModelDisplay() {
  const detail = deriveSessionTelemetryDetail({
    threadId: "thread-browser",
    serverProjection: {
      runs: [{ id: "run-1", ordinal: 1, status: "completed" } as unknown as OrchestrationV2Run],
      providerTurns: [
        {
          id: "turn-1",
          status: "completed",
          model: "MODEL_PLACEHOLDER_M535",
          startedAt: "2026-11-23T10:00:00.000Z",
          completedAt: "2026-11-23T10:00:10.000Z",
          turnTokenUsage: {
            usageScope: "main_agent",
            hasSubagents: true,
            usageStatus: "complete",
            inputTokens: 189_200_000,
            cachedInputTokens: 181_000_000,
            cacheCreationTokens: 0,
            outputTokens: 700_000,
            reasoningTokens: 300_000,
            models: ["MODEL_PLACEHOLDER_M535"],
            otherUsage: { inputTokens: 1_800_000_000, outputTokens: 30_924_086 },
          },
        } as unknown as OrchestrationV2ProviderTurn,
        {
          id: "turn-2",
          status: "completed",
          model: "MODEL_PLACEHOLDER_M536",
          startedAt: "2026-11-23T10:05:00.000Z",
          completedAt: "2026-11-23T10:05:05.000Z",
          turnTokenUsage: {
            usageScope: "main_agent",
            hasSubagents: false,
            usageStatus: "complete",
            inputTokens: 53_565_613,
            cachedInputTokens: 51_324_662,
            cacheCreationTokens: 0,
            outputTokens: 234_387,
            reasoningTokens: 131_226,
            models: ["MODEL_PLACEHOLDER_M536"],
          },
        } as unknown as OrchestrationV2ProviderTurn,
      ],
      subagents: [
        {
          id: "sub-1",
          runId: "run-1",
          origin: "provider_native",
          status: "completed",
          childThreadId: null,
          startedAt: null,
          completedAt: null,
          updatedAt: "2026-11-23T10:01:00.000Z",
        } as unknown as OrchestrationV2Subagent,
      ],
      turnItems: [],
      messages: [],
      nodes: [],
    },
    activeContextWindow: {
      usedTokens: 132_400,
      maxTokens: 512_000,
    } as ContextWindowSnapshot,
    providerStatuses: PROVIDERS,
    activeProvider: "antigravity",
    activeModel: "MODEL_PLACEHOLDER_M535",
  });

  return resolveComposerTelemetryDisplay(
    null,
    { usedTokens: 132_400, maxTokens: 512_000 } as ContextWindowSnapshot,
    {
      threadId: "thread-browser",
      detail,
      mergedUsage: {
        totalTokens: 3_300_000_000,
        uncachedInputTokens: 200_000_000,
        cachedInputTokens: 3_100_000_000,
        cacheCreationTokens: 0,
        daily: [
          { day: "2026-11-01", costUsd: 1, totalTokens: 2_902_400_000, byProvider: new Map() },
          { day: "2026-11-23", costUsd: 1, totalTokens: 397_600_000, byProvider: new Map() },
        ],
      },
      todayDay: "2026-11-23",
      providerStatuses: PROVIDERS,
    },
  );
}

describe("ComposerLiveTelemetryStrip 3 independent popovers (browser)", () => {
  it("opens 3 independent portal popovers with mutual exclusion, Escape & click-outside dismiss, and usage navigation", async () => {
    initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
    const onOpenUsage = vi.fn();
    const display = buildActiveMultiModelDisplay();

    // Mount inside an overflow-hidden bottom bar to verify Portal prevents clipping & keeps within viewport.
    await using screen = await render(
      <GTProvider locale="zh" translations={{}}>
        <div data-testid="outside-area" className="flex h-screen w-screen flex-col justify-end p-4">
          <div className="flex w-full justify-end overflow-hidden rounded-lg border p-2">
            <ComposerLiveTelemetryStripView display={display} compact onOpenUsage={onOpenUsage} />
          </div>
        </div>
      </GTProvider>,
    );

    const statsTrigger = document.querySelector<HTMLButtonElement>(
      '[data-telemetry-trigger="stats"]',
    );
    const tokensTrigger = document.querySelector<HTMLButtonElement>(
      '[data-telemetry-trigger="tokens"]',
    );
    const contextTrigger = document.querySelector<HTMLButtonElement>(
      '[data-telemetry-trigger="context"]',
    );
    expect(statsTrigger).toBeTruthy();
    expect(tokensTrigger).toBeTruthy();
    expect(contextTrigger).toBeTruthy();

    // 1. Click Trigger 1 → opens Popover 1 (Session Stats)
    await userEvent.click(statsTrigger!);
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="stats"]'))
      .toBeTruthy();
    expect(document.querySelector('[data-telemetry-popover="tokens"]')).toBeNull();
    expect(document.querySelector('[data-telemetry-popover="context"]')).toBeNull();

    const statsPopup = document.querySelector<HTMLElement>('[data-telemetry-popover="stats"]')!;
    expect(statsPopup.textContent).toContain("会话统计");
    expect(statsPopup.textContent).toContain("正文 / 思考输出");
    const statsRect = statsPopup.getBoundingClientRect();
    expect(statsRect.left).toBeGreaterThanOrEqual(0);
    expect(statsRect.right).toBeLessThanOrEqual(window.innerWidth + 1);

    // 2. Click Trigger 2 while Popover 1 is open → mutually excludes Popover 1 & opens Popover 2
    await userEvent.click(tokensTrigger!);
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="tokens"]'))
      .toBeTruthy();
    await expect.poll(() => document.querySelector('[data-telemetry-popover="stats"]')).toBeNull();

    const tokensPopup = document.querySelector<HTMLElement>('[data-telemetry-popover="tokens"]')!;
    expect(tokensPopup.textContent).toContain("Token 用量");
    expect(tokensPopup.textContent).toContain("多模型分布");
    expect(tokensPopup.textContent).toContain("Gemini 4 Neon (XHigh)");
    expect(tokensPopup.textContent).toContain("今日用量");
    expect(tokensPopup.textContent).toContain("397.6M");
    expect(tokensPopup.textContent).toContain("本月用量");
    expect(tokensPopup.textContent).toContain("3.3B");
    expect(tokensPopup.querySelector('[data-telemetry-model-donut="true"]')).toBeTruthy();

    // 3. Click Trigger 3 while Popover 2 is open → mutually excludes Popover 2 & opens Popover 3
    await userEvent.click(contextTrigger!);
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="context"]'))
      .toBeTruthy();
    await expect.poll(() => document.querySelector('[data-telemetry-popover="tokens"]')).toBeNull();

    const contextPopup = document.querySelector<HTMLElement>('[data-telemetry-popover="context"]')!;
    expect(contextPopup.getAttribute("aria-label")).toBe("上下文窗口");
    expect(contextPopup.querySelector('[data-context-vial="true"]')).toBeTruthy();
    expect(contextPopup.querySelector('[data-context-stacked-bar="true"]')).toBeTruthy();
    expect(contextPopup.textContent).toContain("上下文拆解");
    expect(contextPopup.textContent).toContain("25.9%");
    expect(contextPopup.textContent).toContain("132.4k / 512.0k");
    expect(contextPopup.textContent).toContain("128k");
    expect(contextPopup.textContent).toContain("256k");
    expect(contextPopup.textContent).toContain("384k");
    expect(contextPopup.textContent).toContain("剩余空间");
    expect(contextPopup.textContent).toContain("当前会话采样了多个模型");

    // Hover a breakdown row and verify interactive highlight propagates to bar slice & liquid vial stratum
    const usedRow = contextPopup.querySelector<HTMLElement>('[data-context-category-row="used"]');
    expect(usedRow).toBeTruthy();
    await userEvent.hover(usedRow!);
    await expect
      .poll(() => contextPopup.querySelector('[data-context-vial-stratum="used"]'))
      .toBeTruthy();
    await expect
      .poll(() =>
        contextPopup
          .querySelector('[data-context-bar-slice="used"]')
          ?.getAttribute("data-highlighted"),
      )
      .toBe("true");

    // 4. Press Escape → closes Popover 3
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="context"]'))
      .toBeNull();

    // 5. Re-open Popover 2 and click outside → closes Popover 2
    await userEvent.click(tokensTrigger!);
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="tokens"]'))
      .toBeTruthy();
    await userEvent.click(screen.getByTestId("outside-area"), { position: { x: 10, y: 10 } });
    await expect.poll(() => document.querySelector('[data-telemetry-popover="tokens"]')).toBeNull();

    // 6. Re-open Popover 2 and click "查看用量统计" → calls onOpenUsage & closes Popover 2
    await userEvent.click(tokensTrigger!);
    await expect
      .poll(() => document.querySelector('[data-telemetry-open-usage="true"]'))
      .toBeTruthy();
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-telemetry-open-usage="true"]')!,
    );
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
    await expect.poll(() => document.querySelector('[data-telemetry-popover="tokens"]')).toBeNull();
  });

  it("never triggers a render loop in useUsage when given a fresh equivalent window object each render (Defect 2.4)", async () => {
    let renderCount = 0;
    function FreshWindowProbe({ tick }: { readonly tick: number }) {
      renderCount += 1;
      // Intentionally pass a brand-new UsageSummaryInput object literal on every render!
      const usage = useUsage({
        sinceDay: UsageDay.make("2026-11-01"),
        untilDay: UsageDay.make("2026-11-30"),
        timeZone: "UTC",
        resolution: "day",
      });
      return (
        <div data-testid="usage-probe" data-tick={tick}>
          {usage.environments.length}
        </div>
      );
    }

    await using screen = await render(<FreshWindowProbe tick={1} />);
    expect(screen.getByTestId("usage-probe")).toBeTruthy();
    const initialRenders = renderCount;
    expect(initialRenders).toBeLessThan(8);

    await screen.rerender(<FreshWindowProbe tick={2} />);
    expect(renderCount - initialRenders).toBeLessThan(4);
  });

  it("clears per-thread telemetry refs and releases publishedSessionDetails on thread switch and unmount (L10 + L12)", async () => {
    clearSessionTelemetryDetails();
    function TelemetryHarness({ threadId }: { readonly threadId: string }) {
      useSessionCallTelemetry({
        threadId,
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
        serverProjection: {
          runs: [
            {
              id: `run-${threadId}`,
              ordinal: 1,
              status: "completed",
            } as unknown as OrchestrationV2Run,
          ],
          providerTurns: [],
          turnItems: [],
          messages: [],
          subagents: [],
          nodes: [],
        },
        activeContextWindow: {
          usedTokens: 42_000,
          maxTokens: 200_000,
        } as ContextWindowSnapshot,
        isWorking: false,
        activeWorkStartedAt: null,
      });
      useEffect(() => () => undefined, [threadId]);
      return <div data-testid="telemetry-harness">{threadId}</div>;
    }

    const screen = await render(<TelemetryHarness threadId="thread-clean-1" />);
    await expect
      .poll(() => getSessionTelemetryDetail("thread-clean-1")?.threadId ?? null)
      .toBe("thread-clean-1");

    await screen.rerender(<TelemetryHarness threadId="thread-clean-2" />);
    await expect
      .poll(() => getSessionTelemetryDetail("thread-clean-2")?.threadId ?? null)
      .toBe("thread-clean-2");
    expect(getSessionTelemetryDetail("thread-clean-1")).toBeNull();

    await screen.unmount();
    expect(getSessionTelemetryDetail("thread-clean-2")).toBeNull();
  });
});
