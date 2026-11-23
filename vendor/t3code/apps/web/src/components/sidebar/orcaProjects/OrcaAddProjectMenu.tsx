import {
  getAddProjectInitialQuery,
  getCloneDestinationPath,
  getCloneDirectoryPath,
} from "@t3tools/client-runtime/operations/projects";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import {
  CheckIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GlobeIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";
import { memo, useEffect, useState } from "react";

import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "../../EnvironmentMachineIcon";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../../ui/menu";
import { SidebarMenuButton } from "../../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import {
  validateAndNormalizeGitCloneUrl,
  validateNewProjectName,
} from "./orcaProjects.logic";
import { useOrcaProjectsCopy } from "./orcaProjectsCopy";

export interface OrcaEnvironmentOption {
  readonly environmentId: EnvironmentId;
  readonly displayLabel: string;
  readonly rawLabel: string;
  readonly machine: EnvironmentMachineKind;
  readonly isPrimary: boolean;
  readonly isConnected: boolean;
  readonly platformOs: string | null;
  readonly addProjectBaseDirectory: string | null;
  readonly newProjectsRoot: string | null;
  readonly ghqCloneLayout: boolean;
}

export interface OrcaAddProjectMenuProps {
  readonly environments: readonly OrcaEnvironmentOption[];
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly onSelectEnvironmentId: (environmentId: EnvironmentId) => void;
  readonly onBrowseFolder: (environmentId: EnvironmentId | null) => void;
  readonly onOpenCloneDialog: (environmentId: EnvironmentId | null) => void;
  readonly onOpenCreateProjectDialog: (environmentId: EnvironmentId | null) => void;
  /** Trigger visual density: sidebar header button or compact modal label button. */
  readonly triggerVariant?: "sidebar" | "compact";
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly tooltipSide?: "top" | "bottom";
  readonly triggerTestId?: string;
}

/**
 * 1:1 Orca `📁+` Add Project dropdown menu (Figure 7), modeled after
 * `stablyai/orca` `AddProjectMenu.tsx` & `AddProjectHostSubmenu.tsx`,
 * rendered on liquid glass (`data-pmx-glass-zone="overlays"`).
 */
export const OrcaAddProjectMenu = memo(function OrcaAddProjectMenu({
  environments,
  selectedEnvironmentId,
  onSelectEnvironmentId,
  onBrowseFolder,
  onOpenCloneDialog,
  onOpenCreateProjectDialog,
  triggerVariant = "sidebar",
  align = "end",
  side = "bottom",
  tooltipSide = "bottom",
  triggerTestId = "orca-add-project-menu-trigger",
}: OrcaAddProjectMenuProps) {
  const copy = useOrcaProjectsCopy();
  const [open, setOpen] = useState(false);

  const selectedEnv =
    environments.find((env) => env.environmentId === selectedEnvironmentId) ??
    environments.find((env) => env.isConnected) ??
    environments[0] ??
    null;
  const activeEnvId = selectedEnv?.environmentId ?? null;

  const triggerElement =
    triggerVariant === "compact" ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        data-testid={triggerTestId}
        aria-label={copy.addProjectTitle}
        className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
      />
    ) : (
      <SidebarMenuButton
        size="icon"
        type="button"
        data-testid={triggerTestId}
        aria-label={copy.addProjectTitle}
        className="relative size-6.5 shrink-0 rounded-md p-0 text-sidebar-muted-foreground hover:text-sidebar-foreground"
      />
    );

  return (
    <Menu modal={false} open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger render={<MenuTrigger render={triggerElement} />}>
          <FolderPlusIcon aria-hidden className="size-3.5" strokeWidth={2} />
        </TooltipTrigger>
        <TooltipPopup side={tooltipSide} sideOffset={6}>
          {copy.addProjectTitle}
        </TooltipPopup>
      </Tooltip>

      <MenuPopup
        align={align}
        side={side}
        sideOffset={6}
        data-testid="orca-add-project-menu-popup"
        data-pmx-glass-zone="overlays"
        className="w-64"
      >
        {/* Top header row matching Orca AddProjectMenu.tsx L165-182 */}
        <div className="flex min-h-7 items-center justify-between gap-2 py-0.5 pr-1 pl-2">
          <span className="shrink-0 text-[11px] font-semibold text-muted-foreground select-none">
            {copy.addProjectTitle}
          </span>
          {selectedEnv ? (
            <MenuSub>
              <MenuSubTrigger
                data-testid="orca-add-project-host-trigger"
                className="min-h-6 max-w-36 gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground [&>svg]:size-3"
              >
                <span className="min-w-0 truncate">{selectedEnv.displayLabel}</span>
              </MenuSubTrigger>
              <MenuSubPopup
                data-testid="orca-add-project-host-submenu"
                data-pmx-glass-zone="overlays"
                className="w-56"
              >
                <MenuGroupLabel className="text-[11px] font-semibold text-muted-foreground">
                  {copy.projectHostLabel}
                </MenuGroupLabel>
                {environments.map((env) => {
                  const isSelected = env.environmentId === selectedEnv.environmentId;
                  return (
                    <MenuItem
                      key={env.environmentId}
                      closeOnClick={false}
                      data-testid={`orca-add-project-host-${env.environmentId}`}
                      onClick={() => onSelectEnvironmentId(env.environmentId)}
                      className="items-center gap-2 py-1.5"
                    >
                      <span className="flex size-3.5 shrink-0 items-center justify-center">
                        {isSelected ? (
                          <CheckIcon aria-hidden className="size-3.5 text-primary" />
                        ) : null}
                      </span>
                      <EnvironmentMachineIcon
                        kind={env.machine}
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {env.displayLabel}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {env.isConnected ? copy.connectedStatus : copy.disconnectedStatus}
                        </span>
                      </span>
                    </MenuItem>
                  );
                })}
              </MenuSubPopup>
            </MenuSub>
          ) : null}
        </div>

        <MenuSeparator />

        <MenuItem
          data-testid="orca-add-project-browse"
          onClick={() => {
            setOpen(false);
            onBrowseFolder(activeEnvId);
          }}
        >
          <FolderOpenIcon aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{copy.browseFolder}</span>
          <MenuShortcut className="text-[11px]">↵</MenuShortcut>
        </MenuItem>

        <MenuItem
          data-testid="orca-add-project-clone"
          onClick={() => {
            setOpen(false);
            onOpenCloneDialog(activeEnvId);
          }}
        >
          <GlobeIcon aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{copy.cloneFromUrl}</span>
        </MenuItem>

        <MenuItem
          data-testid="orca-add-project-create"
          onClick={() => {
            setOpen(false);
            onOpenCreateProjectDialog(activeEnvId);
          }}
        >
          <PlusIcon aria-hidden className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{copy.createNewProject}</span>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});

// ---------------------------------------------------------------------------
// Clone from URL Dialog (modeled after Orca AddRepoCloneStep.tsx)
// ---------------------------------------------------------------------------

export interface OrcaCloneProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environment: OrcaEnvironmentOption | null;
  readonly canPickLocalFolder: boolean;
  readonly onPickParentFolder: () => Promise<string | null>;
  readonly onSubmitClone: (input: {
    readonly environmentId: EnvironmentId;
    readonly remoteUrl: string;
    readonly destinationPath: string;
  }) => Promise<boolean>;
}

export function OrcaCloneProjectDialog({
  open,
  onOpenChange,
  environment,
  canPickLocalFolder,
  onPickParentFolder,
  onSubmitClone,
}: OrcaCloneProjectDialogProps) {
  const copy = useOrcaProjectsCopy();
  const [gitUrl, setGitUrl] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const defaultBaseDir = getAddProjectInitialQuery(
    environment?.addProjectBaseDirectory ?? undefined,
  );

  // Reset fields cleanly on open
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets modal form inputs when opening dialog
  useEffect(() => {
    if (!open) return;
    setGitUrl("");
    setParentDir(defaultBaseDir);
    setError(null);
    setSubmitting(false);
  }, [defaultBaseDir, open]);

  const parsedUrl = validateAndNormalizeGitCloneUrl(gitUrl);
  const resolvedParent = parentDir.trim() || defaultBaseDir;
  const targetPreview =
    parsedUrl.ok && resolvedParent.length > 0
      ? getCloneDestinationPath(
          resolvedParent,
          getCloneDirectoryPath(
            parsedUrl.normalizedUrl,
            environment?.ghqCloneLayout === true,
          ),
        )
      : parsedUrl.ok
        ? parsedUrl.folderName
        : "";

  const handleSubmit = async () => {
    if (submitting) return;
    if (!environment || !environment.isConnected) {
      setError(copy.environmentUnavailable);
      return;
    }
    const validated = validateAndNormalizeGitCloneUrl(gitUrl);
    if (!validated.ok) {
      setError(validated.reason === "empty" ? copy.cloneUrlEmptyError : copy.cloneUrlInvalidError);
      return;
    }
    const destinationPath =
      resolvedParent.length > 0
        ? getCloneDestinationPath(
            resolvedParent,
            getCloneDirectoryPath(
              validated.normalizedUrl,
              environment.ghqCloneLayout === true,
            ),
          )
        : validated.folderName;
    setError(null);
    setSubmitting(true);
    const ok = await onSubmitClone({
      environmentId: environment.environmentId,
      remoteUrl: validated.normalizedUrl,
      destinationPath,
    });
    setSubmitting(false);
    if (ok) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      disablePointerDismissal={submitting}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogPopup
        data-testid="orca-clone-project-dialog"
        data-pmx-glass-zone="overlays"
        className="sm:max-w-md"
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base">{copy.cloneDialogTitle}</DialogTitle>
            <DialogDescription className="text-xs">
              {copy.cloneDialogDescription(environment?.displayLabel ?? copy.projectHostLabel)}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="orca-clone-url" className="text-xs text-muted-foreground">
                {copy.gitUrlLabel}
              </Label>
              <Input
                id="orca-clone-url"
                data-testid="orca-clone-url-input"
                value={gitUrl}
                onChange={(event) => {
                  setGitUrl(event.target.value);
                  if (error) setError(null);
                }}
                placeholder={copy.gitUrlPlaceholder}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="orca-clone-parent" className="text-xs text-muted-foreground">
                {copy.parentFolderLabel}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="orca-clone-parent"
                  data-testid="orca-clone-parent-input"
                  value={parentDir}
                  onChange={(event) => setParentDir(event.target.value)}
                  placeholder={copy.parentFolderPlaceholder}
                  className="flex-1 font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={submitting}
                />
                {canPickLocalFolder ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={submitting}
                    aria-label={copy.chooseFolder}
                    title={copy.chooseFolder}
                    onClick={() => {
                      void onPickParentFolder().then((picked) => {
                        if (picked) setParentDir(picked);
                      });
                    }}
                  >
                    <FolderIcon className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              {targetPreview ? (
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={targetPreview}>
                  {copy.cloneTargetPreview}: {targetPreview}
                </p>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="orca-clone-submit"
              disabled={submitting || !parsedUrl.ok}
            >
              {submitting ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
              {submitting ? copy.cloningAction : copy.cloneAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create New Project Dialog (modeled after Orca AddRepoCreateStep.tsx)
// ---------------------------------------------------------------------------

export interface OrcaCreateProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environment: OrcaEnvironmentOption | null;
  readonly canPickLocalFolder: boolean;
  readonly onPickParentFolder: () => Promise<string | null>;
  readonly onSubmitCreate: (input: {
    readonly environmentId: EnvironmentId;
    readonly name: string;
    readonly parentDir: string | null;
  }) => Promise<boolean>;
}

export function OrcaCreateProjectDialog({
  open,
  onOpenChange,
  environment,
  canPickLocalFolder,
  onPickParentFolder,
  onSubmitCreate,
}: OrcaCreateProjectDialogProps) {
  const copy = useOrcaProjectsCopy();
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const defaultRoot =
    environment?.newProjectsRoot ??
    getAddProjectInitialQuery(environment?.addProjectBaseDirectory ?? undefined);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets modal form inputs when opening dialog
  useEffect(() => {
    if (!open) return;
    setName("");
    setParentDir(defaultRoot);
    setError(null);
    setSubmitting(false);
  }, [defaultRoot, open]);

  const validated = validateNewProjectName(name);
  const effectiveRoot = parentDir.trim() || defaultRoot;
  const separator = effectiveRoot.includes("\\") ? "\\" : "/";
  const pathPreview =
    validated.ok && effectiveRoot.length > 0
      ? `${effectiveRoot.replace(/[\\/]+$/, "")}${separator}${validated.name}`
      : validated.ok
        ? validated.name
        : "";

  const handleSubmit = async () => {
    if (submitting) return;
    if (!environment || !environment.isConnected) {
      setError(copy.environmentUnavailable);
      return;
    }
    const result = validateNewProjectName(name);
    if (!result.ok) {
      setError(
        result.reason === "empty" ? copy.projectNameEmptyError : copy.projectNameInvalidError,
      );
      return;
    }
    setError(null);
    setSubmitting(true);
    const ok = await onSubmitCreate({
      environmentId: environment.environmentId,
      name: result.name,
      parentDir: parentDir.trim() || null,
    });
    setSubmitting(false);
    if (ok) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      disablePointerDismissal={submitting}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogPopup
        data-testid="orca-create-project-dialog"
        data-pmx-glass-zone="overlays"
        className="sm:max-w-md"
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base">{copy.createProjectDialogTitle}</DialogTitle>
            <DialogDescription className="text-xs">
              {copy.createProjectDialogDescription(
                environment?.displayLabel ?? copy.projectHostLabel,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="orca-create-project-name" className="text-xs text-muted-foreground">
                {copy.projectNameLabel}
              </Label>
              <Input
                id="orca-create-project-name"
                data-testid="orca-create-project-name-input"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(null);
                }}
                placeholder={copy.projectNamePlaceholder}
                className="font-mono"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="orca-create-project-parent" className="text-xs text-muted-foreground">
                {copy.parentFolderLabel}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="orca-create-project-parent"
                  value={parentDir}
                  onChange={(event) => setParentDir(event.target.value)}
                  placeholder={copy.parentFolderPlaceholder}
                  className="flex-1 font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={submitting}
                />
                {canPickLocalFolder ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={submitting}
                    aria-label={copy.chooseFolder}
                    title={copy.chooseFolder}
                    onClick={() => {
                      void onPickParentFolder().then((picked) => {
                        if (picked) setParentDir(picked);
                      });
                    }}
                  >
                    <FolderIcon className="size-3.5" />
                  </Button>
                ) : null}
              </div>
              {pathPreview ? (
                <p
                  className="truncate rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground"
                  title={pathPreview}
                >
                  {pathPreview}
                </p>
              ) : null}
            </div>

            {error ? (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="orca-create-project-submit"
              disabled={submitting || !validated.ok}
            >
              {submitting ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
              {submitting ? copy.creatingProjectAction : copy.createProjectAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Web Fallback Folder Path Dialog (when native Electron pickFolder is unavailable)
// ---------------------------------------------------------------------------

export interface OrcaBrowseFolderFallbackDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environment: OrcaEnvironmentOption | null;
  readonly onSubmitFolderPath: (input: {
    readonly environmentId: EnvironmentId;
    readonly path: string;
  }) => Promise<boolean>;
}

export function OrcaBrowseFolderFallbackDialog({
  open,
  onOpenChange,
  environment,
  onSubmitFolderPath,
}: OrcaBrowseFolderFallbackDialogProps) {
  const copy = useOrcaProjectsCopy();
  const [folderPath, setFolderPath] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets modal input on open
  useEffect(() => {
    if (!open) return;
    setFolderPath(
      getAddProjectInitialQuery(environment?.addProjectBaseDirectory ?? undefined),
    );
    setSubmitting(false);
  }, [environment?.addProjectBaseDirectory, open]);

  const trimmed = folderPath.trim();

  const handleSubmit = async () => {
    if (submitting || trimmed.length === 0 || !environment) return;
    setSubmitting(true);
    const ok = await onSubmitFolderPath({
      environmentId: environment.environmentId,
      path: trimmed,
    });
    setSubmitting(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      disablePointerDismissal={submitting}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogPopup
        data-testid="orca-browse-folder-dialog"
        data-pmx-glass-zone="overlays"
        className="sm:max-w-md"
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-base">{copy.browseFolderDialogTitle}</DialogTitle>
            <DialogDescription className="text-xs">
              {copy.browseFolderDialogDescription(
                environment?.displayLabel ?? copy.projectHostLabel,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-1.5">
              <Label htmlFor="orca-folder-path-input" className="text-xs text-muted-foreground">
                {copy.folderPathLabel}
              </Label>
              <Input
                id="orca-folder-path-input"
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder={copy.folderPathPlaceholder}
                className="font-mono text-xs"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || trimmed.length === 0 || !environment}
              className={cn(submitting && "opacity-75")}
            >
              {submitting ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
              {copy.addFolderAction}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
