import { scopeThreadRef, scopedThreadKey } from "@prismux/client-runtime/environment";
import { threadRuntimeCanArchive } from "@prismux/client-runtime/state/models";
import {
  ProviderDriverKind,
  type ContextMenuSource,
  type ScopedThreadRef,
} from "@prismux/core-contracts";
import { useGT, T } from "gt-react";
import {
  ArchiveIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import {
  memo,
  useId,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "~/lib/utils";
import { textDirection } from "~/textDirection";
import { contextMenuSourceOf } from "../../contextMenuSource";
import {
  acpBrandKeyToAgentBrandId,
  inferAgentBrandFromModel,
  resolveAcpAgentBrandKey,
  resolveAgentBrandId,
  type AgentBrandId,
} from "../../prismux/agentBrand";
import type { SidebarThreadSummary } from "../../types";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SidebarProviderEntry } from "./SidebarThreadRow";
import { isDelegatedChildThreadActive } from "./delegatedThreadTree.logic";
import { resolveAgentRuntimeLamp } from "./sidebarMicroIndicators";
import { resolveSidebarModelShortName } from "./sidebarWorkspaceGrouping";

export interface DelegatedSubthreadTreeProps {
  readonly parentKey: string;
  readonly childThreads: readonly SidebarThreadSummary[];
  readonly activeThreadKey: string | null;
  readonly inWorkspaceCard?: boolean | undefined;
  readonly indentClassName?: string | undefined;
  readonly providerEntryByInstanceId: ReadonlyMap<string, SidebarProviderEntry>;
  readonly localLastVisitedAtById?: Readonly<Record<string, string | undefined>> | undefined;
  readonly canOperateEnvironment?: boolean | undefined;
  readonly onSelectChild: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  readonly onActivateChild: (threadRef: ScopedThreadRef) => void;
  readonly onContextMenuChild: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
    source: ContextMenuSource,
  ) => void;
  readonly onArchiveChild?: ((threadRef: ScopedThreadRef) => void) | undefined;
  readonly onDeleteChild?: ((threadRef: ScopedThreadRef) => void) | undefined;
}

const RGB_CONDUCTOR_STOPS = [
  { offset: "0%", color: "#ff3b7f" },
  { offset: "20%", color: "#ff9f1c" },
  { offset: "42%", color: "#34d399" },
  { offset: "64%", color: "#38bdf8" },
  { offset: "82%", color: "#818cf8" },
  { offset: "100%", color: "#c084fc" },
] as const;

/** Traditional file-tree vertical trunk + rounded L-bend (`├─` / `└─`) with RGB energy conduction. */
function TreeConnectorBranch(props: {
  readonly gradientId: string;
  readonly isLast: boolean;
  readonly isChildActive: boolean;
  readonly conductTrunkBelow: boolean;
}) {
  const { gradientId, isLast, isChildActive, conductTrunkBelow } = props;
  const branchPath = "M 8 0 L 8 8 Q 8 14 14 14 L 20 14";
  const trunkPath = "M 8 0 L 8 28";
  const needsGradient = isChildActive || (!isLast && conductTrunkBelow);

  return (
    <svg
      aria-hidden
      viewBox="0 0 20 28"
      width="20"
      height="28"
      fill="none"
      data-testid="delegated-tree-connector"
      data-connector-kind={isLast ? "last" : "middle"}
      data-rgb-active={isChildActive ? "1" : "0"}
      data-rgb-trunk-active={!isLast && conductTrunkBelow ? "1" : "0"}
      className="h-7 w-5 shrink-0 overflow-visible"
    >
      {needsGradient ? (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="8"
            y1="0"
            x2="20"
            y2="28"
          >
            {RGB_CONDUCTOR_STOPS.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>
      ) : null}

      {/* Static vertical continuation trunk for non-last children (`├─`) */}
      {!isLast ? (
        <path
          d={trunkPath}
          data-connector-part="trunk-static"
          stroke="currentColor"
          strokeWidth="1.25"
          className="text-sidebar-border/70"
        />
      ) : null}

      {/* Static L-bend connector entering the child row's left edge */}
      <path
        d={branchPath}
        data-connector-part="branch-static"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        className="text-sidebar-border/70"
      />

      {/* Active RGB conduction down the vertical trunk toward a running child below */}
      {!isLast && conductTrunkBelow ? (
        <>
          <path
            d={trunkPath}
            data-connector-part="trunk-rgb-glow"
            stroke={`url(#${gradientId})`}
            strokeWidth="3.2"
            strokeOpacity="0.24"
          />
          <path
            d={trunkPath}
            data-connector-part="trunk-rgb-base"
            data-pmx-tree-rgb-base="1"
            stroke={`url(#${gradientId})`}
            strokeWidth="1.5"
            strokeOpacity="0.58"
          />
          <path
            d={trunkPath}
            data-connector-part="trunk-rgb-beam"
            data-pmx-tree-rgb-beam="1"
            stroke={`url(#${gradientId})`}
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </>
      ) : null}

      {/* Active RGB energy conduction along this child's L-bend straight into its RGB border */}
      {isChildActive ? (
        <>
          <path
            d={branchPath}
            data-connector-part="branch-rgb-glow"
            stroke={`url(#${gradientId})`}
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeOpacity="0.28"
          />
          <path
            d={branchPath}
            data-connector-part="branch-rgb-base"
            data-pmx-tree-rgb-base="1"
            stroke={`url(#${gradientId})`}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity="0.62"
          />
          <path
            d={branchPath}
            data-connector-part="branch-rgb-beam"
            data-pmx-tree-rgb-beam="1"
            stroke={`url(#${gradientId})`}
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </svg>
  );
}

function DelegatedChildStatusIcon(props: {
  readonly status: ReturnType<typeof resolveSidebarRowStatus>;
  readonly isUnread: boolean;
  readonly hasRun: boolean;
}) {
  const { status, isUnread, hasRun } = props;
  if (status === "working" || status === "preparing") {
    return (
      <svg
        aria-hidden
        data-delegated-status="working"
        viewBox="0 0 12 12"
        fill="none"
        className="size-3 shrink-0 animate-spin text-warning motion-reduce:animate-none"
      >
        <circle
          cx="6"
          cy="6"
          r="4.25"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeOpacity="0.22"
        />
        <path
          d="M6 1.75A4.25 4.25 0 1 1 1.75 6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status === "approval") {
    return (
      <ShieldQuestionIcon
        aria-hidden
        data-delegated-status="approval"
        className="size-3 shrink-0 text-warning"
      />
    );
  }
  if (status === "input") {
    return (
      <MessageCircleQuestionIcon
        aria-hidden
        data-delegated-status="input"
        className="size-3 shrink-0 text-info"
      />
    );
  }
  if (status === "request") {
    return (
      <UserRoundIcon
        aria-hidden
        data-delegated-status="request"
        className="size-3 shrink-0 text-guest-foreground"
      />
    );
  }
  if (status === "failed" || status === "limited") {
    return (
      <CircleAlertIcon
        aria-hidden
        data-delegated-status="failed"
        className="size-3 shrink-0 text-error"
      />
    );
  }
  return (
    <CircleCheckIcon
      aria-hidden
      data-delegated-status={isUnread ? "unread" : hasRun ? "done" : "idle"}
      className={cn(
        "size-3 shrink-0",
        isUnread ? "text-success" : hasRun ? "text-success/80" : "text-sidebar-muted-foreground/45",
      )}
    />
  );
}

const GENERIC_ACP_IDENTIFIER_RE = /^(?:acp[-_]?registry|acp)$/i;

export interface DelegatedChildProviderPresentation {
  readonly brandId: AgentBrandId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly instanceId: string;
  readonly accentColor?: string | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly acpRegistryIconUrl?: string | undefined;
  readonly acpCommandPath?: string | undefined;
  readonly model?: string | undefined;
}

export function resolveDelegatedChildProviderPresentation(input: {
  readonly providerEntry: SidebarProviderEntry | null;
  readonly modelInstanceId: string;
  readonly runtimeProviderName?: string | null | undefined;
  readonly modelSlug?: string | null | undefined;
  readonly selectedModelName?: string | null | undefined;
}): DelegatedChildProviderPresentation {
  const { providerEntry, modelInstanceId, runtimeProviderName, modelSlug, selectedModelName } =
    input;
  const trimmedInstanceId = modelInstanceId.trim();
  const trimmedRuntimeName = runtimeProviderName?.trim() || "";
  const trimmedModelSlug = modelSlug?.trim() || "";
  const trimmedSelectedModelName = selectedModelName?.trim() || "";
  const slugBrand = inferAgentBrandFromModel(trimmedModelSlug);
  const selectedNameBrand =
    slugBrand !== null ? null : inferAgentBrandFromModel(trimmedSelectedModelName);
  const inferredModelBrand = slugBrand ?? selectedNameBrand;
  const modelForInference =
    (slugBrand !== null
      ? trimmedModelSlug
      : selectedNameBrand !== null
        ? trimmedSelectedModelName
        : trimmedModelSlug || trimmedSelectedModelName) || undefined;

  const driverKind =
    providerEntry?.driverKind ??
    (/^acp[-_]?registry/i.test(trimmedInstanceId) || trimmedInstanceId.length === 0
      ? ProviderDriverKind.make("acpRegistry")
      : ProviderDriverKind.make(trimmedInstanceId));

  const displayName =
    providerEntry?.displayName?.trim() ||
    trimmedRuntimeName ||
    (!GENERIC_ACP_IDENTIFIER_RE.test(trimmedInstanceId) ? trimmedInstanceId : "");

  const directDriverBrand = providerEntry
    ? resolveAgentBrandId(providerEntry.driverKind)
    : "custom";
  const acpBrandKey = resolveAcpAgentBrandKey({
    agentId: providerEntry?.acpRegistryAgentId,
    commandPath: providerEntry?.acpCommandPath,
    instanceId: providerEntry?.instanceId ?? trimmedInstanceId,
    displayName: providerEntry?.displayName ?? trimmedRuntimeName,
  });
  const directInstanceBrand = resolveAgentBrandId(trimmedInstanceId);

  let brandId: AgentBrandId;
  if (directDriverBrand !== "acp" && directDriverBrand !== "custom") {
    brandId = directDriverBrand;
  } else if (acpBrandKey !== null) {
    brandId = acpBrandKeyToAgentBrandId(acpBrandKey);
  } else if (directInstanceBrand !== "acp" && directInstanceBrand !== "custom") {
    brandId = directInstanceBrand;
  } else if (inferredModelBrand !== null) {
    brandId = inferredModelBrand;
  } else if (driverKind === "acpRegistry" || driverKind === "acp") {
    brandId = "acp";
  } else {
    brandId = "custom";
  }

  return {
    brandId,
    driverKind,
    displayName,
    instanceId: providerEntry?.instanceId ?? trimmedInstanceId,
    accentColor: providerEntry?.accentColor,
    acpRegistryAgentId: providerEntry?.acpRegistryAgentId,
    acpRegistryIconUrl: providerEntry?.acpRegistryIconUrl,
    acpCommandPath: providerEntry?.acpCommandPath,
    model: modelForInference,
  };
}

export const DelegatedSubthreadTree = memo(function DelegatedSubthreadTree(
  props: DelegatedSubthreadTreeProps,
) {
  const gt = useGT();
  const rawTreeId = useId();
  const safeTreeId = rawTreeId.replace(/[^a-zA-Z0-9_-]/g, "");
  const {
    parentKey,
    childThreads,
    activeThreadKey,
    inWorkspaceCard = false,
    indentClassName,
    providerEntryByInstanceId,
    localLastVisitedAtById,
    canOperateEnvironment = true,
    onSelectChild,
    onActivateChild,
    onContextMenuChild,
    onArchiveChild,
    onDeleteChild,
  } = props;

  if (childThreads.length === 0) return null;

  const activeFlags = childThreads.map((child) => {
    const childKey = scopedThreadKey(scopeThreadRef(child.environmentId, child.id));
    return isDelegatedChildThreadActive(child, localLastVisitedAtById?.[childKey]);
  });

  const hasActiveBelowByIndex = new Array<boolean>(childThreads.length).fill(false);
  let seenActiveBelow = false;
  for (let index = childThreads.length - 1; index >= 0; index -= 1) {
    hasActiveBelowByIndex[index] = seenActiveBelow;
    if (activeFlags[index]) {
      seenActiveBelow = true;
    }
  }

  const quickActionButtonClassName =
    "inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded bg-transparent text-muted-foreground transition-colors hover:bg-sidebar-foreground/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  return (
    <ul
      role="group"
      aria-label={gt("Delegated agent threads")}
      data-testid="delegated-subthread-tree"
      data-delegated-subthread-tree={parentKey}
      className={cn(
        "flex flex-col",
        indentClassName ?? (inWorkspaceCard ? "pl-3.5 pr-0.5" : "pl-2 pr-0.5"),
      )}
    >
      {childThreads.map((child, index) => {
        const childRef = scopeThreadRef(child.environmentId, child.id);
        const childKey = scopedThreadKey(childRef);
        const isLast = index === childThreads.length - 1;
        const isChildActive = activeFlags[index] ?? false;
        const conductTrunkBelow = hasActiveBelowByIndex[index] ?? false;
        const isRouteActive = activeThreadKey === childKey;
        const lastVisitedAt = resolveThreadLastVisitedAt(
          child.lastVisitedAt,
          localLastVisitedAtById?.[childKey],
        );
        const status = resolveSidebarRowStatus({ ...child, lastVisitedAt });
        const agentLamp = resolveAgentRuntimeLamp(status);
        const isUnread = status === "ready" && hasUnseenCompletion({ ...child, lastVisitedAt });
        const modelInstanceId =
          child.runtime?.providerInstanceId ?? child.modelSelection.instanceId;
        const providerEntry = providerEntryByInstanceId.get(modelInstanceId) ?? null;
        const selectedModel = providerEntry?.models.find(
          (model) => model.slug === child.modelSelection.model,
        );
        const modelLabel = resolveSidebarModelShortName({
          modelSlug: child.modelSelection.model,
          selectedModel,
          driverKind: providerEntry?.driverKind,
        });
        const providerPresentation = resolveDelegatedChildProviderPresentation({
          providerEntry,
          modelInstanceId,
          runtimeProviderName: child.runtime?.providerName,
          modelSlug: child.modelSelection.model,
          selectedModelName: selectedModel?.name,
        });

        const canArchive =
          canOperateEnvironment &&
          onArchiveChild !== undefined &&
          threadRuntimeCanArchive(child.runtime);
        const canDelete = canOperateEnvironment && onDeleteChild !== undefined;
        const hasHoverActions = canArchive || canDelete;

        const handleRowClick = (event: ReactMouseEvent) => {
          event.stopPropagation();
          onSelectChild(event, childRef);
        };
        const handleRowKeyDown = (event: ReactKeyboardEvent) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onActivateChild(childRef);
        };
        const handleRowContextMenu = (event: ReactMouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          onContextMenuChild(
            childRef,
            { x: event.clientX, y: event.clientY },
            contextMenuSourceOf(event),
          );
        };
        const handleActionPointerDown = (event: ReactPointerEvent) => {
          event.stopPropagation();
        };

        return (
          <li
            key={childKey}
            data-delegated-child-item={childKey}
            className="flex h-7 min-w-0 list-none items-center"
          >
            <TreeConnectorBranch
              gradientId={`pmx-tree-rgb-${safeTreeId}-${index}`}
              isLast={isLast}
              isChildActive={isChildActive}
              conductTrunkBelow={conductTrunkBelow}
            />
            <div
              role="button"
              tabIndex={0}
              data-sidebar-row={childKey}
              data-sidebar-parent={parentKey}
              data-delegated-child-row={childKey}
              data-sidebar-agent-active={isChildActive ? "1" : "0"}
              data-agent-lamp={agentLamp.state}
              data-testid="delegated-child-row"
              aria-current={isRouteActive ? "page" : undefined}
              aria-label={child.title}
              onClick={handleRowClick}
              onKeyDown={handleRowKeyDown}
              onContextMenu={handleRowContextMenu}
              className={cn(
                "group/delegated-row relative flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-left text-xs outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isRouteActive
                  ? "bg-sidebar-row-active/85 text-sidebar-foreground"
                  : "text-sidebar-foreground/82 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
              )}
            >
              <DelegatedChildStatusIcon
                status={status}
                isUnread={isUnread}
                hasRun={child.latestRun !== null}
              />
              <span
                aria-hidden
                data-agent-brand={providerPresentation.brandId}
                data-agent-logo-breathing={isChildActive ? "1" : "0"}
                className="inline-flex size-4 shrink-0 items-center justify-center"
              >
                <ProviderInstanceIcon
                  driverKind={providerPresentation.driverKind}
                  displayName={providerPresentation.displayName}
                  instanceId={providerPresentation.instanceId}
                  accentColor={providerPresentation.accentColor}
                  acpRegistryAgentId={providerPresentation.acpRegistryAgentId}
                  acpRegistryIconUrl={providerPresentation.acpRegistryIconUrl}
                  acpCommandPath={providerPresentation.acpCommandPath}
                  model={providerPresentation.model}
                  size="compact"
                  iconClassName="size-3.5 opacity-92 text-sidebar-foreground/90"
                />
              </span>
              <span
                data-testid="delegated-child-title"
                className={cn(
                  "min-w-0 flex-1 truncate text-xs leading-none",
                  isRouteActive || isUnread || isChildActive
                    ? "font-medium text-sidebar-foreground"
                    : "font-normal text-sidebar-foreground/80 group-hover/delegated-row:text-sidebar-foreground",
                )}
                dir={textDirection(child.title)}
              >
                {child.title}
              </span>
              <span className="relative ml-auto flex h-4 shrink-0 items-center justify-end gap-1">
                {modelLabel ? (
                  <span
                    data-testid="delegated-child-model"
                    className={cn(
                      "max-w-16 truncate font-mono text-3xs leading-none text-sidebar-muted-foreground/75 transition-opacity",
                      hasHoverActions &&
                        "group-hover/delegated-row:pointer-events-none group-hover/delegated-row:opacity-0 group-focus-within/delegated-row:pointer-events-none group-focus-within/delegated-row:opacity-0",
                    )}
                  >
                    {modelLabel}
                  </span>
                ) : null}
                {hasHoverActions ? (
                  <span
                    data-testid="delegated-child-hover-actions"
                    className="pointer-events-none absolute inset-y-0 right-0 inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover/delegated-row:pointer-events-auto group-hover/delegated-row:opacity-100 group-focus-within/delegated-row:pointer-events-auto group-focus-within/delegated-row:opacity-100"
                  >
                    {canArchive ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              data-testid="delegated-child-archive-action"
                              aria-label={gt("Archive thread")}
                              onPointerDown={handleActionPointerDown}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onArchiveChild?.(childRef);
                              }}
                              className={quickActionButtonClassName}
                            />
                          }
                        >
                          <ArchiveIcon className="size-3" />
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          <T>Archive thread</T>
                        </TooltipPopup>
                      </Tooltip>
                    ) : null}
                    {canDelete ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              data-testid="delegated-child-delete-action"
                              aria-label={gt("Delete", { $context: "verb, delete the thread" })}
                              onPointerDown={handleActionPointerDown}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onDeleteChild?.(childRef);
                              }}
                              className={cn(
                                quickActionButtonClassName,
                                "hover:bg-destructive/12 hover:text-destructive",
                              )}
                            />
                          }
                        >
                          <Trash2Icon className="size-3" />
                        </TooltipTrigger>
                        <TooltipPopup side="top">
                          <T context="verb, delete the thread">Delete</T>
                        </TooltipPopup>
                      </Tooltip>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
});
