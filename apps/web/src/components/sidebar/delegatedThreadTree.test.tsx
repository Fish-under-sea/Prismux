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
import {
  DSH_BRAND_COLOR,
  DSH_FISH_LOGO_VIEWBOX,
  GLM_BRAND_COLOR,
  QWEN_BRAND_COLOR,
} from "../../prismux/agentBrand";
import { TooltipProvider } from "../ui/tooltip";
import {
  DelegatedSubthreadTree,
  resolveDelegatedChildProviderPresentation,
} from "./DelegatedSubthreadTree";
import { SidebarThreadRow, type SidebarProviderEntry } from "./SidebarThreadRow";
import {
  collectDelegatedChildThreadRefs,
  groupDelegatedChildThreadsByParent,
  hasDelegatedChildInLatestParentTurn,
  isDelegatedChildThreadActive,
  isPrismuxDelegatedChildThread,
  isThreadActivelyRunning,
  reconcileDelegatedTreeExpansionMap,
  resolveDelegatedTreeCollapseTiming,
  resolveDelegatedTreeExpanded,
  shouldDelegatedTreeAutoExpand,
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

  it("detects running vs completed/unseen-completed/failed thread activity accurately", () => {
    const runningChild = makeShell({
      id: ThreadId.make("c-run"),
      latestRunId: RunId.make("run-1"),
      status: "running",
    });
    const waitingParent = makeShell({
      id: ThreadId.make("p-wait"),
      latestRunId: RunId.make("run-p"),
      status: "running",
      blockedOnThreadWait: true,
    });
    const completedChild = makeShell({
      id: ThreadId.make("c-done"),
      latestRunId: RunId.make("run-2"),
      status: "completed",
    });
    const unseenCompletedChild = makeShell({
      id: ThreadId.make("c-unseen-done"),
      latestRunId: RunId.make("run-2b"),
      status: "completed",
      updatedAt: DateTime.makeUnsafe("2026-11-26T10:10:00.000Z"),
      lastVisitedAt: DateTime.makeUnsafe("2026-11-26T10:01:00.000Z"),
    });
    const failedChild = makeShell({
      id: ThreadId.make("c-fail"),
      latestRunId: RunId.make("run-3"),
      status: "failed",
    });
    expect(isDelegatedChildThreadActive(runningChild)).toBe(true);
    expect(isThreadActivelyRunning(waitingParent)).toBe(true);
    expect(isDelegatedChildThreadActive(completedChild)).toBe(false);
    expect(isDelegatedChildThreadActive(unseenCompletedChild)).toBe(false);
    expect(isDelegatedChildThreadActive(failedChild)).toBe(false);
  });

  it("syncs level-2 delegated tree auto-collapse with parent final-answer completion and workStepsCollapseTiming", () => {
    const parentId = ThreadId.make("parent-sync");
    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, parentId));
    const childId = ThreadId.make("child-sync");
    const turn1UserAt = DateTime.makeUnsafe("2026-11-26T10:00:00.000Z");
    const turn1ChildCreatedAt = DateTime.makeUnsafe("2026-11-26T10:00:05.000Z");
    const turn1ChildDoneAt = DateTime.makeUnsafe("2026-11-26T10:00:12.000Z");
    const turn1ParentDoneAt = DateTime.makeUnsafe("2026-11-26T10:00:20.000Z");
    const turn2UserAt = DateTime.makeUnsafe("2026-11-26T10:02:00.000Z");

    expect(
      resolveDelegatedTreeCollapseTiming({
        workStepsDisplay: "detailed",
        workStepsCollapseTiming: "after-turn",
      }),
    ).toBe("after-turn");
    expect(
      resolveDelegatedTreeCollapseTiming({
        workStepsDisplay: "standard",
        workStepsCollapseTiming: "next-message",
      }),
    ).toBe("next-message");
    expect(
      resolveDelegatedTreeCollapseTiming({
        workStepsDisplay: "expanded",
        workStepsCollapseTiming: "after-turn",
      }),
    ).toBe("never");

    const parentRunningTurn1 = makeShell({
      id: parentId,
      latestRunId: RunId.make("run-p1"),
      status: "running",
      latestUserMessageAt: turn1UserAt,
      latestRunStartedAt: turn1UserAt,
      lastVisitedAt: turn1UserAt,
    });
    const childRunningTurn1 = makeShell({
      id: childId,
      creationSource: "mcp",
      latestRunId: RunId.make("run-c1"),
      status: "running",
      createdAt: turn1ChildCreatedAt,
      updatedAt: turn1ChildCreatedAt,
      lastVisitedAt: turn1UserAt,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const childUnseenCompletedTurn1 = makeShell({
      id: childId,
      creationSource: "mcp",
      latestRunId: RunId.make("run-c1"),
      status: "completed",
      createdAt: turn1ChildCreatedAt,
      updatedAt: turn1ChildDoneAt,
      latestRunCompletedAt: turn1ChildDoneAt,
      lastVisitedAt: turn1UserAt,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const parentCompletedTurn1 = makeShell({
      id: parentId,
      latestRunId: RunId.make("run-p1"),
      status: "completed",
      latestUserMessageAt: turn1UserAt,
      latestRunStartedAt: turn1UserAt,
      latestRunCompletedAt: turn1ParentDoneAt,
      updatedAt: turn1ParentDoneAt,
      lastVisitedAt: turn1UserAt,
    });
    const parentRunningTurn2WithoutChild = makeShell({
      id: parentId,
      latestRunId: RunId.make("run-p2"),
      status: "running",
      latestUserMessageAt: turn2UserAt,
      latestRunStartedAt: turn2UserAt,
      updatedAt: turn2UserAt,
      lastVisitedAt: turn2UserAt,
    });

    // Under "after-turn":
    // 1. Both running -> auto-expanded
    let expansionMap: ReadonlyMap<string, DelegatedTreeExpansionEntry> = new Map();
    const syncAndResolve = (
      parent: ReturnType<typeof makeShell>,
      children: readonly ReturnType<typeof makeShell>[],
      collapseTiming: "after-turn" | "next-message" | "never",
    ) => {
      const shouldAutoExpand = shouldDelegatedTreeAutoExpand({
        parent,
        children,
        collapseTiming,
      });
      expansionMap = reconcileDelegatedTreeExpansionMap(
        expansionMap,
        new Map([[parentKey, shouldAutoExpand]]),
      );
      return {
        shouldAutoExpand,
        expanded: resolveDelegatedTreeExpanded({
          hasRunningChild: shouldAutoExpand,
          entry: expansionMap.get(parentKey),
        }),
      };
    };

    expect(syncAndResolve(parentRunningTurn1, [childRunningTurn1], "after-turn")).toEqual({
      shouldAutoExpand: true,
      expanded: true,
    });

    // 2. Child finishes with unseen green-check ✓ while parent is STILL generating final answer -> STAYS EXPANDED!
    expect(isDelegatedChildThreadActive(childUnseenCompletedTurn1)).toBe(false);
    expect(syncAndResolve(parentRunningTurn1, [childUnseenCompletedTurn1], "after-turn")).toEqual({
      shouldAutoExpand: true,
      expanded: true,
    });

    // 3. Parent finishes final answer (also unseen green-check ✓) -> AUTO-COLLAPSES IMMEDIATELY!
    expect(syncAndResolve(parentCompletedTurn1, [childUnseenCompletedTurn1], "after-turn")).toEqual(
      {
        shouldAutoExpand: false,
        expanded: false,
      },
    );

    // 4. User manually toggles `↳ 1` open & closed after completion -> works cleanly without reverting!
    expansionMap = toggleDelegatedTreeExpansion(expansionMap, parentKey, false);
    expect(
      resolveDelegatedTreeExpanded({
        hasRunningChild: false,
        entry: expansionMap.get(parentKey),
      }),
    ).toBe(true);
    expansionMap = toggleDelegatedTreeExpansion(expansionMap, parentKey, false);
    expect(
      resolveDelegatedTreeExpanded({
        hasRunningChild: false,
        entry: expansionMap.get(parentKey),
      }),
    ).toBe(false);

    // 5. Follow-up Turn 2 without new delegation does NOT spuriously pop open Turn 1's finished child
    expect(
      hasDelegatedChildInLatestParentTurn(parentRunningTurn2WithoutChild, [
        childUnseenCompletedTurn1,
      ]),
    ).toBe(false);
    expect(
      syncAndResolve(parentRunningTurn2WithoutChild, [childUnseenCompletedTurn1], "after-turn"),
    ).toEqual({
      shouldAutoExpand: false,
      expanded: false,
    });

    // Under "next-message":
    // Stays expanded right after Turn 1 completes, then auto-collapses when Turn 2 starts!
    expansionMap = new Map();
    expect(
      syncAndResolve(parentCompletedTurn1, [childUnseenCompletedTurn1], "next-message"),
    ).toEqual({
      shouldAutoExpand: true,
      expanded: true,
    });
    expect(
      syncAndResolve(parentRunningTurn2WithoutChild, [childUnseenCompletedTurn1], "next-message"),
    ).toEqual({
      shouldAutoExpand: false,
      expanded: false,
    });

    // Under "never" (`workStepsDisplay === "expanded"`): stays expanded unless manually collapsed
    expansionMap = new Map();
    expect(syncAndResolve(parentCompletedTurn1, [childUnseenCompletedTurn1], "never")).toEqual({
      shouldAutoExpand: true,
      expanded: true,
    });
    expansionMap = toggleDelegatedTreeExpansion(expansionMap, parentKey, true);
    expect(
      resolveDelegatedTreeExpanded({
        hasRunningChild: true,
        entry: expansionMap.get(parentKey),
      }),
    ).toBe(false);
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

    const extractHoverActionsMarkup = (html: string): string => {
      const match = html.match(
        /<span\b[^>]*data-testid="sidebar-row-hover-actions"[^>]*>[\s\S]*?<\/span><\/span>/,
      );
      expect(match).not.toBeNull();
      return match![0];
    };

    const collapsedHtml = wrap(
      <ul>
        <SidebarThreadRow {...baseRowProps} delegatedTreeExpanded={false} />
      </ul>,
      "zh",
    );
    // Static state: leading green circle reuses the 24x24 r=10 outer ring and replaces checkmark with count `1`.
    expect(collapsedHtml).toContain(
      'data-orca-status="done" data-orca-delegated-count="1" data-orca-delegated-running="0"',
    );
    expect(collapsedHtml).toContain("text-success/80");
    expect(collapsedHtml).toContain('<circle cx="12" cy="12" r="10"');
    expect(collapsedHtml).toContain(">1</text>");
    expect(collapsedHtml).not.toContain("m9 12 2 2 4-4");

    // Toggle pill lives strictly inside the hover-only actions container, never squeezing the title at rest.
    const collapsedHoverActions = extractHoverActionsMarkup(collapsedHtml);
    expect(collapsedHoverActions).toContain("opacity-0");
    expect(collapsedHoverActions).toContain("pointer-events-none");
    expect(collapsedHoverActions).toContain("absolute");
    expect(collapsedHoverActions).toContain("group-any-hover/sidebar-row:opacity-100");
    expect(collapsedHoverActions).toContain("group-any-hover/sidebar-row:static");
    expect(collapsedHoverActions).toContain("has-[:focus-visible]:opacity-100");
    expect(collapsedHoverActions).not.toContain("focus-within");
    expect(collapsedHoverActions).toContain('data-testid="sidebar-delegated-tree-toggle"');
    expect(collapsedHtml).toContain('aria-expanded="false"');
    expect(collapsedHtml).toContain(">1<");
    expect(collapsedHtml).not.toContain('data-testid="delegated-subthread-tree"');

    // Confirm toggle button does not appear before `sidebar-row-hover-actions` (i.e. not permanently adjacent to title).
    expect(collapsedHtml.indexOf('data-testid="sidebar-delegated-tree-toggle"')).toBeGreaterThan(
      collapsedHtml.indexOf('data-testid="sidebar-row-hover-actions"'),
    );

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

  it("reuses leading status circle with count across unread, done, idle, overflow (9+), running-child, and preserves high-priority parent states", () => {
    const parentId = ThreadId.make("parent-status-circle");
    const makeChild = (idx: number, status: "completed" | "running" = "completed") =>
      makeShell({
        id: ThreadId.make(`child-circle-${idx}`),
        title: `Child ${idx}`,
        creationSource: "mcp",
        latestRunId: RunId.make(`run-circle-${idx}`),
        status,
        lineage: {
          rootThreadId: parentId,
          parentThreadId: parentId,
          relationshipToParent: "subagent",
        },
      });

    const baseProps = {
      variant: "orca-compact" as const,
      inWorkspaceCard: true,
      variantAction: "settle" as const,
      settlementSupported: false,
      snoozeSupported: false,
      pinningSupported: false,
      isPinned: false,
      dropVerb: null,
      dragOverPinned: false,
      sweepAction: null,
      snoozeWakeLabelText: null,
      wokeAt: null,
      isActive: false,
      isRouteThread: false,
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
      onActionSweepStart: vi.fn(),
      onUnsettle: vi.fn(),
      onSnooze: vi.fn(),
      onUnsnooze: vi.fn(),
      onUnpin: vi.fn(),
      onAcknowledgeWoke: vi.fn(),
      onToggleDelegatedTree: vi.fn(),
    };

    const extractLeadingIconMarkup = (html: string): string => {
      const match = html.match(/<svg\b[^>]*data-orca-status="[^"]*"[^>]*>[\s\S]*?<\/svg>/);
      expect(match).not.toBeNull();
      return match![0];
    };

    // 1. Unread completed parent with 2 completed children -> bright green `text-success` ring + `2`
    const unreadParent = makeShell({
      id: parentId,
      title: "Unread parent",
      latestRunId: RunId.make("run-unread"),
      status: "completed",
      latestRunCompletedAt: DateTime.makeUnsafe("2026-11-26T10:10:00.000Z"),
      updatedAt: DateTime.makeUnsafe("2026-11-26T10:10:00.000Z"),
      lastVisitedAt: DateTime.makeUnsafe("2026-11-26T10:01:00.000Z"),
    });
    const unreadHtml = wrap(
      <ul>
        <SidebarThreadRow
          {...baseProps}
          thread={unreadParent}
          delegatedChildren={[makeChild(1), makeChild(2)]}
          delegatedTreeExpanded={false}
          delegatedTreeHasRunning={false}
        />
      </ul>,
      "zh",
    );
    const unreadIcon = extractLeadingIconMarkup(unreadHtml);
    expect(unreadIcon).toContain('data-orca-status="unread"');
    expect(unreadIcon).toContain('data-orca-delegated-count="2"');
    expect(unreadIcon).toContain('data-orca-delegated-running="0"');
    expect(unreadIcon).toContain("text-success");
    expect(unreadIcon).not.toContain("text-success/80");
    expect(unreadIcon).toContain(">2</text>");

    // Even with zero settle/snooze/archive/delete permissions, delegatedChildren still enables hover actions + hides model/time on hover.
    expect(unreadHtml).toContain('data-testid="sidebar-row-hover-actions"');
    expect(unreadHtml).toContain('data-testid="sidebar-delegated-tree-toggle"');
    expect(unreadHtml).toContain("group-any-hover/sidebar-row:opacity-0");

    // 2. Idle parent (no runs yet) with 1 child -> muted circle + `1`
    const idleParent = makeShell({
      id: parentId,
      title: "Idle parent",
      latestRunId: null,
      status: "idle",
    });
    const idleIcon = extractLeadingIconMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseProps}
            thread={idleParent}
            delegatedChildren={[makeChild(1)]}
            delegatedTreeExpanded={false}
            delegatedTreeHasRunning={false}
          />
        </ul>,
        "zh",
      ),
    );
    expect(idleIcon).toContain('data-orca-status="idle"');
    expect(idleIcon).toContain('data-orca-delegated-count="1"');
    expect(idleIcon).toContain("text-sidebar-muted-foreground/45");
    expect(idleIcon).toContain(">1</text>");

    // 3. Overflow count (>9) -> `9+` with compact font-size so text never overflows the circle
    const visitedDoneParent = makeShell({
      id: parentId,
      title: "Many children parent",
      latestRunId: RunId.make("run-many"),
      status: "completed",
    });
    const manyChildren = Array.from({ length: 12 }, (_, idx) => makeChild(idx + 1));
    const overflowIcon = extractLeadingIconMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseProps}
            thread={visitedDoneParent}
            delegatedChildren={manyChildren}
            delegatedTreeExpanded={false}
            delegatedTreeHasRunning={false}
          />
        </ul>,
        "zh",
      ),
    );
    expect(overflowIcon).toContain('data-orca-status="done"');
    expect(overflowIcon).toContain('data-orca-delegated-count="12"');
    expect(overflowIcon).toContain("text-success/80");
    expect(overflowIcon).toContain('font-size="10.5"');
    expect(overflowIcon).toContain(">9+</text>");

    // 4. Parent completed/idle while delegated child is still running -> warning spinning ring with motion-reduce fallback + stationary count
    const childRunningIcon = extractLeadingIconMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseProps}
            thread={visitedDoneParent}
            delegatedChildren={[makeChild(1, "running"), makeChild(2, "completed")]}
            delegatedTreeExpanded
            delegatedTreeHasRunning
          />
        </ul>,
        "zh",
      ),
    );
    expect(childRunningIcon).toContain('data-orca-status="done"');
    expect(childRunningIcon).toContain('data-orca-delegated-count="2"');
    expect(childRunningIcon).toContain('data-orca-delegated-running="1"');
    expect(childRunningIcon).toContain("text-warning");
    expect(childRunningIcon).toContain("animate-spin");
    expect(childRunningIcon).toContain("motion-reduce:animate-none");
    expect(childRunningIcon).toContain(">2</text>");

    // 5. High-priority parent states (`working`, `failed`) keep their own status icons intact
    const workingParent = makeShell({
      id: parentId,
      title: "Working parent",
      latestRunId: RunId.make("run-working"),
      status: "running",
    });
    const workingIcon = extractLeadingIconMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseProps}
            thread={workingParent}
            delegatedChildren={[makeChild(1, "running")]}
            delegatedTreeExpanded
            delegatedTreeHasRunning
          />
        </ul>,
        "zh",
      ),
    );
    expect(workingIcon).toContain('data-orca-status="working"');
    expect(workingIcon).not.toContain("data-orca-delegated-count");

    const failedParent = makeShell({
      id: parentId,
      title: "Failed parent",
      latestRunId: RunId.make("run-failed"),
      status: "failed",
      latestRunCompletedAt: DateTime.makeUnsafe("2026-11-26T10:10:00.000Z"),
      updatedAt: DateTime.makeUnsafe("2026-11-26T10:10:00.000Z"),
      lastVisitedAt: DateTime.makeUnsafe("2026-11-26T10:01:00.000Z"),
    });
    const failedIcon = extractLeadingIconMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseProps}
            thread={failedParent}
            delegatedChildren={[makeChild(1)]}
            delegatedTreeExpanded={false}
            delegatedTreeHasRunning={false}
          />
        </ul>,
        "zh",
      ),
    );
    expect(failedIcon).toContain('data-orca-status="failed"');
    expect(failedIcon).not.toContain("data-orca-delegated-count");

    // 6. Zero delegated children -> preserves standard CircleCheckIcon without delegated count attribute
    const noChildrenHtml = wrap(
      <ul>
        <SidebarThreadRow
          {...baseProps}
          thread={visitedDoneParent}
          delegatedChildren={[]}
          delegatedTreeExpanded={false}
          delegatedTreeHasRunning={false}
        />
      </ul>,
      "zh",
    );
    const noChildrenIcon = extractLeadingIconMarkup(noChildrenHtml);
    expect(noChildrenIcon).toContain('data-orca-status="done"');
    expect(noChildrenIcon).not.toContain("data-orca-delegated-count");
    expect(noChildrenHtml).not.toContain('data-testid="sidebar-delegated-tree-toggle"');
    expect(noChildrenHtml).not.toContain('data-testid="sidebar-row-hover-actions"');
  });

  it("places delegated toggle inside hover-only actions for folder, folder-multiline, and card variants without squeezing titles", () => {
    const parentId = ThreadId.make("parent-variants");
    const parentThread = makeShell({
      id: parentId,
      title: "Variant regression parent",
      latestRunId: RunId.make("run-var-p"),
      status: "completed",
    });
    const childDone = makeShell({
      id: ThreadId.make("child-var-1"),
      title: "Variant delegated child",
      creationSource: "mcp",
      latestRunId: RunId.make("run-var-c"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    const sharedProps = {
      thread: parentThread,
      variantAction: "settle" as const,
      settlementSupported: false,
      snoozeSupported: false,
      pinningSupported: false,
      isPinned: false,
      dropVerb: null,
      dragOverPinned: false,
      sweepAction: null,
      snoozeWakeLabelText: null,
      wokeAt: null,
      isActive: false,
      isRouteThread: false,
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

    for (const variant of ["folder", "folder-multiline", "card"] as const) {
      const collapsedHtml = wrap(
        <ul>
          <SidebarThreadRow {...sharedProps} variant={variant} delegatedTreeExpanded={false} />
        </ul>,
        "zh",
      );
      const hoverActionsIndex = collapsedHtml.indexOf('data-testid="sidebar-row-hover-actions"');
      const toggleIndex = collapsedHtml.indexOf('data-testid="sidebar-delegated-tree-toggle"');
      expect(hoverActionsIndex).toBeGreaterThan(-1);
      expect(toggleIndex).toBeGreaterThan(hoverActionsIndex);

      const hoverSlotMatch = collapsedHtml.match(
        /<span\b[^>]*data-testid="sidebar-row-hover-actions"[^>]*>[\s\S]*?<\/button>/,
      );
      expect(hoverSlotMatch).not.toBeNull();
      expect(hoverSlotMatch![0]).toContain("opacity-0");
      expect(hoverSlotMatch![0]).toContain("pointer-events-none");
      expect(hoverSlotMatch![0]).toContain("absolute");
      expect(hoverSlotMatch![0]).toContain("group-any-hover/sidebar-row:opacity-100");
      expect(hoverSlotMatch![0]).toContain("has-[:focus-visible]:opacity-100");
      expect(hoverSlotMatch![0]).toContain('data-testid="sidebar-delegated-tree-toggle"');
      expect(collapsedHtml).not.toContain('data-testid="delegated-subthread-tree"');

      const expandedHtml = wrap(
        <ul>
          <SidebarThreadRow {...sharedProps} variant={variant} delegatedTreeExpanded />
        </ul>,
        "zh",
      );
      expect(expandedHtml).toContain('aria-expanded="true"');
      expect(expandedHtml).toContain('data-testid="delegated-subthread-tree"');
      expect(expandedHtml).toContain("Variant delegated child");
    }
  });

  it("renders refined dynamic-accent full-pill toggle with rotating chevron and breathing dot across idle-collapsed, idle-expanded, and running states", () => {
    const parentId = ThreadId.make("parent-pill");
    const parentThread = makeShell({
      id: parentId,
      title: "Polish delegated pill",
      latestRunId: RunId.make("run-pill-p"),
      status: "running",
    });
    const childRunning = makeShell({
      id: ThreadId.make("child-pill-running"),
      title: "Active subagent",
      creationSource: "mcp",
      latestRunId: RunId.make("run-pill-c1"),
      status: "running",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const childDone = makeShell({
      id: ThreadId.make("child-pill-done"),
      title: "Completed subagent",
      creationSource: "mcp",
      latestRunId: RunId.make("run-pill-c2"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const childDoneSecond = makeShell({
      id: ThreadId.make("child-pill-done-2"),
      title: "Second completed subagent",
      creationSource: "mcp",
      latestRunId: RunId.make("run-pill-c3"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    const extractToggleMarkup = (html: string): string => {
      const match = html.match(
        /<button\b[^>]*data-testid="sidebar-delegated-tree-toggle"[^>]*>[\s\S]*?<\/button>/,
      );
      expect(match).not.toBeNull();
      return match![0];
    };

    const extractChevronClass = (toggleHtml: string): string => {
      const match = toggleHtml.match(
        /<svg\b[^>]*data-delegated-chevron="true"[^>]*class="([^"]*)"|<svg\b[^>]*class="([^"]*)"[^>]*data-delegated-chevron="true"/,
      );
      expect(match).not.toBeNull();
      return match![1] ?? match![2] ?? "";
    };

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
      delegatedChildren: [childDone, childRunning],
      onToggleDelegatedTree: vi.fn(),
    };

    // 1. Idle collapsed: sleek full-pill translucent surface, single non-rotated chevron, zero hardcoded info color or nested backdrop-filter
    const idleCollapsedToggle = extractToggleMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseRowProps}
            delegatedChildren={[childDone, childDoneSecond]}
            delegatedTreeExpanded={false}
            delegatedTreeHasRunning={false}
          />
        </ul>,
        "en",
      ),
    );
    expect(idleCollapsedToggle).toContain("rounded-full");
    expect(idleCollapsedToggle).toContain("h-[18px]");
    expect(idleCollapsedToggle).toContain("px-1.5");
    expect(idleCollapsedToggle).toContain("gap-1");
    expect(idleCollapsedToggle).toContain("tabular-nums");
    expect(idleCollapsedToggle).toContain("bg-sidebar-foreground/[0.06]");
    expect(idleCollapsedToggle).toContain("border-sidebar-border/55");
    expect(idleCollapsedToggle).toContain("text-sidebar-muted-foreground");
    expect(idleCollapsedToggle).toContain("[[data-pmx-glass=&#x27;1&#x27;]_&amp;]:");
    expect(idleCollapsedToggle).not.toContain("backdrop-blur");
    expect(idleCollapsedToggle).not.toContain("backdrop-filter");
    expect(idleCollapsedToggle).not.toContain("bg-info");
    expect(idleCollapsedToggle).not.toContain("data-delegated-running-dot");
    expect(idleCollapsedToggle).toContain('data-delegated-expanded="false"');
    expect(idleCollapsedToggle).toContain('data-delegated-running="0"');
    expect(idleCollapsedToggle).toContain('aria-label="Expand 2 delegated agents"');
    expect(idleCollapsedToggle).toContain('data-delegated-count="true">2<');
    const idleCollapsedChevronClass = extractChevronClass(idleCollapsedToggle);
    expect(idleCollapsedChevronClass).toContain("transition-transform");
    expect(idleCollapsedChevronClass).toContain("duration-150");
    expect(idleCollapsedChevronClass).toContain("motion-reduce:transition-none");
    expect(idleCollapsedChevronClass).not.toContain("rotate-90");

    // 2. Idle expanded: dynamic Prismux accent CSS variables + smoothly rotated 90deg chevron
    const idleExpandedToggle = extractToggleMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseRowProps}
            delegatedChildren={[childDone, childDoneSecond]}
            delegatedTreeExpanded
            delegatedTreeHasRunning={false}
          />
        </ul>,
        "en",
      ),
    );
    expect(idleExpandedToggle).toContain("var(--pmx-accent-text, var(--primary))");
    expect(idleExpandedToggle).toContain("var(--pmx-accent-soft");
    expect(idleExpandedToggle).toContain("var(--pmx-accent-border");
    expect(idleExpandedToggle).not.toContain("bg-info");
    expect(idleExpandedToggle).not.toContain("backdrop-blur");
    expect(idleExpandedToggle).not.toContain("data-delegated-running-dot");
    expect(idleExpandedToggle).toContain('data-delegated-expanded="true"');
    expect(idleExpandedToggle).toContain('aria-label="Collapse 2 delegated agents"');
    const idleExpandedChevronClass = extractChevronClass(idleExpandedToggle);
    expect(idleExpandedChevronClass).toContain("rotate-90");
    expect(idleExpandedChevronClass).toContain("motion-reduce:transition-none");

    // 3. Running expanded: dynamic accent pill + animated breathing dot with motion-reduce fallback + running count status
    const runningExpandedToggle = extractToggleMarkup(
      wrap(
        <ul>
          <SidebarThreadRow {...baseRowProps} delegatedTreeExpanded delegatedTreeHasRunning />
        </ul>,
        "en",
      ),
    );
    expect(runningExpandedToggle).toContain("var(--pmx-accent-text, var(--primary))");
    expect(runningExpandedToggle).toContain("var(--pmx-accent-soft");
    expect(runningExpandedToggle).toContain("var(--pmx-accent-border");
    expect(runningExpandedToggle).toContain('data-delegated-running-dot="true"');
    expect(runningExpandedToggle).toContain("animate-pulse");
    expect(runningExpandedToggle).toContain("motion-reduce:animate-none");
    expect(runningExpandedToggle).toContain("var(--pmx-accent, var(--primary))");
    expect(runningExpandedToggle).toContain('data-delegated-running="1"');
    expect(runningExpandedToggle).toContain('aria-label="Collapse 2 delegated agents (1 running)"');
    expect(runningExpandedToggle).not.toContain("bg-info");
    expect(extractChevronClass(runningExpandedToggle)).toContain("rotate-90");

    // 4. Running manually collapsed: retains breathing dot & running count, un-rotates chevron
    const runningCollapsedToggle = extractToggleMarkup(
      wrap(
        <ul>
          <SidebarThreadRow
            {...baseRowProps}
            delegatedTreeExpanded={false}
            delegatedTreeHasRunning
          />
        </ul>,
        "en",
      ),
    );
    expect(runningCollapsedToggle).toContain('data-delegated-running-dot="true"');
    expect(runningCollapsedToggle).toContain('aria-label="Expand 2 delegated agents (1 running)"');
    expect(extractChevronClass(runningCollapsedToggle)).not.toContain("rotate-90");
  });

  it("renders DeepSeek whale SVG (never [AR]) for local acpRegistry DSH subagents with custom display names, command paths, or opaque UUID instance IDs", () => {
    const parentId = ThreadId.make("parent-dsh");
    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, parentId));
    const localDshByModelId = ProviderInstanceId.make(
      "acpRegistry_048c43c3-0798-480e-bc42-1a2b3c4d5e6f",
    );
    const localDshByCmdId = ProviderInstanceId.make("acpRegistry_local_paid_group");
    const missingMapDshId = ProviderInstanceId.make(
      "acpRegistry_99887766-5544-3322-1100-aabbccddeeff",
    );

    const localProviderMap = new Map<string, SidebarProviderEntry>([
      [
        localDshByModelId,
        {
          instanceId: localDshByModelId,
          driverKind: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          displayName: "DS 付费组",
          models: [],
        },
      ],
      [
        localDshByCmdId,
        {
          instanceId: localDshByCmdId,
          driverKind: ProviderDriverKind.make("acpRegistry"),
          acpCommandPath: "C:\\Users\\Fish\\bin\\dsh.exe",
          enabled: true,
          displayName: "主力子代理",
          models: [],
        },
      ],
    ]);

    const childRenamedDsh = makeShell({
      id: ThreadId.make("child-dsh-renamed"),
      title: "DS 付费组子 agent",
      creationSource: "mcp",
      providerInstanceId: localDshByModelId,
      modelSelection: { instanceId: localDshByModelId, model: "DeepSeek-V4.1-Flash" },
      latestRunId: RunId.make("run-dsh-1"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const childCmdDsh = makeShell({
      id: ThreadId.make("child-dsh-cmd"),
      title: "本地 DSH 命令行代理",
      creationSource: "mcp",
      providerInstanceId: localDshByCmdId,
      modelSelection: { instanceId: localDshByCmdId, model: "custom-model" },
      latestRunId: RunId.make("run-dsh-2"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });
    const childMissingEntryDsh = makeShell({
      id: ThreadId.make("child-dsh-missing"),
      title: "未命中 Provider 表时的 DSH 子线程",
      creationSource: "mcp",
      providerInstanceId: missingMapDshId,
      modelSelection: { instanceId: missingMapDshId, model: "DeepSeek-V4.1-Flash" },
      latestRunId: RunId.make("run-dsh-3"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    const html = wrap(
      <DelegatedSubthreadTree
        parentKey={parentKey}
        childThreads={[childRenamedDsh, childCmdDsh, childMissingEntryDsh]}
        activeThreadKey={null}
        inWorkspaceCard
        providerEntryByInstanceId={localProviderMap}
        onSelectChild={vi.fn()}
        onActivateChild={vi.fn()}
        onContextMenuChild={vi.fn()}
      />,
      "zh",
    );

    expect((html.match(/data-dsh-brand-icon="true"/g) ?? []).length).toBe(3);
    expect((html.match(/data-agent-brand="dsh"/g) ?? []).length).toBe(3);
    expect(html).toContain(`viewBox="${DSH_FISH_LOGO_VIEWBOX}"`);
    expect(html).toContain(`fill="${DSH_BRAND_COLOR}"`);
    expect(html).not.toContain(">AR<");
    expect(html).not.toContain('data-agent-brand-monogram="AR"');
    expect(html).not.toContain('data-acp-brand-monogram="AR"');
  });

  it("forwards recognizable selectedModel.name when modelSlug is opaque so ProviderInstanceIcon renders DeepSeek whale SVG", () => {
    const parentId = ThreadId.make("parent-opaque-slug");
    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, parentId));
    const opaqueDshId = ProviderInstanceId.make("acpRegistry_opaque_paid_slug");
    const entry: SidebarProviderEntry = {
      instanceId: opaqueDshId,
      driverKind: ProviderDriverKind.make("acpRegistry"),
      enabled: true,
      displayName: "DS 付费组",
      models: [
        {
          slug: "paid-group",
          name: "DeepSeek V4.1 Flash",
          isCustom: false,
          capabilities: null,
        },
      ],
    };

    const pres = resolveDelegatedChildProviderPresentation({
      providerEntry: entry,
      modelInstanceId: opaqueDshId,
      modelSlug: "paid-group",
      selectedModelName: "DeepSeek V4.1 Flash",
    });
    expect(pres.brandId).toBe("dsh");
    expect(pres.model).toBe("DeepSeek V4.1 Flash");

    const opaqueChild = makeShell({
      id: ThreadId.make("child-opaque-slug"),
      title: "不透明 slug 子代理",
      creationSource: "mcp",
      providerInstanceId: opaqueDshId,
      modelSelection: { instanceId: opaqueDshId, model: "paid-group" },
      latestRunId: RunId.make("run-opaque-1"),
      status: "completed",
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
    });

    const html = wrap(
      <DelegatedSubthreadTree
        parentKey={parentKey}
        childThreads={[opaqueChild]}
        activeThreadKey={null}
        inWorkspaceCard
        providerEntryByInstanceId={new Map([[opaqueDshId, entry]])}
        onSelectChild={vi.fn()}
        onActivateChild={vi.fn()}
        onContextMenuChild={vi.fn()}
      />,
      "zh",
    );

    expect(html).toContain('data-agent-brand="dsh"');
    expect(html).toContain('data-dsh-brand-icon="true"');
    expect(html).toContain(`viewBox="${DSH_FISH_LOGO_VIEWBOX}"`);
    expect(html).toContain(`fill="${DSH_BRAND_COLOR}"`);
    expect(html).not.toContain('data-slot="acp-icon-monogram"');
    expect(html).not.toContain(">AR<");
  });

  it("renders crisp brand icons for Codex, Claude, Antigravity, Gemini, Qwen, GLM, Kimi, OpenCode, Pi, and custom fallback without [AR]", () => {
    const parentId = ThreadId.make("parent-multi");
    const parentKey = scopedThreadKey(scopeThreadRef(ENV_LOCAL, parentId));

    const claudeId = ProviderInstanceId.make("claudeAgent");
    const antigravityId = ProviderInstanceId.make("antigravity");
    const opencodeId = ProviderInstanceId.make("opencode");
    const piId = ProviderInstanceId.make("pi");
    const qwenId = ProviderInstanceId.make("acpRegistry_qwen-code");
    const glmId = ProviderInstanceId.make("acpRegistry_glm_local");
    const kimiId = ProviderInstanceId.make("acpRegistry_kimi-code");
    const customId = ProviderInstanceId.make("acpRegistry_acme");
    const missingGeminiId = ProviderInstanceId.make(
      "acpRegistry_11112222-3333-4444-5555-666677778888",
    );
    const missingCodexId = ProviderInstanceId.make(
      "acpRegistry_aaaa1111-2222-3333-4444-555566667777",
    );
    const missingClaudeId = ProviderInstanceId.make(
      "acpRegistry_bbbb1111-2222-3333-4444-555566667777",
    );

    const multiMap = new Map<string, SidebarProviderEntry>([
      [
        claudeId,
        {
          instanceId: claudeId,
          driverKind: ProviderDriverKind.make("claudeAgent"),
          enabled: true,
          displayName: "Claude Code",
          models: [],
        },
      ],
      [
        antigravityId,
        {
          instanceId: antigravityId,
          driverKind: ProviderDriverKind.make("antigravity"),
          enabled: true,
          displayName: "Antigravity",
          models: [],
        },
      ],
      [
        opencodeId,
        {
          instanceId: opencodeId,
          driverKind: ProviderDriverKind.make("opencode"),
          enabled: true,
          displayName: "OpenCode",
          models: [],
        },
      ],
      [
        piId,
        {
          instanceId: piId,
          driverKind: ProviderDriverKind.make("pi"),
          enabled: true,
          displayName: "Pi",
          models: [],
        },
      ],
      [
        qwenId,
        {
          instanceId: qwenId,
          driverKind: ProviderDriverKind.make("acpRegistry"),
          acpRegistryAgentId: "qwen-code",
          enabled: true,
          displayName: "Qwen Code",
          models: [],
        },
      ],
      [
        glmId,
        {
          instanceId: glmId,
          driverKind: ProviderDriverKind.make("acpRegistry"),
          acpCommandPath: "glm-acp-agent.cmd",
          enabled: true,
          displayName: "主力智谱",
          models: [],
        },
      ],
      [
        kimiId,
        {
          instanceId: kimiId,
          driverKind: ProviderDriverKind.make("acpRegistry"),
          acpRegistryAgentId: "kimi-code",
          enabled: true,
          displayName: "Kimi Code",
          models: [],
        },
      ],
      [
        customId,
        {
          instanceId: customId,
          driverKind: ProviderDriverKind.make("acpRegistry"),
          enabled: true,
          displayName: "Acme Bot",
          models: [],
        },
      ],
    ]);

    const makeChild = (id: string, title: string, instanceId: ProviderInstanceId, model: string) =>
      makeShell({
        id: ThreadId.make(id),
        title,
        creationSource: "mcp",
        providerInstanceId: instanceId,
        modelSelection: { instanceId, model },
        latestRunId: RunId.make(`run-${id}`),
        status: "completed",
        lineage: {
          rootThreadId: parentId,
          parentThreadId: parentId,
          relationshipToParent: "subagent",
        },
      });

    // Antigravity running a Claude model must keep Antigravity brand (model fallback must never override authoritative driver).
    const agyPres = resolveDelegatedChildProviderPresentation({
      providerEntry: multiMap.get(antigravityId) ?? null,
      modelInstanceId: antigravityId,
      modelSlug: "claude-opus-4-6",
    });
    expect(agyPres.brandId).toBe("antigravity");

    const html = wrap(
      <DelegatedSubthreadTree
        parentKey={parentKey}
        childThreads={[
          makeChild("c-claude", "Claude child", claudeId, "claude-sonnet-4-5"),
          makeChild("c-agy", "AGY child", antigravityId, "claude-opus-4-6"),
          makeChild("c-oc", "OpenCode child", opencodeId, "deepseek-v4.1"),
          makeChild("c-pi", "Pi child", piId, "gpt-5.4"),
          makeChild("c-qwen", "Qwen child", qwenId, "qwen3-coder"),
          makeChild("c-glm", "GLM child", glmId, "glm-5"),
          makeChild("c-kimi", "Kimi child", kimiId, "kimi-k2"),
          makeChild("c-gemini-fallback", "Gemini fallback", missingGeminiId, "gemini-2.5-pro"),
          makeChild("c-codex-fallback", "Codex fallback", missingCodexId, "gpt-6.2-astra"),
          makeChild("c-claude-fallback", "Claude fallback", missingClaudeId, "claude-opus-4-6"),
          makeChild("c-custom", "Acme custom", customId, "internal-model-v1"),
        ]}
        activeThreadKey={null}
        inWorkspaceCard
        providerEntryByInstanceId={multiMap}
        onSelectChild={vi.fn()}
        onActivateChild={vi.fn()}
        onContextMenuChild={vi.fn()}
      />,
      "zh",
    );

    expect(html).toContain('data-agent-brand="claude-code"');
    expect(html).toContain('data-agent-brand="antigravity"');
    expect(html).toContain("#4285F4");
    expect(html).toContain('data-agent-brand="opencode"');
    expect(html).toContain('data-agent-brand="pi"');
    expect(html).toContain('data-agent-brand="qwen"');
    expect(html).toContain(QWEN_BRAND_COLOR);
    expect(html).toContain('data-agent-brand="glm"');
    expect(html).toContain(GLM_BRAND_COLOR);
    expect(html).toContain('data-agent-brand="kimi"');
    expect(html).toContain('data-agent-brand="gemini"');
    expect(html).toContain('data-acp-brand-icon="gemini"');
    expect(html).toContain('data-agent-brand="codex"');
    expect(html).toContain('data-acp-brand-icon="codex"');
    expect(html).toContain('data-acp-brand-icon="claude"');
    expect(html).toContain('data-acp-brand-monogram="AB"');
    expect(html).not.toContain(">AR<");
    expect(html).not.toContain('data-acp-brand-monogram="AR"');
  });
});
