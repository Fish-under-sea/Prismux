import { scopeThreadRef } from "@prismux/client-runtime/environment";
import {
  type ComposerContextId,
  EnvironmentId,
  type OrchestrationMessageContext,
  ProviderInstanceId,
  type RuntimeMode,
  ThreadId,
} from "@prismux/core-contracts";
import {
  BTW_GUARDRAIL_CONTEXT_KIND,
  projectComposerContextForProvider,
} from "@prismux/core-shared/composerContextReferences";
import { parseSideChatCommand } from "@prismux/core-shared/composerTrigger";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("gt-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gt-react")>();
  return {
    ...actual,
    useGT: () => (text: string) => text,
    useMessages: () => (text: string) => text,
    T: ({ children }: { children?: unknown }) => children ?? null,
    Var: ({ children }: { children?: unknown }) => children ?? null,
  };
});

vi.mock("../ChatView", () => ({
  default: () => null,
}));

import { useComposerDraftStore } from "../../composerDraftStore";
import { TooltipProvider } from "../ui/tooltip";
import {
  BTW_READONLY_GUARDRAIL_CONTEXT_ID,
  BTW_READONLY_RUNTIME_MODE,
  BTW_READONLY_SYSTEM_INSTRUCTION,
  DEFAULT_BTW_THREAD_TITLE,
  attachBtwReadOnlyGuardrailContext,
  buildBtwReadOnlyGuardrailRecord,
  deriveBtwThreadTitle,
  hasUserVisibleMessageContext,
  isBtwSideThread,
  isLegacySideChatPlaceholderTitle,
  normalizeBtwDisplayTitle,
  resolveBtwRuntimeMode,
} from "./btwMode";
import { ComposerFooterModeControls } from "./ComposerFooterControls";
import { SideChatEmptySurface } from "./RightPanelEmptySurfaces";
import { SideThreadBtwHeader } from "./SideThreadPane";
import { resolveRuntimeModeOption } from "./runtimeModeConfig";

describe("1:1 Antigravity Native /btw (Side Question) Mode", () => {
  beforeEach(() => {
    useComposerDraftStore.setState(useComposerDraftStore.getInitialState());
  });

  it("forces read-only approval-required runtimeMode even when parent runs in full-access / auto / auto-accept-edits", () => {
    const parentModes: ReadonlyArray<RuntimeMode | undefined> = [
      undefined,
      "approval-required",
      "auto-accept-edits",
      "auto",
      "full-access",
    ];
    for (const parentMode of parentModes) {
      expect(resolveBtwRuntimeMode(parentMode)).toBe("approval-required");
      expect(resolveBtwRuntimeMode(parentMode)).toBe(BTW_READONLY_RUNTIME_MODE);
    }
  });

  it("recognizes /btw and /side commands with or without arguments", () => {
    expect(parseSideChatCommand("/btw 为什么这里需要 useStableCallback？")).toEqual({
      prompt: "为什么这里需要 useStableCallback？",
    });
    expect(parseSideChatCommand("/btw")).toEqual({ prompt: "" });
    expect(parseSideChatCommand("/side check git diff")).toEqual({ prompt: "check git diff" });
    expect(parseSideChatCommand("/side")).toEqual({ prompt: "" });
    expect(parseSideChatCommand("normal message")).toBeNull();
  });

  it("distinguishes BTW side threads from main threads and subagent threads", () => {
    expect(isBtwSideThread({ lineage: { sideChat: true } })).toBe(true);
    expect(isBtwSideThread({ lineage: { sideChat: false } })).toBe(false);
    expect(isBtwSideThread({ lineage: {} })).toBe(false);
    expect(isBtwSideThread(null)).toBe(false);
    expect(isBtwSideThread(undefined)).toBe(false);
  });

  it("derives clean BTW titles from questions and never returns raw hardcoded Side chat", () => {
    expect(deriveBtwThreadTitle("为什么这里用 useStableCallback？")).toBe(
      "为什么这里用 useStableCallback？",
    );
    expect(deriveBtwThreadTitle("/btw 检查一下 RightPanelTabs 的渲染顺序\n第二行补充")).toBe(
      "检查一下 RightPanelTabs 的渲染顺序",
    );
    expect(deriveBtwThreadTitle("/side   how does handoff work?  ")).toBe(
      "how does handoff work?",
    );
    expect(deriveBtwThreadTitle("")).toBe(DEFAULT_BTW_THREAD_TITLE);
    expect(deriveBtwThreadTitle("Side chat")).toBe(DEFAULT_BTW_THREAD_TITLE);
    expect(deriveBtwThreadTitle("   ")).toBe(DEFAULT_BTW_THREAD_TITLE);

    const longQuestion = "这是一个超过四十四个字符的非常长的旁路提问用来验证截断逻辑是否正常追加省略号而不产生越界问题";
    const truncated = deriveBtwThreadTitle(longQuestion);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.length).toBe(44);

    expect(isLegacySideChatPlaceholderTitle("Side chat")).toBe(true);
    expect(isLegacySideChatPlaceholderTitle("")).toBe(true);
    expect(isLegacySideChatPlaceholderTitle("为什么这里用 WAL？")).toBe(false);

    expect(normalizeBtwDisplayTitle("Side chat")).toBe("旁路提问");
    expect(normalizeBtwDisplayTitle("Side chat", "Side question")).toBe("Side question");
    expect(normalizeBtwDisplayTitle("分析内存泄漏")).toBe("分析内存泄漏");
  });

  it("attaches invisible read-only BTW guardrail via message.context while keeping message.text 100% clean", () => {
    const rawQuestion = "为什么 ProviderTurnStartService 要调用 projectComposerContextForProvider？";
    const existingContext: OrchestrationMessageContext = {
      version: 1,
      records: [
        {
          version: 1,
          kind: "mention",
          contextId: "mention_file1" as ComposerContextId,
          label: "ProviderTurnStartService.ts",
          path: "apps/server/src/orchestration-v2/ProviderTurnStartService.ts",
        },
      ],
    };

    const guarded = attachBtwReadOnlyGuardrailContext(existingContext, {
      contextSummary: "当前会话：旁路提问架构升级",
    });

    // Preserves existing user records without mutating input array
    expect(existingContext.records).toHaveLength(1);
    expect(guarded.records).toHaveLength(2);
    expect(guarded.records[1]).toEqual(
      buildBtwReadOnlyGuardrailRecord({ contextSummary: "当前会话：旁路提问架构升级" }),
    );
    expect(guarded.records[1]?.kind).toBe(BTW_GUARDRAIL_CONTEXT_KIND);
    expect(guarded.records[1]?.contextId).toBe(BTW_READONLY_GUARDRAIL_CONTEXT_ID);

    // Idempotent when called twice (never duplicates contextId)
    const guardedTwice = attachBtwReadOnlyGuardrailContext(guarded);
    expect(
      guardedTwice.records.filter((r) => r.contextId === BTW_READONLY_GUARDRAIL_CONTEXT_ID),
    ).toHaveLength(1);

    // User-visible context helper ignores the invisible BTW guardrail record
    const guardrailOnly = attachBtwReadOnlyGuardrailContext(undefined);
    expect(hasUserVisibleMessageContext(guardrailOnly)).toBe(false);
    expect(hasUserVisibleMessageContext(guarded)).toBe(true);

    // Provider prompt projection delivers the read-only instruction behind the scenes
    // even when `message.text` contains zero inline markers or ugly prefixes!
    const projected = projectComposerContextForProvider({
      text: rawQuestion,
      records: guarded.records,
    });
    expect(projected.startsWith(rawQuestion)).toBe(true);
    expect(projected).not.toContain("[旁路只读提问]");
    expect(projected).toContain('<prismux_context version="1">');
    expect(projected).toContain(
      `<context kind="${BTW_GUARDRAIL_CONTEXT_KIND}" id="${BTW_READONLY_GUARDRAIL_CONTEXT_ID}">`,
    );
    expect(projected).toContain("MUST NOT modify, create, or delete any workspace files");
    expect(projected).toContain("git status");
    expect(projected).toContain("Main conversation context summary:");
    expect(projected).toContain("当前会话：旁路提问架构升级");
    expect(BTW_READONLY_SYSTEM_INSTRUCTION).toContain("MUST NOT modify, create, or delete");
  });

  it("isolates BTW model selection per threadRef without mutating the parent thread's model", () => {
    const envId = EnvironmentId.make("env-1");
    const parentRef = scopeThreadRef(envId, ThreadId.make("main-thread"));
    const btwRef = scopeThreadRef(envId, ThreadId.make("btw-thread-1"));
    const agyInstance = ProviderInstanceId.make("antigravity");
    const claudeInstance = ProviderInstanceId.make("claudeAgent");

    const store = useComposerDraftStore.getState();
    store.setModelSelection(parentRef, { instanceId: agyInstance, model: "gemini-3-pro" });
    // Inherit parent model initially on BTW launch
    store.setModelSelection(btwRef, { instanceId: agyInstance, model: "gemini-3-pro" });
    store.setRuntimeMode(btwRef, resolveBtwRuntimeMode("full-access"));

    // User switches model INSIDE BTW tab
    store.setModelSelection(btwRef, { instanceId: claudeInstance, model: "claude-sonnet-4-6" });

    const parentDraft = useComposerDraftStore.getState().getComposerDraft(parentRef);
    const btwDraft = useComposerDraftStore.getState().getComposerDraft(btwRef);

    expect(parentDraft?.activeProvider).toBe(agyInstance);
    expect(parentDraft?.modelSelectionByProvider[agyInstance]?.model).toBe("gemini-3-pro");
    expect(btwDraft?.activeProvider).toBe(claudeInstance);
    expect(btwDraft?.modelSelectionByProvider[claudeInstance]?.model).toBe("claude-sonnet-4-6");
    expect(btwDraft?.runtimeMode).toBe("approval-required");
  });

  it("locks permission controls to a read-only lock badge inside BTW side-question tabs", () => {
    const options = [
      resolveRuntimeModeOption("approval-required"),
      resolveRuntimeModeOption("full-access"),
    ];

    const lockedHtml = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerFooterModeControls, {
          runtimeMode: "approval-required",
          runtimeModeOptions: options,
          readOnlyBtwLock: true,
          onRuntimeModeChange: () => {},
        }),
      ),
    );
    expect(lockedHtml).toContain('data-btw-readonly-lock="true"');
    expect(lockedHtml).toContain('data-permission-mode="approval-required"');
    expect(lockedHtml).toContain(">只读<");
    expect(lockedHtml).not.toContain('data-composer-permission-shield="true"');
    expect(lockedHtml).not.toContain("Full access");

    const normalHtml = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerFooterModeControls, {
          runtimeMode: "full-access",
          runtimeModeOptions: options,
          readOnlyBtwLock: false,
          onRuntimeModeChange: () => {},
        }),
      ),
    );
    expect(normalHtml).toContain('data-composer-permission-shield="true"');
    expect(normalHtml).not.toContain('data-btw-readonly-lock="true"');
  });

  it("renders polished 1:1 AGY Native BTW header with BTW · 只读 badge, + 新建, 引用回主会话, delete & close", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(SideThreadBtwHeader, {
          title: "为什么这里用 WAL 模式？",
          canAddToChat: true,
          canDelete: true,
          onNewSideChat: () => {},
          onAddToChat: () => {},
          onDelete: () => {},
          onClose: () => {},
        }),
      ),
    );

    expect(html).toContain('data-btw-header="1"');
    expect(html).toContain("为什么这里用 WAL 模式？");
    expect(html).toContain('data-btw-readonly-badge="1"');
    expect(html).toContain("BTW · 只读");
    expect(html).toContain('data-btw-new-button="1"');
    expect(html).toContain(">新建<");
    expect(html).toContain('data-btw-cite-button="1"');
    expect(html).toContain(">引用回主会话<");
    expect(html).toContain('data-btw-delete-button="1"');
    expect(html).toContain('data-btw-close-button="1"');
  });

  it("renders live BTW quick-ask surface on BOTH active server threads and blank draft threads", () => {
    const envId = EnvironmentId.make("env-1");
    const mainRef = scopeThreadRef(envId, ThreadId.make("draft-1"));

    // 1. Blank draft thread: still live & interactive, gentle draft note, zero dead disabled screen
    const draftHtml = renderToStaticMarkup(
      createElement(SideChatEmptySurface, {
        canStart: false,
        isServerThread: false,
        disabledReason: "发送第一条消息后即可开启完整旁路提问。",
        threadRef: mainRef,
      }),
    );
    expect(draftHtml).toContain('data-testid="right-panel-side-chat-empty-state"');
    expect(draftHtml).toContain("旁路提问（BTW）");
    expect(draftHtml).toContain("BTW · 只读");
    expect(draftHtml).toContain('data-btw-empty-composer="1"');
    expect(draftHtml).toContain("暂存旁路提问");
    expect(draftHtml).toContain("当前为主会话草稿");
    expect(draftHtml).toContain("发送第一条消息后即可开启完整旁路提问。");
    expect(draftHtml).not.toContain(">侧聊<");

    // 2. Ready server thread with existing BTW side threads
    const readyHtml = renderToStaticMarkup(
      createElement(SideChatEmptySurface, {
        canStart: true,
        isServerThread: true,
        disabledReason: null,
        threadRef: mainRef,
        onStart: () => {},
        onQuickAsk: () => true,
        existingSideThreads: [
          {
            threadId: ThreadId.make("btw-existing-1"),
            title: "检查同步锁逻辑",
            running: true,
          },
        ],
        onOpenExistingSideThread: () => {},
      }),
    );
    expect(readyHtml).toContain("旁路提问（BTW）");
    expect(readyHtml).toContain("发送旁路提问");
    expect(readyHtml).toContain("开启旁路提问");
    expect(readyHtml).toContain('data-btw-existing-list="1"');
    expect(readyHtml).toContain("检查同步锁逻辑");
  });
});
