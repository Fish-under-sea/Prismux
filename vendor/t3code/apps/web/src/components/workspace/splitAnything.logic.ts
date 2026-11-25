import type {
  EnvironmentId,
  ProviderInstanceId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import type { RightPanelSurface } from "../../rightPanelStore";
import type {
  OpenWorkspaceTabInput,
  SplitDirection,
  WorkspaceSplitLayoutNode,
  WorkspaceTabKind,
} from "./workspaceTabsStore";

export const PRISMUX_SPLIT_ITEM_MIME = "application/x-prismux-split-item";
export const PRISMUX_SPLIT_DRAG_EVENT = "prismux:split-drag";
export const WORKSPACE_TAB_DRAG_MIME = "application/x-prismux-workspace-tab";

export type SplitDropZone = "left" | "right" | "top" | "bottom" | "center";
export type SplitInsertPosition = "before" | "after";

export interface SplitPaneEdges {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

export const ROOT_SPLIT_PANE_EDGES: SplitPaneEdges = {
  top: true,
  right: true,
  bottom: true,
  left: true,
};

export type SplitDragPayload =
  | {
      readonly kind: "sidebar-thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly title: string;
      readonly providerId?: string | null | undefined;
      readonly instanceId?: ProviderInstanceId | null | undefined;
    }
  | {
      readonly kind: "right-panel-tab";
      readonly surfaceId: string;
      readonly surfaceKind: RightPanelSurface["kind"];
      readonly title: string;
      readonly hostThreadRef: ScopedThreadRef | null;
      readonly resourceId?: string | null | undefined;
      readonly url?: string | null | undefined;
      readonly relativePath?: string | null | undefined;
      readonly threadId?: ThreadId | null | undefined;
      readonly providerId?: string | null | undefined;
      readonly instanceId?: ProviderInstanceId | null | undefined;
    }
  | {
      readonly kind: "bottom-panel-tab";
      readonly terminalId: string;
      readonly title: string;
      readonly hostThreadRef: ScopedThreadRef;
    }
  | {
      readonly kind: "pane-tab";
      readonly tabId: string;
      readonly fromPaneId: string;
    };

export interface SplitDragEventDetail {
  readonly active: boolean;
  readonly payload: SplitDragPayload | null;
}

export interface PaneDropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ResolvePaneDropZoneOptions {
  readonly paneCount?: number | undefined;
  readonly maxSplitPanes?: number | undefined;
  readonly isSingleTabSelfDrag?: boolean | undefined;
  readonly edgeRatio?: number | undefined;
  readonly minEdgePx?: number | undefined;
  readonly maxEdgeRatio?: number | undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isScopedThreadRefLike(value: unknown): value is ScopedThreadRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return isNonEmptyString(candidate.environmentId) && isNonEmptyString(candidate.threadId);
}

export function serializeSplitDragPayload(payload: SplitDragPayload): string {
  return JSON.stringify(payload);
}

export function parseSplitDragPayload(raw: string | null | undefined): SplitDragPayload | null {
  if (!raw || typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // Backwards compatibility with legacy WORKSPACE_TAB_DRAG_MIME `{ tabId, fromPaneId }`.
  if (obj.kind === undefined && isNonEmptyString(obj.tabId) && isNonEmptyString(obj.fromPaneId)) {
    return {
      kind: "pane-tab",
      tabId: obj.tabId,
      fromPaneId: obj.fromPaneId,
    };
  }

  switch (obj.kind) {
    case "pane-tab": {
      if (!isNonEmptyString(obj.tabId) || !isNonEmptyString(obj.fromPaneId)) return null;
      return {
        kind: "pane-tab",
        tabId: obj.tabId,
        fromPaneId: obj.fromPaneId,
      };
    }
    case "sidebar-thread": {
      if (!isNonEmptyString(obj.environmentId) || !isNonEmptyString(obj.threadId)) return null;
      return {
        kind: "sidebar-thread",
        environmentId: obj.environmentId as EnvironmentId,
        threadId: obj.threadId as ThreadId,
        title: typeof obj.title === "string" ? obj.title : m(msg("Thread")),
        providerId: typeof obj.providerId === "string" ? obj.providerId : null,
        instanceId:
          typeof obj.instanceId === "string" ? (obj.instanceId as ProviderInstanceId) : null,
      };
    }
    case "right-panel-tab": {
      if (!isNonEmptyString(obj.surfaceId) || !isNonEmptyString(obj.surfaceKind)) return null;
      return {
        kind: "right-panel-tab",
        surfaceId: obj.surfaceId,
        surfaceKind: obj.surfaceKind as RightPanelSurface["kind"],
        title: typeof obj.title === "string" ? obj.title : "",
        hostThreadRef: isScopedThreadRefLike(obj.hostThreadRef) ? obj.hostThreadRef : null,
        resourceId: typeof obj.resourceId === "string" ? obj.resourceId : null,
        url: typeof obj.url === "string" ? obj.url : null,
        relativePath: typeof obj.relativePath === "string" ? obj.relativePath : null,
        threadId: typeof obj.threadId === "string" ? (obj.threadId as ThreadId) : null,
        providerId: typeof obj.providerId === "string" ? obj.providerId : null,
        instanceId:
          typeof obj.instanceId === "string" ? (obj.instanceId as ProviderInstanceId) : null,
      };
    }
    case "bottom-panel-tab": {
      if (!isNonEmptyString(obj.terminalId) || !isScopedThreadRefLike(obj.hostThreadRef)) {
        return null;
      }
      return {
        kind: "bottom-panel-tab",
        terminalId: obj.terminalId,
        title: typeof obj.title === "string" ? obj.title : m(msg("Terminal")),
        hostThreadRef: obj.hostThreadRef,
      };
    }
    default:
      return null;
  }
}

export function hasSplitDragMime(
  types: ReadonlyArray<string> | DOMStringList | null | undefined,
): boolean {
  if (!types) return false;
  for (let i = 0; i < types.length; i += 1) {
    const item = types[i];
    if (item === PRISMUX_SPLIT_ITEM_MIME || item === WORKSPACE_TAB_DRAG_MIME) {
      return true;
    }
  }
  return false;
}

export function writeSplitDragDataTransfer(
  dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">,
  payload: SplitDragPayload,
): void {
  const serialized = serializeSplitDragPayload(payload);
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(PRISMUX_SPLIT_ITEM_MIME, serialized);
  if (payload.kind === "pane-tab") {
    dataTransfer.setData(
      WORKSPACE_TAB_DRAG_MIME,
      JSON.stringify({ tabId: payload.tabId, fromPaneId: payload.fromPaneId }),
    );
  }
  // Keep a plain-text fallback so Chromium/Electron HTML5 drag always activates cleanly.
  const label =
    payload.kind === "pane-tab" ? payload.tabId : payload.title || payload.kind;
  try {
    dataTransfer.setData("text/plain", label);
  } catch {
    // Ignore restricted DataTransfer mocks
  }
}

export function readSplitDragDataTransfer(
  dataTransfer: Pick<DataTransfer, "getData"> | null | undefined,
): SplitDragPayload | null {
  if (!dataTransfer) return null;
  const primary = parseSplitDragPayload(dataTransfer.getData(PRISMUX_SPLIT_ITEM_MIME));
  if (primary) return primary;
  return parseSplitDragPayload(dataTransfer.getData(WORKSPACE_TAB_DRAG_MIME));
}

export function dispatchSplitDragEvent(
  active: boolean,
  payload: SplitDragPayload | null,
): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SplitDragEventDetail>(PRISMUX_SPLIT_DRAG_EVENT, {
      detail: {
        active,
        payload: active ? payload : null,
      },
    }),
  );
}

/**
 * Resolves which split drop zone (`left`, `right`, `top`, `bottom`, or `center`) is hovered
 * inside a pane body rectangle using clamped 25% edge zones with a 48px minimum edge guard
 * (max 32% so the center merge zone always stays reachable on narrow/short panes).
 */
export function resolvePaneDropZone(
  rect: PaneDropRect,
  clientX: number,
  clientY: number,
  options?: ResolvePaneDropZoneOptions,
): SplitDropZone {
  if (rect.width <= 0 || rect.height <= 0) {
    return "center";
  }
  if (options?.isSingleTabSelfDrag) {
    return "center";
  }
  if (
    options?.paneCount !== undefined &&
    options?.maxSplitPanes !== undefined &&
    options.paneCount >= options.maxSplitPanes
  ) {
    return "center";
  }

  const baseRatio = options?.edgeRatio ?? 0.25;
  const minEdgePx = options?.minEdgePx ?? 48;
  const maxEdgeRatio = options?.maxEdgeRatio ?? 0.32;

  const nx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const ny = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));

  const tx = Math.min(maxEdgeRatio, Math.max(baseRatio, minEdgePx / rect.width));
  const ty = Math.min(maxEdgeRatio, Math.max(baseRatio, minEdgePx / rect.height));

  const scores: ReadonlyArray<{ readonly zone: Exclude<SplitDropZone, "center">; readonly score: number }> = [
    { zone: "left", score: nx / tx },
    { zone: "right", score: (1 - nx) / tx },
    { zone: "top", score: ny / ty },
    { zone: "bottom", score: (1 - ny) / ty },
  ];

  let best = scores[0]!;
  for (let i = 1; i < scores.length; i += 1) {
    const candidate = scores[i]!;
    if (candidate.score < best.score) {
      best = candidate;
    }
  }

  return best.score <= 1 ? best.zone : "center";
}

export function resolveSplitPlacementFromZone(
  zone: Exclude<SplitDropZone, "center">,
): { readonly direction: SplitDirection; readonly position: SplitInsertPosition } {
  switch (zone) {
    case "left":
      return { direction: "horizontal", position: "before" };
    case "right":
      return { direction: "horizontal", position: "after" };
    case "top":
      return { direction: "vertical", position: "before" };
    case "bottom":
      return { direction: "vertical", position: "after" };
  }
}

export function resolveDropPreviewOverlayClass(zone: SplitDropZone): string {
  const base =
    "pointer-events-none absolute z-40 rounded-none border-2 border-primary/75 bg-primary/14 transition-[inset] duration-75";
  switch (zone) {
    case "left":
      return `${base} inset-y-0 left-0 right-1/2`;
    case "right":
      return `${base} inset-y-0 left-1/2 right-0`;
    case "top":
      return `${base} inset-x-0 top-0 bottom-1/2`;
    case "bottom":
      return `${base} inset-x-0 top-1/2 bottom-0`;
    case "center":
      return `${base} inset-0`;
  }
}

export function resolveDropZoneLabel(zone: SplitDropZone): string {
  switch (zone) {
    case "left":
      return "左侧分屏";
    case "right":
      return "右侧分屏";
    case "top":
      return "上方分屏";
    case "bottom":
      return "下方分屏";
    case "center":
      return "合并为标签页";
  }
}

/**
 * Clamps a live resize ratio against both the global `[minRatio, maxRatio]` bounds
 * and an optional minimum pane pixel guardrail (`minPanePx`) so adjacent panes never collapse.
 */
export function computeClampedSplitRatio(
  offsetPx: number,
  totalPx: number,
  options?: {
    readonly fallbackRatio?: number | undefined;
    readonly minRatio?: number | undefined;
    readonly maxRatio?: number | undefined;
    readonly minPanePx?: number | undefined;
  },
): number {
  const fallback = options?.fallbackRatio ?? 0.5;
  const baseMin = options?.minRatio ?? 0.18;
  const baseMax = options?.maxRatio ?? 0.82;
  const minPanePx = options?.minPanePx ?? 180;
  if (!Number.isFinite(totalPx) || totalPx <= 1 || !Number.isFinite(offsetPx)) {
    return fallback;
  }
  const pixelMinRatio = Math.min(0.45, Math.max(baseMin, minPanePx / totalPx));
  const effectiveMin = Math.max(baseMin, pixelMinRatio);
  const effectiveMax = Math.min(baseMax, 1 - effectiveMin);
  if (effectiveMin >= effectiveMax) {
    return 0.5;
  }
  return Math.min(effectiveMax, Math.max(effectiveMin, offsetPx / totalPx));
}

export function deriveChildSplitEdges(
  parentEdges: SplitPaneEdges,
  direction: SplitDirection,
): { readonly first: SplitPaneEdges; readonly second: SplitPaneEdges } {
  if (direction === "horizontal") {
    return {
      first: {
        top: parentEdges.top,
        left: parentEdges.left,
        right: false,
        bottom: parentEdges.bottom,
      },
      second: {
        top: parentEdges.top,
        left: false,
        right: parentEdges.right,
        bottom: parentEdges.bottom,
      },
    };
  }
  return {
    first: {
      top: parentEdges.top,
      left: parentEdges.left,
      right: parentEdges.right,
      bottom: false,
    },
    second: {
      top: false,
      left: parentEdges.left,
      right: parentEdges.right,
      bottom: parentEdges.bottom,
    },
  };
}

export function computePaneEdgesMap(
  node: WorkspaceSplitLayoutNode,
  edges: SplitPaneEdges = ROOT_SPLIT_PANE_EDGES,
): Record<string, SplitPaneEdges> {
  if (node.type === "leaf") {
    return { [node.paneId]: edges };
  }
  const childEdges = deriveChildSplitEdges(edges, node.direction);
  return {
    ...computePaneEdgesMap(node.first, childEdges.first),
    ...computePaneEdgesMap(node.second, childEdges.second),
  };
}

/**
 * Returns corner radius classes for a split pane body so ONLY the outermost stage canvas
 * retains rounded corners while EVERY interior junction strictly enforces `rounded-none`.
 */
export function resolvePaneBodyCornerClasses(
  edges: SplitPaneEdges,
  isSplit: boolean,
): string {
  if (!isSplit) return "";
  const tl =
    edges.top && edges.left
      ? "rounded-tl-[var(--pmx-inner-stage-radius,14px)]"
      : "rounded-tl-none";
  const tr =
    edges.top && edges.right
      ? "rounded-tr-[var(--pmx-inner-stage-radius,14px)]"
      : "rounded-tr-none";
  const bl =
    edges.bottom && edges.left
      ? "rounded-bl-[var(--pmx-inner-stage-radius,14px)]"
      : "rounded-bl-none";
  const br =
    edges.bottom && edges.right
      ? "rounded-br-[var(--pmx-inner-stage-radius,14px)]"
      : "rounded-br-none";
  return `${tl} ${tr} ${bl} ${br}`;
}

/**
 * Returns outer bezel border classes for a split pane body so outer edges get a clean 1px
 * boundary while interior seams stay `border-0` (owned solely by the 1px SplitResizeHandle).
 */
export function resolvePaneOuterBorderClasses(
  edges: SplitPaneEdges,
  isSplit: boolean,
): string {
  if (!isSplit) return "";
  const parts: string[] = [
    edges.top ? "border-t border-t-border/60" : "border-t-0",
    edges.right ? "border-r border-r-border/60" : "border-r-0",
    edges.bottom ? "border-b border-b-border/60" : "border-b-0",
    edges.left ? "border-l border-l-border/60" : "border-l-0",
  ];
  return parts.join(" ");
}

export function mapRightPanelSurfaceKindToTabKind(
  surfaceKind: RightPanelSurface["kind"],
  options?: { readonly hasThreadBinding?: boolean | undefined },
): WorkspaceTabKind {
  switch (surfaceKind) {
    case "terminal":
      return "terminal";
    case "diff":
      return "diff";
    case "preview":
      return "browser";
    case "files":
    case "file":
      return "files";
    case "pull-requests":
    case "pull-request":
    case "pull-request-empty":
    case "issue":
    case "agent-aux":
      return "related";
    case "device":
      return "device";
    case "thread":
    case "side-chat-empty":
    case "linked-thread":
      return "side-chat";
    case "agent-session":
      return options?.hasThreadBinding ? "thread" : "agent";
    case "wallpaper":
    default:
      return "related";
  }
}

export function buildOpenTabInputFromSplitPayload(
  payload: Exclude<SplitDragPayload, { readonly kind: "pane-tab" }>,
  fallbackHostThreadRef?: ScopedThreadRef | null,
): OpenWorkspaceTabInput {
  switch (payload.kind) {
    case "sidebar-thread":
      return {
        kind: "thread",
        title: payload.title.trim() || m(msg("Thread")),
        environmentId: payload.environmentId,
        threadId: payload.threadId,
        providerId: payload.providerId ?? null,
        instanceId: payload.instanceId ?? null,
        hostThreadRef: {
          environmentId: payload.environmentId,
          threadId: payload.threadId,
        },
        reuseExisting: false,
      };
    case "bottom-panel-tab":
      return {
        kind: "terminal",
        title: payload.title.trim() || m(msg("Terminal")),
        resourceId: payload.terminalId,
        hostThreadRef: payload.hostThreadRef,
        environmentId: payload.hostThreadRef.environmentId,
        threadId: payload.hostThreadRef.threadId,
        shell: "Terminal",
        reuseExisting: false,
      };
    case "right-panel-tab": {
      const hostRef = payload.hostThreadRef ?? fallbackHostThreadRef ?? null;
      const hasThreadBinding = Boolean(hostRef?.environmentId && payload.threadId);
      const kind = mapRightPanelSurfaceKindToTabKind(payload.surfaceKind, {
        hasThreadBinding,
      });
      const defaultTitleByKind: Record<WorkspaceTabKind, string> = {
        thread: "会话",
        draft: "新会话",
        agent: "Agent",
        terminal: "终端",
        diff: "差异",
        browser: "内置浏览器",
        simulator: "手机模拟",
        files: "文件",
        related: "已关联项",
        device: "设备",
        "side-chat": "旁路提问",
      };
      const resourceId =
        payload.relativePath ??
        payload.resourceId ??
        (payload.surfaceKind === "files" ? "files" : payload.surfaceId);
      return {
        kind,
        title: payload.title.trim() || defaultTitleByKind[kind],
        providerId: payload.providerId ?? null,
        instanceId: payload.instanceId ?? null,
        environmentId: hostRef?.environmentId ?? null,
        threadId: payload.threadId ?? hostRef?.threadId ?? null,
        hostThreadRef: hostRef,
        url: payload.url ?? null,
        resourceId,
        reuseExisting: false,
      };
    }
  }
}
