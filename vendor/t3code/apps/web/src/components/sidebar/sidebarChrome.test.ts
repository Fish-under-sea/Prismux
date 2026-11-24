import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
  type ProjectId,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { GTProvider, initializeGT, useGT } from "gt-react";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import zhCatalog from "../../i18n/translations/zh.json";

import { Menu } from "../ui/menu";
import {
  executeBrandMenuForceReload,
  executeBrandMenuReload,
  executeBrandMenuToggleDevTools,
  resolveBrandMenuDeveloperShortcuts,
  resolveDefaultAvailableModelSelection,
  resolveSidebarUtilityNavIds,
  SIDEBAR_APP_MENU_ITEM_IDS,
  SIDEBAR_HEADER_CONTROL_ORDER,
  SidebarBrandMenuItems,
} from "./SidebarChrome";
import { resolveSidebarUtilityOverflow } from "./sidebarMicroIndicators";
import {
  buildSidebarPeekGroups,
  resolveSidebarPeekDecision,
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
  SIDEBAR_PEEK_WIDTH_PX,
} from "./sidebarPeek.logic";

describe("SidebarChrome Orca header order & footer utility cleanup", () => {
  it("excludes help, wallpaper, and toggle-sidebar and enforces Orca left/right footer partition ([settings, usage] ... [locate, issues, pull-requests])", () => {
    const expanded = resolveSidebarUtilityNavIds({
      pullRequestsSupported: true,
      issuesSupported: true,
      railCompact: false,
    });
    const collapsedRail = resolveSidebarUtilityNavIds({
      pullRequestsSupported: true,
      issuesSupported: true,
      railCompact: true,
    });

    for (const list of [expanded, collapsedRail]) {
      expect(list).not.toContain("help");
      expect(list).not.toContain("wallpaper");
      expect(list).not.toContain("toggle-sidebar");
      expect(list).toContain("settings");
      expect(list).toContain("usage");
      expect(list).toContain("locate");
    }

    // Expanded Orca partition: left [settings, usage], right [locate, issues, pull-requests] (PR strictly rightmost).
    expect(expanded).toEqual(["settings", "usage", "locate", "issues", "pull-requests"]);

    // 54px vertical rail stacks right utility actions above [settings, usage] at the bottom.
    expect(collapsedRail).toEqual(["locate", "issues", "pull-requests", "settings", "usage"]);

    // Without PR/Issue support, the list stays cleanly partitioned [settings, usage] ... [locate].
    expect(
      resolveSidebarUtilityNavIds({
        pullRequestsSupported: false,
        issuesSupported: false,
        railCompact: false,
      }),
    ).toEqual(["settings", "usage", "locate"]);

    // At standard desktop sidebar widths (220px, 256px, 280px), all 5 compact 26x26 icons stay visible (never swallowed by More).
    for (const width of [200, 256, 280]) {
      const overflow = resolveSidebarUtilityOverflow(expanded, {
        viewportHeight: 900,
        containerWidth: width,
        itemSlotWidth: 28,
        reservedTrailingWidth: 8,
      });
      expect(overflow.overflowIds).toEqual([]);
      expect(overflow.visibleIds.size).toBe(5);
    }
  });

  it("enforces Orca top header order: [Logo+Prismux App Menu] -> [Collapse Toggle] -> [Compact Back/Forward]", () => {
    expect([...SIDEBAR_HEADER_CONTROL_ORDER]).toEqual([
      "brand-menu",
      "sidebar-toggle",
      "history-nav",
    ]);
    expect([...SIDEBAR_APP_MENU_ITEM_IDS]).toEqual([
      "new-thread",
      "open-workspace",
      "command-palette",
      "settings",
      "keybindings",
      "check-updates",
      "reload-window",
      "force-reload-window",
      "toggle-devtools",
    ]);

    const sidebarDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const source = fs.readFileSync(path.join(sidebarDir, "SidebarChrome.tsx"), "utf8");

    // Confirm the 3 removed footer buttons are completely gone from SidebarChrome.tsx.
    expect(source).not.toContain('id: "help"');
    expect(source).not.toContain('id: "wallpaper"');
    expect(source).not.toContain('id: "toggle-sidebar"');
    expect(source).not.toContain("sidebar-utility-help-trigger");
    expect(source).not.toContain("Wallpaper & appearance");

    // Confirm header renders brand menu trigger -> header toggle -> ml-auto history nav in order.
    const brandMenuIdx = source.indexOf(
      "<SidebarBrandMenu onBackdrop={onBackdrop} isElectron={isElectron} />",
    );
    const headerToggleIdx = source.indexOf(
      "<SidebarHeaderToggleButton railCompact={false} onBackdrop={onBackdrop} />",
    );
    const historyNavIdx = source.indexOf('data-sidebar-header-history="true"');
    expect(brandMenuIdx).toBeGreaterThan(-1);
    expect(headerToggleIdx).toBeGreaterThan(brandMenuIdx);
    expect(historyNavIdx).toBeGreaterThan(headerToggleIdx);

    // Confirm bottom brand menu items render in exact order (Reload -> Force Reload -> Toggle Developer Tools)
    // and new-thread launches a full direct draft session instead of only opening the command palette.
    const reloadIdx = source.indexOf('data-sidebar-app-menu-item="reload-window"');
    const forceReloadIdx = source.indexOf('data-sidebar-app-menu-item="force-reload-window"');
    const devToolsIdx = source.indexOf('data-sidebar-app-menu-item="toggle-devtools"');
    expect(reloadIdx).toBeGreaterThan(-1);
    expect(forceReloadIdx).toBeGreaterThan(reloadIdx);
    expect(devToolsIdx).toBeGreaterThan(forceReloadIdx);
    expect(source).toContain("void handleCreateDirectNewThread()");

    // Confirm app menu popup opts into the overlays liquid glass zone.
    expect(source).toContain('data-pmx-glass-zone="overlays"');
    expect(source).toContain('data-sidebar-brand-menu-popup="true"');

    // Confirm collapsed hover-peek floating drawer mounts via portal with @glass-engine hook & zero CJK copy.
    expect(source).toContain('data-pmx-sidebar-peek="1"');
    expect(source).toContain('data-sidebar-peek-pin="true"');
    expect(source).toContain("createPortal");

    // Confirm compact Orca footer sizing (26x26 buttons, 15px icons) and left/right partition.
    expect(source).toContain("size-[26px]");
    expect(source).toContain("size-[15px]");
    expect(source).toContain('data-sidebar-footer-partition="orca"');

    // Confirm SidebarUpdatePill is moved OUT of SidebarUtilityMenu into SidebarActiveUpdateBanner
    // above SidebarUtilityMenu so [locate, issues, pull-requests] stay strictly flush-right.
    const utilityMenuStart = source.indexOf("const SidebarUtilityMenu = memo(");
    const activeUpdateStart = source.indexOf("const SidebarActiveUpdateBanner = memo(");
    const utilityMenuBody = source.slice(utilityMenuStart, activeUpdateStart);
    expect(utilityMenuBody).not.toContain("<SidebarUpdatePill");
    expect(source.slice(activeUpdateStart)).toContain("<SidebarUpdatePill />");
    expect(source).toContain("<SidebarActiveUpdateBanner />");

    // Confirm PrismuxSidebarUpdateCapsule sits directly above SidebarUtilityMenu and PrismuxAutoUpdateHost mounts in footer.
    const footerStart = source.indexOf("export const SidebarChromeFooter = memo(");
    const footerBody = source.slice(footerStart);
    const capsuleIdx = footerBody.indexOf("<PrismuxSidebarUpdateCapsule railCompact={railCompact} />");
    const utilityIdx = footerBody.indexOf("<SidebarUtilityMenu />");
    expect(capsuleIdx).toBeGreaterThan(-1);
    expect(utilityIdx).toBeGreaterThan(capsuleIdx);
    expect(footerBody).toContain("<PrismuxAutoUpdateHost />");

    // Confirm peek section heading uses gt("Recent Threads") (not <T>Recent Threads</T>) so zh catalog resolves.
    expect(source).toContain('gt("Recent Threads")');
    expect(source).not.toContain("<T>Recent Threads</T>");
  });

  it("localizes collapsed hover-peek section headings cleanly in Simplified Chinese", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;

    function Probe() {
      const gt = useGT();
      return createElement("div", null, `${gt("Projects")}|${gt("Recent Threads")}`);
    }

    const html = renderToStaticMarkup(
      createElement(GTProvider, { locale: "zh", translations: zhTranslations }, createElement(Probe)),
    );
    expect(html).toContain("项目|最近会话");
  });

  it("localizes and wires Prismux brand menu developer items (Reload / Force Reload / Toggle Developer Tools) with Electron IPC & clean shortcut labels", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;

    function DevMenuProbe() {
      const gt = useGT();
      return createElement(
        "div",
        null,
        `${gt("Reload")}|${gt("Force Reload")}|${gt("Toggle Developer Tools")}`,
      );
    }

    const zhHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: zhTranslations },
        createElement(DevMenuProbe),
      ),
    );
    expect(zhHtml).toContain("重新加载|强制重新加载|切换开发者工具");

    // Render the real SidebarBrandMenuItems markup in both Electron (3 items) and Web (hides DevTools) modes.
    const winShortcuts = resolveBrandMenuDeveloperShortcuts("Win32");
    const electronMenuHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: zhTranslations },
        createElement(
          Menu,
          null,
          createElement(SidebarBrandMenuItems, {
            commandPaletteShortcut: "Ctrl+K",
            developerShortcuts: winShortcuts,
            showDevToolsItem: true,
            onNewThread: vi.fn(),
            onAddProject: vi.fn(),
            onOpenCommandPalette: vi.fn(),
            onOpenSettings: vi.fn(),
            onOpenKeybindings: vi.fn(),
            onCheckUpdates: vi.fn(),
            onReload: vi.fn(),
            onForceReload: vi.fn(),
            onToggleDevTools: vi.fn(),
          }),
        ),
      ),
    );
    expect(electronMenuHtml).toContain('data-sidebar-app-menu-item="reload-window"');
    expect(electronMenuHtml).toContain("重新加载");
    expect(electronMenuHtml).toContain('data-sidebar-app-menu-item="force-reload-window"');
    expect(electronMenuHtml).toContain("强制重新加载");
    expect(electronMenuHtml).toContain("Ctrl+Shift+R");
    expect(electronMenuHtml).toContain('data-sidebar-app-menu-item="toggle-devtools"');
    expect(electronMenuHtml).toContain("切换开发者工具");
    expect(electronMenuHtml).toContain("Ctrl+Shift+I");
    expect(electronMenuHtml).not.toContain("\t");

    const webMenuHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: zhTranslations },
        createElement(
          Menu,
          null,
          createElement(SidebarBrandMenuItems, {
            commandPaletteShortcut: "Ctrl+K",
            developerShortcuts: winShortcuts,
            showDevToolsItem: false,
            onNewThread: vi.fn(),
            onAddProject: vi.fn(),
            onOpenCommandPalette: vi.fn(),
            onOpenSettings: vi.fn(),
            onOpenKeybindings: vi.fn(),
            onCheckUpdates: vi.fn(),
            onReload: vi.fn(),
            onForceReload: vi.fn(),
            onToggleDevTools: vi.fn(),
          }),
        ),
      ),
    );
    expect(webMenuHtml).toContain('data-sidebar-app-menu-item="reload-window"');
    expect(webMenuHtml).toContain('data-sidebar-app-menu-item="force-reload-window"');
    expect(webMenuHtml).not.toContain('data-sidebar-app-menu-item="toggle-devtools"');

    // Shortcut labels must be clean right-aligned labels without any raw tab characters.
    expect(winShortcuts).toEqual({
      forceReload: "Ctrl+Shift+R",
      toggleDevTools: "Ctrl+Shift+I",
    });
    expect(winShortcuts.forceReload).not.toContain("\t");
    expect(winShortcuts.toggleDevTools).not.toContain("\t");

    const macShortcuts = resolveBrandMenuDeveloperShortcuts("MacIntel");
    expect(macShortcuts).toEqual({
      forceReload: "⌘⇧R",
      toggleDevTools: "⌥⌘I",
    });

    // Electron IPC bridge takes precedence over window.location.reload.
    const reloadWindow = vi.fn().mockResolvedValue(undefined);
    const forceReloadWindow = vi.fn().mockResolvedValue(undefined);
    const toggleDevTools = vi.fn().mockResolvedValue(undefined);
    const locationReload = vi.fn();

    executeBrandMenuReload({ reloadWindow }, { reload: locationReload });
    executeBrandMenuForceReload({ forceReloadWindow }, { reload: locationReload });
    const toggled = executeBrandMenuToggleDevTools({ toggleDevTools });

    expect(reloadWindow).toHaveBeenCalledTimes(1);
    expect(forceReloadWindow).toHaveBeenCalledTimes(1);
    expect(toggleDevTools).toHaveBeenCalledTimes(1);
    expect(toggled).toBe(true);
    expect(locationReload).not.toHaveBeenCalled();

    // Non-Electron fallback uses location.reload and reports false for DevTools IPC.
    executeBrandMenuReload(null, { reload: locationReload });
    executeBrandMenuForceReload(null, { reload: locationReload });
    expect(executeBrandMenuToggleDevTools(null)).toBe(false);
    expect(locationReload).toHaveBeenCalledTimes(2);
  });

  it("resolves a default available provider model selection for direct brand-menu new thread creation", () => {
    const providers: ServerProvider[] = [
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: "0.171.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-11-24T00:00:00.000Z",
        models: [
          {
            slug: "gpt-5.4",
            name: "GPT-5.4",
            isDefault: true,
            isCustom: false,
            capabilities: {},
          },
        ],
        slashCommands: [],
        skills: [],
      },
    ];
    const selection = resolveDefaultAvailableModelSelection(
      providers,
      DEFAULT_SERVER_SETTINGS,
      null,
    );
    expect(selection).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    });
  });

  it("drives Claude Code Desktop hover-peek dwell/grace/menu-lock/escape transitions cleanly", () => {
    expect(SIDEBAR_PEEK_OPEN_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(SIDEBAR_PEEK_CLOSE_DELAY_MS).toBeGreaterThanOrEqual(180);
    expect(SIDEBAR_PEEK_WIDTH_PX).toBeGreaterThanOrEqual(240);

    // Entering the 54px rail schedules delayed open (anti-accidental trigger).
    expect(
      resolveSidebarPeekDecision(false, {
        railCompact: true,
        pointerInRail: true,
        pointerInDrawer: false,
        openMenuCount: 0,
        dismissedByEscape: false,
      }),
    ).toBe("schedule-open");

    // Moving cursor into the floating drawer keeps it open without flickering.
    expect(
      resolveSidebarPeekDecision(true, {
        railCompact: true,
        pointerInRail: false,
        pointerInDrawer: true,
        openMenuCount: 0,
        dismissedByEscape: false,
      }),
    ).toBe("keep-open");

    // Leaving both rail and drawer schedules grace close.
    expect(
      resolveSidebarPeekDecision(true, {
        railCompact: true,
        pointerInRail: false,
        pointerInDrawer: false,
        openMenuCount: 0,
        dismissedByEscape: false,
      }),
    ).toBe("schedule-close");

    // Open dropdown menu inside the peek drawer prevents auto-close even when pointer moves to portaled popup.
    expect(
      resolveSidebarPeekDecision(true, {
        railCompact: true,
        pointerInRail: false,
        pointerInDrawer: false,
        openMenuCount: 1,
        dismissedByEscape: false,
      }),
    ).toBe("keep-open");

    // Escape or expanding the sidebar closes immediately.
    expect(
      resolveSidebarPeekDecision(true, {
        railCompact: true,
        pointerInRail: true,
        pointerInDrawer: true,
        openMenuCount: 0,
        dismissedByEscape: true,
      }),
    ).toBe("close-now");
    expect(
      resolveSidebarPeekDecision(true, {
        railCompact: false,
        pointerInRail: true,
        pointerInDrawer: true,
        openMenuCount: 1,
        dismissedByEscape: false,
      }),
    ).toBe("close-now");
  });

  it("groups active projects & recent non-subagent threads for the collapsed peek drawer", () => {
    const envId = "env-local" as EnvironmentId;
    const p1 = "proj-1" as ProjectId;
    const p2 = "proj-2" as ProjectId;
    const pScratch = "proj-scratch" as ProjectId;
    const pArchived = "proj-archived" as ProjectId;

    const result = buildSidebarPeekGroups({
      projects: [
        { environmentId: envId, id: p1, title: "Alpha" },
        { environmentId: envId, id: p2, title: "Prismux" },
        { environmentId: envId, id: pScratch, title: "Home", isScratch: true },
        { environmentId: envId, id: pArchived, title: "Old", archivedAt: "2026-01-01T00:00:00Z" },
      ],
      threads: [
        {
          environmentId: envId,
          id: "t-old" as ThreadId,
          projectId: p1,
          title: "Older Alpha task",
          updatedAt: "2026-11-20T00:00:00Z",
        },
        {
          environmentId: envId,
          id: "t-latest" as ThreadId,
          projectId: p2,
          title: "AGY 2.0 Composer",
          updatedAt: "2026-11-23T12:00:00Z",
          isRunning: true,
        },
        {
          environmentId: envId,
          id: "t-pinned" as ThreadId,
          projectId: p2,
          title: "Pinned Architecture",
          updatedAt: "2026-11-21T00:00:00Z",
          pinnedAt: "2026-11-21T01:00:00Z",
        },
        {
          environmentId: envId,
          id: "t-sub" as ThreadId,
          projectId: p2,
          title: "Hidden subagent",
          updatedAt: "2026-11-23T15:00:00Z",
          isSubagent: true,
        },
      ],
    });

    // Scratch & archived projects excluded; Prismux ordered first by pinned/latest thread.
    expect(result.groups.map((g) => g.project.title)).toEqual(["Prismux", "Alpha"]);
    expect(result.groups[0]?.threads.map((t) => t.id)).toEqual(["t-pinned", "t-latest"]);
    expect(result.recentThreads.some((t) => t.id === "t-sub")).toBe(false);
  });
});
