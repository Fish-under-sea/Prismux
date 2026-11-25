import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
  type ProjectId,
  type ServerProvider,
  type ThreadId,
} from "@prismux/core-contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
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
import { createSidebarOpenStore, Sidebar, SidebarProvider } from "../ui/sidebar";
import { resolveSidebarState } from "../ui/sidebarState";
import { TooltipProvider } from "../ui/tooltip";
import { PrismuxSidebarQuickNav } from "./PrismuxSidebarQuickNav";
import {
  executeBrandMenuForceReload,
  executeBrandMenuReload,
  executeBrandMenuToggleDevTools,
  handleSidebarHeaderToggleClick,
  resolveBrandMenuDeveloperShortcuts,
  resolveDefaultAvailableModelSelection,
  resolveSidebarUtilityNavIds,
  SIDEBAR_APP_MENU_ITEM_IDS,
  SIDEBAR_HEADER_CONTROL_ORDER,
  SidebarBrandMenuItems,
  SidebarChromeFooter,
  SidebarChromeHeader,
  SidebarRailMonogramButton,
} from "./SidebarChrome";
import { OrcaProjectsHeader } from "./orcaProjects/OrcaProjectsHeader";
import { DEFAULT_ORCA_PROJECTS_PREFS } from "./orcaProjects/orcaProjects.logic";
import { ProjectMonogram } from "../ProjectMonogram";
import { resolveSidebarUtilityOverflow } from "./sidebarMicroIndicators";
import {
  buildSidebarPeekGroups,
  resolveSidebarPeekDecision,
  SIDEBAR_PEEK_CLOSE_DELAY_MS,
  SIDEBAR_PEEK_OPEN_DELAY_MS,
  SIDEBAR_PEEK_WIDTH_PX,
} from "./sidebarPeek.logic";

describe("SidebarChrome Orca header order & footer utility cleanup", () => {
  it("excludes help, wallpaper, toggle-sidebar, issues, and pull-requests and enforces footer partition ([settings, usage] ... [locate, tasks, workspace-board])", () => {
    const expanded = resolveSidebarUtilityNavIds({
      railCompact: false,
    });
    const collapsedRail = resolveSidebarUtilityNavIds({
      railCompact: true,
    });

    for (const list of [expanded, collapsedRail]) {
      expect(list).not.toContain("help");
      expect(list).not.toContain("wallpaper");
      expect(list).not.toContain("toggle-sidebar");
      expect(list).not.toContain("issues");
      expect(list).not.toContain("pull-requests");
      expect(list).toContain("settings");
      expect(list).toContain("usage");
      expect(list).toContain("locate");
      expect(list).toContain("tasks");
      expect(list).toContain("workspace-board");
    }

    // Expanded Orca partition: left [settings, usage], right [locate, tasks, workspace-board].
    expect(expanded).toEqual(["settings", "usage", "locate", "tasks", "workspace-board"]);

    // 54px vertical rail stacks right utility actions above [settings, usage] at the bottom.
    expect(collapsedRail).toEqual(["locate", "tasks", "workspace-board", "settings", "usage"]);

    // At standard desktop sidebar widths (200px, 256px, 280px), all 5 compact 26x26 icons stay visible (never swallowed by More).
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

    // Confirm the removed footer buttons (help, wallpaper, toggle-sidebar, issues, pull-requests) are completely gone from SidebarChrome.tsx
    // and tasks + workspace-board live in the footer utility toolbar instead.
    expect(source).not.toContain('id: "help"');
    expect(source).not.toContain('id: "wallpaper"');
    expect(source).not.toContain('id: "toggle-sidebar"');
    expect(source).not.toContain('id: "issues"');
    expect(source).not.toContain('id: "pull-requests"');
    expect(source).not.toContain("IssueGlyph");
    expect(source).not.toContain("PullRequestGlyph");
    expect(source).not.toContain("sidebar-utility-help-trigger");
    expect(source).not.toContain("Wallpaper & appearance");
    expect(source).toContain('id: "tasks"');
    expect(source).toContain('id: "workspace-board"');

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

    // Confirm collapsed sidebar hover-preview drawer is disabled so hovering the top-left expand button
    // (or approaching it across the icon rail) never pops up a floating overlay that covers it or steals clicks.
    expect(source).not.toContain("SidebarCollapsedPeekDrawer");
    expect(source).not.toContain('data-pmx-sidebar-peek="1"');
    expect(source).not.toContain('data-sidebar-peek-hotzone="true"');
    expect(source).not.toContain('data-sidebar-peek-pin="true"');
    expect(source).not.toContain("pointerenter");
    expect(source).toContain("<SidebarHeaderToggleButton railCompact onBackdrop={onBackdrop} />");

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
    // Hovering the collapsed expand trigger must ALWAYS return close-now (never schedule or keep open).
    expect(
      resolveSidebarPeekDecision(false, {
        railCompact: true,
        pointerInRail: true,
        pointerInDrawer: false,
        openMenuCount: 0,
        dismissedByEscape: false,
        pointerInExpandTrigger: true,
      }),
    ).toBe("close-now");
    expect(
      resolveSidebarPeekDecision(true, {
        railCompact: true,
        pointerInRail: true,
        pointerInDrawer: true,
        openMenuCount: 1,
        dismissedByEscape: false,
        pointerInExpandTrigger: true,
      }),
    ).toBe("close-now");
  });

  it("renders the collapsed sidebar expand button without any hover-preview overlay and expands directly on click", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;

    const collapsedHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: zhTranslations },
        createElement(
          TooltipProvider,
          null,
          createElement(
            SidebarProvider,
            { defaultOpen: false },
            createElement(
              Sidebar,
              { side: "left", collapsible: "icon" },
              createElement(SidebarChromeHeader, { isElectron: true }),
            ),
          ),
        ),
      ),
    );

    // Collapsed 54px icon rail renders the top-left expand button cleanly with zero hover-preview overlay.
    expect(collapsedHtml).toContain('data-sidebar-state="collapsed"');
    expect(collapsedHtml).toContain('data-collapsible="icon"');
    expect(collapsedHtml).toContain('data-sidebar-rail-compact="true"');
    expect(collapsedHtml).toContain('data-sidebar-header-toggle="true"');
    expect(collapsedHtml).toContain('data-sidebar="trigger"');
    expect(collapsedHtml).toContain('aria-label="展开侧边栏"');
    expect(collapsedHtml).toContain('aria-pressed="false"');
    expect(collapsedHtml).not.toContain("data-pmx-sidebar-peek");
    expect(collapsedHtml).not.toContain("data-sidebar-peek-hotzone");
    expect(collapsedHtml).not.toContain("data-sidebar-peek-pin");

    // Clicking the collapsed expand button immediately expands the real docked sidebar store.
    const store = createSidebarOpenStore(false, undefined);
    expect(store.getSnapshot().open).toBe(false);
    expect(
      resolveSidebarState({
        isMobile: false,
        open: store.getSnapshot().open,
        openMobile: store.getSnapshot().openMobile,
      }),
    ).toBe("collapsed");

    handleSidebarHeaderToggleClick(true, {
      setOpen: store.setOpen,
      toggleSidebar: store.toggle,
    });
    expect(store.getSnapshot().open).toBe(true);
    expect(
      resolveSidebarState({
        isMobile: false,
        open: store.getSnapshot().open,
        openMobile: store.getSnapshot().openMobile,
      }),
    ).toBe("expanded");

    // Defensive check: clicking collapsed expand action is idempotent and stays expanded.
    handleSidebarHeaderToggleClick(true, {
      setOpen: store.setOpen,
      toggleSidebar: store.toggle,
    });
    expect(store.getSnapshot().open).toBe(true);

    // Clicking the header toggle when expanded collapses cleanly back to icon rail.
    handleSidebarHeaderToggleClick(false, {
      setOpen: store.setOpen,
      toggleSidebar: store.toggle,
    });
    expect(store.getSnapshot().open).toBe(false);
    expect(
      resolveSidebarState({
        isMobile: false,
        open: store.getSnapshot().open,
        openMobile: store.getSnapshot().openMobile,
      }),
    ).toBe("collapsed");
  });

  it("keeps all collapsed icon rail quick-nav buttons intact when sidebar is collapsed", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;
    const rootRoute = createRootRoute();
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

    const RouterContextWrapper = RouterContextProvider as React.ComponentType<{
      readonly router: unknown;
      readonly children?: React.ReactNode;
    }>;

    const railHtml = renderToStaticMarkup(
      createElement(
        RouterContextWrapper,
        { router },
        createElement(
          GTProvider,
          { locale: "zh", translations: zhTranslations },
          createElement(
            TooltipProvider,
            null,
            createElement(
              SidebarProvider,
              { defaultOpen: false },
              createElement(PrismuxSidebarQuickNav, {
                routeThreadRef: null,
                showSearch: true,
              }),
            ),
          ),
        ),
      ),
    );

    expect(railHtml).toContain('data-testid="prismux-sidebar-quick-nav"');
    expect(railHtml).toContain('data-rail-mode="true"');
    expect(railHtml).toContain('data-testid="prismux-sidebar-search-button"');
    expect(railHtml).toContain('data-testid="prismux-nav-diagnostics"');
    expect(railHtml).not.toContain('data-testid="prismux-nav-tasks"');
    expect(railHtml).not.toContain('data-testid="prismux-nav-workspace-board"');
    expect(railHtml).toContain('data-testid="prismux-nav-automations"');
    expect(railHtml).toContain('data-testid="prismux-nav-overnight-factory"');
    expect(railHtml).not.toContain('data-testid="prismux-nav-mobile"');
    expect(railHtml).not.toContain("data-pmx-sidebar-peek");
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

  it("wires one shared snappy TooltipProvider across the full collapsed sidebar rail with zero native title attributes or floating peek drawer", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;

    const sidebarDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const sidebarSource = fs.readFileSync(path.join(sidebarDir, "..", "Sidebar.tsx"), "utf8");

    // Sidebar.tsx must wrap Header + Content + Footer in one shared TooltipProvider using rail timing constants.
    const providerIdx = sidebarSource.indexOf("<TooltipProvider");
    const headerIdx = sidebarSource.indexOf("<SidebarChromeHeader isElectron={isElectron} />");
    const footerIdx = sidebarSource.indexOf("<SidebarChromeFooter />");
    expect(providerIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(providerIdx);
    expect(footerIdx).toBeGreaterThan(headerIdx);
    expect(sidebarSource).toContain("SIDEBAR_RAIL_TOOLTIP_DELAY_MS");
    expect(sidebarSource).toContain("SIDEBAR_RAIL_TOOLTIP_CLOSE_DELAY_MS");
    expect(sidebarSource).toContain("SIDEBAR_RAIL_TOOLTIP_TIMEOUT_MS");
    expect(sidebarSource).not.toContain("data-pmx-sidebar-peek");
    expect(sidebarSource).not.toContain('key="sidebar-rail-thread-tooltips"');

    const rootRoute = createRootRoute();
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const RouterContextWrapper = RouterContextProvider as React.ComponentType<{
      readonly router: unknown;
      readonly children?: React.ReactNode;
    }>;

    const fullRailHtml = renderToStaticMarkup(
      createElement(
        RouterContextWrapper,
        { router },
        createElement(
          GTProvider,
          { locale: "zh", translations: zhTranslations },
          createElement(
            TooltipProvider,
            { delay: 100, closeDelay: 0, timeout: 400 },
            createElement(
              SidebarProvider,
              { defaultOpen: false },
              createElement(
                Sidebar,
                { side: "left", collapsible: "icon" },
                createElement(SidebarChromeHeader, { isElectron: true }),
                createElement(PrismuxSidebarQuickNav, { routeThreadRef: null, showSearch: true }),
                createElement(OrcaProjectsHeader, {
                  projectsOpen: true,
                  onToggleProjectsOpen: vi.fn(),
                  canToggleAllProjects: true,
                  allProjectsCollapsed: false,
                  onToggleCollapseAllProjects: vi.fn(),
                  activityViewActive: false,
                  onToggleActivityView: vi.fn(),
                  activityBadge: {
                    attentionCount: 0,
                    workingCount: 0,
                    unreadCount: 0,
                    completedCount: 0,
                    displayCount: 0,
                    tone: "idle",
                  },
                  prefs: DEFAULT_ORCA_PROJECTS_PREFS,
                  onUpdatePrefs: vi.fn(),
                  onMarkAllRead: vi.fn(),
                  onClearCompleted: vi.fn(),
                  environments: [],
                  selectedAddProjectEnvId: null,
                  onSelectAddProjectEnvId: vi.fn(),
                  onBrowseFolder: vi.fn(),
                  onOpenCloneDialog: vi.fn(),
                  onOpenCreateProjectDialog: vi.fn(),
                  onOpenCreateWorkspace: vi.fn(),
                }),
                createElement(SidebarRailMonogramButton, {
                  icon: createElement(ProjectMonogram, { text: "PX", color: "blue" }),
                  primaryLabel: "Prismux",
                  ariaLabel: "Prismux",
                  dataProjectKey: "proj-prismux",
                  onClick: vi.fn(),
                }),
                createElement(SidebarChromeFooter),
              ),
            ),
          ),
        ),
      ),
    );

    // Zero floating peek drawer or duplicate native browser title tooltips anywhere on the collapsed rail.
    expect(fullRailHtml).not.toContain("data-pmx-sidebar-peek");
    expect(fullRailHtml).not.toContain("data-sidebar-peek-hotzone");
    expect(fullRailHtml).not.toMatch(/\stitle="/);

    // Every collapsed-rail button is wired as a Base UI TooltipTrigger with concise Chinese aria-labels.
    expect(fullRailHtml).toContain("data-base-ui-tooltip-trigger");
    expect(fullRailHtml).toContain('aria-label="展开侧边栏"');
    expect(fullRailHtml).toContain('aria-label="搜索"');
    expect(fullRailHtml).toContain('aria-label="服务体检"');
    expect(fullRailHtml).toContain('aria-label="定时任务"');
    expect(fullRailHtml).toContain('aria-label="夜间工场与邮箱"');
    expect(fullRailHtml).not.toContain('aria-label="Prismux 手机端"');
    expect(fullRailHtml).toContain('aria-label="通知"');
    expect(fullRailHtml).toContain('aria-label="新工作区"');
    expect(fullRailHtml).toContain('aria-label="Prismux"');
    expect(fullRailHtml).toContain('data-sidebar-utility-item="locate"');
    expect(fullRailHtml).toContain('aria-label="定位当前会话"');
    expect(fullRailHtml).toContain('data-sidebar-utility-item="tasks"');
    expect(fullRailHtml).toContain('aria-label="任务面板"');
    expect(fullRailHtml).toContain('data-sidebar-utility-item="workspace-board"');
    expect(fullRailHtml).toContain('aria-label="工作区板"');
    expect(fullRailHtml).not.toContain('data-sidebar-utility-item="issues"');
    expect(fullRailHtml).not.toContain('data-sidebar-utility-item="pull-requests"');
    expect(fullRailHtml).toContain('data-sidebar-utility-item="settings"');
    expect(fullRailHtml).toContain('aria-label="设置"');
    expect(fullRailHtml).toContain('data-sidebar-utility-item="usage"');
    expect(fullRailHtml).toContain('aria-label="用量"');
  });

  it("renders right-side TooltipPopup labels for every collapsed 54px rail icon from top to bottom in zh and en", async () => {
    vi.resetModules();
    const createTooltipMock = () => ({
      TooltipProvider: ({ children }: { readonly children?: React.ReactNode }) =>
        createElement("div", { "data-test-tooltip-provider": "true" }, children),
      Tooltip: ({ children }: { readonly children?: React.ReactNode }) =>
        createElement("span", { "data-test-tooltip-root": "true" }, children),
      TooltipTrigger: ({
        render,
        children,
      }: {
        readonly render?: React.ReactElement<{ readonly children?: React.ReactNode }>;
        readonly children?: React.ReactNode;
      }) =>
        render
          ? createElement(
              "span",
              { "data-test-tooltip-trigger": "true" },
              render,
              children ?? null,
            )
          : createElement("button", { type: "button", "data-test-tooltip-trigger": "true" }, children),
      TooltipPopup: ({
        side = "top",
        sideOffset,
        children,
      }: {
        readonly side?: string;
        readonly sideOffset?: number;
        readonly children?: React.ReactNode;
      }) =>
        createElement(
          "output",
          {
            "data-test-tooltip-popup": "true",
            "data-tooltip-side": side,
            "data-tooltip-offset": sideOffset ?? 4,
          },
          children,
        ),
    });
    vi.doMock("../ui/tooltip", createTooltipMock);
    vi.doMock("~/components/ui/tooltip", createTooltipMock);

    try {
      // Ensure mocked tooltip module settles before loading consumer components.
      await import("../ui/tooltip");
      const uiSidebarMod = await import("../ui/sidebar");
      const chromeMod = await import("./SidebarChrome");
      const quickNavMod = await import("./PrismuxSidebarQuickNav");
      const orcaHeaderMod = await import("./orcaProjects/OrcaProjectsHeader");

      initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
      const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
        Parameters<typeof GTProvider>[0]["translations"]
      >;

      const renderCollapsedRail = (locale: "zh" | "en", initialPath: string, activityViewActive = false) => {
        const rootRoute = createRootRoute();
        const router = createRouter({
          routeTree: rootRoute,
          history: createMemoryHistory({ initialEntries: [initialPath] }),
        });
        const RouterContextWrapper = RouterContextProvider as React.ComponentType<{
          readonly router: unknown;
          readonly children?: React.ReactNode;
        }>;
        return renderToStaticMarkup(
          createElement(
            RouterContextWrapper,
            { router },
            createElement(
              GTProvider,
              { locale, translations: zhTranslations },
              createElement(
                uiSidebarMod.SidebarProvider,
                { defaultOpen: false },
                createElement(
                  uiSidebarMod.Sidebar,
                  { side: "left", collapsible: "icon" },
                  createElement(chromeMod.SidebarChromeHeader, { isElectron: true }),
                  createElement(quickNavMod.PrismuxSidebarQuickNav, {
                    routeThreadRef: null,
                    showSearch: true,
                  }),
                  createElement(orcaHeaderMod.OrcaProjectsHeader, {
                    projectsOpen: true,
                    onToggleProjectsOpen: vi.fn(),
                    canToggleAllProjects: true,
                    allProjectsCollapsed: false,
                    onToggleCollapseAllProjects: vi.fn(),
                    activityViewActive,
                    onToggleActivityView: vi.fn(),
                    activityBadge: {
                      attentionCount: 1,
                      workingCount: 0,
                      unreadCount: 1,
                      completedCount: 0,
                      displayCount: 1,
                      tone: "attention",
                    },
                    prefs: DEFAULT_ORCA_PROJECTS_PREFS,
                    onUpdatePrefs: vi.fn(),
                    onMarkAllRead: vi.fn(),
                    onClearCompleted: vi.fn(),
                    environments: [],
                    selectedAddProjectEnvId: null,
                    onSelectAddProjectEnvId: vi.fn(),
                    onBrowseFolder: vi.fn(),
                    onOpenCloneDialog: vi.fn(),
                    onOpenCreateProjectDialog: vi.fn(),
                    onOpenCreateWorkspace: vi.fn(),
                  }),
                  createElement(chromeMod.SidebarRailMonogramButton, {
                    icon: createElement(ProjectMonogram, { text: "PX", color: "blue" }),
                    primaryLabel: "Prismux",
                    ariaLabel: "Prismux",
                    dataProjectKey: "proj-prismux",
                    onClick: vi.fn(),
                  }),
                  createElement(chromeMod.SidebarRailMonogramButton, {
                    icon: createElement(ProjectMonogram, { text: "PX", color: "blue" }),
                    primaryLabel: "修复侧边栏",
                    secondaryLabel: "Prismux",
                    ariaLabel: "修复侧边栏 (Prismux)",
                    dataRow: "env:thread-1",
                    onClick: vi.fn(),
                  }),
                  createElement(chromeMod.SidebarChromeFooter),
                ),
              ),
            ),
          ),
        );
      };

      const extractPopups = (html: string) =>
        Array.from(
          html.matchAll(
            /<output data-test-tooltip-popup="true" data-tooltip-side="([^"]+)" data-tooltip-offset="([^"]+)">([\s\S]*?)<\/output>/g,
          ),
          (match) => ({
            side: match[1]!,
            offset: Number(match[2]!),
            text: match[3]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          }),
        );

      const zhHtml = renderCollapsedRail("zh", "/");
      expect(zhHtml).not.toContain("data-pmx-sidebar-peek");
      expect(zhHtml).not.toMatch(/\stitle="/);

      const zhPopups = extractPopups(zhHtml);
      expect(zhPopups.length).toBeGreaterThanOrEqual(14);
      // Every single collapsed-rail tooltip popup MUST open on the right side!
      for (const popup of zhPopups) {
        expect(popup.side, `Tooltip "${popup.text}" must appear on side="right"`).toBe("right");
      }

      const zhTexts = zhPopups.map((popup) => popup.text);
      expect(zhTexts).toContain("展开侧边栏");
      expect(zhTexts).toContain("搜索");
      expect(zhTexts).toContain("服务体检");
      expect(zhTexts).toContain("定时任务");
      expect(zhTexts).toContain("夜间工场与邮箱");
      expect(zhTexts).not.toContain("Prismux 手机端");
      expect(zhTexts).toContain("通知");
      expect(zhTexts).toContain("新工作区");
      expect(zhTexts).toContain("Prismux");
      expect(zhTexts).toContain("修复侧边栏 Prismux");
      expect(zhTexts).toContain("定位当前会话");
      expect(zhTexts).toContain("任务面板");
      expect(zhTexts).toContain("工作区板");
      expect(zhTexts).not.toContain("issue");
      expect(zhTexts).not.toContain("PR");
      expect(zhTexts).toContain("设置");
      expect(zhTexts).toContain("用量");
      expect(zhTexts).toContain("更多导航项");

      // Active toggleable panel (/tasks, /workspace-board, /overnight-factory) keeps footer Tasks/Workspace Board buttons visible & highlighted
      const zhTasksHtml = renderCollapsedRail("zh", "/tasks", false);
      expect(zhTasksHtml).toContain('data-sidebar-utility-item="tasks"');
      expect(zhTasksHtml).toContain('aria-current="page"');
      expect(zhTasksHtml).toContain('data-sidebar-utility-item="workspace-board"');

      const zhBoardHtml = renderCollapsedRail("zh", "/workspace-board", false);
      expect(zhBoardHtml).toContain('data-sidebar-utility-item="workspace-board"');
      expect(zhBoardHtml).toContain('aria-current="page"');

      const zhFactoryHtml = renderCollapsedRail("zh", "/overnight-factory", false);
      expect(zhFactoryHtml).toContain('data-testid="prismux-nav-overnight-factory"');
      expect(zhFactoryHtml).toContain('aria-current="page"');

      const zhDiagnosticsHtml = renderCollapsedRail("zh", "/diagnostics", false);
      expect(zhDiagnosticsHtml).toContain('data-testid="prismux-nav-diagnostics"');
      expect(zhDiagnosticsHtml).toContain('aria-current="page"');
      expect(zhDiagnosticsHtml).toContain('aria-pressed="true"');

      // Project settings utility page still renders Back button tooltip on the right
      const zhUtilityHtml = renderCollapsedRail("zh", "/projects/demo", true);
      const zhUtilityTexts = extractPopups(zhUtilityHtml).map((popup) => popup.text);
      expect(zhUtilityTexts).toContain("关闭通知");
      expect(zhUtilityTexts).toContain("返回");

      // English locale parity
      const enHtml = renderCollapsedRail("en", "/");
      const enPopups = extractPopups(enHtml);
      for (const popup of enPopups) {
        expect(popup.side, `EN Tooltip "${popup.text}" must appear on side="right"`).toBe("right");
      }
      const enTexts = enPopups.map((popup) => popup.text);
      expect(enTexts).toContain("Expand sidebar");
      expect(enTexts).toContain("Search");
      expect(enTexts).toContain("Service diagnostics");
      expect(enTexts).toContain("Scheduled Tasks");
      expect(enTexts).toContain("Overnight Factory");
      expect(enTexts).not.toContain("Prismux Mobile");
      expect(enTexts).toContain("Notifications");
      expect(enTexts).toContain("New workspace");
      expect(enTexts).toContain("Prismux");
      expect(enTexts).toContain("Locate current thread");
      expect(enTexts).toContain("Tasks");
      expect(enTexts).toContain("Workspace board");
      expect(enTexts).not.toContain("Issues");
      expect(enTexts).not.toContain("Pull requests");
      expect(enTexts).toContain("Settings");
      expect(enTexts).toContain("Usage");
      expect(enTexts).toContain("More navigation items");
    } finally {
      vi.doUnmock("../ui/tooltip");
      vi.doUnmock("~/components/ui/tooltip");
      vi.resetModules();
    }
  });

  it("renders Settle, Archive, and Delete hover quick-actions on SidebarThreadRow across all 3 row variants", () => {
    const sidebarDir = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const threadRowSrc = fs.readFileSync(path.join(sidebarDir, "SidebarThreadRow.tsx"), "utf8");
    const sidebarSrc = fs.readFileSync(path.join(sidebarDir, "..", "Sidebar.tsx"), "utf8");

    expect(threadRowSrc).toContain("ArchiveIcon");
    expect(threadRowSrc).toContain("Trash2Icon");
    expect(threadRowSrc).toContain('data-testid="sidebar-row-archive-action"');
    expect(threadRowSrc).toContain('data-testid="sidebar-row-delete-action"');
    expect(threadRowSrc).toContain("hover:text-destructive");
    expect(threadRowSrc).toContain('gt("Archive thread")');
    expect(threadRowSrc).toContain('gt("Delete", { $context: "verb, delete the thread" })');
    expect(sidebarSrc).toContain("onArchive={attemptArchive}");
    expect(sidebarSrc).toContain("onDelete={attemptDelete}");
  });
});
