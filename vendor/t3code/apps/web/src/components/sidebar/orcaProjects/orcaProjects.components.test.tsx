import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { GTProvider, initializeGT } from "gt-react";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeThreadFixture } from "../../../test-fixtures";
import { SidebarProvider } from "../../ui/sidebar";
import { TooltipProvider } from "../../ui/tooltip";
import { OrcaActivityView } from "./OrcaActivityView";
import {
  OrcaAddProjectMenu,
  OrcaBrowseFolderFallbackDialog,
  OrcaCloneProjectDialog,
  OrcaCreateProjectDialog,
  type OrcaEnvironmentOption,
} from "./OrcaAddProjectMenu";
import { OrcaCreateWorkspaceDialog } from "./OrcaCreateWorkspaceDialog";
import { OrcaFilterViewMenu } from "./OrcaFilterViewMenu";
import { OrcaProjectsHeader } from "./OrcaProjectsHeader";
import {
  buildOrcaActivityItem,
  DEFAULT_ORCA_PROJECTS_PREFS,
  type OrcaActivityBadgeSummary,
  type OrcaWorkspaceAgentOption,
} from "./orcaProjects.logic";
import { getOrcaProjectsCopy } from "./orcaProjectsCopy";

initializeGT({
  defaultLocale: "en",
  locales: ["en", "zh"],
});

const LOCAL_ENV_ID = EnvironmentId.make("env-local");

function wrapWithProviders(
  node: React.ReactNode,
  options: { readonly locale?: "zh" | "en"; readonly sidebarOpen?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <GTProvider locale={options.locale ?? "zh"} translations={{}}>
      <TooltipProvider>
        <SidebarProvider defaultOpen={options.sidebarOpen ?? true}>{node}</SidebarProvider>
      </TooltipProvider>
    </GTProvider>,
  );
}

const SAMPLE_ENV: OrcaEnvironmentOption = {
  environmentId: LOCAL_ENV_ID,
  displayLabel: "本地 Windows",
  rawLabel: "Local",
  machine: "desktop",
  isPrimary: true,
  isConnected: true,
  platformOs: "win32",
  addProjectBaseDirectory: "D:\\Projects",
  newProjectsRoot: "D:\\Projects",
  ghqCloneLayout: false,
};

const SAMPLE_BADGE_IDLE: OrcaActivityBadgeSummary = {
  attentionCount: 0,
  workingCount: 0,
  unreadCount: 0,
  completedCount: 0,
  displayCount: 0,
  tone: "idle",
};

const SAMPLE_AGENT: OrcaWorkspaceAgentOption = {
  id: "claudeAgent:claude-opus-4-6",
  providerInstanceId: "claudeAgent",
  driverKind: "claudeAgent",
  model: "claude-opus-4-6",
  displayName: "Claude Code",
  modelLabel: "Claude Opus 4.6",
  online: true,
};

function makeSampleActivityItem(overrides: {
  readonly id?: string;
  readonly title?: string;
  readonly unread?: boolean;
}) {
  const base = makeThreadFixture({
    environmentId: LOCAL_ENV_ID,
    id: ThreadId.make(overrides.id ?? "thread-1"),
    projectId: ProjectId.make("proj-1"),
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-4-6",
    },
  }).source;

  const thread = presentThreadShell(LOCAL_ENV_ID, {
    ...base,
    title: overrides.title ?? "Refine Orca Projects Header",
    status: "completed",
    latestRunId: RunId.make("run-1"),
    latestRunCompletedAt: DateTime.makeUnsafe("2026-11-23T11:30:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-11-23T11:30:00.000Z"),
    lastVisitedAt: DateTime.makeUnsafe(
      overrides.unread ? "2026-11-23T10:00:00.000Z" : "2026-11-23T12:00:00.000Z",
    ),
  });

  return buildOrcaActivityItem({
    thread,
    projectName: "Prismux",
    providerLabel: "Claude Code",
    providerDriverKind: "claudeAgent",
  });
}

describe("OrcaProjectsHeader (Figures 3, 4, 5, 8)", () => {
  it("renders `∨ 项目`, default-hidden hover-revealed `↕` button, and all 4 right-side actions", () => {
    const html = wrapWithProviders(
      <OrcaProjectsHeader
        projectsOpen
        onToggleProjectsOpen={vi.fn()}
        canToggleAllProjects
        allProjectsCollapsed
        onToggleCollapseAllProjects={vi.fn()}
        activityViewActive={false}
        onToggleActivityView={vi.fn()}
        activityBadge={SAMPLE_BADGE_IDLE}
        prefs={DEFAULT_ORCA_PROJECTS_PREFS}
        onUpdatePrefs={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClearCompleted={vi.fn()}
        environments={[SAMPLE_ENV]}
        selectedAddProjectEnvId={SAMPLE_ENV.environmentId}
        onSelectAddProjectEnvId={vi.fn()}
        onBrowseFolder={vi.fn()}
        onOpenCloneDialog={vi.fn()}
        onOpenCreateProjectDialog={vi.fn()}
        onOpenCreateWorkspace={vi.fn()}
      />,
      { locale: "zh" },
    );

    // Figure 3 & 4: `∨ 项目` title & hover/focus-revealed `↕` button hidden by default
    expect(html).toContain('data-sidebar-section-header="projects"');
    expect(html).toContain("group/sidebar-header");
    expect(html).toContain(">项目<");
    expect(html).toContain('data-testid="orca-projects-collapse-all-wrap"');
    expect(html).toContain("w-0 opacity-0 pointer-events-none");
    expect(html).toContain("group-hover/sidebar-header:w-6");
    expect(html).toContain("group-hover/sidebar-header:opacity-100");
    expect(html).toContain("focus-within:w-6");
    expect(html).toContain('aria-label="展开所有项目"');

    // Figure 5: Bell + dot + numeral 0
    expect(html).toContain('data-orca-activity-bell="true"');
    expect(html).toContain('data-testid="prismux-sidebar-inbox-badge"');
    expect(html).toContain(">0<");
    expect(html).toContain('aria-pressed="false"');

    // Figures 6, 7, 8 triggers present
    expect(html).toContain('data-testid="orca-projects-filter-menu-trigger"');
    expect(html).toContain('data-testid="orca-add-project-menu-trigger"');
    expect(html).toContain('data-orca-new-workspace-trigger="true"');
    expect(html).toContain('aria-label="新工作区"');
  });

  it("renders active bell state, active filter count badge, and collapsed icon-rail variant", () => {
    const activeHtml = wrapWithProviders(
      <OrcaProjectsHeader
        projectsOpen
        onToggleProjectsOpen={vi.fn()}
        canToggleAllProjects
        allProjectsCollapsed={false}
        onToggleCollapseAllProjects={vi.fn()}
        activityViewActive
        onToggleActivityView={vi.fn()}
        activityBadge={{
          attentionCount: 2,
          workingCount: 1,
          unreadCount: 3,
          completedCount: 1,
          displayCount: 2,
          tone: "attention",
        }}
        prefs={{ ...DEFAULT_ORCA_PROJECTS_PREFS, unreadOnly: true, hideCliCreated: true }}
        onUpdatePrefs={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClearCompleted={vi.fn()}
        environments={[SAMPLE_ENV]}
        selectedAddProjectEnvId={SAMPLE_ENV.environmentId}
        onSelectAddProjectEnvId={vi.fn()}
        onBrowseFolder={vi.fn()}
        onOpenCloneDialog={vi.fn()}
        onOpenCreateProjectDialog={vi.fn()}
        onOpenCreateWorkspace={vi.fn()}
      />,
      { locale: "zh" },
    );

    expect(activeHtml).toContain('aria-label="折叠所有项目"');
    expect(activeHtml).toContain('aria-pressed="true"');
    expect(activeHtml).toContain('data-tone="attention"');
    expect(activeHtml).toContain('data-testid="orca-projects-filter-count-badge"');
    expect(activeHtml).toContain(">2<");

    // Collapsed 54px Icon-Rail mode
    const railHtml = wrapWithProviders(
      <OrcaProjectsHeader
        projectsOpen
        onToggleProjectsOpen={vi.fn()}
        canToggleAllProjects
        allProjectsCollapsed={false}
        onToggleCollapseAllProjects={vi.fn()}
        activityViewActive={false}
        onToggleActivityView={vi.fn()}
        activityBadge={SAMPLE_BADGE_IDLE}
        prefs={DEFAULT_ORCA_PROJECTS_PREFS}
        onUpdatePrefs={vi.fn()}
        onMarkAllRead={vi.fn()}
        onClearCompleted={vi.fn()}
        environments={[SAMPLE_ENV]}
        selectedAddProjectEnvId={SAMPLE_ENV.environmentId}
        onSelectAddProjectEnvId={vi.fn()}
        onBrowseFolder={vi.fn()}
        onOpenCloneDialog={vi.fn()}
        onOpenCreateProjectDialog={vi.fn()}
        onOpenCreateWorkspace={vi.fn()}
      />,
      { locale: "en", sidebarOpen: false },
    );
    expect(railHtml).toContain('data-rail-slot="true"');
    expect(railHtml).toContain('data-rail-dot="true"');
  });
});

describe("OrcaActivityView (Figure 5)", () => {
  it("renders inline filter input and exact Orca empty-state message in zh and en", () => {
    const zhEmpty = wrapWithProviders(
      <OrcaActivityView
        items={[]}
        prefs={{ ...DEFAULT_ORCA_PROJECTS_PREFS, unreadOnly: true }}
        query=""
        onQueryChange={vi.fn()}
        activeThreadKey={null}
        onSelectThread={vi.fn()}
        onMarkItemRead={vi.fn()}
        onResetFilters={vi.fn()}
      />,
      { locale: "zh" },
    );
    expect(zhEmpty).toContain('data-testid="orca-activity-search-input"');
    expect(zhEmpty).toContain('placeholder="筛选..."');
    expect(zhEmpty).toContain("没有代理活动与这些筛选条件匹配");
    expect(zhEmpty).toContain('data-testid="orca-activity-reset-filters"');

    const enNoSearch = wrapWithProviders(
      <OrcaActivityView
        items={[]}
        prefs={{ ...DEFAULT_ORCA_PROJECTS_PREFS, showSearch: false }}
        query=""
        onQueryChange={vi.fn()}
        activeThreadKey={null}
        onSelectThread={vi.fn()}
        onMarkItemRead={vi.fn()}
        onResetFilters={vi.fn()}
      />,
      { locale: "en" },
    );
    expect(enNoSearch).not.toContain('data-testid="orca-activity-search-bar"');
    expect(enNoSearch).toContain("No agent activity matches these filters.");
  });

  it("renders grouped activity items with AgentBrandLogo and toggles compact row layout", () => {
    const unreadItem = makeSampleActivityItem({
      id: "t-1",
      title: "Build Orca Filter Menu",
      unread: true,
    });
    const normalHtml = wrapWithProviders(
      <OrcaActivityView
        items={[unreadItem]}
        prefs={{ ...DEFAULT_ORCA_PROJECTS_PREFS, compactMode: false, groupBy: "status" }}
        query=""
        onQueryChange={vi.fn()}
        activeThreadKey={null}
        onSelectThread={vi.fn()}
        onMarkItemRead={vi.fn()}
        onResetFilters={vi.fn()}
      />,
      { locale: "zh" },
    );
    expect(normalHtml).toContain('data-compact="false"');
    expect(normalHtml).toContain('data-testid="orca-activity-group-status:unread"');
    expect(normalHtml).toContain("Build Orca Filter Menu");
    expect(normalHtml).toContain('data-agent-brand="claude-code"');
    expect(normalHtml).toContain("Claude Code");
    expect(normalHtml).toContain('aria-label="标记已读"');

    const compactHtml = wrapWithProviders(
      <OrcaActivityView
        items={[unreadItem]}
        prefs={{ ...DEFAULT_ORCA_PROJECTS_PREFS, compactMode: true, groupBy: "project" }}
        query=""
        onQueryChange={vi.fn()}
        activeThreadKey={null}
        onSelectThread={vi.fn()}
        onMarkItemRead={vi.fn()}
        onResetFilters={vi.fn()}
      />,
      { locale: "zh" },
    );
    expect(compactHtml).toContain('data-compact="true"');
    expect(compactHtml).not.toContain('data-agent-brand="claude-code"');
  });
});

describe("Orca overlays liquid-glass contract & dialog/menu SSR safety", () => {
  it("renders Filter/View menu, Add Project menu, and dialogs cleanly on SSR", () => {
    const html = wrapWithProviders(
      <>
        <OrcaFilterViewMenu
          prefs={DEFAULT_ORCA_PROJECTS_PREFS}
          onUpdatePrefs={vi.fn()}
          unreadCount={0}
          completedCount={0}
          onMarkAllRead={vi.fn()}
          onClearCompleted={vi.fn()}
        />
        <OrcaAddProjectMenu
          environments={[SAMPLE_ENV]}
          selectedEnvironmentId={SAMPLE_ENV.environmentId}
          onSelectEnvironmentId={vi.fn()}
          onBrowseFolder={vi.fn()}
          onOpenCloneDialog={vi.fn()}
          onOpenCreateProjectDialog={vi.fn()}
        />
        <OrcaCreateWorkspaceDialog
          open={false}
          onOpenChange={vi.fn()}
          projects={[]}
          defaultProjectKey={null}
          environments={[SAMPLE_ENV]}
          defaultEnvironmentId={SAMPLE_ENV.environmentId}
          agentOptionsByEnvironment={new Map([[SAMPLE_ENV.environmentId, [SAMPLE_AGENT]]])}
          fallbackAgentOptions={[SAMPLE_AGENT]}
          onOpenProviderSettings={vi.fn()}
          onBrowseFolder={vi.fn()}
          onOpenCloneDialog={vi.fn()}
          onOpenCreateProjectDialog={vi.fn()}
          onSubmit={vi.fn(async () => true)}
        />
        <OrcaCloneProjectDialog
          open={false}
          onOpenChange={vi.fn()}
          environment={SAMPLE_ENV}
          canPickLocalFolder
          onPickParentFolder={vi.fn(async () => null)}
          onSubmitClone={vi.fn(async () => true)}
        />
        <OrcaCreateProjectDialog
          open={false}
          onOpenChange={vi.fn()}
          environment={SAMPLE_ENV}
          canPickLocalFolder
          onPickParentFolder={vi.fn(async () => null)}
          onSubmitCreate={vi.fn(async () => true)}
        />
        <OrcaBrowseFolderFallbackDialog
          open={false}
          onOpenChange={vi.fn()}
          environment={SAMPLE_ENV}
          onSubmitFolderPath={vi.fn(async () => true)}
        />
      </>,
      { locale: "zh" },
    );

    expect(html).toContain('data-testid="orca-projects-filter-menu-trigger"');
    expect(html).toContain('data-testid="orca-add-project-menu-trigger"');
  });

  it("mounts data-pmx-glass-zone='overlays' on every Orca popup/dialog and uses exact Figure 6-9 zh/en copy", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    for (const file of [
      "OrcaFilterViewMenu.tsx",
      "OrcaAddProjectMenu.tsx",
      "OrcaCreateWorkspaceDialog.tsx",
    ]) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source, `${file} must declare liquid-glass overlay zone`).toContain(
        'data-pmx-glass-zone="overlays"',
      );
      expect(source).not.toMatch(/orca\.dev|t3\.codes|pingdotgg/i);
    }

    const zh = getOrcaProjectsCopy("zh");
    expect(zh.filtersSection).toBe("筛选");
    expect(zh.showUnreadOnly).toBe("仅显示未读");
    expect(zh.showChildAgents).toBe("显示子代理");
    expect(zh.hideAutomationCreated).toBe("隐藏自动化创建的工作区");
    expect(zh.hideCliCreated).toBe("隐藏 CLI 创建的工作区");
    expect(zh.viewSection).toBe("视图");
    expect(zh.groupAgentActivityBy).toBe("对代理活动进行分组");
    expect(zh.compactMode).toBe("紧凑模式");
    expect(zh.showSearch).toBe("显示搜索");
    expect(zh.markAllRead).toBe("标记全部已读");
    expect(zh.clearCompleted).toBe("清除已完成");
    expect(zh.addProjectTitle).toBe("添加项目");
    expect(zh.browseFolder).toBe("浏览文件夹...");
    expect(zh.cloneFromUrl).toBe("从 URL 克隆...");
    expect(zh.createNewProject).toBe("创建新项目...");
    expect(zh.createWorkspaceTitle).toBe("创建工作区");
    expect(zh.noProjectOption).toBe("无项目");
    expect(zh.runOnLabel).toBe("运行于");
    expect(zh.createMoreLabel).toBe("创建更多");
    expect(zh.createButtonLabel).toBe("创建");
  });
});
