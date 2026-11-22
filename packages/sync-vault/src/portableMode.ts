import { statSync } from "node:fs";
import { join } from "node:path";
import type { PortableModeResolution } from "./types.js";

export interface ResolvePortableDataDirInput {
  executableDir: string;
  defaultDataDir: string;
}

export interface SyncVaultPaths {
  isPortable: boolean;
  dataDir: string;
  dbPath: string;
  cacheDir: string;
  logsDir: string;
  configDir: string;
  credentialsDir: string;
  backupsDir: string;
  syncStatePath: string;
}

/**
 * Detects Magpie-style Portable Mode: if `<executableDir>/data` exists and is a directory,
 * all databases, caches, logs, configs, and credentials converge inside it.
 */
export function resolvePortableDataDir(
  input: ResolvePortableDataDirInput
): PortableModeResolution {
  const candidate = join(input.executableDir, "data");
  try {
    const stat = statSync(candidate);
    if (stat.isDirectory()) {
      return {
        isPortable: true,
        dataDir: candidate
      };
    }
  } catch {
    // Missing or inaccessible `data` directory falls back to standard user dataDir.
  }

  return {
    isPortable: false,
    dataDir: input.defaultDataDir
  };
}

/**
 * Resolves all vault storage paths from a portable/standard mode resolution.
 * In portable mode, 100% of returned paths reside inside `<executableDir>/data/`.
 */
export function resolveVaultPaths(
  resolution: PortableModeResolution
): SyncVaultPaths {
  return {
    isPortable: resolution.isPortable,
    dataDir: resolution.dataDir,
    dbPath: join(resolution.dataDir, "memory.db"),
    cacheDir: join(resolution.dataDir, "cache"),
    logsDir: join(resolution.dataDir, "logs"),
    configDir: join(resolution.dataDir, "config"),
    credentialsDir: join(resolution.dataDir, "credentials"),
    backupsDir: join(resolution.dataDir, "backups"),
    syncStatePath: join(resolution.dataDir, "sync-state.json")
  };
}
