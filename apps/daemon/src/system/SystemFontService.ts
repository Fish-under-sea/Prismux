import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_FONT_CACHE_TTL_MS = 5 * 60 * 1000;
const FONT_EXTS = new Set<string>([".ttf", ".otf", ".ttc", ".otc", ".woff2"]);

export interface SystemFontDiscoveryResult {
  fonts: string[];
  count: number;
  cached: boolean;
  source: string;
  scannedAt: number;
  durationMs: number;
}

export interface SystemFontServiceOptions {
  cacheTtlMs?: number;
  loader?: () => Promise<{ fonts: string[]; source: string }>;
}

const REGISTRY_FONT_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts"
] as const;

const FONT_STYLE_SUFFIX_RE =
  /\s+(?:Regular|Bold|Italic|Bold\s+Italic|Oblique|Bold\s+Oblique|Roman|Medium|Semibold|SemiBold|DemiBold|Light|ExtraLight|Thin|Black|Heavy|Condensed)$/i;

export function parseWindowsRegistryFontOutput(stdout: string): string[] {
  const results: string[] = [];
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const match = /^\s{2,}(.+?)\s+REG_(?:SZ|EXPAND_SZ|MULTI_SZ)\s+.+$/i.exec(
      rawLine
    );
    if (!match || !match[1]) {
      continue;
    }

    let label = match[1].trim();
    // Strip trailing "(TrueType)", "(OpenType)", "(All res)", etc.
    label = label.replace(/\s*\([^)]*\)\s*$/g, "").trim();
    if (label.length === 0 || label.startsWith("@")) {
      continue;
    }

    const parts = label.split(/\s*&\s*/);
    for (const part of parts) {
      let clean = part.trim();
      // Strip optional single trailing style suffix when a non-empty base remains
      const stripped = clean.replace(FONT_STYLE_SUFFIX_RE, "").trim();
      if (stripped.length >= 2) {
        clean = stripped;
      }
      if (clean.length > 0 && !clean.startsWith("@")) {
        results.push(clean);
      }
    }
  }

  return results;
}

export function normalizeAndDedupeFontNames(rawFonts: readonly string[]): string[] {
  const byLower = new Map<string, string>();
  for (const raw of rawFonts) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("@")) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!byLower.has(key)) {
      byLower.set(key, trimmed);
    }
  }
  return [...byLower.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

async function scanFontFilesInDirs(dirs: readonly string[]): Promise<string[]> {
  const collected: string[] = [];
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const ext = extname(entry.name).toLowerCase();
        if (!FONT_EXTS.has(ext)) {
          continue;
        }
        const rawStem = basename(entry.name, ext)
          .replace(/[_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (rawStem.length > 0) {
          collected.push(rawStem);
        }
      }
    } catch {
      // ignore missing/unreadable font dir
    }
  }
  return collected;
}

async function defaultDiscoverSystemFonts(): Promise<{
  fonts: string[];
  source: string;
}> {
  if (process.platform === "win32") {
    const regOutputs = await Promise.all(
      REGISTRY_FONT_KEYS.map(async (key) => {
        try {
          const { stdout } = await execFileAsync("reg.exe", ["query", key], {
            timeout: 3_000,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024
          });
          return parseWindowsRegistryFontOutput(stdout);
        } catch {
          return [];
        }
      })
    );
    const mergedReg = normalizeAndDedupeFontNames(regOutputs.flat());
    if (mergedReg.length > 0) {
      return { fonts: mergedReg, source: "windows-registry" };
    }

    const winDir = process.env.WINDIR ?? "C:\\Windows";
    const localAppData = process.env.LOCALAPPDATA;
    const dirs = [join(winDir, "Fonts")];
    if (localAppData) {
      dirs.push(join(localAppData, "Microsoft", "Windows", "Fonts"));
    }
    return {
      fonts: normalizeAndDedupeFontNames(await scanFontFilesInDirs(dirs)),
      source: "windows-font-dir"
    };
  }

  if (process.platform === "darwin") {
    const home = process.env.HOME;
    const dirs = ["/System/Library/Fonts", "/Library/Fonts"];
    if (home) {
      dirs.push(join(home, "Library", "Fonts"));
    }
    return {
      fonts: normalizeAndDedupeFontNames(await scanFontFilesInDirs(dirs)),
      source: "macos-font-dir"
    };
  }

  try {
    const { stdout } = await execFileAsync("fc-list", [":", "family"], {
      timeout: 3_000,
      maxBuffer: 4 * 1024 * 1024
    });
    const families = stdout
      .split(/\r?\n/)
      .flatMap((line) => line.split(","))
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const normalized = normalizeAndDedupeFontNames(families);
    if (normalized.length > 0) {
      return { fonts: normalized, source: "fontconfig" };
    }
  } catch {
    // fallback to directory scan
  }

  const home = process.env.HOME;
  const linuxDirs = ["/usr/share/fonts", "/usr/local/share/fonts"];
  if (home) {
    linuxDirs.push(join(home, ".local", "share", "fonts"), join(home, ".fonts"));
  }
  return {
    fonts: normalizeAndDedupeFontNames(await scanFontFilesInDirs(linuxDirs)),
    source: "linux-font-dir"
  };
}

/**
 * Discovers installed system font families asynchronously with an in-memory TTL
 * cache so HTTP handlers respond rapidly without blocking the event loop.
 */
export class SystemFontService {
  private readonly cacheTtlMs: number;
  private readonly loader: () => Promise<{ fonts: string[]; source: string }>;
  private cachedResult:
    | { fonts: string[]; source: string; scannedAt: number }
    | null = null;
  private inflight: Promise<{ fonts: string[]; source: string }> | null = null;

  constructor(options?: SystemFontServiceOptions) {
    this.cacheTtlMs = Math.max(0, options?.cacheTtlMs ?? DEFAULT_FONT_CACHE_TTL_MS);
    this.loader = options?.loader ?? defaultDiscoverSystemFonts;
  }

  invalidateCache(): void {
    this.cachedResult = null;
  }

  async listFonts(forceRefresh = false): Promise<SystemFontDiscoveryResult> {
    const startedAt = Date.now();
    if (
      !forceRefresh &&
      this.cachedResult !== null &&
      Date.now() - this.cachedResult.scannedAt < this.cacheTtlMs
    ) {
      return {
        fonts: [...this.cachedResult.fonts],
        count: this.cachedResult.fonts.length,
        cached: true,
        source: this.cachedResult.source,
        scannedAt: this.cachedResult.scannedAt,
        durationMs: Math.max(0, Date.now() - startedAt)
      };
    }

    if (this.inflight === null) {
      this.inflight = this.loader().finally(() => {
        this.inflight = null;
      });
    }

    const loaded = await this.inflight;
    const normalizedFonts = normalizeAndDedupeFontNames(loaded.fonts);
    const scannedAt = Date.now();
    this.cachedResult = {
      fonts: normalizedFonts,
      source: loaded.source,
      scannedAt
    };

    return {
      fonts: [...normalizedFonts],
      count: normalizedFonts.length,
      cached: false,
      source: loaded.source,
      scannedAt,
      durationMs: Math.max(0, Date.now() - startedAt)
    };
  }
}
