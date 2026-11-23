import type { EnvironmentId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CornerDownLeftIcon,
  FolderIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  Settings2Icon,
  SmileIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import { cn, isMacPlatform } from "~/lib/utils";
import type { DraftThreadEnvMode } from "../../../composerDraftStore";
import { AgentBrandLogo, formatAgentBrandName } from "../../../prismux/agentBrand";
import type { SidebarProjectSnapshot } from "../../../sidebarProjectGrouping";
import { EnvironmentMachineIcon } from "../../EnvironmentMachineIcon";
import { ProjectFavicon } from "../../ProjectFavicon";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "../../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { Textarea } from "../../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { OrcaAddProjectMenu, type OrcaEnvironmentOption } from "./OrcaAddProjectMenu";
import {
  buildCreateWorkspacePayload,
  DEFAULT_AGENT_SELECTION_VALUE,
  insertEmojiAtSelection,
  matchDialogSubmitShortcut,
  NO_PROJECT_SELECTION_VALUE,
  ORCA_WORKSPACE_EMOJI_DEFAULTS,
  type CreateWorkspacePayload,
  type OrcaWorkspaceAgentOption,
} from "./orcaProjects.logic";
import { useOrcaProjectsCopy } from "./orcaProjectsCopy";

export interface OrcaCreateWorkspaceDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: readonly SidebarProjectSnapshot[];
  readonly defaultProjectKey: string | null;
  readonly environments: readonly OrcaEnvironmentOption[];
  readonly defaultEnvironmentId: EnvironmentId | null;
  readonly agentOptionsByEnvironment: ReadonlyMap<
    EnvironmentId,
    readonly OrcaWorkspaceAgentOption[]
  >;
  readonly fallbackAgentOptions: readonly OrcaWorkspaceAgentOption[];
  readonly onOpenProviderSettings: () => void;
  readonly onBrowseFolder: (environmentId: EnvironmentId | null) => void;
  readonly onOpenCloneDialog: (environmentId: EnvironmentId | null) => void;
  readonly onOpenCreateProjectDialog: (environmentId: EnvironmentId | null) => void;
  readonly onSubmit: (
    payload: CreateWorkspacePayload,
    resolvedAgent: OrcaWorkspaceAgentOption | null,
  ) => Promise<boolean>;
}

/**
 * 1:1 Orca "Create workspace" modal dialog (Figure 9), modeled after
 * `stablyai/orca` `NewWorkspaceComposerModal`, `NewWorkspaceComposerProjectSection`,
 * `NewWorkspaceComposerNameSection`, `NewWorkspaceComposerAgentSection`,
 * `NewWorkspaceComposerAdvancedSection`, `NewWorkspaceComposerFooter`, and `WorkspaceEmojiPickerButton`.
 */
export const OrcaCreateWorkspaceDialog = memo(function OrcaCreateWorkspaceDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectKey,
  environments,
  defaultEnvironmentId,
  agentOptionsByEnvironment,
  fallbackAgentOptions,
  onOpenProviderSettings,
  onBrowseFolder,
  onOpenCloneDialog,
  onOpenCreateProjectDialog,
  onSubmit,
}: OrcaCreateWorkspaceDialogProps) {
  const copy = useOrcaProjectsCopy();
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  const nonArchivedProjects = useMemo(
    () => projects.filter((project) => !project.archived),
    [projects],
  );

  const initialProjectKey = useMemo(() => {
    if (
      defaultProjectKey &&
      nonArchivedProjects.some((project) => project.projectKey === defaultProjectKey)
    ) {
      return defaultProjectKey;
    }
    return nonArchivedProjects[0]?.projectKey ?? NO_PROJECT_SELECTION_VALUE;
  }, [defaultProjectKey, nonArchivedProjects]);

  const initialEnvironmentId = useMemo<EnvironmentId | null>(() => {
    const matchedProject = nonArchivedProjects.find(
      (project) => project.projectKey === initialProjectKey,
    );
    if (matchedProject) return matchedProject.environmentId;
    if (
      defaultEnvironmentId &&
      environments.some((env) => env.environmentId === defaultEnvironmentId)
    ) {
      return defaultEnvironmentId;
    }
    return (
      environments.find((env) => env.isConnected)?.environmentId ??
      environments[0]?.environmentId ??
      null
    );
  }, [defaultEnvironmentId, environments, initialProjectKey, nonArchivedProjects]);

  const [projectSelection, setProjectSelection] = useState<string>(initialProjectKey);
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(initialEnvironmentId);
  const [workspaceName, setWorkspaceName] = useState("");
  const [agentOptionId, setAgentOptionId] = useState<string>(DEFAULT_AGENT_SELECTION_VALUE);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [envMode, setEnvMode] = useState<DraftThreadEnvMode>("local");
  const [branch, setBranch] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [createMore, setCreateMore] = useState(false);
  const [emojiPopoverOpen, setEmojiPopoverOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync defaults cleanly whenever dialog opens
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- initializes workspace modal form fields each time the modal opens
  useEffect(() => {
    if (!open) return;
    setProjectSelection(initialProjectKey);
    setEnvironmentId(initialEnvironmentId);
    setWorkspaceName("");
    setAgentOptionId(DEFAULT_AGENT_SELECTION_VALUE);
    setBranch("");
    setInitialPrompt("");
    setErrorMessage(null);
    setSubmitting(false);
    setEmojiPopoverOpen(false);
    setEmojiQuery("");
    const timer = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(timer);
  }, [initialEnvironmentId, initialProjectKey, open]);

  const selectedProject =
    projectSelection === NO_PROJECT_SELECTION_VALUE
      ? null
      : (nonArchivedProjects.find((project) => project.projectKey === projectSelection) ?? null);

  const selectedEnvironment =
    environments.find((env) => env.environmentId === environmentId) ??
    environments.find((env) => env.isConnected) ??
    environments[0] ??
    null;

  const effectiveEnvironmentId = selectedEnvironment?.environmentId ?? null;

  const availableAgents = useMemo(() => {
    const envAgents = effectiveEnvironmentId
      ? agentOptionsByEnvironment.get(effectiveEnvironmentId)
      : undefined;
    if (envAgents && envAgents.length > 0) return envAgents;
    return fallbackAgentOptions;
  }, [agentOptionsByEnvironment, effectiveEnvironmentId, fallbackAgentOptions]);

  const selectedAgent =
    agentOptionId === DEFAULT_AGENT_SELECTION_VALUE
      ? null
      : (availableAgents.find((agent) => agent.id === agentOptionId) ?? null);

  const filteredEmojis = useMemo(() => {
    const q = emojiQuery.trim().toLowerCase();
    if (!q) return ORCA_WORKSPACE_EMOJI_DEFAULTS;
    return ORCA_WORKSPACE_EMOJI_DEFAULTS.filter(
      (entry) => entry.shortcode.includes(q) || entry.emoji.includes(q),
    );
  }, [emojiQuery]);

  const handleProjectChange = (nextProjectKey: string | null) => {
    if (!nextProjectKey) return;
    setProjectSelection(nextProjectKey);
    const project = nonArchivedProjects.find((candidate) => candidate.projectKey === nextProjectKey);
    if (project) {
      setEnvironmentId(project.environmentId);
    }
    requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const handlePickEmoji = (emoji: string) => {
    const input = nameInputRef.current;
    const currentVal = workspaceName;
    const selection = selectionRef.current ?? {
      start: input?.selectionStart ?? currentVal.length,
      end: input?.selectionEnd ?? currentVal.length,
    };
    const next = insertEmojiAtSelection(currentVal, selection.start, selection.end, emoji);
    setWorkspaceName(next.value);
    setEmojiPopoverOpen(false);
    setEmojiQuery("");
    requestAnimationFrame(() => {
      if (nameInputRef.current) {
        nameInputRef.current.focus();
        nameInputRef.current.setSelectionRange(next.cursor, next.cursor);
      }
    });
  };

  const handleSubmit = async () => {
    if (submitting) return;
    const built = buildCreateWorkspacePayload({
      projectSelection,
      environmentId: effectiveEnvironmentId,
      workspaceName,
      agentOptionId,
      envMode,
      branch,
      initialPrompt,
      createMore,
    });
    if (!built.ok) {
      setErrorMessage(copy.environmentUnavailable);
      return;
    }
    setErrorMessage(null);
    setSubmitting(true);
    const ok = await onSubmit(built.payload, selectedAgent);
    setSubmitting(false);
    if (!ok) return;

    if (built.payload.createMore) {
      setWorkspaceName("");
      setInitialPrompt("");
      requestAnimationFrame(() => nameInputRef.current?.focus());
      return;
    }
    onOpenChange(false);
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
        data-testid="orca-create-workspace-dialog"
        data-pmx-glass-zone="overlays"
        className="sm:max-w-lg"
        onKeyDown={(event) => {
          if (matchDialogSubmitShortcut(event)) {
            event.preventDefault();
            event.stopPropagation();
            void handleSubmit();
          }
        }}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <DialogHeader className="pb-2">
            <DialogTitle className="text-base font-semibold tracking-tight">
              {copy.createWorkspaceTitle}
            </DialogTitle>
          </DialogHeader>

          <DialogPanel className="space-y-4">
            {/* Row 1: Two columns — Project (left, with 📁+ quick add) & Run on (right) */}
            <div className="grid grid-cols-2 gap-3">
              {/* Project column */}
              <div className="min-w-0 space-y-1.5">
                <div className="flex h-5 items-center justify-between gap-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {copy.projectLabel}
                  </Label>
                  <OrcaAddProjectMenu
                    environments={environments}
                    selectedEnvironmentId={effectiveEnvironmentId}
                    onSelectEnvironmentId={(envId) => setEnvironmentId(envId)}
                    onBrowseFolder={onBrowseFolder}
                    onOpenCloneDialog={onOpenCloneDialog}
                    onOpenCreateProjectDialog={onOpenCreateProjectDialog}
                    triggerVariant="compact"
                    align="end"
                    side="bottom"
                    tooltipSide="top"
                    triggerTestId="orca-create-workspace-add-project"
                  />
                </div>

                <Select value={projectSelection} onValueChange={handleProjectChange}>
                  <SelectTrigger
                    size="sm"
                    data-testid="orca-create-workspace-project-select"
                    aria-label={copy.projectLabel}
                    className="h-9 w-full min-w-0"
                  >
                    <SelectValue>
                      {selectedProject ? (
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <ProjectFavicon project={selectedProject} className="size-3.5 shrink-0" />
                          <span className="truncate text-xs font-medium">
                            {selectedProject.displayName}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted font-mono text-[11px] text-muted-foreground">
                            ~
                          </span>
                          <span className="truncate text-xs font-medium">
                            {copy.noProjectOption}
                          </span>
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem
                      value={NO_PROJECT_SELECTION_VALUE}
                      data-testid="orca-workspace-project-none"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted font-mono text-[11px] text-muted-foreground">
                          ~
                        </span>
                        <span className="truncate text-xs">{copy.noProjectOption}</span>
                      </span>
                    </SelectItem>
                    {nonArchivedProjects.map((project) => (
                      <SelectItem key={project.projectKey} value={project.projectKey}>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <ProjectFavicon project={project} className="size-3.5 shrink-0" />
                          <span className="truncate text-xs">{project.displayName}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              {/* Run on column */}
              <div className="min-w-0 space-y-1.5">
                <div className="flex h-5 items-center">
                  <Label className="text-xs font-medium text-muted-foreground">
                    {copy.runOnLabel}
                  </Label>
                </div>

                <Select
                  value={effectiveEnvironmentId ?? ""}
                  onValueChange={(value) => {
                    if (value) setEnvironmentId(value as EnvironmentId);
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    data-testid="orca-create-workspace-env-select"
                    aria-label={copy.runOnLabel}
                    className="h-9 w-full min-w-0"
                  >
                    <SelectValue>
                      {selectedEnvironment ? (
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <EnvironmentMachineIcon
                            kind={selectedEnvironment.machine}
                            aria-hidden
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                          <span className="truncate text-xs font-medium">
                            {selectedEnvironment.displayLabel}
                          </span>
                        </span>
                      ) : (
                        <span className="truncate text-xs text-muted-foreground">
                          {copy.projectHostLabel}
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {environments.map((env) => (
                      <SelectItem key={env.environmentId} value={env.environmentId}>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <EnvironmentMachineIcon
                            kind={env.machine}
                            aria-hidden
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                          <span className="truncate text-xs">{env.displayLabel}</span>
                          <span
                            aria-hidden
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              env.isConnected ? "bg-emerald-500" : "bg-muted-foreground/45",
                            )}
                          />
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>

            {/* Row 2: Workspace name [Optional] with `Aa` prefix & `☺` Emoji Picker */}
            <div className="min-w-0 space-y-1.5">
              <Label
                htmlFor="orca-workspace-name-input"
                className="text-xs font-medium text-muted-foreground"
              >
                <span>{copy.workspaceNameLabel}</span>{" "}
                <span className="font-normal text-muted-foreground/70">{copy.optionalTag}</span>
              </Label>

              <div className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background/60 px-2.5 shadow-xs/5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25 dark:bg-input/32">
                <span
                  aria-hidden
                  data-testid="orca-workspace-name-aa-prefix"
                  className="shrink-0 text-xs font-semibold tracking-tight text-muted-foreground select-none"
                >
                  Aa
                </span>
                <input
                  ref={nameInputRef}
                  id="orca-workspace-name-input"
                  data-testid="orca-workspace-name-input"
                  type="text"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  placeholder={copy.workspaceNamePlaceholder}
                  autoComplete="off"
                  disabled={submitting}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
                />

                <Popover
                  open={emojiPopoverOpen}
                  onOpenChange={(nextOpen) => {
                    if (nextOpen) {
                      const input = nameInputRef.current;
                      const len = input?.value.length ?? workspaceName.length;
                      selectionRef.current = {
                        start: input?.selectionStart ?? len,
                        end: input?.selectionEnd ?? len,
                      };
                    }
                    setEmojiPopoverOpen(nextOpen);
                  }}
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              data-testid="orca-workspace-emoji-trigger"
                              aria-label={copy.addEmojiTooltip}
                              disabled={submitting}
                              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          }
                        />
                      }
                    >
                      <SmileIcon aria-hidden className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup side="top" sideOffset={6}>
                      {copy.addEmojiTooltip}
                    </TooltipPopup>
                  </Tooltip>

                  <PopoverPopup
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    padding="compact"
                    data-testid="orca-workspace-emoji-popover"
                    data-pmx-glass-zone="overlays"
                    className="w-64"
                  >
                    <div className="space-y-2 p-1">
                      <Input
                        size="sm"
                        value={emojiQuery}
                        onChange={(event) => setEmojiQuery(event.target.value)}
                        placeholder={copy.emojiSearchPlaceholder}
                        className="text-xs"
                        autoComplete="off"
                      />
                      <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto">
                        {filteredEmojis.map((entry) => (
                          <button
                            key={entry.shortcode}
                            type="button"
                            data-testid={`orca-emoji-${entry.shortcode}`}
                            title={`:${entry.shortcode}:`}
                            aria-label={entry.shortcode}
                            onClick={() => handlePickEmoji(entry.emoji)}
                            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-base transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {entry.emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </PopoverPopup>
                </Popover>
              </div>
            </div>

            {/* Row 3: Agent [Optional] with official AgentBrandLogo + Settings shortcut to /settings/providers */}
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  <span>{copy.agentLabel}</span>{" "}
                  <span className="font-normal text-muted-foreground/70">{copy.optionalTag}</span>
                </Label>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        data-testid="orca-create-workspace-configure-agents"
                        aria-label={copy.configureAgentsTooltip}
                        onClick={() => {
                          onOpenChange(false);
                          onOpenProviderSettings();
                        }}
                        className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                      />
                    }
                  >
                    <Settings2Icon aria-hidden className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="top" sideOffset={6}>
                    {copy.configureAgentsTooltip}
                  </TooltipPopup>
                </Tooltip>
              </div>

              <Select
                value={agentOptionId}
                onValueChange={(value) => {
                  if (value) setAgentOptionId(value);
                }}
              >
                <SelectTrigger
                  size="sm"
                  data-testid="orca-create-workspace-agent-select"
                  aria-label={copy.agentLabel}
                  className="h-9 w-full min-w-0"
                >
                  <SelectValue>
                    {selectedAgent ? (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <AgentBrandLogo
                          provider={selectedAgent.driverKind}
                          online={selectedAgent.online}
                          size={15}
                        />
                        <span className="truncate text-xs font-medium">
                          {formatAgentBrandName(selectedAgent.driverKind, selectedAgent.displayName)}{" "}
                          (Chat)
                          {selectedAgent.modelLabel ? ` · ${selectedAgent.modelLabel}` : ""}
                        </span>
                      </span>
                    ) : availableAgents[0] ? (
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <AgentBrandLogo
                          provider={availableAgents[0].driverKind}
                          online={availableAgents[0].online}
                          size={15}
                        />
                        <span className="truncate text-xs text-muted-foreground">
                          {copy.defaultAgentOption}
                        </span>
                      </span>
                    ) : (
                      <span className="truncate text-xs text-muted-foreground">
                        {copy.defaultAgentOption}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup alignItemWithTrigger={false}>
                  <SelectItem value={DEFAULT_AGENT_SELECTION_VALUE}>
                    <span className="text-xs text-muted-foreground">{copy.defaultAgentOption}</span>
                  </SelectItem>
                  {availableAgents.map((agent) => {
                    const canonicalName = formatAgentBrandName(agent.driverKind, agent.displayName);
                    return (
                      <SelectItem key={agent.id} value={agent.id}>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <AgentBrandLogo
                            provider={agent.driverKind}
                            online={agent.online}
                            size={14}
                          />
                          <span className="truncate text-xs font-medium">
                            {canonicalName} (Chat)
                          </span>
                          {agent.modelLabel ? (
                            <span className="truncate text-xs text-muted-foreground">
                              · {agent.modelLabel}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            </div>

            {/* Row 4: Collapsible Advanced section (`高级 ∨`) */}
            <div className="space-y-2.5">
              <button
                type="button"
                data-testid="orca-create-workspace-advanced-toggle"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((prev) => !prev)}
                className="inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{copy.advancedLabel}</span>
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                    advancedOpen && "rotate-180",
                  )}
                />
              </button>

              {advancedOpen ? (
                <div
                  data-testid="orca-create-workspace-advanced-panel"
                  className="space-y-3 rounded-lg border border-border/60 bg-muted/25 p-3"
                >
                  {/* Workspace mode */}
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-medium text-muted-foreground">
                      {copy.workspaceModeLabel}
                    </Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        data-testid="orca-workspace-mode-local"
                        aria-pressed={envMode === "local"}
                        onClick={() => setEnvMode("local")}
                        className={cn(
                          "flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          envMode === "local"
                            ? "border-primary/60 bg-primary/12 text-foreground"
                            : "border-border/60 bg-background/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        <FolderIcon aria-hidden className="size-3.5" />
                        <span>{copy.workspaceModeLocal}</span>
                      </button>
                      <button
                        type="button"
                        data-testid="orca-workspace-mode-worktree"
                        aria-pressed={envMode === "worktree"}
                        onClick={() => setEnvMode("worktree")}
                        className={cn(
                          "flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          envMode === "worktree"
                            ? "border-primary/60 bg-primary/12 text-foreground"
                            : "border-border/60 bg-background/40 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        <GitBranchIcon aria-hidden className="size-3.5" />
                        <span>{copy.workspaceModeWorktree}</span>
                      </button>
                    </div>
                  </div>

                  {/* Branch */}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="orca-workspace-branch-input"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      {copy.defaultBranchLabel}
                    </Label>
                    <Input
                      id="orca-workspace-branch-input"
                      data-testid="orca-workspace-branch-input"
                      size="sm"
                      value={branch}
                      onChange={(event) => setBranch(event.target.value)}
                      placeholder={copy.defaultBranchPlaceholder}
                      className="font-mono text-xs"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={submitting}
                    />
                  </div>

                  {/* Initial prompt */}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="orca-workspace-prompt-input"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      {copy.initialPromptLabel}
                    </Label>
                    <Textarea
                      id="orca-workspace-prompt-input"
                      data-testid="orca-workspace-prompt-input"
                      rows={3}
                      value={initialPrompt}
                      onChange={(event) => setInitialPrompt(event.target.value)}
                      placeholder={copy.initialPromptPlaceholder}
                      className="text-xs"
                      disabled={submitting}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {errorMessage ? (
              <p role="alert" className="text-xs text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </DialogPanel>

          {/* Footer: Left `创建更多` Switch + Right `创建 Ctrl ↵` high-contrast primary button */}
          <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none hover:text-foreground">
              <Switch
                size="sm"
                data-testid="orca-create-workspace-more-switch"
                checked={createMore}
                onCheckedChange={(checked) => setCreateMore(checked)}
              />
              <span>{copy.createMoreLabel}</span>
            </label>

            <Button
              type="submit"
              size="sm"
              data-testid="orca-create-workspace-submit"
              disabled={submitting || !effectiveEnvironmentId}
              className="gap-1.5 px-3.5 font-medium"
            >
              {submitting ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
              <span>{submitting ? copy.creatingButtonLabel : copy.createButtonLabel}</span>
              <span
                aria-hidden
                className="ml-0.5 inline-flex items-center gap-0.5 rounded border border-current/25 px-1 py-0.5 text-[10px] leading-none font-medium opacity-85"
              >
                <span>{isMac ? "⌘" : "Ctrl"}</span>
                <CornerDownLeftIcon className="size-2.5" />
              </span>
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
});
