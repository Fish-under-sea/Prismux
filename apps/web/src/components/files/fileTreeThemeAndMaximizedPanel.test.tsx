import { EnvironmentId } from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "~/i18n/locales";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "~/pierre-tree-theme";
import { RightPanelTabs, type RightPanelTabsProps } from "../RightPanelTabs";
import {
  WorkspaceTopbarPortalContext,
  type WorkspaceTopbarPortalContextValue,
} from "../workspace/WorkspaceTopbarPortalContext";
import { FileExplorerPane } from "./FileExplorerPane";

beforeAll(async () => {
  await initializeGT({
    defaultLocale: DEFAULT_LOCALE,
    locales: [...SUPPORTED_LOCALES],
    loadTranslations: async () => ({}),
    cacheExpiryTime: null,
  });
});

function makeRightPanelProps(overrides: Partial<RightPanelTabsProps> = {}): RightPanelTabsProps {
  const noop = () => {};
  return {
    mode: "inline",
    open: true,
    maximized: true,
    keybindings: [],
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: true,
      isWeb: true,
      isDesktop: false,
    }),
    surfaces: [{ id: "files", kind: "files" }],
    environmentId: EnvironmentId.make("local"),
    activeSurfaceId: "files",
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
    children: createElement("div", { "data-testid": "maximized-surface-body" }, "files-body"),
    ...overrides,
  };
}

function renderRightPanel(
  props: Partial<RightPanelTabsProps>,
  managedTopbar: boolean,
): string {
  const portalValue: WorkspaceTopbarPortalContextValue = {
    managed: managedTopbar,
    slotElement: null,
    tabBarRef: { current: null },
    setHasActiveChatControls: () => {},
    standaloneRightPanelOpen: false,
  };
  return renderToStaticMarkup(
    createElement(
      GTProvider,
      { locale: "en", translations: {} },
      createElement(
        WorkspaceTopbarPortalContext.Provider,
        { value: portalValue },
        createElement(RightPanelTabs, makeRightPanelProps(props)),
      ),
    ),
  );
}

describe("pierre-tree-theme RC.3 accent, focus-ring, glass & theme-substrate overrides", () => {
  it("overrides accent, focus ring, selected focus border, selected bg/fg, hover, radius, and scrollbar with zero #009fff leak", () => {
    expect(PIERRE_TREE_UNSAFE_CSS.toLowerCase()).not.toContain("#009fff");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-accent-override:");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-focus-ring-color-override:");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-selected-focused-border-color-override:");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-selected-bg-override:");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-selected-fg-override:");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-hover-bg-override:");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-bg-muted-override:");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-border-radius-override: 9px;");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--trees-scrollbar-thumb-override:");

    // Theme substrate active-row glaze + symmetric scroll padding + reduced-motion guard
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--pmx-glass-base-active-row-bg-color");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--pmx-glass-base-active-row-bg-image");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("--pmx-glass-base-active-row-shadow");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("[data-file-tree-virtualized-scroll='true']");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("padding-inline: 8px;");
    expect(PIERRE_TREE_UNSAFE_CSS).toContain("@media (prefers-reduced-motion: reduce)");

    for (const scheme of ["light", "dark"] as const) {
      const style = pierreTreeStyle(scheme) as Record<string, string>;
      expect(style.colorScheme).toBe(scheme);
      expect(JSON.stringify(style).toLowerCase()).not.toContain("#009fff");
      expect(style["--trees-accent-override"]).toContain("var(--pmx-accent");
      expect(style["--trees-focus-ring-color-override"]).toContain("var(--pmx-accent");
      expect(style["--trees-selected-focused-border-color-override"]).toContain("var(--pmx-accent");
      expect(style["--trees-selected-bg-override"]).toContain(
        "var(--pmx-glass-base-active-row-bg-color",
      );
      expect(style["--trees-selected-fg-override"]).toBe("var(--contrast-foreground)");
      expect(style["--trees-hover-bg-override"]).toContain("var(--pmx-accent");
      expect(style["--trees-bg-muted-override"]).toContain("var(--pmx-accent");
      expect(style["--trees-border-radius-override"]).toBe("9px");
      expect(style["--trees-scrollbar-thumb-override"]).toContain("var(--contrast-foreground");
    }
  });
});

describe("RightPanelTabs + PreviewPanelShell maximized PrismuxStageFrame adaptation (RC.3)", () => {
  it("wraps both tabbar and surface content inside PrismuxStageFrame when managed topbar is active and strips outer rightSidebar glass zone", () => {
    const html = renderRightPanel({ mode: "inline", maximized: true }, true);

    expect(html).toContain('data-preview-panel-mode="inline"');
    expect(html).toContain('data-preview-panel-maximized="true"');
    expect(html).not.toContain('data-pmx-glass-zone="rightSidebar"');
    expect(html).toContain('data-pmx-stage-frame="1"');
    expect(html).toContain('data-pmx-inner-stage="1"');
    expect(html).toContain('data-pmx-glass-zone="mainCanvas"');
    expect(html).toContain('data-right-panel-maximized-stage="1"');
    expect(html).toContain('data-pmx-right-frame-edge="1"');

    // In managed workspace mode, BOTH tabbar and surface content sit INSIDE the maximized inner stage.
    const innerStageIdx = html.indexOf('data-right-panel-maximized-stage="1"');
    const tabbarIdx = html.indexOf("data-right-panel-tabbar");
    const contentIdx = html.indexOf("data-right-panel-surface-content");
    expect(innerStageIdx).toBeGreaterThan(-1);
    expect(tabbarIdx).toBeGreaterThan(innerStageIdx);
    expect(contentIdx).toBeGreaterThan(tabbarIdx);
  });

  it("keeps tabbar outside in shellFrame and wraps surface content in PrismuxStageFrame when standalone titlebar mode is active", () => {
    const html = renderRightPanel({ mode: "inline", maximized: true }, false);

    expect(html).toContain('data-preview-panel-maximized="true"');
    expect(html).not.toContain('data-pmx-glass-zone="rightSidebar"');
    expect(html).toContain('data-pmx-stage-frame="1"');
    expect(html).toContain('data-right-panel-maximized-stage="1"');

    const tabbarIdx = html.indexOf("data-right-panel-tabbar");
    const stageFrameIdx = html.indexOf('data-pmx-stage-frame="1"');
    const innerStageIdx = html.indexOf('data-right-panel-maximized-stage="1"');
    const contentIdx = html.indexOf("data-right-panel-surface-content");

    expect(tabbarIdx).toBeGreaterThan(-1);
    expect(stageFrameIdx).toBeGreaterThan(tabbarIdx);
    expect(innerStageIdx).toBeGreaterThan(stageFrameIdx);
    expect(contentIdx).toBeGreaterThan(innerStageIdx);
    expect(html.slice(Math.max(0, tabbarIdx - 120), tabbarIdx + 30)).toContain(
      'data-pmx-glass-zone="shellFrame"',
    );
  });

  it("preserves existing non-maximized inline rightSidebar DOM untouched", () => {
    const html = renderRightPanel({ mode: "inline", maximized: false }, true);

    expect(html).toContain('data-preview-panel-mode="inline"');
    expect(html).toContain('data-preview-panel-maximized="false"');
    expect(html).toContain('data-pmx-glass-zone="rightSidebar"');
    expect(html).not.toContain('data-pmx-stage-frame="1"');
    expect(html).not.toContain('data-right-panel-maximized-stage="1"');
  });
});

describe("FileExplorerPane inner rounded-corner card & flush mode (RC.3)", () => {
  it("renders rounded glass-ready card framing when resizable and flush container when non-resizable", () => {
    const resizableHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <FileExplorerPane resizable>tree</FileExplorerPane>
      </GTProvider>,
    );
    expect(resizableHtml).toContain('data-pmx-file-explorer-pane="1"');
    expect(resizableHtml).toContain('data-pmx-file-explorer-resizable="1"');
    expect(resizableHtml).toContain("rounded-xl");
    expect(resizableHtml).toContain("m-1.5");
    expect(resizableHtml).toContain("overflow-hidden");

    const flushHtml = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <FileExplorerPane resizable={false}>tree</FileExplorerPane>
      </GTProvider>,
    );
    expect(flushHtml).toContain('data-pmx-file-explorer-pane="1"');
    expect(flushHtml).toContain('data-pmx-file-explorer-resizable="0"');
    expect(flushHtml).toContain("flex-1");
    expect(flushHtml).not.toContain("rounded-xl");
  });
});
