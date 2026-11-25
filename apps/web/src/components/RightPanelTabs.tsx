import { msg, T, useGT, useLocale, useMessages } from "gt-react";
import { getActiveLocale, m, type MessageResolver } from "../i18n/messages";
import { sourceControlClients } from "@prismux/client-runtime/source-control-clients";
import { parseScopedThreadKey, scopeThreadRef } from "@prismux/client-runtime/environment";
import { runAtomCommand } from "@prismux/client-runtime/state/runtime";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@prismux/client-runtime/state/shell";
import {
  useProjects,
  useQuietThreadShell,
  useServerConfigs,
  useThreadShells,
} from "~/state/entities";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@prismux/client-runtime/thread-pull-requests";
import type {
  ContextMenuItem,
  EnvironmentId,
  IssueTrackerKind,
  PreviewSessionSnapshot,
  PreviewViewportSetting,
  ProjectId,
  PullRequestState,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  ThreadId,
} from "@prismux/core-contracts";
import {
  DEFAULT_MOBILE_SIMULATOR_PRESET_ID,
  findPreviewViewportPreset,
  resolvePreviewViewport,
} from "@prismux/core-shared/previewViewport";
import { getTerminalLabel } from "@prismux/core-shared/terminalLabelsCopy";
import { formatSubagentDisplayTitle } from "@prismux/client-runtime/state/subagent-display";
import {
  closestCenter,
  DndContext,
  type Announcements,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Bot,
  CircleDotIcon,
  Smartphone,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileDiff,
  Files,
  Globe2,
  GripVertical,
  Image as ImageIcon,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  Network,
  Plus,
  RotateCcw,
  TabletSmartphone,
  TerminalSquare,
  Volume2Icon,
  VolumeOffIcon,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import { linkedThreadTitle } from "~/linkedThreadSurface";
import {
  DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER,
  resolveRightPanelActivityBarLayout,
  useRightPanelStore,
  type RightPanelActivityItemId,
  type RightPanelSurface,
} from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { issueStatePresentation } from "~/components/issue/issuePresentation";
import { issueEnvironment } from "~/state/issues";
import { resolveShortcutCommand, type ShortcutMatchContext } from "~/keybindings";
import { readLocalApi } from "~/localApi";
import { useStableCallback } from "~/hooks/useStableCallback";
import { Button } from "~/components/ui/button";
import { AndroidIcon, AppleIcon } from "~/components/Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useBrowserDefaults } from "~/browser/browserDefaults";
import { BrowserDeviceToolbar } from "~/browser/BrowserDeviceToolbar";
import {
  PhoneBezelChassis,
  resolvePhoneBezelChassisLayout,
  savePhoneBezelEnabled,
} from "~/browser/HostedBrowserWebview";
import { openUrlInPreview } from "~/browser/openFileInPreview";
import { AgentBrandLogo } from "~/prismux/agentBrand";
import { useOptionalPrismuxRuntime } from "~/prismux/PrismuxRuntimeProvider";
import { resolvePortOpenUrl } from "~/prismux/statusBar/portsPolling";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { previewEnvironment } from "~/state/preview";
import { ScrollArea } from "~/components/ui/scroll-area";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { faviconUrlForOrigin } from "@prismux/core-shared/favicon";
import { useTheme } from "~/hooks/useTheme";
import { useDeviceState } from "~/state/device";
import type { PreviewPanelInlineSize } from "~/hooks/usePreviewPanelInlineSize";
import {
  newestPullRequestSummary,
  pullRequestEnvironment,
  useSharedPullRequestSummary,
} from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { FaviconImage } from "./preview/PreviewFaviconIcon";
import { previewBridge } from "./preview/previewBridge";
import { dispatchPreviewAction } from "./preview/previewActionBus";
import { preventThumbButtonFocus, takeThumbButtonNavigation } from "./preview/thumbButtons";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import { resolvePullRequestState } from "./pullRequest/pullRequestPresentation";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { observeResize } from "~/lib/observeResize";
import {
  formatBrowserProfileLabel,
  resolveBrowserProfileBadgeLabel,
} from "~/lib/browserProfileLabel";
import { surfaceShortcutKey } from "~/lib/surfaceShortcutKey";
import {
  dispatchSplitDragEvent,
  hasSplitDragMime,
  readSplitDragDataTransfer,
  writeSplitDragDataTransfer,
  type SplitDragPayload,
} from "./workspace/splitAnything.logic";
import { useWorkspaceTopbarPortal } from "./workspace/WorkspaceTopbarPortalContext";

export interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  open?: boolean;
  keybindings: ResolvedKeybindingsConfig;
  getShortcutContext: () => ShortcutMatchContext;
  widthStorageKey?: string;
  defaultWidth?: number;
  inlineSize?: PreviewPanelInlineSize;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  environmentId: EnvironmentId | null;
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  /** Maps server-local session ids to desktop runtime ids; session ids cannot address desktop operations. */
  previewRuntimeTabId?: ((tabId: string) => string) | undefined;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onRenameDevice?: (surfaceId: string, title: string) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  /** Moves a subagent, side chat or linked thread tab to the main screen. */
  onOpenInMainView?: (
    surface: Extract<RightPanelSurface, { kind: "thread" | "linked-thread" }>,
  ) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onMoveSurface?: (surfaceId: string, toIndex: number) => void;
  onCopyFilePath: (relativePath: string) => void;
  onDuplicateBrowser?: (surface: RightPanelSurface) => void;
  onAddBrowser: () => void;
  /** Keep separate from the DOM click handler so a MouseEvent cannot become a profile id. */
  onAddBrowserInProfile: (profileId: string) => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  /** Kept optional for backwards compatibility; PR tabs open via Linked items (`已关联项`). */
  onAddPullRequest?: (() => void) | undefined;
  onAddPullRequests: () => void;
  onAddDevice: () => void;
  /** Kept optional for backwards compatibility; Wallpaper sidebar opens from the topbar toggle. */
  onAddWallpaper?: (() => void) | undefined;
  /** Absent where side questions are not offered. */
  onAddSideChat?: (() => void) | undefined;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  /** Kept optional for backwards compatibility. */
  pullRequestAvailable?: boolean | undefined;
  pullRequestsAvailable: boolean;
  deviceAvailable: boolean;
  wallpaperAvailable?: boolean;
  sideChatAvailable?: boolean;
  /** Overrides the default reason while side questions are available but cannot start. */
  sideChatDisabledReason?: string | null;
  pullRequestStatusSeeds?: Readonly<Record<string, PullRequestTabStatusSeed>>;
  children: ReactNode;
}

export interface PullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

export type PullRequestTabStatusSeed = Pick<PullRequestTabStatus, "state" | "isDraft">;

function shouldOpenDefaultBrowserProfileFromMenuClick(pointerType: string | undefined): boolean {
  return pointerType !== "touch";
}

const SIDE_QUESTION_MSG = msg("Side question");

function isChineseLocale(locale?: string | null): boolean {
  const effective = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return effective.startsWith("zh");
}

/**
 * Resolves the unified BTW side-question label across locales:
 * renders `"旁路提问"` in Chinese UI even before a dedicated GT hash entry lands,
 * and `"Side question"` in English UI (or translated string in any other locale).
 */
export function resolveSideQuestionLabel(
  resolve: MessageResolver = m,
  locale?: string | null,
): string {
  const translated = resolve(SIDE_QUESTION_MSG);
  if (translated !== "Side question") {
    return translated;
  }
  return isChineseLocale(locale) ? "旁路提问" : translated;
}

const SURFACE_DISABLED_REASONS = {
  browser: msg("Browser previews are only available in the Prismux desktop app."),
  terminal: msg("Terminal surfaces are only available from a project thread."),
  files: msg("Files are only available when a project is open."),
  diff: msg("Diff is only available for server threads in Git repositories."),
  pullRequests: msg("This thread has no linked items."),
  sideChat: msg("Side chats start after the first message."),
} as const;

// Closed keepMounted popups must stop blocking shortcuts once their exit transition ends.
const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  "dialog-popup",
  "alert-dialog-popup",
  "command-dialog-popup",
  "menu-popup",
  "select-popup",
  "popover-popup",
  "combobox-popup",
  "autocomplete-popup",
]
  .map((slot) => `[data-slot="${slot}"]:is([data-open],[data-ending-style])`)
  .join(",");

const SURFACE_UNAVAILABLE_HINTS = {
  browser: msg("Only available in the desktop app."),
  terminal: msg("Available when a project is open."),
  files: msg("Available when a project is open."),
  diff: msg("Available for Git repositories."),
  pullRequests: msg("No linked items available."),
  sideChat: msg("Available after the first message."),
} as const;

type TabContextMenuAction =
  | "open-in-main-view"
  | "rename"
  | "copy-path"
  | "duplicate"
  | "toggle-mute"
  | "close"
  | "close-others"
  | "close-to-right"
  | "close-all";

const TAB_SCROLL_EDGE_TOLERANCE = 1;
const TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];

function tabScrollViewport(root: HTMLDivElement | null): HTMLDivElement | null {
  return root?.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]') ?? null;
}

function previewTabIdOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string | null {
  if (surface.kind !== "preview" || !surface.resourceId) return null;
  return sessions[surface.resourceId]?.tabId ?? null;
}

/**
 * Stays disabled until desktop overlay state arrives: a server session id can
 * resolve while the preview manager's createTab is still in flight, and muting
 * then fails with a PreviewTabNotFoundError nothing surfaces to the user.
 */
function tabMuteMenuItem(
  input: {
    overlay: DesktopPreviewOverlay | null;
    canResolveRuntimeTabId: boolean;
  },
  resolve: MessageResolver = m,
): { label: string; disabled: boolean } {
  const muted = input.overlay?.audioMuted ?? false;
  return {
    label: muted ? resolve(msg("Unmute tab")) : resolve(msg("Mute tab")),
    disabled: input.overlay === null || !input.canResolveRuntimeTabId,
  };
}

type TabAudioState = "none" | "audible" | "muted";

function tabAudioState(overlay: DesktopPreviewOverlay | null): TabAudioState {
  if (!overlay?.audible) return "none";
  return overlay.audioMuted ? "muted" : "audible";
}

type SurfaceShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey"
> &
  Partial<Pick<KeyboardEvent, "code" | "getModifierState">>;

export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = surfaceShortcutKey(event);
  return (
    actions.find((action) => action.available && action.shortcut.toLowerCase() === key) ?? null
  );
}

/** Skip contenteditable=false islands to find their editable host, matching the composer typing guard. */
export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  itemId?: RightPanelActivityItemId;
  available: boolean;
  disabledReason?: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      data-surface-menu-item={props.itemId}
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
      aria-keyshortcuts={props.shortcut}
    >
      {props.children}
      <MenuShortcut>{props.shortcut}</MenuShortcut>
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

export interface RightPanelLauncherAction {
  readonly id: RightPanelActivityItemId;
  readonly label: string;
  readonly icon: typeof Globe2;
  readonly shortcut: "L" | "D" | "F" | "T" | "B" | "I" | "S";
  readonly available: boolean;
  readonly disabledReason: string;
  readonly onClick: () => void;
}

export interface BuildRightPanelLauncherActionsInput {
  readonly order: readonly RightPanelActivityItemId[];
  readonly resolveMessage: MessageResolver;
  readonly locale?: string | null;
  readonly disabledReasonStyle: "hint" | "reason";
  readonly includeSideChat: boolean;
  readonly availability: {
    readonly pullRequests: boolean;
    readonly diff: boolean;
    readonly files: boolean;
    readonly terminal: boolean;
    readonly preview: boolean;
    readonly mobileSimulator: boolean;
    readonly sideChat: boolean;
  };
  readonly sideChatDisabledReason?: string | null;
  readonly handlers: {
    readonly onPullRequests: () => void;
    readonly onDiff: () => void;
    readonly onFiles: () => void;
    readonly onTerminal: () => void;
    readonly onPreview: () => void;
    readonly onMobileSimulator: () => void;
    readonly onSideChat?: (() => void) | undefined;
  };
}

/**
 * Pure builder shared by the empty-state launcher ("打开面板") and the top `+` dropdown menu.
 * Follows the exact live `activityBarOrder` so top bar, bottom launcher, and `+` menu always stay in sync.
 */
export function buildRightPanelLauncherActions(
  input: BuildRightPanelLauncherActionsInput,
): RightPanelLauncherAction[] {
  const {
    order,
    resolveMessage,
    locale,
    disabledReasonStyle,
    includeSideChat,
    availability,
    sideChatDisabledReason,
    handlers,
  } = input;
  const reasons =
    disabledReasonStyle === "hint" ? SURFACE_UNAVAILABLE_HINTS : SURFACE_DISABLED_REASONS;

  const actionMap: Record<RightPanelActivityItemId, RightPanelLauncherAction> = {
    "pull-requests": {
      id: "pull-requests",
      label: resolveMessage(msg("Linked items")),
      icon: PullRequestGlyph.link,
      shortcut: "L",
      available: availability.pullRequests,
      disabledReason: resolveMessage(reasons.pullRequests),
      onClick: handlers.onPullRequests,
    },
    diff: {
      id: "diff",
      label: resolveMessage(msg("Diff")),
      icon: FileDiff,
      shortcut: "D",
      available: availability.diff,
      disabledReason: resolveMessage(reasons.diff),
      onClick: handlers.onDiff,
    },
    files: {
      id: "files",
      label: resolveMessage(msg("Files")),
      icon: Files,
      shortcut: "F",
      available: availability.files,
      disabledReason: resolveMessage(reasons.files),
      onClick: handlers.onFiles,
    },
    terminal: {
      id: "terminal",
      label: resolveMessage(msg("Terminal")),
      icon: TerminalSquare,
      shortcut: "T",
      available: availability.terminal,
      disabledReason: resolveMessage(reasons.terminal),
      onClick: handlers.onTerminal,
    },
    preview: {
      id: "preview",
      label: resolveMessage(msg("Browser")),
      icon: Globe2,
      shortcut: "B",
      available: availability.preview,
      disabledReason: resolveMessage(reasons.browser),
      onClick: handlers.onPreview,
    },
    "mobile-simulator": {
      id: "mobile-simulator",
      label: "手机模拟",
      icon: TabletSmartphone,
      shortcut: "I",
      available: availability.mobileSimulator,
      disabledReason: resolveMessage(reasons.browser),
      onClick: handlers.onMobileSimulator,
    },
    "side-chat": {
      id: "side-chat",
      label: resolveSideQuestionLabel(resolveMessage, locale),
      icon: MessageSquarePlus,
      shortcut: "S",
      available: availability.sideChat,
      disabledReason: sideChatDisabledReason ?? resolveMessage(reasons.sideChat),
      onClick: () => handlers.onSideChat?.(),
    },
  };

  const result: RightPanelLauncherAction[] = [];
  for (const id of order) {
    if (id === "side-chat" && !includeSideChat) continue;
    const action = actionMap[id];
    if (action) result.push(action);
  }
  return result;
}

const EMPTY_STATE_DRAG_MODIFIERS = [restrictToVerticalAxis];

export function applyRightPanelActivityDragEnd(
  event: Pick<DragEndEvent, "active" | "over">,
  onReorder: (fromId: RightPanelActivityItemId, toId: RightPanelActivityItemId) => void,
): boolean {
  const { active, over } = event;
  if (!over || active.id === over.id) return false;
  onReorder(active.id as RightPanelActivityItemId, over.id as RightPanelActivityItemId);
  return true;
}

function SortableEmptyStateActionRow(props: {
  readonly action: RightPanelLauncherAction;
  readonly highlighted: boolean;
  readonly browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onAddBrowserInProfile: (profileId: string) => void;
  readonly onHighlight: () => void;
  readonly onClearHighlight: () => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const { action, highlighted, browserProfiles, onAddBrowserInProfile } = props;
  const Icon = action.icon;
  const {
    attributes: {
      "aria-pressed": _dndAriaPressed,
      role: _dndRole,
      tabIndex: _dndTabIndex,
      ...sortableAttributes
    },
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: action.id });

  const iconNode = (
    <span className="relative inline-flex shrink-0">
      <Icon className="size-4" />
    </span>
  );

  return (
    <div
      ref={setNodeRef}
      data-launcher-item={action.id}
      data-launcher-sortable="true"
      data-dragging={isDragging ? "true" : "false"}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      {...listeners}
      className={cn(
        "group relative flex h-8 w-full items-center rounded-(--control-radius) transition-colors",
        action.available
          ? "hover:bg-accent/60"
          : "cursor-grab hover:bg-accent/30 active:cursor-grabbing",
        action.available && highlighted && "bg-accent/60",
        isDragging && "z-20 bg-accent/80 opacity-80 shadow-sm ring-1 ring-primary/50",
      )}
      onMouseEnter={action.available ? props.onHighlight : undefined}
      onMouseLeave={action.available ? props.onClearHighlight : undefined}
    >
      <span
        {...sortableAttributes}
        data-launcher-drag-handle={action.id}
        aria-label={`拖拽调整「${action.label}」顺序`}
        className={cn(
          "inline-flex h-8 w-5 shrink-0 cursor-grab items-center justify-center pl-1 text-muted-foreground transition-opacity active:cursor-grabbing",
          "opacity-35 group-hover:opacity-85 group-focus-within:opacity-85",
          isDragging && "opacity-100 text-foreground",
        )}
      >
        <GripVertical aria-hidden className="size-3.5" />
      </span>
      {action.available ? (
        <>
          <button
            type="button"
            onClick={action.onClick}
            className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2.5 pr-2.5 pl-1 text-left text-sm outline-none"
          >
            {iconNode}
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                action.id === "preview" && browserProfiles.length > 1 && "pr-7",
              )}
            >
              {action.label}
            </span>
            <Kbd>{action.shortcut}</Kbd>
          </button>
          {action.id === "preview" && browserProfiles.length > 1 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label={gt("Open browser in a profile")}
                    className="absolute top-1/2 right-8 -translate-y-1/2"
                    size="icon-xs"
                    variant="ghost-muted"
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                }
              >
                <ChevronDown className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" side="bottom" sideOffset={6} className="max-w-56">
                {browserProfiles.map((profile) => (
                  <MenuItem key={profile.id} onClick={() => onAddBrowserInProfile(profile.id)}>
                    <span className="min-w-0 truncate">
                      {formatBrowserProfileLabel(profile, locale)}
                    </span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : null}
        </>
      ) : (
        <DisabledReasonTooltip
          reason={action.disabledReason}
          trigger={
            <div
              tabIndex={0}
              aria-disabled="true"
              className="flex h-8 min-w-0 flex-1 cursor-grab items-center gap-2.5 pr-2.5 pl-1 text-left text-sm opacity-50 active:cursor-grabbing"
            >
              {iconNode}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
              <Kbd>{action.shortcut}</Kbd>
            </div>
          }
        />
      )}
    </div>
  );
}

export function RightPanelEmptyState(props: {
  readonly actions: readonly RightPanelLauncherAction[];
  readonly browserProfiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onAddBrowserInProfile: (profileId: string) => void;
  readonly isCustomOrder: boolean;
  readonly onReorder: (
    fromId: RightPanelActivityItemId,
    toId: RightPanelActivityItemId,
  ) => void;
  readonly onResetOrder: () => void;
}) {
  const gt = useGT();
  const [highlight, setHighlight] = useState(-1);
  const { actions } = props;

  // PointerSensor distance=5px matches RightPanelActivityBar so clicks stay crisp and never misfire as drags.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const availableActions = actions.filter((action) => action.available);
  const highlightIndex =
    availableActions.length === 0 ? -1 : Math.min(highlight, availableActions.length - 1);

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    const action = surfaceShortcutActionForKey(availableActions, event);
    if (!action) return;
    if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    const target = event.composedPath()[0] ?? event.target;
    if (target instanceof Element && surfaceShortcutTargetsTypingContext(target)) return;
    event.preventDefault();
    event.stopPropagation();
    action.onClick();
  });
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes a capture-phase window keydown listener for surface shortcuts while the menu is mounted
  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (availableActions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % availableActions.length);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHighlight(
        highlightIndex === -1
          ? availableActions.length - 1
          : (highlightIndex - 1 + availableActions.length) % availableActions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      if (event.target !== event.currentTarget) return;
      const action = availableActions[highlightIndex];
      if (!action) return;
      event.preventDefault();
      action.onClick();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setHighlight(-1);
    applyRightPanelActivityDragEnd(event, props.onReorder);
  };

  const isHighlighted = (action: RightPanelLauncherAction) =>
    highlightIndex !== -1 && availableActions[highlightIndex] === action;

  const announcements = buildActivityBarDragAnnouncements(actions);

  return (
    <div
      data-workspace-focus-default
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={gt("Open a surface")}
      data-testid="right-panel-empty-launcher"
      data-surface-launcher-keys={availableActions.map((action) => action.shortcut).join("")}
      className={cn(
        "scrollbar-gutter-both flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 outline-none",
        "pb-(--workspace-topbar-height)",
      )}
    >
      <div className="w-full max-w-xs py-6">
        <div className="mb-3 flex items-center justify-center gap-2">
          <h3 className="font-medium text-foreground text-sm">
            <T>Open a surface</T>
          </h3>
          {props.isCustomOrder ? (
            <button
              type="button"
              data-testid="right-panel-empty-reset-order"
              onClick={props.onResetOrder}
              className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-1.5 text-2xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent/70 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <RotateCcw aria-hidden className="size-3 shrink-0" />
              <span>重置默认排序</span>
            </button>
          ) : null}
        </div>
        <DndContext
          id="right-panel-empty-state-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={EMPTY_STATE_DRAG_MODIFIERS}
          accessibility={{ announcements }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={actions.map((action) => action.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-0.5" data-testid="right-panel-empty-launcher-list">
              {actions.map((action) => (
                <SortableEmptyStateActionRow
                  key={action.id}
                  action={action}
                  highlighted={isHighlighted(action)}
                  browserProfiles={props.browserProfiles}
                  onAddBrowserInProfile={props.onAddBrowserInProfile}
                  onHighlight={() => setHighlight(availableActions.indexOf(action))}
                  onClearHighlight={() =>
                    setHighlight((current) =>
                      current === availableActions.indexOf(action) ? -1 : current,
                    )
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
  resolve: MessageResolver = m,
  locale?: string | null,
): string {
  switch (surface.kind) {
    case "diff":
      return resolve(msg("Diff"));
    case "files":
      return resolve(msg("Files"));
    case "file":
      return surface.relativePath.slice(
        Math.max(surface.relativePath.lastIndexOf("/"), surface.relativePath.lastIndexOf("\\")) + 1,
      );
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId, resolve)
      );
    case "pull-request":
      return `#${surface.number}`;
    case "pull-request-empty":
      return resolve(msg("PR"));
    case "pull-requests":
      return resolve(msg("Linked items"));
    case "issue":
      // A git host numbers its issues; a tracker with keys of its own, such as Linear, names them.
      return /^\d+$/.test(surface.key) ? `#${surface.key}` : surface.key;
    case "device":
      return surface.title ?? surface.target?.name ?? resolve(msg("Device"));
    case "wallpaper":
      return "壁纸";
    case "agent-session":
      return surface.title;
    case "agent-aux":
      return surface.title || "智能体协同";
    case "thread":
      // Until the thread's own title loads.
      return resolve(msg("Thread"));
    case "side-chat-empty":
      return resolveSideQuestionLabel(resolve, locale);
    case "linked-thread":
      return linkedThreadTitle(
        surface,
        resolve(msg("Thread on {label}", { label: surface.label })),
      );
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return resolve(msg("Browser"));
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || resolve(msg("Browser"));
      } catch {
        return resolve(msg("Browser"));
      }
    }
  }
}

function PreviewFavicon({ capturedUrl, url }: { capturedUrl: string | null; url: string | null }) {
  const publicProviderUrl = faviconUrlForOrigin(url, 32);
  return (
    <FaviconImage
      sources={[capturedUrl, publicProviderUrl]}
      fallback={<Globe2 className="size-3 shrink-0" />}
      className="size-3 shrink-0 rounded-sm object-contain"
    />
  );
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function previewFaviconOf(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>,
): { url: string | null; capturedUrl: string | null } {
  const snapshot =
    surface.kind === "preview" && surface.resourceId ? sessions[surface.resourceId] : null;
  const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
  const favicon = snapshot ? (desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
  const capturedUrl = favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null;
  return { url, capturedUrl };
}

function SurfaceIcon({
  surface,
  previewUrl,
  previewCapturedUrl,
  theme,
  environmentId,
  pullRequestStatusSeed,
}: {
  surface: RightPanelSurface;
  previewUrl: string | null;
  previewCapturedUrl: string | null;
  theme: "light" | "dark";
  environmentId: EnvironmentId | null;
  pullRequestStatusSeed: PullRequestTabStatusSeed | undefined;
}) {
  switch (surface.kind) {
    case "preview":
      return <PreviewFavicon capturedUrl={previewCapturedUrl} url={previewUrl} />;
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "pull-request":
      return (
        <PullRequestSurfaceIcon
          surface={surface}
          environmentId={environmentId}
          seed={pullRequestStatusSeed}
        />
      );
    case "pull-request-empty":
      return <PullRequestGlyph.pullRequest className="size-3 shrink-0" />;
    case "pull-requests":
      return <PullRequestGlyph.link className="size-3 shrink-0" />;
    case "issue":
      return <IssueSurfaceIcon surface={surface} environmentId={environmentId} />;
    case "thread":
      return <SideChatTabIcon environmentId={environmentId} threadId={surface.threadId} />;
    case "side-chat-empty":
      return <MessageSquarePlus className="size-3 shrink-0" />;
    case "linked-thread":
      return <MessagesSquare className="size-3 shrink-0" />;
    case "device":
      return surface.target?.platform === "ios" ? (
        <AppleIcon className="size-3 shrink-0" />
      ) : surface.target?.platform === "android" ? (
        <AndroidIcon className="size-3 shrink-0" />
      ) : (
        <Smartphone className="size-3 shrink-0" />
      );
    case "wallpaper":
      return <ImageIcon className="size-3 shrink-0" />;
    case "agent-session":
      return <AgentBrandLogo provider={surface.providerId} size={12} className="shrink-0" />;
    case "agent-aux":
      return surface.auxKind === "agy-swarm" ? (
        <span
          aria-hidden
          className="inline-flex size-3 shrink-0 items-center justify-center text-[11px] leading-none"
        >
          🐝
        </span>
      ) : (
        <AgentBrandLogo
          provider={surface.provider ?? "antigravity"}
          size={12}
          className="shrink-0"
        />
      );
  }
}

const SIDE_CHAT_STATE_LABELS = {
  "needs approval": msg("needs approval"),
  "needs input": msg("needs input"),
  running: msg("running", { $context: "side chat status" }),
} as const;

/** What a side chat tab's dot shows and its title's accessible name says. */
function sideChatTabState(shell: EnvironmentThreadShell | null) {
  if (shell === null) return null;
  if (shell.hasPendingApprovals || shell.pendingSubagentRequest === "approval") {
    return "needs approval";
  }
  if (shell.hasPendingUserInput || shell.pendingSubagentRequest === "user_input") {
    return "needs input";
  }
  return threadRuntimeIsActive(shell.runtime) ? "running" : null;
}

// Static dots: a side chat or subagent tab can stay open for a whole run.
function SideChatTabIcon(props: { environmentId: EnvironmentId | null; threadId: ThreadId }) {
  const shell = useQuietThreadShell(
    props.environmentId === null ? null : scopeThreadRef(props.environmentId, props.threadId),
  );
  const state = sideChatTabState(shell);
  const Icon = shell !== null && shell.lineage.sideChat !== true ? Bot : MessageSquarePlus;
  return (
    <>
      <Icon className="size-3 shrink-0" />
      {state === null ? null : (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 size-1.5 rounded-full",
            state === "running" ? "bg-muted-foreground" : "bg-info",
          )}
          aria-hidden
        />
      )}
    </>
  );
}

export function resolvePullRequestTabLink(
  threads: readonly Pick<EnvironmentThreadShell, "environmentId" | "pullRequests">[],
  environmentId: EnvironmentId | null,
  host: string | null,
  reference: { repository: string; number: number },
) {
  if (environmentId === null || host === null) return undefined;
  // Keys are cached per object, so one target normalizes once instead of once per link.
  const target = { host, repository: reference.repository, number: reference.number };
  let newest: EnvironmentThreadShell["pullRequests"][number] | undefined;
  for (const thread of threads) {
    if (thread.environmentId !== environmentId) continue;
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      if (!threadPullRequestKeysEqual(link, target)) continue;
      if (
        newest === undefined ||
        (link.snapshot?.syncedAt ?? "") > (newest.snapshot?.syncedAt ?? "")
      )
        newest = link;
    }
  }
  return newest;
}

/** The issue's own state mark, from the detail its panel already reads; a plain dot until then. */
function IssueSurfaceIcon({
  surface,
  environmentId,
}: {
  surface: Extract<RightPanelSurface, { kind: "issue" }>;
  environmentId: EnvironmentId | null;
}) {
  const resolvedEnvironmentId =
    (surface.environmentId as EnvironmentId | undefined) ?? environmentId;
  const detail = useEnvironmentQuery(
    resolvedEnvironmentId === null
      ? null
      : issueEnvironment.detail({
          environmentId: resolvedEnvironmentId,
          input: {
            projectId: surface.projectId as ProjectId,
            tracker: surface.tracker as IssueTrackerKind,
            ...(surface.host ? { host: surface.host } : {}),
            scope: surface.scope,
            key: surface.key,
          },
        }),
  ).data;
  if (detail === null) return <CircleDotIcon className="size-3 shrink-0" />;
  const presentation = issueStatePresentation(detail.state);
  return (
    <presentation.Icon
      role="img"
      aria-label={presentation.label}
      className={cn("size-3 shrink-0", presentation.toneClassName)}
    />
  );
}

function PullRequestSurfaceIcon({
  surface,
  environmentId,
  seed,
}: {
  surface: Extract<RightPanelSurface, { kind: "pull-request" }>;
  environmentId: EnvironmentId | null;
  seed: PullRequestTabStatusSeed | undefined;
}) {
  const resolvedEnvironmentId =
    (surface.environmentId as EnvironmentId | undefined) ?? environmentId;
  const projects = useProjects();
  const threads = useThreadShells();
  const project = projects.find(
    (entry) => entry.environmentId === resolvedEnvironmentId && entry.id === surface.projectId,
  );
  const identity = project?.repositoryIdentity;
  const host =
    surface.host ??
    (identity?.provider
      ? sourceControlClients.changeRequestHost(identity, identity.provider)
      : null);
  const configs = useServerConfigs();
  const capabilities =
    resolvedEnvironmentId === null
      ? undefined
      : configs.get(resolvedEnvironmentId)?.environment.capabilities;
  const linkedSnapshot =
    capabilities !== undefined
      ? (resolvePullRequestTabLink(threads, resolvedEnvironmentId, host, surface)?.snapshot ?? null)
      : null;
  const detail = useEnvironmentQuery(
    resolvedEnvironmentId === null || capabilities === undefined || linkedSnapshot !== null
      ? null
      : pullRequestEnvironment.detail({
          environmentId: resolvedEnvironmentId,
          input: {
            projectId: surface.projectId as ProjectId,
            ...(capabilities !== undefined && surface.host !== undefined
              ? { host: surface.host }
              : {}),
            repository: surface.repository,
            number: surface.number,
            allowStale: false,
          },
        }),
  ).data;
  const reference = {
    projectId: surface.projectId as ProjectId,
    repository: surface.repository,
    number: surface.number,
  };
  const sharedSummary = useSharedPullRequestSummary(resolvedEnvironmentId, reference);
  const status = linkedSnapshot ?? newestPullRequestSummary(detail, sharedSummary) ?? seed ?? null;
  if (status === null) {
    return <PullRequestGlyph.pullRequest className="size-3 shrink-0 text-muted-foreground" />;
  }
  const presentation = resolvePullRequestState({
    state: status.state,
    isDraft: status.isDraft ?? detail?.isDraft ?? seed?.isDraft ?? false,
  });
  return <presentation.Icon className={cn("size-3 shrink-0", presentation.toneClassName)} />;
}

function SortableTabList(props: {
  surfaces: readonly RightPanelSurface[];
  onMove: ((surfaceId: string, toIndex: number) => void) | undefined;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const surfaceIds = props.surfaces.map((surface) => surface.id);
  const { onMove, surfaces } = props;
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const toIndex = surfaces.findIndex((surface) => surface.id === over.id);
    if (toIndex >= 0) onMove?.(String(active.id), toIndex);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={TAB_DRAG_MODIFIERS}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={surfaceIds} strategy={horizontalListSortingStrategy}>
        {props.children}
      </SortableContext>
    </DndContext>
  );
}

interface RightPanelTabHandlers {
  onActivate: (surface: RightPanelSurface) => void;
  onClose: (surface: RightPanelSurface) => void;
  onAuxClick: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
  onContextMenu: (event: ReactMouseEvent, surface: RightPanelSurface) => void;
  onStartRename: (surfaceId: string) => void;
  onFinishRename: (surfaceId: string, title: string) => void;
}

// Chromium on Linux only suppresses primary-selection paste when mouseup is cancelled.
function preventTabMiddleButtonDefault(event: ReactMouseEvent) {
  if (event.button !== 1) return;
  event.preventDefault();
}

function resolveRightPanelHostThreadRef(
  widthStorageKey: string | undefined,
): ScopedThreadRef | null {
  const prefix = "prismux:preview-panel-width:";
  if (!widthStorageKey || !widthStorageKey.startsWith(prefix)) return null;
  return parseScopedThreadKey(widthStorageKey.slice(prefix.length));
}

function buildRightPanelTabSplitPayload(input: {
  readonly surface: RightPanelSurface;
  readonly title: string;
  readonly hostThreadRef: ScopedThreadRef | null;
  readonly previewUrl: string | null;
}): SplitDragPayload {
  const { surface, title, hostThreadRef, previewUrl } = input;
  switch (surface.kind) {
    case "preview":
      return {
        kind: "right-panel-tab",
        surfaceId: surface.id,
        surfaceKind: surface.kind,
        title,
        hostThreadRef,
        resourceId: surface.resourceId,
        url: previewUrl,
      };
    case "terminal":
      return {
        kind: "right-panel-tab",
        surfaceId: surface.id,
        surfaceKind: surface.kind,
        title,
        hostThreadRef,
        resourceId: surface.activeTerminalId,
      };
    case "file":
      return {
        kind: "right-panel-tab",
        surfaceId: surface.id,
        surfaceKind: surface.kind,
        title,
        hostThreadRef,
        resourceId: surface.relativePath,
        relativePath: surface.relativePath,
      };
    case "thread":
      return {
        kind: "right-panel-tab",
        surfaceId: surface.id,
        surfaceKind: surface.kind,
        title,
        hostThreadRef,
        resourceId: surface.id,
        threadId: surface.threadId,
      };
    case "agent-session":
      return {
        kind: "right-panel-tab",
        surfaceId: surface.id,
        surfaceKind: surface.kind,
        title,
        hostThreadRef,
        resourceId: surface.id,
        providerId: surface.providerId,
        instanceId: surface.instanceId ?? null,
        threadId: surface.threadId ?? null,
      };
    default:
      return {
        kind: "right-panel-tab",
        surfaceId: surface.id,
        surfaceKind: surface.kind,
        title,
        hostThreadRef,
        resourceId: surface.id,
      };
  }
}

// Stable handlers and per-tab values let the compiler reuse tabs across parent renders.
function RightPanelTab(
  props: RightPanelTabHandlers & {
    surface: RightPanelSurface;
    surfaceIndex: number;
    hostThreadRef: ScopedThreadRef | null;
    onMoveSurface?: ((surfaceId: string, toIndex: number) => void) | undefined;
    dragDisabled: boolean;
    active: boolean;
    pending: boolean;
    title: string;
    audio: TabAudioState;
    audioRuntimeTabId: string | null;
    previewUrl: string | null;
    previewCapturedUrl: string | null;
    previewProfileId?: string | undefined;
    previewProfileBadge?: string | null | undefined;
    theme: "light" | "dark";
    environmentId: EnvironmentId | null;
    pullRequestStatusSeed: PullRequestTabStatusSeed | undefined;
    renaming: boolean;
    canRename: boolean;
    ownsDesktopTitleBar: boolean;
  },
) {
  const gt = useGT();
  const messages = useMessages();
  const {
    surface,
    surfaceIndex,
    hostThreadRef,
    onMoveSurface,
    audio,
    audioRuntimeTabId,
    onActivate,
    onClose,
    onAuxClick,
    onContextMenu,
    onStartRename,
    onFinishRename,
  } = props;
  const canDragOutToSplit = !props.renaming && surface.kind !== "wallpaper";
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: surface.id,
    disabled: props.dragDisabled || canDragOutToSplit,
  });
  const sideChatShell = useQuietThreadShell(
    surface.kind === "thread" && props.environmentId !== null
      ? scopeThreadRef(props.environmentId, surface.threadId)
      : null,
  );
  const title =
    sideChatShell === null
      ? props.title
      : sideChatShell.lineage.sideChat === true
        ? sideChatShell.title
        : formatSubagentDisplayTitle(sideChatShell.title);
  const sideChatState = sideChatTabState(sideChatShell);
  const content = (
    <>
      <PanelTabCloseButton label={gt("Close {title}", { title })} onClick={() => onClose(surface)}>
        <SurfaceIcon
          surface={surface}
          previewUrl={props.previewUrl}
          previewCapturedUrl={props.previewCapturedUrl}
          theme={props.theme}
          environmentId={props.environmentId}
          pullRequestStatusSeed={props.pullRequestStatusSeed}
        />
        {props.pending ? (
          <span
            className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
            aria-hidden
          />
        ) : null}
      </PanelTabCloseButton>
      {audio === "none" || !audioRuntimeTabId ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="cursor-pointer flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
                aria-label={
                  audio === "muted"
                    ? gt("Unmute {title}", { title })
                    : gt("Mute {title}", { title })
                }
                onClick={(event) => {
                  event.stopPropagation();
                  void previewBridge
                    ?.setAudioMuted(audioRuntimeTabId, audio !== "muted")
                    .catch(() => undefined);
                }}
              >
                {audio === "muted" ? (
                  <VolumeOffIcon className="size-3" />
                ) : (
                  <Volume2Icon className="size-3" />
                )}
              </button>
            }
          />
          <TooltipPopup>{audio === "muted" ? gt("Unmute tab") : gt("Mute tab")}</TooltipPopup>
        </Tooltip>
      )}
      {props.renaming ? (
        <input
          aria-label={gt("Device tab name")}
          className="w-24 min-w-0 rounded-sm bg-background px-1 outline-none ring-1 ring-inset ring-ring"
          defaultValue={title}
          ref={(element) => {
            element?.focus();
            element?.select();
          }}
          onBlur={(event) => onFinishRename(surface.id, event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = title;
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onDoubleClick={() => {
                  if (surface.kind === "device" && props.canRename) onStartRename(surface.id);
                }}
                className="cursor-pointer flex min-w-0 items-center"
                aria-label={
                  sideChatState === null
                    ? undefined
                    : gt("{title}, {state}", {
                        title,
                        state: messages(SIDE_CHAT_STATE_LABELS[sideChatState]),
                      })
                }
                onClick={() => onActivate(surface)}
              >
                <span className="truncate">{title}</span>
                {surface.kind === "preview" && props.previewProfileBadge ? (
                  <span
                    data-browser-profile-badge={props.previewProfileId ?? "custom"}
                    className="ml-1 inline-flex max-w-18 shrink-0 items-center truncate rounded-full border border-border/65 bg-muted/80 px-1.5 py-px text-[10px] leading-none font-medium text-muted-foreground"
                  >
                    {props.previewProfileBadge}
                  </span>
                ) : null}
                {surface.kind === "agent-aux" &&
                typeof surface.activeCount === "number" &&
                surface.activeCount > 0 ? (
                  <span
                    data-agent-aux-tab-badge="1"
                    className="ml-1 inline-flex shrink-0 items-center rounded-full bg-emerald-500/15 px-1 text-[10px] font-medium text-emerald-600 tabular-nums dark:text-emerald-400"
                  >
                    {surface.activeCount}
                  </span>
                ) : null}
              </button>
            }
          />
          <TooltipPopup>
            {surface.kind === "device" ? (
              <DeviceTabTooltip
                surface={surface}
                environmentId={props.environmentId}
                title={title}
              />
            ) : surface.kind === "preview" && props.previewProfileBadge ? (
              `${title} (${props.previewProfileBadge})`
            ) : (
              title
            )}
          </TooltipPopup>
        </Tooltip>
      )}
    </>
  );
  return (
    <div
      data-active-tab={props.active}
      data-right-panel-draggable-tab={canDragOutToSplit ? surface.id : undefined}
      draggable={canDragOutToSplit}
      onDragStart={(event) => {
        if (!canDragOutToSplit) return;
        const payload = buildRightPanelTabSplitPayload({
          surface,
          title,
          hostThreadRef,
          previewUrl: props.previewUrl,
        });
        writeSplitDragDataTransfer(event.dataTransfer, payload);
        dispatchSplitDragEvent(true, payload);
      }}
      onDragEnd={() => {
        dispatchSplitDragEvent(false, null);
      }}
      onDragOver={(event) => {
        if (!onMoveSurface || !hasSplitDragMime(event.dataTransfer.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (!onMoveSurface) return;
        const payload = readSplitDragDataTransfer(event.dataTransfer);
        if (!payload || payload.kind !== "right-panel-tab" || payload.surfaceId === surface.id) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        dispatchSplitDragEvent(false, null);
        onMoveSurface(payload.surfaceId, surfaceIndex);
      }}
      onMouseDown={preventTabMiddleButtonDefault}
      onMouseUp={preventTabMiddleButtonDefault}
      onAuxClick={(event) => onAuxClick(event, surface)}
      onContextMenu={(event) => onContextMenu(event, surface)}
      {...(canDragOutToSplit ? {} : listeners)}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md border pr-2 pl-1.5 text-xs transition-colors",
        props.ownsDesktopTitleBar && "[-webkit-app-region:no-drag]",
        props.active
          ? "border-primary/35 bg-primary/12 font-medium text-foreground shadow-2xs dark:border-primary/45 dark:bg-primary/22 dark:text-white [[data-pmx-glass='1']_&]:border-white/25 [[data-pmx-glass='1']_&]:bg-white/18 [[data-pmx-glass='1']_&]:text-white [html:not(.dark)[data-pmx-glass='1']_&]:border-black/15 [html:not(.dark)[data-pmx-glass='1']_&]:bg-white/75 [html:not(.dark)[data-pmx-glass='1']_&]:text-slate-950"
          : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground dark:hover:bg-white/8 [[data-pmx-glass='1']_&]:text-white/72 [[data-pmx-glass='1']_&]:hover:bg-white/10 [[data-pmx-glass='1']_&]:hover:text-white [html:not(.dark)[data-pmx-glass='1']_&]:text-slate-900/70 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-black/[0.06] [html:not(.dark)[data-pmx-glass='1']_&]:hover:text-slate-950",
        isDragging && "relative z-10",
      )}
    >
      {content}
    </div>
  );
}

export interface RightPanelActivityAction {
  readonly id: RightPanelActivityItemId;
  readonly label: string;
  readonly icon: typeof Globe2;
  readonly available: boolean;
  readonly active: boolean;
  readonly onClick: () => void;
}

/**
 * High-contrast Activity Bar pill styles across Light, Dark, Dark Glass, and Light Glass.
 * Active state uses solid primary fill + crisp border + elevated shadow so the focused surface
 * stands out unmistakably over solid panels and dynamic liquid-glass wallpapers alike.
 */
export function rightPanelActivityButtonClass(options: {
  readonly active: boolean;
  readonly compact: boolean;
  readonly available: boolean;
  readonly isDragging?: boolean;
}): string {
  const { active, compact, available, isDragging = false } = options;
  return cn(
    "inline-flex h-6 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border text-[11px] leading-none transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
    compact ? "w-6.5 px-0" : "max-w-23 px-1.5",
    active
      ? "border-primary/85 bg-primary font-semibold text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.22)] dark:border-primary/90 dark:bg-primary dark:text-primary-foreground [[data-pmx-glass='1']_&]:border-primary/90 [[data-pmx-glass='1']_&]:bg-primary [[data-pmx-glass='1']_&]:text-primary-foreground [[data-pmx-glass='1']_&]:shadow-[0_1px_4px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.26)] [html:not(.dark)[data-pmx-glass='1']_&]:border-primary/85 [html:not(.dark)[data-pmx-glass='1']_&]:bg-primary [html:not(.dark)[data-pmx-glass='1']_&]:text-primary-foreground [@media(forced-colors:active)]:border-[Highlight] [@media(forced-colors:active)]:bg-[Highlight] [@media(forced-colors:active)]:text-[HighlightText]"
      : "border-transparent bg-transparent font-medium text-foreground/68 hover:bg-black/[0.06] hover:text-foreground dark:text-white/68 dark:hover:bg-white/10 dark:hover:text-white [[data-pmx-glass='1']_&]:text-white/76 [[data-pmx-glass='1']_&]:hover:bg-white/12 [[data-pmx-glass='1']_&]:hover:text-white [html:not(.dark)[data-pmx-glass='1']_&]:text-slate-900/72 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-black/[0.07] [html:not(.dark)[data-pmx-glass='1']_&]:hover:text-slate-950",
    !available && "cursor-not-allowed opacity-45",
    isDragging && "relative z-20 opacity-60 shadow-sm ring-1 ring-primary/60",
  );
}

export interface BuildRightPanelActivityActionsInput {
  readonly order: readonly RightPanelActivityItemId[];
  readonly focusedSurfaceKind: RightPanelSurface["kind"] | null;
  readonly mobileSimulatorIdleActive: boolean;
  readonly resolveMessage: MessageResolver;
  readonly locale?: string | null;
  readonly availability: {
    readonly pullRequests: boolean;
    readonly diff: boolean;
    readonly files: boolean;
    readonly terminal: boolean;
    readonly preview: boolean;
    readonly mobileSimulator: boolean;
    readonly sideChat: boolean;
  };
  readonly handlers: {
    readonly onPullRequests: () => void;
    readonly onDiff: () => void;
    readonly onFiles: () => void;
    readonly onTerminal: () => void;
    readonly onPreview: () => void;
    readonly onMobileSimulator: () => void;
    readonly onSideChat: () => void;
  };
}

/**
 * Pure builder for the 7 canonical right-panel Activity Bar shortcuts:
 * 已关联项 -> 差异 -> 文件 -> 终端 -> 浏览器 -> 手机模拟 -> 旁路提问.
 * Strictly excludes PR (`pull-request`), Wallpaper (`wallpaper`), and legacy `device` items,
 * and enforces `手机模拟` (without `器`) + `MessageSquarePlus` for `旁路提问`.
 */
export function buildRightPanelActivityActions(
  input: BuildRightPanelActivityActionsInput,
): RightPanelActivityAction[] {
  const {
    order,
    focusedSurfaceKind,
    mobileSimulatorIdleActive,
    resolveMessage,
    locale,
    availability,
    handlers,
  } = input;

  const actionMap: Record<RightPanelActivityItemId, RightPanelActivityAction> = {
    "pull-requests": {
      id: "pull-requests",
      label: resolveMessage(msg("Linked items")),
      icon: PullRequestGlyph.link,
      available: availability.pullRequests,
      active: focusedSurfaceKind === "pull-requests",
      onClick: handlers.onPullRequests,
    },
    diff: {
      id: "diff",
      label: resolveMessage(msg("Diff")),
      icon: FileDiff,
      available: availability.diff,
      active: focusedSurfaceKind === "diff",
      onClick: handlers.onDiff,
    },
    files: {
      id: "files",
      label: resolveMessage(msg("Files")),
      icon: Files,
      available: availability.files,
      active: focusedSurfaceKind === "files" || focusedSurfaceKind === "file",
      onClick: handlers.onFiles,
    },
    terminal: {
      id: "terminal",
      label: resolveMessage(msg("Terminal")),
      icon: TerminalSquare,
      available: availability.terminal,
      active: focusedSurfaceKind === "terminal",
      onClick: handlers.onTerminal,
    },
    preview: {
      id: "preview",
      label: resolveMessage(msg("Browser")),
      icon: Globe2,
      available: availability.preview,
      active: focusedSurfaceKind === "preview" && !mobileSimulatorIdleActive,
      onClick: handlers.onPreview,
    },
    "mobile-simulator": {
      id: "mobile-simulator",
      label: "手机模拟",
      icon: TabletSmartphone,
      available: availability.mobileSimulator,
      active: focusedSurfaceKind === "preview" && mobileSimulatorIdleActive,
      onClick: handlers.onMobileSimulator,
    },
    "side-chat": {
      id: "side-chat",
      label: resolveSideQuestionLabel(resolveMessage, locale),
      icon: MessageSquarePlus,
      available: availability.sideChat,
      active: focusedSurfaceKind === "thread" || focusedSurfaceKind === "side-chat-empty",
      onClick: handlers.onSideChat,
    },
  };

  return order.map((id) => actionMap[id]);
}

const ACTIVITY_BAR_DRAG_MODIFIERS = [restrictToHorizontalAxis];

/**
 * Modeled after Orca `right-sidebar/activity-bar/activity-bar-drag-announcements.ts`:
 * Announces human-readable tab labels instead of internal IDs for screen readers.
 */
function buildActivityBarDragAnnouncements(
  actions: readonly { readonly id: RightPanelActivityItemId; readonly label: string }[],
): Announcements {
  const title = (id: string | number): string =>
    actions.find((item) => item.id === id)?.label ?? String(id);
  return {
    onDragStart: ({ active }) => `已拿起「${title(active.id)}」标签`,
    onDragOver: ({ active, over }) =>
      over ? `正在将「${title(active.id)}」拖到「${title(over.id)}」上方` : undefined,
    onDragEnd: ({ active }) => `已放置「${title(active.id)}」标签`,
    onDragCancel: ({ active }) => `已取消移动「${title(active.id)}」标签`,
  };
}

/**
 * Modeled after Orca `right-sidebar/activity-bar/sortable-activity-button.tsx`:
 * Uses `@dnd-kit/sortable` with `PointerSensor` distance threshold (`5px`) so normal clicks
 * never misfire as drags and horizontal reordering animates smoothly via `CSS.Translate`.
 */
function SortableActivityBarButton(props: {
  readonly item: RightPanelActivityAction;
  readonly compact: boolean;
}) {
  const { item, compact } = props;
  const Icon = item.icon;
  const {
    attributes: { "aria-pressed": _dndAriaPressed, ...sortableAttributes },
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={setNodeRef}
            type="button"
            data-activity-item={item.id}
            data-activity-compact={compact ? "true" : "false"}
            data-active={item.active ? "true" : "false"}
            aria-label={item.label}
            aria-pressed={item.active}
            disabled={!item.available}
            onClick={(event) => {
              item.onClick();
              if (event.detail > 0) event.currentTarget.blur();
            }}
            style={{
              transform: CSS.Translate.toString(transform),
              transition,
            }}
            {...sortableAttributes}
            {...listeners}
            className={rightPanelActivityButtonClass({
              active: item.active,
              compact,
              available: item.available,
              isDragging,
            })}
          />
        }
      >
        <Icon aria-hidden className="size-3 shrink-0" />
        {!compact ? <span className="truncate">{item.label}</span> : null}
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {item.label}（拖拽调整顺序）
      </TooltipPopup>
    </Tooltip>
  );
}

export function RightPanelActivityBar(props: {
  readonly actions: readonly RightPanelActivityAction[];
  readonly isCustomOrder: boolean;
  readonly onReorder: (
    fromId: RightPanelActivityItemId,
    toId: RightPanelActivityItemId,
  ) => void;
  readonly onResetOrder: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number>(0);

  // PointerSensor distance=5px matches Orca `right-sidebar-top-activity-bar.tsx` so clicks stay crisp.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes ResizeObserver on a stable ref to avoid React 19 inline-ref churn
  useEffect(() => {
    const node = stripRef.current;
    if (!node) return;
    const measure = () => {
      const nextWidth = Math.round(node.clientWidth);
      setAvailableWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };
    measure();
    return observeResize(node, measure);
  }, []);

  const { visible, overflow, compactIds } = resolveRightPanelActivityBarLayout(
    props.actions,
    availableWidth,
  );

  const handleDragEnd = (event: DragEndEvent) => {
    applyRightPanelActivityDragEnd(event, props.onReorder);
  };

  if (props.actions.length === 0) return null;

  const announcements = buildActivityBarDragAnnouncements(props.actions);

  return (
    <DndContext
      id="right-panel-activity-bar-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={ACTIVITY_BAR_DRAG_MODIFIERS}
      accessibility={{ announcements }}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={containerRef}
        role="toolbar"
        aria-label="右侧表面快捷栏（支持拖拽排序）"
        data-testid="right-panel-activity-bar"
        className="flex h-7.5 shrink-0 items-center gap-1 overflow-hidden border-b border-border/60 bg-black/[0.02] px-1.5 [-webkit-app-region:no-drag] dark:bg-white/[0.02] [[data-pmx-glass='1']_&]:border-white/12 [[data-pmx-glass='1']_&]:bg-black/15 [html:not(.dark)[data-pmx-glass='1']_&]:border-black/10 [html:not(.dark)[data-pmx-glass='1']_&]:bg-white/25"
      >
        <div
          ref={stripRef}
          onWheel={(event) => {
            const node = stripRef.current;
            if (!node || node.scrollWidth <= node.clientWidth) return;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            if (delta === 0) return;
            node.scrollLeft += delta;
          }}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <SortableContext
            items={visible.map((item) => item.id)}
            strategy={horizontalListSortingStrategy}
          >
            {visible.map((item) => (
              <SortableActivityBarButton
                key={item.id}
                item={item}
                compact={compactIds.has(item.id)}
              />
            ))}
          </SortableContext>
        </div>

        {overflow.length > 0 || props.isCustomOrder ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label="更多右侧表面与排序选项"
                  data-testid="right-panel-activity-overflow"
                  className="shrink-0"
                  size="icon-xs"
                  variant="ghost-muted"
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" side="bottom" sideOffset={4}>
              {overflow.map((item) => {
                const Icon = item.icon;
                return (
                  <MenuItem
                    key={item.id}
                    disabled={!item.available}
                    onClick={item.onClick}
                  >
                    <Icon className="size-3.5" />
                    <span>{item.label}</span>
                  </MenuItem>
                );
              })}
              {props.isCustomOrder ? (
                <MenuItem onClick={props.onResetOrder}>
                  <RotateCcw className="size-3.5" />
                  <span>重置默认排序</span>
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
    </DndContext>
  );
}

function normalizeSimulatorQuickUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^:\d+(?:\/|$)/.test(trimmed)) {
    return `http://127.0.0.1${trimmed}`;
  }
  return `https://${trimmed}`;
}

/**
 * Interactive Phone Simulator stage displayed immediately when clicking "手机模拟"
 * on a blank/idle preview tab (before any URL is loaded). Sits cleanly below the URL
 * address bar (`[data-surface-subheader]`) and strictly above the 20px bottom status bar.
 */
export function PhoneSimulatorBlankStage() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 460,
    height: 680,
  });
  const [topOffset, setTopOffset] = useState<number>(40);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [draftUrl, setDraftUrl] = useState("");
  const [navError, setNavError] = useState<string | null>(null);
  const [openingUrl, setOpeningUrl] = useState(false);

  const pendingSetting = useRightPanelStore((state) => state.pendingMobileSimulatorSetting);
  const setPendingSetting = useRightPanelStore((state) => state.setPendingMobileSimulatorSetting);
  const setIdleActive = useRightPanelStore((state) => state.setMobileSimulatorIdleActive);
  const bezelEnabled = useRightPanelStore((state) => state.mobileSimulatorBezelEnabled);
  const setBezelEnabled = useRightPanelStore((state) => state.setMobileSimulatorBezelEnabled);
  const colorScheme = useRightPanelStore((state) => state.mobileSimulatorColorScheme);
  const setColorScheme = useRightPanelStore((state) => state.setMobileSimulatorColorScheme);
  const runtime = useOptionalPrismuxRuntime();

  const currentSetting: Exclude<PreviewViewportSetting, { readonly _tag: "fill" }> =
    pendingSetting ??
    (resolvePreviewViewport({
      mode: "preset",
      preset: DEFAULT_MOBILE_SIMULATOR_PRESET_ID,
    }) as Exclude<PreviewViewportSetting, { readonly _tag: "fill" }>);

  const activePreset =
    currentSetting._tag === "preset"
      ? (findPreviewViewportPreset(currentSetting.presetId) ?? null)
      : null;

  // Stable useRef + useEffect ResizeObserver with strict equality guards (prevents React 19 error #185 loop).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes ResizeObserver on stable stageRef to fit blank Phone Simulator below the URL bar
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => {
      const parent = node.closest<HTMLElement>("[data-right-panel-surface-content]");
      const subheader = parent?.querySelector<HTMLElement>("[data-surface-subheader]");
      if (parent && subheader) {
        const parentRect = parent.getBoundingClientRect();
        const subRect = subheader.getBoundingClientRect();
        const computedOffset = Math.max(0, Math.round(subRect.bottom - parentRect.top));
        if (computedOffset > 0 && computedOffset < 120) {
          setTopOffset((prev) => (prev === computedOffset ? prev : computedOffset));
        }
      }
      const nextWidth = Math.max(120, Math.round(node.clientWidth));
      const nextHeight = Math.max(160, Math.round(node.clientHeight));
      setStageSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight },
      );
    };
    measure();
    return observeResize(node, measure);
  }, []);

  const handleToolbarChange = async (next: PreviewViewportSetting) => {
    if (next._tag === "fill") {
      setIdleActive(false);
      setPendingSetting(null);
      return;
    }
    setPendingSetting(next);
  };

  const handleOpenUrl = async (rawUrl: string) => {
    const normalized = normalizeSimulatorQuickUrl(rawUrl);
    if (!normalized) return;
    setNavError(null);
    setOpeningUrl(true);
    // Keep chosen preset + orientation armed so HostedBrowserWebview applies it immediately on mount.
    setPendingSetting(currentSetting);
    try {
      const parent = stageRef.current?.closest<HTMLElement>("[data-right-panel-surface-content]");
      const threadKey =
        parent?.querySelector<HTMLElement>("[data-preview-view]")?.getAttribute("data-thread-key") ??
        null;
      const threadRef = threadKey ? parseScopedThreadKey(threadKey) : null;
      if (threadRef) {
        await openUrlInPreview({
          threadRef,
          url: normalized,
          openPreview: (input) => runAtomCommand(appAtomRegistry, previewEnvironment.open, input),
        });
      }
    } catch (error) {
      setNavError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningUrl(false);
    }
  };

  // Deduplicate live localhost listening ports for one-click mobile preview shortcuts.
  const localPorts = (() => {
    const rawPorts = runtime?.portsState.ports ?? [];
    const seen = new Set<number>();
    const list: Array<(typeof rawPorts)[number]> = [];
    for (const entry of rawPorts) {
      if (seen.has(entry.port)) continue;
      seen.add(entry.port);
      list.push(entry);
      if (list.length >= 6) break;
    }
    return list;
  })();

  const effectiveBezelStyle = activePreset?.bezelStyle ?? "dynamic-island";
  const showBezel = bezelEnabled && effectiveBezelStyle !== "none";
  const chassisLayout = resolvePhoneBezelChassisLayout(
    stageSize,
    currentSetting,
    1,
    effectiveBezelStyle,
  );
  const isLightScreen = colorScheme === "light";

  const screenGuideContent = (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-between overflow-y-auto p-3.5 text-xs",
        isLightScreen
          ? "bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900"
          : "bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100",
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="inline-flex w-fit items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
            <TabletSmartphone aria-hidden className="size-3" />
            <span>Prismux 手机模拟已就绪</span>
          </div>
          <div className="text-sm font-semibold">
            {activePreset?.label ?? "自定义移动视口"}
          </div>
          <div className="font-mono text-[11px] opacity-70 tabular-nums">
            {currentSetting.width} × {currentSetting.height}
            {activePreset ? ` · @${activePreset.deviceScaleFactor}x` : ""}
            {" · "}
            {chassisLayout.isLandscape ? "横屏" : "竖屏"}
          </div>
        </div>

        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleOpenUrl(draftUrl);
          }}
        >
          <input
            type="text"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="输入网址或 :5173 回车预览…"
            aria-label="手机模拟快速预览网址"
            data-testid="phone-simulator-quick-url-input"
            className={cn(
              "h-7 w-full rounded-md border px-2 text-xs outline-none focus:ring-2 focus:ring-sky-500/50",
              isLightScreen
                ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400"
                : "border-white/15 bg-white/8 text-white placeholder:text-slate-400",
            )}
          />
          <button
            type="submit"
            disabled={openingUrl || draftUrl.trim().length === 0}
            className="inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded-md bg-sky-600 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ExternalLink aria-hidden className="size-3" />
            <span>{openingUrl ? "加载中…" : "在手机模拟中打开"}</span>
          </button>
          {navError ? (
            <div role="alert" className="text-[11px] text-rose-400">
              {navError}
            </div>
          ) : null}
        </form>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 text-[11px] font-medium opacity-75">
            <Network aria-hidden className="size-3" />
            <span>本机监听端口一键预览</span>
          </div>
          {localPorts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {localPorts.map((entry) => {
                const url = resolvePortOpenUrl(entry);
                return (
                  <button
                    key={`${entry.pid}:${entry.port}`}
                    type="button"
                    onClick={() => void handleOpenUrl(url)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] transition-colors",
                      isLightScreen
                        ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                        : "border-white/15 bg-white/8 text-slate-100 hover:bg-white/15",
                    )}
                    title={`在手机模拟中预览 ${url}`}
                  >
                    <span className="font-semibold text-emerald-500">:{entry.port}</span>
                    <span className="max-w-20 truncate opacity-75">{entry.processName}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed opacity-65">
              启动本地开发服务器后将自动显示快捷端口，也可直接在上方地址栏或输入框打开任意页面。
            </p>
          )}
        </div>
      </div>

      <div className="pt-2 text-[10px] opacity-60">
        加载网页后自动同步 Electron CDP 触摸 / DPR / 移动端 UA 仿真
      </div>
    </div>
  );

  return (
    <div
      ref={stageRef}
      data-testid="prismux-phone-simulator-blank-stage"
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden bg-background/95 backdrop-blur-sm"
      style={{ top: topOffset }}
    >
      <BrowserDeviceToolbar
        setting={currentSetting}
        width={stageSize.width}
        aspectRatio={aspectRatio}
        onAspectRatioChange={setAspectRatio}
        onChange={handleToolbarChange}
        bezelEnabled={bezelEnabled}
        onBezelEnabledChange={(next) => {
          setBezelEnabled(next);
          savePhoneBezelEnabled(next);
        }}
        emulatedColorScheme={colorScheme}
        onEmulatedColorSchemeChange={setColorScheme}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/25">
        {showBezel ? (
          <PhoneBezelChassis
            interactive
            bezelStyle={effectiveBezelStyle}
            colorScheme={colorScheme}
            label={activePreset?.label ?? "Phone"}
            layout={{
              ...chassisLayout,
              // Frame coordinates inside the flex-1 body beneath the toolbar (toolbar offset = 0 here).
              frameY: Math.max(
                8,
                Math.floor(
                  (Math.max(chassisLayout.frameHeight, stageSize.height - 38) -
                    chassisLayout.frameHeight) /
                    2,
                ),
              ),
            }}
          >
            {screenGuideContent}
          </PhoneBezelChassis>
        ) : (
          <div className="flex h-full w-full items-center justify-center p-3">
            <div
              className="overflow-hidden rounded-xl border border-border shadow-lg"
              style={{
                width: chassisLayout.screenWidth,
                height: chassisLayout.screenHeight,
              }}
            >
              {screenGuideContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const gt = useGT();
  const locale = useLocale();
  const messages = useMessages();
  const topbarPortal = useWorkspaceTopbarPortal();
  const focusedSurface = props.surfaces.find((surface) => surface.id === props.activeSurfaceId);
  const ownsDesktopTitleBar = isElectron && props.mode === "inline" && !topbarPortal.managed;
  const browserProfiles = useBrowserDefaults().profiles;
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const addSurfaceTriggerRef = useRef<HTMLButtonElement>(null);
  const [renamingDevice, setRenamingDevice] = useState<string | null>(null);
  const [addSurfaceMenuOpen, setAddSurfaceMenuOpen] = useState(false);
  const [tabScrollState, setTabScrollState] = useState({
    hasOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  });

  if (props.open === false && addSurfaceMenuOpen) setAddSurfaceMenuOpen(false);

  const addSurfaceMenuBlocked = () =>
    !addSurfaceMenuOpen && document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS) !== null;
  const onNewSurfaceKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (
      resolveShortcutCommand(event, props.keybindings, {
        context: { ...props.getShortcutContext(), rightPanelOpen: true },
      }) !== "rightPanel.new"
    )
      return;
    if (addSurfaceMenuBlocked()) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) {
      addSurfaceTriggerRef.current?.focus();
      setAddSurfaceMenuOpen(true);
    }
  });
  // Forwarded from a focused browser page. Focusing the trigger here would let ChatView's
  // window-focus handler see a plain button and refocus the composer, closing the menu.
  const onMenuAction = useEffectEvent((action: string) => {
    if (action === "rightPanel.new" && !addSurfaceMenuBlocked()) setAddSurfaceMenuOpen(true);
  });
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes document keydown and the desktop menu action (forwarded from a focused browser page) for the new surface shortcut while the panel is open
  useEffect(() => {
    if (props.open === false) return;
    document.addEventListener("keydown", onNewSurfaceKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction(onMenuAction);
    return () => {
      document.removeEventListener("keydown", onNewSurfaceKeyDown, true);
      unsubscribe?.();
    };
  }, [props.open]);

  const updateTabScrollState = (viewport: HTMLDivElement) => {
    const hasOverflow = viewport.scrollWidth - viewport.clientWidth > TAB_SCROLL_EDGE_TOLERANCE;
    const canScrollLeft = hasOverflow && viewport.scrollLeft > TAB_SCROLL_EDGE_TOLERANCE;
    const canScrollRight =
      hasOverflow &&
      viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - TAB_SCROLL_EDGE_TOLERANCE;
    setTabScrollState((current) => {
      if (
        current.hasOverflow === hasOverflow &&
        current.canScrollLeft === canScrollLeft &&
        current.canScrollRight === canScrollRight
      ) {
        return current;
      }
      return { hasOverflow, canScrollLeft, canScrollRight };
    });
  };

  const scrollTabs = (direction: -1 | 1) => {
    const viewport = tabScrollViewport(tabListRef.current);
    if (!viewport) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport.scrollBy({
      left: direction * Math.max(120, viewport.clientWidth * 0.75),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  };

  const activityBarOrder = useRightPanelStore((state) => state.activityBarOrder);
  const reorderActivityBar = useRightPanelStore((state) => state.reorderActivityBar);
  const resetActivityBarOrder = useRightPanelStore((state) => state.resetActivityBarOrder);
  const isCustomActivityBarOrder =
    activityBarOrder.length !== DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER.length ||
    activityBarOrder.some((id, index) => id !== DEFAULT_RIGHT_PANEL_ACTIVITY_ORDER[index]);
  const requestMobileSimulatorLaunch = useRightPanelStore(
    (state) => state.requestMobileSimulatorLaunch,
  );
  const mobileSimulatorIdleActive = useRightPanelStore(
    (state) => state.mobileSimulatorIdleActive,
  );
  const focusedPreviewSession =
    focusedSurface?.kind === "preview" && focusedSurface.resourceId
      ? (props.previewSessions[focusedSurface.resourceId] ?? null)
      : null;
  const isFocusedPreviewBlank =
    focusedSurface?.kind === "preview" &&
    (focusedPreviewSession === null || focusedPreviewSession.navStatus._tag === "Idle");

  const handleOpenBrowser = useStableCallback(() => {
    useRightPanelStore.getState().setMobileSimulatorIdleActive(false);
    props.onAddBrowser();
  });

  const handleOpenMobileSimulator = useStableCallback(() => {
    if (!props.browserAvailable) return;
    requestMobileSimulatorLaunch();
    const existingPreview = props.surfaces.find((surface) => surface.kind === "preview");
    if (existingPreview) {
      props.onActivate(existingPreview);
      return;
    }
    props.onAddBrowser();
  });

  const effectiveSideChatAvailable =
    Boolean(props.onAddSideChat) && props.sideChatAvailable !== false;

  const sharedAvailability = {
    pullRequests: props.pullRequestsAvailable,
    diff: props.diffAvailable,
    files: props.filesAvailable,
    terminal: props.terminalAvailable,
    preview: props.browserAvailable,
    mobileSimulator: props.browserAvailable,
    sideChat: effectiveSideChatAvailable,
  };

  const orderedActivityActions = buildRightPanelActivityActions({
    order: activityBarOrder,
    focusedSurfaceKind: focusedSurface?.kind ?? null,
    mobileSimulatorIdleActive,
    resolveMessage: messages,
    locale,
    availability: sharedAvailability,
    handlers: {
      onPullRequests: props.onAddPullRequests,
      onDiff: props.onAddDiff,
      onFiles: props.onAddFiles,
      onTerminal: props.onAddTerminal,
      onPreview: handleOpenBrowser,
      onMobileSimulator: handleOpenMobileSimulator,
      onSideChat: () => props.onAddSideChat?.(),
    },
  });

  const sharedLauncherHandlers = {
    onPullRequests: props.onAddPullRequests,
    onDiff: props.onAddDiff,
    onFiles: props.onAddFiles,
    onTerminal: props.onAddTerminal,
    onPreview: handleOpenBrowser,
    onMobileSimulator: handleOpenMobileSimulator,
    onSideChat: props.onAddSideChat,
  };

  const emptyLauncherActions = buildRightPanelLauncherActions({
    order: activityBarOrder,
    resolveMessage: messages,
    locale,
    disabledReasonStyle: "hint",
    includeSideChat: Boolean(props.onAddSideChat),
    availability: sharedAvailability,
    sideChatDisabledReason: props.sideChatDisabledReason ?? null,
    handlers: sharedLauncherHandlers,
  });

  const addSurfaceActions = buildRightPanelLauncherActions({
    order: activityBarOrder,
    resolveMessage: messages,
    locale,
    disabledReasonStyle: "reason",
    includeSideChat: Boolean(props.onAddSideChat),
    availability: sharedAvailability,
    sideChatDisabledReason: props.sideChatDisabledReason ?? null,
    handlers: sharedLauncherHandlers,
  });

  const handleAddSurfaceMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const action = surfaceShortcutActionForKey(addSurfaceActions, event.nativeEvent);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    setAddSurfaceMenuOpen(false);
    action.onClick();
  };

  const handleTabContextMenu = async (event: ReactMouseEvent, surface: RightPanelSurface) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readLocalApi();
    if (!api) return;

    const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
    if (surfaceIndex < 0) return;

    const items: ContextMenuItem<TabContextMenuAction>[] = [];
    if ((surface.kind === "thread" || surface.kind === "linked-thread") && props.onOpenInMainView) {
      items.push({ id: "open-in-main-view", label: gt("Open in main view") });
    }
    if (surface.kind === "device" && props.onRenameDevice)
      items.push({ id: "rename", label: gt("Rename") });
    if (surface.kind === "file" && surface.attachment === undefined) {
      items.push({ id: "copy-path", label: gt("Copy path") });
    }
    const menuPreviewTabId = previewTabIdOf(surface, props.previewSessions);
    const menuOverlay = menuPreviewTabId ? (props.desktopByTabId[menuPreviewTabId] ?? null) : null;
    const menuMuted = menuOverlay?.audioMuted ?? false;
    if (surface.kind === "preview") {
      items.push({
        id: "duplicate",
        label: gt("Duplicate"),
        disabled: !props.browserAvailable || !menuPreviewTabId || !props.onDuplicateBrowser,
      });
      items.push({
        id: "toggle-mute",
        ...tabMuteMenuItem(
          {
            overlay: menuOverlay,
            canResolveRuntimeTabId: props.previewRuntimeTabId !== undefined,
          },
          messages,
        ),
      });
    }
    items.push(
      { id: "close", label: gt("Close") },
      {
        id: "close-others",
        label: gt("Close others"),
        disabled: props.surfaces.length <= 1,
      },
      {
        id: "close-to-right",
        label: gt("Close to the right"),
        disabled: surfaceIndex >= props.surfaces.length - 1,
      },
      {
        id: "close-all",
        label: gt("Close all"),
        disabled: props.surfaces.length === 0,
      },
    );

    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    switch (action) {
      case "open-in-main-view":
        if (surface.kind === "thread" || surface.kind === "linked-thread") {
          props.onOpenInMainView?.(surface);
        }
        break;
      case "rename":
        setRenamingDevice(surface.id);
        break;
      case "copy-path":
        if (surface.kind === "file" && surface.attachment === undefined) {
          props.onCopyFilePath(surface.relativePath);
        }
        break;
      case "duplicate":
        props.onDuplicateBrowser?.(surface);
        break;
      case "toggle-mute": {
        const runtimeTabId =
          menuPreviewTabId && menuOverlay
            ? (props.previewRuntimeTabId?.(menuPreviewTabId) ?? null)
            : null;
        if (runtimeTabId) {
          void previewBridge?.setAudioMuted(runtimeTabId, !menuMuted).catch(() => undefined);
        }
        break;
      }
      case "close":
        props.onCloseSurface(surface);
        break;
      case "close-others":
        props.onCloseOtherSurfaces(surface);
        break;
      case "close-to-right":
        props.onCloseSurfacesToRight(surface);
        break;
      case "close-all":
        props.onCloseAllSurfaces();
        break;
      case null:
        break;
    }
  };
  const handleTabAuxClick = (event: ReactMouseEvent, surface: RightPanelSurface) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    props.onCloseSurface(surface);
  };
  const onActivateTab = useStableCallback(props.onActivate);
  const onCloseTab = useStableCallback(props.onCloseSurface);
  const onTabAuxClick = useStableCallback(handleTabAuxClick);
  const onTabContextMenu = useStableCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      void handleTabContextMenu(event, surface);
    },
  );
  const onStartRenameTab = useStableCallback((surfaceId: string) => setRenamingDevice(surfaceId));
  const onFinishRenameTab = useStableCallback((surfaceId: string, title: string) => {
    props.onRenameDevice?.(surfaceId, title);
    setRenamingDevice(null);
  });

  // A newly active tab, or tabs that start overflowing, can sit outside the scrolled strip.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- scrolls the active tab DOM node into view after it changes or the tab strip starts overflowing
  useEffect(() => {
    if (!props.activeSurfaceId || !tabScrollState.hasOverflow) return;
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId, tabScrollState.hasOverflow]);

  const attachTabList = (root: HTMLDivElement | null) => {
    tabListRef.current = root;
    const viewport = tabScrollViewport(root);
    if (!viewport) return;

    const update = () => updateTabScrollState(viewport);
    // Only a vertical mouse wheel is translated. Horizontal input scrolls natively, since
    // consuming it keeps Chromium from starting the gesture scroll that swipe navigation tracks.
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      let delta = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= viewport.clientWidth;

      const previousScrollLeft = viewport.scrollLeft;
      viewport.scrollLeft += delta;
      if (viewport.scrollLeft === previousScrollLeft) return;
      event.preventDefault();
      update();
    };

    const content = viewport.firstElementChild;
    const stopObserving = observeResize(content ? [viewport, content] : viewport, update);
    viewport.addEventListener("scroll", update, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    update();

    return () => {
      tabListRef.current = null;
      stopObserving();
      viewport.removeEventListener("scroll", update);
      viewport.removeEventListener("wheel", handleWheel);
    };
  };

  return (
    <PreviewPanelShell
      workspaceArea
      workspaceFocusKey={`panel:${props.environmentId}:${props.activeSurfaceId ?? "empty"}`}
      workspaceLabel={
        focusedSurface
          ? gt("Workspace panel: {title}", {
              title: surfaceTitle(
                focusedSurface,
                props.previewSessions,
                props.terminalLabelsById,
                messages,
                locale,
              ),
            })
          : gt("Workspace panel")
      }
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.open !== undefined ? { open: props.open } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
      {...(props.inlineSize ? { inlineSize: props.inlineSize } : {})}
      onMouseDown={preventThumbButtonFocus}
      onMouseUp={(event) =>
        takeThumbButtonNavigation(
          event,
          focusedSurface?.kind === "preview" ? dispatchPreviewAction : undefined,
        )
      }
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 pl-2",
          topbarPortal.managed && props.mode === "inline"
            ? "h-8 min-h-8 border-b border-border/50 pr-2"
            : cn(
                "h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)]",
                props.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
                ownsDesktopTitleBar && "drag-region",
                ownsDesktopTitleBar && "wco:pr-(--workspace-native-controls-inset)",
                props.mode === "inline" &&
                  props.maximized &&
                  COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
              ),
        )}
        data-right-panel-tabbar
      >
        <ScrollArea
          radius="none"
          ref={attachTabList}
          hideScrollbars
          scrollFade
          className={cn(
            "min-w-0 flex-1",
            ownsDesktopTitleBar && tabScrollState.hasOverflow && "[-webkit-app-region:no-drag]",
          )}
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            <SortableTabList surfaces={props.surfaces} onMove={props.onMoveSurface}>
              {props.surfaces.map((surface, surfaceIndex) => {
                const hostThreadRef = resolveRightPanelHostThreadRef(props.widthStorageKey);
                const previewTabId = previewTabIdOf(surface, props.previewSessions);
                const previewProfileId =
                  surface.kind === "preview" && surface.resourceId
                    ? props.previewSessions[surface.resourceId]?.profileId
                    : undefined;
                const previewProfileBadge =
                  surface.kind === "preview"
                    ? resolveBrowserProfileBadgeLabel(previewProfileId, browserProfiles, locale)
                    : null;
                const favicon = previewFaviconOf(
                  surface,
                  props.previewSessions,
                  props.desktopByTabId,
                );
                return (
                  <RightPanelTab
                    key={surface.id}
                    surface={surface}
                    surfaceIndex={surfaceIndex}
                    hostThreadRef={hostThreadRef}
                    onMoveSurface={props.onMoveSurface}
                    dragDisabled={!props.onMoveSurface || renamingDevice === surface.id}
                    active={surface.id === props.activeSurfaceId}
                    pending={props.pendingSurfaceIds.has(surface.id)}
                    title={surfaceTitle(
                      surface,
                      props.previewSessions,
                      props.terminalLabelsById,
                      messages,
                      locale,
                    )}
                    audio={tabAudioState(
                      previewTabId ? (props.desktopByTabId[previewTabId] ?? null) : null,
                    )}
                    audioRuntimeTabId={
                      previewTabId ? (props.previewRuntimeTabId?.(previewTabId) ?? null) : null
                    }
                    previewUrl={favicon.url}
                    previewCapturedUrl={favicon.capturedUrl}
                    previewProfileId={previewProfileId}
                    previewProfileBadge={previewProfileBadge}
                    theme={resolvedTheme}
                    environmentId={props.environmentId}
                    pullRequestStatusSeed={props.pullRequestStatusSeeds?.[surface.id]}
                    renaming={renamingDevice === surface.id}
                    canRename={props.onRenameDevice !== undefined}
                    ownsDesktopTitleBar={ownsDesktopTitleBar}
                    onActivate={onActivateTab}
                    onClose={onCloseTab}
                    onAuxClick={onTabAuxClick}
                    onContextMenu={onTabContextMenu}
                    onStartRename={onStartRenameTab}
                    onFinishRename={onFinishRenameTab}
                  />
                );
              })}
            </SortableTabList>
            {props.open !== false ? (
              <Menu open={addSurfaceMenuOpen} onOpenChange={setAddSurfaceMenuOpen}>
                <MenuTrigger
                  ref={addSurfaceTriggerRef}
                  render={
                    <Button
                      aria-label={gt("Add panel surface")}
                      className="shrink-0"
                      size="icon-xs"
                      variant="ghost-muted"
                    />
                  }
                >
                  <Plus className="size-3.5" />
                </MenuTrigger>
                <MenuPopup
                  align="start"
                  side="bottom"
                  sideOffset={6}
                  onKeyDownCapture={handleAddSurfaceMenuKeyDown}
                >
                  {addSurfaceActions.map((action) => {
                    const Icon = action.icon;
                    if (action.id === "preview" && action.available) {
                      return (
                        <MenuSub key={action.id}>
                          <MenuSubTrigger
                            data-surface-menu-item={action.id}
                            className="[&>svg:last-child]:ms-0"
                            aria-keyshortcuts={action.shortcut}
                            onClick={(event) => {
                              const pointerType =
                                "pointerType" in event.nativeEvent &&
                                typeof event.nativeEvent.pointerType === "string"
                                  ? event.nativeEvent.pointerType
                                  : undefined;
                              if (!shouldOpenDefaultBrowserProfileFromMenuClick(pointerType))
                                return;
                              setAddSurfaceMenuOpen(false);
                              action.onClick();
                            }}
                          >
                            <Icon />
                            {action.label}
                            <MenuShortcut>{action.shortcut}</MenuShortcut>
                          </MenuSubTrigger>
                          <MenuSubPopup className="max-w-56">
                            {browserProfiles.map((profile) => (
                              <MenuItem
                                key={profile.id}
                                onClick={() => props.onAddBrowserInProfile(profile.id)}
                              >
                                <span className="min-w-0 truncate">
                                  {formatBrowserProfileLabel(profile, locale)}
                                </span>
                              </MenuItem>
                            ))}
                          </MenuSubPopup>
                        </MenuSub>
                      );
                    }
                    return (
                      <SurfaceMenuItem
                        key={action.id}
                        itemId={action.id}
                        available={action.available}
                        disabledReason={action.disabledReason}
                        shortcut={action.shortcut}
                        onClick={action.onClick}
                      >
                        <Icon />
                        {action.label}
                      </SurfaceMenuItem>
                    );
                  })}
                </MenuPopup>
              </Menu>
            ) : null}
          </div>
        </ScrollArea>
        {tabScrollState.hasOverflow ? (
          <div
            className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]"
            role="group"
            aria-label={gt("Scroll panel tabs")}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label={gt("Scroll tabs left")}
                      disabled={!tabScrollState.canScrollLeft}
                      onClick={() => scrollTabs(-1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronLeft />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>
                <T>Scroll tabs left</T>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      aria-label={gt("Scroll tabs right")}
                      disabled={!tabScrollState.canScrollRight}
                      onClick={() => scrollTabs(1)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <ChevronRight />
                    </Button>
                  </span>
                }
              />
              <TooltipPopup>
                <T>Scroll tabs right</T>
              </TooltipPopup>
            </Tooltip>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    aria-label="全部已打开标签"
                    data-testid="right-panel-tabs-overflow-menu"
                    size="icon-xs"
                    variant="ghost"
                  />
                }
              >
                <ChevronDown className="size-3.5" />
              </MenuTrigger>
              <MenuPopup align="end" side="bottom" sideOffset={4} className="max-w-56">
                {props.surfaces.map((surface) => (
                  <MenuItem
                    key={surface.id}
                    onClick={() => props.onActivate(surface)}
                  >
                    <span className="min-w-0 truncate">
                      {surfaceTitle(
                        surface,
                        props.previewSessions,
                        props.terminalLabelsById,
                        messages,
                        locale,
                      )}
                    </span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          </div>
        ) : null}
        {props.layoutControls}
        {ownsDesktopTitleBar && !props.layoutControls ? (
          <span aria-hidden className="hidden w-24 shrink-0 wco:block" />
        ) : null}
        {ownsDesktopTitleBar ? (
          <span
            aria-hidden
            className="pointer-events-none fixed top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] h-[var(--workspace-topbar-height)] w-28 [-webkit-app-region:no-drag]"
          />
        ) : null}
      </div>
      {props.open !== false ? (
        <RightPanelActivityBar
          actions={orderedActivityActions}
          isCustomOrder={isCustomActivityBarOrder}
          onReorder={reorderActivityBar}
          onResetOrder={resetActivityBarOrder}
        />
      ) : null}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        data-right-panel-surface-content
      >
        {props.activeSurfaceId === null ? (
          <RightPanelEmptyState
            actions={emptyLauncherActions}
            browserProfiles={browserProfiles}
            onAddBrowserInProfile={props.onAddBrowserInProfile}
            isCustomOrder={isCustomActivityBarOrder}
            onReorder={reorderActivityBar}
            onResetOrder={resetActivityBarOrder}
          />
        ) : (
          <>
            {props.children}
            {isFocusedPreviewBlank && mobileSimulatorIdleActive ? (
              <PhoneSimulatorBlankStage />
            ) : null}
          </>
        )}
      </div>
    </PreviewPanelShell>
  );
}

function DeviceTabTooltip(props: {
  surface: Extract<RightPanelSurface, { kind: "device" }>;
  environmentId: EnvironmentId | null;
  title: string;
}) {
  const gt = useGT();
  const target = props.surface.target;
  const { state } = useDeviceState(target ? props.environmentId : null);
  const device = target
    ? state.devices.find((entry) => entry.hostId === target.hostId && entry.id === target.deviceId)
    : undefined;
  const host = target ? state.hosts.find((entry) => entry.id === target.hostId) : undefined;
  return (
    <div className="flex flex-col gap-0.5">
      <span>{props.title}</span>
      {target ? (
        <span className="text-muted-foreground">
          {host?.label ?? gt("Device host")} ·{" "}
          {device?.version ?? (target.platform === "ios" ? "iOS" : "Android")}
        </span>
      ) : null}
    </div>
  );
}
