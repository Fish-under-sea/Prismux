import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TooltipProvider } from "../ui/tooltip";
import {
  abbreviateWorkspacePath,
  extractPathBasename,
  normalizePathForComparison,
  resolveComposerBranchChipDisplay,
  resolveComposerHostDisplay,
  resolveComposerWorkspaceDisplay,
} from "./composerWorkspaceLocation.logic";
import { ComposerWorkspaceLocationBarView } from "./ComposerWorkspaceLocationBar";

const LOCAL_ENV_ID = "env-local" as EnvironmentId;
const REMOTE_ENV_ID = "env-remote" as EnvironmentId;
const PROJ_1_ID = "proj-prismux" as ProjectId;
const PROJ_SCRATCH_ID = "proj-scratch" as ProjectId;

describe("Orca-style below-composer work location & workspace bar", () => {
  it("normalizes paths, extracts basenames, and abbreviates home directories cleanly across Windows & POSIX", () => {
    expect(normalizePathForComparison("C:\\Users\\Fish\\")).toBe("c:/users/fish");
    expect(normalizePathForComparison("D:/Fish-code/AGY/Prismux/")).toBe("d:/fish-code/agy/prismux");
    expect(extractPathBasename("D:\\Fish-code\\AGY\\Prismux\\")).toBe("Prismux");
    expect(extractPathBasename("/Users/fish/code/app")).toBe("app");
    expect(extractPathBasename("D:\\")).toBe("D:\\");
    expect(extractPathBasename("~")).toBe("~");

    expect(abbreviateWorkspacePath("C:\\Users\\Fish", "C:\\Users\\Fish")).toBe("~");
    expect(abbreviateWorkspacePath("C:\\Users\\Fish\\Documents\\repo", "C:\\Users\\Fish")).toBe(
      "~/Documents/repo",
    );
    expect(abbreviateWorkspacePath("/Users/alice/projects/demo")).toBe("~/projects/demo");
    expect(abbreviateWorkspacePath("D:\\Fish-code\\AGY\\Prismux", "C:\\Users\\Fish")).toBe(
      "D:\\Fish-code\\AGY\\Prismux",
    );
  });

  it("prefers real runtime hostname (e.g. ROG-FISH) over generic local labels and lists remote environments", () => {
    const resolved = resolveComposerHostDisplay({
      activeEnvironmentId: LOCAL_ENV_ID,
      environments: [
        {
          environmentId: REMOTE_ENV_ID,
          savedLabel: "prod-gpu-01",
          runtimeLabel: "prod-gpu-01",
          isPrimary: false,
          connected: true,
          machine: "server",
          displayUrl: "https://prod-gpu-01.example.test",
        },
        {
          environmentId: LOCAL_ENV_ID,
          savedLabel: "Local environment",
          runtimeLabel: "ROG-FISH",
          isPrimary: true,
          connected: true,
          machine: "desktop",
        },
      ],
    });

    expect(resolved.environmentId).toBe(LOCAL_ENV_ID);
    expect(resolved.displayLabel).toBe("ROG-FISH");
    expect(resolved.isPrimary).toBe(true);
    expect(resolved.options.map((o) => o.label)).toEqual(["ROG-FISH", "prod-gpu-01"]);

    const remoteResolved = resolveComposerHostDisplay({
      activeEnvironmentId: REMOTE_ENV_ID,
      environments: [
        {
          environmentId: LOCAL_ENV_ID,
          savedLabel: "Local",
          runtimeLabel: "ROG-FISH",
          isPrimary: true,
          connected: true,
          machine: "desktop",
        },
        {
          environmentId: REMOTE_ENV_ID,
          savedLabel: "prod-gpu-01",
          runtimeLabel: null,
          isPrimary: false,
          connected: false,
          machine: "server",
          displayUrl: "ssh://prod-gpu-01",
        },
      ],
    });
    expect(remoteResolved.displayLabel).toBe("prod-gpu-01");
    expect(remoteResolved.tooltip).toContain("ssh://prod-gpu-01");
    expect(remoteResolved.connected).toBe(false);
  });

  it("resolves workspace display to ~ when no project or scratch root is active, and project/worktree names otherwise", () => {
    const noProject = resolveComposerWorkspaceDisplay({
      activeProject: null,
      activeWorktreePath: null,
      draftEnvMode: "local",
      isDraft: true,
      scratchWorkspaceRoot: "C:\\Users\\Fish",
      isScratch: false,
    });
    expect(noProject.displayLabel).toBe("~");
    expect(noProject.isHomeOrScratch).toBe(true);
    expect(noProject.kind).toBe("scratch");
    expect(noProject.canToggleWorktreeMode).toBe(false);

    const scratchProject = resolveComposerWorkspaceDisplay({
      activeProject: {
        id: PROJ_SCRATCH_ID,
        environmentId: LOCAL_ENV_ID,
        title: "Home",
        workspaceRoot: "C:\\Users\\Fish",
      },
      activeWorktreePath: null,
      draftEnvMode: "local",
      isDraft: true,
      scratchWorkspaceRoot: "C:\\Users\\Fish",
      isScratch: true,
    });
    expect(scratchProject.displayLabel).toBe("~");
    expect(scratchProject.isHomeOrScratch).toBe(true);

    const normalProject = resolveComposerWorkspaceDisplay({
      activeProject: {
        id: PROJ_1_ID,
        environmentId: LOCAL_ENV_ID,
        title: "Prismux",
        workspaceRoot: "D:\\Fish-code\\AGY\\Prismux",
      },
      activeWorktreePath: null,
      draftEnvMode: "local",
      isDraft: true,
      scratchWorkspaceRoot: "C:\\Users\\Fish",
      isScratch: false,
    });
    expect(normalProject.displayLabel).toBe("Prismux");
    expect(normalProject.kind).toBe("project");
    expect(normalProject.canToggleWorktreeMode).toBe(true);

    const worktree = resolveComposerWorkspaceDisplay({
      activeProject: {
        id: PROJ_1_ID,
        environmentId: LOCAL_ENV_ID,
        title: "Prismux",
        workspaceRoot: "D:\\Fish-code\\AGY\\Prismux",
      },
      activeWorktreePath: "D:\\Fish-code\\AGY\\Prismux\\.worktrees\\feat-glass",
      draftEnvMode: "worktree",
      isDraft: false,
      scratchWorkspaceRoot: "C:\\Users\\Fish",
      isScratch: false,
    });
    expect(worktree.displayLabel).toBe("feat-glass");
    expect(worktree.kind).toBe("worktree");
    expect(worktree.canToggleWorktreeMode).toBe(false);
  });

  it("renders below-composer location bar with host (ROG-FISH) and workspace (~) buttons", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });

    const host = resolveComposerHostDisplay({
      activeEnvironmentId: LOCAL_ENV_ID,
      environments: [
        {
          environmentId: LOCAL_ENV_ID,
          savedLabel: "Local environment",
          runtimeLabel: "ROG-FISH",
          isPrimary: true,
          connected: true,
          machine: "desktop",
        },
      ],
    });
    const workspace = resolveComposerWorkspaceDisplay({
      activeProject: null,
      activeWorktreePath: null,
      draftEnvMode: "local",
      isDraft: true,
      scratchWorkspaceRoot: "C:\\Users\\Fish",
      isScratch: true,
    });

    const html = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerWorkspaceLocationBarView, {
            host,
            workspace,
            projects: [
              {
                id: PROJ_1_ID,
                environmentId: LOCAL_ENV_ID,
                title: "Prismux",
                workspaceRoot: "D:\\Fish-code\\AGY\\Prismux",
              },
            ],
            scratchAvailable: true,
            canPickLocalFolder: true,
            onSelectEnvironment: () => undefined,
            onManageEnvironments: () => undefined,
            onSelectProject: () => undefined,
            onSelectScratch: () => undefined,
            onPickLocalFolder: () => undefined,
            onOpenAddProject: () => undefined,
          }),
        ),
      ),
    );

    expect(html).toContain('data-composer-location-bar="true"');
    expect(html).toContain('data-composer-work-location="true"');
    expect(html).toContain("ROG-FISH");
    expect(html).toContain('data-composer-workspace-picker="true"');
    expect(html).toContain('data-workspace-kind="scratch"');
    expect(html).toContain(">~<");
  });

  it("resolves and renders AGY 2.0 top-tray branch/checkout pill in [Workspace] -> [Branch/Checkout] -> [Host] order", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });

    // Hidden in scratch/no-project mode without Git context
    const scratchBranch = resolveComposerBranchChipDisplay({
      activeBranch: null,
      envMode: "local",
      hasWorktreePath: false,
      isHomeOrScratch: true,
      isGitRepo: false,
    });
    expect(scratchBranch.visible).toBe(false);

    // Visible in project repo with localized checkout label
    const projectBranch = resolveComposerBranchChipDisplay({
      activeBranch: "main",
      envMode: "local",
      hasWorktreePath: false,
      isHomeOrScratch: false,
      isGitRepo: true,
      labels: {
        localCheckout: "本地工作副本",
        currentWorktree: "当前工作树",
        newWorktree: "新工作树",
      },
    });
    expect(projectBranch.visible).toBe(true);
    expect(projectBranch.displayLabel).toBe("main / 本地工作副本");
    expect(projectBranch.isWorktree).toBe(false);

    const worktreeBranch = resolveComposerBranchChipDisplay({
      activeBranch: "feat/agy",
      envMode: "worktree",
      hasWorktreePath: true,
      isHomeOrScratch: false,
      isGitRepo: true,
      labels: {
        localCheckout: "本地工作副本",
        currentWorktree: "当前工作树",
        newWorktree: "新工作树",
      },
    });
    expect(worktreeBranch.visible).toBe(true);
    expect(worktreeBranch.displayLabel).toBe("feat/agy / 当前工作树");
    expect(worktreeBranch.isWorktree).toBe(true);

    const host = resolveComposerHostDisplay({
      activeEnvironmentId: LOCAL_ENV_ID,
      environments: [
        {
          environmentId: LOCAL_ENV_ID,
          savedLabel: "Local environment",
          runtimeLabel: "ROG-FISH",
          isPrimary: true,
          connected: true,
          machine: "desktop",
        },
      ],
    });
    const workspace = resolveComposerWorkspaceDisplay({
      activeProject: {
        id: PROJ_1_ID,
        environmentId: LOCAL_ENV_ID,
        title: "Prismux",
        workspaceRoot: "D:\\Fish-code\\AGY\\Prismux",
      },
      activeWorktreePath: null,
      draftEnvMode: "local",
      isDraft: true,
      scratchWorkspaceRoot: "C:\\Users\\Fish",
      isScratch: false,
    });

    const topTrayHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(
          TooltipProvider,
          null,
          createElement(ComposerWorkspaceLocationBarView, {
            variant: "top-tray",
            host,
            workspace,
            branch: projectBranch,
            branchOptions: [{ name: "main", current: true, isRemote: false }],
            canSwitchBranch: true,
            projects: [
              {
                id: PROJ_1_ID,
                environmentId: LOCAL_ENV_ID,
                title: "Prismux",
                workspaceRoot: "D:\\Fish-code\\AGY\\Prismux",
              },
            ],
            scratchAvailable: true,
            canPickLocalFolder: true,
            onSelectEnvironment: () => undefined,
            onManageEnvironments: () => undefined,
            onSelectProject: () => undefined,
            onSelectScratch: () => undefined,
            onPickLocalFolder: () => undefined,
            onOpenAddProject: () => undefined,
          }),
        ),
      ),
    );

    expect(topTrayHtml).toContain('data-composer-location-variant="top-tray"');
    expect(topTrayHtml).toContain("Prismux");
    expect(topTrayHtml).toContain("main / 本地工作副本");
    expect(topTrayHtml).toContain("ROG-FISH");
    const workspaceIdx = topTrayHtml.indexOf('data-composer-workspace-picker="true"');
    const branchIdx = topTrayHtml.indexOf('data-composer-branch-picker="true"');
    const hostIdx = topTrayHtml.indexOf('data-composer-work-location="true"');
    expect(workspaceIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeGreaterThan(workspaceIdx);
    expect(hostIdx).toBeGreaterThan(branchIdx);
  });
});
