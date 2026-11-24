import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChartNoAxesColumnIcon,
  Code2Icon,
  CrosshairIcon,
  FolderPlusIcon,
  KeyboardIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { T, useGT } from "gt-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type PrismuxDesktopBridge,
  type ProjectId,
  type ScopedProjectRef,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron as IS_ELECTRON_RUNTIME } from "../../env";
import { useHandleNewThread } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { shortcutLabelForCommand } from "../../keybindings";
import {
  navigateHistory,
  useCanNavigateHistory,
  type HistoryDirection,
} from "../../navigationHistory";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "../../providerInstances";
import { useProjects } from "../../state/entities";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { environmentServerConfigsAtom, primaryServerKeybindingsAtom } from "../../state/server";
import { cn, isMacPlatform } from "../../lib/utils";
import { useOptionalPrismuxRuntime } from "../../prismux/PrismuxRuntimeProvider";
import { PrismuxAutoUpdateHost } from "../../prismux/updates/PrismuxAutoUpdateHost";
import { PrismuxSidebarUpdateCapsule } from "../../prismux/updates/PrismuxSidebarUpdateCapsule";
import { useUpdateNotifierState } from "../../prismux/updates/updateNotifierStore";
import {
  useIssuesSupported,
  usePrimaryEnvironmentId,
  usePullRequestsSupported,
} from "../../state/environments";
import { resolveDesktopUpdateButtonAction } from "../desktopUpdate.logic";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { readIssueListPreferences } from "../issue/issueListPreferences";
import { IssueGlyph } from "../issue/issuePresentation";
import { isSidebarUtilityPage, useNavigateToMainApp } from "./mainAppLocation";
import { requestLocateActiveSidebarThread } from "./prismuxSidebarQuickNav.logic";
import {
  nextToolbarFocusIndex,
  resolveSidebarUtilityOverflow,
  resolveToolbarItemOwningFocus,
  SIDEBAR_UTILITY_ITEM_ATTR,
} from "./sidebarMicroIndicators";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { useUpdateEverythingRun } from "./updateEverythingRun";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";

export const SIDEBAR_HEADER_CONTROL_ORDER = ["brand-menu", "sidebar-toggle", "history-nav"] as const;

export const SIDEBAR_APP_MENU_ITEM_IDS = [
  "new-thread",
  "open-workspace",
  "command-palette",
  "settings",
  "keybindings",
  "check-updates",
  "reload-window",
  "force-reload-window",
  "toggle-devtools",
] as const;

export interface BrandMenuDeveloperShortcuts {
  readonly forceReload: string;
  readonly toggleDevTools: string;
}

export function resolveBrandMenuDeveloperShortcuts(platform: string): BrandMenuDeveloperShortcuts {
  return isMacPlatform(platform)
    ? { forceReload: "⌘⇧R", toggleDevTools: "⌥⌘I" }
    : { forceReload: "Ctrl+Shift+R", toggleDevTools: "Ctrl+Shift+I" };
}

export function resolveDefaultAvailableModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  settings: ServerSettings,
  projectId: ProjectId | null,
): ModelSelection | null {
  const resolved = resolveProjectDefaultProviderModelSelection(providers, settings, projectId);
  if (resolved) return resolved;
  const entries = providerInstanceEntriesFor(providers, settings, projectId);
  const fallbackEntry = entries.find((entry) => entry.enabled) ?? entries[0];
  if (!fallbackEntry) return null;
  const fallbackModel =
    fallbackEntry.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
    fallbackEntry.models.find((model) => !model.isCustom)?.slug ??
    fallbackEntry.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[fallbackEntry.driverKind];
  return fallbackModel ? { instanceId: fallbackEntry.instanceId, model: fallbackModel } : null;
}

export function executeBrandMenuReload(
  prismuxBridge?: Pick<PrismuxDesktopBridge, "reloadWindow"> | null,
  locationLike?: Pick<Location, "reload"> | null,
): void {
  if (typeof prismuxBridge?.reloadWindow === "function") {
    void prismuxBridge.reloadWindow();
    return;
  }
  locationLike?.reload();
}

export function executeBrandMenuForceReload(
  prismuxBridge?: Pick<PrismuxDesktopBridge, "forceReloadWindow"> | null,
  locationLike?: Pick<Location, "reload"> | null,
): void {
  if (typeof prismuxBridge?.forceReloadWindow === "function") {
    void prismuxBridge.forceReloadWindow();
    return;
  }
  if (typeof caches !== "undefined" && typeof caches.keys === "function") {
    void caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .finally(() => {
        locationLike?.reload();
      });
    return;
  }
  locationLike?.reload();
}

export function executeBrandMenuToggleDevTools(
  prismuxBridge?: Pick<PrismuxDesktopBridge, "toggleDevTools"> | null,
): boolean {
  if (typeof prismuxBridge?.toggleDevTools === "function") {
    void prismuxBridge.toggleDevTools();
    return true;
  }
  return false;
}

const HEADER_ICON_BUTTON_BASE_CLASS =
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent transition-colors [-webkit-app-region:no-drag] outline-none focus-visible:ring-1 focus-visible:ring-foreground/25 disabled:pointer-events-none disabled:opacity-35";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const { isMobile, isIconRail, isTextHidden } = useSidebar();
  const gt = useGT();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode,
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;
  const railCompact = !isMobile && isIconRail;
  const onBackdrop = backdropVariant !== null;

  return (
    <div
      data-sidebar-chrome-header="true"
      data-sidebar-rail-compact={railCompact ? "true" : "false"}
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center",
        railCompact
          ? "justify-center px-0"
          : "gap-1.5 pl-[var(--workspace-controls-left)] pr-2.5",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <div className="relative top-[calc(var(--workspace-controls-top)-env(safe-area-inset-top))] z-10 flex shrink-0 items-center md:hidden">
        <SidebarTrigger
          variant={backdropVariant ? "media-navigation" : "ghost"}
          className="relative top-auto translate-y-0"
          aria-label={gt("Toggle main sidebar")}
        />
      </div>
      {railCompact ? (
        <div className="relative z-10 hidden items-center justify-center md:flex">
          <SidebarHeaderToggleButton railCompact onBackdrop={onBackdrop} />
        </div>
      ) : (
        <div
          className={cn(
            "relative z-10 flex h-7 min-w-0 flex-1 items-center gap-1 overflow-hidden transition-opacity duration-[90ms] ease-out motion-reduce:transition-none",
            isTextHidden && "pointer-events-none opacity-0",
          )}
        >
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            <SidebarBrandMenu onBackdrop={onBackdrop} isElectron={isElectron} />
            <SidebarHeaderToggleButton railCompact={false} onBackdrop={onBackdrop} />
          </div>
          {pillLabel ? (
            <div className="ml-0.5 flex h-6 shrink-0 items-center">
              <Badge data-environment-identification="pill" size="sm" variant="secondary">
                {pillLabel}
              </Badge>
            </div>
          ) : null}
          {isElectron ? (
            <div
              data-sidebar-header-history="true"
              className="ml-auto hidden shrink-0 items-center gap-0.5 md:flex"
            >
              <HistoryNavigationButton direction="back" onBackdrop={onBackdrop} />
              <HistoryNavigationButton direction="forward" onBackdrop={onBackdrop} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

export function SidebarBrandWidthProbe({
  isElectron,
  onWidthChange,
}: {
  isElectron: boolean;
  onWidthChange: (width: number) => void;
}) {
  const observeWidth = (probe: HTMLDivElement) => {
    return observeResize(probe, ([entry]) => {
      if (entry) onWidthChange(entry.borderBoxSize[0]?.inlineSize ?? probe.offsetWidth);
    });
  };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none invisible fixed top-0 left-0 flex w-max border-r border-transparent pr-2.5"
      ref={observeWidth}
    >
      <div className="ml-[var(--workspace-controls-left)] flex items-center gap-1">
        <SidebarBrandMark onBackdrop={false} />
        <div className="w-6 shrink-0" />
        {isElectron ? <div className="ml-1 w-[50px] shrink-0" /> : null}
      </div>
    </div>
  );
}

export function handleSidebarHeaderToggleClick(
  railCompact: boolean,
  actions: {
    readonly setOpen: (open: boolean) => void;
    readonly toggleSidebar: () => void;
  },
): void {
  if (railCompact) {
    actions.setOpen(true);
    return;
  }
  actions.toggleSidebar();
}

export function SidebarHeaderToggleButton({
  railCompact,
  onBackdrop,
}: {
  railCompact: boolean;
  onBackdrop: boolean;
}) {
  const gt = useGT();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { setOpen, toggleSidebar } = useSidebar();
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");
  const label = railCompact ? gt("Expand sidebar") : gt("Collapse sidebar");
  const tooltip = !railCompact && shortcutLabel ? `${label} (${shortcutLabel})` : label;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            data-sidebar-header-toggle="true"
            aria-label={label}
            aria-pressed={!railCompact}
            onClick={() => handleSidebarHeaderToggleClick(railCompact, { setOpen, toggleSidebar })}
            className={cn(
              HEADER_ICON_BUTTON_BASE_CLASS,
              railCompact ? "size-7" : "hidden size-6 md:inline-flex",
              onBackdrop
                ? "text-white/85 hover:bg-white/15 hover:text-white"
                : "text-muted-foreground/85 hover:bg-foreground/8 hover:text-foreground dark:hover:bg-white/10",
            )}
          />
        }
      >
        {railCompact ? (
          <PanelLeftIcon className="size-4" aria-hidden="true" />
        ) : (
          <PanelLeftCloseIcon className="size-3.5" aria-hidden="true" />
        )}
      </TooltipTrigger>
      <TooltipPopup side={railCompact ? "right" : "bottom"} sideOffset={railCompact ? 8 : 4}>
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}

function HistoryNavigationButton({
  direction,
  onBackdrop,
}: {
  direction: HistoryDirection;
  onBackdrop: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const enabled = useCanNavigateHistory(direction);
  const gt = useGT();
  const label = direction === "back" ? gt("Go back") : gt("Go forward");
  const shortcutLabel = shortcutLabelForCommand(
    keybindings,
    direction === "back" ? "navigation.back" : "navigation.forward",
  );
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-sidebar-history-nav={direction}
            aria-label={label}
            disabled={!enabled}
            onClick={() => navigateHistory(direction)}
            className={cn(
              HEADER_ICON_BUTTON_BASE_CLASS,
              "size-6",
              onBackdrop
                ? "text-white/85 hover:bg-white/15 hover:text-white"
                : "text-muted-foreground/80 hover:bg-foreground/8 hover:text-foreground dark:hover:bg-white/10",
            )}
          />
        }
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup side="bottom" sideOffset={4}>
        {label}
        {shortcutLabel ? ` (${shortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

function useDirectNewThreadCreator() {
  const environmentServerConfigs = useAtomValue(environmentServerConfigsAtom);
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { activeThread, activeDraftThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();

  return useCallback(async () => {
    const firstOpenProject = projects.find((project) => project.archivedAt == null);
    let targetProjectRef: ScopedProjectRef | null = activeThread
      ? scopeProjectRef(activeThread.environmentId, activeThread.projectId)
      : activeDraftThread
        ? scopeProjectRef(activeDraftThread.environmentId, activeDraftThread.projectId)
        : (defaultProjectRef ??
          (firstOpenProject
            ? scopeProjectRef(firstOpenProject.environmentId, firstOpenProject.id)
            : null));
    let fromScratch = false;
    if (!targetProjectRef) {
      const scratchEnv = scratchEnvironmentId(primaryEnvironmentId);
      if (scratchEnv) {
        const scratchProject = await openScratchProject(scratchEnv);
        if (scratchProject) {
          targetProjectRef = scopeProjectRef(scratchProject.environmentId, scratchProject.id);
          fromScratch = true;
        }
      }
    }
    if (!targetProjectRef) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    const serverConfig =
      environmentServerConfigs.get(targetProjectRef.environmentId) ??
      [...environmentServerConfigs.values()][0];
    const defaultSelection = resolveDefaultAvailableModelSelection(
      serverConfig?.providers ?? [],
      serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
      targetProjectRef.projectId,
    );
    const opened = await handleNewThread(targetProjectRef, {
      forceNew: true,
      ...(fromScratch ? { envMode: "local" as const } : {}),
      ...(defaultSelection ? { modelSelection: defaultSelection } : {}),
    }).catch(() => null);
    if (!opened) {
      openCommandPalette({ open: "new-thread-in" });
    }
  }, [
    activeDraftThread,
    activeThread,
    defaultProjectRef,
    environmentServerConfigs,
    handleNewThread,
    openScratchProject,
    primaryEnvironmentId,
    projects,
    scratchEnvironmentId,
  ]);
}

export interface SidebarBrandMenuItemsProps {
  readonly commandPaletteShortcut: string | null;
  readonly developerShortcuts: BrandMenuDeveloperShortcuts;
  readonly showDevToolsItem: boolean;
  readonly onNewThread: () => void;
  readonly onAddProject: () => void;
  readonly onOpenCommandPalette: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenKeybindings: () => void;
  readonly onCheckUpdates: () => void;
  readonly onReload: () => void;
  readonly onForceReload: () => void;
  readonly onToggleDevTools: () => void;
}

export function SidebarBrandMenuItems(props: SidebarBrandMenuItemsProps) {
  const gt = useGT();
  const {
    commandPaletteShortcut,
    developerShortcuts,
    showDevToolsItem,
    onNewThread,
    onAddProject,
    onOpenCommandPalette,
    onOpenSettings,
    onOpenKeybindings,
    onCheckUpdates,
    onReload,
    onForceReload,
    onToggleDevTools,
  } = props;

  return (
    <>
      <MenuItem data-sidebar-app-menu-item="new-thread" onClick={onNewThread}>
        <SquarePenIcon className="size-3.5" aria-hidden="true" />
        <span>{gt("New thread")}</span>
      </MenuItem>
      <MenuItem data-sidebar-app-menu-item="open-workspace" onClick={onAddProject}>
        <FolderPlusIcon className="size-3.5" aria-hidden="true" />
        <span>{gt("Add project")}</span>
      </MenuItem>
      <MenuItem data-sidebar-app-menu-item="command-palette" onClick={onOpenCommandPalette}>
        <SearchIcon className="size-3.5" aria-hidden="true" />
        <span className="flex-1">{gt("Command palette")}</span>
        {commandPaletteShortcut ? (
          <span className="ml-4 text-[11px] text-muted-foreground tabular-nums">
            {commandPaletteShortcut}
          </span>
        ) : null}
      </MenuItem>
      <MenuSeparator />
      <MenuItem data-sidebar-app-menu-item="settings" onClick={onOpenSettings}>
        <SettingsIcon className="size-3.5" aria-hidden="true" />
        <span>{gt("Settings")}</span>
      </MenuItem>
      <MenuItem data-sidebar-app-menu-item="keybindings" onClick={onOpenKeybindings}>
        <KeyboardIcon className="size-3.5" aria-hidden="true" />
        <span>
          <T>Keyboard shortcuts</T>
        </span>
      </MenuItem>
      <MenuItem data-sidebar-app-menu-item="check-updates" onClick={onCheckUpdates}>
        <RefreshCwIcon className="size-3.5" aria-hidden="true" />
        <span>{gt("Check for updates")}</span>
      </MenuItem>
      <MenuSeparator />
      <MenuItem data-sidebar-app-menu-item="reload-window" onClick={onReload}>
        <RotateCwIcon className="size-3.5" aria-hidden="true" />
        <span className="flex-1">{gt("Reload")}</span>
      </MenuItem>
      <MenuItem data-sidebar-app-menu-item="force-reload-window" onClick={onForceReload}>
        <RotateCcwIcon className="size-3.5" aria-hidden="true" />
        <span className="flex-1">{gt("Force Reload")}</span>
        <span className="ml-4 text-[11px] text-muted-foreground tabular-nums">
          {developerShortcuts.forceReload}
        </span>
      </MenuItem>
      {showDevToolsItem ? (
        <MenuItem data-sidebar-app-menu-item="toggle-devtools" onClick={onToggleDevTools}>
          <Code2Icon className="size-3.5" aria-hidden="true" />
          <span className="flex-1">{gt("Toggle Developer Tools")}</span>
          <span className="ml-4 text-[11px] text-muted-foreground tabular-nums">
            {developerShortcuts.toggleDevTools}
          </span>
        </MenuItem>
      ) : null}
    </>
  );
}

export function SidebarBrandMenu({
  onBackdrop,
  onOpenChange,
  onAction,
  isElectron,
  defaultOpen,
}: {
  onBackdrop: boolean;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onAction?: (() => void) | undefined;
  isElectron?: boolean | undefined;
  defaultOpen?: boolean | undefined;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { isMobile, setOpenMobile } = useSidebar();
  const handleCreateDirectNewThread = useDirectNewThreadCreator();
  const commandPaletteShortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  const developerShortcuts = resolveBrandMenuDeveloperShortcuts(platform);
  const prismuxBridge =
    typeof window !== "undefined" ? (window.desktopBridge?.prismux ?? null) : null;
  const showDevToolsItem =
    isElectron ?? (IS_ELECTRON_RUNTIME || typeof prismuxBridge?.toggleDevTools === "function");

  const closeAfterAction = () => {
    if (isMobile) setOpenMobile(false);
    onAction?.();
  };

  return (
    <Menu defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <MenuTrigger
        render={
          <button
            type="button"
            data-sidebar-brand-menu-trigger="true"
            aria-label={gt("Prismux home")}
            className={cn(
              "relative z-10 hidden h-6 w-fit min-w-0 shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-md px-1.5 transition-colors [-webkit-app-region:no-drag] outline-none focus-visible:ring-1 focus-visible:ring-foreground/25 md:inline-flex",
              onBackdrop
                ? "text-white hover:bg-white/15 data-popup-open:bg-white/18"
                : "text-foreground hover:bg-foreground/8 data-popup-open:bg-foreground/10 dark:hover:bg-white/10 dark:data-popup-open:bg-white/12",
            )}
          />
        }
      >
        <SidebarBrandMark onBackdrop={onBackdrop} />
      </MenuTrigger>
      <MenuPopup
        data-pmx-glass-zone="overlays"
        data-sidebar-brand-menu-popup="true"
        side="bottom"
        align="start"
        sideOffset={6}
        className="min-w-60"
      >
        <SidebarBrandMenuItems
          commandPaletteShortcut={commandPaletteShortcut}
          developerShortcuts={developerShortcuts}
          showDevToolsItem={showDevToolsItem}
          onNewThread={() => {
            closeAfterAction();
            void handleCreateDirectNewThread();
          }}
          onAddProject={() => {
            closeAfterAction();
            openCommandPalette({ open: "add-project" });
          }}
          onOpenCommandPalette={() => {
            closeAfterAction();
            openCommandPalette();
          }}
          onOpenSettings={() => {
            closeAfterAction();
            void navigate({ to: "/settings" });
          }}
          onOpenKeybindings={() => {
            closeAfterAction();
            void navigate({ to: "/settings/keybindings" });
          }}
          onCheckUpdates={() => {
            closeAfterAction();
            void navigate({ to: "/settings/about" });
          }}
          onReload={() => {
            closeAfterAction();
            executeBrandMenuReload(
              prismuxBridge,
              typeof window !== "undefined" ? window.location : null,
            );
          }}
          onForceReload={() => {
            closeAfterAction();
            executeBrandMenuForceReload(
              prismuxBridge,
              typeof window !== "undefined" ? window.location : null,
            );
          }}
          onToggleDevTools={() => {
            closeAfterAction();
            executeBrandMenuToggleDevTools(prismuxBridge);
          }}
        />
      </MenuPopup>
    </Menu>
  );
}

function SidebarBrandMark({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight">
      <img
        alt="Prismux"
        className="size-4 shrink-0 rounded-[4px] object-cover"
        src="/prismux-logo.png"
      />
      <span
        className={cn(
          "truncate [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both_cap_alphabetic]:py-1",
          onBackdrop ? "text-white" : "text-foreground",
        )}
      >
        {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product wordmark */}
        {"Prismux"}
      </span>
    </span>
  );
}

export function SidebarRailMonogramButton({
  icon,
  primaryLabel,
  secondaryLabel = null,
  ariaLabel,
  active = false,
  dotClassName = null,
  onClick,
  dataRow,
  dataProjectKey,
}: {
  readonly icon: ReactNode;
  readonly primaryLabel: string;
  readonly secondaryLabel?: string | null;
  readonly ariaLabel: string;
  readonly active?: boolean;
  readonly dotClassName?: string | null;
  readonly onClick: () => void;
  readonly dataRow?: string;
  readonly dataProjectKey?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-sidebar-row={dataRow}
            data-sidebar-rail-project={dataProjectKey}
            aria-label={ariaLabel}
            aria-current={active ? "page" : undefined}
            onClick={onClick}
            className={cn(
              "relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active &&
                "border-sidebar-border/65 bg-sidebar-row-active text-sidebar-foreground shadow-[0_1px_2px_rgb(0_0_0/6%)]",
            )}
          />
        }
      >
        {icon}
        {dotClassName ? (
          <span
            aria-hidden
            data-rail-dot="true"
            className={cn(
              "pointer-events-none absolute right-1 bottom-1 size-1.5 rounded-full ring-2 ring-sidebar",
              dotClassName,
            )}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="right" sideOffset={8} className="max-w-64">
        {secondaryLabel ? (
          <div className="flex flex-col gap-0.5 text-left">
            <span className="truncate font-medium">{primaryLabel}</span>
            <span className="truncate text-[11px] text-muted-foreground">{secondaryLabel}</span>
          </div>
        ) : (
          primaryLabel
        )}
      </TooltipPopup>
    </Tooltip>
  );
}

const SIDEBAR_UTILITY_BUTTON_CLASS =
  "size-[26px] rounded-md p-0 [&>svg]:size-[15px] [&_svg]:size-[15px]";

export function SidebarUtilityItem({
  itemId,
  icon,
  label,
  tooltip = label,
  tooltipSide = "top",
  hidden = false,
  isTabStop = false,
  className,
  onFocusItem,
  onClick,
}: {
  itemId: SidebarUtilityNavId;
  icon: ReactNode;
  label: string;
  tooltip?: string | undefined;
  tooltipSide?: "top" | "right";
  hidden?: boolean;
  isTabStop?: boolean;
  className?: string | undefined;
  onFocusItem: (itemId: SidebarUtilityNavId) => void;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem
      className={cn("shrink-0", hidden && "hidden", className)}
      aria-hidden={hidden || undefined}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              {...{ [SIDEBAR_UTILITY_ITEM_ATTR]: itemId }}
              aria-label={label}
              tabIndex={hidden ? -1 : isTabStop ? 0 : -1}
              onFocus={() => onFocusItem(itemId)}
              onClick={onClick}
              size="icon"
              className={SIDEBAR_UTILITY_BUTTON_CLASS}
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side={tooltipSide} sideOffset={tooltipSide === "right" ? 8 : 4}>
          {tooltip}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

export type SidebarUtilityNavId =
  | "settings"
  | "usage"
  | "locate"
  | "issues"
  | "pull-requests";
type SidebarUtilityFocusId = SidebarUtilityNavId | "more";

/**
 * Resolves the canonical Orca-style bottom sidebar utility item ids for both the expanded footer bar
 * and the 54px collapsed vertical icon rail:
 * - Expanded left group (left -> right): `settings`, `usage`
 * - Expanded right group (left -> right, rightmost is PR): `locate`, `issues`, `pull-requests`
 * Redundant entries that already live elsewhere (Help, Wallpaper, Collapse/Expand sidebar)
 * are intentionally excluded from both modes.
 */
export function resolveSidebarUtilityNavIds(options: {
  readonly pullRequestsSupported: boolean;
  readonly issuesSupported: boolean;
  readonly railCompact: boolean;
}): readonly SidebarUtilityNavId[] {
  const left: readonly SidebarUtilityNavId[] = ["settings", "usage"];
  const right: SidebarUtilityNavId[] = ["locate"];
  if (options.issuesSupported) right.push("issues");
  if (options.pullRequestsSupported) right.push("pull-requests");
  return options.railCompact ? [...right, ...left] : [...left, ...right];
}

const SidebarUtilityMenu = memo(function SidebarUtilityMenu() {
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const gt = useGT();
  const { isMobile, setOpenMobile, isIconRail } = useSidebar();
  const railCompact = !isMobile && isIconRail;
  const isOnUtilityPage = useLocation({
    select: (location) => isSidebarUtilityPage(location.pathname),
  });
  const pullRequestsSupported = usePullRequestsSupported();
  const issuesSupported = useIssuesSupported();
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== "undefined" ? window.innerHeight : 900,
  );
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [activeTabStopId, setActiveTabStopId] = useState<SidebarUtilityFocusId>("settings");
  const menuRef = useRef<HTMLUListElement | null>(null);
  const lastFocusedItemRef = useRef<SidebarUtilityFocusId | null>(null);

  // Track window height changes so utility items fold smoothly into the More menu without unmounting controllers.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes window resize to adapt sidebar utility capacity when window height shrinks
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes ResizeObserver on stable menuRef to avoid React 19 inline-ref churn
  useEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const measure = () => {
      const nextWidth = Math.round(node.clientWidth);
      setContainerWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };
    measure();
    return observeResize(node, measure);
  }, []);

  const closeMobileSidebar = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };
  const handlePullRequestsClick = () => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  };
  const handleIssuesClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/issues", search: readIssueListPreferences() });
  };
  const handleSettingsClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  };
  const handleLocateCurrentThreadClick = () => {
    requestLocateActiveSidebarThread();
  };
  const handleUsageClick = () => {
    closeMobileSidebar();
    void navigate({ to: "/usage" });
  };
  const handleBackClick = () => {
    closeMobileSidebar();
    void navigateToMainApp();
  };

  const utilityItems: ReadonlyArray<{
    readonly id: SidebarUtilityNavId;
    readonly group: "left" | "right";
    readonly icon: ReactNode;
    readonly label: string;
    readonly tooltip?: string;
    readonly onClick: () => void;
  }> = [
    {
      id: "settings",
      group: "left",
      icon: <SettingsIcon />,
      label: gt("Settings"),
      onClick: handleSettingsClick,
    },
    {
      id: "usage",
      group: "left",
      icon: <ChartNoAxesColumnIcon />,
      label: gt("Usage"),
      onClick: handleUsageClick,
    },
    {
      id: "locate",
      group: "right",
      icon: <CrosshairIcon />,
      label: gt("Locate current thread"),
      onClick: handleLocateCurrentThreadClick,
    },
    ...(issuesSupported
      ? [
          {
            id: "issues" as const,
            group: "right" as const,
            icon: <IssueGlyph.issue />,
            label: gt("Issues", { $context: "sidebar link to the list of issues" }),
            onClick: handleIssuesClick,
          },
        ]
      : []),
    ...(pullRequestsSupported
      ? [
          {
            id: "pull-requests" as const,
            group: "right" as const,
            icon: <PullRequestGlyph.pullRequest />,
            label: gt("Pull requests"),
            onClick: handlePullRequestsClick,
          },
        ]
      : []),
  ];

  // In collapsed vertical icon rail, width is fixed 54px so capacity depends on viewport height only.
  // With 26x26 compact buttons + 4px gap, all 5 icons fit in ~146px and never fold at standard sidebar widths.
  const overflowState = resolveSidebarUtilityOverflow(
    utilityItems.map((item) => item.id),
    {
      viewportHeight,
      containerWidth: railCompact ? 0 : containerWidth,
      itemSlotWidth: 28,
      reservedTrailingWidth: 8,
    },
  );
  const overflowItems = utilityItems.filter((item) => overflowState.overflowIds.includes(item.id));
  const leftUtilityItems = utilityItems.filter((item) => item.group === "left");
  const rightUtilityItems = utilityItems.filter((item) => item.group === "right");
  const firstVisibleRightId =
    rightUtilityItems.find((item) => overflowState.visibleIds.has(item.id))?.id ?? null;

  // Vertical rail order places utility actions stacked above Settings for ergonomic reach.
  const orderedRailItems = [...rightUtilityItems, ...leftUtilityItems];

  const visibleFocusOrder: readonly SidebarUtilityFocusId[] = railCompact
    ? [
        ...orderedRailItems
          .filter((item) => overflowState.visibleIds.has(item.id))
          .map((item) => item.id),
        ...(overflowItems.length > 0 ? (["more"] as const) : []),
      ]
    : [
        ...leftUtilityItems
          .filter((item) => overflowState.visibleIds.has(item.id))
          .map((item) => item.id),
        ...rightUtilityItems
          .filter((item) => overflowState.visibleIds.has(item.id))
          .map((item) => item.id),
        ...(overflowItems.length > 0 ? (["more"] as const) : []),
      ];

  const effectiveTabStopId: SidebarUtilityFocusId = visibleFocusOrder.includes(activeTabStopId)
    ? activeTabStopId
    : (visibleFocusOrder[0] ?? "settings");

  // Orca AppRail.tsx focus recovery: when height/width folding hides the item that currently owns focus,
  // move focus cleanly to `More` (or the surviving tab stop) instead of dropping focus to document.body.
  const visibleKey = visibleFocusOrder.join(",");
  useLayoutEffect(() => {
    if (isOnUtilityPage) return;
    const toolbar = menuRef.current;
    if (!toolbar) return;
    const owner =
      (resolveToolbarItemOwningFocus(toolbar) as SidebarUtilityFocusId | null) ??
      lastFocusedItemRef.current;
    if (!owner) return;
    if (visibleFocusOrder.includes(owner)) return;
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    const focusWasLostOrInsideToolbar =
      activeEl === null || activeEl === document.body || toolbar.contains(activeEl);
    if (!focusWasLostOrInsideToolbar) return;

    const fallbackId: SidebarUtilityFocusId =
      overflowItems.length > 0 ? "more" : (visibleFocusOrder[0] ?? "settings");
    lastFocusedItemRef.current = fallbackId;
    const frame = requestAnimationFrame(() => {
      const target = toolbar.querySelector<HTMLElement>(
        `[${SIDEBAR_UTILITY_ITEM_ATTR}="${fallbackId}"]`,
      );
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOnUtilityPage, overflowItems.length, visibleKey]);

  // WAI-ARIA APG toolbar roving focus in capture phase (horizontal when expanded, vertical in 54px icon rail).
  const handleToolbarKeyDownCapture = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    if (isOnUtilityPage || visibleFocusOrder.length <= 1) return;
    const toolbar = menuRef.current;
    if (!toolbar) return;
    const target = event.target instanceof Element ? event.target : null;
    const currentItemEl = target?.closest(`[${SIDEBAR_UTILITY_ITEM_ATTR}]`);
    if (!currentItemEl || !toolbar.contains(currentItemEl)) return;
    const currentId = currentItemEl.getAttribute(
      SIDEBAR_UTILITY_ITEM_ATTR,
    ) as SidebarUtilityFocusId | null;
    if (!currentId) return;
    const currentIndex = visibleFocusOrder.indexOf(currentId);
    if (currentIndex < 0) return;

    const nextIndex = nextToolbarFocusIndex(
      event.key,
      currentIndex,
      visibleFocusOrder.length,
      railCompact ? "vertical" : "horizontal",
    );
    if (nextIndex === null) return;

    const nextId = visibleFocusOrder[nextIndex];
    if (!nextId) return;
    const nextEl = toolbar.querySelector<HTMLElement>(
      `[${SIDEBAR_UTILITY_ITEM_ATTR}="${nextId}"]`,
    );
    if (!nextEl) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveTabStopId(nextId);
    lastFocusedItemRef.current = nextId;
    nextEl.focus();
  };

  const tooltipSide: "top" | "right" = railCompact ? "right" : "top";

  return (
    <SidebarMenu
      ref={menuRef}
      role={isOnUtilityPage ? undefined : "toolbar"}
      aria-orientation={isOnUtilityPage ? undefined : railCompact ? "vertical" : "horizontal"}
      aria-label={isOnUtilityPage ? undefined : gt("Sidebar utility toolbar")}
      onKeyDownCapture={handleToolbarKeyDownCapture}
      onFocusCapture={() => {
        const owner = resolveToolbarItemOwningFocus(
          menuRef.current,
        ) as SidebarUtilityFocusId | null;
        if (owner) {
          lastFocusedItemRef.current = owner;
        }
      }}
      data-sidebar-height-collapsed={overflowState.collapsedByHeight ? "true" : "false"}
      data-sidebar-rail-vertical={railCompact ? "true" : "false"}
      data-sidebar-footer-partition="orca"
      className={cn(
        "border-t border-sidebar-border/45",
        railCompact
          ? "flex-col items-center gap-1 pt-1.5"
          : "flex-row items-center gap-1 pt-1",
      )}
    >
      {isOnUtilityPage ? (
        <SidebarMenuItem className={cn(railCompact ? "shrink-0" : "min-w-0 flex-1")}>
          {railCompact ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarMenuButton
                    {...{ [SIDEBAR_UTILITY_ITEM_ATTR]: "back" }}
                    size="icon"
                    className={SIDEBAR_UTILITY_BUTTON_CLASS}
                    aria-label={gt("Back")}
                    onClick={handleBackClick}
                  >
                    <ArrowLeftIcon />
                  </SidebarMenuButton>
                }
              />
              <TooltipPopup side="right" sideOffset={8}>
                <T>Back</T>
              </TooltipPopup>
            </Tooltip>
          ) : (
            <SidebarMenuButton onClick={handleBackClick}>
              <ArrowLeftIcon />
              <span>
                <T>Back</T>
              </span>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      ) : (
        <>
          {/* Keep every utility node mounted via CSS hiding so folding never tears down mounted controllers/popups. */}
          {railCompact
            ? orderedRailItems.map((item) => (
                <SidebarUtilityItem
                  key={item.id}
                  itemId={item.id}
                  icon={item.icon}
                  label={item.label}
                  tooltip={item.tooltip}
                  tooltipSide="right"
                  hidden={!overflowState.visibleIds.has(item.id)}
                  isTabStop={effectiveTabStopId === item.id}
                  onFocusItem={(id) => {
                    setActiveTabStopId(id);
                    lastFocusedItemRef.current = id;
                  }}
                  onClick={item.onClick}
                />
              ))
            : (
              <>
                {leftUtilityItems.map((item) => (
                  <SidebarUtilityItem
                    key={item.id}
                    itemId={item.id}
                    icon={item.icon}
                    label={item.label}
                    tooltip={item.tooltip}
                    tooltipSide="top"
                    hidden={!overflowState.visibleIds.has(item.id)}
                    isTabStop={effectiveTabStopId === item.id}
                    onFocusItem={(id) => {
                      setActiveTabStopId(id);
                      lastFocusedItemRef.current = id;
                    }}
                    onClick={item.onClick}
                  />
                ))}
                <SidebarThreadUndoNotice />
                {rightUtilityItems.map((item) => (
                  <SidebarUtilityItem
                    key={item.id}
                    itemId={item.id}
                    icon={item.icon}
                    label={item.label}
                    tooltip={item.tooltip}
                    tooltipSide="top"
                    className={item.id === firstVisibleRightId ? "ml-auto" : undefined}
                    hidden={!overflowState.visibleIds.has(item.id)}
                    isTabStop={effectiveTabStopId === item.id}
                    onFocusItem={(id) => {
                      setActiveTabStopId(id);
                      lastFocusedItemRef.current = id;
                    }}
                    onClick={item.onClick}
                  />
                ))}
              </>
            )}

          <SidebarMenuItem
            className={cn(
              "shrink-0",
              overflowItems.length === 0 && "hidden",
              !railCompact && firstVisibleRightId === null && "ml-auto",
            )}
            aria-hidden={overflowItems.length === 0 || undefined}
          >
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <SidebarMenuButton
                          {...{ [SIDEBAR_UTILITY_ITEM_ATTR]: "more" }}
                          aria-label={gt("More navigation items")}
                          data-testid="sidebar-utility-more-trigger"
                          tabIndex={
                            overflowItems.length === 0
                              ? -1
                              : effectiveTabStopId === "more"
                                ? 0
                                : -1
                          }
                          onFocus={() => {
                            setActiveTabStopId("more");
                            lastFocusedItemRef.current = "more";
                          }}
                          size="icon"
                          className={SIDEBAR_UTILITY_BUTTON_CLASS}
                        >
                          <MoreHorizontalIcon />
                        </SidebarMenuButton>
                      }
                    />
                  }
                />
                <TooltipPopup side={tooltipSide} sideOffset={railCompact ? 8 : 4}>
                  {gt("More navigation items")}
                </TooltipPopup>
              </Tooltip>
              <MenuPopup
                data-pmx-glass-zone="overlays"
                keepMounted
                align="end"
                side={railCompact ? "right" : "top"}
                sideOffset={railCompact ? 8 : 6}
              >
                {overflowItems.map((item) => (
                  <MenuItem key={item.id} onClick={item.onClick}>
                    {item.icon}
                    <span>{item.label}</span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </SidebarMenuItem>
        </>
      )}
    </SidebarMenu>
  );
});

const SidebarActiveUpdateBanner = memo(function SidebarActiveUpdateBanner() {
  const runtime = useOptionalPrismuxRuntime();
  const desktopUpdateState = useDesktopUpdateState();
  const updateRun = useUpdateEverythingRun();
  const notifierState = useUpdateNotifierState();
  const badge = runtime?.updaterBadge;

  // When the unified Prismux auto-update notifier owns the update (toast / modal / sidebar capsule),
  // suppress the legacy duplicate badge here so only one clean capsule appears above Settings.
  const notifierOwnsPrismuxUpdate =
    notifierState.presentation !== "hidden" &&
    Boolean(notifierState.availableUpdate?.hasUpdate || notifierState.updaterStatus?.downloadedFilePath);

  const hasPrismuxBadge =
    !notifierOwnsPrismuxUpdate &&
    Boolean(
      badge &&
        (badge.hasUpdate ||
          badge.installState === "downloading" ||
          badge.installState === "extracting" ||
          badge.installState === "verifying" ||
          badge.installState === "ready"),
    );
  const hasActionableDesktopUpdate = Boolean(
    updateRun !== null ||
      (desktopUpdateState &&
        (desktopUpdateState.status === "downloading" ||
          resolveDesktopUpdateButtonAction(desktopUpdateState) !== "none")),
  );

  // Never render an idle / unavailable placeholder that clutters the footer or steals space.
  if (!hasPrismuxBadge && !hasActionableDesktopUpdate) {
    return null;
  }

  return (
    <SidebarMenu data-sidebar-active-update-banner="true" className="flex-row items-center pb-1">
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

export const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const { isMobile, isIconRail } = useSidebar();
  const railCompact = !isMobile && isIconRail;
  return (
    <SidebarFooter className={cn(railCompact && "px-1.5 pb-1.5")}>
      <div className={cn(railCompact && "hidden")} aria-hidden={railCompact || undefined}>
        <SidebarProviderUpdatePill />
        <SidebarActiveUpdateBanner />
        <SidebarUpdateArchitectureWarning />
      </div>
      <PrismuxSidebarUpdateCapsule railCompact={railCompact} />
      <SidebarUtilityMenu />
      <PrismuxAutoUpdateHost />
    </SidebarFooter>
  );
});
