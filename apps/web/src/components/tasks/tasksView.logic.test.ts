import { describe, expect, it } from "vite-plus/test";

import type { SidebarStorageLike } from "../sidebar/prismuxSidebarQuickNav.logic";
import {
  applyTasksQueryPatch,
  buildTasksQuery,
  DEFAULT_ISSUES_QUERY,
  DEFAULT_PRS_QUERY,
  formatRelativeTaskTime,
  getTasksViewCopy,
  normalizeSelectedTaskProjectKeys,
  parseTasksQuery,
  readSelectedTaskProjectKeys,
  resolveTasksEmptyState,
  TASKS_SELECTED_PROJECTS_STORAGE_KEY,
  writeSelectedTaskProjectKeys,
} from "./tasksView.logic";

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

describe("Orca-aligned Tasks view pure logic", () => {
  it("parses default GitHub issue and PR queries and preserves quoted labels and free text", () => {
    expect(parseTasksQuery(DEFAULT_ISSUES_QUERY, "issues")).toEqual({
      kind: "issue",
      state: "open",
      involvement: "all",
      labels: [],
      author: null,
      assignee: null,
      text: "",
    });

    expect(parseTasksQuery(DEFAULT_PRS_QUERY, "prs")).toEqual({
      kind: "pr",
      state: "open",
      involvement: "all",
      labels: [],
      author: null,
      assignee: null,
      text: "",
    });

    expect(
      parseTasksQuery(
        'is:issue is:open assignee:@me label:"good first issue" label:bug glass corner',
        "issues",
      ),
    ).toEqual({
      kind: "issue",
      state: "open",
      involvement: "assigned",
      labels: ["good first issue", "bug"],
      author: null,
      assignee: null,
      text: "glass corner",
    });

    expect(
      parseTasksQuery("is:pr is:merged review-requested:@me author:octocat refactor", "prs"),
    ).toEqual({
      kind: "pr",
      state: "merged",
      involvement: "review-requested",
      labels: [],
      author: "octocat",
      assignee: null,
      text: "refactor",
    });
  });

  it("serializes and patches query chips cleanly without dropping existing free text or labels", () => {
    expect(
      buildTasksQuery({
        mode: "issues",
        state: "open",
        involvement: "assigned",
        labels: ["good first issue"],
        text: "sidebar",
      }),
    ).toBe('is:issue is:open assignee:@me label:"good first issue" sidebar');

    const withAssigned = applyTasksQueryPatch("is:issue is:open auth", "issues", {
      involvement: "assigned",
    });
    expect(withAssigned).toBe("is:issue is:open assignee:@me auth");

    const toggledBack = applyTasksQueryPatch(withAssigned, "issues", {
      involvement: "all",
    });
    expect(toggledBack).toBe("is:issue is:open auth");

    const prMerged = applyTasksQueryPatch(DEFAULT_PRS_QUERY, "prs", {
      state: "merged",
      involvement: "review-requested",
    });
    expect(prMerged).toBe("is:pr is:merged review-requested:@me");
  });

  it("persists and normalizes selected project sources and resolves Orca empty states", () => {
    const storage = createMemoryStorage();
    expect(readSelectedTaskProjectKeys(storage)).toBeNull();

    // Unset storage selects all available projects by default, or empty if none exist.
    expect(normalizeSelectedTaskProjectKeys([], null)).toEqual([]);
    expect(normalizeSelectedTaskProjectKeys(["p1", "p2"], null)).toEqual(["p1", "p2"]);

    // Explicit empty selection persists cleanly and triggers the Orca no-sources empty state.
    writeSelectedTaskProjectKeys([], storage);
    expect(storage.data.get(TASKS_SELECTED_PROJECTS_STORAGE_KEY)).toBe("[]");
    expect(readSelectedTaskProjectKeys(storage)).toEqual([]);
    expect(normalizeSelectedTaskProjectKeys(["p1", "p2"], [])).toEqual([]);

    // Persisted selection prunes removed projects.
    writeSelectedTaskProjectKeys(["p2", "deleted"], storage);
    expect(
      normalizeSelectedTaskProjectKeys(["p1", "p2"], readSelectedTaskProjectKeys(storage)),
    ).toEqual(["p2"]);

    const zhCopy = getTasksViewCopy("zh");
    const enCopy = getTasksViewCopy("en");
    expect(zhCopy.pageTitle).toBe("任务面板");
    expect(zhCopy.closeLabel).toBe("关闭任务面板");
    expect(zhCopy.tabIssues).toBe("Issue");
    expect(zhCopy.tabPrs).toBe("PR");
    expect(zhCopy.searchIssuesPlaceholder).toContain("Issue");
    expect(zhCopy.searchIssuesPlaceholder).not.toContain("议题");
    expect(zhCopy.projectsOpenIssues).toBe("查看 Issue");
    expect(zhCopy.noProjectsConfiguredDescription).not.toContain("议题");
    expect(enCopy.pageTitle).toBe("Tasks");
    expect(enCopy.tabIssues).toBe("Issue");
    expect(enCopy.tabPrs).toBe("PR");
    expect(
      resolveTasksEmptyState({
        selectedProjectCount: 0,
        totalProjectCount: 0,
        copy: zhCopy,
      }),
    ).toEqual({
      kind: "no-sources",
      title: "未选择项目来源",
      description: "请至少选择一个项目来源，让 Prismux 知道要从哪个主机/账户获取任务。",
    });
    expect(
      resolveTasksEmptyState({
        selectedProjectCount: 1,
        totalProjectCount: 1,
        copy: enCopy,
      }).kind,
    ).toBe("no-matches");
  });

  it("formats relative task timestamps cleanly in zh and en", () => {
    const now = Date.parse("2026-11-24T12:00:00.000Z");
    expect(formatRelativeTaskTime("2026-11-24T11:59:45.000Z", true, now)).toBe("刚刚");
    expect(formatRelativeTaskTime("2026-11-24T11:55:00.000Z", true, now)).toBe("5 分钟前");
    expect(formatRelativeTaskTime("2026-11-24T09:00:00.000Z", false, now)).toBe("3h ago");
    expect(formatRelativeTaskTime("2026-11-21T12:00:00.000Z", false, now)).toBe("3d ago");
    expect(formatRelativeTaskTime(null, true, now)).toBe("—");
  });
});
