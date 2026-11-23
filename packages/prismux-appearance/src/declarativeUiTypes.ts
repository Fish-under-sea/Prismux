export const DECLARATIVE_UI_MODE = 'components' as const;
export const DECLARATIVE_UI_SCHEMA_VERSION = 1 as const;

export const DECLARATIVE_UI_NODE_TYPES = [
  'Stack',
  'Card',
  'Text',
  'Badge',
  'Button',
  'Switch',
  'Input',
  'Table',
] as const;

export type DeclarativeUiNodeType = (typeof DECLARATIVE_UI_NODE_TYPES)[number];

export const DEFAULT_DECLARATIVE_UI_MAX_DEPTH = 12;
export const HARD_DECLARATIVE_UI_MAX_DEPTH = 24;
export const DEFAULT_DECLARATIVE_UI_MAX_NODES = 250;
export const HARD_DECLARATIVE_UI_MAX_NODES = 1000;
export const DEFAULT_DECLARATIVE_UI_MAX_PROPS_DEPTH = 6;
export const DEFAULT_DECLARATIVE_UI_MAX_PROPS_PER_NODE = 32;
export const DEFAULT_DECLARATIVE_UI_MAX_TEXT_LENGTH = 10_000;
export const DEFAULT_DECLARATIVE_UI_MAX_LABEL_LENGTH = 1024;
export const DEFAULT_DECLARATIVE_UI_MAX_TREE_BYTES = 512 * 1024;
export const HARD_DECLARATIVE_UI_MAX_TREE_BYTES = 1024 * 1024;
const NODE_OVERHEAD_BYTES = 32;
const TEXT_OVERHEAD_BYTES = 8;

export type JsonSafePrimitive = string | number | boolean | null;
export type JsonSafeValue =
  | JsonSafePrimitive
  | JsonSafeRecord
  | readonly JsonSafeValue[];

export interface JsonSafeRecord {
  readonly [key: string]: JsonSafeValue;
}

export type DeclarativeAtomValue = string | number | boolean | null;
export type DeclarativeAtomType = 'string' | 'number' | 'boolean';
export type DeclarativeAtomPersistScope = 'memory' | 'plugin' | 'workspace';

export interface DeclarativeAtomDefinition {
  readonly key: string;
  readonly type: DeclarativeAtomType;
  readonly defaultValue: string | number | boolean;
  readonly persist?: boolean | DeclarativeAtomPersistScope;
  readonly version?: number;
  readonly label?: string;
}

export function normalizeAtomPersistScope(
  persist: DeclarativeAtomDefinition['persist'],
): DeclarativeAtomPersistScope {
  if (persist === false || persist === 'memory') return 'memory';
  if (persist === 'workspace') return 'workspace';
  return 'plugin';
}

export interface DeclarativeActionDefinition {
  readonly id: string;
  readonly label?: string;
  readonly confirm?: boolean;
  readonly confirmMessage?: string;
  readonly mutatesAtoms?: readonly string[];
}

export interface DeclarativeStackNode {
  readonly type: 'Stack';
  readonly id?: string;
  readonly direction?: 'row' | 'column';
  readonly gap?: 'none' | 'xs' | 'sm' | 'md' | 'lg';
  readonly align?: 'start' | 'center' | 'end' | 'stretch';
  readonly justify?: 'start' | 'center' | 'end' | 'between';
  readonly wrap?: boolean;
  readonly children?: readonly DeclarativeUiNode[];
}

export interface DeclarativeCardNode {
  readonly type: 'Card';
  readonly id?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly tone?: 'default' | 'subtle' | 'accent' | 'warning' | 'danger';
  readonly padded?: boolean;
  readonly children?: readonly DeclarativeUiNode[];
}

export interface DeclarativeTextNode {
  readonly type: 'Text';
  readonly id?: string;
  readonly content: string;
  readonly variant?: 'title' | 'heading' | 'body' | 'muted' | 'caption' | 'code';
  readonly tone?: 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger';
  readonly tabularNums?: boolean;
}

export interface DeclarativeBadgeNode {
  readonly type: 'Badge';
  readonly id?: string;
  readonly label: string;
  readonly variant?: 'default' | 'info' | 'success' | 'warning' | 'danger' | 'outline';
}

export interface DeclarativeButtonNode {
  readonly type: 'Button';
  readonly id?: string;
  readonly label: string;
  readonly actionId: string;
  readonly payload?: JsonSafeRecord;
  readonly variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  readonly size?: 'sm' | 'md';
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly loading?: boolean;
}

export interface DeclarativeSwitchNode {
  readonly type: 'Switch';
  readonly id?: string;
  readonly label: string;
  readonly description?: string;
  readonly atomKey?: string;
  readonly checked?: boolean;
  readonly actionId?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface DeclarativeInputNode {
  readonly type: 'Input';
  readonly id?: string;
  readonly label?: string;
  readonly labelHidden?: boolean;
  readonly description?: string;
  readonly atomKey?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly inputType?: 'text' | 'number' | 'password' | 'search' | 'url';
  readonly actionId?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly readOnly?: boolean;
  readonly maxLength?: number;
}

export interface DeclarativeTableColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: 'left' | 'center' | 'right';
  readonly mono?: boolean;
  readonly sortable?: boolean;
}

export type DeclarativeTableCellValue = string | number | boolean | null;
export type DeclarativeTableRow = Readonly<Record<string, DeclarativeTableCellValue>>;

export interface DeclarativeTableNode {
  readonly type: 'Table';
  readonly id?: string;
  readonly caption?: string;
  readonly columns: readonly DeclarativeTableColumn[];
  readonly rows: readonly DeclarativeTableRow[];
  readonly emptyText?: string;
  readonly compact?: boolean;
}

export type DeclarativeUiNode =
  | DeclarativeStackNode
  | DeclarativeCardNode
  | DeclarativeTextNode
  | DeclarativeBadgeNode
  | DeclarativeButtonNode
  | DeclarativeSwitchNode
  | DeclarativeInputNode
  | DeclarativeTableNode;

export interface DeclarativeUiPanelSpec {
  readonly ui: typeof DECLARATIVE_UI_MODE;
  readonly schemaVersion?: typeof DECLARATIVE_UI_SCHEMA_VERSION;
  readonly title?: string;
  readonly description?: string;
  readonly atoms?: readonly DeclarativeAtomDefinition[];
  readonly actions?: readonly DeclarativeActionDefinition[];
  readonly root: DeclarativeUiNode;
}

export type DeclarativeUiValidationErrorCode =
  | 'INVALID_SPEC'
  | 'UNSUPPORTED_UI_MODE'
  | 'UNKNOWN_NODE_TYPE'
  | 'INVALID_NODE_PROPS'
  | 'NON_JSON_SAFE_VALUE'
  | 'PROTOTYPE_POLLUTION_KEY'
  | 'FORBIDDEN_INJECTION_KEY'
  | 'MAX_DEPTH_EXCEEDED'
  | 'MAX_NODES_EXCEEDED'
  | 'MAX_TREE_BYTES_EXCEEDED'
  | 'DUPLICATE_SIBLING_ID'
  | 'CIRCULAR_REFERENCE'
  | 'INVALID_ATOM_DEFINITION'
  | 'INVALID_ACTION_DEFINITION';

export class DeclarativeUiValidationError extends Error {
  readonly code: DeclarativeUiValidationErrorCode;
  readonly path: string;

  constructor(code: DeclarativeUiValidationErrorCode, message: string, path = '$') {
    super(`[${code}] at ${path}: ${message}`);
    this.name = 'DeclarativeUiValidationError';
    this.code = code;
    this.path = path;
  }
}

export interface ValidateDeclarativeUiOptions {
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxPropsDepth?: number;
  readonly maxTreeBytes?: number;
}

const NODE_TYPE_SET = new Set<string>(DECLARATIVE_UI_NODE_TYPES);
const PROTOTYPE_POLLUTION_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN_INJECTION_KEYS_LOWER = new Set<string>([
  'dangerouslysetinnerhtml',
  'innerhtml',
  'outerhtml',
  'html',
  'rawhtml',
  'svg',
  'rawsvg',
  'script',
  'rawscript',
  'style',
  'rawcss',
  'css',
  'csstext',
  'classname',
  'class',
  'srcdoc',
  'iframe',
  'eval',
]);

const DOM_EVENT_HANDLER_KEY = /^on[A-Z]/;
const SAFE_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const SAFE_ACTION_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9._:-]{0,63}$/;

const STACK_DIRECTIONS = new Set(['row', 'column']);
const STACK_GAPS = new Set(['none', 'xs', 'sm', 'md', 'lg']);
const STACK_ALIGNS = new Set(['start', 'center', 'end', 'stretch']);
const STACK_JUSTIFIES = new Set(['start', 'center', 'end', 'between']);
const CARD_TONES = new Set(['default', 'subtle', 'accent', 'warning', 'danger']);
const TEXT_VARIANTS = new Set(['title', 'heading', 'body', 'muted', 'caption', 'code']);
const TEXT_TONES = new Set(['default', 'muted', 'accent', 'success', 'warning', 'danger']);
const BADGE_VARIANTS = new Set(['default', 'info', 'success', 'warning', 'danger', 'outline']);
const BUTTON_VARIANTS = new Set(['primary', 'secondary', 'outline', 'ghost', 'danger']);
const BUTTON_SIZES = new Set(['sm', 'md']);
const INPUT_TYPES = new Set(['text', 'number', 'password', 'search', 'url']);
const TABLE_ALIGNS = new Set(['left', 'center', 'right']);

const ALLOWED_KEYS_BY_NODE_TYPE: Readonly<Record<DeclarativeUiNodeType, ReadonlySet<string>>> = {
  Stack: new Set(['type', 'id', 'direction', 'gap', 'align', 'justify', 'wrap', 'children']),
  Card: new Set(['type', 'id', 'title', 'subtitle', 'tone', 'padded', 'children']),
  Text: new Set(['type', 'id', 'content', 'variant', 'tone', 'tabularNums']),
  Badge: new Set(['type', 'id', 'label', 'variant']),
  Button: new Set([
    'type',
    'id',
    'label',
    'actionId',
    'payload',
    'variant',
    'size',
    'disabled',
    'disabledReason',
    'loading',
  ]),
  Switch: new Set([
    'type',
    'id',
    'label',
    'description',
    'atomKey',
    'checked',
    'actionId',
    'disabled',
    'disabledReason',
  ]),
  Input: new Set([
    'type',
    'id',
    'label',
    'labelHidden',
    'description',
    'atomKey',
    'value',
    'placeholder',
    'inputType',
    'actionId',
    'disabled',
    'disabledReason',
    'readOnly',
    'maxLength',
  ]),
  Table: new Set(['type', 'id', 'caption', 'columns', 'rows', 'emptyText', 'compact']),
};

const ALLOWED_SPEC_KEYS = new Set([
  'ui',
  'schemaVersion',
  'title',
  'description',
  'atoms',
  'actions',
  'root',
]);
const ALLOWED_ATOM_KEYS = new Set(['key', 'type', 'defaultValue', 'persist', 'version', 'label']);
const ALLOWED_ACTION_KEYS = new Set(['id', 'label', 'confirm', 'confirmMessage', 'mutatesAtoms']);
const ALLOWED_TABLE_COLUMN_KEYS = new Set(['key', 'label', 'align', 'mono', 'sortable']);

function assertPlainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DeclarativeUiValidationError('NON_JSON_SAFE_VALUE', 'Expected a plain JSON object.', path);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new DeclarativeUiValidationError(
      'NON_JSON_SAFE_VALUE',
      'Class instances and non-plain objects are forbidden.',
      path,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new DeclarativeUiValidationError(
      'NON_JSON_SAFE_VALUE',
      'Symbol keys are forbidden in declarative UI objects.',
      path,
    );
  }
  return value as Record<string, unknown>;
}

function assertSafeKey(key: string, path: string): void {
  if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
    throw new DeclarativeUiValidationError(
      'PROTOTYPE_POLLUTION_KEY',
      `Prototype pollution key "${key}" is strictly forbidden.`,
      `${path}.${key}`,
    );
  }
  const lower = key.toLowerCase();
  if (FORBIDDEN_INJECTION_KEYS_LOWER.has(lower) || DOM_EVENT_HANDLER_KEY.test(key)) {
    throw new DeclarativeUiValidationError(
      'FORBIDDEN_INJECTION_KEY',
      `Raw HTML/SVG/CSS/script/event injection key "${key}" is strictly forbidden.`,
      `${path}.${key}`,
    );
  }
}

function assertKeysAllowed(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.getOwnPropertyNames(record)) {
    assertSafeKey(key, path);
    if (!allowed.has(key)) {
      throw new DeclarativeUiValidationError(
        'INVALID_NODE_PROPS',
        `Unknown or unsupported property "${key}".`,
        `${path}.${key}`,
      );
    }
  }
}

function assertBoundedString(
  value: unknown,
  path: string,
  options?: { required?: boolean; maxLength?: number },
): string {
  if (typeof value !== 'string') {
    throw new DeclarativeUiValidationError('INVALID_NODE_PROPS', 'Expected a string value.', path);
  }
  const maxLength = options?.maxLength ?? DEFAULT_DECLARATIVE_UI_MAX_TEXT_LENGTH;
  if (value.length > maxLength) {
    throw new DeclarativeUiValidationError(
      'INVALID_NODE_PROPS',
      `String exceeds maximum length (${maxLength}).`,
      path,
    );
  }
  if (options?.required && value.trim().length === 0) {
    throw new DeclarativeUiValidationError('INVALID_NODE_PROPS', 'String must be non-empty.', path);
  }
  return value;
}

function assertOptionalString(
  value: unknown,
  path: string,
  maxLength = DEFAULT_DECLARATIVE_UI_MAX_TEXT_LENGTH,
): string | undefined {
  if (value === undefined) return undefined;
  return assertBoundedString(value, path, { maxLength });
}

function assertOptionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new DeclarativeUiValidationError('INVALID_NODE_PROPS', 'Expected a boolean value.', path);
  }
  return value;
}

function assertOptionalEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new DeclarativeUiValidationError(
      'INVALID_NODE_PROPS',
      `Expected one of [${Array.from(allowed).join(', ')}], got "${String(value)}".`,
      path,
    );
  }
  return value as T;
}

function assertIdentifier(
  value: unknown,
  pattern: RegExp,
  path: string,
  code: DeclarativeUiValidationErrorCode = 'INVALID_NODE_PROPS',
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new DeclarativeUiValidationError(code, `Invalid identifier "${String(value)}".`, path);
  }
  if (PROTOTYPE_POLLUTION_KEYS.has(value)) {
    throw new DeclarativeUiValidationError(
      'PROTOTYPE_POLLUTION_KEY',
      `Prototype pollution identifier "${value}" is strictly forbidden.`,
      path,
    );
  }
  return value;
}

function cloneJsonSafeValue(
  value: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  seen: WeakSet<object>,
): JsonSafeValue {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'string') {
    if ((value as string).length > DEFAULT_DECLARATIVE_UI_MAX_TEXT_LENGTH) {
      throw new DeclarativeUiValidationError(
        'NON_JSON_SAFE_VALUE',
        `String exceeds maximum length (${DEFAULT_DECLARATIVE_UI_MAX_TEXT_LENGTH}).`,
        path,
      );
    }
    return value as string;
  }
  if (kind === 'boolean') return value as boolean;
  if (kind === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new DeclarativeUiValidationError(
        'NON_JSON_SAFE_VALUE',
        'NaN and Infinity are not JSON-safe numbers.',
        path,
      );
    }
    return value as number;
  }
  if (kind === 'function' || kind === 'symbol' || kind === 'bigint' || kind === 'undefined') {
    throw new DeclarativeUiValidationError(
      'NON_JSON_SAFE_VALUE',
      `Values of type "${kind}" are not JSON-safe.`,
      path,
    );
  }
  if (depth >= maxDepth) {
    throw new DeclarativeUiValidationError(
      'MAX_DEPTH_EXCEEDED',
      `JSON-safe payload exceeds maximum nesting depth (${maxDepth}).`,
      path,
    );
  }

  const objRef = value as object;
  if (seen.has(objRef)) {
    throw new DeclarativeUiValidationError(
      'CIRCULAR_REFERENCE',
      'Circular references are forbidden in declarative UI payloads.',
      path,
    );
  }

  seen.add(objRef);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new DeclarativeUiValidationError(
          'NON_JSON_SAFE_VALUE',
          'Symbol properties on arrays are forbidden.',
          path,
        );
      }
      return value.map((item, idx) =>
        cloneJsonSafeValue(item, `${path}[${idx}]`, depth + 1, maxDepth, seen),
      );
    }
    const rec = assertPlainObject(value, path);
    const out: Record<string, JsonSafeValue> = {};
    for (const key of Object.getOwnPropertyNames(rec)) {
      assertSafeKey(key, path);
      out[key] = cloneJsonSafeValue(rec[key], `${path}.${key}`, depth + 1, maxDepth, seen);
    }
    return out;
  } finally {
    seen.delete(objRef);
  }
}

export function assertJsonSafeProps(
  props: unknown,
  path = '$.props',
  maxDepth = DEFAULT_DECLARATIVE_UI_MAX_PROPS_DEPTH,
): JsonSafeRecord {
  const effectiveMaxDepth = Math.max(1, Math.min(maxDepth, HARD_DECLARATIVE_UI_MAX_DEPTH));
  const record = assertPlainObject(props, path);
  const seen = new WeakSet<object>();
  seen.add(record);
  const out: Record<string, JsonSafeValue> = {};
  for (const key of Object.getOwnPropertyNames(record)) {
    assertSafeKey(key, path);
    out[key] = cloneJsonSafeValue(record[key], `${path}.${key}`, 1, effectiveMaxDepth, seen);
  }
  return out;
}

interface TreeState {
  nodeCount: number;
  treeBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxPropsDepth: number;
  maxTreeBytes: number;
  seen: WeakSet<object>;
  declaredAtoms?: ReadonlyMap<string, DeclarativeAtomDefinition>;
  declaredActions?: ReadonlyMap<string, DeclarativeActionDefinition>;
}

function estimateNodeBytes(record: Record<string, unknown>): number {
  let bytes = NODE_OVERHEAD_BYTES;
  for (const key of Object.getOwnPropertyNames(record)) {
    if (key === 'children') continue;
    bytes += TEXT_OVERHEAD_BYTES + key.length;
    const val = record[key];
    if (typeof val === 'string') {
      bytes += TEXT_OVERHEAD_BYTES + val.length;
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      bytes += 8;
    } else if (val !== null && val !== undefined && typeof val === 'object') {
      try {
        bytes += JSON.stringify(val).length;
      } catch {
        bytes += 64;
      }
    }
  }
  return bytes;
}

function validateNode(raw: unknown, path: string, depth: number, state: TreeState): DeclarativeUiNode {
  if (depth > state.maxDepth) {
    throw new DeclarativeUiValidationError(
      'MAX_DEPTH_EXCEEDED',
      `Declarative UI tree exceeds maximum nesting depth (${state.maxDepth}).`,
      path,
    );
  }
  state.nodeCount += 1;
  if (state.nodeCount > state.maxNodes) {
    throw new DeclarativeUiValidationError(
      'MAX_NODES_EXCEEDED',
      `Declarative UI tree exceeds maximum node count (${state.maxNodes}).`,
      path,
    );
  }

  const record = assertPlainObject(raw, path);
  if (state.seen.has(record)) {
    throw new DeclarativeUiValidationError(
      'CIRCULAR_REFERENCE',
      'Circular reference detected in declarative UI tree.',
      path,
    );
  }
  const ownKeys = Object.getOwnPropertyNames(record);
  if (ownKeys.length > DEFAULT_DECLARATIVE_UI_MAX_PROPS_PER_NODE) {
    throw new DeclarativeUiValidationError(
      'INVALID_NODE_PROPS',
      `Node exceeds maximum property count (${DEFAULT_DECLARATIVE_UI_MAX_PROPS_PER_NODE}).`,
      path,
    );
  }
  for (const key of ownKeys) {
    assertSafeKey(key, path);
  }
  state.treeBytes += estimateNodeBytes(record);
  if (state.treeBytes > state.maxTreeBytes) {
    throw new DeclarativeUiValidationError(
      'MAX_TREE_BYTES_EXCEEDED',
      `Declarative UI tree exceeds metered byte budget (${state.maxTreeBytes} bytes).`,
      path,
    );
  }

  const rawType = record.type;
  if (typeof rawType !== 'string' || !NODE_TYPE_SET.has(rawType)) {
    throw new DeclarativeUiValidationError(
      'UNKNOWN_NODE_TYPE',
      `Unsupported declarative UI node type "${String(rawType)}". Allowed primitives: ${DECLARATIVE_UI_NODE_TYPES.join(', ')}.`,
      `${path}.type`,
    );
  }

  const nodeType = rawType as DeclarativeUiNodeType;
  assertKeysAllowed(record, ALLOWED_KEYS_BY_NODE_TYPE[nodeType], path);

  const id =
    record.id !== undefined ? assertIdentifier(record.id, SAFE_KEY_PATTERN, `${path}.id`) : undefined;

  state.seen.add(record);
  try {
    switch (nodeType) {
      case 'Stack': {
        const direction = assertOptionalEnum<'row' | 'column'>(
          record.direction,
          STACK_DIRECTIONS,
          `${path}.direction`,
        );
        const gap = assertOptionalEnum<'none' | 'xs' | 'sm' | 'md' | 'lg'>(
          record.gap,
          STACK_GAPS,
          `${path}.gap`,
        );
        const align = assertOptionalEnum<'start' | 'center' | 'end' | 'stretch'>(
          record.align,
          STACK_ALIGNS,
          `${path}.align`,
        );
        const justify = assertOptionalEnum<'start' | 'center' | 'end' | 'between'>(
          record.justify,
          STACK_JUSTIFIES,
          `${path}.justify`,
        );
        const wrap = assertOptionalBoolean(record.wrap, `${path}.wrap`);
        const children = validateChildren(record.children, `${path}.children`, depth, state);
        return {
          type: 'Stack',
          ...(id !== undefined ? { id } : {}),
          ...(direction !== undefined ? { direction } : {}),
          ...(gap !== undefined ? { gap } : {}),
          ...(align !== undefined ? { align } : {}),
          ...(justify !== undefined ? { justify } : {}),
          ...(wrap !== undefined ? { wrap } : {}),
          ...(children !== undefined ? { children } : {}),
        };
      }
      case 'Card': {
        const title = assertOptionalString(record.title, `${path}.title`, 240);
        const subtitle = assertOptionalString(record.subtitle, `${path}.subtitle`, 600);
        const tone = assertOptionalEnum<'default' | 'subtle' | 'accent' | 'warning' | 'danger'>(
          record.tone,
          CARD_TONES,
          `${path}.tone`,
        );
        const padded = assertOptionalBoolean(record.padded, `${path}.padded`);
        const children = validateChildren(record.children, `${path}.children`, depth, state);
        return {
          type: 'Card',
          ...(id !== undefined ? { id } : {}),
          ...(title !== undefined ? { title } : {}),
          ...(subtitle !== undefined ? { subtitle } : {}),
          ...(tone !== undefined ? { tone } : {}),
          ...(padded !== undefined ? { padded } : {}),
          ...(children !== undefined ? { children } : {}),
        };
      }
      case 'Text': {
        const content = assertBoundedString(record.content, `${path}.content`);
        const variant = assertOptionalEnum<'title' | 'heading' | 'body' | 'muted' | 'caption' | 'code'>(
          record.variant,
          TEXT_VARIANTS,
          `${path}.variant`,
        );
        const tone = assertOptionalEnum<'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'>(
          record.tone,
          TEXT_TONES,
          `${path}.tone`,
        );
        const tabularNums = assertOptionalBoolean(record.tabularNums, `${path}.tabularNums`);
        return {
          type: 'Text',
          ...(id !== undefined ? { id } : {}),
          content,
          ...(variant !== undefined ? { variant } : {}),
          ...(tone !== undefined ? { tone } : {}),
          ...(tabularNums !== undefined ? { tabularNums } : {}),
        };
      }
      case 'Badge': {
        const label = assertBoundedString(record.label, `${path}.label`, {
          required: true,
          maxLength: 120,
        });
        const variant = assertOptionalEnum<'default' | 'info' | 'success' | 'warning' | 'danger' | 'outline'>(
          record.variant,
          BADGE_VARIANTS,
          `${path}.variant`,
        );
        return {
          type: 'Badge',
          ...(id !== undefined ? { id } : {}),
          label,
          ...(variant !== undefined ? { variant } : {}),
        };
      }
      case 'Button': {
        const label = assertBoundedString(record.label, `${path}.label`, {
          required: true,
          maxLength: 120,
        });
        const actionId = assertIdentifier(record.actionId, SAFE_ACTION_ID_PATTERN, `${path}.actionId`);
        if (state.declaredActions && state.declaredActions.size > 0 && !state.declaredActions.has(actionId)) {
          throw new DeclarativeUiValidationError(
            'INVALID_ACTION_DEFINITION',
            `Action "${actionId}" is not declared in panel actions.`,
            `${path}.actionId`,
          );
        }
        const payload =
          record.payload !== undefined
            ? assertJsonSafeProps(record.payload, `${path}.payload`, state.maxPropsDepth)
            : undefined;
        const variant = assertOptionalEnum<'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'>(
          record.variant,
          BUTTON_VARIANTS,
          `${path}.variant`,
        );
        const size = assertOptionalEnum<'sm' | 'md'>(record.size, BUTTON_SIZES, `${path}.size`);
        const disabled = assertOptionalBoolean(record.disabled, `${path}.disabled`);
        const disabledReason = assertOptionalString(record.disabledReason, `${path}.disabledReason`, 240);
        const loading = assertOptionalBoolean(record.loading, `${path}.loading`);
        return {
          type: 'Button',
          ...(id !== undefined ? { id } : {}),
          label,
          actionId,
          ...(payload !== undefined ? { payload } : {}),
          ...(variant !== undefined ? { variant } : {}),
          ...(size !== undefined ? { size } : {}),
          ...(disabled !== undefined ? { disabled } : {}),
          ...(disabledReason !== undefined ? { disabledReason } : {}),
          ...(loading !== undefined ? { loading } : {}),
        };
      }
      case 'Switch': {
        const label = assertBoundedString(record.label, `${path}.label`, {
          required: true,
          maxLength: 180,
        });
        const description = assertOptionalString(record.description, `${path}.description`, 400);
        const atomKey =
          record.atomKey !== undefined
            ? assertIdentifier(record.atomKey, SAFE_KEY_PATTERN, `${path}.atomKey`)
            : undefined;
        if (atomKey !== undefined && state.declaredAtoms && state.declaredAtoms.size > 0) {
          const atomDef = state.declaredAtoms.get(atomKey);
          if (!atomDef || atomDef.type !== 'boolean') {
            throw new DeclarativeUiValidationError(
              'INVALID_ATOM_DEFINITION',
              `Switch atom "${atomKey}" must be declared with type "boolean".`,
              `${path}.atomKey`,
            );
          }
        }
        const checked = assertOptionalBoolean(record.checked, `${path}.checked`);
        const actionId =
          record.actionId !== undefined
            ? assertIdentifier(record.actionId, SAFE_ACTION_ID_PATTERN, `${path}.actionId`)
            : undefined;
        if (
          actionId !== undefined &&
          state.declaredActions &&
          state.declaredActions.size > 0 &&
          !state.declaredActions.has(actionId)
        ) {
          throw new DeclarativeUiValidationError(
            'INVALID_ACTION_DEFINITION',
            `Action "${actionId}" is not declared in panel actions.`,
            `${path}.actionId`,
          );
        }
        const disabled = assertOptionalBoolean(record.disabled, `${path}.disabled`);
        const disabledReason = assertOptionalString(record.disabledReason, `${path}.disabledReason`, 240);
        return {
          type: 'Switch',
          ...(id !== undefined ? { id } : {}),
          label,
          ...(description !== undefined ? { description } : {}),
          ...(atomKey !== undefined ? { atomKey } : {}),
          ...(checked !== undefined ? { checked } : {}),
          ...(actionId !== undefined ? { actionId } : {}),
          ...(disabled !== undefined ? { disabled } : {}),
          ...(disabledReason !== undefined ? { disabledReason } : {}),
        };
      }
      case 'Input': {
        const label = assertOptionalString(
          record.label,
          `${path}.label`,
          DEFAULT_DECLARATIVE_UI_MAX_LABEL_LENGTH,
        );
        const labelHidden = assertOptionalBoolean(record.labelHidden, `${path}.labelHidden`);
        const description = assertOptionalString(record.description, `${path}.description`, 400);
        const atomKey =
          record.atomKey !== undefined
            ? assertIdentifier(record.atomKey, SAFE_KEY_PATTERN, `${path}.atomKey`)
            : undefined;
        if (atomKey !== undefined && state.declaredAtoms && state.declaredAtoms.size > 0) {
          const atomDef = state.declaredAtoms.get(atomKey);
          if (!atomDef || (atomDef.type !== 'string' && atomDef.type !== 'number')) {
            throw new DeclarativeUiValidationError(
              'INVALID_ATOM_DEFINITION',
              `Input atom "${atomKey}" must be declared with type "string" or "number".`,
              `${path}.atomKey`,
            );
          }
        }
        const value = assertOptionalString(record.value, `${path}.value`, 2000);
        const placeholder = assertOptionalString(record.placeholder, `${path}.placeholder`, 240);
        const inputType = assertOptionalEnum<'text' | 'number' | 'password' | 'search' | 'url'>(
          record.inputType,
          INPUT_TYPES,
          `${path}.inputType`,
        );
        const actionId =
          record.actionId !== undefined
            ? assertIdentifier(record.actionId, SAFE_ACTION_ID_PATTERN, `${path}.actionId`)
            : undefined;
        if (
          actionId !== undefined &&
          state.declaredActions &&
          state.declaredActions.size > 0 &&
          !state.declaredActions.has(actionId)
        ) {
          throw new DeclarativeUiValidationError(
            'INVALID_ACTION_DEFINITION',
            `Action "${actionId}" is not declared in panel actions.`,
            `${path}.actionId`,
          );
        }
        const disabled = assertOptionalBoolean(record.disabled, `${path}.disabled`);
        const disabledReason = assertOptionalString(record.disabledReason, `${path}.disabledReason`, 240);
        const readOnly = assertOptionalBoolean(record.readOnly, `${path}.readOnly`);
        let maxLength: number | undefined;
        if (record.maxLength !== undefined) {
          if (
            typeof record.maxLength !== 'number' ||
            !Number.isInteger(record.maxLength) ||
            record.maxLength < 1 ||
            record.maxLength > DEFAULT_DECLARATIVE_UI_MAX_TEXT_LENGTH
          ) {
            throw new DeclarativeUiValidationError(
              'INVALID_NODE_PROPS',
              'Input maxLength must be a positive integer.',
              `${path}.maxLength`,
            );
          }
          maxLength = record.maxLength;
        }
        return {
          type: 'Input',
          ...(id !== undefined ? { id } : {}),
          ...(label !== undefined ? { label } : {}),
          ...(labelHidden !== undefined ? { labelHidden } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(atomKey !== undefined ? { atomKey } : {}),
          ...(value !== undefined ? { value } : {}),
          ...(placeholder !== undefined ? { placeholder } : {}),
          ...(inputType !== undefined ? { inputType } : {}),
          ...(actionId !== undefined ? { actionId } : {}),
          ...(disabled !== undefined ? { disabled } : {}),
          ...(disabledReason !== undefined ? { disabledReason } : {}),
          ...(readOnly !== undefined ? { readOnly } : {}),
          ...(maxLength !== undefined ? { maxLength } : {}),
        };
      }
      case 'Table': {
        const caption = assertOptionalString(record.caption, `${path}.caption`, 240);
        const emptyText = assertOptionalString(record.emptyText, `${path}.emptyText`, 240);
        const compact = assertOptionalBoolean(record.compact, `${path}.compact`);
        if (!Array.isArray(record.columns) || record.columns.length === 0) {
          throw new DeclarativeUiValidationError(
            'INVALID_NODE_PROPS',
            'Table requires a non-empty columns array.',
            `${path}.columns`,
          );
        }
        if (record.columns.length > 24) {
          throw new DeclarativeUiValidationError(
            'INVALID_NODE_PROPS',
            'Table supports at most 24 columns.',
            `${path}.columns`,
          );
        }
        const seenCols = new Set<string>();
        const columns: DeclarativeTableColumn[] = record.columns.map((colRaw, idx) => {
          const colPath = `${path}.columns[${idx}]`;
          const colRec = assertPlainObject(colRaw, colPath);
          assertKeysAllowed(colRec, ALLOWED_TABLE_COLUMN_KEYS, colPath);
          const key = assertIdentifier(colRec.key, SAFE_KEY_PATTERN, `${colPath}.key`);
          if (seenCols.has(key)) {
            throw new DeclarativeUiValidationError(
              'INVALID_NODE_PROPS',
              `Duplicate Table column key "${key}".`,
              `${colPath}.key`,
            );
          }
          seenCols.add(key);
          const label = assertBoundedString(colRec.label, `${colPath}.label`, {
            required: true,
            maxLength: 120,
          });
          const align = assertOptionalEnum<'left' | 'center' | 'right'>(
            colRec.align,
            TABLE_ALIGNS,
            `${colPath}.align`,
          );
          const mono = assertOptionalBoolean(colRec.mono, `${colPath}.mono`);
          const sortable = assertOptionalBoolean(colRec.sortable, `${colPath}.sortable`);
          return {
            key,
            label,
            ...(align !== undefined ? { align } : {}),
            ...(mono !== undefined ? { mono } : {}),
            ...(sortable !== undefined ? { sortable } : {}),
          };
        });

        if (!Array.isArray(record.rows)) {
          throw new DeclarativeUiValidationError(
            'INVALID_NODE_PROPS',
            'Table rows must be an array.',
            `${path}.rows`,
          );
        }
        if (record.rows.length > 500) {
          throw new DeclarativeUiValidationError(
            'INVALID_NODE_PROPS',
            'Table supports at most 500 rows.',
            `${path}.rows`,
          );
        }
        const rows: DeclarativeTableRow[] = record.rows.map((rowRaw, rIdx) => {
          const rowPath = `${path}.rows[${rIdx}]`;
          const rowRec = assertPlainObject(rowRaw, rowPath);
          const cleanRow: Record<string, DeclarativeTableCellValue> = {};
          for (const key of Object.getOwnPropertyNames(rowRec)) {
            assertSafeKey(key, rowPath);
            const cell = rowRec[key];
            if (
              cell !== null &&
              typeof cell !== 'string' &&
              typeof cell !== 'boolean' &&
              !(typeof cell === 'number' && Number.isFinite(cell))
            ) {
              throw new DeclarativeUiValidationError(
                'NON_JSON_SAFE_VALUE',
                `Table cell "${key}" must be string | number | boolean | null.`,
                `${rowPath}.${key}`,
              );
            }
            cleanRow[key] = cell;
          }
          return cleanRow;
        });

        return {
          type: 'Table',
          ...(id !== undefined ? { id } : {}),
          ...(caption !== undefined ? { caption } : {}),
          columns,
          rows,
          ...(emptyText !== undefined ? { emptyText } : {}),
          ...(compact !== undefined ? { compact } : {}),
        };
      }
    }
  } finally {
    state.seen.delete(record);
  }
}

function validateChildren(
  rawChildren: unknown,
  path: string,
  parentDepth: number,
  state: TreeState,
): DeclarativeUiNode[] | undefined {
  if (rawChildren === undefined) return undefined;
  if (!Array.isArray(rawChildren)) {
    throw new DeclarativeUiValidationError(
      'INVALID_NODE_PROPS',
      'children must be an array of declarative UI nodes.',
      path,
    );
  }
  const siblingIds = new Set<string>();
  return rawChildren.map((child, idx) => {
    const validated = validateNode(child, `${path}[${idx}]`, parentDepth + 1, state);
    if (validated.id !== undefined) {
      if (siblingIds.has(validated.id)) {
        throw new DeclarativeUiValidationError(
          'DUPLICATE_SIBLING_ID',
          `Duplicate sibling node id "${validated.id}".`,
          `${path}[${idx}].id`,
        );
      }
      siblingIds.add(validated.id);
    }
    return validated;
  });
}

export function validateDeclarativeUiTree(
  root: unknown,
  options?: ValidateDeclarativeUiOptions,
): DeclarativeUiNode {
  const maxDepth = Math.max(
    1,
    Math.min(options?.maxDepth ?? DEFAULT_DECLARATIVE_UI_MAX_DEPTH, HARD_DECLARATIVE_UI_MAX_DEPTH),
  );
  const maxNodes = Math.max(
    1,
    Math.min(options?.maxNodes ?? DEFAULT_DECLARATIVE_UI_MAX_NODES, HARD_DECLARATIVE_UI_MAX_NODES),
  );
  const maxPropsDepth = Math.max(
    1,
    Math.min(options?.maxPropsDepth ?? DEFAULT_DECLARATIVE_UI_MAX_PROPS_DEPTH, HARD_DECLARATIVE_UI_MAX_DEPTH),
  );
  const maxTreeBytes = Math.max(
    256,
    Math.min(options?.maxTreeBytes ?? DEFAULT_DECLARATIVE_UI_MAX_TREE_BYTES, HARD_DECLARATIVE_UI_MAX_TREE_BYTES),
  );
  return validateNode(root, '$.root', 0, {
    nodeCount: 0,
    treeBytes: 0,
    maxDepth,
    maxNodes,
    maxPropsDepth,
    maxTreeBytes,
    seen: new WeakSet<object>(),
  });
}

export function validateDeclarativePanelSpec(
  rawSpec: unknown,
  options?: ValidateDeclarativeUiOptions,
): DeclarativeUiPanelSpec {
  const record = assertPlainObject(rawSpec, '$');
  assertKeysAllowed(record, ALLOWED_SPEC_KEYS, '$');

  if (record.ui !== DECLARATIVE_UI_MODE) {
    throw new DeclarativeUiValidationError(
      'UNSUPPORTED_UI_MODE',
      `Expected ui: "${DECLARATIVE_UI_MODE}", got "${String(record.ui)}".`,
      '$.ui',
    );
  }

  let schemaVersion: typeof DECLARATIVE_UI_SCHEMA_VERSION | undefined;
  if (record.schemaVersion !== undefined) {
    if (record.schemaVersion !== DECLARATIVE_UI_SCHEMA_VERSION) {
      throw new DeclarativeUiValidationError(
        'INVALID_SPEC',
        `Unsupported schemaVersion "${String(record.schemaVersion)}".`,
        '$.schemaVersion',
      );
    }
    schemaVersion = DECLARATIVE_UI_SCHEMA_VERSION;
  }

  const title = assertOptionalString(record.title, '$.title', 200);
  const description = assertOptionalString(record.description, '$.description', 600);

  const declaredAtoms = new Map<string, DeclarativeAtomDefinition>();
  let atoms: DeclarativeAtomDefinition[] | undefined;
  if (record.atoms !== undefined) {
    if (!Array.isArray(record.atoms)) {
      throw new DeclarativeUiValidationError('INVALID_ATOM_DEFINITION', 'atoms must be an array.', '$.atoms');
    }
    atoms = record.atoms.map((rawAtom, idx) => {
      const atomPath = `$.atoms[${idx}]`;
      const atomRec = assertPlainObject(rawAtom, atomPath);
      assertKeysAllowed(atomRec, ALLOWED_ATOM_KEYS, atomPath);
      const key = assertIdentifier(atomRec.key, SAFE_KEY_PATTERN, `${atomPath}.key`, 'INVALID_ATOM_DEFINITION');
      if (declaredAtoms.has(key)) {
        throw new DeclarativeUiValidationError(
          'INVALID_ATOM_DEFINITION',
          `Duplicate atom key "${key}".`,
          `${atomPath}.key`,
        );
      }
      const atomType = atomRec.type;
      if (atomType !== 'string' && atomType !== 'number' && atomType !== 'boolean') {
        throw new DeclarativeUiValidationError(
          'INVALID_ATOM_DEFINITION',
          `Atom type must be "string" | "number" | "boolean".`,
          `${atomPath}.type`,
        );
      }
      const defaultValue = atomRec.defaultValue;
      if (
        (atomType === 'string' && typeof defaultValue !== 'string') ||
        (atomType === 'boolean' && typeof defaultValue !== 'boolean') ||
        (atomType === 'number' && (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)))
      ) {
        throw new DeclarativeUiValidationError(
          'INVALID_ATOM_DEFINITION',
          `Atom "${key}" defaultValue must match type "${atomType}".`,
          `${atomPath}.defaultValue`,
        );
      }
      let persist: DeclarativeAtomDefinition['persist'];
      if (atomRec.persist !== undefined) {
        const rawPersist = atomRec.persist;
        if (
          typeof rawPersist !== 'boolean' &&
          rawPersist !== 'memory' &&
          rawPersist !== 'plugin' &&
          rawPersist !== 'workspace'
        ) {
          throw new DeclarativeUiValidationError(
            'INVALID_ATOM_DEFINITION',
            `Atom "${key}" persist must be boolean | "memory" | "plugin" | "workspace".`,
            `${atomPath}.persist`,
          );
        }
        persist = rawPersist;
      }
      let version: number | undefined;
      if (atomRec.version !== undefined) {
        const rawVersion = atomRec.version;
        if (
          typeof rawVersion !== 'number' ||
          !Number.isInteger(rawVersion) ||
          rawVersion < 0 ||
          rawVersion > 10_000
        ) {
          throw new DeclarativeUiValidationError(
            'INVALID_ATOM_DEFINITION',
            `Atom "${key}" version must be an integer between 0 and 10000.`,
            `${atomPath}.version`,
          );
        }
        version = rawVersion;
      }
      const label = assertOptionalString(atomRec.label, `${atomPath}.label`, 180);
      const def: DeclarativeAtomDefinition = {
        key,
        type: atomType,
        defaultValue: defaultValue as string | number | boolean,
        ...(persist !== undefined ? { persist } : {}),
        ...(version !== undefined ? { version } : {}),
        ...(label !== undefined ? { label } : {}),
      };
      declaredAtoms.set(key, def);
      return def;
    });
  }

  const declaredActions = new Map<string, DeclarativeActionDefinition>();
  let actions: DeclarativeActionDefinition[] | undefined;
  if (record.actions !== undefined) {
    if (!Array.isArray(record.actions)) {
      throw new DeclarativeUiValidationError(
        'INVALID_ACTION_DEFINITION',
        'actions must be an array.',
        '$.actions',
      );
    }
    actions = record.actions.map((rawAction, idx) => {
      const actionPath = `$.actions[${idx}]`;
      const actionRec = assertPlainObject(rawAction, actionPath);
      assertKeysAllowed(actionRec, ALLOWED_ACTION_KEYS, actionPath);
      const id = assertIdentifier(
        actionRec.id,
        SAFE_ACTION_ID_PATTERN,
        `${actionPath}.id`,
        'INVALID_ACTION_DEFINITION',
      );
      if (declaredActions.has(id)) {
        throw new DeclarativeUiValidationError(
          'INVALID_ACTION_DEFINITION',
          `Duplicate action id "${id}".`,
          `${actionPath}.id`,
        );
      }
      const label = assertOptionalString(actionRec.label, `${actionPath}.label`, 120);
      const confirm = assertOptionalBoolean(actionRec.confirm, `${actionPath}.confirm`);
      const confirmMessage = assertOptionalString(
        actionRec.confirmMessage,
        `${actionPath}.confirmMessage`,
        300,
      );
      let mutatesAtoms: string[] | undefined;
      if (actionRec.mutatesAtoms !== undefined) {
        if (!Array.isArray(actionRec.mutatesAtoms)) {
          throw new DeclarativeUiValidationError(
            'INVALID_ACTION_DEFINITION',
            'mutatesAtoms must be an array of atom keys.',
            `${actionPath}.mutatesAtoms`,
          );
        }
        mutatesAtoms = actionRec.mutatesAtoms.map((k, kIdx) =>
          assertIdentifier(
            k,
            SAFE_KEY_PATTERN,
            `${actionPath}.mutatesAtoms[${kIdx}]`,
            'INVALID_ACTION_DEFINITION',
          ),
        );
      }
      const def: DeclarativeActionDefinition = {
        id,
        ...(label !== undefined ? { label } : {}),
        ...(confirm !== undefined ? { confirm } : {}),
        ...(confirmMessage !== undefined ? { confirmMessage } : {}),
        ...(mutatesAtoms !== undefined ? { mutatesAtoms } : {}),
      };
      declaredActions.set(id, def);
      return def;
    });
  }

  const maxDepth = Math.max(
    1,
    Math.min(options?.maxDepth ?? DEFAULT_DECLARATIVE_UI_MAX_DEPTH, HARD_DECLARATIVE_UI_MAX_DEPTH),
  );
  const maxNodes = Math.max(
    1,
    Math.min(options?.maxNodes ?? DEFAULT_DECLARATIVE_UI_MAX_NODES, HARD_DECLARATIVE_UI_MAX_NODES),
  );
  const maxPropsDepth = Math.max(
    1,
    Math.min(options?.maxPropsDepth ?? DEFAULT_DECLARATIVE_UI_MAX_PROPS_DEPTH, HARD_DECLARATIVE_UI_MAX_DEPTH),
  );

  const maxTreeBytes = Math.max(
    256,
    Math.min(options?.maxTreeBytes ?? DEFAULT_DECLARATIVE_UI_MAX_TREE_BYTES, HARD_DECLARATIVE_UI_MAX_TREE_BYTES),
  );

  const root = validateNode(record.root, '$.root', 0, {
    nodeCount: 0,
    treeBytes: 0,
    maxDepth,
    maxNodes,
    maxPropsDepth,
    maxTreeBytes,
    seen: new WeakSet<object>(),
    declaredAtoms,
    declaredActions,
  });

  return {
    ui: DECLARATIVE_UI_MODE,
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(atoms !== undefined ? { atoms } : {}),
    ...(actions !== undefined ? { actions } : {}),
    root,
  };
}
