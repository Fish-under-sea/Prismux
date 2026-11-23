import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeThreadFixture } from "../../../test-fixtures";
import {
  areAllProjectsCollapsed,
  buildCreateWorkspacePayload,
  buildOrcaActivityItem,
  computeCollapseAllProjectsNextExpanded,
  countActiveOrcaFilters,
  createOrcaSidebarShortcutHandler,
  DEFAULT_AGENT_SELECTION_VALUE,
  DEFAULT_ORCA_PROJECTS_PREFS,
  filterOrcaActivityItems,
  filterSidebarProjectThreads,
  formatLocalEnvironmentDisplayLabel,
  groupOrcaActivityItems,
  inferRepoFolderNameFromUrl,
  insertEmojiAtSelection,
  isAutomationCreatedThread,
  isCliCreatedThread,
  isEditableKeyboardTarget,
  isSubagentThread,
  matchCollapseAllProjectsShortcut,
  matchCreateWorkspaceShortcut,
  matchDialogSubmitShortcut,
  NO_PROJECT_SELECTION_VALUE,
  normalizeOrcaProjectsPrefs,
  ORCA_PROJECTS_PREFS_STORAGE_KEY,
  ORCA_WORKSPACE_EMOJI_DEFAULTS,
  readOrcaProjectsPrefs,
  summarizeOrcaActivityBadge,
  validateAndNormalizeGitCloneUrl,
  validateNewProjectName,
  writeOrcaProjectsPrefs,
  type OrcaProjectsPrefs,
  type OrcaStorageLike,
} from "./orcaProjects.logic";
import { getOrcaProjectsCopy } from "./orcaProjectsCopy";

const LOCAL_ENV_ID = EnvironmentId.make("env-local");

function createMemoryStorage(): OrcaStorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function makeShell(overrides: Partial<OrchestrationV2ThreadShell> = {}) {
  const base = makeThreadFixture({
    environmentId: LOCAL_ENV_ID,
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-4-6",
    },
  }).source;
  return presentThreadShell(LOCAL_ENV_ID, {
    ...base,
    title: "Implement liquid glass header",
    branch: "main",
    createdAt: DateTime.makeUnsafe("2026-11-23T10:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-23T11:00:00.000Z"),
    lastVisitedAt: DateTime.makeUnsafe("2026-11-23T11:05:00.000Z"),
    ...overrides,
  });
}

describe("Orca projects sidebar preferences persistence", () => {
  it("reads defaults when empty or corrupted and round-trips all fields in localStorage", () => {
    const storage = createMemoryStorage();
    expect(readOrcaProjectsPrefs(storage)).toEqual(DEFAULT_ORCA_PROJECTS_PREFS);

    storage.setItem(ORCA_PROJECTS_PREFS_STORAGE_KEY, "{not-valid-json");
    expect(readOrcaProjectsPrefs(storage)).toEqual(DEFAULT_ORCA_PROJECTS_PREFS);

    const updated: OrcaProjectsPrefs = {
      unreadOnly: true,
      showChildAgents: true,
      hideAutomationCreated: true,
      hideCliCreated: true,
      groupBy: "project",
      compactMode: true,
      showSearch: false,
    };
    writeOrcaProjectsPrefs(updated, storage);
    expect(readOrcaProjectsPrefs(storage)).toEqual(updated);
  });

  it("normalizes partial/invalid stored payloads safely and counts restricting filters", () => {
    const normalized = normalizeOrcaProjectsPrefs({
      unreadOnly: true,
      groupBy: "invalid-mode",
      compactMode: "yes",
      hideCliCreated: true,
    });
    expect(normalized).toEqual({
      ...DEFAULT_ORCA_PROJECTS_PREFS,
      unreadOnly: true,
      hideCliCreated: true,
      groupBy: "status",
      compactMode: false,
    });

    expect(countActiveOrcaFilters(DEFAULT_ORCA_PROJECTS_PREFS)).toBe(0);
    expect(countActiveOrcaFilters(normalized)).toBe(2);
    expect(
      countActiveOrcaFilters({
        ...DEFAULT_ORCA_PROJECTS_PREFS,
        unreadOnly: true,
        hideAutomationCreated: true,
        hideCliCreated: true,
        showChildAgents: true,
      }),
    ).toBe(3);
  });
});

describe("Orca sidebar global keyboard shortcuts", () => {
  it("matches Ctrl+Shift+H on Windows/Linux and Cmd/Ctrl+Shift+H on macOS", () => {
    expect(
      matchCollapseAllProjectsShortcut(
        { key: "H", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
        "Win32",
      ),
    ).toBe(true);
    expect(
      matchCollapseAllProjectsShortcut(
        { key: "h", ctrlKey: false, metaKey: true, shiftKey: true, altKey: false },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      matchCollapseAllProjectsShortcut(
        { key: "h", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        "Win32",
      ),
    ).toBe(false);
    expect(
      matchCollapseAllProjectsShortcut(
        {
          key: "H",
          ctrlKey: true,
          metaKey: false,
          shiftKey: true,
          altKey: false,
          repeat: true,
        },
        "Win32",
      ),
    ).toBe(false);
    expect(
      matchCollapseAllProjectsShortcut(
        {
          key: "H",
          ctrlKey: true,
          metaKey: false,
          shiftKey: true,
          altKey: false,
          defaultPrevented: true,
        },
        "Win32",
      ),
    ).toBe(false);
  });

  it("matches Ctrl+N (Win/Linux) and Cmd+N (macOS) for Create Workspace", () => {
    expect(
      matchCreateWorkspaceShortcut(
        { key: "n", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        "Win32",
      ),
    ).toBe(true);
    expect(
      matchCreateWorkspaceShortcut(
        { key: "N", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      matchCreateWorkspaceShortcut(
        { key: "n", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
        "Win32",
      ),
    ).toBe(false);
    expect(
      matchCreateWorkspaceShortcut(
        { key: "n", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
        "Win32",
      ),
    ).toBe(false);
  });

  it("matches Ctrl+Enter / Cmd+Enter for Create Workspace dialog submission", () => {
    expect(
      matchDialogSubmitShortcut(
        { key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        "Win32",
      ),
    ).toBe(true);
    expect(
      matchDialogSubmitShortcut(
        { key: "Enter", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      matchDialogSubmitShortcut(
        { key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
        "Win32",
      ),
    ).toBe(false);
  });

  it("detects editable keyboard targets accurately", () => {
    expect(isEditableKeyboardTarget(null)).toBe(false);
    expect(isEditableKeyboardTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);
    expect(
      isEditableKeyboardTarget({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableKeyboardTarget({
        tagName: "DIV",
        closest: () => ({}) as Element,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isEditableKeyboardTarget({
        tagName: "BUTTON",
        isContentEditable: false,
        closest: () => null,
      } as unknown as EventTarget),
    ).toBe(false);
  });

  it("computes collapse/expand-all folder state transitions cleanly", () => {
    expect(areAllProjectsCollapsed([])).toBe(false);
    expect(areAllProjectsCollapsed([{ collapsed: true }, { collapsed: true }])).toBe(true);
    expect(areAllProjectsCollapsed([{ collapsed: true }, { collapsed: false }])).toBe(false);

    expect(
      computeCollapseAllProjectsNextExpanded([{ collapsed: true }, { collapsed: false }]),
    ).toBe(false);
    expect(
      computeCollapseAllProjectsNextExpanded([{ collapsed: false }, { collapsed: false }]),
    ).toBe(false);
    expect(
      computeCollapseAllProjectsNextExpanded([{ collapsed: true }, { collapsed: true }]),
    ).toBe(true);
  });

  it("preempts global Ctrl+N and Ctrl+Shift+H in capture phase while yielding to editable fields and open palettes", () => {
    const onToggleCollapseAllProjects = vi.fn();
    const onOpenCreateWorkspace = vi.fn();
    let paletteOpen = false;
    let modelPickerOpen = false;

    const handler = createOrcaSidebarShortcutHandler({
      isCommandPaletteOpen: () => paletteOpen,
      isModelPickerOpen: () => modelPickerOpen,
      onToggleCollapseAllProjects,
      onOpenCreateWorkspace,
      platform: "Win32",
    });

    const makeEvent = (overrides: {
      readonly key: string;
      readonly ctrlKey?: boolean;
      readonly shiftKey?: boolean;
      readonly target?: EventTarget | null;
      readonly defaultPrevented?: boolean;
      readonly repeat?: boolean;
    }) => {
      const preventDefault = vi.fn();
      const stopPropagation = vi.fn();
      const stopImmediatePropagation = vi.fn();
      return {
        event: {
          key: overrides.key,
          ctrlKey: overrides.ctrlKey ?? false,
          metaKey: false,
          shiftKey: overrides.shiftKey ?? false,
          altKey: false,
          repeat: overrides.repeat ?? false,
          defaultPrevented: overrides.defaultPrevented ?? false,
          target: overrides.target ?? ({ tagName: "BODY" } as unknown as EventTarget),
          preventDefault,
          stopPropagation,
          stopImmediatePropagation,
        },
        preventDefault,
        stopPropagation,
        stopImmediatePropagation,
      };
    };

    // Ctrl+N preempts global command-dialog and opens Create Workspace
    const ctrlN = makeEvent({ key: "n", ctrlKey: true });
    expect(handler(ctrlN.event)).toBe(true);
    expect(onOpenCreateWorkspace).toHaveBeenCalledTimes(1);
    expect(ctrlN.preventDefault).toHaveBeenCalledTimes(1);
    expect(ctrlN.stopPropagation).toHaveBeenCalledTimes(1);
    expect(ctrlN.stopImmediatePropagation).toHaveBeenCalledTimes(1);

    // Ctrl+Shift+H toggles collapse/expand all projects and stops propagation
    const ctrlShiftH = makeEvent({ key: "H", ctrlKey: true, shiftKey: true });
    expect(handler(ctrlShiftH.event)).toBe(true);
    expect(onToggleCollapseAllProjects).toHaveBeenCalledTimes(1);
    expect(ctrlShiftH.preventDefault).toHaveBeenCalledTimes(1);
    expect(ctrlShiftH.stopPropagation).toHaveBeenCalledTimes(1);
    expect(ctrlShiftH.stopImmediatePropagation).toHaveBeenCalledTimes(1);

    // Editable form input yields (returns false without preventing default)
    const ctrlNInInput = makeEvent({
      key: "n",
      ctrlKey: true,
      target: { tagName: "INPUT" } as unknown as EventTarget,
    });
    expect(handler(ctrlNInInput.event)).toBe(false);
    expect(ctrlNInInput.preventDefault).not.toHaveBeenCalled();
    expect(onOpenCreateWorkspace).toHaveBeenCalledTimes(1);

    // Terminal target yields
    const ctrlNInTerminal = makeEvent({
      key: "n",
      ctrlKey: true,
      target: {
        tagName: "DIV",
        closest: (selector: string) =>
          selector.includes("data-terminal-owner") ? ({} as Element) : null,
      } as unknown as EventTarget,
    });
    expect(handler(ctrlNInTerminal.event)).toBe(false);
    expect(ctrlNInTerminal.preventDefault).not.toHaveBeenCalled();

    // Auto-focused main chat composer editor still allows Ctrl+N (so T3 chat.new cannot hijack it)
    const ctrlNInComposer = makeEvent({
      key: "n",
      ctrlKey: true,
      target: {
        tagName: "DIV",
        isContentEditable: true,
        getAttribute: (name: string) => (name === "data-testid" ? "composer-editor" : null),
        closest: () => null,
      } as unknown as EventTarget,
    });
    expect(handler(ctrlNInComposer.event)).toBe(true);
    expect(ctrlNInComposer.preventDefault).toHaveBeenCalledTimes(1);
    expect(onOpenCreateWorkspace).toHaveBeenCalledTimes(2);

    // Open command palette yields
    paletteOpen = true;
    const ctrlNInPalette = makeEvent({ key: "n", ctrlKey: true });
    expect(handler(ctrlNInPalette.event)).toBe(false);
    expect(ctrlNInPalette.preventDefault).not.toHaveBeenCalled();
    paletteOpen = false;

    // Open model picker yields
    modelPickerOpen = true;
    const ctrlNInModelPicker = makeEvent({ key: "n", ctrlKey: true });
    expect(handler(ctrlNInModelPicker.event)).toBe(false);
    expect(ctrlNInModelPicker.preventDefault).not.toHaveBeenCalled();
    modelPickerOpen = false;

    // Unrelated shortcut returns false so other scopes run normally
    const ctrlK = makeEvent({ key: "k", ctrlKey: true });
    expect(handler(ctrlK.event)).toBe(false);
    expect(ctrlK.preventDefault).not.toHaveBeenCalled();
  });
});

describe("Orca thread provenance, activity badge, filtering & grouping", () => {
  it("classifies subagents, automation-created, and CLI-created threads accurately", () => {
    const parentId = ThreadId.make("parent-1");
    const subagentByLineage = makeShell({
      id: ThreadId.make("t-sub-1"),
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const automationBySource = makeShell({
      id: ThreadId.make("t-auto-1"),
      createdBy: "system",
      creationSource: "server",
    });
    const automationByBranch = makeShell({
      id: ThreadId.make("t-auto-2"),
      branch: "factory/nightly-audit",
    });
    const automationByTitle = makeShell({
      id: ThreadId.make("t-auto-3"),
      title: "#factory Fix flaky test",
    });
    const cliBySource = makeShell({
      id: ThreadId.make("t-cli-1"),
      creationSource: "mcp",
    });
    const cliByTitle = makeShell({
      id: ThreadId.make("t-cli-2"),
      title: "[CLI] Run migration",
    });
    const regular = makeShell({
      id: ThreadId.make("t-regular"),
      title: "Refactor sidebar",
    });

    expect(isSubagentThread(subagentByLineage)).toBe(true);
    expect(isSubagentThread(regular)).toBe(false);

    expect(isAutomationCreatedThread(automationBySource)).toBe(true);
    expect(isAutomationCreatedThread(automationByBranch)).toBe(true);
    expect(isAutomationCreatedThread(automationByTitle)).toBe(true);
    expect(isAutomationCreatedThread(regular)).toBe(false);

    expect(isCliCreatedThread(cliBySource)).toBe(true);
    expect(isCliCreatedThread(cliByTitle)).toBe(true);
    expect(isCliCreatedThread(regular)).toBe(false);
  });

  it("prioritizes attention > working > unread > idle(0) in the bell badge summary", () => {
    expect(summarizeOrcaActivityBadge([])).toEqual({
      attentionCount: 0,
      workingCount: 0,
      unreadCount: 0,
      completedCount: 0,
      displayCount: 0,
      tone: "idle",
    });

    const unreadOnly = summarizeOrcaActivityBadge([
      { bucket: "unread", isUnread: true, isCompleted: true },
      { bucket: "completed", isUnread: false, isCompleted: true },
    ]);
    expect(unreadOnly.tone).toBe("unread");
    expect(unreadOnly.displayCount).toBe(1);
    expect(unreadOnly.completedCount).toBe(2);

    const workingOverUnread = summarizeOrcaActivityBadge([
      { bucket: "working", isUnread: false, isCompleted: false },
      { bucket: "working", isUnread: false, isCompleted: false },
      { bucket: "unread", isUnread: true, isCompleted: true },
    ]);
    expect(workingOverUnread.tone).toBe("working");
    expect(workingOverUnread.displayCount).toBe(2);

    const attentionHighest = summarizeOrcaActivityBadge([
      { bucket: "attention", isUnread: true, isCompleted: false },
      { bucket: "working", isUnread: false, isCompleted: false },
      { bucket: "unread", isUnread: true, isCompleted: true },
    ]);
    expect(attentionHighest.tone).toBe("attention");
    expect(attentionHighest.displayCount).toBe(1);
  });

  it("filters activity items and sidebar project threads by all 4 toggles + search query", () => {
    const unreadThread = makeShell({
      id: ThreadId.make("t-unread"),
      title: "Fix wallpaper blur",
      status: "completed",
      latestRunId: RunId.make("run-1"),
      latestRunCompletedAt: DateTime.makeUnsafe("2026-11-23T11:30:00.000Z"),
      lastVisitedAt: DateTime.makeUnsafe("2026-11-23T10:00:00.000Z"),
      updatedAt: DateTime.makeUnsafe("2026-11-23T11:30:00.000Z"),
    });
    const subagentThread = makeShell({
      id: ThreadId.make("t-sub"),
      title: "Subagent verifier",
      lineage: {
        rootThreadId: ThreadId.make("t-unread"),
        parentThreadId: ThreadId.make("t-unread"),
        relationshipToParent: "subagent",
      },
    });
    const automationThread = makeShell({
      id: ThreadId.make("t-auto"),
      title: "#factory Nightly lint",
      createdBy: "system",
      creationSource: "server",
    });
    const cliThread = makeShell({
      id: ThreadId.make("t-cli"),
      title: "CLI workspace",
      creationSource: "mcp",
    });
    const archivedThread = makeShell({
      id: ThreadId.make("t-archived"),
      title: "Archived old thread",
      archivedAt: DateTime.makeUnsafe("2026-11-22T00:00:00.000Z"),
    });

    const allThreads = [unreadThread, subagentThread, automationThread, cliThread, archivedThread];
    const items = allThreads.map((thread) =>
      buildOrcaActivityItem({
        thread,
        projectName: "Prismux",
        providerLabel: "Claude Code",
        providerDriverKind: "claudeAgent",
      }),
    );

    // Default: excludes archived & subagents
    const defaultVisible = filterOrcaActivityItems(items, DEFAULT_ORCA_PROJECTS_PREFS, "");
    expect(defaultVisible.map((item) => item.thread.id)).toEqual(["t-unread", "t-auto", "t-cli"]);

    // Show child agents -> includes t-sub
    const withChild = filterOrcaActivityItems(
      items,
      { ...DEFAULT_ORCA_PROJECTS_PREFS, showChildAgents: true },
      "",
    );
    expect(withChild.map((item) => item.thread.id)).toContain("t-sub");

    // Hide automation & CLI
    const hiddenAutoCli = filterOrcaActivityItems(
      items,
      {
        ...DEFAULT_ORCA_PROJECTS_PREFS,
        hideAutomationCreated: true,
        hideCliCreated: true,
      },
      "",
    );
    expect(hiddenAutoCli.map((item) => item.thread.id)).toEqual(["t-unread"]);

    // Unread only
    const unreadOnly = filterOrcaActivityItems(
      items,
      { ...DEFAULT_ORCA_PROJECTS_PREFS, unreadOnly: true },
      "",
    );
    expect(unreadOnly.map((item) => item.thread.id)).toEqual(["t-unread"]);

    // Live query search
    expect(filterOrcaActivityItems(items, DEFAULT_ORCA_PROJECTS_PREFS, "wallpaper")).toHaveLength(1);
    expect(filterOrcaActivityItems(items, DEFAULT_ORCA_PROJECTS_PREFS, "nonexistent")).toEqual([]);

    // Project tree filter helper respects unreadOnly + hideAutomation + hideCli
    const filteredTree = filterSidebarProjectThreads(
      [unreadThread, automationThread, cliThread],
      {
        unreadOnly: true,
        showChildAgents: false,
        hideAutomationCreated: true,
        hideCliCreated: true,
      },
      {},
    );
    expect(filteredTree.map((t) => t.id)).toEqual(["t-unread"]);
  });

  it("groups activity items by status, project, and recent recency order", () => {
    const copy = getOrcaProjectsCopy("zh");
    const workingItem = buildOrcaActivityItem({
      thread: makeShell({
        id: ThreadId.make("t-working"),
        projectId: ProjectId.make("p-a"),
        title: "Working task",
        latestRunId: RunId.make("run-working"),
        status: "running",
        updatedAt: DateTime.makeUnsafe("2026-11-23T12:00:00.000Z"),
      }),
      projectName: "Prismux",
      providerLabel: "Codex",
    });
    const attentionBase = makeThreadFixture({
      environmentId: LOCAL_ENV_ID,
      id: ThreadId.make("t-attention"),
      projectId: ProjectId.make("p-b"),
    }).source;
    const attentionItem = buildOrcaActivityItem({
      thread: presentThreadShell(
        LOCAL_ENV_ID,
        {
          ...attentionBase,
          title: "Needs approval",
          updatedAt: DateTime.makeUnsafe("2026-11-23T11:00:00.000Z"),
        },
        "approval",
      ),
      projectName: "",
      providerLabel: "Claude Code",
    });

    const labels = {
      statusLabels: copy.statusBucketLabels,
      noProjectLabel: copy.noProjectOption,
      recentLabel: copy.recentActivityHeading,
    };

    const byStatus = groupOrcaActivityItems([workingItem, attentionItem], "status", labels);
    expect(byStatus.map((g) => g.bucket)).toEqual(["attention", "working"]);
    expect(byStatus[0]?.label).toBe("等待处理");

    const byProject = groupOrcaActivityItems([workingItem, attentionItem], "project", labels);
    expect(byProject.map((g) => g.label)).toEqual(["Prismux", "无项目"]);

    const byRecent = groupOrcaActivityItems([attentionItem, workingItem], "recent", labels);
    expect(byRecent).toHaveLength(1);
    expect(byRecent[0]?.items.map((item) => item.thread.id)).toEqual(["t-working", "t-attention"]);
  });
});

describe("Orca Add Project validation & Create Workspace payload builder", () => {
  it("validates and normalizes HTTPS, SSH, SCP, and owner/repo Git clone URLs", () => {
    expect(validateAndNormalizeGitCloneUrl("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateAndNormalizeGitCloneUrl("not a url")).toEqual({ ok: false, reason: "invalid" });
    expect(validateAndNormalizeGitCloneUrl("ftp://example.com/repo.git")).toEqual({
      ok: false,
      reason: "invalid",
    });

    expect(validateAndNormalizeGitCloneUrl("Fish-under-sea/Prismux")).toEqual({
      ok: true,
      normalizedUrl: "https://github.com/Fish-under-sea/Prismux.git",
      folderName: "Prismux",
    });
    expect(
      validateAndNormalizeGitCloneUrl("git clone https://github.com/Fish-under-sea/Prismux.git"),
    ).toEqual({
      ok: true,
      normalizedUrl: "https://github.com/Fish-under-sea/Prismux.git",
      folderName: "Prismux",
    });
    expect(validateAndNormalizeGitCloneUrl("git@github.com:Fish-under-sea/Prismux.git")).toEqual({
      ok: true,
      normalizedUrl: "git@github.com:Fish-under-sea/Prismux.git",
      folderName: "Prismux",
    });
    expect(inferRepoFolderNameFromUrl("https://github.com/org/my-repo.git/")).toBe("my-repo");
  });

  it("validates new project directory names cleanly", () => {
    expect(validateNewProjectName("  ")).toEqual({ ok: false, reason: "empty" });
    expect(validateNewProjectName("../escape")).toEqual({ ok: false, reason: "invalid" });
    expect(validateNewProjectName("bad/name")).toEqual({ ok: false, reason: "invalid" });
    expect(validateNewProjectName("prismux-demo")).toEqual({ ok: true, name: "prismux-demo" });
  });

  it("builds Create Workspace payloads for scratch (~) and real projects with optional fields", () => {
    expect(
      buildCreateWorkspacePayload({
        projectSelection: NO_PROJECT_SELECTION_VALUE,
        environmentId: null,
        workspaceName: "",
        agentOptionId: DEFAULT_AGENT_SELECTION_VALUE,
        envMode: "local",
        branch: "",
        initialPrompt: "",
        createMore: false,
      }),
    ).toEqual({ ok: false, reason: "missing-environment" });

    expect(
      buildCreateWorkspacePayload({
        projectSelection: NO_PROJECT_SELECTION_VALUE,
        environmentId: "env-local",
        workspaceName: "  🚀 Quick Spike  ",
        agentOptionId: DEFAULT_AGENT_SELECTION_VALUE,
        envMode: "local",
        branch: "  ",
        initialPrompt: "",
        createMore: true,
      }),
    ).toEqual({
      ok: true,
      payload: {
        isScratchProject: true,
        projectKey: null,
        environmentId: "env-local",
        workspaceName: "🚀 Quick Spike",
        agentOptionId: null,
        envMode: "local",
        branch: null,
        initialPrompt: null,
        createMore: true,
      },
    });

    expect(
      buildCreateWorkspacePayload({
        projectSelection: "env-local:proj-1",
        environmentId: "env-local",
        workspaceName: "Auth Refactor",
        agentOptionId: "claudeAgent:claude-opus-4-6",
        envMode: "worktree",
        branch: "feat/auth",
        initialPrompt: "Inspect OAuth flow",
        createMore: false,
      }),
    ).toEqual({
      ok: true,
      payload: {
        isScratchProject: false,
        projectKey: "env-local:proj-1",
        environmentId: "env-local",
        workspaceName: "Auth Refactor",
        agentOptionId: "claudeAgent:claude-opus-4-6",
        envMode: "worktree",
        branch: "feat/auth",
        initialPrompt: "Inspect OAuth flow",
        createMore: false,
      },
    });
  });

  it("provides Orca's 48 curated emojis and inserts emojis cleanly at selection range", () => {
    expect(ORCA_WORKSPACE_EMOJI_DEFAULTS).toHaveLength(48);
    expect(insertEmojiAtSelection("", 0, 0, "🚀")).toEqual({ value: "🚀", cursor: 2 });
    expect(insertEmojiAtSelection("Fix bug", 0, 0, "🐛")).toEqual({
      value: "🐛 Fix bug",
      cursor: 3,
    });
    expect(insertEmojiAtSelection("Hello world", 5, 11, "✨")).toEqual({
      value: "Hello✨",
      cursor: 6,
    });
  });

  it("formats primary local host labels in zh/en and preserves remote host labels", () => {
    expect(
      formatLocalEnvironmentDisplayLabel({
        rawLabel: "Local",
        platformOs: "win32",
        isPrimary: true,
        isZh: true,
      }),
    ).toBe("本地 Windows");
    expect(
      formatLocalEnvironmentDisplayLabel({
        rawLabel: "Local",
        platformOs: "win32",
        isPrimary: true,
        isZh: false,
      }),
    ).toBe("Local Windows");
    expect(
      formatLocalEnvironmentDisplayLabel({
        rawLabel: "Local",
        platformOs: "darwin",
        isPrimary: true,
        isZh: true,
      }),
    ).toBe("本地 macOS");
    expect(
      formatLocalEnvironmentDisplayLabel({
        rawLabel: "Local",
        platformOs: "linux",
        isPrimary: true,
        isZh: false,
      }),
    ).toBe("Local Linux");
    expect(
      formatLocalEnvironmentDisplayLabel({
        rawLabel: "prod-ssh-box",
        platformOs: "linux",
        isPrimary: false,
        isZh: true,
      }),
    ).toBe("prod-ssh-box");
  });
});
