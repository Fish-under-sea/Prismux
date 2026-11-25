import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
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
import { SidebarHostGroupCapsule } from "./SidebarHostGroupCapsule";
import { SidebarThreadRow, type SidebarProviderEntry } from "./SidebarThreadRow";
import { SidebarWorkspaceCard } from "./SidebarWorkspaceCard";
import {
  dispatchSidebarSplitDragEvent,
  groupProjectFoldersByHost,
  groupProjectThreadsByWorkspace,
  PRISMUX_SPLIT_DRAG_EVENT,
  PRISMUX_SPLIT_ITEM_MIME,
  resolveSidebarModelShortName,
  type PrismuxSplitDragEventDetail,
  type SidebarHostDescriptor,
  type SidebarThreadSplitDragPayload,
} from "./sidebarWorkspaceGrouping";

initializeGT({
  defaultLocale: "en",
  locales: ["en", "zh"],
});

const LOCAL_ENV = EnvironmentId.make("env-local");
const REMOTE_ENV = EnvironmentId.make("env-mac-mini");

function makeShell(overrides: Partial<OrchestrationV2ThreadShell> = {}, envId = LOCAL_ENV) {
  const base = makeThreadFixture({
    environmentId: envId,
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-5-5",
    },
  }).source;
  return presentThreadShell(envId, {
    ...base,
    title: "Tighten address validation",
    branch: "feature/checkout-flow-v2",
    worktreePath: null,
    createdAt: DateTime.makeUnsafe("2026-11-24T10:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-24T11:00:00.000Z"),
    lastVisitedAt: DateTime.makeUnsafe("2026-11-24T11:05:00.000Z"),
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

describe("Orca Compact Sidebar workspace & host grouping", () => {
  it("groups project threads by (worktreePath ?? '__primary__', branch ?? '') with primary checkout first and selected workspace highlighted", () => {
    const worktreeNewest = makeShell({
      id: ThreadId.make("t-wt-1"),
      title: "Fix ACME-412: EU promo",
      worktreePath: "/worktrees/eu-promo-checkout",
      branch: "fix/eu-promo-checkout",
      updatedAt: DateTime.makeUnsafe("2026-11-24T12:00:00.000Z"),
      latestRunId: RunId.make("run-1"),
      status: "completed",
    });
    const worktreeSibling = makeShell({
      id: ThreadId.make("t-wt-2"),
      title: "tax-rules",
      worktreePath: "/worktrees/eu-promo-checkout",
      branch: "fix/eu-promo-checkout",
      updatedAt: DateTime.makeUnsafe("2026-11-24T11:55:00.000Z"),
      latestRunId: RunId.make("run-2"),
      status: "completed",
    });
    const primaryWorking = makeShell({
      id: ThreadId.make("t-primary-1"),
      title: "Tighten address validation",
      worktreePath: null,
      branch: "feature/checkout-flow-v2",
      updatedAt: DateTime.makeUnsafe("2026-11-24T10:30:00.000Z"),
      latestRunId: RunId.make("run-3"),
      status: "running",
    });

    const workspaces = groupProjectThreadsByWorkspace(
      [worktreeNewest, worktreeSibling, primaryWorking],
      {
        projectDisplayName: "acme-web",
        activeThreadKey: `${LOCAL_ENV}:t-wt-2`,
      },
    );

    expect(workspaces).toHaveLength(2);
    // Primary checkout sorts first even when a worktree has newer activity.
    expect(workspaces[0]!.isPrimary).toBe(true);
    expect(workspaces[0]!.title).toBe("checkout-flow-v2");
    expect(workspaces[0]!.branch).toBe("feature/checkout-flow-v2");
    expect(workspaces[0]!.status).toBe("working");
    expect(workspaces[0]!.isSelected).toBe(false);
    expect(workspaces[0]!.threads.map((t) => t.id)).toEqual(["t-primary-1"]);

    // Selected worktree groups both threads together and marks isSelected=true.
    expect(workspaces[1]!.isPrimary).toBe(false);
    expect(workspaces[1]!.title).toBe("eu-promo-checkout");
    expect(workspaces[1]!.branch).toBe("fix/eu-promo-checkout");
    expect(workspaces[1]!.status).toBe("ready");
    expect(workspaces[1]!.isSelected).toBe(true);
    expect(workspaces[1]!.threads.map((t) => t.id)).toEqual(["t-wt-1", "t-wt-2"]);
  });

  it("groups project folders by host environmentId and sums workspace counts accurately", () => {
    const localThread = makeShell({
      id: ThreadId.make("t-local"),
      branch: "main",
      worktreePath: null,
    });
    const remoteWt1 = makeShell(
      {
        id: ThreadId.make("t-r1"),
        branch: "fix/a",
        worktreePath: "/wt/a",
      },
      REMOTE_ENV,
    );
    const remoteWt2 = makeShell(
      {
        id: ThreadId.make("t-r2"),
        branch: "fix/b",
        worktreePath: "/wt/b",
      },
      REMOTE_ENV,
    );
    const remoteHidden = makeShell(
      {
        id: ThreadId.make("t-r3"),
        branch: "fix/c",
        worktreePath: "/wt/c",
      },
      REMOTE_ENV,
    );

    const hosts: SidebarHostDescriptor[] = [
      {
        environmentId: LOCAL_ENV,
        label: "Local Windows",
        hostname: "ROG-FISH",
        machine: "desktop",
        isPrimary: true,
        isConnected: true,
      },
      {
        environmentId: REMOTE_ENV,
        label: "mac-mini",
        hostname: "mac-mini.local",
        machine: "server",
        isPrimary: false,
        isConnected: true,
      },
    ];

    const grouped = groupProjectFoldersByHost({
      folders: [
        {
          group: {
            environmentId: REMOTE_ENV,
            projectKey: "remote:acme-internal",
            displayName: "acme-internal",
          },
          threads: [remoteWt1, remoteWt2],
          hiddenThreads: [remoteHidden],
        },
        {
          group: {
            environmentId: LOCAL_ENV,
            projectKey: "local:acme-web",
            displayName: "acme-web",
          },
          threads: [localThread],
        },
      ],
      hosts,
      activeThreadKey: null,
    });

    expect(grouped.map((g) => g.environmentId)).toEqual([LOCAL_ENV, REMOTE_ENV]);
    expect(grouped[0]!.label).toBe("Local Windows");
    expect(grouped[0]!.hostname).toBe("ROG-FISH");
    expect(grouped[0]!.workspaceCount).toBe(1);
    expect(grouped[1]!.label).toBe("mac-mini");
    expect(grouped[1]!.hostname).toBe("mac-mini.local");
    expect(grouped[1]!.workspaceCount).toBe(3);
  });

  it("normalizes model short names cleanly and never leaks raw lowercase slugs", () => {
    expect(resolveSidebarModelShortName({ modelSlug: "gpt-6.2-astra" })).toBe("6.2 Astra");
    expect(resolveSidebarModelShortName({ modelSlug: "gpt-6-astra" })).toBe("6 Astra");
    expect(
      resolveSidebarModelShortName({ modelSlug: "dragonapi/gpt-promax/gpt-6.2-astra" }),
    ).toBe("6.2 Astra");
    expect(resolveSidebarModelShortName({ modelSlug: "claude-fable-5-2" })).toBe("Fable 5.2");
    expect(resolveSidebarModelShortName({ modelSlug: "fable-5.2" })).toBe("Fable 5.2");
    expect(resolveSidebarModelShortName({ modelSlug: "claude-opus-5-5" })).toBe("Opus 5.5");
    expect(resolveSidebarModelShortName({ modelSlug: "opus-5.5" })).toBe("Opus 5.5");
    expect(resolveSidebarModelShortName({ modelSlug: "gemini-4-neon" })).toBe("4 Neon");
    expect(resolveSidebarModelShortName({ modelSlug: "gemini 4 neon" })).toBe("4 Neon");
    expect(resolveSidebarModelShortName({ modelSlug: "grok-4.7" })).toBe("Grok 4.7");
  });
});

describe("Orca Compact Sidebar UI components & Split Anything HTML5 drag bridge", () => {
  it("renders SidebarHostGroupCapsule with host name, dimmed hostname, and count pill", () => {
    const html = wrap(
      <ul>
        <SidebarHostGroupCapsule
          environmentId={REMOTE_ENV}
          label="mac-mini"
          hostname="mac-mini.local"
          machine="server"
          workspaceCount={3}
          onToggle={vi.fn()}
        />
      </ul>,
      "zh",
    );
    expect(html).toContain(`data-testid="sidebar-host-group-${REMOTE_ENV}"`);
    expect(html).toContain(">mac-mini<");
    expect(html).toContain(">mac-mini.local<");
    expect(html).toContain('data-testid="sidebar-host-count"');
    expect(html).toContain(">3<");
  });

  it("renders selected vs unselected SidebarWorkspaceCard with localized primary pill, branch sub-row, and trailing doc icon", () => {
    const selectedZh = wrap(
      <ul>
        <SidebarWorkspaceCard
          workspace={{
            workspaceKey: "__primary__\0feature/checkout-flow-v2",
            title: "checkout-flow-v2",
            branch: "feature/checkout-flow-v2",
            isPrimary: true,
            isSelected: true,
            status: "working",
          }}
          onActivateWorkspace={vi.fn()}
          onOpenWorkspaceFiles={vi.fn()}
        >
          <li>child</li>
        </SidebarWorkspaceCard>
      </ul>,
      "zh",
    );
    expect(selectedZh).toContain('data-workspace-selected="true"');
    expect(selectedZh).toContain('data-workspace-primary="true"');
    expect(selectedZh).toContain("border-sidebar-border/80 bg-sidebar-row-active/45");
    expect(selectedZh).toContain(">主工作区<");
    expect(selectedZh).toContain(">feature/checkout-flow-v2<");
    expect(selectedZh).toContain('data-workspace-status="working"');
    expect(selectedZh).toContain('data-testid="sidebar-workspace-doc-button"');

    const unselectedEn = wrap(
      <ul>
        <SidebarWorkspaceCard
          workspace={{
            workspaceKey: "/wt/eu\0fix/eu-promo-checkout",
            title: "eu-promo-checkout",
            branch: "fix/eu-promo-checkout",
            isPrimary: false,
            isSelected: false,
            status: "ready",
          }}
        >
          <li>child</li>
        </SidebarWorkspaceCard>
      </ul>,
      "en",
    );
    expect(unselectedEn).toContain('data-workspace-selected="false"');
    expect(unselectedEn).toContain("border-transparent");
    expect(unselectedEn).not.toContain('data-testid="sidebar-workspace-primary-pill"');
    expect(unselectedEn).toContain('data-workspace-status="ready"');
  });

  it("renders SidebarThreadRow variant='orca-compact' as a 25px draggable dense row with normalized model short name", () => {
    const codexId = ProviderInstanceId.make("codex");
    const thread = makeShell({
      id: ThreadId.make("t-compact-1"),
      projectId: ProjectId.make("proj-1"),
      title: "Drafting handoff summary",
      providerInstanceId: codexId,
      modelSelection: {
        instanceId: codexId,
        model: "dragonapi/gpt-promax/gpt-6.2-astra",
      },
      latestRunId: RunId.make("run-9"),
      status: "completed",
    });
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
    ]);

    const html = wrap(
      <ul>
        <SidebarThreadRow
          thread={thread}
          variant="orca-compact"
          inWorkspaceCard
          variantAction="settle"
          settlementSupported
          snoozeSupported
          pinningSupported
          isPinned={false}
          dropVerb={null}
          dragOverPinned={false}
          sweepAction={null}
          snoozeWakeLabelText={null}
          wokeAt={null}
          isActive
          isRouteThread
          readOpensPullRequestsInRightPanel={() => true}
          jumpLabel={null}
          environmentLabel="Local"
          environmentMachine="desktop"
          project={null}
          projectDisplayName="Prismux"
          providerEntryByInstanceId={providerMap}
          timestampFormat="24-hour"
          onThreadClick={vi.fn()}
          onThreadActivate={vi.fn()}
          onStartRename={vi.fn()}
          onRenameTitleChange={vi.fn()}
          onCommitRename={vi.fn()}
          onCancelRename={vi.fn()}
          isRenaming={false}
          renamingTitle=""
          onContextMenu={vi.fn()}
          onSettle={vi.fn()}
          onActionSweepStart={vi.fn()}
          onUnsettle={vi.fn()}
          onSnooze={vi.fn()}
          onUnsnooze={vi.fn()}
          onUnpin={vi.fn()}
          onAcknowledgeWoke={vi.fn()}
        />
      </ul>,
      "zh",
    );

    expect(html).toContain('data-testid="sidebar-row-orca-compact"');
    expect(html).toContain("h-[25px]");
    expect(html).toContain('draggable="true"');
    expect(html).toContain('data-split-draggable="true"');
    expect(html).toContain("Drafting handoff summary");
    expect(html).toContain('data-testid="sidebar-row-model-name"');
    expect(html).toContain(">6.2 Astra<");
    expect(html).not.toContain("gpt-6.2-astra");
    expect(html).toContain('data-testid="sidebar-row-relative-time"');
  });

  it("emits prismux:split-drag CustomEvent on dragstart and clears on dragend with canonical SplitDragPayload", () => {
    const dispatched: CustomEvent<PrismuxSplitDragEventDetail>[] = [];
    const prevWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      dispatchEvent: (event: Event) => {
        dispatched.push(event as CustomEvent<PrismuxSplitDragEventDetail>);
        return true;
      },
    };
    try {
      expect(PRISMUX_SPLIT_ITEM_MIME).toBe("application/x-prismux-split-item");
      expect(PRISMUX_SPLIT_DRAG_EVENT).toBe("prismux:split-drag");

      const payload: SidebarThreadSplitDragPayload = {
        kind: "sidebar-thread",
        environmentId: LOCAL_ENV,
        threadId: ThreadId.make("t-1"),
        title: "Refactor split tree",
        providerId: "claudeAgent",
        instanceId: ProviderInstanceId.make("claudeAgent"),
      };
      dispatchSidebarSplitDragEvent(true, payload);
      dispatchSidebarSplitDragEvent(false, null);

      expect(dispatched).toHaveLength(2);
      expect(dispatched[0]!.type).toBe("prismux:split-drag");
      expect(dispatched[0]!.detail).toEqual({ active: true, payload });
      expect(dispatched[1]!.type).toBe("prismux:split-drag");
      expect(dispatched[1]!.detail).toEqual({ active: false, payload: null });
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  });
});
