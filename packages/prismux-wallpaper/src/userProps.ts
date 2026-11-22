import type {
  UserPropDef,
  UserPropOption,
  UserPropType,
  UserPropWireValue,
} from "./types.js";

const LANG_ORDER = ["zh-chs", "zh-cht", "en-us"] as const;

const KNOWN_TYPES = new Set<UserPropType>([
  "color",
  "bool",
  "slider",
  "combo",
  "text",
  "textinput",
  "file",
  "directory",
  "group",
  "other",
]);

const FILE_EXT: Record<string, readonly string[]> = {
  image: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".apng", ".svg"],
  video: [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"],
  audio: [".mp3", ".ogg", ".oga", ".wav", ".m4a", ".flac", ".aac"],
};

function orderOf(def: Record<string, unknown>): number {
  const n = Number(def.order);
  return Number.isFinite(n) ? n : 0;
}

function strField(v: Record<string, unknown>, key: string): string | undefined {
  const s = v[key];
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return t === "" ? undefined : t;
}

/** Strip HTML tags & decode common entities (WE property labels frequently embed HTML). */
export function stripWeHtml(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function lookupLocalization(project: Record<string, unknown> | null, key: string): string | undefined {
  const general = project?.general;
  if (!general || typeof general !== "object") return undefined;
  const table = (general as Record<string, unknown>).localization;
  if (!table || typeof table !== "object") return undefined;
  const byLang: Record<string, Record<string, unknown>> = {};
  for (const [langKey, val] of Object.entries(table as Record<string, unknown>)) {
    if (val && typeof val === "object") {
      byLang[langKey.toLowerCase()] = val as Record<string, unknown>;
    }
  }
  for (const lang of LANG_ORDER) {
    const entry = byLang[lang];
    if (entry && typeof entry[key] === "string") {
      return entry[key];
    }
  }
  return undefined;
}

function resolveText(
  project: Record<string, unknown> | null,
  raw: string,
  key: string,
  fallback: string,
): string {
  const rawTrimmed = raw.trim();
  const loc =
    (rawTrimmed ? lookupLocalization(project, rawTrimmed) : undefined) ??
    lookupLocalization(project, key);
  const src = typeof loc === "string" && loc.trim() !== "" ? loc : raw;
  const clean = stripWeHtml(src);
  return clean !== "" ? clean : fallback;
}

function wireValue(ptype: UserPropType, def: Record<string, unknown>): UserPropWireValue | undefined {
  if (!("value" in def)) return undefined;
  const raw = def.value;
  if (raw === null || raw === undefined) return undefined;
  switch (ptype) {
    case "color":
      return typeof raw === "string" ? raw : undefined;
    case "bool":
      return typeof raw === "boolean" ? raw : undefined;
    case "slider": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case "combo":
      if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        return raw;
      }
      return String(raw);
    default:
      return typeof raw === "string" ? raw : JSON.stringify(raw);
  }
}

function rawProps(project: Record<string, unknown> | null): Array<[string, Record<string, unknown>]> {
  const general = project?.general;
  if (!general || typeof general !== "object") return [];
  const props = (general as Record<string, unknown>).properties;
  if (!props || typeof props !== "object") return [];
  const out: Array<[string, Record<string, unknown>]> = [];
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (v && typeof v === "object" && typeof (v as Record<string, unknown>).type === "string") {
      out.push([k, v as Record<string, unknown>]);
    }
  }
  // Float ascending order; tie-break by code point (matches Wallpaper Engine byte order)
  out.sort(
    (a, b) =>
      orderOf(a[1]) - orderOf(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  return out;
}

export interface ParseUserPropsOptions {
  filePrefix?: string;
  listFiles?: string[];
}

/**
 * Parse Wallpaper Engine `project.json` `general.properties` into UI-ready UserPropDef[].
 * Preserves float `order` sorting, zh-chs -> zh-cht -> en-us per-key localization fallback,
 * `combo` exact JSON value types, and `editable: false` hidden entries.
 */
export function parseUserPropDefs(
  project: Record<string, unknown> | null,
  overrides?: Record<string, UserPropWireValue> | null,
  opts: ParseUserPropsOptions = {},
): UserPropDef[] {
  const ov = overrides && typeof overrides === "object" ? overrides : {};
  const filePrefix = typeof opts.filePrefix === "string" ? opts.filePrefix : "";
  const out: UserPropDef[] = [];

  for (const [name, def] of rawProps(project)) {
    const hidden = def.editable === false;
    const rawType = String(def.type || "other").toLowerCase() as UserPropType;
    const kind: UserPropType = KNOWN_TYPES.has(rawType) ? rawType : "other";
    const dflt = wireValue(kind, def);
    const overridden = Object.prototype.hasOwnProperty.call(ov, name);
    let value: UserPropWireValue | undefined = overridden ? ov[name] : dflt;
    if (kind === "file" && typeof value === "string" && value !== "" && filePrefix) {
      value = `${filePrefix}${value}`;
    }

    const entry: UserPropDef = {
      name,
      ptype: kind,
      text: resolveText(project, typeof def.text === "string" ? def.text : "", name, name),
      order: orderOf(def),
      value: value === undefined ? null : value,
      defaultValue: dflt === undefined ? null : dflt,
      overridden,
    };

    const cond = strField(def, "condition");
    if (cond) entry.condition = cond;
    if (hidden) entry.hidden = true;

    if (Array.isArray(def.options)) {
      const options: UserPropOption[] = [];
      for (const rawOpt of def.options) {
        if (!rawOpt || typeof rawOpt !== "object") continue;
        const o = rawOpt as Record<string, unknown>;
        if (typeof o.label !== "string" || !("value" in o)) continue;
        const optVal = o.value;
        if (typeof optVal !== "string" && typeof optVal !== "number" && typeof optVal !== "boolean") {
          continue;
        }
        const opt: UserPropOption = {
          label: resolveText(
            project,
            o.label,
            o.label,
            typeof optVal === "string" ? optVal : JSON.stringify(optVal),
          ),
          value: optVal,
        };
        const oc = strField(o, "condition");
        if (oc) opt.condition = oc;
        options.push(opt);
      }
      if (options.length) entry.options = options;
    }

    if (def.min !== undefined && Number.isFinite(Number(def.min))) entry.min = Number(def.min);
    if (def.max !== undefined && Number.isFinite(Number(def.max))) entry.max = Number(def.max);
    if (def.step !== undefined && Number.isFinite(Number(def.step))) entry.step = Number(def.step);
    if (def.precision !== undefined && Number.isFinite(Number(def.precision))) {
      entry.precision = Number(def.precision);
    }

    const ft = strField(def, "fileType");
    if (ft) entry.fileType = ft;

    if ((kind === "file" || kind === "directory") && Array.isArray(opts.listFiles)) {
      const exts = ft ? FILE_EXT[ft] ?? null : null;
      const files = opts.listFiles.filter((f) => {
        if (exts === null) return true;
        const lower = f.toLowerCase();
        return exts.some((e) => lower.endsWith(e));
      });
      if (files.length) entry.files = files.slice(0, 200);
    }

    out.push(entry);
  }
  return out;
}

/** Merge live user overrides into an existing UserPropDef list. */
export function applyUserPropOverrides(
  defs: readonly UserPropDef[],
  overrides?: Record<string, UserPropWireValue> | null,
): UserPropDef[] {
  const ov = overrides && typeof overrides === "object" ? overrides : {};
  return defs.map((def) => {
    const hasOv = Object.prototype.hasOwnProperty.call(ov, def.name);
    const val = hasOv ? ov[def.name] ?? null : def.defaultValue;
    return {
      ...def,
      value: val,
      overridden: hasOv && !sameUserPropValue(val, def.defaultValue),
    };
  });
}

/** Strict comparison preserving JSON scalar type differences for WE combo options. */
export function sameUserPropValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  return false;
}

/** Convert WE normalized RGB color string ("0.2 0.5 1.0") or "#rrggbb" to CSS "#rrggbb". */
export function weColorToHex(raw: unknown, fallback = "#4f8cff"): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const r = trimmed[1]!;
    const g = trimmed[2]!;
    const b = trimmed[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const parts = trimmed.split(/\s+/).map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
    const scale = parts[0]! <= 1 && parts[1]! <= 1 && parts[2]! <= 1 ? 255 : 1;
    const toByte = (n: number) =>
      Math.max(0, Math.min(255, Math.round(n * scale)))
        .toString(16)
        .padStart(2, "0");
    return `#${toByte(parts[0]!)}${toByte(parts[1]!)}${toByte(parts[2]!)}`;
  }
  return fallback;
}

/** Convert "#rrggbb" into WE normalized RGB string ("r g b" in 0..1). */
export function weHexToColor(hex: string): string {
  const clean = weColorToHex(hex, "#4f8cff").slice(1);
  const r = (parseInt(clean.slice(0, 2), 16) / 255).toFixed(4);
  const g = (parseInt(clean.slice(2, 4), 16) / 255).toFixed(4);
  const b = (parseInt(clean.slice(4, 6), 16) / 255).toFixed(4);
  return `${r} ${g} ${b}`;
}

/** Convert project.json schemecolor ("r g b") to CSS hex or null. */
export function schemeToCss(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (/^#[0-9a-f]{3,6}$/i.test(trimmed)) return weColorToHex(trimmed);
  const parts = trimmed.split(/\s+/).map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
    return weColorToHex(trimmed);
  }
  return null;
}

// ── Safe recursive-descent evaluator for WE `condition` expressions (NO eval / Function) ──

type Token =
  | { kind: "op"; value: string }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "str"; value: string }
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "ident"; value: string };

function tokenizeCondition(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i++;
      continue;
    }
    const two = expr.slice(i, i + 2);
    const three = expr.slice(i, i + 3);
    if (three === "===" || three === "!==") {
      tokens.push({ kind: "op", value: three });
      i += 3;
      continue;
    }
    if (two === "&&" || two === "||" || two === "==" || two === "!=" || two === "<=" || two === ">=") {
      tokens.push({ kind: "op", value: two });
      i += 2;
      continue;
    }
    if (ch === "!" || ch === "<" || ch === ">") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let str = "";
      while (j < expr.length && expr[j] !== quote) {
        if (expr[j] === "\\" && j + 1 < expr.length) {
          str += expr[j + 1]!;
          j += 2;
        } else {
          str += expr[j]!;
          j++;
        }
      }
      tokens.push({ kind: "str", value: str });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "-" && i + 1 < expr.length && /[0-9]/.test(expr[i + 1]!))) {
      let j = i + 1;
      while (j < expr.length && /[0-9.]/.test(expr[j]!)) j++;
      tokens.push({ kind: "num", value: Number(expr.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < expr.length && /[A-Za-z0-9_$.]/.test(expr[j]!)) j++;
      const word = expr.slice(i, j);
      if (word === "true") tokens.push({ kind: "bool", value: true });
      else if (word === "false") tokens.push({ kind: "bool", value: false });
      else tokens.push({ kind: "ident", value: word });
      i = j;
      continue;
    }
    // Skip unknown punctuation gracefully
    i++;
  }
  return tokens;
}

/**
 * Safely evaluate Wallpaper Engine `condition` expressions like:
 * `enableBloom.value == true && bloomMode.value != 0` or `!hideClock`.
 * Fails open (returns true) on unparseable syntax so controls are never silently lost.
 */
export function weEvalCondition(
  condition: string,
  values: Record<string, UserPropWireValue | null | undefined>,
): boolean {
  const trimmed = condition.trim();
  if (!trimmed) return true;
  const tokens = tokenizeCondition(trimmed);
  if (!tokens.length) return true;

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token | undefined => tokens[pos++];

  const resolveIdent = (ident: string): unknown => {
    const clean = ident.endsWith(".value") ? ident.slice(0, -6) : ident;
    if (Object.prototype.hasOwnProperty.call(values, clean)) {
      return values[clean];
    }
    if (Object.prototype.hasOwnProperty.call(values, ident)) {
      return values[ident];
    }
    return undefined;
  };

  const parseOr = (): unknown => {
    let left = parseAnd();
    while (peek()?.kind === "op" && peek()?.value === "||") {
      consume();
      const right = parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  };

  const parseAnd = (): unknown => {
    let left = parseCompare();
    while (peek()?.kind === "op" && peek()?.value === "&&") {
      consume();
      const right = parseCompare();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  };

  const parseCompare = (): unknown => {
    let left = parseUnary();
    while (true) {
      const tok = peek();
      if (!tok || tok.kind !== "op") break;
      const op = tok.value;
      if (!["==", "===", "!=", "!==", "<", "<=", ">", ">="].includes(op)) break;
      consume();
      const right = parseUnary();
      switch (op) {
        case "===":
          left = left === right;
          break;
        case "!==":
          left = left !== right;
          break;
        case "==":
          // eslint-disable-next-line eqeqeq
          left = left == right;
          break;
        case "!=":
          // eslint-disable-next-line eqeqeq
          left = left != right;
          break;
        case "<":
          left = Number(left) < Number(right);
          break;
        case "<=":
          left = Number(left) <= Number(right);
          break;
        case ">":
          left = Number(left) > Number(right);
          break;
        case ">=":
          left = Number(left) >= Number(right);
          break;
      }
    }
    return left;
  };

  const parseUnary = (): unknown => {
    if (peek()?.kind === "op" && peek()?.value === "!") {
      consume();
      return !Boolean(parseUnary());
    }
    return parsePrimary();
  };

  const parsePrimary = (): unknown => {
    const tok = consume();
    if (!tok) return true;
    if (tok.kind === "paren" && tok.value === "(") {
      const inner = parseOr();
      if (peek()?.kind === "paren" && peek()?.value === ")") consume();
      return inner;
    }
    if (tok.kind === "str" || tok.kind === "num" || tok.kind === "bool") {
      return tok.value;
    }
    if (tok.kind === "ident") {
      return resolveIdent(tok.value);
    }
    return true;
  };

  try {
    return Boolean(parseOr());
  } catch {
    return true;
  }
}
