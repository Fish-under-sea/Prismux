import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@prismux/core-contracts";
import { getTranslationsSnapshot, GTProvider, initializeGT } from "gt-react";
import { MessageSquarePlus } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../i18n/locales";
import { m, setActiveLocale, type MessageResolver } from "../i18n/messages";
import zhCatalog from "../i18n/translations/zh.json";
import { DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER, useRightPanelStore } from "../rightPanelStore";
import {
  LinkedItemsEmptySurface,
  PullRequestEmptySurface,
  SideChatEmptySurface,
} from "./chat/RightPanelEmptySurfaces";
import {
  applyRightPanelActivityDragEnd,
  buildRightPanelActivityActions,
  buildRightPanelLauncherActions,
  resolvePullRequestTabLink,
  resolveSideQuestionLabel,
  RightPanelActivityBar,
  rightPanelActivityButtonClass,
  RightPanelEmptyState,
  RightPanelTabs,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
  type RightPanelTabsProps,
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

describe("RightPanel 7-item strict order, synced top/bottom DnD & BTW side-question labels", () => {
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
    useRightPanelStore.getState().resetActivityBarOrder();
  });

  const makeHandlers = () => ({
    onPullRequests: vi.fn(),
    onDiff: vi.fn(),
    onFiles: vi.fn(),
    onTerminal: vi.fn(),
    onPreview: vi.fn(),
    onMobileSimulator: vi.fn(),
    onSideChat: vi.fn(),
  });

  const allAvailable = {
    pullRequests: true,
    diff: true,
    files: true,
    terminal: true,
    preview: true,
    mobileSimulator: true,
    sideChat: true,
  };

  function makeBasePanelProps(overrides: Partial<RightPanelTabsProps> = {}): RightPanelTabsProps {
    const noop = () => {};
    return {
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
      surfaces: [],
      environmentId: EnvironmentId.make("local"),
      activeSurfaceId: null,
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
      children: createElement("div", { "data-testid": "surface-body" }, "surface-body"),
      ...overrides,
    };
  }

  function renderPanelHtml(
    overrides: Partial<RightPanelTabsProps> = {},
    locale: "zh" | "en" = "zh",
  ): string {
    return renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale, translations: {} },
        createElement(RightPanelTabs, makeBasePanelProps(overrides)),
      ),
    );
  }

  it("builds the exact 7-item Chinese order with MessageSquarePlus for 旁路提问 and zero PR/壁纸/侧聊/设备", () => {
    const handlers = makeHandlers();
    const actions = buildRightPanelActivityActions({
      order: DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
      focusedSurfaceKind: "pull-requests",
      mobileSimulatorIdleActive: false,
      resolveMessage: m,
      locale: "zh",
      availability: allAvailable,
      handlers,
    });

    expect(actions.map((item) => item.id)).toEqual([
      "pull-requests",
      "diff",
      "files",
      "terminal",
      "preview",
      "mobile-simulator",
      "side-chat",
    ]);
    expect(actions.map((item) => item.label)).toEqual([
      "已关联项",
      "差异",
      "文件",
      "终端",
      "浏览器",
      "手机模拟",
      "旁路提问",
    ]);
    expect(actions[6]?.icon).toBe(MessageSquarePlus);

    const labels = actions.map((item) => item.label);
    expect(labels).not.toContain("PR");
    expect(labels).not.toContain("壁纸");
    expect(labels).not.toContain("侧聊");
    expect(labels).not.toContain("设备");
    expect(labels).not.toContain("Device");
    expect(labels).not.toContain("手机模拟器");
    expect(actions[0]?.active).toBe(true);

    // English & Chinese locales resolve side-chat cleanly to "Side question" / "旁路提问".
    const identityResolver = ((value: unknown) => value) as MessageResolver;
    expect(resolveSideQuestionLabel(m, "zh")).toBe("旁路提问");
    expect(resolveSideQuestionLabel(identityResolver, "zh")).toBe("旁路提问");
    expect(resolveSideQuestionLabel(identityResolver, "en")).toBe("Side question");

    // Clicking every single one of the 7 items fires its dedicated handler.
    for (const action of actions) {
      action.onClick();
    }
    expect(handlers.onPullRequests).toHaveBeenCalledTimes(1);
    expect(handlers.onDiff).toHaveBeenCalledTimes(1);
    expect(handlers.onFiles).toHaveBeenCalledTimes(1);
    expect(handlers.onTerminal).toHaveBeenCalledTimes(1);
    expect(handlers.onPreview).toHaveBeenCalledTimes(1);
    expect(handlers.onMobileSimulator).toHaveBeenCalledTimes(1);
    expect(handlers.onSideChat).toHaveBeenCalledTimes(1);
  });

  it("tracks active highlight accurately for all 7 activity bar surfaces without highlighting for PR detail or wallpaper", () => {
    const checkActive = (
      kind: Parameters<typeof buildRightPanelActivityActions>[0]["focusedSurfaceKind"],
      mobileSimulatorIdleActive = false,
    ) =>
      buildRightPanelActivityActions({
        order: DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
        focusedSurfaceKind: kind,
        mobileSimulatorIdleActive,
        resolveMessage: m,
        locale: "zh",
        availability: allAvailable,
        handlers: makeHandlers(),
      })
        .filter((item) => item.active)
        .map((item) => item.id);

    expect(checkActive("pull-requests")).toEqual(["pull-requests"]);
    expect(checkActive("diff")).toEqual(["diff"]);
    expect(checkActive("files")).toEqual(["files"]);
    expect(checkActive("file")).toEqual(["files"]);
    expect(checkActive("terminal")).toEqual(["terminal"]);
    expect(checkActive("preview", false)).toEqual(["preview"]);
    expect(checkActive("preview", true)).toEqual(["mobile-simulator"]);
    expect(checkActive("thread")).toEqual(["side-chat"]);
    expect(checkActive("side-chat-empty")).toEqual(["side-chat"]);
    expect(checkActive("pull-request")).toEqual([]);
    expect(checkActive("wallpaper")).toEqual([]);
  });

  it("keeps launcher and + menu actions synced with live order, supports L/D/F/T/B/I/S, and drops P/W", () => {
    const handlers = makeHandlers();
    const defaultLauncher = buildRightPanelLauncherActions({
      order: DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
      resolveMessage: m,
      locale: "zh",
      disabledReasonStyle: "hint",
      includeSideChat: true,
      availability: allAvailable,
      handlers,
    });
    expect(defaultLauncher.map((item) => item.id)).toEqual([
      "pull-requests",
      "diff",
      "files",
      "terminal",
      "preview",
      "mobile-simulator",
      "side-chat",
    ]);
    expect(defaultLauncher.map((item) => item.label)).toEqual([
      "已关联项",
      "差异",
      "文件",
      "终端",
      "浏览器",
      "手机模拟",
      "旁路提问",
    ]);
    expect(defaultLauncher.map((item) => item.shortcut)).toEqual([
      "L",
      "D",
      "F",
      "T",
      "B",
      "I",
      "S",
    ]);
    expect(defaultLauncher[6]?.icon).toBe(MessageSquarePlus);

    // Single-letter shortcuts L/D/F/T/B/I/S resolve; removed P/W do not match.
    for (const [key, expectedId] of [
      ["l", "pull-requests"],
      ["d", "diff"],
      ["f", "files"],
      ["t", "terminal"],
      ["b", "preview"],
      ["i", "mobile-simulator"],
      ["s", "side-chat"],
    ] as const) {
      expect(surfaceShortcutActionForKey(defaultLauncher, shortcutEvent(key))?.id).toBe(expectedId);
    }
    expect(surfaceShortcutActionForKey(defaultLauncher, shortcutEvent("p"))).toBeNull();
    expect(surfaceShortcutActionForKey(defaultLauncher, shortcutEvent("w"))).toBeNull();

    // Custom order applies identically to both empty launcher ("hint") and + menu ("reason").
    const customOrder = [
      "side-chat",
      "terminal",
      "pull-requests",
      "files",
      "diff",
      "mobile-simulator",
      "preview",
    ] as const;
    const customMenu = buildRightPanelLauncherActions({
      order: customOrder,
      resolveMessage: m,
      locale: "zh",
      disabledReasonStyle: "reason",
      includeSideChat: true,
      availability: allAvailable,
      handlers,
    });
    expect(customMenu.map((item) => item.id)).toEqual([...customOrder]);
    expect(customMenu.map((item) => item.shortcut)).toEqual(["S", "T", "L", "F", "D", "I", "B"]);

    // Omitting side chat excludes only side-chat cleanly.
    const withoutSideChat = buildRightPanelLauncherActions({
      order: customOrder,
      resolveMessage: m,
      locale: "zh",
      disabledReasonStyle: "reason",
      includeSideChat: false,
      availability: allAvailable,
      handlers,
    });
    expect(withoutSideChat.map((item) => item.id)).toEqual([
      "terminal",
      "pull-requests",
      "files",
      "diff",
      "mobile-simulator",
      "preview",
    ]);
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

  it("renders RightPanelTabs with exact 7-item Activity Bar DOM order, 旁路提问 tab title, and keeps PR/wallpaper surfaces openable", () => {
    useRightPanelStore.getState().resetActivityBarOrder();
    const html = renderPanelHtml({
      surfaces: [
        { id: "side-chat:empty", kind: "side-chat-empty" },
        {
          id: "pull-request:proj-1:acme%2Fprismux:42",
          kind: "pull-request",
          projectId: "proj-1",
          repository: "acme/prismux",
          number: 42,
        },
        { id: "wallpaper", kind: "wallpaper" },
      ],
      activeSurfaceId: "side-chat:empty",
    });

    const renderedIds = [...html.matchAll(/data-activity-item="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(renderedIds).toEqual([
      "pull-requests",
      "diff",
      "files",
      "terminal",
      "preview",
      "mobile-simulator",
      "side-chat",
    ]);
    const renderedLabels = [
      ...html.matchAll(/data-activity-item="[^"]+"[^>]*aria-label="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(renderedLabels).toEqual([
      "已关联项",
      "差异",
      "文件",
      "终端",
      "浏览器",
      "手机模拟",
      "旁路提问",
    ]);
    expect(html).toContain("旁路提问");
    expect(html).toContain("手机模拟");
    expect(html).not.toContain("手机模拟器");
    expect(html).not.toContain('aria-label="设备"');
    expect(html).not.toContain('data-activity-item="pull-request"');
    expect(html).not.toContain('data-activity-item="wallpaper"');
    expect(html).toContain('data-activity-item="side-chat"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain("bg-primary");
    // PR detail tab and Wallpaper surface tab still render in the tab strip.
    expect(html).toContain("#42");
    expect(html).toContain(">壁纸<");

    // English locale renders "Side question" for both the side-chat tab and Activity Bar item.
    const enHtml = renderPanelHtml(
      {
        surfaces: [{ id: "side-chat:empty", kind: "side-chat-empty" }],
        activeSurfaceId: "side-chat:empty",
      },
      "en",
    );
    expect(enHtml).toContain('aria-label="Side question"');
    expect(enHtml).toContain(">Side question<");
  });

  it("syncs top bar, bottom empty launcher, and + menu order across drag-end and reset, with both enabled and disabled rows sortable", () => {
    useRightPanelStore.getState().resetActivityBarOrder();

    // 1. Full RightPanelTabs SSR integration check on default order with disabled diff row.
    const defaultPanelHtml = renderPanelHtml({
      activeSurfaceId: null,
      surfaces: [],
      diffAvailable: false,
    });
    const topIdsDefault = [...defaultPanelHtml.matchAll(/data-activity-item="([^"]+)"/g)].map(
      (match) => match[1],
    );
    const launcherIdsDefault = [...defaultPanelHtml.matchAll(/data-launcher-item="([^"]+)"/g)].map(
      (match) => match[1],
    );
    const dragHandleIdsDefault = [
      ...defaultPanelHtml.matchAll(/data-launcher-drag-handle="([^"]+)"/g),
    ].map((match) => match[1]);

    expect(topIdsDefault).toEqual([
      "pull-requests",
      "diff",
      "files",
      "terminal",
      "preview",
      "mobile-simulator",
      "side-chat",
    ]);
    expect(launcherIdsDefault).toEqual(topIdsDefault);
    expect(dragHandleIdsDefault).toEqual(topIdsDefault);
    // All 7 rows (including disabled "diff") carry sortable attributes & drag handle.
    expect(defaultPanelHtml.match(/data-launcher-sortable="true"/g)).toHaveLength(7);
    expect(
      defaultPanelHtml.match(/aria-roledescription="sortable"/g)?.length,
    ).toBeGreaterThanOrEqual(7);
    expect(defaultPanelHtml).toContain('aria-disabled="true"');
    // Shortcut attribute omits disabled "D" and never contains removed "P" or "W".
    expect(defaultPanelHtml).toContain('data-surface-launcher-keys="LFTBIS"');
    // Default order hides the compact reset button.
    expect(defaultPanelHtml).not.toContain('data-testid="right-panel-empty-reset-order"');

    // Helper rendering live store activityBarOrder across top bar, bottom launcher, and + menu.
    const renderSyncedSurfaces = (diffAvailable: boolean) => {
      const state = useRightPanelStore.getState();
      const order = state.activityBarOrder;
      const isCustomOrder =
        order.length !== DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER.length ||
        order.some((id, index) => id !== DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER[index]);
      const availability = { ...allAvailable, diff: diffAvailable };
      const handlers = makeHandlers();
      const topActions = buildRightPanelActivityActions({
        order,
        focusedSurfaceKind: null,
        mobileSimulatorIdleActive: false,
        resolveMessage: m,
        locale: "zh",
        availability,
        handlers,
      });
      const launcherActions = buildRightPanelLauncherActions({
        order,
        resolveMessage: m,
        locale: "zh",
        disabledReasonStyle: "hint",
        includeSideChat: true,
        availability,
        handlers,
      });
      const menuActions = buildRightPanelLauncherActions({
        order,
        resolveMessage: m,
        locale: "zh",
        disabledReasonStyle: "reason",
        includeSideChat: true,
        availability,
        handlers,
      });
      const html = renderToStaticMarkup(
        createElement(
          GTProvider,
          { locale: "zh", translations: {} },
          createElement(
            "div",
            null,
            createElement(RightPanelActivityBar, {
              actions: topActions,
              isCustomOrder,
              onReorder: state.reorderActivityBar,
              onResetOrder: state.resetActivityBarOrder,
            }),
            createElement(RightPanelEmptyState, {
              actions: launcherActions,
              browserProfiles: [{ id: "default", name: "Default" }],
              onAddBrowserInProfile: () => {},
              isCustomOrder,
              onReorder: state.reorderActivityBar,
              onResetOrder: state.resetActivityBarOrder,
            }),
          ),
        ),
      );
      return { html, menuIds: menuActions.map((item) => item.id) };
    };

    try {
      // 2. No-op drag ends (null target or same item) leave store untouched.
      const reorder = useRightPanelStore.getState().reorderActivityBar;
      expect(
        applyRightPanelActivityDragEnd(
          { active: { id: "side-chat" } as never, over: null },
          reorder,
        ),
      ).toBe(false);
      expect(
        applyRightPanelActivityDragEnd(
          { active: { id: "side-chat" } as never, over: { id: "side-chat" } as never },
          reorder,
        ),
      ).toBe(false);

      // 3. Reordering via drag-end syncs top bar, bottom empty launcher, and + menu + shows reset button.
      expect(
        applyRightPanelActivityDragEnd(
          { active: { id: "side-chat" } as never, over: { id: "pull-requests" } as never },
          reorder,
        ),
      ).toBe(true);
      const reordered = renderSyncedSurfaces(true);
      const expectedReordered = [
        "side-chat",
        "pull-requests",
        "diff",
        "files",
        "terminal",
        "preview",
        "mobile-simulator",
      ];
      expect(
        [...reordered.html.matchAll(/data-activity-item="([^"]+)"/g)].map((match) => match[1]),
      ).toEqual(expectedReordered);
      expect(
        [...reordered.html.matchAll(/data-launcher-item="([^"]+)"/g)].map((match) => match[1]),
      ).toEqual(expectedReordered);
      expect(reordered.menuIds).toEqual(expectedReordered);
      expect(reordered.html).toContain('data-surface-launcher-keys="SLDFTBI"');
      expect(reordered.html).toContain('data-testid="right-panel-empty-reset-order"');
      expect(reordered.html).toContain("重置默认排序");

      // 4. Dragging a disabled item (diff) to the top also syncs all three surfaces cleanly.
      expect(
        applyRightPanelActivityDragEnd(
          { active: { id: "diff" } as never, over: { id: "side-chat" } as never },
          reorder,
        ),
      ).toBe(true);
      const afterDisabledDrag = renderSyncedSurfaces(false);
      expect(
        [...afterDisabledDrag.html.matchAll(/data-activity-item="([^"]+)"/g)].map(
          (match) => match[1],
        )[0],
      ).toBe("diff");
      expect(
        [...afterDisabledDrag.html.matchAll(/data-launcher-item="([^"]+)"/g)].map(
          (match) => match[1],
        )[0],
      ).toBe("diff");
      expect(afterDisabledDrag.menuIds[0]).toBe("diff");

      // 5. Resetting restores exact default order across all three surfaces and hides reset button.
      useRightPanelStore.getState().resetActivityBarOrder();
      const reset = renderSyncedSurfaces(true);
      expect(
        [...reset.html.matchAll(/data-activity-item="([^"]+)"/g)].map((match) => match[1]),
      ).toEqual([...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER]);
      expect(
        [...reset.html.matchAll(/data-launcher-item="([^"]+)"/g)].map((match) => match[1]),
      ).toEqual([...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER]);
      expect(reset.menuIds).toEqual([...DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER]);
      expect(reset.html).toContain('data-surface-launcher-keys="LDFTBIS"');
      expect(reset.html).not.toContain('data-testid="right-panel-empty-reset-order"');
    } finally {
      useRightPanelStore.getState().resetActivityBarOrder();
    }
  });

  it("replaces PR and side-chat empty placeholder surfaces cleanly once real surfaces open", () => {
    const ref = {
      environmentId: EnvironmentId.make("local"),
      threadId: ThreadId.make("thread-placeholder-test"),
    };
    const store = useRightPanelStore.getState();
    store.removeThread(ref);

    store.open(ref, "pull-request-empty");
    expect(
      useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]
        ?.activeSurfaceId,
    ).toBe("pull-request:empty");

    store.openPullRequest(ref, {
      projectId: "proj-1",
      repository: "acme/prismux",
      number: 42,
    });
    const afterPr =
      useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]!;
    expect(afterPr.surfaces.some((s) => s.kind === "pull-request-empty")).toBe(false);
    expect(afterPr.surfaces.some((s) => s.kind === "pull-request")).toBe(true);

    store.open(ref, "side-chat-empty");
    expect(
      useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]
        ?.activeSurfaceId,
    ).toBe("side-chat:empty");

    store.openThread(ref, ThreadId.make("side-child-1"));
    const afterSide =
      useRightPanelStore.getState().byThreadKey[`${ref.environmentId}:${ref.threadId}`]!;
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
        disabledReason: "发送第一条消息后即可开启旁路提问。",
        onStart: undefined,
      }),
    );
    expect(sideChatEmptyHtml).toContain("right-panel-side-chat-empty-state");

    const linkedEmptyHtml = renderToStaticMarkup(createElement(LinkedItemsEmptySurface));
    expect(linkedEmptyHtml).toContain("right-panel-linked-items-empty-state");
    expect(linkedEmptyHtml).toContain("暂无已关联项");
  });
});
