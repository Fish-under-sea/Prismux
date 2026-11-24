import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { getTranslationsSnapshot, GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../i18n/locales";
import { m, setActiveLocale } from "../i18n/messages";
import zhCatalog from "../i18n/translations/zh.json";
import { DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER, useRightPanelStore } from "../rightPanelStore";
import {
  LinkedItemsEmptySurface,
  PullRequestEmptySurface,
  SideChatEmptySurface,
} from "./chat/RightPanelEmptySurfaces";
import {
  buildRightPanelActivityActions,
  resolvePullRequestTabLink,
  rightPanelActivityButtonClass,
  RightPanelTabs,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
} from "./RightPanelTabs";

function shortcutEvent(
  key: string,
  overrides: Partial<Parameters<typeof surfaceShortcutActionForKey>[1]> = {},
): Parameters<typeof surfaceShortcutActionForKey>[1] {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ...overrides,
  };
}

describe("surface shortcuts", () => {
  const actions = [
    { shortcut: "B", available: true, label: "Browser" },
    { shortcut: "D", available: false, label: "Diff" },
    { shortcut: "T", available: true, label: "Terminal" },
    { shortcut: "M", available: true, label: "Device" },
  ] as const;

  it("falls back to the physical key when the layout types a non-Latin letter or mark", () => {
    // Ukrainian layout: the B key types "и".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("\u0438", { code: "KeyB" }))).toBe(
      actions[0],
    );
    // Greek layout: the B key types "β".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("\u03b2", { code: "KeyB" }))).toBe(
      actions[0],
    );
    // Thai layout: the B key types the vowel sign "\u0e34", a combining mark.
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("\u0e34", { code: "KeyB" }))).toBe(
      actions[0],
    );
    // Arabic (101) layout: the B key types lam alef "\u0644\u0627", two code points.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("\u0644\u0627", { code: "KeyB" })),
    ).toBe(actions[0]);
    // Ukrainian layout: the D key types "\u0432", but the Diff surface is unavailable.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("\u0432", { code: "KeyD" })),
    ).toBeNull();
  });

  it("follows the typed letter on Latin layouts that move it", () => {
    // Dvorak: the key at QWERTY B types "x", and "b" sits on QWERTY N.
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("x", { code: "KeyB" }))).toBeNull();
    // The same key with Shift or Caps Lock types "X".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("X", { code: "KeyB" }))).toBeNull();
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("b", { code: "KeyN" }))).toBe(
      actions[0],
    );
  });

  it("keeps accented Latin letters typed on a letter key", () => {
    // Bépo: the T key types "è".
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("\u00e8", { code: "KeyT" })),
    ).toBeNull();
  });

  it("keeps punctuation typed on a letter key", () => {
    // French AZERTY: the M key types ",".
    expect(surfaceShortcutActionForKey(actions, shortcutEvent(",", { code: "KeyM" }))).toBeNull();
  });

  it("keeps a dead key on a letter key", () => {
    // A dead key starts an accented letter on a Latin layout.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("Dead", { code: "KeyT" })),
    ).toBeNull();
  });

  it("leaves modified, composing, and already-handled key events alone", () => {
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("b", { metaKey: true }))).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { isComposing: true })),
    ).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { defaultPrevented: true })),
    ).toBeNull();
  });

  it("leaves AltGr text alone unless it is a plain letter", () => {
    const getModifierState = (key: string) => key === "AltGraph";
    // German layout: AltGr+M types "\u00b5" and sets only AltGraph on Linux and Windows.
    expect(
      surfaceShortcutActionForKey(
        actions,
        shortcutEvent("\u00b5", { code: "KeyM", getModifierState }),
      ),
    ).toBeNull();
    // Finnish layout: AltGr+B types "b", which still matches, as it does in keybindings.ts.
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { code: "KeyB", getModifierState })),
    ).toBe(actions[0]);
  });
});

describe("surface shortcut typing contexts", () => {
  const makeTarget = (matches: string | null) => ({
    closest(selectors: string) {
      if (matches === null || !selectors.includes(matches)) return null;
      return {};
    },
  });

  it("treats form fields and every editable region as typing contexts", () => {
    expect(surfaceShortcutTargetsTypingContext(makeTarget("input"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("textarea"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("select"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("[contenteditable]"))).toBe(true);
  });
});

describe("pull request tab snapshots", () => {
  const environmentId = EnvironmentId.make("local");
  const link: ThreadPullRequestLink = {
    host: "github.com",
    repository: "acme/api",
    number: 7,
    url: "https://github.com/acme/api/pull/7",
    source: "manual",
    linkedAt: "2026-01-01T00:00:00Z",
    stack: null,
    snapshot: null,
  };
  it("keeps unknown linked state authoritative and scopes matches to environment and host", () => {
    const threads = [{ environmentId, pullRequests: [link] }];
    expect(resolvePullRequestTabLink(threads, environmentId, "github.com", link)).toBe(link);
    expect(
      resolvePullRequestTabLink(threads, EnvironmentId.make("remote"), "github.com", link),
    ).toBeUndefined();
    expect(
      resolvePullRequestTabLink(threads, environmentId, "github.enterprise.test", link),
    ).toBeUndefined();
  });
  it("uses the newest snapshot when several threads link the same PR", () => {
    const snapshot = {
      state: "merged" as const,
      title: "API",
      headBranch: "api",
      baseBranch: "main",
      isDraft: false,
      updatedAt: null,
      syncedAt: "2026-02-01T00:00:00Z",
    };
    const newer = { ...link, snapshot };
      expect(
      resolvePullRequestTabLink(
        [{ environmentId, pullRequests: [link, newer] }],
        environmentId,
        "github.com",
        link,
      ),
    ).toBe(newer);
  });
});

describe("RightPanel Activity Bar 9-item strict order, labels & 3-mode highlight", () => {
  beforeAll(async () => {
    await initializeGT({
      defaultLocale: DEFAULT_LOCALE,
      locales: [...SUPPORTED_LOCALES],
      loadTranslations: async (locale) => (locale === "zh" ? zhCatalog : {}),
      cacheExpiryTime: null,
    });
    await getTranslationsSnapshot("zh");
    setActiveLocale("zh");
  });

  afterAll(() => {
    setActiveLocale(DEFAULT_LOCALE);
  });

  const makeHandlers = () => ({
    onPullRequest: vi.fn(),
    onDiff: vi.fn(),
    onFiles: vi.fn(),
    onTerminal: vi.fn(),
    onSideChat: vi.fn(),
    onPreview: vi.fn(),
    onMobileSimulator: vi.fn(),
    onPullRequests: vi.fn(),
    onWallpaper: vi.fn(),
  });

  const allAvailable = {
    pullRequest: true,
    diff: true,
    files: true,
    terminal: true,
    sideChat: true,
    preview: true,
    mobileSimulator: true,
    pullRequests: true,
    wallpaper: true,
  };

  it("builds the exact 9-item Chinese order with zero '设备' and strictly '手机模拟' (no '器')", () => {
    const handlers = makeHandlers();
    const actions = buildRightPanelActivityActions({
      order: DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
      focusedSurfaceKind: "pull-request-empty",
      mobileSimulatorIdleActive: false,
      resolveMessage: m,
      availability: allAvailable,
      handlers,
    });

    expect(actions.map((item) => item.id)).toEqual([
      "pull-request",
      "diff",
      "files",
      "terminal",
      "side-chat",
      "preview",
      "mobile-simulator",
      "pull-requests",
      "wallpaper",
    ]);
    expect(actions.map((item) => item.label)).toEqual([
      "PR",
      "差异",
      "文件",
      "终端",
      "侧聊",
      "浏览器",
      "手机模拟",
      "已关联项",
      "壁纸",
    ]);

    const labels = actions.map((item) => item.label);
    expect(labels).not.toContain("设备");
    expect(labels).not.toContain("Device");
    expect(labels).not.toContain("手机模拟器");
    expect(actions[0]?.active).toBe(true);

    // Clicking every single one of the 9 items fires its dedicated handler.
    for (const action of actions) {
      action.onClick();
    }
    expect(handlers.onPullRequest).toHaveBeenCalledTimes(1);
    expect(handlers.onDiff).toHaveBeenCalledTimes(1);
    expect(handlers.onFiles).toHaveBeenCalledTimes(1);
    expect(handlers.onTerminal).toHaveBeenCalledTimes(1);
    expect(handlers.onSideChat).toHaveBeenCalledTimes(1);
    expect(handlers.onPreview).toHaveBeenCalledTimes(1);
    expect(handlers.onMobileSimulator).toHaveBeenCalledTimes(1);
    expect(handlers.onPullRequests).toHaveBeenCalledTimes(1);
    expect(handlers.onWallpaper).toHaveBeenCalledTimes(1);
  });

  it("tracks active highlight accurately for restored PR, side-chat, and linked-items surfaces", () => {
    const checkActive = (kind: Parameters<typeof buildRightPanelActivityActions>[0]["focusedSurfaceKind"]) =>
      buildRightPanelActivityActions({
        order: DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
        focusedSurfaceKind: kind,
        mobileSimulatorIdleActive: false,
        resolveMessage: m,
        availability: allAvailable,
        handlers: makeHandlers(),
      })
        .filter((item) => item.active)
        .map((item) => item.id);

    expect(checkActive("pull-request")).toEqual(["pull-request"]);
    expect(checkActive("pull-request-empty")).toEqual(["pull-request"]);
    expect(checkActive("thread")).toEqual(["side-chat"]);
    expect(checkActive("side-chat-empty")).toEqual(["side-chat"]);
    expect(checkActive("pull-requests")).toEqual(["pull-requests"]);
    expect(checkActive("wallpaper")).toEqual(["wallpaper"]);
  });

  it("provides unmistakable high-contrast active styling across Light, Dark, and Liquid Glass themes", () => {
    const activeClass = rightPanelActivityButtonClass({
      active: true,
      compact: false,
      available: true,
    });
    const inactiveClass = rightPanelActivityButtonClass({
      active: false,
      compact: false,
      available: true,
    });

    expect(activeClass).toContain("bg-primary");
    expect(activeClass).toContain("text-primary-foreground");
    expect(activeClass).toContain("font-semibold");
    expect(activeClass).toContain("[[data-pmx-glass='1']_&]:bg-primary");
    expect(activeClass).toContain("[html:not(.dark)[data-pmx-glass='1']_&]:bg-primary");

    expect(inactiveClass).toContain("bg-transparent");
    expect(inactiveClass).not.toContain("bg-primary");
  });

  it("renders RightPanelTabs with the exact 9-item Activity Bar DOM order and zero '设备'/'手机模拟器' labels", () => {
    useRightPanelStore.getState().resetActivityBarOrder();
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: {} },
        createElement(
          RightPanelTabs,
          {
            mode: "embedded",
            open: true,
            keybindings: [],
            getShortcutContext: () => ({
              terminalFocus: false,
              terminalOpen: false,
              previewFocus: false,
              previewOpen: false,
              isWeb: true,
              isDesktop: false,
            }),
            surfaces: [{ id: "side-chat:empty", kind: "side-chat-empty" }],
            environmentId: EnvironmentId.make("local"),
            activeSurfaceId: "side-chat:empty",
            pendingSurfaceIds: new Set<string>(),
            previewSessions: {},
            desktopByTabId: {},
            terminalLabelsById: new Map<string, string>(),
            onActivate: noop,
            onCloseSurface: noop,
            onCloseOtherSurfaces: noop,
            onCloseSurfacesToRight: noop,
            onCloseAllSurfaces: noop,
            onCopyFilePath: noop,
            onAddBrowser: noop,
            onAddBrowserInProfile: noop,
            onAddTerminal: noop,
            onAddDiff: noop,
            onAddFiles: noop,
            onAddPullRequest: noop,
            onAddPullRequests: noop,
            onAddDevice: noop,
            onAddWallpaper: noop,
            onAddSideChat: noop,
            browserAvailable: true,
            terminalAvailable: true,
            diffAvailable: true,
            filesAvailable: true,
            pullRequestAvailable: true,
            pullRequestsAvailable: true,
            deviceAvailable: false,
            wallpaperAvailable: true,
            sideChatAvailable: true,
            children: createElement("div", { "data-testid": "surface-body" }, "empty-side-chat"),
          },
        ),
      ),
    );

    const renderedIds = [...html.matchAll(/data-activity-item="([^"]+)"/g)].map((match) => match[1]);
    expect(renderedIds).toEqual([
      "pull-request",
      "diff",
      "files",
      "terminal",
      "side-chat",
      "preview",
      "mobile-simulator",
      "pull-requests",
      "wallpaper",
    ]);
    const renderedLabels = [...html.matchAll(/data-activity-item="[^"]+"[^>]*aria-label="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(renderedLabels).toEqual([
      "PR",
      "差异",
      "文件",
      "终端",
      "侧聊",
      "浏览器",
      "手机模拟",
      "已关联项",
      "壁纸",
    ]);
    expect(html).toContain("手机模拟");
    expect(html).not.toContain("手机模拟器");
    expect(html).not.toContain('aria-label="设备"');
    expect(html).toContain('data-activity-item="side-chat"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain("bg-primary");
  });

  it("replaces PR and side-chat empty placeholder surfaces cleanly once real surfaces open", () => {
    const ref = {
      environmentId: EnvironmentId.make("local"),
      threadId: ThreadId.make("thread-placeholder-test"),
    };
    const store = useRightPanelStore.getState();
    store.removeThread(ref);

    store.open(ref, "pull-request-empty");
    expect(useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]?.activeSurfaceId).toBe(
      "pull-request:empty",
    );

    store.openPullRequest(ref, {
      projectId: "proj-1",
      repository: "acme/prismux",
      number: 42,
    });
    const afterPr = useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]!;
    expect(afterPr.surfaces.some((s) => s.kind === "pull-request-empty")).toBe(false);
    expect(afterPr.surfaces.some((s) => s.kind === "pull-request")).toBe(true);

    store.open(ref, "side-chat-empty");
    expect(useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]?.activeSurfaceId).toBe(
      "side-chat:empty",
    );

    store.openThread(ref, ThreadId.make("side-child-1"));
    const afterSide = useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]!;
    expect(afterSide.surfaces.some((s) => s.kind === "side-chat-empty")).toBe(false);
    expect(afterSide.surfaces.some((s) => s.kind === "thread")).toBe(true);

    store.removeThread(ref);
  });

  it("renders graceful empty states for PR, side-chat, and draft linked-items surfaces without crashing", () => {
    const ref = {
      environmentId: EnvironmentId.make("local"),
      threadId: ThreadId.make("thread-empty-surface-test"),
    };
    const noop = () => {};

    const prEmptyHtml = renderToStaticMarkup(
      createElement(PullRequestEmptySurface, {
        threadRef: ref,
        capabilityKnown: true,
        supported: true,
        isServerThread: true,
        onOpenLinkedItems: noop,
      }),
    );
    expect(prEmptyHtml).toContain("right-panel-pr-empty-state");
    expect(prEmptyHtml).toContain("当前分支暂无 Pull Request");
    expect(prEmptyHtml).toContain("手动关联 PR");
    expect(prEmptyHtml).toContain("查看已关联项");

    const sideChatEmptyHtml = renderToStaticMarkup(
      createElement(SideChatEmptySurface, {
        canStart: false,
        disabledReason: "发送第一条消息后即可开启侧聊。",
        onStart: undefined,
      }),
    );
    expect(sideChatEmptyHtml).toContain("right-panel-side-chat-empty-state");
    expect(sideChatEmptyHtml).toContain("发送第一条消息后即可开启侧聊。");

    const linkedEmptyHtml = renderToStaticMarkup(createElement(LinkedItemsEmptySurface));
    expect(linkedEmptyHtml).toContain("right-panel-linked-items-empty-state");
    expect(linkedEmptyHtml).toContain("暂无已关联项");
  });
});
