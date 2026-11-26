import type {
  DaemonStorageCleanAction,
  DaemonStorageCleanRequest,
  DaemonStorageNodeDto,
  DaemonStorageSafetyTier,
} from "../../prismux/daemonClient";

export const DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES = 5 * 1024 * 1024 * 1024;

export interface TreemapInputNode {
  readonly id: string;
  readonly bytes: number;
}

export interface TreemapBounds {
  readonly width: number;
  readonly height: number;
}

export interface TreemapRect<T extends TreemapInputNode = TreemapInputNode> {
  readonly item: T;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly xPercent: number;
  readonly yPercent: number;
  readonly widthPercent: number;
  readonly heightPercent: number;
  readonly sharePercent: number;
}

interface AreaItem<T extends TreemapInputNode> {
  readonly item: T;
  readonly area: number;
}

interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function worstAspectRatio(rowAreas: readonly number[], sideLength: number): number {
  if (rowAreas.length === 0 || sideLength <= 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let maxArea = 0;
  let minArea = Number.POSITIVE_INFINITY;
  for (const area of rowAreas) {
    sum += area;
    if (area > maxArea) maxArea = area;
    if (area < minArea) minArea = area;
  }
  if (sum <= 0 || minArea <= 0) return Number.POSITIVE_INFINITY;
  const sideSq = sideLength * sideLength;
  const sumSq = sum * sum;
  return Math.max((sideSq * maxArea) / sumSq, sumSq / (sideSq * minArea));
}

function commitTreemapRow<T extends TreemapInputNode>(
  row: readonly AreaItem<T>[],
  box: LayoutBox,
  bounds: TreemapBounds,
  totalBytes: number,
  out: TreemapRect<T>[],
): void {
  if (row.length === 0 || box.width <= 0 || box.height <= 0) return;
  const rowAreaSum = row.reduce((acc, entry) => acc + entry.area, 0);
  if (rowAreaSum <= 0) return;

  const horizontalStrip = box.width < box.height;
  if (horizontalStrip) {
    const stripHeight = Math.min(box.height, rowAreaSum / box.width);
    let cursorX = box.x;
    for (let i = 0; i < row.length; i += 1) {
      const entry = row[i]!;
      const isLast = i === row.length - 1;
      const itemWidth = isLast
        ? Math.max(0, box.x + box.width - cursorX)
        : Math.min(box.x + box.width - cursorX, entry.area / stripHeight);
      out.push({
        item: entry.item,
        x: cursorX,
        y: box.y,
        width: itemWidth,
        height: stripHeight,
        xPercent: (cursorX / bounds.width) * 100,
        yPercent: (box.y / bounds.height) * 100,
        widthPercent: (itemWidth / bounds.width) * 100,
        heightPercent: (stripHeight / bounds.height) * 100,
        sharePercent: (entry.item.bytes / totalBytes) * 100,
      });
      cursorX += itemWidth;
    }
    box.y += stripHeight;
    box.height = Math.max(0, box.height - stripHeight);
  } else {
    const stripWidth = Math.min(box.width, rowAreaSum / box.height);
    let cursorY = box.y;
    for (let i = 0; i < row.length; i += 1) {
      const entry = row[i]!;
      const isLast = i === row.length - 1;
      const itemHeight = isLast
        ? Math.max(0, box.y + box.height - cursorY)
        : Math.min(box.y + box.height - cursorY, entry.area / stripWidth);
      out.push({
        item: entry.item,
        x: box.x,
        y: cursorY,
        width: stripWidth,
        height: itemHeight,
        xPercent: (box.x / bounds.width) * 100,
        yPercent: (cursorY / bounds.height) * 100,
        widthPercent: (stripWidth / bounds.width) * 100,
        heightPercent: (itemHeight / bounds.height) * 100,
        sharePercent: (entry.item.bytes / totalBytes) * 100,
      });
      cursorY += itemHeight;
    }
    box.x += stripWidth;
    box.width = Math.max(0, box.width - stripWidth);
  }
}

/**
 * Pure Bruls-Huizing-van Wijk Squarified Treemap layout.
 * Produces non-overlapping proportional rectangles conserving 100% of total area.
 */
export function computeSquarifiedTreemap<T extends TreemapInputNode>(
  items: readonly T[],
  bounds: TreemapBounds = { width: 1000, height: 320 },
): readonly TreemapRect<T>[] {
  if (bounds.width <= 0 || bounds.height <= 0) return [];
  const valid = items
    .filter((item) => Number.isFinite(item.bytes) && item.bytes > 0)
    .toSorted((left, right) =>
      right.bytes !== left.bytes ? right.bytes - left.bytes : left.id.localeCompare(right.id),
    );
  if (valid.length === 0) return [];

  const totalBytes = valid.reduce((acc, item) => acc + item.bytes, 0);
  if (totalBytes <= 0) return [];

  const totalArea = bounds.width * bounds.height;
  const scaled: AreaItem<T>[] = valid.map((item) => ({
    item,
    area: (item.bytes / totalBytes) * totalArea,
  }));

  const box: LayoutBox = { x: 0, y: 0, width: bounds.width, height: bounds.height };
  const result: TreemapRect<T>[] = [];
  let row: AreaItem<T>[] = [];
  let rowAreas: number[] = [];

  for (const next of scaled) {
    const shortSide = Math.min(box.width, box.height);
    if (shortSide <= 0) break;
    if (row.length === 0) {
      row = [next];
      rowAreas = [next.area];
      continue;
    }
    const currentWorst = worstAspectRatio(rowAreas, shortSide);
    const candidateAreas = [...rowAreas, next.area];
    const nextWorst = worstAspectRatio(candidateAreas, shortSide);
    if (nextWorst <= currentWorst) {
      row.push(next);
      rowAreas = candidateAreas;
    } else {
      commitTreemapRow(row, box, bounds, totalBytes, result);
      row = [next];
      rowAreas = [next.area];
    }
  }

  if (row.length > 0) {
    commitTreemapRow(row, box, bounds, totalBytes, result);
  }

  return result;
}

export interface StorageDrillBreadcrumb {
  readonly id: string;
  readonly name: string;
}

export interface StorageDrillLevel {
  readonly nodes: readonly DaemonStorageNodeDto[];
  readonly breadcrumbs: readonly StorageDrillBreadcrumb[];
  readonly activeParent: DaemonStorageNodeDto | null;
  readonly totalBytes: number;
}

export function resolveStorageDrillLevel(
  categories: readonly DaemonStorageNodeDto[],
  drillPathIds: readonly string[],
): StorageDrillLevel {
  let currentNodes: readonly DaemonStorageNodeDto[] = categories;
  let activeParent: DaemonStorageNodeDto | null = null;
  const breadcrumbs: StorageDrillBreadcrumb[] = [];

  for (const segmentId of drillPathIds) {
    const match = currentNodes.find((node) => node.id === segmentId);
    if (!match || !match.children || match.children.length === 0) {
      break;
    }
    breadcrumbs.push({ id: match.id, name: match.name });
    activeParent = match;
    currentNodes = match.children;
  }

  const sortedNodes = currentNodes
    .filter((node) => Number.isFinite(node.bytes) && node.bytes >= 0)
    .toSorted((left, right) =>
      right.bytes !== left.bytes ? right.bytes - left.bytes : left.name.localeCompare(right.name),
    );
  const sumBytes = sortedNodes.reduce((acc, node) => acc + Math.max(0, node.bytes), 0);
  const totalBytes = activeParent ? Math.max(activeParent.bytes, sumBytes) : sumBytes;

  return {
    nodes: sortedNodes,
    breadcrumbs,
    activeParent,
    totalBytes,
  };
}

export function resolveStorageFootprintTone(
  totalBytes: number,
  warningThresholdBytes: number = DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES,
): "default" | "warning" | "danger" {
  const threshold =
    warningThresholdBytes > 0 ? warningThresholdBytes : DEFAULT_STORAGE_WARNING_THRESHOLD_BYTES;
  if (totalBytes >= threshold * 1.5) return "danger";
  if (totalBytes >= threshold) return "warning";
  return "default";
}

export function summarizeStorageTiers(
  categories: readonly DaemonStorageNodeDto[],
): Readonly<Record<DaemonStorageSafetyTier, { readonly bytes: number; readonly count: number }>> {
  let disposableBytes = 0;
  let disposableCount = 0;
  let managedBytes = 0;
  let managedCount = 0;
  let protectedBytes = 0;
  let protectedCount = 0;

  for (const category of categories) {
    const bytes = Math.max(0, category.bytes);
    if (category.tier === "disposable") {
      disposableBytes += bytes;
      disposableCount += 1;
    } else if (category.tier === "managed") {
      managedBytes += bytes;
      managedCount += 1;
    } else {
      protectedBytes += bytes;
      protectedCount += 1;
    }
  }

  return {
    disposable: { bytes: disposableBytes, count: disposableCount },
    managed: { bytes: managedBytes, count: managedCount },
    protected: { bytes: protectedBytes, count: protectedCount },
  };
}

export function buildDisposableCleanRequest(
  categories: readonly DaemonStorageNodeDto[],
): DaemonStorageCleanRequest | null {
  const cleanable = categories.filter(
    (category) => category.tier === "disposable" && category.cleanable && category.bytes > 0,
  );
  if (cleanable.length === 0) return null;

  const targetIds = cleanable.map((category) => category.id);
  const actionSet = new Set<DaemonStorageCleanAction>();
  for (const category of cleanable) {
    if (category.cleanAction) {
      actionSet.add(category.cleanAction);
    }
  }
  return actionSet.size > 0
    ? { targetIds, actions: Array.from(actionSet) }
    : { targetIds };
}

export function buildManagedCleanRequest(
  categories: readonly DaemonStorageNodeDto[],
  selectedIds: ReadonlySet<string>,
): DaemonStorageCleanRequest | null {
  const selected = categories.filter(
    (category) =>
      category.tier === "managed" &&
      category.cleanable &&
      category.bytes > 0 &&
      selectedIds.has(category.id),
  );
  if (selected.length === 0) return null;
  const targetIds = selected.map((category) => category.id);
  const actionSet = new Set<DaemonStorageCleanAction>();
  for (const category of selected) {
    if (category.cleanAction) {
      actionSet.add(category.cleanAction);
    }
  }
  return actionSet.size > 0
    ? { targetIds, actions: Array.from(actionSet) }
    : { targetIds };
}

export function buildCompactDatabaseCleanRequest(): DaemonStorageCleanRequest {
  return { actions: ["compact-db"] };
}
