import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type PrismuxDispatchEnvelope,
  type ServerProvider,
} from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { DraftId } from "../composerDraftStore";
import {
  PrismuxDispatchConfirmationBanner,
  buildDispatchModelSelection,
  cancelPrismuxDispatchViaHost,
  confirmPrismuxDispatchViaHost,
  dispatchStagedThreadTurn,
  formatDispatchCallerLabel,
  formatDispatchReplyChannelDetail,
  handlePrismuxDispatchEnvelope,
  isAntigravityDispatchProvider,
  shouldAutoSendDispatch,
  type DispatchExecutionDeps,
  type StagedPrismuxDispatch,
} from "./PrismuxIpcDispatchBridge";

const FIXED_ISO = "2026-11-25T09:10:00.000Z";

function makeEnvelope(overrides: Partial<PrismuxDispatchEnvelope> = {}): PrismuxDispatchEnvelope {
  return {
    taskId: "task-001",
    status: "dispatched",
    mode: "send",
    workspacePath: "D:\\workspace\\Prismux",
    worktreePath: null,
    prompt: "修复登录模块单测并验证通过",
    provider: "codex",
    modelId: "gpt-6.2-sol",
    reasoningEffort: "medium",
    callerKind: "secretary_qq",
    createdAt: FIXED_ISO,
    requiresHumanConfirmation: false,
    memoryContextSummary: null,
    replyChannel: { kind: "qq", targetId: "123456", label: "QQ 私聊" },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DispatchExecutionDeps> = {}) {
  const calls = {
    draftThreads: [] as Array<unknown[]>,
    modelSelections: [] as Array<unknown[]>,
    prompts: [] as Array<unknown[]>,
    openedTabs: [] as Array<unknown>,
    promotedTabs: [] as Array<unknown[]>,
    navigatedDrafts: [] as string[],
    navigatedThreads: [] as Array<{ environmentId: string; threadId: string }>,
    startedTurns: [] as Array<unknown>,
    stagedConfirmations: [] as StagedPrismuxDispatch[],
    autoSent: [] as Array<{ taskId: string; threadId: string }>,
    clearedDrafts: [] as string[],
    promotingDrafts: [] as string[],
    errors: [] as string[],
  };
  let storedPrompt: string | null = null;

  const deps: DispatchExecutionDeps = {
    resolveTargetProject: vi.fn(async () => ({
      environmentId: EnvironmentId.make("primary"),
      projectId: ProjectId.make("proj-1"),
      logicalProjectKey: "logical:proj-1",
      providers: [],
    })),
    allocateIds: () => ({
      draftId: "draft-fixed-1" as DraftId,
      threadId: ThreadId.make("thread-fixed-1"),
      messageId: MessageId.make("msg-fixed-1"),
    }),
    setLogicalProjectDraftThreadId: (...args) => {
      calls.draftThreads.push(args);
    },
    setModelSelection: (...args) => {
      calls.modelSelections.push(args);
    },
    setPrompt: (draftId, prompt) => {
      storedPrompt = prompt;
      calls.prompts.push([draftId, prompt]);
    },
    getPrompt: () => storedPrompt,
    markDraftThreadPromoting: (draftId) => {
      calls.promotingDrafts.push(draftId);
    },
    clearComposerContent: (draftId) => {
      storedPrompt = "";
      calls.clearedDrafts.push(draftId);
    },
    openWorkspaceDraftTab: (input) => {
      calls.openedTabs.push(input);
    },
    promoteWorkspaceDraftTab: (...args) => {
      calls.promotedTabs.push(args);
    },
    navigateToDraft: async (draftId) => {
      calls.navigatedDrafts.push(draftId);
    },
    navigateToThread: async (environmentId, threadId) => {
      calls.navigatedThreads.push({ environmentId, threadId });
    },
    startThreadTurn: vi.fn(async (input) => {
      calls.startedTurns.push(input);
      return { ok: true };
    }),
    onStagedForConfirmation: (staged) => {
      calls.stagedConfirmations.push(staged);
    },
    onAutoSent: (envelope, threadId) => {
      calls.autoSent.push({ taskId: envelope.taskId, threadId });
    },
    onError: (message) => {
      calls.errors.push(message);
    },
    ...overrides,
  };

  return {
    deps,
    calls,
    setLivePrompt: (next: string) => {
      storedPrompt = next;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PrismuxIpcDispatchBridge policy, Parameter Backdoor & Real-UI flow", () => {
  it("enforces auto-send vs human confirmation rules including remote personal AGY double-guard", () => {
    expect(isAntigravityDispatchProvider("antigravity")).toBe(true);
    expect(isAntigravityDispatchProvider("agy")).toBe(true);
    expect(isAntigravityDispatchProvider("gemini")).toBe(false);
    expect(isAntigravityDispatchProvider("codex")).toBe(false);

    // Remote QQ -> Codex auto-send allowed
    expect(shouldAutoSendDispatch(makeEnvelope())).toBe(true);
    // Human desktop -> Antigravity commander allowed
    expect(
      shouldAutoSendDispatch(
        makeEnvelope({
          provider: "antigravity",
          modelId: "antigravity-default",
          callerKind: "human_desktop",
          mode: "send",
          requiresHumanConfirmation: false,
        }),
      ),
    ).toBe(true);
    // Explicit draft_only or requiresHumanConfirmation NEVER auto-sends
    expect(shouldAutoSendDispatch(makeEnvelope({ mode: "draft_only" }))).toBe(false);
    expect(shouldAutoSendDispatch(makeEnvelope({ requiresHumanConfirmation: true }))).toBe(false);
    // Defense-in-depth: remote personal AGY NEVER auto-sends even if envelope falsely claims mode="send"
    expect(
      shouldAutoSendDispatch(
        makeEnvelope({
          provider: "antigravity",
          modelId: "antigravity-default",
          callerKind: "secretary_qq",
          mode: "send",
          requiresHumanConfirmation: false,
        }),
      ),
    ).toBe(false);
    expect(
      shouldAutoSendDispatch(
        makeEnvelope({
          provider: "agy",
          callerKind: "secretary_gmail",
          mode: "send",
          requiresHumanConfirmation: false,
        }),
      ),
    ).toBe(false);
    expect(
      shouldAutoSendDispatch(
        makeEnvelope({
          provider: "antigravity",
          callerKind: "cron",
          mode: "send",
          requiresHumanConfirmation: false,
        }),
      ),
    ).toBe(false);
  });

  it("applies Parameter Backdoor directly into T3 ModelSelection without GUI dropdown clicks", () => {
    const codexStandard = buildDispatchModelSelection({
      provider: "codex",
      modelId: "gpt-6.2-sol",
      reasoningEffort: "medium",
    });
    expect(codexStandard).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6.2-sol",
      options: [{ id: "reasoningEffort", value: "medium" }],
    });

    const codexHard = buildDispatchModelSelection({
      provider: "codex",
      modelId: "gpt-6.2-astra",
      reasoningEffort: "high",
    });
    expect(codexHard).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6.2-astra",
      options: [{ id: "reasoningEffort", value: "high" }],
    });

    const claudeSelection = buildDispatchModelSelection({
      provider: "claude-code",
      modelId: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(claudeSelection).toEqual({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
      options: [{ id: "effort", value: "high" }],
    });

    const defaultEffortSelection = buildDispatchModelSelection({
      provider: "antigravity",
      modelId: "antigravity-default",
      reasoningEffort: "default",
    });
    expect(defaultEffortSelection).toEqual({
      instanceId: ProviderInstanceId.make("antigravity"),
      model: "antigravity-default",
    });

    const customProviders = [
      {
        instanceId: ProviderInstanceId.make("antigravity"),
        driver: ProviderDriverKind.make("antigravity"),
        models: [
          {
            slug: "gemini-3-pro",
            capabilities: {
              optionDescriptors: [
                {
                  id: "thought_level",
                  label: "Thought Level",
                  type: "select" as const,
                  role: "reasoning" as const,
                  options: [{ id: "high", label: "High" }],
                },
              ],
            },
          },
        ],
      },
    ] as unknown as ReadonlyArray<ServerProvider>;

    const matchedDescriptorSelection = buildDispatchModelSelection(
      {
        provider: "agy",
        modelId: "gemini-3-pro",
        reasoningEffort: "high",
      },
      customProviders,
    );
    expect(matchedDescriptorSelection).toEqual({
      instanceId: ProviderInstanceId.make("antigravity"),
      model: "gemini-3-pro",
      options: [{ id: "thought_level", value: "high" }],
    });
  });

  it("auto-dispatches non-AGY send envelopes into visible workspace tab and triggers real thread turn", async () => {
    const { deps, calls } = makeDeps();
    const envelope = makeEnvelope({
      taskId: "task-codex-auto",
      mode: "send",
      provider: "codex",
      modelId: "gpt-6.2-astra",
      reasoningEffort: "high",
      worktreePath: "D:\\workspace\\Prismux\\.worktrees\\fix-auth",
      prompt: "排查并修复认证中间件超时问题",
    });

    const result = await handlePrismuxDispatchEnvelope(envelope, deps);

    expect(result.outcome).toBe("auto_sent");
    expect(calls.draftThreads).toHaveLength(1);
    expect(calls.modelSelections).toEqual([
      [
        "draft-fixed-1",
        {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6.2-astra",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        { explicit: true, replaceOptions: true },
      ],
    ]);
    expect(calls.prompts).toEqual([["draft-fixed-1", "排查并修复认证中间件超时问题"]]);
    expect(calls.openedTabs).toHaveLength(1);
    expect(calls.navigatedDrafts).toEqual(["draft-fixed-1"]);
    expect(calls.startedTurns).toHaveLength(1);
    expect(calls.promotedTabs).toHaveLength(1);
    expect(calls.navigatedThreads).toEqual([
      { environmentId: "primary", threadId: "thread-fixed-1" },
    ]);
    expect(calls.stagedConfirmations).toHaveLength(0);
    expect(calls.autoSent).toEqual([{ taskId: "task-codex-auto", threadId: "thread-fixed-1" }]);
  });

  it("stages draft_only / remote personal AGY envelopes without auto-sending and triggers real send only after confirmation", async () => {
    const { deps, calls, setLivePrompt } = makeDeps();
    const envelope = makeEnvelope({
      taskId: "task-agy-qq",
      status: "awaiting_human_confirmation",
      mode: "draft_only",
      provider: "antigravity",
      modelId: "antigravity-default",
      reasoningEffort: "high",
      callerKind: "secretary_qq",
      worktreePath: "D:\\workspace\\Prismux\\.worktrees\\qq-agy-ui",
      prompt: "用个人版 AGY 优化首页液态玻璃动效",
      requiresHumanConfirmation: true,
      memoryContextSummary: "主秘书偏好：保持 WCAG >= 4.5:1 对比度",
    });

    const stagedResult = await handlePrismuxDispatchEnvelope(envelope, deps);

    expect(stagedResult.outcome).toBe("staged_confirmation");
    expect(calls.startedTurns).toHaveLength(0);
    expect(calls.promotedTabs).toHaveLength(0);
    expect(calls.navigatedThreads).toHaveLength(0);
    expect(calls.stagedConfirmations).toHaveLength(1);
    expect(calls.prompts).toEqual([["draft-fixed-1", "用个人版 AGY 优化首页液态玻璃动效"]]);
    expect(calls.modelSelections).toEqual([
      [
        "draft-fixed-1",
        {
          instanceId: ProviderInstanceId.make("antigravity"),
          model: "antigravity-default",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        { explicit: true, replaceOptions: true },
      ],
    ]);

    // Human edits prompt in real composer, then confirms release
    setLivePrompt("用个人版 AGY 优化首页液态玻璃动效（已补充人工确认）");
    const sendAfterConfirm = await dispatchStagedThreadTurn(
      calls.stagedConfirmations[0]!,
      deps,
    );

    expect(sendAfterConfirm).toEqual({ ok: true });
    expect(calls.startedTurns).toHaveLength(1);
    expect((calls.startedTurns[0] as { prompt: string }).prompt).toBe(
      "用个人版 AGY 优化首页液态玻璃动效（已补充人工确认）",
    );
    expect(calls.clearedDrafts).toEqual(["draft-fixed-1"]);
    expect(calls.promotedTabs).toHaveLength(1);
    expect(calls.navigatedThreads).toEqual([
      { environmentId: "primary", threadId: "thread-fixed-1" },
    ]);
  });

  it("refuses auto-send for spoofed remote personal AGY even when mode is send", async () => {
    const { deps, calls } = makeDeps();
    const spoofed = makeEnvelope({
      taskId: "task-agy-spoof",
      mode: "send",
      requiresHumanConfirmation: false,
      provider: "antigravity",
      callerKind: "secretary_gmail",
    });

    const result = await handlePrismuxDispatchEnvelope(spoofed, deps);
    expect(result.outcome).toBe("staged_confirmation");
    expect(calls.startedTurns).toHaveLength(0);
    expect(calls.stagedConfirmations).toHaveLength(1);
  });

  it("proxies confirm and cancel actions through window.desktopBridge when available", async () => {
    const confirmPrismuxDispatch = vi.fn(async () => ({ ok: true }));
    const cancelPrismuxDispatch = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("window", {
      desktopBridge: {
        confirmPrismuxDispatch,
        cancelPrismuxDispatch,
      },
    });

    await expect(confirmPrismuxDispatchViaHost("task-confirm-1")).resolves.toEqual({ ok: true });
    await expect(cancelPrismuxDispatchViaHost("task-cancel-1")).resolves.toEqual({ ok: true });
    expect(confirmPrismuxDispatch).toHaveBeenCalledWith("task-confirm-1");
    expect(cancelPrismuxDispatch).toHaveBeenCalledWith("task-cancel-1");
  });

  it("renders unmistakable frosted-glass confirmation banner with required Chinese warning, source, worktree, model, and two explicit buttons", () => {
    const staged: StagedPrismuxDispatch = {
      envelope: makeEnvelope({
        taskId: "task-banner-agy",
        status: "awaiting_human_confirmation",
        mode: "draft_only",
        provider: "antigravity",
        modelId: "antigravity-default",
        reasoningEffort: "high",
        callerKind: "secretary_qq",
        worktreePath: "D:\\workspace\\Prismux\\.worktrees\\feat-glass",
        prompt: "重构侧边栏微光动效",
        requiresHumanConfirmation: true,
        memoryContextSummary: "记住保留深色毛玻璃可读性",
        replyChannel: { kind: "qq", targetId: "998877", label: "QQ 私聊" },
      }),
      environmentId: EnvironmentId.make("primary"),
      projectId: ProjectId.make("proj-1"),
      draftId: "draft-1" as DraftId,
      threadId: ThreadId.make("thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("antigravity"),
        model: "antigravity-default",
      },
      stagedAt: FIXED_ISO,
    };

    const html = renderToStaticMarkup(
      createElement(PrismuxDispatchConfirmationBanner, {
        items: [staged],
        busyTaskId: null,
        errorMessage: null,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );

    expect(html).toContain('data-pmx-dispatch-confirmation-banner="true"');
    expect(html).toContain(
      "远程请求调用个人版 Antigravity（AGY）——已就位至草稿标签页，等待本人二次确认放行",
    );
    expect(html).toContain("QQ 秘书");
    expect(html).toContain("D:\\workspace\\Prismux\\.worktrees\\feat-glass");
    expect(html).toContain("Antigravity");
    expect(html).toContain("antigravity-default");
    expect(html).toContain("确认放行并发送");
    expect(html).toContain("取消丢弃");
    expect(html).toContain("记住保留深色毛玻璃可读性");

    expect(formatDispatchCallerLabel(makeEnvelope({ callerKind: "secretary_gmail" }))).toBe(
      "Gmail 邮件",
    );
    expect(formatDispatchReplyChannelDetail("gmail:owner@example.com")).toBe(
      "gmail:owner@example.com",
    );
  });

  it("triggers onSubscriptionBlocked when dispatch fails with ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED", async () => {
    const blockedDetails: unknown[] = [];
    const { deps, calls } = makeDeps({
      startThreadTurn: vi.fn(async () => ({
        ok: false,
        error: JSON.stringify({
          ok: false,
          code: "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED",
          providerId: "codex",
          authMode: "subscription_oauth",
          authLabel: "官方个人订阅 OAuth（默认锁定）",
          settingsRoute: "/settings/providers#subscription-risk-waiver",
          message: "Blocked personal subscription orchestration",
        }),
      })),
      onSubscriptionBlocked: (detail) => {
        blockedDetails.push(detail);
      },
    });

    const result = await handlePrismuxDispatchEnvelope(
      makeEnvelope({
        taskId: "task-blocked-codex",
        provider: "codex",
        mode: "send",
        requiresHumanConfirmation: false,
      }),
      deps,
    );

    expect(result.outcome).toBe("failed");
    expect(calls.errors).toHaveLength(0);
    expect(blockedDetails).toEqual([
      expect.objectContaining({
        code: "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED",
        providerId: "codex",
        authMode: "subscription_oauth",
        authLabel: "官方个人订阅 OAuth（默认锁定）",
        settingsRoute: "/settings/providers#subscription-risk-waiver",
      }),
    ]);
  });
});
