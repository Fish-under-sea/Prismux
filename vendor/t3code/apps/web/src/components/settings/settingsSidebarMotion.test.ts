import { describe, expect, it } from "vite-plus/test";
import { decodeMsg } from "gt-react";

import { settingsBreadcrumbLabel } from "./SettingsBreadcrumb";
import {
  movedSettingsPath,
  SETTINGS_NAV_LABELS,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  settingsNavGroups,
} from "./settingsSearch";
import {
  areGeometryMapsEqual,
  buildIndicatorPillStyle,
  createInitialIndicatorState,
  findSettingsNavTarget,
  resolveSettingsNavActivePath,
  SETTINGS_NAV_PARENT_ALIASES,
  transitionIndicatorState,
} from "./settingsSidebarMotion";

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
        "/settings/appearance",
        "/settings/chat",
        "/settings/keybindings",
        "/settings/voice",
      ],
      [
        "/settings/providers",
        "/settings/threads",
        "/settings/archived",
        "/settings/browser",
        "/settings/devices",
        "/settings/scheduled-tasks",
        "/settings/projects",
        "/settings/worktrees",
        "/settings/diffs",
        "/settings/source-control",
      ],
      ["/settings/plugins", "/settings/memory-sync", "/settings/connections", "/settings/access"],
      ["/settings/diagnostics", "/settings/maintenance", "/settings/about"],
    ]);

    const flatWindows = groupsWindows.flatMap((group) => group.paths);
    expect(new Set(flatWindows).size).toBe(flatWindows.length);
    // Merged / removed top-level entries
    expect(flatWindows).not.toContain("/settings/wallpaper");
    expect(flatWindows).not.toContain("/settings/updates");
    expect(flatWindows).not.toContain("/settings/labs");
    expect(flatWindows).not.toContain("/settings/snap-shot");
    expect(flatWindows).not.toContain("/settings/secrets");
    // Archived threads intentionally preserved in Group 2
    expect(flatWindows).toContain("/settings/archived");

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
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/appearance"])).toBe("Appearance & Wallpaper");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/diagnostics"])).toBe("Service Diagnostics");
    expect(decodeMsg(SETTINGS_NAV_LABELS["/settings/about"])).toBe("About & Updates");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/about") ?? "")).toBe("About & Updates");
    expect(decodeMsg(settingsBreadcrumbLabel("/settings/diagnostics") ?? "")).toBe(
      "Service Diagnostics",
    );
  });

  it("removes conflicting entries from search and migrates graduated features to official pages", () => {
    const byId = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));
    expect(byId.has("boring-sidebar" as never)).toBe(false);
    expect(byId.has("guest-links" as never)).toBe(false);
    expect(byId.has("simlock-hosts" as never)).toBe(false);
    expect(byId.has("t3-connect" as never)).toBe(false);

    expect(byId.get("prompt-suggestions-beta")?.to).toBe("/settings/chat");
    expect(byId.get("worktree-fast-checkout")?.to).toBe("/settings/worktrees");
    expect(byId.get("linked-environments-beta")?.to).toBe("/settings/connections");
    expect(byId.get("provider-update-checks")?.to).toBe("/settings/providers");
    expect(byId.get("prismux-updates")?.to).toBe("/settings/about");
  });

  it("maps legacy and merged deep-link routes to their owning sidebar group & item", () => {
    const groups = settingsNavGroups(false, false);

    expect(SETTINGS_NAV_PARENT_ALIASES["/settings/wallpaper"]).toBe("/settings/appearance");
    expect(resolveSettingsNavActivePath("/settings/wallpaper")).toBe("/settings/appearance");
    expect(resolveSettingsNavActivePath("/settings/wallpaper/")).toBe("/settings/appearance");
    expect(findSettingsNavTarget(groups, "/settings/wallpaper")).toEqual({
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
      "/settings/worktrees",
    );
    expect(movedSettingsPath("/settings/labs", "linked-environments-beta")).toBe(
      "/settings/connections",
    );
    expect(movedSettingsPath("/settings/beta", "")).toBe("/settings/general");

    expect(resolveSettingsNavActivePath("/settings/open-source-licenses")).toBe("/settings/about");
    expect(findSettingsNavTarget(groups, "/settings/open-source-licenses")).toEqual({
      groupId: "system-about",
      path: "/settings/about",
    });

    expect(movedSettingsPath("/settings/appearance", "prismux-wallpaper")).toBe(
      "/settings/wallpaper",
    );
    expect(movedSettingsPath("/settings/wallpaper", "")).toBeNull();
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

    // Intra-group move: General -> Appearance & Wallpaper (both in group 1) => slide
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

    const slideStyle = buildIndicatorPillStyle({
      state: slid.groupStates["general-appearance"],
      geometry: { y: 36, height: 32 },
      kind: "active",
      reducedMotion: false,
    });
    expect(slideStyle.transform).toBe("translate3d(0, 36px, 0)");
    expect(slideStyle.height).toBe("32px");
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
      geometry: { y: 36, height: 32 },
      kind: "active",
      reducedMotion: false,
    });
    expect(departingStyle.opacity).toBe(0);
    expect(departingStyle.transitionProperty).toBe("opacity");

    const arrivingStyle = buildIndicatorPillStyle({
      state: crossfaded.groupStates["agents-workspace"],
      geometry: { y: 0, height: 32 },
      kind: "active",
      reducedMotion: false,
    });
    expect(arrivingStyle.opacity).toBe(1);
    expect(arrivingStyle.transform).toBe("translate3d(0, 0px, 0)");
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
      { groupId: "extensions-data", path: "/settings/memory-sync" },
      { groups, reducedMotion: false, initialMode: "enter" },
    );
    expect(slid.mode).toBe("slide");

    const crossed = transitionIndicatorState(
      slid,
      { groupId: "system-about", path: "/settings/about" },
      { groups, reducedMotion: false, initialMode: "enter" },
    );
    expect(crossed.mode).toBe("crossfade");
    expect(crossed.groupStates["extensions-data"]).toEqual({
      visible: false,
      path: "/settings/memory-sync",
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

  it("compares geometry maps by value to prevent ResizeObserver loops", () => {
    expect(
      areGeometryMapsEqual(
        { "/settings/general": { y: 0, height: 32 }, "/settings/appearance": { y: 36, height: 32 } },
        { "/settings/general": { y: 0, height: 32 }, "/settings/appearance": { y: 36, height: 32 } },
      ),
    ).toBe(true);
    expect(
      areGeometryMapsEqual(
        { "/settings/general": { y: 0, height: 32 } },
        { "/settings/general": { y: 0, height: 36 } },
      ),
    ).toBe(false);
  });
});
