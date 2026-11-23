import { DEFAULT_INNER_STAGE_RADIUS_PX } from './glassEngine.js';

export const PMX_SHELL_CUTOUT_ROOT_ATTR = 'data-pmx-shell-cutout';
export const PMX_SHELL_BACKDROP_ATTR = 'data-pmx-shell-backdrop';
export const PMX_SHELL_CUTOUT_SVG_ATTR = 'data-pmx-shell-cutout-svg';
export const PMX_CUTOUT_ACTIVE_ATTR = 'data-pmx-cutout-active';
export const PMX_SHELL_CUTOUT_MASK_ID = 'pmx-shell-cutout-mask';

export const DEFAULT_SHELL_CUTOUT_INSET_PX = 0.5;
export const DEFAULT_STAGE_FRAME_SELECTOR = '[data-pmx-stage-frame="1"]';
export const DEFAULT_RIGHT_SIDEBAR_SELECTOR = '[data-preview-panel-mode="inline"]';
const SIDEBAR_GAP_SELECTOR = '[data-slot="sidebar-gap"], [data-slot="sidebar-container"]';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_VISIBLE_EXTENT_PX = 1;
const DEFAULT_MAX_TRANSITION_TRACK_MS = 650;

const LAYOUT_TRANSITION_PROPS = new Set([
  'all',
  'width',
  'min-width',
  'max-width',
  'height',
  'left',
  'right',
  'top',
  'bottom',
  'flex',
  'flex-basis',
  'margin',
  'margin-left',
  'margin-right',
  'padding',
  'padding-left',
  'padding-right',
  'grid-template-columns',
  'transform',
]);

export interface ShellCutoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShellCutoutHole extends ShellCutoutRect {
  readonly rx: number;
  readonly ry: number;
}

export interface ShellCutoutGeometryInput {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly stageRects: readonly ShellCutoutRect[];
  readonly stageRadiusPx?: number;
  readonly insetPx?: number;
  readonly glassActive: boolean;
  readonly rightSidebarMode?: string | null;
  readonly rightSidebarFullClear?: boolean;
  readonly rightSidebarRects?: readonly ShellCutoutRect[];
}

export interface ShellCutoutGeometry {
  readonly active: boolean;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly stageHoles: readonly ShellCutoutHole[];
  readonly rightSidebarHoles: readonly ShellCutoutRect[];
  readonly signature: string;
}

export interface ShellCutoutElementLike {
  readonly nodeType?: number;
  readonly isConnected?: boolean;
  readonly style?: {
    setProperty?(name: string, value: string): void;
    removeProperty?(name: string): void;
    getPropertyValue?(name: string): string;
    [key: string]: unknown;
  };
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
    right?: number;
    bottom?: number;
  };
  getAttribute?(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  appendChild?(child: unknown): unknown;
  remove?(): void;
  closest?(selector: string): unknown;
  matches?(selector: string): boolean;
  querySelector?(selector: string): unknown;
  querySelectorAll?(selector: string): ArrayLike<unknown>;
}

export interface ShellCutoutDocumentLike {
  readonly documentElement: {
    readonly clientWidth?: number;
    readonly clientHeight?: number;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  } | null;
  readonly body: {
    appendChild(child: unknown): unknown;
    querySelectorAll?(selector: string): ArrayLike<unknown>;
  } | null;
  readonly defaultView?: {
    readonly innerWidth?: number;
    readonly innerHeight?: number;
    getComputedStyle?: (el: never) => {
      getPropertyValue?: (prop: string) => string;
      visibility?: string;
      display?: string;
    } | null;
    requestAnimationFrame?: (cb: (ts: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    addEventListener?: (
      type: string,
      listener: (event: unknown) => void,
      options?: boolean | AddEventListenerOptions,
    ) => void;
    removeEventListener?: (
      type: string,
      listener: (event: unknown) => void,
      options?: boolean | EventListenerOptions,
    ) => void;
    ResizeObserver?: typeof ResizeObserver;
    MutationObserver?: typeof MutationObserver;
  } | null;
  createElement(tagName: string): ShellCutoutElementLike;
  createElementNS?(ns: string, tagName: string): ShellCutoutElementLike;
  querySelectorAll(selector: string): ArrayLike<ShellCutoutElementLike>;
  addEventListener?(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener?(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface ShellCutoutOptions {
  /** Custom SVG `<mask>` element ID (default: `pmx-shell-cutout-mask`). */
  maskId?: string;
  /** CSS selector for central workspace stage frame(s) (default: `[data-pmx-stage-frame="1"]`). */
  stageFrameSelector?: string;
  /** CSS selector for inline right feature sidebar(s) (default: `[data-preview-panel-mode="inline"]`). */
  rightSidebarSelector?: string;
  /** Subpixel inset tucking the cutout edge dead-center under the 1px `::after` ring (default: `0.5`). */
  insetPx?: number;
  /** Maximum duration (ms) for bounded 60fps tracking during sidebar CSS width transitions. */
  maxTransitionTrackMs?: number;
  /** Optional style resolver for tests or custom environments. */
  getComputedStyle?: (el: unknown) => {
    getPropertyValue?: (prop: string) => string;
    visibility?: string;
    display?: string;
  } | null;
  /** Optional monotonic clock for testing. */
  now?: () => number;
}

export interface ShellCutoutHandle {
  /** Synchronously re-measures stage geometry and updates the SVG `<mask>` cutout. */
  syncNow(): ShellCutoutGeometry;
  /** Returns `true` while the single-layer cutout shell backdrop is actively masking stage hole(s). */
  isActive(): boolean;
  /** Returns the most recently computed cutout geometry snapshot. */
  getGeometry(): ShellCutoutGeometry;
  /** Idempotently disconnects observers/listeners and removes all injected DOM nodes & attributes. */
  dispose(): void;
}

const EMPTY_GEOMETRY: ShellCutoutGeometry = Object.freeze({
  active: false,
  viewportWidth: 0,
  viewportHeight: 0,
  stageHoles: Object.freeze([]),
  rightSidebarHoles: Object.freeze([]),
  signature: 'inactive',
});

function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function isRectVisibleInViewport(
  rect: ShellCutoutRect,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return false;
  }
  if (rect.width <= MIN_VISIBLE_EXTENT_PX || rect.height <= MIN_VISIBLE_EXTENT_PX) {
    return false;
  }
  if (rect.x + rect.width <= 0 || rect.y + rect.height <= 0) {
    return false;
  }
  if (rect.x >= viewportWidth || rect.y >= viewportHeight) {
    return false;
  }
  return true;
}

/**
 * Pure geometry solver for the single-layer viewport-wide shell backdrop SVG `<mask>`.
 * Computes the exact rounded stage hole(s) (with `0.5px` subpixel tuck under the `1px` `::after`
 * inner ring) and optional secondary right-sidebar hole(s) when `rightSidebar` runs independently
 * (`custom`, `solid`, or `rightSidebarFullClear`) in Liquid Glass mode.
 */
export function computeShellCutoutGeometry(input: ShellCutoutGeometryInput): ShellCutoutGeometry {
  const vw = Number.isFinite(input.viewportWidth) ? Math.max(0, round2(input.viewportWidth)) : 0;
  const vh = Number.isFinite(input.viewportHeight) ? Math.max(0, round2(input.viewportHeight)) : 0;
  if (vw <= 0 || vh <= 0) {
    return EMPTY_GEOMETRY;
  }

  const rawRadius =
    typeof input.stageRadiusPx === 'number' && Number.isFinite(input.stageRadiusPx)
      ? Math.max(0, input.stageRadiusPx)
      : DEFAULT_INNER_STAGE_RADIUS_PX;
  const rawInset =
    typeof input.insetPx === 'number' && Number.isFinite(input.insetPx)
      ? Math.max(0, input.insetPx)
      : DEFAULT_SHELL_CUTOUT_INSET_PX;

  const stageHoles: ShellCutoutHole[] = [];
  for (const rect of input.stageRects) {
    if (!isRectVisibleInViewport(rect, vw, vh)) continue;
    const inset = Math.min(rawInset, rect.width / 2, rect.height / 2);
    const x = round2(rect.x + inset);
    const y = round2(rect.y + inset);
    const width = round2(Math.max(0, rect.width - inset * 2));
    const height = round2(Math.max(0, rect.height - inset * 2));
    if (width <= 0 || height <= 0) continue;
    const adjustedRadius = rawRadius > 0 ? Math.max(0, rawRadius - inset) : 0;
    const r = round2(Math.max(0, Math.min(adjustedRadius, width / 2, height / 2)));
    stageHoles.push({ x, y, width, height, rx: r, ry: r });
  }

  if (stageHoles.length === 0) {
    return {
      active: false,
      viewportWidth: vw,
      viewportHeight: vh,
      stageHoles: [],
      rightSidebarHoles: [],
      signature: `inactive:${vw}x${vh}`,
    };
  }

  const rightMode = (input.rightSidebarMode ?? '').trim().toLowerCase();
  const rightSidebarSeparate =
    input.glassActive &&
    (rightMode === 'custom' || rightMode === 'solid' || Boolean(input.rightSidebarFullClear));

  const rightSidebarHoles: ShellCutoutRect[] = [];
  if (rightSidebarSeparate && input.rightSidebarRects && input.rightSidebarRects.length > 0) {
    for (const rect of input.rightSidebarRects) {
      if (!isRectVisibleInViewport(rect, vw, vh)) continue;
      rightSidebarHoles.push({
        x: round2(rect.x),
        y: round2(rect.y),
        width: round2(rect.width),
        height: round2(rect.height),
      });
    }
  }

  const stageSig = stageHoles
    .map((h) => `${h.x},${h.y},${h.width},${h.height},${h.rx},${h.ry}`)
    .join(';');
  const rightSig = rightSidebarHoles
    .map((r) => `${r.x},${r.y},${r.width},${r.height}`)
    .join(';');

  return {
    active: true,
    viewportWidth: vw,
    viewportHeight: vh,
    stageHoles,
    rightSidebarHoles,
    signature: `active:${vw}x${vh}|s:${stageSig}|r:${rightSig}`,
  };
}

function createSvgElement(
  doc: ShellCutoutDocumentLike,
  tagName: string,
): ShellCutoutElementLike {
  if (typeof doc.createElementNS === 'function') {
    return doc.createElementNS(SVG_NS, tagName);
  }
  return doc.createElement(tagName);
}

function parsePixelValue(raw: string | null | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function setStyleProp(el: ShellCutoutElementLike, prop: string, value: string): void {
  if (!el.style) return;
  if (typeof el.style.setProperty === 'function') {
    el.style.setProperty(prop, value);
    return;
  }
  const camel = prop.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase());
  el.style[camel] = value;
}

function isElementVisiblyRendered(
  el: ShellCutoutElementLike,
  resolveStyle: (node: unknown) => { visibility?: string; display?: string } | null,
): boolean {
  if (el.isConnected === false) return false;
  if (el.getAttribute?.('data-workspace-unavailable') === 'true') return false;
  const style = resolveStyle(el);
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
  }
  return true;
}

function nodeContainsSelector(node: unknown, selector: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const el = node as Partial<ShellCutoutElementLike>;
  if (typeof el.nodeType === 'number' && el.nodeType !== 1) return false;
  if (typeof el.matches === 'function') {
    try {
      if (el.matches(selector)) return true;
    } catch {
      // Ignore selector syntax issues in mock DOMs.
    }
  }
  if (typeof el.querySelector === 'function') {
    try {
      if (el.querySelector(selector)) return true;
    } catch {
      // Ignore selector syntax issues in mock DOMs.
    }
  }
  return false;
}

/**
 * Installs Prismux's single-layer continuous viewport-wide shell backdrop (`[data-pmx-shell-backdrop="1"]`)
 * with an inline SVG `<mask>` cutout synced to `[data-pmx-stage-frame="1"]` via `ResizeObserver`,
 * `MutationObserver`, CSS transition frame tracking, and `requestAnimationFrame`.
 *
 * Eliminates 100% of Chromium `backdrop-filter` blur-kernel corner color mismatches and subpixel
 * seams between the left sidebar, top tab bar, bottom status bar, right edge / inline right sidebar,
 * and all 4 concave rounded inner corners across 100%–200% DPI scaling.
 */
export function installPrismuxShellCutout(
  doc?: Document | ShellCutoutDocumentLike | null,
  options: ShellCutoutOptions = {},
): ShellCutoutHandle {
  const targetDoc =
    doc !== undefined
      ? (doc as ShellCutoutDocumentLike | null)
      : (globalThis.document as unknown as ShellCutoutDocumentLike | undefined);

  if (!targetDoc || !targetDoc.documentElement || !targetDoc.body) {
    return {
      syncNow: () => EMPTY_GEOMETRY,
      isActive: () => false,
      getGeometry: () => EMPTY_GEOMETRY,
      dispose() {},
    };
  }

  const html = targetDoc.documentElement;
  const body = targetDoc.body;
  const win = targetDoc.defaultView ?? null;
  const maskId = options.maskId?.trim() || PMX_SHELL_CUTOUT_MASK_ID;
  const stageSelector = options.stageFrameSelector || DEFAULT_STAGE_FRAME_SELECTOR;
  const rightSelector = options.rightSidebarSelector || DEFAULT_RIGHT_SIDEBAR_SELECTOR;
  const combinedSelector = `${stageSelector}, ${rightSelector}`;
  const insetPx = options.insetPx ?? DEFAULT_SHELL_CUTOUT_INSET_PX;
  const maxTransitionTrackMs = Math.max(
    100,
    options.maxTransitionTrackMs ?? DEFAULT_MAX_TRANSITION_TRACK_MS,
  );
  const now = options.now ?? (() => Date.now());

  const resolveStyle =
    options.getComputedStyle ??
    ((el: unknown) => {
      const fn =
        win && typeof win.getComputedStyle === 'function'
          ? (win.getComputedStyle as (node: unknown) => {
              getPropertyValue?: (prop: string) => string;
              visibility?: string;
              display?: string;
            } | null)
          : typeof globalThis.getComputedStyle === 'function'
            ? (globalThis.getComputedStyle as (node: unknown) => {
                getPropertyValue?: (prop: string) => string;
                visibility?: string;
                display?: string;
              } | null)
            : null;
      if (!fn) return null;
      try {
        return fn(el);
      } catch {
        return null;
      }
    });

  const scheduleFrame: (cb: (ts: number) => void) => number =
    win && typeof win.requestAnimationFrame === 'function'
      ? (cb) => win.requestAnimationFrame!(cb)
      : typeof globalThis.requestAnimationFrame === 'function'
        ? (cb) => globalThis.requestAnimationFrame(cb)
        : (cb) => Number(setTimeout(() => cb(now()), 16));

  const cancelFrame: (id: number) => void =
    win && typeof win.cancelAnimationFrame === 'function'
      ? (id) => win.cancelAnimationFrame!(id)
      : typeof globalThis.cancelAnimationFrame === 'function'
        ? (id) => globalThis.cancelAnimationFrame(id)
        : (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

  // Remove any stale instances (e.g. Vite HMR re-mount) so only one cutout layer exists.
  if (typeof body.querySelectorAll === 'function') {
    const stale = Array.from(
      body.querySelectorAll(`[${PMX_SHELL_BACKDROP_ATTR}="1"], [${PMX_SHELL_CUTOUT_SVG_ATTR}="1"]`),
    );
    for (const node of stale) {
      (node as Partial<ShellCutoutElementLike>)?.remove?.();
    }
  }

  // Build inline SVG <mask> (never `display: none`, which disables `<mask>` lookup in Chromium).
  const svgEl = createSvgElement(targetDoc, 'svg');
  svgEl.setAttribute('aria-hidden', 'true');
  svgEl.setAttribute(PMX_SHELL_CUTOUT_SVG_ATTR, '1');
  svgEl.setAttribute('width', '0');
  svgEl.setAttribute('height', '0');
  setStyleProp(svgEl, 'position', 'fixed');
  setStyleProp(svgEl, 'top', '0');
  setStyleProp(svgEl, 'left', '0');
  setStyleProp(svgEl, 'width', '0');
  setStyleProp(svgEl, 'height', '0');
  setStyleProp(svgEl, 'overflow', 'hidden');
  setStyleProp(svgEl, 'pointer-events', 'none');

  const defsEl = createSvgElement(targetDoc, 'defs');
  const maskEl = createSvgElement(targetDoc, 'mask');
  maskEl.setAttribute('id', maskId);
  maskEl.setAttribute('maskUnits', 'userSpaceOnUse');
  maskEl.setAttribute('maskContentUnits', 'userSpaceOnUse');
  maskEl.setAttribute('x', '0');
  maskEl.setAttribute('y', '0');
  maskEl.setAttribute('width', '0');
  maskEl.setAttribute('height', '0');
  setStyleProp(maskEl, 'mask-type', 'luminance');

  const bgRectEl = createSvgElement(targetDoc, 'rect');
  bgRectEl.setAttribute('data-pmx-cutout-bg', '1');
  bgRectEl.setAttribute('x', '0');
  bgRectEl.setAttribute('y', '0');
  bgRectEl.setAttribute('width', '0');
  bgRectEl.setAttribute('height', '0');
  bgRectEl.setAttribute('fill', '#ffffff');

  maskEl.appendChild?.(bgRectEl);
  defsEl.appendChild?.(maskEl);
  svgEl.appendChild?.(defsEl);

  // Build single continuous viewport-wide shell backdrop layer (z-index: 0, after #root in body:
  // strictly above Z-0 wallpaper inside #root and strictly below z-index: 1 appShell!).
  const backdropEl = targetDoc.createElement('div');
  backdropEl.setAttribute('aria-hidden', 'true');
  backdropEl.setAttribute(PMX_SHELL_BACKDROP_ATTR, '1');
  backdropEl.setAttribute(PMX_CUTOUT_ACTIVE_ATTR, '0');
  const maskUrl = `url(#${maskId})`;
  setStyleProp(backdropEl, '-webkit-mask-image', maskUrl);
  setStyleProp(backdropEl, 'mask-image', maskUrl);
  setStyleProp(backdropEl, 'mask-mode', 'luminance');

  body.appendChild(svgEl);
  body.appendChild(backdropEl);

  const stageRectPool: ShellCutoutElementLike[] = [];
  const rightRectPool: ShellCutoutElementLike[] = [];
  const observedResizeTargets = new Set<ShellCutoutElementLike>();

  let disposed = false;
  let lastGeometry: ShellCutoutGeometry = EMPTY_GEOMETRY;
  let pendingRafId: number | null = null;
  let transitionRafId: number | null = null;
  let activeTransitions = 0;
  let transitionTrackDeadline = 0;
  let targetsDirty = true;

  const ResizeObserverCtor =
    win?.ResizeObserver ??
    (typeof globalThis.ResizeObserver === 'function' ? globalThis.ResizeObserver : null);
  const MutationObserverCtor =
    win?.MutationObserver ??
    (typeof globalThis.MutationObserver === 'function' ? globalThis.MutationObserver : null);

  let resizeObserver: ResizeObserver | null = null;
  let rootAttrObserver: MutationObserver | null = null;
  let bodyTreeObserver: MutationObserver | null = null;

  const readStageRadiusPx = (): number => {
    const computed = resolveStyle(html);
    const raw = computed?.getPropertyValue?.('--pmx-inner-stage-radius');
    return parsePixelValue(raw, DEFAULT_INNER_STAGE_RADIUS_PX);
  };

  const readViewportSize = (): { width: number; height: number } => {
    const width =
      typeof win?.innerWidth === 'number' && win.innerWidth > 0
        ? win.innerWidth
        : typeof html.clientWidth === 'number' && html.clientWidth > 0
          ? html.clientWidth
          : 0;
    const height =
      typeof win?.innerHeight === 'number' && win.innerHeight > 0
        ? win.innerHeight
        : typeof html.clientHeight === 'number' && html.clientHeight > 0
          ? html.clientHeight
          : 0;
    return { width, height };
  };

  const syncResizeTargets = (
    stageEls: readonly ShellCutoutElementLike[],
    rightEls: readonly ShellCutoutElementLike[],
    sidebarEls: readonly ShellCutoutElementLike[],
  ): void => {
    if (!resizeObserver) return;
    const nextTargets = new Set<ShellCutoutElementLike>();
    for (const el of stageEls) nextTargets.add(el);
    for (const el of rightEls) nextTargets.add(el);
    for (const el of sidebarEls) nextTargets.add(el);

    for (const prev of Array.from(observedResizeTargets)) {
      if (!nextTargets.has(prev)) {
        try {
          resizeObserver.unobserve(prev as unknown as Element);
        } catch {
          // Ignore already-detached elements.
        }
        observedResizeTargets.delete(prev);
      }
    }
    for (const next of nextTargets) {
      if (!observedResizeTargets.has(next)) {
        try {
          resizeObserver.observe(next as unknown as Element);
          observedResizeTargets.add(next);
        } catch {
          // Ignore non-Element mocks.
        }
      }
    }
  };

  const reconcileRectPool = (
    pool: ShellCutoutElementLike[],
    targetCount: number,
    dataAttr: string,
    crispEdges: boolean,
  ): void => {
    while (pool.length < targetCount) {
      const rectEl = createSvgElement(targetDoc, 'rect');
      rectEl.setAttribute(dataAttr, String(pool.length));
      rectEl.setAttribute('fill', '#000000');
      if (crispEdges) {
        rectEl.setAttribute('shape-rendering', 'crispEdges');
      }
      maskEl.appendChild?.(rectEl);
      pool.push(rectEl);
    }
    while (pool.length > targetCount) {
      const removed = pool.pop();
      removed?.remove?.();
    }
  };

  const applyGeometryToDom = (geometry: ShellCutoutGeometry): void => {
    if (geometry.signature === lastGeometry.signature) {
      return;
    }
    lastGeometry = geometry;

    if (!geometry.active) {
      backdropEl.setAttribute(PMX_CUTOUT_ACTIVE_ATTR, '0');
      html.removeAttribute(PMX_SHELL_CUTOUT_ROOT_ATTR);
      return;
    }

    const vwStr = String(geometry.viewportWidth);
    const vhStr = String(geometry.viewportHeight);
    maskEl.setAttribute('width', vwStr);
    maskEl.setAttribute('height', vhStr);
    bgRectEl.setAttribute('width', vwStr);
    bgRectEl.setAttribute('height', vhStr);

    reconcileRectPool(stageRectPool, geometry.stageHoles.length, 'data-pmx-cutout-stage', false);
    for (let i = 0; i < geometry.stageHoles.length; i += 1) {
      const hole = geometry.stageHoles[i]!;
      const rectEl = stageRectPool[i]!;
      rectEl.setAttribute('x', String(hole.x));
      rectEl.setAttribute('y', String(hole.y));
      rectEl.setAttribute('width', String(hole.width));
      rectEl.setAttribute('height', String(hole.height));
      rectEl.setAttribute('rx', String(hole.rx));
      rectEl.setAttribute('ry', String(hole.ry));
    }

    reconcileRectPool(
      rightRectPool,
      geometry.rightSidebarHoles.length,
      'data-pmx-cutout-right',
      true,
    );
    for (let i = 0; i < geometry.rightSidebarHoles.length; i += 1) {
      const hole = geometry.rightSidebarHoles[i]!;
      const rectEl = rightRectPool[i]!;
      rectEl.setAttribute('x', String(hole.x));
      rectEl.setAttribute('y', String(hole.y));
      rectEl.setAttribute('width', String(hole.width));
      rectEl.setAttribute('height', String(hole.height));
    }

    backdropEl.setAttribute(PMX_CUTOUT_ACTIVE_ATTR, '1');
    html.setAttribute(PMX_SHELL_CUTOUT_ROOT_ATTR, '1');
  };

  const syncNow = (): ShellCutoutGeometry => {
    if (disposed) return lastGeometry;

    const stageEls = Array.from(targetDoc.querySelectorAll(stageSelector));
    const rightEls = Array.from(targetDoc.querySelectorAll(rightSelector));

    if (targetsDirty) {
      targetsDirty = false;
      const sidebarEls = Array.from(targetDoc.querySelectorAll(SIDEBAR_GAP_SELECTOR));
      syncResizeTargets(stageEls, rightEls, sidebarEls);
    }

    const { width: viewportWidth, height: viewportHeight } = readViewportSize();
    const stageRects: ShellCutoutRect[] = [];
    for (const el of stageEls) {
      if (!isElementVisiblyRendered(el, resolveStyle)) continue;
      const box = el.getBoundingClientRect();
      stageRects.push({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      });
    }

    const rightSidebarRects: ShellCutoutRect[] = [];
    for (const el of rightEls) {
      if (!isElementVisiblyRendered(el, resolveStyle)) continue;
      const box = el.getBoundingClientRect();
      rightSidebarRects.push({
        x: box.left,
        y: box.top,
        width: box.width,
        height: box.height,
      });
    }

    const glassActive = html.getAttribute('data-pmx-glass') === '1';
    const rightSidebarMode = html.getAttribute('data-pmx-zone-right-sidebar-mode');
    const rightSidebarFullClear = html.getAttribute('data-pmx-right-sidebar-fullclear') === '1';

    const geometry = computeShellCutoutGeometry({
      viewportWidth,
      viewportHeight,
      stageRects,
      stageRadiusPx: readStageRadiusPx(),
      insetPx,
      glassActive,
      rightSidebarMode,
      rightSidebarFullClear,
      rightSidebarRects,
    });

    applyGeometryToDom(geometry);
    return geometry;
  };

  const scheduleSync = () => {
    if (disposed || pendingRafId !== null) return;
    pendingRafId = scheduleFrame(() => {
      pendingRafId = null;
      syncNow();
    });
  };

  const stopTransitionLoop = () => {
    if (transitionRafId !== null) {
      cancelFrame(transitionRafId);
      transitionRafId = null;
    }
  };

  const tickTransitionLoop = () => {
    transitionRafId = null;
    if (disposed) return;
    syncNow();
    if (activeTransitions > 0 && now() < transitionTrackDeadline) {
      transitionRafId = scheduleFrame(tickTransitionLoop);
    } else {
      activeTransitions = 0;
    }
  };

  const isTrackedTransitionEvent = (event: unknown): boolean => {
    if (!event || typeof event !== 'object') return false;
    const evt = event as { propertyName?: unknown; target?: unknown };
    const prop = typeof evt.propertyName === 'string' ? evt.propertyName.toLowerCase() : '';
    if (prop && !LAYOUT_TRANSITION_PROPS.has(prop)) {
      return false;
    }
    const target = evt.target as Partial<ShellCutoutElementLike> | null | undefined;
    if (!target || typeof target.closest !== 'function') return true;
    // Track sidebar, right panel, and stage frame layout transitions; skip unrelated inner micro-animations.
    return Boolean(
      target.closest(
        `[data-slot="sidebar-gap"], [data-slot="sidebar-container"], [data-slot="sidebar"], ${rightSelector}, ${stageSelector}, [data-pmx-stage-shell="1"]`,
      ),
    );
  };

  const handleTransitionStart = (event: unknown) => {
    if (disposed || !isTrackedTransitionEvent(event)) return;
    activeTransitions += 1;
    transitionTrackDeadline = now() + maxTransitionTrackMs;
    if (transitionRafId === null) {
      transitionRafId = scheduleFrame(tickTransitionLoop);
    }
  };

  const handleTransitionEnd = (event: unknown) => {
    if (disposed || !isTrackedTransitionEvent(event)) return;
    activeTransitions = Math.max(0, activeTransitions - 1);
    scheduleSync();
    if (activeTransitions === 0) {
      stopTransitionLoop();
    }
  };

  const handleWindowResize = () => {
    scheduleSync();
  };

  if (ResizeObserverCtor) {
    resizeObserver = new ResizeObserverCtor(() => {
      scheduleSync();
    });
    try {
      resizeObserver.observe(html as unknown as Element);
    } catch {
      // Ignore non-Element mock documentElement.
    }
  }

  if (MutationObserverCtor) {
    rootAttrObserver = new MutationObserverCtor(() => {
      scheduleSync();
    });
    try {
      rootAttrObserver.observe(html as unknown as Node, {
        attributes: true,
        attributeFilter: [
          'data-pmx-glass',
          'data-pmx-zone-right-sidebar-mode',
          'data-pmx-right-sidebar-fullclear',
          'data-pmx-theme',
          'data-pmx-wallpaper',
          'data-pmx-wallpaper-visible',
          'data-pmx-gpu',
          'data-prismux-gpu',
          'data-pmx-reduced-transparency',
          'style',
          'class',
        ],
      });
    } catch {
      // Ignore non-Node mock documentElement.
    }

    bodyTreeObserver = new MutationObserverCtor((mutations) => {
      if (disposed) return;
      let shouldRescan = false;
      for (const mutation of mutations) {
        const target = mutation.target as unknown;
        if (target === svgEl || target === defsEl || target === maskEl || target === backdropEl) {
          continue;
        }
        // Fast-path skip streaming text/markdown mutations inside inner stage content.
        const targetEl = target as Partial<ShellCutoutElementLike> | null;
        const insideInnerStage =
          typeof targetEl?.closest === 'function' &&
          Boolean(targetEl.closest('[data-pmx-inner-stage="1"]'));

        let touchesRelevant = false;
        if (!insideInnerStage) {
          // Only scan element-level additions/removals (skip text/comment nodes).
          for (const node of Array.from(mutation.addedNodes)) {
            if ((node as { nodeType?: number })?.nodeType === 1) {
              touchesRelevant = true;
              break;
            }
          }
          if (!touchesRelevant) {
            for (const node of Array.from(mutation.removedNodes)) {
              if ((node as { nodeType?: number })?.nodeType === 1) {
                touchesRelevant = true;
                break;
              }
            }
          }
        } else {
          for (const node of Array.from(mutation.addedNodes)) {
            if (nodeContainsSelector(node, combinedSelector)) {
              touchesRelevant = true;
              break;
            }
          }
          if (!touchesRelevant) {
            for (const node of Array.from(mutation.removedNodes)) {
              if (nodeContainsSelector(node, combinedSelector)) {
                touchesRelevant = true;
                break;
              }
            }
          }
        }

        if (touchesRelevant) {
          shouldRescan = true;
          break;
        }
      }

      if (shouldRescan) {
        targetsDirty = true;
        scheduleSync();
      }
    });
    try {
      bodyTreeObserver.observe(body as unknown as Node, {
        childList: true,
        subtree: true,
      });
    } catch {
      // Ignore non-Node mock body.
    }
  }

  win?.addEventListener?.('resize', handleWindowResize, { passive: true });
  targetDoc.addEventListener?.('transitionrun', handleTransitionStart, { passive: true });
  targetDoc.addEventListener?.('transitionend', handleTransitionEnd, { passive: true });
  targetDoc.addEventListener?.('transitioncancel', handleTransitionEnd, { passive: true });

  // Synchronously measure immediately + schedule one post-layout confirmation frame.
  syncNow();
  scheduleSync();

  return {
    syncNow,
    isActive: () => lastGeometry.active,
    getGeometry: () => lastGeometry,
    dispose() {
      if (disposed) return;
      disposed = true;

      if (pendingRafId !== null) {
        cancelFrame(pendingRafId);
        pendingRafId = null;
      }
      stopTransitionLoop();

      resizeObserver?.disconnect();
      resizeObserver = null;
      observedResizeTargets.clear();

      rootAttrObserver?.disconnect();
      rootAttrObserver = null;

      bodyTreeObserver?.disconnect();
      bodyTreeObserver = null;

      win?.removeEventListener?.('resize', handleWindowResize);
      targetDoc.removeEventListener?.('transitionrun', handleTransitionStart);
      targetDoc.removeEventListener?.('transitionend', handleTransitionEnd);
      targetDoc.removeEventListener?.('transitioncancel', handleTransitionEnd);

      backdropEl.remove?.();
      svgEl.remove?.();
      stageRectPool.length = 0;
      rightRectPool.length = 0;
      html.removeAttribute(PMX_SHELL_CUTOUT_ROOT_ATTR);
      lastGeometry = EMPTY_GEOMETRY;
    },
  };
}
