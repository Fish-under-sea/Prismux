import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
  isScratchProject,
} from "@t3tools/client-runtime/state/projects";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { msg, T, useGT, useMessages } from "gt-react";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  MessageSquareDashedIcon,
  ServerIcon,
  SettingsIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import {
  composerDraftHasUserContent,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadRouteTarget } from "~/hooks/useThreadRouteTarget";
import { seedDraftModelSelection } from "~/lib/seedDraftModelSelection";
import { cn, newProjectId } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { useProjects, useQuietThreadShell } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { chatGitStatusAtom, NO_CHAT_GIT_STATUS_ATOM, vcsEnvironment } from "~/state/vcs";
import type { EnvMode } from "../BranchToolbar.logic";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  abbreviateWorkspacePath,
  resolveComposerBranchChipDisplay,
  resolveComposerHostDisplay,
  resolveComposerWorkspaceDisplay,
  type ComposerBranchOption,
  type ComposerLocationProjectInput,
  type ResolvedComposerBranchChipDisplay,
  type ResolvedComposerHostDisplay,
  type ResolvedComposerWorkspaceDisplay,
} from "./composerWorkspaceLocation.logic";

export type ComposerLocationBarVariant = "top-tray" | "below";

const FOOTER_META_BUTTON_CLASS =
  "inline-flex h-6 min-w-0 max-w-44 shrink cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-normal text-foreground/82 transition-colors outline-none hover:bg-accent/70 hover:text-foreground focus-visible:ring-1 focus-visible:ring-foreground/25 dark:text-foreground/78 dark:hover:bg-white/10 dark:hover:text-foreground [[data-pmx-wallpaper='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.28)] [[data-pmx-wallpaper-visible='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.28)] [[data-pmx-glass='1']_&]:[text-shadow:0_1px_2px_rgba(0,0,0,0.22)]";

const TOP_TRAY_PILL_BUTTON_CLASS =
  "inline-flex h-6 min-w-0 max-w-52 shrink cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-foreground/86 transition-colors outline-none hover:bg-foreground/[0.06] hover:text-foreground data-popup-open:bg-foreground/[0.08] data-popup-open:text-foreground focus-visible:ring-1 focus-visible:ring-foreground/25 dark:text-foreground/84 dark:hover:bg-white/10 dark:data-popup-open:bg-white/12 dark:hover:text-foreground";

export interface ComposerWorkspaceLocationBarViewProps {
  readonly variant?: ComposerLocationBarVariant | undefined;
  readonly host: ResolvedComposerHostDisplay;
  readonly workspace: ResolvedComposerWorkspaceDisplay;
  readonly branch?: ResolvedComposerBranchChipDisplay | null | undefined;
  readonly branchOptions?: readonly ComposerBranchOption[] | undefined;
  readonly isLoadingBranches?: boolean | undefined;
  readonly canSwitchBranch?: boolean | undefined;
  readonly projects: readonly ComposerLocationProjectInput[];
  readonly scratchAvailable: boolean;
  readonly canPickLocalFolder: boolean;
  readonly isPickingFolder?: boolean;
  readonly className?: string | undefined;
  readonly onSelectEnvironment: (environmentId: EnvironmentId) => void;
  readonly onManageEnvironments: () => void;
  readonly onSelectProject: (project: ComposerLocationProjectInput) => void;
  readonly onSelectScratch: () => void;
  readonly onChangeEnvMode?: ((mode: EnvMode) => void) | undefined;
  readonly onBranchMenuOpenChange?: ((open: boolean) => void) | undefined;
  readonly onSelectBranch?: ((branchName: string) => void) | undefined;
  readonly onCopyBranchName?: (() => void) | undefined;
  readonly onPickLocalFolder: () => void;
  readonly onOpenAddProject: () => void;
  readonly onCopyWorkspacePath?: (() => void) | undefined;
}

export function ComposerWorkspaceLocationBarView(props: ComposerWorkspaceLocationBarViewProps) {
  const gt = useGT();
  const {
    variant = "top-tray",
    host,
    workspace,
    branch = null,
    branchOptions = [],
    isLoadingBranches = false,
    canSwitchBranch = false,
    projects,
    scratchAvailable,
    canPickLocalFolder,
    isPickingFolder = false,
    className,
    onSelectEnvironment,
    onManageEnvironments,
    onSelectProject,
    onSelectScratch,
    onChangeEnvMode,
    onBranchMenuOpenChange,
    onSelectBranch,
    onCopyBranchName,
    onPickLocalFolder,
    onOpenAddProject,
    onCopyWorkspacePath,
  } = props;

  const isTopTray = variant === "top-tray";
  const buttonClassName = isTopTray ? TOP_TRAY_PILL_BUTTON_CLASS : FOOTER_META_BUTTON_CLASS;

  const WorkspaceIcon =
    workspace.kind === "worktree" || workspace.kind === "new-worktree"
      ? FolderGit2Icon
      : FolderIcon;

  const hostLabelById = new Map(host.options.map((env) => [env.environmentId, env.label] as const));
  const multiEnvironment = host.options.length > 1;

  const hostMenuNode = (
    <Menu key="host">
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  data-composer-work-location="true"
                  data-environment-id={host.environmentId ?? ""}
                  aria-label={gt("Run on") + `: ${host.displayLabel}`}
                  className={buttonClassName}
                />
              }
            />
          }
        >
          <ServerIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-75" />
          <span className="min-w-0 truncate">{host.displayLabel}</span>
          {isTopTray ? (
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-55" />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup data-pmx-glass-zone="overlays" side="top" align="start">
          {host.tooltip}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup
        data-pmx-glass-zone="overlays"
        data-composer-location-menu="true"
        side="top"
        align="start"
        sideOffset={6}
        className="min-w-52 max-w-72"
      >
        <MenuGroup>
          <MenuGroupLabel>
            <T>Run on</T>
          </MenuGroupLabel>
          {host.options.length > 0 ? (
            <MenuRadioGroup
              value={host.environmentId ?? ""}
              onValueChange={(value) => {
                if (value && value !== host.environmentId) {
                  onSelectEnvironment(value as EnvironmentId);
                }
              }}
            >
              {host.options.map((env) => (
                <MenuRadioItem
                  key={env.environmentId}
                  value={env.environmentId}
                  closeOnClick
                  data-location-env-option={env.environmentId}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <EnvironmentMachineIcon kind={env.machine} className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{env.label}</span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        env.connected ? "bg-emerald-500" : "bg-muted-foreground/40",
                      )}
                    />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          ) : (
            <MenuItem disabled>
              <ServerIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{host.displayLabel}</span>
            </MenuItem>
          )}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem data-location-manage-environments="true" onClick={onManageEnvironments}>
          <SettingsIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{gt("Environments")}</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );

  const workspaceMenuNode = (
    <Menu key="workspace">
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  data-composer-workspace-picker="true"
                  data-workspace-kind={workspace.kind}
                  aria-label={gt("Workspace") + `: ${workspace.displayLabel}`}
                  className={buttonClassName}
                />
              }
            />
          }
        >
          <WorkspaceIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-75" />
          <span className="min-w-0 truncate">{workspace.displayLabel}</span>
          {isTopTray ? (
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-55" />
          ) : null}
        </TooltipTrigger>
        <TooltipPopup
          data-pmx-glass-zone="overlays"
          side="top"
          align="start"
          className="max-w-80 break-all"
        >
          {workspace.isHomeOrScratch
            ? `${workspace.fullPath} (${gt("No project")})`
            : workspace.fullPath}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup
        data-pmx-glass-zone="overlays"
        data-composer-workspace-menu="true"
        side="top"
        align="start"
        sideOffset={6}
        className="min-w-60 max-w-80"
      >
        {workspace.canToggleWorktreeMode && onChangeEnvMode ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>
                <T>Workspace</T>
              </MenuGroupLabel>
              <MenuRadioGroup
                value={workspace.envMode}
                onValueChange={(value) => {
                  if (value === "local" || value === "worktree") {
                    onChangeEnvMode(value);
                  }
                }}
              >
                <MenuRadioItem value="local" closeOnClick data-workspace-mode-option="local">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{gt("Current checkout")}</span>
                  </span>
                </MenuRadioItem>
                <MenuRadioItem value="worktree" closeOnClick data-workspace-mode-option="worktree">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <FolderGit2Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{gt("New worktree")}</span>
                  </span>
                </MenuRadioItem>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
          </>
        ) : null}

        <MenuGroup>
          <MenuGroupLabel>
            <T>Projects</T>
          </MenuGroupLabel>
          <div className="max-h-56 overflow-y-auto">
            {projects.map((project) => {
              const isActive =
                !workspace.isHomeOrScratch &&
                workspace.projectId === project.id &&
                workspace.environmentId === project.environmentId;
              const envSuffix = multiEnvironment ? hostLabelById.get(project.environmentId) : null;
              return (
                <MenuItem
                  key={`${project.environmentId}:${project.id}`}
                  data-workspace-project-option={project.id}
                  onClick={() => onSelectProject(project)}
                >
                  <FolderIcon className="size-3.5 shrink-0 opacity-80" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs font-medium text-foreground">
                      {project.title}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {envSuffix
                        ? `${envSuffix} · ${abbreviateWorkspacePath(project.workspaceRoot)}`
                        : abbreviateWorkspacePath(project.workspaceRoot)}
                    </span>
                  </span>
                  {isActive ? (
                    <CheckIcon className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                  ) : null}
                </MenuItem>
              );
            })}

            {scratchAvailable ? (
              <MenuItem data-workspace-scratch-option="true" onClick={onSelectScratch}>
                <MessageSquareDashedIcon
                  className="size-3.5 shrink-0 opacity-80"
                  aria-hidden="true"
                />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate">{gt("No project")}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">~</span>
                </span>
                {workspace.isHomeOrScratch ? (
                  <CheckIcon className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                ) : null}
              </MenuItem>
            ) : null}
          </div>
        </MenuGroup>

        <MenuSeparator />

        {canPickLocalFolder ? (
          <MenuItem
            data-workspace-pick-folder="true"
            disabled={isPickingFolder}
            onClick={onPickLocalFolder}
          >
            <FolderOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{gt("Local folder")}</span>
          </MenuItem>
        ) : null}

        <MenuItem data-workspace-add-project="true" onClick={onOpenAddProject}>
          <FolderPlusIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{gt("Add project")}</span>
        </MenuItem>

        {onCopyWorkspacePath && workspace.fullPath && workspace.fullPath !== "~" ? (
          <MenuItem data-workspace-copy-path="true" onClick={onCopyWorkspacePath}>
            <CopyIcon className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{gt("Copy full path")}</span>
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );

  const branchMenuNode =
    isTopTray && branch?.visible ? (
      <Menu key="branch" onOpenChange={onBranchMenuOpenChange}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <button
                    type="button"
                    data-composer-branch-picker="true"
                    data-branch-name={branch.branchName ?? ""}
                    data-checkout-mode={branch.envMode}
                    aria-label={gt("Branch") + `: ${branch.displayLabel}`}
                    className={cn(TOP_TRAY_PILL_BUTTON_CLASS, "max-w-60")}
                  />
                }
              />
            }
          >
            <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-75" />
            <span className="min-w-0 truncate">{branch.displayLabel}</span>
            <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-55" />
          </TooltipTrigger>
          <TooltipPopup data-pmx-glass-zone="overlays" side="top" align="start">
            {branch.tooltip}
          </TooltipPopup>
        </Tooltip>
        <MenuPopup
          data-pmx-glass-zone="overlays"
          data-composer-branch-menu="true"
          side="top"
          align="start"
          sideOffset={6}
          className="min-w-56 max-w-80"
        >
          {workspace.canToggleWorktreeMode && onChangeEnvMode ? (
            <>
              <MenuGroup>
                <MenuGroupLabel>
                  <T>Workspace</T>
                </MenuGroupLabel>
                <MenuRadioGroup
                  value={workspace.envMode}
                  onValueChange={(value) => {
                    if (value === "local" || value === "worktree") {
                      onChangeEnvMode(value);
                    }
                  }}
                >
                  <MenuRadioItem value="local" closeOnClick data-branch-mode-option="local">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{gt("Local checkout")}</span>
                    </span>
                  </MenuRadioItem>
                  <MenuRadioItem value="worktree" closeOnClick data-branch-mode-option="worktree">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FolderGit2Icon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{gt("New worktree")}</span>
                    </span>
                  </MenuRadioItem>
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
            </>
          ) : null}

          <MenuGroup>
            <MenuGroupLabel>
              <T>Switch branch</T>
            </MenuGroupLabel>
            <div className="max-h-56 overflow-y-auto">
              {isLoadingBranches ? (
                <MenuItem disabled>
                  <span className="text-xs text-muted-foreground">{gt("Loading")}</span>
                </MenuItem>
              ) : branchOptions.length > 0 ? (
                branchOptions.map((option) => {
                  const isActive =
                    option.name === branch.branchName || (branch.branchName === null && option.current);
                  return (
                    <MenuItem
                      key={option.name}
                      data-branch-option={option.name}
                      disabled={!canSwitchBranch}
                      onClick={() => onSelectBranch?.(option.name)}
                    >
                      <GitBranchIcon className="size-3.5 shrink-0 opacity-75" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {option.name}
                      </span>
                      {isActive ? (
                        <CheckIcon className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                      ) : null}
                    </MenuItem>
                  );
                })
              ) : branch.branchName ? (
                <MenuItem disabled>
                  <GitBranchIcon className="size-3.5 shrink-0 opacity-75" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {branch.branchName}
                  </span>
                  <CheckIcon className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />
                </MenuItem>
              ) : null}
            </div>
          </MenuGroup>

          {branch.branchName && onCopyBranchName ? (
            <>
              <MenuSeparator />
              <MenuItem data-branch-copy-name="true" onClick={onCopyBranchName}>
                <CopyIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{gt("Copy branch name")}</span>
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    ) : null;

  return (
    <div
      data-composer-location-bar="true"
      data-composer-location-variant={variant}
      className={cn(
        "flex min-w-0 shrink items-center",
        isTopTray ? "gap-1" : "gap-1",
        className,
      )}
    >
      {isTopTray ? (
        <>
          {workspaceMenuNode}
          {branchMenuNode}
          {hostMenuNode}
        </>
      ) : (
        <>
          {hostMenuNode}
          {workspaceMenuNode}
        </>
      )}
    </div>
  );
}

export const ComposerWorkspaceLocationBar = memo(function ComposerWorkspaceLocationBar(props: {
  readonly variant?: ComposerLocationBarVariant | undefined;
  readonly className?: string | undefined;
}) {
  const variant = props.variant ?? "top-tray";
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const routeTarget = useThreadRouteTarget();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const handleNewThread = useNewThreadHandler();
  const {
    scratchEnvironmentId,
    scratchWorkspaceRootFor,
    openScratchProject,
    startScratchThread,
  } = useScratchProject();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const switchRef = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);

  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const activeServerThread = useQuietThreadShell(routeThreadRef);
  const draftSession = useComposerDraftStore((store) =>
    routeDraftId !== null
      ? (store.draftThreadsByThreadKey[routeDraftId] ?? null)
      : null,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);

  const activeEnvironmentId: EnvironmentId | null =
    draftSession?.environmentId ??
    activeServerThread?.environmentId ??
    routeThreadRef?.environmentId ??
    primaryEnvironmentId ??
    environments[0]?.environmentId ??
    null;

  const activeProjectId: ProjectId | null =
    draftSession?.projectId ?? activeServerThread?.projectId ?? null;

  const activeProject =
    activeEnvironmentId !== null && activeProjectId !== null
      ? (allProjects.find(
          (project) =>
            project.environmentId === activeEnvironmentId && project.id === activeProjectId,
        ) ?? null)
      : null;

  const activeWorktreePath: string | null =
    draftSession?.worktreePath ?? activeServerThread?.worktreePath ?? null;

  const activeEnvPresentation =
    activeEnvironmentId !== null
      ? (environments.find((env) => env.environmentId === activeEnvironmentId) ?? null)
      : null;
  const activeScratchRoot =
    activeEnvPresentation?.serverConfig?.scratchWorkspaceRoot ??
    scratchWorkspaceRootFor(activeEnvironmentId);
  const activeProjectIsScratch =
    activeProject !== null && isScratchProject(activeProject, activeScratchRoot);

  const branchCwd = activeWorktreePath ?? activeProject?.workspaceRoot ?? null;
  const gitStatus = useAtomValue(
    activeEnvironmentId !== null && branchCwd !== null && !activeProjectIsScratch
      ? chatGitStatusAtom(
          vcsEnvironment.status({
            environmentId: activeEnvironmentId,
            input: { cwd: branchCwd },
          }),
        )
      : NO_CHAT_GIT_STATUS_ATOM,
  );
  const canWriteSourceControl = useEnvironmentScope(
    activeEnvironmentId,
    AuthSourceControlWriteScope,
  );
  const branchListQuery = useEnvironmentQuery(
    branchMenuOpen && activeEnvironmentId !== null && branchCwd !== null && !activeProjectIsScratch
      ? vcsEnvironment.listRefs({
          environmentId: activeEnvironmentId,
          input: { cwd: branchCwd, query: "", limit: 24 },
        })
      : null,
  );

  const hostDisplay = resolveComposerHostDisplay({
    activeEnvironmentId,
    environments: environments.map((env) => ({
      environmentId: env.environmentId,
      savedLabel: env.label,
      runtimeLabel: env.serverConfig?.environment.label ?? null,
      isPrimary: env.environmentId === primaryEnvironmentId,
      connected: env.connection.phase === "connected",
      machine: resolveEnvironmentMachineKind(env.serverConfig ?? null),
      displayUrl: env.displayUrl,
      scratchWorkspaceRoot: env.serverConfig?.scratchWorkspaceRoot ?? null,
    })),
    fallbackLocalLabel: gt("This device"),
    resolveMessage: m,
  });

  const workspaceDisplay = resolveComposerWorkspaceDisplay({
    activeProject,
    activeWorktreePath,
    draftEnvMode: draftSession?.envMode ?? null,
    isDraft: routeDraftId !== null,
    scratchWorkspaceRoot: activeScratchRoot,
    isScratch: activeProjectIsScratch,
  });

  const activeBranchName =
    gitStatus?.refName ??
    (routeDraftId !== null ? draftSession?.branch : activeServerThread?.branch) ??
    null;

  const branchDisplay = resolveComposerBranchChipDisplay({
    activeBranch: activeBranchName,
    envMode: workspaceDisplay.envMode,
    hasWorktreePath: activeWorktreePath !== null && activeWorktreePath.trim().length > 0,
    isHomeOrScratch: workspaceDisplay.isHomeOrScratch,
    isGitRepo: gitStatus?.isRepo === true,
    labels: {
      localCheckout: gt("Local checkout"),
      currentWorktree: gt("Current worktree"),
      newWorktree: gt("New worktree"),
    },
  });

  const branchOptions: readonly ComposerBranchOption[] = (branchListQuery.data?.refs ?? []).map(
    (ref) => ({
      name: ref.name,
      current: ref.current,
      isRemote: ref.isRemote === true,
    }),
  );

  const nonArchivedProjects = allProjects
    .filter(
      (project) =>
        project.archivedAt == null &&
        !isScratchProject(project, scratchWorkspaceRootFor(project.environmentId)),
    )
    .toSorted((a, b) => a.title.localeCompare(b.title));

  const targetScratchEnvId = scratchEnvironmentId(activeEnvironmentId);
  const canPickLocalFolder =
    readLocalApi()?.dialogs.pickFolder !== undefined &&
    (activeEnvironmentId === null || activeEnvironmentId === primaryEnvironmentId);

  const switchToProject = (project: ComposerLocationProjectInput) => {
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    if (routeDraftId !== null && composerDraftHasUserContent(getComposerDraft(routeDraftId))) {
      const fullProject = allProjects.find(
        (candidate) =>
          candidate.environmentId === project.environmentId && candidate.id === project.id,
      );
      if (fullProject) {
        const logicalKey = deriveLogicalProjectKeyFromSettings(
          fullProject,
          projectGroupingSettings,
        );
        setLogicalProjectDraftThreadId(logicalKey, projectRef, routeDraftId);
        seedDraftModelSelection(routeDraftId, projectRef);
        return;
      }
    }
    void handleNewThread(projectRef);
  };

  const handleSelectEnvironment = async (nextEnvironmentId: EnvironmentId) => {
    if (activeProject && !activeProjectIsScratch) {
      const currentLogicalKey = deriveLogicalProjectKeyFromSettings(
        activeProject,
        projectGroupingSettings,
      );
      const twin = allProjects.find(
        (candidate) =>
          candidate.archivedAt == null &&
          candidate.environmentId === nextEnvironmentId &&
          deriveLogicalProjectKeyFromSettings(candidate, projectGroupingSettings) ===
            currentLogicalKey,
      );
      if (twin) {
        switchToProject(twin);
        return;
      }
    }

    if (scratchWorkspaceRootFor(nextEnvironmentId) !== null) {
      const scratchProject = await openScratchProject(nextEnvironmentId);
      if (scratchProject) {
        switchToProject(scratchProject);
        return;
      }
    }

    const firstProjectOnTarget = nonArchivedProjects.find(
      (candidate) => candidate.environmentId === nextEnvironmentId,
    );
    if (firstProjectOnTarget) {
      switchToProject(firstProjectOnTarget);
      return;
    }

    openCommandPalette({ open: "add-project" });
  };

  const handleSelectScratch = async () => {
    if (targetScratchEnvId === null) return;
    if (routeDraftId !== null && composerDraftHasUserContent(getComposerDraft(routeDraftId))) {
      const scratchProject = await openScratchProject(targetScratchEnvId);
      if (scratchProject) {
        switchToProject(scratchProject);
      }
      return;
    }
    await startScratchThread(targetScratchEnvId);
  };

  const handleChangeEnvMode = (nextMode: EnvMode) => {
    if (!routeDraftId) return;
    setDraftThreadContext(routeDraftId, {
      envMode: nextMode,
      worktreePath: null,
    });
  };

  const handleSelectBranch = async (branchName: string) => {
    if (routeDraftId !== null && workspaceDisplay.envMode === "worktree" && !activeWorktreePath) {
      setDraftThreadContext(routeDraftId, { branch: branchName });
      return;
    }
    if (!activeEnvironmentId || !branchCwd || !canWriteSourceControl) return;
    const result = await switchRef({
      environmentId: activeEnvironmentId,
      input: { cwd: branchCwd, refName: branchName },
    });
    if (result._tag === "Success") {
      if (routeDraftId !== null) {
        setDraftThreadContext(routeDraftId, { branch: result.value.refName ?? branchName });
      }
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Switch branch"),
          description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
        }),
      );
    }
  };

  const handleCopyBranchName = () => {
    if (!branchDisplay.branchName) return;
    void writeTextToClipboard(branchDisplay.branchName, {
      target: "branch name",
      unavailableMessage: msg("Clipboard API is unavailable while copying branch name."),
      failureMessage: msg("Failed to copy branch name to the clipboard."),
    }).then(
      () => {
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: gt("Copied"),
            description: branchDisplay.branchName ?? undefined,
          }),
        );
      },
      () => undefined,
    );
  };

  const handlePickLocalFolder = async () => {
    const api = readLocalApi();
    const targetEnvId = primaryEnvironmentId ?? activeEnvironmentId;
    if (!api?.dialogs.pickFolder || !targetEnvId || isPickingFolder) {
      openCommandPalette({ open: "add-project" });
      return;
    }
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      const initialPath =
        workspaceDisplay.fullPath && workspaceDisplay.fullPath !== "~"
          ? workspaceDisplay.fullPath
          : undefined;
      pickedPath = await api.dialogs.pickFolder(initialPath ? { initialPath } : undefined);
    } catch {
      setIsPickingFolder(false);
      return;
    }
    setIsPickingFolder(false);
    if (!pickedPath) return;

    const existing = findProjectByPath(
      allProjects.filter((candidate) => candidate.environmentId === targetEnvId),
      pickedPath,
    );
    if (existing) {
      switchToProject(existing);
      return;
    }

    if (!readEnvironmentScope(targetEnvId, AuthOrchestrationOperateScope)) {
      openCommandPalette({ open: "add-project" });
      return;
    }

    const projectId = newProjectId();
    const createResult = await createProject({
      environmentId: targetEnvId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(pickedPath),
        workspaceRoot: pickedPath,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
      },
    });
    if (createResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(createResult)) {
        const error = squashAtomCommandFailure(createResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to add project"),
            description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
          }),
        );
      }
      return;
    }

    await settlePromise(() => handleNewThread(scopeProjectRef(targetEnvId, projectId)));
  };

  const handleCopyWorkspacePath = () => {
    if (!workspaceDisplay.fullPath || workspaceDisplay.fullPath === "~") return;
    void writeTextToClipboard(workspaceDisplay.fullPath, {
      target: "workspace path",
      unavailableMessage: msg("Clipboard API is unavailable while copying workspace path."),
      failureMessage: msg("Failed to copy workspace path to the clipboard."),
    }).then(
      () => {
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title: gt("Copied"),
            description: workspaceDisplay.fullPath,
          }),
        );
      },
      () => undefined,
    );
  };

  return (
    <ComposerWorkspaceLocationBarView
      variant={variant}
      host={hostDisplay}
      workspace={workspaceDisplay}
      branch={branchDisplay}
      branchOptions={branchOptions}
      isLoadingBranches={branchMenuOpen && branchListQuery.isPending && !branchListQuery.data}
      canSwitchBranch={
        canWriteSourceControl ||
        (routeDraftId !== null && workspaceDisplay.envMode === "worktree" && !activeWorktreePath)
      }
      projects={nonArchivedProjects}
      scratchAvailable={targetScratchEnvId !== null}
      canPickLocalFolder={canPickLocalFolder}
      isPickingFolder={isPickingFolder}
      className={props.className}
      onSelectEnvironment={(nextEnvId) => {
        void handleSelectEnvironment(nextEnvId);
      }}
      onManageEnvironments={() => {
        void navigate({ to: "/settings/connections" });
      }}
      onSelectProject={switchToProject}
      onSelectScratch={() => {
        void handleSelectScratch();
      }}
      onChangeEnvMode={routeDraftId !== null ? handleChangeEnvMode : undefined}
      onBranchMenuOpenChange={setBranchMenuOpen}
      onSelectBranch={(branchName) => {
        void handleSelectBranch(branchName);
      }}
      onCopyBranchName={branchDisplay.branchName ? handleCopyBranchName : undefined}
      onPickLocalFolder={() => {
        void handlePickLocalFolder();
      }}
      onOpenAddProject={() => openCommandPalette({ open: "add-project" })}
      onCopyWorkspacePath={handleCopyWorkspacePath}
    />
  );
});
