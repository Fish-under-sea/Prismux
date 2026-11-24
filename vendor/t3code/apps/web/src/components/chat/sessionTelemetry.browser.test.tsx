import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2Subagent,
  ServerProvider,
} from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  ComposerLiveTelemetryStripView,
  resolveComposerTelemetryDisplay,
} from "./ComposerLiveTelemetryStrip";
import { deriveSessionTelemetryDetail } from "./sessionTelemetry.logic";

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
        <div
          data-testid="outside-area"
          className="flex h-screen w-screen flex-col justify-end p-4"
        >
          <div className="flex w-full justify-end overflow-hidden rounded-lg border p-2">
            <ComposerLiveTelemetryStripView
              display={display}
              compact
              onOpenUsage={onOpenUsage}
            />
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
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="stats"]'))
      .toBeNull();

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
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="tokens"]'))
      .toBeNull();

    const contextPopup = document.querySelector<HTMLElement>(
      '[data-telemetry-popover="context"]',
    )!;
    expect(contextPopup.textContent).toContain("上下文窗口");
    expect(contextPopup.textContent).toContain("26% 已用（剩余 74%）");
    expect(contextPopup.textContent).toContain("132.4K / 512K tok");
    expect(contextPopup.textContent).toContain("当前会话采样了多个模型");

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
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="tokens"]'))
      .toBeNull();

    // 6. Re-open Popover 2 and click "查看用量统计" → calls onOpenUsage & closes Popover 2
    await userEvent.click(tokensTrigger!);
    await expect
      .poll(() => document.querySelector('[data-telemetry-open-usage="true"]'))
      .toBeTruthy();
    await userEvent.click(
      document.querySelector<HTMLButtonElement>('[data-telemetry-open-usage="true"]')!,
    );
    expect(onOpenUsage).toHaveBeenCalledTimes(1);
    await expect
      .poll(() => document.querySelector('[data-telemetry-popover="tokens"]'))
      .toBeNull();
  });
});
