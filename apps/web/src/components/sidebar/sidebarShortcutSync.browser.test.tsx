import { EnvironmentId, type ResolvedKeybindingsConfig } from "@prismux/core-contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
  mergeWithDefaultKeybindings,
} from "@prismux/core-shared/keybindings";
import type { Atom } from "effect/reactivity";
import { GTProvider } from "gt-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AppAtomRegistryProvider, appAtomRegistry } from "../../rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { SidebarProvider } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import { PrismuxSidebarQuickNav } from "./PrismuxSidebarQuickNav";
import { OrcaProjectsHeader } from "./orcaProjects/OrcaProjectsHeader";
import {
  DEFAULT_ORCA_PROJECTS_PREFS,
  type OrcaActivityBadgeSummary,
} from "./orcaProjects/orcaProjects.logic";
import type { OrcaEnvironmentOption } from "./orcaProjects/OrcaAddProjectMenu";

vi.mock(import("../../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { DEFAULT_RESOLVED_KEYBINDINGS } = await import("@prismux/core-shared/keybindings");
  return {
    ...actual,
    primaryServerKeybindingsAtom: Atom.make(DEFAULT_RESOLVED_KEYBINDINGS),
  };
});

function setTestKeybindings(keybindings: ResolvedKeybindingsConfig): void {
  appAtomRegistry.set(
    primaryServerKeybindingsAtom as unknown as Atom.Writable<ResolvedKeybindingsConfig>,
    keybindings,
  );
}

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useLocation: (() => "/") as never,
  useNavigate: (() => vi.fn()) as never,
}));

const SAMPLE_ENV: OrcaEnvironmentOption = {
  environmentId: EnvironmentId.make("env-local"),
  displayLabel: "Local Windows",
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

describe("Sidebar shortcut label synchronization", () => {
  it("syncs PrismuxSidebarQuickNav commandPalette.toggle badge and hides it when unassigned", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    setTestKeybindings(DEFAULT_RESOLVED_KEYBINDINGS);

    await using screen = await render(
      <AppAtomRegistryProvider>
        <GTProvider locale="en" translations={{}}>
          <TooltipProvider delay={0}>
            <SidebarProvider defaultOpen>
              <PrismuxSidebarQuickNav routeThreadRef={null} showSearch />
            </SidebarProvider>
          </TooltipProvider>
        </GTProvider>
      </AppAtomRegistryProvider>,
    );

    const searchBtn = screen.getByTestId("prismux-sidebar-search-button");
    await expect.element(searchBtn).toContainHTML("Ctrl+K");

    setTestKeybindings(
      mergeWithDefaultKeybindings(
        compileResolvedKeybindingsConfig([
          { key: "alt+p", command: "commandPalette.toggle", when: "!terminalFocus" },
        ]),
      ),
    );
    await vi.waitFor(() => expect(searchBtn.element().textContent).toContain("Alt+P"));
    expect(searchBtn.element().textContent).not.toContain("Ctrl+K");

    // Unassigning hides the <Kbd> badge completely instead of falling back to hardcoded Ctrl+K.
    setTestKeybindings(
      mergeWithDefaultKeybindings(
        compileResolvedKeybindingsConfig([
          { key: "mod+k", command: "commandPalette.toggle", when: "false" },
        ]),
      ),
    );
    await vi.waitFor(() => expect(searchBtn.element().querySelector("kbd")).toBeNull());
    expect(searchBtn.element().textContent).not.toContain("Ctrl+K");
    expect(searchBtn.element().textContent).not.toContain("⌘K");
  });

  it("syncs OrcaProjectsHeader collapse-all and new-workspace tooltip badges with live keybindings", async () => {
    using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    setTestKeybindings(
      mergeWithDefaultKeybindings(
        compileResolvedKeybindingsConfig([
          { key: "alt+c", command: "sidebar.collapseAllProjects", when: "!terminalFocus" },
          { key: "alt+w", command: "chat.new", when: "!terminalFocus" },
        ]),
      ),
    );

    await using screen = await render(
      <AppAtomRegistryProvider>
        <GTProvider locale="en" translations={{}}>
          <TooltipProvider delay={0}>
            <SidebarProvider defaultOpen>
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
              />
            </SidebarProvider>
          </TooltipProvider>
        </GTProvider>
      </AppAtomRegistryProvider>,
    );

    const newWorkspaceBtn = screen.getByTestId("prismux-sidebar-new-thread");
    await userEvent.hover(newWorkspaceBtn);
    await expect.element(page.getByText("Alt+W")).toBeVisible();
    await userEvent.unhover(newWorkspaceBtn);

    const collapseAllBtn = screen.getByTestId("orca-projects-collapse-all");
    (collapseAllBtn.element() as HTMLElement).focus();
    await expect.element(page.getByText("Alt+C")).toBeVisible();

    // Unassigning removes the <Kbd> badge from the tooltip.
    setTestKeybindings(
      mergeWithDefaultKeybindings(
        compileResolvedKeybindingsConfig([
          { key: "mod+shift+h", command: "sidebar.collapseAllProjects", when: "false" },
          { key: "mod+n", command: "chat.new", when: "false" },
          { key: "mod+shift+o", command: "chat.new", when: "false" },
        ]),
      ),
    );
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Alt+C"));
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("Ctrl+Shift+H"));
  });
});
