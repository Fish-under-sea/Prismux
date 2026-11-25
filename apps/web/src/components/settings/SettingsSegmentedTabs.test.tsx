import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useLocation: (opts?: {
    select?: (loc: { hash: string; pathname: string; state: Record<string, unknown> }) => unknown;
  }) => {
    const loc = { hash: "", pathname: "/settings/general", state: {} };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

import { getThemeSnapshot } from "../../hooks/useTheme";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import {
  SETTINGS_CONTROL_LG,
  SETTINGS_CONTROL_MD,
  SETTINGS_CONTROL_SM,
  SettingsPageContainer,
  scrollToSettingsTarget,
} from "./settingsLayout";
import {
  SETTINGS_REVEAL_TARGET_EVENT,
  SettingsSegmentedTabs,
  dispatchSettingsRevealTarget,
  normalizeSettingsHashAnchor,
  resolveInitialSettingsTabId,
  resolveNextSettingsTabIdByKey,
  resolveSettingsTabIdForAnchor,
  type SettingsSegmentedTabItem,
} from "./SettingsSegmentedTabs";

const SAMPLE_TABS: ReadonlyArray<SettingsSegmentedTabItem> = [
  {
    id: "theme",
    label: "Theme & Colors",
    hashAnchors: ["color-scheme", "accent-color"],
    content: <div id="color-scheme">Theme content</div>,
  },
  {
    id: "glass",
    label: "Liquid Glass",
    badge: 8,
    hashAnchors: ["glass-preset", "glass-zones"],
    content: <div id="glass-zones">Glass content</div>,
  },
  {
    id: "typography",
    label: "Typography",
    badge: "Pro",
    hashAnchors: ["interface-font", "code-font"],
    content: <div id="interface-font">Typography content</div>,
  },
];

describe("SettingsSegmentedTabs helpers", () => {
  it("normalizes hash anchors cleanly with leading # removal and URI decoding", () => {
    expect(normalizeSettingsHashAnchor("#glass-zones")).toBe("glass-zones");
    expect(normalizeSettingsHashAnchor("  #interface-font  ")).toBe("interface-font");
    expect(normalizeSettingsHashAnchor("#glass%2Dzones")).toBe("glass-zones");
    expect(normalizeSettingsHashAnchor("#")).toBeNull();
    expect(normalizeSettingsHashAnchor("")).toBeNull();
    expect(normalizeSettingsHashAnchor(null)).toBeNull();
    expect(normalizeSettingsHashAnchor(undefined)).toBeNull();
  });

  it("resolves tab ids from direct tab id match or nested hashAnchors", () => {
    expect(resolveSettingsTabIdForAnchor(SAMPLE_TABS, "#glass")).toBe("glass");
    expect(resolveSettingsTabIdForAnchor(SAMPLE_TABS, "glass-zones")).toBe("glass");
    expect(resolveSettingsTabIdForAnchor(SAMPLE_TABS, "#code-font")).toBe("typography");
    expect(resolveSettingsTabIdForAnchor(SAMPLE_TABS, "#unknown-anchor")).toBeNull();
  });

  it("picks initial tab from anchor first, then defaultTabId, then first tab", () => {
    expect(resolveInitialSettingsTabId(SAMPLE_TABS, "theme", "#code-font")).toBe("typography");
    expect(resolveInitialSettingsTabId(SAMPLE_TABS, "glass", "#unknown")).toBe("glass");
    expect(resolveInitialSettingsTabId(SAMPLE_TABS, "missing-default", null)).toBe("theme");
  });

  it("resolves WAI-ARIA horizontal keyboard navigation with wrap-around", () => {
    expect(resolveNextSettingsTabIdByKey(SAMPLE_TABS, "theme", "ArrowRight")).toBe("glass");
    expect(resolveNextSettingsTabIdByKey(SAMPLE_TABS, "typography", "ArrowRight")).toBe("theme");
    expect(resolveNextSettingsTabIdByKey(SAMPLE_TABS, "theme", "ArrowLeft")).toBe("typography");
    expect(resolveNextSettingsTabIdByKey(SAMPLE_TABS, "glass", "Home")).toBe("theme");
    expect(resolveNextSettingsTabIdByKey(SAMPLE_TABS, "theme", "End")).toBe("typography");
    expect(resolveNextSettingsTabIdByKey(SAMPLE_TABS, "theme", "Enter")).toBeNull();
  });
});

describe("SettingsSegmentedTabs rendering & hash/reveal sync", () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: originalDocument,
      configurable: true,
      writable: true,
    });
  });

  it("renders accessible pill tablist, badges, trailingAction, and active tab panel", () => {
    const html = renderToStaticMarkup(
      <SettingsSegmentedTabs
        tabs={SAMPLE_TABS}
        defaultTabId="theme"
        trailingAction={<button type="button">Reset all</button>}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-slot="tabs-list"');
    expect(html).toContain('data-slot="tabs-trigger"');
    expect(html).toContain('data-tab-id="theme"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-active=""');
    expect(html).toContain('data-slot="settings-tab-badge"');
    expect(html).toContain(">8<");
    expect(html).toContain(">Pro<");
    expect(html).toContain("Reset all");
    expect(html).toContain('data-active-tab="theme"');
    expect(html).toContain("Theme content");
    expect(html).not.toContain("Glass content");
  });

  it("honors controlled activeTabId and automatically selects tab matching window.location.hash", () => {
    const controlledHtml = renderToStaticMarkup(
      <SettingsSegmentedTabs
        tabs={SAMPLE_TABS}
        defaultTabId="theme"
        activeTabId="typography"
        onTabChange={() => {}}
      />,
    );
    expect(controlledHtml).toContain('data-active-tab="typography"');
    expect(controlledHtml).toContain("Typography content");
    expect(controlledHtml).not.toContain("Theme content");

    Object.defineProperty(globalThis, "window", {
      value: { location: { hash: "#glass-zones" } },
      configurable: true,
      writable: true,
    });

    const hashHtml = renderToStaticMarkup(
      <SettingsSegmentedTabs tabs={SAMPLE_TABS} defaultTabId="theme" />,
    );
    expect(hashHtml).toContain('data-active-tab="glass"');
    expect(hashHtml).toContain("Glass content");
    expect(hashHtml).not.toContain("Theme content");
  });

  it("dispatches SETTINGS_REVEAL_TARGET_EVENT when scrollToSettingsTarget targets an unmounted tab anchor", () => {
    const dispatched: Array<Event> = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        dispatchEvent: (event: Event) => {
          dispatched.push(event);
          return true;
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        getElementById: () => null,
      },
      configurable: true,
      writable: true,
    });

    expect(scrollToSettingsTarget("glass-zones")).toBe(false);
    expect(dispatched).toHaveLength(1);
    const customEvent = dispatched[0] as CustomEvent<{ targetId: string; highlight: boolean }>;
    expect(customEvent.type).toBe(SETTINGS_REVEAL_TARGET_EVENT);
    expect(customEvent.detail).toEqual({ targetId: "glass-zones", highlight: true });

    dispatchSettingsRevealTarget("interface-font", { highlight: false });
    expect(dispatched).toHaveLength(2);
    const secondEvent = dispatched[1] as CustomEvent<{ targetId: string; highlight: boolean }>;
    expect(secondEvent.detail).toEqual({ targetId: "interface-font", highlight: false });
  });
});

describe("Low-density Settings foundation tokens, container widths, and dark cold-start theme", () => {
  it("exports standardized right-aligned control width tokens and 2-tier WorkspacePageContainer widths", () => {
    expect(SETTINGS_CONTROL_SM).toBe("w-36");
    expect(SETTINGS_CONTROL_MD).toBe("w-48");
    expect(SETTINGS_CONTROL_LG).toBe("w-60");

    const readableHtml = renderToStaticMarkup(
      <WorkspacePageContainer width="readable">Readable</WorkspacePageContainer>,
    );
    const wideHtml = renderToStaticMarkup(
      <WorkspacePageContainer width="wide">Wide</WorkspacePageContainer>,
    );
    const expandedHtml = renderToStaticMarkup(
      <WorkspacePageContainer width="expanded">Expanded</WorkspacePageContainer>,
    );
    const fullHtml = renderToStaticMarkup(
      <WorkspacePageContainer width="full">Full</WorkspacePageContainer>,
    );

    expect(readableHtml).toContain("max-w-[820px]");
    expect(readableHtml).toContain("px-6");
    expect(readableHtml).toContain("pt-7");
    expect(readableHtml).toContain("pb-14");
    expect(readableHtml).toContain("gap-7");
    expect(wideHtml).toContain("max-w-[1040px]");
    expect(expandedHtml).toContain("max-w-[1040px]");
    expect(fullHtml).toContain("max-w-none");
  });

  it("unifies SettingsPageContainer to full-width edge-to-edge fill regardless of legacy width props", () => {
    const cases = [
      renderToStaticMarkup(<SettingsPageContainer>Default</SettingsPageContainer>),
      renderToStaticMarkup(
        <SettingsPageContainer width="readable">Legacy Readable</SettingsPageContainer>,
      ),
      renderToStaticMarkup(<SettingsPageContainer width="wide">Legacy Wide</SettingsPageContainer>),
      renderToStaticMarkup(
        <SettingsPageContainer width="expanded">Legacy Expanded</SettingsPageContainer>,
      ),
      renderToStaticMarkup(
        <SettingsPageContainer width="full" className="gap-8">
          Explicit Full
        </SettingsPageContainer>,
      ),
    ];

    for (const html of cases) {
      expect(html).toContain("data-settings-page-scroll");
      expect(html).toContain("max-w-none");
      expect(html).toContain("px-6");
      expect(html).toContain("pt-6");
      expect(html).toContain("pb-14");
      expect(html).not.toContain("max-w-[820px]");
      expect(html).not.toContain("max-w-[1040px]");
      expect(html).not.toContain("mx-auto");
    }
    expect(cases[4]).toContain("gap-8");
  });

  it("defaults cold-start theme snapshot polarity to dark to eliminate white flash", () => {
    const snapshot = getThemeSnapshot();
    expect(snapshot.theme).toBe("dark");
    expect(snapshot.resolvedTheme).toBe("dark");
    expect(snapshot.appearanceMode).toBe("dark");
  });
});
