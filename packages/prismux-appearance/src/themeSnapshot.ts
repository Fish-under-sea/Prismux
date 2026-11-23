import {
  DEFAULT_APPEARANCE_CONFIG,
  WB_THEME_FORMAT,
  WB_THEME_VERSION,
  type AppearanceConfig,
  type DeepPartialAppearanceConfig,
  type WbThemeParseOutcome,
  type WbThemeSnapshot,
} from './types.js';
import { normalizeAppearanceConfig } from './glassEngine.js';

export interface WbThemeExportMetadata {
  name?: string;
  author?: string;
  description?: string;
  exportedAt?: string;
}

const ALLOWED_SNAPSHOT_KEYS = new Set([
  'format',
  'version',
  'name',
  'author',
  'description',
  'exportedAt',
  'appearance',
]);

const ALLOWED_APPEARANCE_KEYS = new Set<keyof AppearanceConfig>([
  'themeMode',
  'glassBasePolarity',
  'accentMode',
  'accent',
  'glassPreset',
  'glassRegions',
  'glassColor',
  'glassDarkSeparate',
  'glassDarkColor',
  'glassFidelity',
  'fresnelStrength',
  'wallpaperDim',
  'thinkingMode',
  'leftSidebarGlass',
  'titlebarGlass',
  'rightSidebarGlass',
  'rightSidebarFullClear',
  'perSurfaceOverrides',
  'glassZones',
  'sidebarCornerRadius',
  'sidebarSquareCorners',
  'rightSidebarCornerRadius',
  'rightSidebarSquareCorners',
  'uiColorCustom',
  'caretColor',
  'typography',
]);

const SENSITIVE_OR_PATH_KEY_RE =
  /(token|secret|password|passwd|apikey|api_key|credential|cookie|oauth|privatekey|bearer|\bauth(?!or\b)|auth_|_auth|path|folder|steam|wallpaperurl|wallpaperfile|localfile|filepath|cwd|homedir|^dir$|_dir$)/i;

const LOCAL_PATH_VALUE_RE =
  /(^[a-zA-Z]:[\\/]|^\\\\[^\\]+\\|^file:\/\/|^\/(?:Users|home|var|etc|opt|mnt|Volumes|root|tmp)\/|\\Users\\|%USERPROFILE%|~\/\.prismux)/i;

const CREDENTIAL_VALUE_RE =
  /^(?:sk-[a-zA-Z0-9_-]{12,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|Bearer\s+\S{12,}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSuspiciousStringValue(value: string): boolean {
  const trimmed = value.trim();
  return LOCAL_PATH_VALUE_RE.test(trimmed) || CREDENTIAL_VALUE_RE.test(trimmed);
}

function sanitizeMetaString(
  value: unknown,
  fieldPath: string,
  strippedFields: string[],
  maxLen: number,
): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (isSuspiciousStringValue(trimmed)) {
    strippedFields.push(fieldPath);
    return '';
  }
  return trimmed.slice(0, maxLen);
}

function collectStrippedFields(
  obj: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  prefix: string,
  strippedFields: string[],
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!allowedKeys.has(key) || SENSITIVE_OR_PATH_KEY_RE.test(key)) {
      strippedFields.push(path);
      continue;
    }
    if (typeof val === 'string' && isSuspiciousStringValue(val)) {
      strippedFields.push(path);
      continue;
    }
    if (isRecord(val)) {
      const nestedClean: Record<string, unknown> = {};
      for (const [subKey, subVal] of Object.entries(val)) {
        const subPath = `${path}.${subKey}`;
        if (SENSITIVE_OR_PATH_KEY_RE.test(subKey)) {
          strippedFields.push(subPath);
          continue;
        }
        if (typeof subVal === 'string' && isSuspiciousStringValue(subVal)) {
          strippedFields.push(subPath);
          continue;
        }
        if (isRecord(subVal)) {
          const leafClean: Record<string, unknown> = {};
          for (const [leafKey, leafVal] of Object.entries(subVal)) {
            const leafPath = `${subPath}.${leafKey}`;
            if (SENSITIVE_OR_PATH_KEY_RE.test(leafKey)) {
              strippedFields.push(leafPath);
              continue;
            }
            if (typeof leafVal === 'string' && isSuspiciousStringValue(leafVal)) {
              strippedFields.push(leafPath);
              continue;
            }
            leafClean[leafKey] = leafVal;
          }
          nestedClean[subKey] = leafClean;
        } else {
          nestedClean[subKey] = subVal;
        }
      }
      clean[key] = nestedClean;
    } else {
      clean[key] = val;
    }
  }
  return clean;
}

/**
 * Builds a clean, portable `.wb-theme` snapshot guaranteed to contain zero local paths or credentials.
 */
export function exportWbThemeSnapshot(
  config: AppearanceConfig,
  meta: WbThemeExportMetadata = {},
): WbThemeSnapshot {
  const stripped: string[] = [];
  const cleanConfig = normalizeAppearanceConfig(config, DEFAULT_APPEARANCE_CONFIG);
  // Double-pass string scan on font stacks just in case caller passed a raw path.
  const safeFontFamily = isSuspiciousStringValue(cleanConfig.typography.fontFamily)
    ? ''
    : cleanConfig.typography.fontFamily;
  const safeCodeFontFamily = isSuspiciousStringValue(cleanConfig.typography.codeFontFamily)
    ? ''
    : cleanConfig.typography.codeFontFamily;

  const name =
    sanitizeMetaString(meta.name ?? 'Prismux Theme', 'name', stripped, 80) || 'Prismux Theme';
  const author = sanitizeMetaString(meta.author, 'author', stripped, 80);
  const description = sanitizeMetaString(meta.description, 'description', stripped, 240);

  return {
    format: WB_THEME_FORMAT,
    version: WB_THEME_VERSION,
    name,
    ...(author ? { author } : {}),
    ...(description ? { description } : {}),
    exportedAt: meta.exportedAt ?? new Date().toISOString(),
    appearance: {
      ...cleanConfig,
      typography: {
        ...cleanConfig.typography,
        fontFamily: safeFontFamily,
        codeFontFamily: safeCodeFontFamily,
      },
    },
  };
}

export function serializeWbThemeSnapshot(
  config: AppearanceConfig,
  meta: WbThemeExportMetadata = {},
): string {
  return `${JSON.stringify(exportWbThemeSnapshot(config, meta), null, 2)}\n`;
}

/**
 * Validates and sanitizes an imported `.wb-theme` JSON string or parsed object.
 * Strips all unknown keys, local filesystem paths, and credential-like fields before merging onto defaults.
 */
export function importWbThemeSnapshot(rawInput: string | unknown): WbThemeParseOutcome {
  let parsed: unknown = rawInput;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return { ok: false, error: '主题文件内容为空，请选择有效的 .wb-theme 预设文件。' };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: '主题文件不是合法的 JSON 格式，请检查文件是否完整。' };
    }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: '主题文件顶层结构无效，应为 JSON 对象。' };
  }

  const strippedFields: string[] = [];

  if (parsed.format !== undefined && parsed.format !== WB_THEME_FORMAT) {
    return {
      ok: false,
      error: `不支持的主题文件格式：${String(parsed.format)}（期望 ${WB_THEME_FORMAT}）。`,
    };
  }

  if (
    parsed.version !== undefined &&
    (typeof parsed.version !== 'number' || parsed.version > WB_THEME_VERSION || parsed.version < 1)
  ) {
    return {
      ok: false,
      error: `不支持的主题文件版本：v${String(parsed.version)}（当前支持 v${WB_THEME_VERSION}）。`,
    };
  }

  const hasAppearanceWrapper = isRecord(parsed.appearance);
  const rawAppearance = hasAppearanceWrapper ? parsed.appearance : parsed;

  if (hasAppearanceWrapper) {
    for (const key of Object.keys(parsed)) {
      if (!ALLOWED_SNAPSHOT_KEYS.has(key) || SENSITIVE_OR_PATH_KEY_RE.test(key)) {
        strippedFields.push(key);
      }
    }
  }

  if (!isRecord(rawAppearance)) {
    return { ok: false, error: '主题文件缺少有效的 appearance 外观配置段。' };
  }

  // Ensure at least one recognized appearance key exists to avoid accepting unrelated JSON files.
  const hasAnyRecognizedKey = Object.keys(rawAppearance).some((k) =>
    ALLOWED_APPEARANCE_KEYS.has(k as keyof AppearanceConfig),
  );
  if (!hasAnyRecognizedKey) {
    return { ok: false, error: '未识别到 Prismux 外观配置字段，请确认选择了 .wb-theme 文件。' };
  }

  const sanitizedAppearanceObj = collectStrippedFields(
    rawAppearance,
    ALLOWED_APPEARANCE_KEYS as ReadonlySet<string>,
    hasAppearanceWrapper ? 'appearance' : '',
    strippedFields,
  );

  const appearance = normalizeAppearanceConfig(
    sanitizedAppearanceObj as DeepPartialAppearanceConfig,
    DEFAULT_APPEARANCE_CONFIG,
  );

  const name =
    sanitizeMetaString(parsed.name, 'name', strippedFields, 80) || '导入的主题预设';
  const author = sanitizeMetaString(parsed.author, 'author', strippedFields, 80);
  const description = sanitizeMetaString(parsed.description, 'description', strippedFields, 240);
  const exportedAt =
    typeof parsed.exportedAt === 'string' && !Number.isNaN(Date.parse(parsed.exportedAt))
      ? parsed.exportedAt
      : new Date().toISOString();

  return {
    ok: true,
    snapshot: {
      format: WB_THEME_FORMAT,
      version: WB_THEME_VERSION,
      name,
      ...(author ? { author } : {}),
      ...(description ? { description } : {}),
      exportedAt,
      appearance,
    },
    strippedFields,
  };
}
