import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  DeclarativeUiValidationError,
  normalizeAtomPersistScope,
  validateDeclarativePanelSpec,
  validateDeclarativeUiTree,
  type DeclarativeActionDefinition,
  type DeclarativeAtomDefinition,
  type DeclarativeAtomValue,
  type DeclarativeTableCellValue,
  type DeclarativeTableNode,
  type DeclarativeUiNode,
  type DeclarativeUiPanelSpec,
  type JsonSafeRecord,
} from './declarativeUiTypes.js';

export interface DeclarativeActionEvent {
  readonly actionId: string;
  readonly payload?: JsonSafeRecord;
  readonly atoms: Readonly<Record<string, DeclarativeAtomValue>>;
}

export interface DeclarativeGlassRendererProps {
  /** Either a full `ui: "components"` panel spec or a standalone declarative UI node tree. */
  readonly spec: DeclarativeUiPanelSpec | DeclarativeUiNode | unknown;
  /** Controlled atom values overriding internal atom state. */
  readonly atoms?: Readonly<Record<string, DeclarativeAtomValue>>;
  /** Initial atom values for uncontrolled mode. */
  readonly initialAtoms?: Readonly<Record<string, DeclarativeAtomValue>>;
  /** Optional localStorage key used to persist atoms whose scope is not `"memory"`. */
  readonly persistKey?: string;
  /** Optional workspace identifier scoping `"workspace"` persisted atoms independently. */
  readonly workspaceScopeKey?: string;
  /** Called whenever a Switch or Input mutates a bound atom. */
  readonly onAtomChange?: (
    key: string,
    value: DeclarativeAtomValue,
    nextAtoms: Readonly<Record<string, DeclarativeAtomValue>>,
  ) => void;
  /** Called when a Button (or Switch/Input with actionId) triggers a controlled action. */
  readonly onAction?: (event: DeclarativeActionEvent) => void | Promise<void>;
  /** Optional tree depth cap override (bounded by hard validator ceiling). */
  readonly maxDepth?: number;
  /** Optional metered tree byte budget override. */
  readonly maxTreeBytes?: number;
  /** Accessible region label for screen readers. */
  readonly ariaLabel?: string;
  /** Compact layout mode (ideal for drawers and sidebars). */
  readonly compact?: boolean;
}

/**
 * Calibrated light & dark ink/surface pairs guaranteeing >= 4.5:1 WCAG AA contrast
 * across Light, Dark, and Liquid Glass surfaces.
 */
export const DECLARATIVE_GLASS_CONTRAST_TOKENS = {
  dark: {
    surface: '#141926',
    fg: '#f5f5f7',
    muted: '#b8b8bf',
    accent: '#7ab4ff',
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#ff8592',
    primaryBg: '#005fb8',
    primaryFg: '#ffffff',
    dangerBg: '#b91c1c',
    dangerFg: '#ffffff',
  },
  light: {
    surface: '#ffffff',
    fg: '#1b1b1f',
    muted: '#52525b',
    accent: '#0055a8',
    success: '#0d6e38',
    warning: '#8a4b08',
    danger: '#b42333',
    primaryBg: '#005fb8',
    primaryFg: '#ffffff',
    dangerBg: '#b42333',
    dangerFg: '#ffffff',
  },
} as const;

export const DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS = 500;

export interface DeclarativeGestureRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DeclarativeGestureElementLike {
  readonly isConnected?: boolean;
  readonly scrollLeft?: number;
  readonly scrollTop?: number;
  getBoundingClientRect(): DeclarativeGestureRectLike;
}

export interface DeclarativeGestureTracker {
  setContainer(element: DeclarativeGestureElementLike | null): void;
  track(id: string, element: DeclarativeGestureElementLike | null): void;
  sample(now?: number): void;
  isSettled(id: string, now?: number, settleMs?: number): boolean;
}

/**
 * Stationary-control clickjacking guard (aligned with stablyai/orca
 * `plugin-declarative-gesture-geometry.ts`): tracks element rect stability in
 * container-relative coordinates so scrolling does not reset the settle window
 * while layout shifting resets the 500ms stationary requirement.
 */
export function createDeclarativeGestureTracker(
  clock: () => number = () => Date.now(),
): DeclarativeGestureTracker {
  type Placement = { id: string; rect: string; since: number };
  const placements = new Map<DeclarativeGestureElementLike, Placement>();
  const attached = new Map<string, Set<DeclarativeGestureElementLike>>();
  let container: DeclarativeGestureElementLike | null = null;

  const rectOf = (element: DeclarativeGestureElementLike): string => {
    const box = element.getBoundingClientRect();
    const origin = container?.getBoundingClientRect();
    const left = box.left - (origin?.left ?? 0) + (container?.scrollLeft ?? 0);
    const top = box.top - (origin?.top ?? 0) + (container?.scrollTop ?? 0);
    return `${left},${top},${box.width},${box.height}`;
  };

  return {
    setContainer(element) {
      container = element;
    },
    track(id, element) {
      let set = attached.get(id);
      if (!set) {
        set = new Set();
        attached.set(id, set);
      }
      if (element) {
        set.add(element);
        placements.set(element, { id, rect: rectOf(element), since: clock() });
        return;
      }
      for (const known of [...set]) {
        if (known.isConnected === false) {
          set.delete(known);
          placements.delete(known);
        }
      }
    },
    sample(now = clock()) {
      for (const [el, placement] of placements.entries()) {
        if (el.isConnected === false) {
          placements.delete(el);
          continue;
        }
        const rect = rectOf(el);
        if (rect !== placement.rect) {
          placements.set(el, { ...placement, rect, since: now });
        }
      }
    },
    isSettled(id, now = clock(), settleMs = DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS) {
      let found = false;
      for (const placement of placements.values()) {
        if (placement.id === id) {
          if (now - placement.since < settleMs) {
            return false;
          }
          found = true;
        }
      }
      return found;
    },
  };
}

/**
 * Keyboard row navigation helper for declarative tables (aligned with stablyai/orca
 * `plugin-declarative-table-selection.ts` `nextTableRow`).
 */
export function nextDeclarativeTableRow(
  key: string,
  current: number,
  count: number,
  pageSize = 8,
): number | null {
  if (count <= 0) return null;
  const page = Math.max(1, pageSize);
  const moves: Readonly<Record<string, number>> = {
    ArrowDown: current + 1,
    ArrowUp: current - 1,
    Home: 0,
    End: count - 1,
    PageDown: current + page,
    PageUp: current - page,
  };
  const next = moves[key];
  return next === undefined ? null : Math.min(count - 1, Math.max(0, next));
}

export type DeclarativeRenderPlan =
  | {
      readonly ok: true;
      readonly spec: DeclarativeUiPanelSpec;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly path: string;
      readonly message: string;
    };

export function resolveDeclarativeRenderPlan(
  raw: unknown,
  maxDepth?: number,
  maxTreeBytes?: number,
): DeclarativeRenderPlan {
  const options =
    maxDepth !== undefined || maxTreeBytes !== undefined
      ? {
          ...(maxDepth !== undefined ? { maxDepth } : {}),
          ...(maxTreeBytes !== undefined ? { maxTreeBytes } : {}),
        }
      : undefined;
  try {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const rec = raw as Record<string, unknown>;
      if ('ui' in rec || 'root' in rec) {
        return {
          ok: true,
          spec: validateDeclarativePanelSpec(raw, options),
        };
      }
    }
    const root = validateDeclarativeUiTree(raw, options);
    return {
      ok: true,
      spec: {
        ui: 'components',
        root,
      },
    };
  } catch (err) {
    if (err instanceof DeclarativeUiValidationError) {
      return {
        ok: false,
        code: err.code,
        path: err.path,
        message: err.message,
      };
    }
    return {
      ok: false,
      code: 'INVALID_SPEC',
      path: '$',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function matchesAtomDef(def: DeclarativeAtomDefinition, value: unknown): value is DeclarativeAtomValue {
  if (def.type === 'string') return typeof value === 'string';
  if (def.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'number' && Number.isFinite(value);
}

function storageKeyForScope(
  persistKey: string,
  scope: 'plugin' | 'workspace',
  workspaceScopeKey?: string,
): string {
  if (scope === 'workspace' && workspaceScopeKey) {
    return `${persistKey}:ws:${workspaceScopeKey}`;
  }
  return persistKey;
}

function readPersistedAtoms(
  persistKey: string | undefined,
  defs: readonly DeclarativeAtomDefinition[] | undefined,
  workspaceScopeKey?: string,
): Record<string, DeclarativeAtomValue> {
  if (!persistKey || typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  const out: Record<string, DeclarativeAtomValue> = {};
  const defMap = new Map((defs ?? []).map((d) => [d.key, d]));
  const scopesToRead: Array<'plugin' | 'workspace'> = workspaceScopeKey
    ? ['plugin', 'workspace']
    : ['plugin'];

  for (const scope of scopesToRead) {
    try {
      const raw = window.localStorage.getItem(
        storageKeyForScope(persistKey, scope, workspaceScopeKey),
      );
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const rec = parsed as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(rec)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const entry = rec[key];
        const def = defMap.get(key);
        if (def) {
          const defScope = normalizeAtomPersistScope(def.persist);
          if (defScope === 'memory') continue;
          if (defScope !== scope && !(defScope === 'workspace' && !workspaceScopeKey && scope === 'plugin')) {
            continue;
          }
          const targetVersion = def.version ?? 0;
          if (
            typeof entry === 'object' &&
            entry !== null &&
            !Array.isArray(entry) &&
            'v' in entry &&
            'value' in entry
          ) {
            const env = entry as { v: unknown; value: unknown };
            if (env.v === targetVersion && matchesAtomDef(def, env.value)) {
              out[key] = env.value;
            }
          } else if (targetVersion === 0 && matchesAtomDef(def, entry)) {
            out[key] = entry;
          }
        } else if (
          entry === null ||
          typeof entry === 'string' ||
          typeof entry === 'boolean' ||
          (typeof entry === 'number' && Number.isFinite(entry))
        ) {
          out[key] = entry;
        }
      }
    } catch {
      // Ignore corrupt persisted entries.
    }
  }
  return out;
}

function writePersistedAtoms(
  persistKey: string | undefined,
  defs: readonly DeclarativeAtomDefinition[] | undefined,
  atoms: Readonly<Record<string, DeclarativeAtomValue>>,
  workspaceScopeKey?: string,
): void {
  if (!persistKey || typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  const defMap = new Map((defs ?? []).map((d) => [d.key, d]));
  const pluginPayload: Record<string, unknown> = {};
  const workspacePayload: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(atoms)) {
    const def = defMap.get(key);
    const scope = def ? normalizeAtomPersistScope(def.persist) : 'plugin';
    if (scope === 'memory') continue;
    const encoded = def?.version !== undefined ? { v: def.version, value: val } : val;
    if (scope === 'workspace' && workspaceScopeKey) {
      workspacePayload[key] = encoded;
    } else {
      pluginPayload[key] = encoded;
    }
  }

  try {
    if (Object.keys(pluginPayload).length > 0) {
      window.localStorage.setItem(
        storageKeyForScope(persistKey, 'plugin'),
        JSON.stringify(pluginPayload),
      );
    }
    if (workspaceScopeKey && Object.keys(workspacePayload).length > 0) {
      window.localStorage.setItem(
        storageKeyForScope(persistKey, 'workspace', workspaceScopeKey),
        JSON.stringify(workspacePayload),
      );
    }
  } catch {
    // Ignore storage quota or private mode failures.
  }
}

function buildInitialAtomState(
  defs: readonly DeclarativeAtomDefinition[] | undefined,
  persistKey: string | undefined,
  initialAtoms: Readonly<Record<string, DeclarativeAtomValue>> | undefined,
  workspaceScopeKey?: string,
): Record<string, DeclarativeAtomValue> {
  const result: Record<string, DeclarativeAtomValue> = {};
  for (const def of defs ?? []) {
    result[def.key] = def.defaultValue;
  }
  const persisted = readPersistedAtoms(persistKey, defs, workspaceScopeKey);
  for (const [k, v] of Object.entries(persisted)) {
    result[k] = v;
  }
  if (initialAtoms) {
    for (const [k, v] of Object.entries(initialAtoms)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      result[k] = v;
    }
  }
  return result;
}

function formatTableCell(cell: DeclarativeTableCellValue | undefined): string {
  if (cell === undefined || cell === null) return '—';
  if (typeof cell === 'boolean') return cell ? '是' : '否';
  return String(cell);
}

function compareCellValues(
  a: DeclarativeTableCellValue | undefined,
  b: DeclarativeTableCellValue | undefined,
): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function DeclarativeTableView({
  node,
  tableKey,
  idPrefix,
}: {
  readonly node: DeclarativeTableNode;
  readonly tableKey: string;
  readonly idPrefix: string;
}) {
  const [activeRow, setActiveRow] = useState(0);
  const [sortState, setSortState] = useState<{
    column: string;
    direction: 'asc' | 'desc';
  } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sortState) return node.rows;
    const factor = sortState.direction === 'asc' ? 1 : -1;
    return [...node.rows].sort(
      (left, right) =>
        compareCellValues(left[sortState.column], right[sortState.column]) * factor,
    );
  }, [node.rows, sortState]);

  const activeIndex = sortedRows.length > 0 ? Math.min(activeRow, sortedRows.length - 1) : -1;
  const activeDescendant = activeIndex >= 0 ? `${idPrefix}-row-${activeIndex}` : undefined;

  const handleSortToggle = (colKey: string) => {
    setSortState((prev) =>
      prev && prev.column === colKey && prev.direction === 'asc'
        ? { column: colKey, direction: 'desc' }
        : { column: colKey, direction: 'asc' },
    );
  };

  return (
    <div
      className="pmx-decl-table-wrap"
      data-pmx-decl-node="Table"
      tabIndex={0}
      role="region"
      aria-label={node.caption ?? '数据表格'}
      aria-activedescendant={activeDescendant}
      onKeyDown={(event) => {
        const next = nextDeclarativeTableRow(event.key, Math.max(0, activeIndex), sortedRows.length);
        if (next !== null) {
          event.preventDefault();
          setActiveRow(next);
        }
      }}
    >
      <table className="pmx-decl-table" data-compact={node.compact ? '1' : '0'}>
        {node.caption ? <caption className="pmx-decl-table-caption">{node.caption}</caption> : null}
        <thead>
          <tr>
            {node.columns.map((col) => {
              const sortDir = sortState?.column === col.key ? sortState.direction : null;
              return (
                <th
                  key={col.key}
                  scope="col"
                  data-align={col.align ?? 'left'}
                  aria-sort={
                    sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : undefined
                  }
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="pmx-decl-sort-btn"
                      onClick={() => handleSortToggle(col.key)}
                    >
                      <span>{col.label}</span>
                      <span aria-hidden="true" className="pmx-decl-sort-glyph">
                        {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td className="pmx-decl-table-empty" colSpan={node.columns.length}>
                {node.emptyText ?? '暂无数据'}
              </td>
            </tr>
          ) : (
            sortedRows.map((row, rIdx) => (
              <tr
                key={`${tableKey}:r${rIdx}`}
                id={`${idPrefix}-row-${rIdx}`}
                data-active={rIdx === activeIndex ? '1' : '0'}
                onClick={() => setActiveRow(rIdx)}
              >
                {node.columns.map((col) => {
                  const formatted = formatTableCell(row[col.key]);
                  return (
                    <td
                      key={col.key}
                      data-align={col.align ?? 'left'}
                      data-mono={col.mono ? '1' : '0'}
                      title={formatted}
                    >
                      {formatted}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Safe, zero-HTML declarative liquid glass UI renderer for Cordis plugins (`ui: "components"`).
 * Strictly validates incoming trees against the 8-primitive JSON-safe allowlist (including
 * metered byte budget & sibling id uniqueness) and renders using Prismux native controls
 * synchronized across Light / Dark / 360° Liquid Glass modes.
 */
export function DeclarativeGlassRenderer({
  spec,
  atoms: controlledAtoms,
  initialAtoms,
  persistKey,
  workspaceScopeKey,
  onAtomChange,
  onAction,
  maxDepth,
  maxTreeBytes,
  ariaLabel,
  compact = false,
}: DeclarativeGlassRendererProps) {
  const baseId = useId();
  const validation = useMemo(
    () => resolveDeclarativeRenderPlan(spec, maxDepth, maxTreeBytes),
    [spec, maxDepth, maxTreeBytes],
  );

  const validatedSpec = validation.ok ? validation.spec : null;
  const atomDefs = validatedSpec?.atoms;
  const actionMap = useMemo(() => {
    const map = new Map<string, DeclarativeActionDefinition>();
    for (const action of validatedSpec?.actions ?? []) {
      map.set(action.id, action);
    }
    return map;
  }, [validatedSpec]);

  const [internalAtoms, setInternalAtoms] = useState<Record<string, DeclarativeAtomValue>>(() =>
    buildInitialAtomState(atomDefs, persistKey, initialAtoms, workspaceScopeKey),
  );
  const [pendingConfirmKey, setPendingConfirmKey] = useState<string | null>(null);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  useEffect(() => {
    setInternalAtoms(
      buildInitialAtomState(atomDefs, persistKey, initialAtoms, workspaceScopeKey),
    );
  }, [atomDefs, persistKey, initialAtoms, workspaceScopeKey]);

  const effectiveAtoms = useMemo<Readonly<Record<string, DeclarativeAtomValue>>>(() => {
    if (!controlledAtoms) return internalAtoms;
    return { ...internalAtoms, ...controlledAtoms };
  }, [controlledAtoms, internalAtoms]);

  const atomDefMap = useMemo(() => {
    const map = new Map<string, DeclarativeAtomDefinition>();
    for (const def of atomDefs ?? []) {
      map.set(def.key, def);
    }
    return map;
  }, [atomDefs]);

  const updateAtom = useCallback(
    (key: string, nextValue: DeclarativeAtomValue): Readonly<Record<string, DeclarativeAtomValue>> => {
      const nextMap: Record<string, DeclarativeAtomValue> = {
        ...effectiveAtoms,
        [key]: nextValue,
      };
      if (!controlledAtoms) {
        setInternalAtoms(nextMap);
      }
      writePersistedAtoms(persistKey, atomDefs, nextMap, workspaceScopeKey);
      onAtomChange?.(key, nextValue, nextMap);
      return nextMap;
    },
    [atomDefs, controlledAtoms, effectiveAtoms, onAtomChange, persistKey, workspaceScopeKey],
  );

  const invokeAction = useCallback(
    async (
      buttonKey: string,
      actionId: string,
      payload: JsonSafeRecord | undefined,
      atomsOverride?: Readonly<Record<string, DeclarativeAtomValue>>,
    ) => {
      if (!onAction) return;
      setBusyActionKey(buttonKey);
      try {
        await onAction({
          actionId,
          ...(payload !== undefined ? { payload } : {}),
          atoms: atomsOverride ?? effectiveAtoms,
        });
      } finally {
        setBusyActionKey((current) => (current === buttonKey ? null : current));
      }
    },
    [effectiveAtoms, onAction],
  );

  if (!validation.ok || !validatedSpec) {
    return (
      <div
        role="alert"
        data-pmx-decl-error={validation.ok ? 'INVALID_SPEC' : validation.code}
        className="pmx-appearance pmx-decl-root pmx-decl-error"
      >
        <div className="pmx-decl-error-title">声明式 UI 校验已拦截（安全沙箱保护）</div>
        <div className="pmx-decl-error-detail">
          {validation.ok ? '未知校验错误' : validation.message}
        </div>
      </div>
    );
  }

  const renderNode = (node: DeclarativeUiNode, pathKey: string): ReactNode => {
    const stableKey = node.id ? `${node.type}:${node.id}` : pathKey;

    switch (node.type) {
      case 'Stack': {
        return (
          <div
            key={stableKey}
            className="pmx-decl-stack"
            data-pmx-decl-node="Stack"
            data-dir={node.direction ?? 'column'}
            data-gap={node.gap ?? 'sm'}
            data-align={node.align ?? 'stretch'}
            data-justify={node.justify ?? 'start'}
            data-wrap={node.wrap ? '1' : '0'}
          >
            {(node.children ?? []).map((child, idx) => renderNode(child, `${pathKey}.${idx}`))}
          </div>
        );
      }

      case 'Card': {
        return (
          <section
            key={stableKey}
            className="pmx-decl-card pmx-glass-surface"
            data-pmx-decl-node="Card"
            data-tone={node.tone ?? 'default'}
            data-padded={node.padded === false ? '0' : '1'}
          >
            {node.title || node.subtitle ? (
              <header className="pmx-decl-card-head">
                {node.title ? <h4 className="pmx-decl-card-title">{node.title}</h4> : null}
                {node.subtitle ? <p className="pmx-decl-card-subtitle">{node.subtitle}</p> : null}
              </header>
            ) : null}
            <div className="pmx-decl-card-body">
              {(node.children ?? []).map((child, idx) => renderNode(child, `${pathKey}.${idx}`))}
            </div>
          </section>
        );
      }

      case 'Text': {
        const variant = node.variant ?? 'body';
        const tone = node.tone ?? (variant === 'muted' || variant === 'caption' ? 'muted' : 'default');
        const commonProps = {
          className: 'pmx-decl-text',
          'data-pmx-decl-node': 'Text',
          'data-variant': variant,
          'data-tone': tone,
          'data-tabular': node.tabularNums ? '1' : '0',
        };
        if (variant === 'title') {
          return (
            <h3 key={stableKey} {...commonProps}>
              {node.content}
            </h3>
          );
        }
        if (variant === 'heading') {
          return (
            <h4 key={stableKey} {...commonProps}>
              {node.content}
            </h4>
          );
        }
        if (variant === 'code') {
          return (
            <code key={stableKey} {...commonProps}>
              {node.content}
            </code>
          );
        }
        return (
          <p key={stableKey} {...commonProps}>
            {node.content}
          </p>
        );
      }

      case 'Badge': {
        return (
          <span
            key={stableKey}
            className="pmx-decl-badge"
            data-pmx-decl-node="Badge"
            data-variant={node.variant ?? 'default'}
          >
            {node.label}
          </span>
        );
      }

      case 'Button': {
        const actionDef = actionMap.get(node.actionId);
        const isBusy = Boolean(node.loading) || busyActionKey === stableKey;
        const isDisabled = Boolean(node.disabled) || isBusy;
        const reasonId =
          node.disabled && node.disabledReason ? `${baseId}-btn-reason-${pathKey}` : undefined;
        const awaitingConfirm = pendingConfirmKey === stableKey;

        const handleClick = () => {
          if (isDisabled) return;
          if (actionDef?.confirm && !awaitingConfirm) {
            setPendingConfirmKey(stableKey);
            return;
          }
          setPendingConfirmKey(null);
          void invokeAction(stableKey, node.actionId, node.payload);
        };

        const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === 'Escape' && awaitingConfirm) {
            event.stopPropagation();
            setPendingConfirmKey(null);
          }
        };

        return (
          <div key={stableKey} className="pmx-decl-control-wrap" data-pmx-decl-node="Button">
            <div className="pmx-decl-btn-group">
              <button
                type="button"
                className="pmx-decl-btn"
                data-variant={node.variant ?? 'secondary'}
                data-size={node.size ?? 'md'}
                disabled={isDisabled}
                aria-busy={isBusy || undefined}
                aria-describedby={reasonId}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
              >
                {isBusy ? '处理中…' : awaitingConfirm ? '再次点击确认' : node.label}
              </button>
              {awaitingConfirm ? (
                <button
                  type="button"
                  className="pmx-decl-btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={() => setPendingConfirmKey(null)}
                >
                  取消
                </button>
              ) : null}
            </div>
            {awaitingConfirm && actionDef?.confirmMessage ? (
              <span className="pmx-decl-hint" role="status">
                {actionDef.confirmMessage}
              </span>
            ) : null}
            {reasonId && node.disabledReason ? (
              <span id={reasonId} className="pmx-decl-disabled-reason">
                {node.disabledReason}
              </span>
            ) : null}
          </div>
        );
      }

      case 'Switch': {
        const atomVal = node.atomKey ? effectiveAtoms[node.atomKey] : undefined;
        const isChecked = typeof atomVal === 'boolean' ? atomVal : Boolean(node.checked);
        const switchId = `${baseId}-sw-${pathKey}`;
        const reasonId =
          node.disabled && node.disabledReason ? `${switchId}-reason` : undefined;
        const isReadOnly = !node.atomKey && !node.actionId && node.checked !== undefined;

        const handleToggle = () => {
          if (node.disabled || isReadOnly) return;
          const nextChecked = !isChecked;
          let nextAtoms = effectiveAtoms;
          if (node.atomKey) {
            nextAtoms = updateAtom(node.atomKey, nextChecked);
          }
          if (node.actionId) {
            void invokeAction(
              stableKey,
              node.actionId,
              { checked: nextChecked, ...(node.atomKey ? { atomKey: node.atomKey } : {}) },
              nextAtoms,
            );
          }
        };

        return (
          <div key={stableKey} className="pmx-decl-switch-row" data-pmx-decl-node="Switch">
            <div className="pmx-decl-switch-meta">
              <label htmlFor={switchId} className="pmx-decl-label">
                {node.label}
              </label>
              {node.description ? (
                <span className="pmx-decl-desc">{node.description}</span>
              ) : null}
              {reasonId && node.disabledReason ? (
                <span id={reasonId} className="pmx-decl-disabled-reason">
                  {node.disabledReason}
                </span>
              ) : null}
            </div>
            <button
              id={switchId}
              type="button"
              role="switch"
              aria-checked={isChecked}
              aria-describedby={reasonId}
              disabled={node.disabled || isReadOnly}
              className="pmx-decl-switch"
              data-checked={isChecked ? '1' : '0'}
              onClick={handleToggle}
            >
              <span className="pmx-decl-switch-thumb" aria-hidden="true" />
            </button>
          </div>
        );
      }

      case 'Input': {
        const inputId = `${baseId}-in-${pathKey}`;
        const reasonId =
          node.disabled && node.disabledReason ? `${inputId}-reason` : undefined;
        const atomVal = node.atomKey ? effectiveAtoms[node.atomKey] : undefined;
        const displayValue =
          atomVal !== undefined && atomVal !== null
            ? String(atomVal)
            : (node.value ?? '');
        const atomDef = node.atomKey ? atomDefMap.get(node.atomKey) : undefined;
        const inputType = node.inputType ?? (atomDef?.type === 'number' ? 'number' : 'text');
        const isReadOnly =
          Boolean(node.readOnly) || (!node.atomKey && node.value !== undefined);

        const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
          if (isReadOnly || !node.atomKey) return;
          const rawStr = event.target.value;
          if (atomDef?.type === 'number') {
            const parsed = Number(rawStr);
            if (rawStr.trim().length > 0 && Number.isFinite(parsed)) {
              updateAtom(node.atomKey, parsed);
            }
          } else {
            updateAtom(node.atomKey, rawStr);
          }
        };

        const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
          if (
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing &&
            node.actionId &&
            !node.disabled
          ) {
            event.preventDefault();
            void invokeAction(stableKey, node.actionId, {
              value: displayValue,
              ...(node.atomKey ? { atomKey: node.atomKey } : {}),
            });
          }
        };

        return (
          <div key={stableKey} className="pmx-decl-input-field" data-pmx-decl-node="Input">
            {node.label && !node.labelHidden ? (
              <label htmlFor={inputId} className="pmx-decl-label">
                {node.label}
              </label>
            ) : null}
            <input
              id={inputId}
              type={inputType}
              className="pmx-decl-input"
              value={displayValue}
              readOnly={isReadOnly}
              placeholder={node.placeholder}
              maxLength={node.maxLength}
              disabled={node.disabled}
              aria-label={node.labelHidden && node.label ? node.label : undefined}
              aria-describedby={reasonId}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
            />
            {node.description ? <span className="pmx-decl-desc">{node.description}</span> : null}
            {reasonId && node.disabledReason ? (
              <span id={reasonId} className="pmx-decl-disabled-reason">
                {node.disabledReason}
              </span>
            ) : null}
          </div>
        );
      }

      case 'Table': {
        return (
          <DeclarativeTableView
            key={stableKey}
            node={node}
            tableKey={stableKey}
            idPrefix={`${baseId}-tbl-${pathKey}`}
          />
        );
      }
    }
  };

  return (
    <div
      className="pmx-appearance pmx-decl-root"
      data-pmx-declarative-ui="components"
      data-compact={compact ? '1' : '0'}
      role="region"
      aria-label={ariaLabel ?? validatedSpec.title ?? '插件声明式界面'}
    >
      {validatedSpec.title || validatedSpec.description ? (
        <div className="pmx-decl-panel-header">
          {validatedSpec.title ? <div className="pmx-decl-panel-title">{validatedSpec.title}</div> : null}
          {validatedSpec.description ? (
            <div className="pmx-decl-panel-desc">{validatedSpec.description}</div>
          ) : null}
        </div>
      ) : null}
      {renderNode(validatedSpec.root, 'root')}
    </div>
  );
}
