import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import { decodeMsg, GTProvider, initializeGT } from "gt-react";

import { settingsBreadcrumbLabel } from "./SettingsBreadcrumb";
import {
  movedSettingsPath,
  resolveLegacyMemorySyncRedirectTarget,
  SETTINGS_NAV_LABELS,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  settingsNavGroups,
} from "./settingsSearch";
import {
  areGeometryMapsEqual,
  buildIndicatorPillStyle,
  createGeometryOscillationGuard,
  createInitialIndicatorState,
  findSettingsNavTarget,
  resolveSettingsNavActivePath,
  SETTINGS_NAV_GEOMETRY_TOLERANCE_PX,
  SETTINGS_NAV_PARENT_ALIASES,
  SETTINGS_SIDEBAR_LAYOUT,
  transitionIndicatorState,
} from "./settingsSidebarMotion";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => "",
}));

vi.mock("./useAvailableSettingsSearchItems", () => ({
  useAvailableSettingsSearchItems: () => [],
  useHasSecretProvidersEnvironment: () => false,
}));

import { SidebarProvider } from "../ui/sidebar";
import { SettingsSidebarNav } from "./SettingsSidebarNav";

describe("settings sidebar navigation grouping, deduplication & conflict cleanup", () => {
  it("organizes settings into 4 clean logical groups without duplicates and honors platform/capability gates", () => {
    const groupsWindows = settingsNavGroups(false, false);
    expect(groupsWindows.map((group) => group.id)).toEqual([
      "general-appearance",
      "agents-workspace",
      "extensions-data",
      "system-about",
    ]);

    expect(groupsWindows.map((group) => group.paths)).toEqual([
      [
        "/settings/general",
        "/settings/chat",
        "/settings/voice",
        "/settings/appearance",
        "/settings/wallpaper",
        "/settings/keybindings",
      ],
      [
        "/settings/providers",
        "/settings/memory",
        "/settings/projects",
        "/settings/browser",
        "/settings/source-control",
      ],
      ["/settings/plugins", "/settings/sync", "/settings/connections"],
      ["/settings/maintenance", "/settings/about"],
    ]);

    const flatWindows = groupsWindows.flatMap((group) => group.paths);
    expect(new Set(flatWindows).size).toBe(flatWindows.length);
    // Appearance & Wallpaper are independent sibling entries in Group 1
    expect(flatWindows).toContain("/settings/appearance");
    expect(flatWindows).toContain("/settings/wallpaper");
    expect(flatWindows.indexOf("/settings/wallpaper")).toBe(
      flatWindows.indexOf("/settings/appearance") + 1,
    );
    // Chief & memory lives in Group 2 right before Projects & archive; Sync lives in Group 3 after Plugins
    expect(flatWindows).toContain("/settings/memory");
    expect(flatWindows).toContain("/settings/projects");
    expect(flatWindows).toContain("/settings/sync");
    expect(flatWindows.indexOf("/settings/memory")).toBe(
      flatWindows.indexOf("/settings/providers") + 1,
    );
    expect(flatWindows.indexOf("/settings/projects")).toBe(
      flatWindows.indexOf("/settings/memory") + 1,
    );
    expect(flatWindows.indexOf("/settings/sync")).toBe(
      flatWindows.indexOf("/settings/plugins") + 1,
    );
    expect(flatWindows.indexOf("/settings/connections")).toBe(
      flatWindows.indexOf("/settings/sync") + 1,
    );
    expect(flatWindows).not.toContain("/settings/memory-sync");
    // Merged / removed / promoted top-level entries
    expect(flatWindows).not.toContain("/settings/archived");
    expect(flatWindows).not.toContain("/settings/overnight-factory");
    expect(flatWindows).not.toContain("/settings/access");
    expect(flatWindows).not.toContain("/settings/worktrees");
    expect(flatWindows).not.toContain("/settings/diffs");
    expect(flatWindows).not.toContain("/settings/devices");
    expect(flatWindows).not.toContain("/settings/diagnostics");
    expect(flatWindows).not.toContain("/settings/threads");
    expect(flatWindows).not.toContain("/settings/scheduled-tasks");
    expect(flatWindows).not.toContain("/settings/updates");
    expect(flatWindows).not.toContain("/settings/labs");
    expect(flatWindows).not.toContain("/settings/snap-shot");
    expect(flatWindows).not.toContain("/settings/secrets");

    // macOS shows SnapShots in Group 1; Secret providers shows Secrets in Group 3.
    const groupsMacWithSecrets = settingsNavGroups(true, true);
    expect(groupsMacWithSecrets[0]?.paths).toContain("/settings/snap-shot");
    expect(groupsMacWithSecrets[2]?.paths).toContain("/settings/secrets");
    const flatMac = groupsMacWithSecrets.flatMap((group) => group.paths);
    expect(new Set(flatMac).size).toBe(flatMac.length);
  });

  it("localizes every nav label and group heading through gt-react messages", () => {
    const groups = settingsNavGroups(true, true);
    for (const group of groups) {
      expect(decodeMsg(group.heading).trim().length).toBeGreaterThan(0);
      for (const path of group.paths) {
        expect(decodeMsg(SETTINGS_NAV_LABELS[path]).trim().length).toBeGreaterThan(0);
        expect(decodeMsg(SETTINGS_SECTION_LABELS[path]).trim().length).toBeGreaterThan(0);
      }
    }
    expect(groups.map((group) => decodeMsg(group.heading))).toEqual([
      "General & appearance",
      "Agents & workspace",
      "Extensions & connections",
      "System & about",
    ]);
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/providers"])).toBe("Agent configurator");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/appearance"])).toBe("Appearance");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/wallpaper"])).toBe("Wallpaper");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/memory"])).toBe("Chief & memory");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/projects"])).toBe("Projects & archive");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/plugins"])).toBe("Plugin center");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/sync"])).toBe("Remote sync");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/chat"])).toBe("Chat");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/browser"])).toBe("Browser & devices");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/source-control"])).toBe(
      "Source control & worktrees",
    );
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/connections"])).toBe("Environments & remote");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/maintenance"])).toBe(
      "Maintenance & diagnostics",
    );
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/about"])).toBe("About & Updates");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/providers") ?? "")).toBe(
      "Agent configurator",
    );
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/appearance") ?? "")).toBe("Appearance");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/wallpaper") ?? "")).toBe("Wallpaper");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/memory") ?? "")).toBe("Chief & memory");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/projects") ?? "")).toBe(
      "Projects & archive",
    );
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/plugins") ?? "")).toBe("Plugin center");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/sync") ?? "")).toBe("Remote sync");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/connections") ?? "")).toBe(
      "Environments & remote",
    );
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/chat") ?? "")).toBe("Chat");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/about") ?? "")).toBe("About & Updates");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/maintenance") ?? "")).toBe(
      "Maintenance & diagnostics",
    );
  });

  it("removes conflicting entries from search and migrates graduated features to official pages", () => {
    const byId = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));
    expect(byId.has("boring-sidebar" as never)).toBe(false);
    expect(byId.has("guest-links" as never)).toBe(false);
    expect(byId.has("simlock-hosts" as never)).toBe(false);
    expect(byId.has("t3-connect" as never)).toBe(false);

    expect(byId.get("prompt-suggestions-beta")?.to).toBe("/settings/chat");
    expect(byId.get("worktree-fast-checkout")?.to).toBe("/settings/source-control");
    expect(byId.get("linked-environments-beta")?.to).toBe("/settings/connections");
    expect(byId.get("provider-update-checks")?.to).toBe("/settings/providers");
    expect(byId.get("prismux-updates")?.to).toBe("/settings/about");
  });

  it("resolves independent /settings/wallpaper entry and maps remaining legacy deep links to their owning sidebar item", () => {
    const groups = settingsNavGroups(false, false);

    expect(SETTINGS_NAV_PARENT_ALIASES["/settings/wallpaper"]).toBeUndefined();
    expect(resolveSettingsNavActivePath("/settings/wallpaper")).toBe("/settings/wallpaper");
    expect(resolveSettingsNavActivePath("/settings/wallpaper/")).toBe("/settings/wallpaper");
    expect(findSettingsNavTarget(groups, "/settings/wallpaper")).toEqual({
      groupId: "general-appearance",
      path: "/settings/wallpaper",
    });
    expect(findSettingsNavTarget(groups, "/settings/appearance")).toEqual({
      groupId: "general-appearance",
      path: "/settings/appearance",
    });

    expect(SETTINGS_NAV_PARENT_ALIASES["/settings/updates"]).toBe("/settings/about");
    expect(resolveSettingsNavActivePath("/settings/updates")).toBe("/settings/about");
    expect(findSettingsNavTarget(groups, "/settings/updates")).toEqual({
      groupId: "system-about",
      path: "/settings/about",
    });
    expect(movedSettingsPath("/settings/updates", "")).toBe("/settings/about");
    expect(movedSettingsPath("/settings/updates", "update-track")).toBe("/settings/about");

    expect(movedSettingsPath("/settings/labs", "")).toBe("/settings/general");
    expect(movedSettingsPath("/settings/labs", "prompt-suggestions-beta")).toBe("/settings/chat");
    expect(movedSettingsPath("/settings/labs", "worktree-fast-checkout")).toBe(
      "/settings/source-control",
    );
    expect(movedSettingsPath("/settings/labs", "linked-environments-beta")).toBe(
      "/settings/connections",
    );
    expect(movedSettingsPath("/settings/beta", "")).toBe("/settings/general");
    // Merged legacy paths resolve to their consolidated parent sidebar nav entries
    expect(resolveSettingsNavActivePath("/settings/access")).toBe("/settings/connections");
    expect(resolveSettingsNavActivePath("/settings/worktrees")).toBe("/settings/source-control");
    expect(resolveSettingsNavActivePath("/settings/diffs")).toBe("/settings/source-control");
    expect(resolveSettingsNavActivePath("/settings/devices")).toBe("/settings/browser");
    expect(resolveSettingsNavActivePath("/settings/diagnostics")).toBe("/settings/maintenance");
    expect(resolveSettingsNavActivePath("/settings/threads")).toBe("/settings/chat");

    expect(resolveSettingsNavActivePath("/settings/open-source-licenses")).toBe("/settings/about");
    expect(findSettingsNavTarget(groups, "/settings/open-source-licenses")).toEqual({
      groupId: "system-about",
      path: "/settings/about",
    });

    expect(movedSettingsPath("/settings/appearance", "prismux-wallpaper")).toBe(
      "/settings/wallpaper",
    );
    expect(movedSettingsPath("/settings/wallpaper", "")).toBeNull();

    // Split /settings/memory (Group 2) and /settings/sync (Group 3) + legacy redirect resolution
    expect(findSettingsNavTarget(groups, "/settings/memory")).toEqual({
      groupId: "agents-workspace",
      path: "/settings/memory",
    });
    expect(findSettingsNavTarget(groups, "/settings/projects")).toEqual({
      groupId: "agents-workspace",
      path: "/settings/projects",
    });
    expect(findSettingsNavTarget(groups, "/settings/sync")).toEqual({
      groupId: "extensions-data",
      path: "/settings/sync",
    });
    expect(movedSettingsPath("/settings/archived", "archive")).toBe("/settings/projects");
    expect(movedSettingsPath("/settings/archived", "archived")).toBe("/settings/projects");
    expect(movedSettingsPath("/settings/archived", "archived-threads")).toBe("/settings/projects");
    expect(resolveSettingsNavActivePath("/settings/memory-sync")).toBe("/settings/memory");
    expect(movedSettingsPath("/settings/memory-sync", "")).toBe("/settings/memory");
    expect(movedSettingsPath("/settings/memory-sync", "sync")).toBe("/settings/sync");
    expect(movedSettingsPath("/settings/memory-sync", "prismux-e2ee-sync")).toBe("/settings/sync");
    expect(resolveLegacyMemorySyncRedirectTarget({})).toEqual({
      to: "/settings/memory",
      hash: "",
    });
    expect(resolveLegacyMemorySyncRedirectTarget({ hash: "#sync" })).toEqual({
      to: "/settings/sync",
      hash: "prismux-e2ee-sync",
    });
    expect(resolveLegacyMemorySyncRedirectTarget({ hash: "#prismux-e2ee-sync" })).toEqual({
      to: "/settings/sync",
      hash: "prismux-e2ee-sync",
    });
    expect(resolveLegacyMemorySyncRedirectTarget({ searchStr: "?tab=sync" })).toEqual({
      to: "/settings/sync",
      hash: "",
    });
    expect(resolveLegacyMemorySyncRedirectTarget({ hash: "#prismux-chief-slot" })).toEqual({
      to: "/settings/memory",
      hash: "prismux-chief-slot",
    });
  });
});

describe("settings sidebar indicator motion state machine", () => {
  const groups = settingsNavGroups(false, false);

  it("slides within the same group and crossfades across different groups", () => {
    const start = createInitialIndicatorState(
      groups,
      { groupId: "general-appearance", path: "/settings/general" },
      "instant",
    );
    expect(start.mode).toBe("instant");
    expect(start.groupStates["general-appearance"]).toEqual({
      visible: true,
      path: "/settings/general",
      mode: "instant",
    });

    // Intra-group move: General -> Appearance -> Wallpaper (all in group 1) => slide
    const slid = transitionIndicatorState(
      start,
      { groupId: "general-appearance", path: "/settings/appearance" },
      { groups, reducedMotion: false, initialMode: "instant" },
    );
    expect(slid.mode).toBe("slide");
    expect(slid.groupStates["general-appearance"]).toEqual({
      visible: true,
      path: "/settings/appearance",
      mode: "slide",
    });
    expect(slid.groupStates["agents-workspace"]?.visible).toBe(false);

    const slidToWallpaper = transitionIndicatorState(
      slid,
      { groupId: "general-appearance", path: "/settings/wallpaper" },
      { groups, reducedMotion: false, initialMode: "instant" },
    );
    expect(slidToWallpaper.mode).toBe("slide");
    expect(slidToWallpaper.groupStates["general-appearance"]).toEqual({
      visible: true,
      path: "/settings/wallpaper",
      mode: "slide",
    });

    const slideStyle = buildIndicatorPillStyle({
      state: slid.groupStates["general-appearance"],
      geometry: { y: 30, height: SETTINGS_SIDEBAR_LAYOUT.itemHeightPx },
      kind: "active",
      reducedMotion: false,
    });
    expect(slideStyle.transform).toBe("translate3d(0, 30px, 0)");
    expect(slideStyle.height).toBe("28px");
    expect(slideStyle.opacity).toBe(1);
    expect(slideStyle.transitionProperty).toBe("transform, height, opacity");

    // Cross-group move: Group 1 -> Group 2 => crossfade (old fades out in place, new fades in)
    const crossfaded = transitionIndicatorState(
      slid,
      { groupId: "agents-workspace", path: "/settings/providers" },
      { groups, reducedMotion: false, initialMode: "instant" },
    );
    expect(crossfaded.mode).toBe("crossfade");
    expect(crossfaded.groupStates["general-appearance"]).toEqual({
      visible: false,
      path: "/settings/appearance",
      mode: "crossfade",
    });
    expect(crossfaded.groupStates["agents-workspace"]).toEqual({
      visible: true,
      path: "/settings/providers",
      mode: "crossfade",
    });

    const departingStyle = buildIndicatorPillStyle({
      state: crossfaded.groupStates["general-appearance"],
      geometry: { y: 30, height: SETTINGS_SIDEBAR_LAYOUT.itemHeightPx },
      kind: "active",
      reducedMotion: false,
    });
    expect(departingStyle.opacity).toBe(0);
    expect(departingStyle.transitionProperty).toBe("opacity");

    const arrivingStyle = buildIndicatorPillStyle({
      state: crossfaded.groupStates["agents-workspace"],
      geometry: { y: 0, height: SETTINGS_SIDEBAR_LAYOUT.itemHeightPx },
      kind: "active",
      reducedMotion: false,
    });
    expect(arrivingStyle.opacity).toBe(1);
    expect(arrivingStyle.transform).toBe("translate3d(0, 0px, 0)");
    expect(arrivingStyle.height).toBe("28px");
    expect(arrivingStyle.transitionProperty).toBe("opacity");

    // Next move inside Group 2 resumes smooth sliding
    const slidInGroup2 = transitionIndicatorState(
      crossfaded,
      { groupId: "agents-workspace", path: "/settings/threads" },
      { groups, reducedMotion: false, initialMode: "instant" },
    );
    expect(slidInGroup2.mode).toBe("slide");
    expect(slidInGroup2.groupStates["agents-workspace"]?.mode).toBe("slide");
  });

  it("handles hover enter, intra-group slide, cross-group crossfade, and leave cleanly", () => {
    const empty = createInitialIndicatorState(groups, null, "enter");
    expect(empty.mode).toBe("idle");

    const entered = transitionIndicatorState(
      empty,
      { groupId: "extensions-data", path: "/settings/plugins" },
      { groups, reducedMotion: false, initialMode: "enter" },
    );
    expect(entered.mode).toBe("enter");
    expect(entered.groupStates["extensions-data"]).toEqual({
      visible: true,
      path: "/settings/plugins",
      mode: "enter",
    });
    expect(
      buildIndicatorPillStyle({
        state: entered.groupStates["extensions-data"],
        geometry: { y: 0, height: 32 },
        kind: "hover",
        reducedMotion: false,
      }).transitionProperty,
    ).toBe("opacity");

    const slid = transitionIndicatorState(
      entered,
      { groupId: "extensions-data", path: "/settings/sync" },
      { groups, reducedMotion: false, initialMode: "enter" },
    );
    expect(slid.mode).toBe("slide");

    const slidToConnections = transitionIndicatorState(
      slid,
      { groupId: "extensions-data", path: "/settings/connections" },
      { groups, reducedMotion: false, initialMode: "enter" },
    );
    expect(slidToConnections.mode).toBe("slide");

    const crossed = transitionIndicatorState(
      slidToConnections,
      { groupId: "system-about", path: "/settings/about" },
      { groups, reducedMotion: false, initialMode: "enter" },
    );
    expect(crossed.mode).toBe("crossfade");
    expect(crossed.groupStates["extensions-data"]).toEqual({
      visible: false,
      path: "/settings/connections",
      mode: "crossfade",
    });
    expect(crossed.groupStates["system-about"]).toEqual({
      visible: true,
      path: "/settings/about",
      mode: "crossfade",
    });

    const left = transitionIndicatorState(crossed, null, {
      groups,
      reducedMotion: false,
      initialMode: "enter",
    });
    expect(left.mode).toBe("leave");
    expect(left.groupStates["system-about"]).toEqual({
      visible: false,
      path: "/settings/about",
      mode: "leave",
    });
  });

  it("degrades immediately to zero-motion instant switching when prefers-reduced-motion is active", () => {
    const start = createInitialIndicatorState(
      groups,
      { groupId: "general-appearance", path: "/settings/general" },
      "instant",
    );
    const sameGroup = transitionIndicatorState(
      start,
      { groupId: "general-appearance", path: "/settings/chat" },
      { groups, reducedMotion: true, initialMode: "instant" },
    );
    expect(sameGroup.mode).toBe("instant");
    expect(sameGroup.groupStates["general-appearance"]?.mode).toBe("instant");

    const style = buildIndicatorPillStyle({
      state: sameGroup.groupStates["general-appearance"],
      geometry: { y: 72, height: 32 },
      kind: "active",
      reducedMotion: true,
    });
    expect(style.transitionProperty).toBe("none");
    expect(style.transitionDuration).toBe("0ms");
    expect(style.willChange).toBeUndefined();

    const crossGroup = transitionIndicatorState(
      sameGroup,
      { groupId: "system-about", path: "/settings/about" },
      { groups, reducedMotion: true, initialMode: "instant" },
    );
    expect(crossGroup.mode).toBe("instant");
    expect(crossGroup.groupStates["general-appearance"]?.mode).toBe("instant");
    expect(crossGroup.groupStates["system-about"]?.mode).toBe("instant");
  });

  it("compares geometry maps by value with 1px subpixel tolerance and trips oscillation circuit-breaker", () => {
    expect(SETTINGS_NAV_GEOMETRY_TOLERANCE_PX).toBe(1);
    expect(
      areGeometryMapsEqual(
        { "/settings/general": { y: 0, height: 28 }, "/settings/appearance": { y: 30, height: 28 } },
        { "/settings/general": { y: 0, height: 28 }, "/settings/appearance": { y: 30, height: 28 } },
      ),
    ).toBe(true);
    // Fractional DPI 1px jitter is absorbed to prevent ResizeObserver ping-pong loops
    expect(
      areGeometryMapsEqual(
        { "/settings/general": { y: 0, height: 28 }, "/settings/appearance": { y: 30, height: 28 } },
        { "/settings/general": { y: 1, height: 29 }, "/settings/appearance": { y: 31, height: 27 } },
      ),
    ).toBe(true);
    // Real layout changes (>= 2px) are still detected
    expect(
      areGeometryMapsEqual(
        { "/settings/general": { y: 0, height: 28 } },
        { "/settings/general": { y: 0, height: 32 } },
      ),
    ).toBe(false);
    expect(
      areGeometryMapsEqual(
        { "/settings/general": { y: 0, height: 28 } },
        { "/settings/general": { y: 2, height: 28 } },
      ),
    ).toBe(false);

    // Oscillation guard allows normal resizes, trips on rapid flips, and recovers after cooldown
    const guard = createGeometryOscillationGuard({
      windowMs: 1000,
      maxCommitsInWindow: 4,
      cooldownMs: 400,
    });
    expect(guard.allowCommit(100)).toBe(true);
    expect(guard.allowCommit(120)).toBe(true);
    expect(guard.allowCommit(140)).toBe(true);
    expect(guard.allowCommit(160)).toBe(true);
    // 5th rapid commit inside 1000ms trips the breaker
    expect(guard.allowCommit(180)).toBe(false);
    expect(guard.isTripped(200)).toBe(true);
    expect(guard.allowCommit(400)).toBe(false);
    // After cooldown expires (180 + 400 = 580), settled updates resume cleanly
    expect(guard.isTripped(580)).toBe(false);
    expect(guard.allowCommit(600)).toBe(true);
  });

  it("enforces divider-free typography & spacing hierarchy (heading > sub-menu, group gap >> item gap)", () => {
    expect(SETTINGS_SIDEBAR_LAYOUT.horizontalDividerCount).toBe(0);
    expect(SETTINGS_SIDEBAR_LAYOUT.headingFontSizePx).toBeGreaterThan(
      SETTINGS_SIDEBAR_LAYOUT.itemFontSizePx,
    );
    expect(SETTINGS_SIDEBAR_LAYOUT.interGroupGapPx).toBeGreaterThan(
      SETTINGS_SIDEBAR_LAYOUT.headingBottomGapPx,
    );
    expect(SETTINGS_SIDEBAR_LAYOUT.headingBottomGapPx).toBeGreaterThan(
      SETTINGS_SIDEBAR_LAYOUT.intraGroupItemGapPx,
    );

    initializeGT({ defaultLocale: "zh" });
    const html = renderToStaticMarkup(
      createElement(
        GTProvider,
        null,
        createElement(
          SidebarProvider,
          { defaultOpen: true },
          createElement(SettingsSidebarNav, { pathname: "/settings/general" }),
        ),
      ),
    );

    // Zero horizontal divider lines (<hr> or border-t) between category groups
    expect(html).not.toContain("<hr");
    expect(html).not.toMatch(/\bborder-t\b/);

    // All 4 category groups render prominent headings visibly on desktop (not unconditionally sr-only)
    for (const groupId of [
      "general-appearance",
      "agents-workspace",
      "extensions-data",
      "system-about",
    ]) {
      const headingPattern = new RegExp(
        `<h3[^>]*data-settings-nav-heading="${groupId}"[^>]*class="([^"]+)"`,
      );
      const match = html.match(headingPattern);
      expect(match, `missing heading for ${groupId}`).not.toBeNull();
      const headingClasses = match?.[1] ?? "";
      expect(headingClasses).toContain("text-sm");
      expect(headingClasses).toContain("font-semibold");
      expect(headingClasses).toContain("mb-1.5");
      // Must NOT have standalone desktop sr-only (only responsive max-md:sr-only for compact rail)
      expect(headingClasses.split(/\s+/)).not.toContain("sr-only");
    }

    // Generous inter-group gap + tight intra-group menu cadence + compact sub-menu items
    expect(html).toContain("gap-6");
    expect(html).toContain("relative isolate gap-0.5");
    expect(html).toContain("h-7");
    expect(html).toContain("text-[12.5px]");
    expect(html).toContain("[&amp;&gt;svg]:size-3.5");
    expect(html).toContain('data-settings-section="/settings/appearance"');
    expect(html).toContain('data-settings-section="/settings/wallpaper"');

    // /settings/wallpaper highlights its own sidebar entry directly rather than aliasing /settings/appearance
    const wallpaperActiveHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        null,
        createElement(
          SidebarProvider,
          { defaultOpen: true },
          createElement(SettingsSidebarNav, { pathname: "/settings/wallpaper" }),
        ),
      ),
    );
    expect(wallpaperActiveHtml).toMatch(
      /data-settings-section="\/settings\/wallpaper"[^>]*aria-current="page"|aria-current="page"[^>]*data-settings-section="\/settings\/wallpaper"/,
    );
    expect(wallpaperActiveHtml).not.toMatch(
      /data-settings-section="\/settings\/appearance"[^>]*aria-current="page"|aria-current="page"[^>]*data-settings-section="\/settings\/appearance"/,
    );

    // /settings/memory (Group 2) and /settings/sync (Group 3) each highlight independently;
    // legacy /settings/archived highlights the unified /settings/projects entry.
    expect(html).toContain('data-settings-section="/settings/memory"');
    expect(html).toContain('data-settings-section="/settings/projects"');
    expect(html).toContain('data-settings-section="/settings/sync"');
    expect(html).not.toContain('data-settings-section="/settings/archived"');
    expect(html).not.toContain('data-settings-section="/settings/memory-sync"');
    const archivedActiveHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        null,
        createElement(
          SidebarProvider,
          { defaultOpen: true },
          createElement(SettingsSidebarNav, { pathname: "/settings/archived" }),
        ),
      ),
    );
    expect(archivedActiveHtml).toMatch(
      /data-settings-section="\/settings\/projects"[^>]*aria-current="page"|aria-current="page"[^>]*data-settings-section="\/settings\/projects"/,
    );
    const syncActiveHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        null,
        createElement(
          SidebarProvider,
          { defaultOpen: true },
          createElement(SettingsSidebarNav, { pathname: "/settings/sync" }),
        ),
      ),
    );
    expect(syncActiveHtml).toMatch(
      /data-settings-section="\/settings\/sync"[^>]*aria-current="page"|aria-current="page"[^>]*data-settings-section="\/settings\/sync"/,
    );
    expect(syncActiveHtml).not.toMatch(
      /data-settings-section="\/settings\/memory"[^>]*aria-current="page"|aria-current="page"[^>]*data-settings-section="\/settings\/memory"/,
    );
  });
});
