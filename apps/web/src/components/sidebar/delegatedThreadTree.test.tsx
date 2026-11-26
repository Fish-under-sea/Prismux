import { presentThreadShell } from "@prismux/client-runtime/state/models";
import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@prismux/core-contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import * as DateTime from "effect/DateTime";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { TooltipProvider } from "../ui/tooltip";
import { DelegatedSubthreadTree } from "./DelegatedSubthreadTree";
import { SidebarThreadRow, type SidebarProviderEntry } from "./SidebarThreadRow";
import {
  collectDelegatedChildThreadRefs,
  groupDelegatedChildThreadsByParent,
  isDelegatedChildThreadActive,
  isPrismuxDelegatedChildThread,
  reconcileDelegatedTreeExpansionMap,
  resolveDelegatedTreeExpanded,
  toggleDelegatedTreeExpansion,
  type DelegatedTreeExpansionEntry,
} from "./delegatedThreadTree.logic";

initializeGT({
  defaultLocale: "en",
  locales: ["en", "zh"],
});

const ENV_LOCAL = EnvironmentId.make("env-local");

function makeShell(overrides: Partial<OrchestrationV2ThreadShell> = {}, envId = ENV_LOCAL) {
  const id = overrides.id ?? ThreadId.make("t-1");
  const base = makeThreadFixture({
    environmentId: envId,
    id,
    projectId: ProjectId.make("proj-1"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-6.2-astra",
    },
  }).source;
  return presentThreadShell(envId, {
    ...base,
    title: "Parent session",
    createdAt: DateTime.makeUnsafe("2026-11-26T10:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-26T10:05:00.000Z"),
    lastVisitedAt: DateTime.makeUnsafe("2026-11-26T10:06:00.000Z"),
    ...overrides,
  });
}

function wrap(node: React.ReactNode, locale: "zh" | "en" = "zh"): string {
  const rootRoute = createRootRoute();
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const RouterContextWrapper = RouterContextProvider as React.ComponentType<{
    readonly router: unknown;
    readonly children?: React.ReactNode;
  }>;
  return renderToStaticMarkup(
    createElement(
      RouterContextWrapper,
      { router },
      <GTProvider locale={locale} translations={{}}>
        <TooltipProvider>{node}</TooltipProvider>
      </GTProvider>,
    ),
  );
}

describe("delegatedThreadTree.logic", () => {
  it("strictly filters Prismux MCP-delegated subagents and excludes provider-internal subagents, side chats, forks, archived, and deleted threads", () => {
    const parentId = ThreadId.make("parent-1");
    const parent = makeShell({
      id: parentId,
      creationSource: "web",
      lineage: { rootThreadId: parentId, parentThreadId: null, relationshipToParent: null },
    });
    const mcpChildOlder = makeShell({
      id: ThreadId.make("child-mcp-1"),
      title: "DSH backend audit",
      creationSource: "mcp",
      createdAt: DateTime.makeUnsafe("2026-11-26T10:01:00.000Z"),
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const mcpChildNewer = makeShell({
      id: ThreadId.make("child-mcp-2"),
      title: "Codex test runner",
      creationSource: "mcp",
      createdAt: DateTime.makeUnsafe("2026-11-26T10:03:00.000Z"),
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const serverDelegatedChild = makeShell({
      id: ThreadId.make("child-server-1"),
      title: "Server orchestrated child",
      creationSource: "server",
      createdAt: DateTime.makeUnsafe("2026-11-26T10:02:00.000Z"),
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const providerNativeSubagent = makeShell({
      id: ThreadId.make("child-provider-native"),
      title: "Claude native Task subagent",
      creationSource: "provider",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const sideChat = makeShell({
      id: ThreadId.make("child-side-chat"),
      title: "Quick side question",
      creationSource: "mcp",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
        sideChat: true,
      },
    });
    const forkChild = makeShell({
      id: ThreadId.make("child-fork"),
      title: "Forked branch",
      creationSource: "mcp",
      lineage: { rootThreadId: parentId, parentThreadId: parentId, relationshipToParent: "fork" },
    });
    const archivedChild = makeShell({
      id: ThreadId.make("child-archived"),
      title: "Archived child",
      creationSource: "mcp",
      archivedAt: DateTime.makeUnsafe("2026-11-26T10:04:00.000Z"),
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const deletedChild = makeShell({
      id: ThreadId.make("child-deleted"),
      title: "Deleted child",
      creationSource: "mcp",
      deletedAt: DateTime.makeUnsafe("2026-11-26T10:04:30.000Z"),
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    expect(isPrismuxDelegatedChildThread(parent)).toBe(false);
    expect(isPrismuxDelegatedChildThread(mcpChildOlder)).toBe(true);
    expect(isPrismuxDelegatedChildThread(serverDelegatedChild)).toBe(true);
    expect(isPrismuxDelegatedChildThread(providerNativeSubagent)).toBe(false);
    expect(isPrismuxDelegatedChildThread(sideChat)).toBe(false);
    expect(isPrismuxDelegatedChildThread(forkChild)).toBe(false);
    expect(isPrismuxDelegatedChildThread(archivedChild)).toBe(false);
    expect(isPrismuxDelegatedChildThread(deletedChild)).toBe(false);

    const grouped = groupDelegatedChildThreadsByParent([
      parent,
      mcpChildNewer,
      providerNativeSubagent,
      sideChat,
      forkChild,
      archivedChild,
      deletedChild,
      serverDelegatedChild,
      mcpChildOlder,
    ]);

    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, parentId));
    expect(grouped.size).toBe(1);
    expect(grouped.get(parentKey)?.map((child) => child.id)).toEqual([
      "child-mcp-1",
      "child-server-1",
      "child-mcp-2",
    ]);
  });

  it("auto-expands while any delegated child is running, auto-collapses when all complete, and respects manual override until next running state transition", () => {
    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, ThreadId.make("parent-1")));
    let expansionMap: ReadonlyMap<string, DelegatedTreeExpansionEntry> = new Map();

    // 1. Initial running state -> auto-expanded
    expansionMap = reconcileDelegatedTreeExpansionMap(expansionMap, new Map([[parentKey, true]]));
    expect(
      resolveDelegatedTreeExpanded({ hasRunningChild: true, entry: expansionMap.get(parentKey) }),
    ).toBe(true);

    // 2. User manually collapses while still running -> stays collapsed while running
    expansionMap = toggleDelegatedTreeExpansion(expansionMap, parentKey, true);
    expect(
      resolveDelegatedTreeExpanded({ hasRunningChild: true, entry: expansionMap.get(parentKey) }),
    ).toBe(false);
    const sameWhileRunning = reconcileDelegatedTreeExpansionMap(
      expansionMap,
      new Map([[parentKey, true]]),
    );
    expect(sameWhileRunning).toBe(expansionMap);

    // 3. All children complete -> transitions running(true) -> idle(false) -> auto-collapses & clears manual override
    expansionMap = reconcileDelegatedTreeExpansionMap(expansionMap, new Map([[parentKey, false]]));
    expect(
      resolveDelegatedTreeExpanded({ hasRunningChild: false, entry: expansionMap.get(parentKey) }),
    ).toBe(false);

    // 4. User manually expands completed tree -> stays expanded while idle
    expansionMap = toggleDelegatedTreeExpansion(expansionMap, parentKey, false);
    expect(
      resolveDelegatedTreeExpanded({ hasRunningChild: false, entry: expansionMap.get(parentKey) }),
    ).toBe(true);
    expect(reconcileDelegatedTreeExpansionMap(expansionMap, new Map([[parentKey, false]]))).toBe(
      expansionMap,
    );

    // 5. A new delegated child starts running -> transitions idle(false) -> running(true) -> auto-expands
    expansionMap = reconcileDelegatedTreeExpansionMap(expansionMap, new Map([[parentKey, true]]));
    expect(
      resolveDelegatedTreeExpanded({ hasRunningChild: true, entry: expansionMap.get(parentKey) }),
    ).toBe(true);

    // 6. That child finishes -> transitions running(true) -> idle(false) -> auto-collapses (does NOT resurrect stale override from step 4)
    expansionMap = reconcileDelegatedTreeExpansionMap(expansionMap, new Map([[parentKey, false]]));
    expect(
      resolveDelegatedTreeExpanded({ hasRunningChild: false, entry: expansionMap.get(parentKey) }),
    ).toBe(false);

    // 7. Parent loses all delegated children -> pruned cleanly
    expansionMap = reconcileDelegatedTreeExpansionMap(expansionMap, new Map());
    expect(expansionMap.size).toBe(0);
  });

  it("collects attached delegated child refs for cascade delete/archive while returning empty for leaf child threads and guarding cycles", () => {
    const parentId = ThreadId.make("parent-1");
    const childAId = ThreadId.make("child-a");
    const childBId = ThreadId.make("child-b");
    const grandchildId = ThreadId.make("grandchild-1");
    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, parentId));
    const childAKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, childAId));
    const childBKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, childBId));

    const map = new Map([
      [
        parentKey,
        [
          { environmentId: ENV_LOCAL, id: childAId },
          { environmentId: ENV_LOCAL, id: childBId },
        ],
      ],
      [childAKey, [{ environmentId: ENV_LOCAL, id: grandchildId }]],
      // Synthetic cycle back to parent must never infinite-loop.
      [
        scopedThreadKey(scopeThreadRef(ENV_LOCAL, grandchildId)),
        [{ environmentId: ENV_LOCAL, id: parentId }],
      ],
    ]);

    expect(collectDelegatedChildThreadRefs(parentKey, map)).toEqual([
      scopeThreadRef(ENV_LOCAL, childAId),
      scopeThreadRef(ENV_LOCAL, childBId),
      scopeThreadRef(ENV_LOCAL, grandchildId),
    ]);
    // Acting on leaf child B cascades to nothing else (individual action only).
    expect(collectDelegatedChildThreadRefs(childBKey, map)).toEqual([]);
  });

  it("detects running vs completed/failed delegated child thread activity accurately", () => {
    const runningChild = makeShell({
      id: ThreadId.make("c-run"),
      latestRunId: RunId.make("run-1"),
      status: "running",
    });
    const completedChild = makeShell({
      id: ThreadId.make("c-done"),
      latestRunId: RunId.make("run-2"),
      status: "completed",
    });
    const failedChild = makeShell({
      id: ThreadId.make("c-fail"),
      latestRunId: RunId.make("run-3"),
      status: "failed",
    });
    expect(isDelegatedChildThreadActive(runningChild)).toBe(true);
    expect(isDelegatedChildThreadActive(completedChild)).toBe(false);
    expect(isDelegatedChildThreadActive(failedChild)).toBe(false);
  });
});

describe("DelegatedSubthreadTree & SidebarThreadRow SSR rendering", () => {
  const codexId = ProviderInstanceId.make("codex");
  const dshId = ProviderInstanceId.make("dsh");
  const providerMap = new Map<string, SidebarProviderEntry>([
    [
      codexId,
      {
        instanceId: codexId,
        driverKind: ProviderDriverKind.make("codex"),
        enabled: true,
        displayName: "Codex",
        models: [],
      },
    ],
    [
      dshId,
      {
        instanceId: dshId,
        driverKind: ProviderDriverKind.make("acp"),
        acpRegistryAgentId: "dsh",
        enabled: true,
        displayName: "DeepSeek Harness",
        models: [],
      },
    ],
  ]);

  it("renders traditional SVG L-bend connectors, conducts RGB trunk through idle sibling to running child below, and exposes individual hover actions", () => {
    const parentId = ThreadId.make("parent-1");
    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, parentId));
    const idleFirstChild = makeShell({
      id: ThreadId.make("child-1"),
      title: "Audit sidebar tree",
      creationSource: "mcp",
      providerInstanceId: codexId,
      modelSelection: { instanceId: codexId, model: "gpt-6.2-astra" },
      latestRunId: RunId.make("run-1"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const runningLastChild = makeShell({
      id: ThreadId.make("child-2"),
      title: "Inspect DSH bridge",
      creationSource: "mcp",
      providerInstanceId: dshId,
      modelSelection: { instanceId: dshId, model: "deepseek-v4.1" },
      latestRunId: RunId.make("run-2"),
      status: "running",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const runningChildKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, runningLastChild.id));

    const html = wrap(
      <DelegatedSubthreadTree
        parentKey={parentKey}
        childThreads={[idleFirstChild, runningLastChild]}
        activeThreadKey={runningChildKey}
        inWorkspaceCard
        providerEntryByInstanceId={providerMap}
        canOperateEnvironment
        onSelectChild={vi.fn()}
        onActivateChild={vi.fn()}
        onContextMenuChild={vi.fn()}
        onArchiveChild={vi.fn()}
        onDeleteChild={vi.fn()}
      />,
      "zh",
    );

    // Tree structure + middle (`├─`) vs last (`└─`) SVG connectors
    expect(html).toContain('data-testid="delegated-subthread-tree"');
    expect(html).toContain('data-connector-kind="middle"');
    expect(html).toContain('data-connector-kind="last"');
    expect(html).toContain('d="M 8 0 L 8 28"');
    expect(html).toContain('d="M 8 0 L 8 8 Q 8 14 14 14 L 20 14"');

    // RGB conduction: first child is idle (`data-rgb-active="0"`) but conducts RGB trunk down (`data-rgb-trunk-active="1"`),
    // second child is running (`data-rgb-active="1"`, `data-sidebar-agent-active="1"`) with RGB beam & full palette gradient.
    expect(html).toContain(
      'data-connector-kind="middle" data-rgb-active="0" data-rgb-trunk-active="1"',
    );
    expect(html).toContain(
      'data-connector-kind="last" data-rgb-active="1" data-rgb-trunk-active="0"',
    );
    expect(html).toContain('data-connector-part="trunk-rgb-beam"');
    expect(html).toContain('data-connector-part="branch-rgb-beam"');
    expect(html).toContain('data-pmx-tree-rgb-beam="1"');
    expect(html).toContain("#ff3b7f");
    expect(html).toContain("#ff9f1c");
    expect(html).toContain("#34d399");
    expect(html).toContain("#38bdf8");
    expect(html).toContain("#818cf8");
    expect(html).toContain("#c084fc");

    // Child row states, brand logos, titles, models, and active route highlight
    expect(html).toContain('data-delegated-status="done"');
    expect(html).toContain('data-delegated-status="working"');
    expect(html).toContain('data-agent-brand="codex"');
    expect(html).toContain('data-agent-brand="dsh"');
    expect(html).toContain("Audit sidebar tree");
    expect(html).toContain("Inspect DSH bridge");
    expect(html).toContain(">6.2 Astra<");
    expect(html).toContain('aria-current="page"');

    // Individual child hover actions: archive only for completed child (1 button), delete for both (2 buttons).
    expect((html.match(/data-testid="delegated-child-archive-action"/g) ?? []).length).toBe(1);
    expect((html.match(/data-testid="delegated-child-delete-action"/g) ?? []).length).toBe(2);
  });

  it("renders collapsed compact toggle badge on parent SidebarThreadRow when all delegated children are complete, and mounts subtree when expanded", () => {
    const parentId = ThreadId.make("parent-row");
    const parentThread = makeShell({
      id: parentId,
      title: "Orchestrate multi-agent fix",
      latestRunId: RunId.make("run-p"),
      status: "completed",
    });
    const childDone = makeShell({
      id: ThreadId.make("child-done"),
      title: "Fix unit test",
      creationSource: "mcp",
      latestRunId: RunId.make("run-c"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    const baseRowProps = {
      thread: parentThread,
      variant: "orca-compact" as const,
      inWorkspaceCard: true,
      variantAction: "settle" as const,
      settlementSupported: true,
      snoozeSupported: true,
      pinningSupported: true,
      isPinned: false,
      dropVerb: null,
      dragOverPinned: false,
      sweepAction: null,
      snoozeWakeLabelText: null,
      wokeAt: null,
      isActive: true,
      isRouteThread: true,
      readOpensPullRequestsInRightPanel: () => true,
      jumpLabel: null,
      environmentLabel: "Local",
      environmentMachine: "desktop" as const,
      project: null,
      projectDisplayName: "Prismux",
      providerEntryByInstanceId: providerMap,
      timestampFormat: "24-hour" as const,
      onThreadClick: vi.fn(),
      onThreadActivate: vi.fn(),
      onStartRename: vi.fn(),
      onRenameTitleChange: vi.fn(),
      onCommitRename: vi.fn(),
      onCancelRename: vi.fn(),
      isRenaming: false,
      renamingTitle: "",
      onContextMenu: vi.fn(),
      onSettle: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onActionSweepStart: vi.fn(),
      onUnsettle: vi.fn(),
      onSnooze: vi.fn(),
      onUnsnooze: vi.fn(),
      onUnpin: vi.fn(),
      onAcknowledgeWoke: vi.fn(),
      delegatedChildren: [childDone],
      delegatedTreeHasRunning: false,
      onToggleDelegatedTree: vi.fn(),
    };

    const collapsedHtml = wrap(
      <ul>
        <SidebarThreadRow {...baseRowProps} delegatedTreeExpanded={false} />
      </ul>,
      "zh",
    );
    expect(collapsedHtml).toContain('data-testid="sidebar-delegated-tree-toggle"');
    expect(collapsedHtml).toContain('aria-expanded="false"');
    expect(collapsedHtml).toContain(">1<");
    expect(collapsedHtml).not.toContain('data-testid="delegated-subthread-tree"');

    const expandedHtml = wrap(
      <ul>
        <SidebarThreadRow {...baseRowProps} delegatedTreeExpanded />
      </ul>,
      "zh",
    );
    expect(expandedHtml).toContain('data-testid="sidebar-delegated-tree-toggle"');
    expect(expandedHtml).toContain('aria-expanded="true"');
    expect(expandedHtml).toContain('data-testid="delegated-subthread-tree"');
    expect(expandedHtml).toContain("Fix unit test");
  });
});
