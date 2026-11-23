import { describe, expect, it, vi } from "vite-plus/test";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";

import {
  dismissMobileSidebarOnboardingBadge,
  PRISMUX_HELP_EXTERNAL_LINKS,
  PRISMUX_MOBILE_SIDEBAR_ONBOARDING_KEY,
  PRISMUX_SIDEBAR_PROJECTS_OPEN_KEY,
  PRISMUX_SIDEBAR_QUICK_NAV_IDS,
  PRISMUX_SIDEBAR_QUICK_NAV_ROUTES,
  readMobileSidebarOnboardingDismissed,
  readSidebarProjectsSectionOpen,
  requestLocateActiveSidebarThread,
  requestOpenCreateWorkspace,
  resolveDiagnosticsBadgeTone,
  resolveInstalledPluginCount,
  resolveSafePrismuxHelpUrl,
  shouldShowMobileSidebarOnboardingBadge,
  subscribeLocateActiveSidebarThread,
  subscribeOpenCreateWorkspace,
  summarizeSidebarInboxAttention,
  writeSidebarProjectsSectionOpen,
  type SidebarStorageLike,
} from "./prismuxSidebarQuickNav.logic";
import { getPrismuxSidebarQuickNavCopy } from "./prismuxSidebarQuickNav.copy";

function createMemoryStorage(): SidebarStorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe("Orca-aligned Prismux sidebar quick-nav logic", () => {
  it("maps quick-nav entries strictly to the 5-item Orca order and keeps Plugins inside Settings", () => {
    expect([...PRISMUX_SIDEBAR_QUICK_NAV_IDS]).toEqual([
      "diagnostics",
      "tasks",
      "workspace-board",
      "automations",
      "mobile",
    ]);
    expect(PRISMUX_SIDEBAR_QUICK_NAV_IDS).not.toContain("bots");
    expect(PRISMUX_SIDEBAR_QUICK_NAV_IDS).not.toContain("plugins");
    expect(PRISMUX_SIDEBAR_QUICK_NAV_ROUTES).toEqual({
      diagnostics: "/settings/diagnostics",
      tasks: "/tasks",
      workspaceBoard: "/workspace-board",
      automations: "/settings/scheduled-tasks",
      mobileAccess: "/settings/access",
      plugins: "/settings/plugins",
    });

    expect(getPrismuxSidebarQuickNavCopy("zh")).toEqual({
      tasks: "任务面板",
      workspaceBoard: "工作区板",
    });
    expect(getPrismuxSidebarQuickNavCopy("en")).toEqual({
      tasks: "Tasks",
      workspaceBoard: "Workspace board",
    });
  });

  it("persists Prismux Mobile [New] onboarding badge dismissal in localStorage", () => {
    const storage = createMemoryStorage();
    expect(readMobileSidebarOnboardingDismissed(storage)).toBe(false);
    expect(shouldShowMobileSidebarOnboardingBadge(false)).toBe(true);

    expect(dismissMobileSidebarOnboardingBadge(storage)).toBe(true);
    expect(storage.data.get(PRISMUX_MOBILE_SIDEBAR_ONBOARDING_KEY)).toBe("true");
    expect(readMobileSidebarOnboardingDismissed(storage)).toBe(true);
    expect(shouldShowMobileSidebarOnboardingBadge(true)).toBe(false);
  });

  it("persists Projects section expanded/collapsed preference with open default", () => {
    const storage = createMemoryStorage();
    expect(readSidebarProjectsSectionOpen(storage)).toBe(true);

    writeSidebarProjectsSectionOpen(false, storage);
    expect(storage.data.get(PRISMUX_SIDEBAR_PROJECTS_OPEN_KEY)).toBe("false");
    expect(readSidebarProjectsSectionOpen(storage)).toBe(false);

    writeSidebarProjectsSectionOpen(true, storage);
    expect(readSidebarProjectsSectionOpen(storage)).toBe(true);
  });

  it("aggregates pending approvals, user inputs, guest requests, and unread completions for the inbox bell", () => {
    const summary = summarizeSidebarInboxAttention([
      { key: "env:t1", status: "approval", isUnread: false },
      { key: "env:t2", status: "input", isUnread: true },
      { key: "env:t3", status: "request", isUnread: false },
      { key: "env:t4", status: "ready", isUnread: true },
      { key: "env:t5", status: "ready", isUnread: false },
      { key: "env:t6", status: "working", isUnread: true },
      { key: "env:t7", status: "failed", isUnread: false },
    ]);

    expect(summary.approvalCount).toBe(3);
    expect(summary.unreadCount).toBe(1);
    expect(summary.totalCount).toBe(4);
    expect([...summary.attentionKeys]).toEqual(["env:t1", "env:t2", "env:t3", "env:t4"]);
  });

  it("resolves live diagnostics micro-dot tone and installed plugin counts safely", () => {
    expect(resolveDiagnosticsBadgeTone(null)).toBeNull();
    expect(
      resolveDiagnosticsBadgeTone({
        checkedAt: 1,
        items: [{ id: "daemon", category: "core", name: "Daemon", status: "ok", summary: "ok" }],
        summary: { total: 1, ok: 1, degraded: 0, error: 0 },
      }),
    ).toBe("ok");
    expect(
      resolveDiagnosticsBadgeTone({
        checkedAt: 1,
        items: [
          {
            id: "sqlite-vec",
            category: "memory",
            name: "sqlite-vec",
            status: "degraded",
            summary: "FTS5 fallback",
          },
        ],
        summary: { total: 1, ok: 0, degraded: 1, error: 0 },
      }),
    ).toBe("degraded");
    expect(
      resolveDiagnosticsBadgeTone({
        checkedAt: 1,
        items: [
          {
            id: "t3-server",
            category: "core",
            name: "T3 Server",
            status: "error",
            summary: "unreachable",
          },
        ],
        summary: { total: 1, ok: 0, degraded: 1, error: 1 },
      }),
    ).toBe("error");

    expect(resolveInstalledPluginCount(null)).toBeNull();
    expect(resolveInstalledPluginCount({ plugins: [] })).toBe(0);
    expect(resolveInstalledPluginCount({ items: [{ id: "p1" }, { id: "p2" }] })).toBe(2);
  });

  it("validates official Prismux Help links strictly over https and bans legacy domains", () => {
    const repoUrl = resolveSafePrismuxHelpUrl("repository");
    const issuesUrl = resolveSafePrismuxHelpUrl("issues");

    expect(repoUrl).toBe("https://github.com/Fish-under-sea/Prismux");
    expect(issuesUrl).toBe("https://github.com/Fish-under-sea/Prismux/issues");
    for (const url of Object.values(PRISMUX_HELP_EXTERNAL_LINKS)) {
      expect(url.startsWith("https://github.com/Fish-under-sea/Prismux")).toBe(true);
      expect(url).not.toMatch(/orca\.dev|t3\.codes|pingdotgg/i);
    }
  });

  it("notifies and unsubscribes locate-current-thread listeners cleanly", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocateActiveSidebarThread(listener);
    requestLocateActiveSidebarThread();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    requestLocateActiveSidebarThread();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies and unsubscribes open-create-workspace listeners cleanly for Workspace Board '+' buttons", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenCreateWorkspace(listener);
    requestOpenCreateWorkspace();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    requestOpenCreateWorkspace();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps sidebar chrome and quick-nav free of hardcoded Chinese copy so en/zh i18n is 100% driven by catalogs", () => {
    const sidebarDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    const files = [
      "PrismuxSidebarQuickNav.tsx",
      "SidebarChrome.tsx",
      "SidebarThreadHeader.tsx",
      "SidebarProjectFolderHeader.tsx",
      "SidebarThreadRow.tsx",
      "sidebarMicroIndicators.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(sidebarDir, file), "utf8");
      // Strip single-line and block comments before checking for CJK characters in runtime code.
      const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      expect(withoutComments, `${file} should not contain hardcoded CJK copy`).not.toMatch(
        /[\u4e00-\u9fff]/,
      );
    }
  });
});
