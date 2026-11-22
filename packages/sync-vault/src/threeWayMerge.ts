import type {
  MachineScopedEntry,
  SyncDomainKey,
  SyncDomainMatrix
} from "./types.js";
import { DEFAULT_SYNC_DOMAIN_MATRIX } from "./types.js";

export interface MergeableMemoryRecord extends MachineScopedEntry {
  id: string;
  namespace?: string;
  updatedAt: number;
  deletedAt?: number | null;
  [key: string]: unknown;
}

export interface UsageLedgerEntry extends MachineScopedEntry {
  machineId: string;
  entryId: string;
  providerId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  todayTokens?: number;
  weekTokens?: number;
  estimatedCostUsd?: number;
  timestamp?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface SyncConflict {
  path: string;
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
}

export interface ConfigMergeResult {
  merged: Record<string, unknown>;
  conflicts: SyncConflict[];
}

export interface SyncVaultPayload {
  schemaVersion?: number;
  sourceMachineId?: string;
  exportedAt?: number;
  privateMemory?: MergeableMemoryRecord[];
  workspaceMemory?: MergeableMemoryRecord[];
  socialMemory?: MergeableMemoryRecord[];
  commandsAndMcp?: Record<string, unknown> | Array<Record<string, unknown>>;
  plugins?: Array<Record<string, unknown> & MachineScopedEntry>;
  appearancePresets?: Array<Record<string, unknown> & MachineScopedEntry>;
  usageLedger?: UsageLedgerEntry[];
  config?: Record<string, unknown>;
}

const SYNC_DOMAIN_KEYS: readonly SyncDomainKey[] = [
  "privateMemory",
  "workspaceMemory",
  "socialMemory",
  "commandsAndMcp",
  "plugins",
  "appearancePresets",
  "usageLedger"
];

function effectiveMemoryTimestamp(record: MergeableMemoryRecord): number {
  return Math.max(record.updatedAt, record.deletedAt ?? 0);
}

function pickPreferredMemoryRecord<T extends MergeableMemoryRecord>(
  current: T,
  candidate: T
): T {
  const currentTs = effectiveMemoryTimestamp(current);
  const candidateTs = effectiveMemoryTimestamp(candidate);

  if (candidateTs > currentTs) {
    return candidate;
  }
  if (currentTs > candidateTs) {
    return current;
  }

  // Same effective timestamp: soft-delete tombstone MUST win to prevent resurrection.
  const currentDeleted = current.deletedAt != null;
  const candidateDeleted = candidate.deletedAt != null;
  if (candidateDeleted !== currentDeleted) {
    return candidateDeleted ? candidate : current;
  }

  if (candidateDeleted && currentDeleted) {
    const curDel = current.deletedAt ?? 0;
    const candDel = candidate.deletedAt ?? 0;
    if (candDel !== curDel) {
      return candDel > curDel ? candidate : current;
    }
  }

  // Deterministic commutative tie-breaker for idempotency.
  return JSON.stringify(candidate) >= JSON.stringify(current)
    ? candidate
    : current;
}

/**
 * Idempotently merges two memory record sets keyed by ULID `id`.
 * Chooses the newer `updatedAt` revision and propagates `deletedAt` soft-delete
 * tombstones so deleted entries cannot be resurrected by stale replicas.
 */
export function mergeMemoryRecords<T extends MergeableMemoryRecord>(
  local: readonly T[],
  remote: readonly T[]
): T[] {
  const byId = new Map<string, T>();

  for (const record of local) {
    const existing = byId.get(record.id);
    byId.set(
      record.id,
      existing ? pickPreferredMemoryRecord(existing, record) : structuredClone(record)
    );
  }

  for (const record of remote) {
    const existing = byId.get(record.id);
    byId.set(
      record.id,
      existing ? pickPreferredMemoryRecord(existing, record) : structuredClone(record)
    );
  }

  return Array.from(byId.values()).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

function usageLedgerTimestamp(entry: UsageLedgerEntry): number {
  return entry.updatedAt ?? entry.timestamp ?? 0;
}

/**
 * Deduplicates usage ledger entries by composite `(machineId, entryId)` key.
 * Prevents duplicate token/cost accumulation across multi-machine sync restores
 * (aligned with Magpie #6987).
 */
export function mergeUsageLedger<T extends UsageLedgerEntry>(
  local: readonly T[],
  remote: readonly T[]
): T[] {
  const byCompositeKey = new Map<string, T>();

  const ingest = (entry: T): void => {
    const compositeKey = JSON.stringify([entry.machineId, entry.entryId]);
    const existing = byCompositeKey.get(compositeKey);
    if (!existing) {
      byCompositeKey.set(compositeKey, structuredClone(entry));
      return;
    }
    if (usageLedgerTimestamp(entry) > usageLedgerTimestamp(existing)) {
      byCompositeKey.set(compositeKey, structuredClone(entry));
    }
  };

  for (const item of local) ingest(item);
  for (const item of remote) ingest(item);

  return Array.from(byCompositeKey.values()).sort((a, b) => {
    const tsDiff = usageLedgerTimestamp(a) - usageLedgerTimestamp(b);
    if (tsDiff !== 0) return tsDiff;
    if (a.machineId !== b.machineId) {
      return a.machineId < b.machineId ? -1 : 1;
    }
    return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

function mergeConfigRecursive(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  pathPrefix: string,
  conflicts: SyncConflict[]
): Record<string, unknown> {
  const keys = new Set<string>([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote)
  ]);
  const merged: Record<string, unknown> = {};

  for (const key of keys) {
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    const bVal = base[key];
    const lVal = local[key];
    const rVal = remote[key];

    if (deepEqual(lVal, rVal)) {
      if (lVal !== undefined) {
        merged[key] = cloneValue(lVal);
      }
      continue;
    }

    if (deepEqual(lVal, bVal)) {
      if (rVal !== undefined) {
        merged[key] = cloneValue(rVal);
      }
      continue;
    }

    if (deepEqual(rVal, bVal)) {
      if (lVal !== undefined) {
        merged[key] = cloneValue(lVal);
      }
      continue;
    }

    // Both sides changed this key differently.
    if (
      isPlainObject(lVal) &&
      isPlainObject(rVal) &&
      (bVal === undefined || isPlainObject(bVal))
    ) {
      merged[key] = mergeConfigRecursive(
        isPlainObject(bVal) ? bVal : {},
        lVal,
        rVal,
        fullPath,
        conflicts
      );
      continue;
    }

    conflicts.push({
      path: fullPath,
      baseValue: cloneValue(bVal),
      localValue: cloneValue(lVal),
      remoteValue: cloneValue(rVal)
    });
    if (lVal !== undefined) {
      merged[key] = cloneValue(lVal);
    }
  }

  return merged;
}

/**
 * Performs a 3-way merge of structured configuration objects.
 * Automatically merges non-conflicting fields and surfaces dual-modified differing
 * fields in `conflicts` without silently overwriting.
 */
export function mergeConfigObject(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>
): ConfigMergeResult {
  const conflicts: SyncConflict[] = [];
  const merged = mergeConfigRecursive(base, local, remote, "", conflicts);
  return { merged, conflicts };
}

function isMachineScopedAllowed(
  entry: unknown,
  machineId: string | undefined
): boolean {
  if (!isPlainObject(entry)) {
    return true;
  }
  if (entry["local"] === true) {
    return false;
  }
  const allowed = entry["allowedMachines"];
  if (Array.isArray(allowed)) {
    if (allowed.length === 0) {
      return false;
    }
    if (machineId !== undefined && !allowed.includes(machineId)) {
      return false;
    }
  }
  return true;
}

function filterMachineScopedValue(
  value: unknown,
  machineId: string | undefined
): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      if (!isMachineScopedAllowed(item, machineId)) {
        continue;
      }
      out.push(filterMachineScopedValue(item, machineId));
    }
    return out;
  }

  if (isPlainObject(value)) {
    if (!isMachineScopedAllowed(value, machineId)) {
      return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      if (!isMachineScopedAllowed(child, machineId)) {
        continue;
      }
      const filteredChild = filterMachineScopedValue(child, machineId);
      if (filteredChild !== undefined) {
        out[key] = filteredChild;
      }
    }
    return out;
  }

  return value;
}

function resolveMatrix(
  matrix?: Partial<SyncDomainMatrix>
): SyncDomainMatrix {
  if (!matrix) return DEFAULT_SYNC_DOMAIN_MATRIX;
  return {
    privateMemory: matrix.privateMemory ?? DEFAULT_SYNC_DOMAIN_MATRIX.privateMemory,
    workspaceMemory:
      matrix.workspaceMemory ?? DEFAULT_SYNC_DOMAIN_MATRIX.workspaceMemory,
    socialMemory: matrix.socialMemory ?? DEFAULT_SYNC_DOMAIN_MATRIX.socialMemory,
    commandsAndMcp:
      matrix.commandsAndMcp ?? DEFAULT_SYNC_DOMAIN_MATRIX.commandsAndMcp,
    plugins: matrix.plugins ?? DEFAULT_SYNC_DOMAIN_MATRIX.plugins,
    appearancePresets:
      matrix.appearancePresets ?? DEFAULT_SYNC_DOMAIN_MATRIX.appearancePresets,
    usageLedger: matrix.usageLedger ?? DEFAULT_SYNC_DOMAIN_MATRIX.usageLedger
  };
}

function filterPayloadByDirection(
  payload: SyncVaultPayload,
  matrix: Partial<SyncDomainMatrix>,
  direction: "upload" | "download",
  machineId: string | undefined
): SyncVaultPayload {
  const resolved = resolveMatrix(matrix);
  const filtered: SyncVaultPayload = {};

  if (payload.schemaVersion !== undefined) {
    filtered.schemaVersion = payload.schemaVersion;
  }
  if (payload.sourceMachineId !== undefined) {
    filtered.sourceMachineId = payload.sourceMachineId;
  }
  if (payload.exportedAt !== undefined) {
    filtered.exportedAt = payload.exportedAt;
  }

  for (const domain of SYNC_DOMAIN_KEYS) {
    const entrySwitch = resolved[domain];
    if (!entrySwitch[direction]) {
      continue;
    }
    const domainValue = payload[domain];
    if (domainValue === undefined) {
      continue;
    }
    const nextValue = filterMachineScopedValue(domainValue, machineId);
    if (nextValue !== undefined) {
      (filtered as Record<string, unknown>)[domain] = nextValue;
    }
  }

  if (payload.config !== undefined) {
    const nextConfig = filterMachineScopedValue(payload.config, machineId);
    if (isPlainObject(nextConfig)) {
      filtered.config = nextConfig;
    }
  }

  return filtered;
}

/**
 * Filters an outbound sync payload according to the 7-domain `upload` matrix
 * and strips entries marked `local: true` or restricting `allowedMachines` away from `targetMachineId`.
 */
export function filterOutboundPayload(
  payload: SyncVaultPayload,
  matrix: Partial<SyncDomainMatrix>,
  targetMachineId?: string
): SyncVaultPayload {
  return filterPayloadByDirection(payload, matrix, "upload", targetMachineId);
}

/**
 * Filters an inbound sync payload according to the 7-domain `download` matrix
 * and skips entries marked `local: true` or not whitelisted for `currentMachineId`.
 */
export function filterInboundPayload(
  payload: SyncVaultPayload,
  matrix: Partial<SyncDomainMatrix>,
  currentMachineId: string
): SyncVaultPayload {
  return filterPayloadByDirection(payload, matrix, "download", currentMachineId);
}

export interface FullPayloadMergeResult {
  merged: SyncVaultPayload;
  conflicts: SyncConflict[];
}

/**
 * Merges a local sync payload with a downloaded remote payload across all 7 domains.
 */
export function mergeSyncPayloads(
  local: SyncVaultPayload,
  remote: SyncVaultPayload,
  baseConfig: Record<string, unknown> = {}
): FullPayloadMergeResult {
  const merged: SyncVaultPayload = {
    schemaVersion: Math.max(local.schemaVersion ?? 1, remote.schemaVersion ?? 1),
    sourceMachineId: local.sourceMachineId ?? remote.sourceMachineId,
    exportedAt: Math.max(local.exportedAt ?? 0, remote.exportedAt ?? 0)
  };

  if (local.privateMemory !== undefined || remote.privateMemory !== undefined) {
    merged.privateMemory = mergeMemoryRecords(
      local.privateMemory ?? [],
      remote.privateMemory ?? []
    );
  }
  if (local.workspaceMemory !== undefined || remote.workspaceMemory !== undefined) {
    merged.workspaceMemory = mergeMemoryRecords(
      local.workspaceMemory ?? [],
      remote.workspaceMemory ?? []
    );
  }
  if (local.socialMemory !== undefined || remote.socialMemory !== undefined) {
    merged.socialMemory = mergeMemoryRecords(
      local.socialMemory ?? [],
      remote.socialMemory ?? []
    );
  }
  if (local.usageLedger !== undefined || remote.usageLedger !== undefined) {
    merged.usageLedger = mergeUsageLedger(
      local.usageLedger ?? [],
      remote.usageLedger ?? []
    );
  }

  const conflicts: SyncConflict[] = [];

  if (
    isPlainObject(local.commandsAndMcp) ||
    isPlainObject(remote.commandsAndMcp)
  ) {
    const cmdMerge = mergeConfigObject(
      {},
      isPlainObject(local.commandsAndMcp) ? local.commandsAndMcp : {},
      isPlainObject(remote.commandsAndMcp) ? remote.commandsAndMcp : {}
    );
    merged.commandsAndMcp = cmdMerge.merged;
    for (const c of cmdMerge.conflicts) {
      conflicts.push({ ...c, path: `commandsAndMcp.${c.path}` });
    }
  } else if (
    Array.isArray(local.commandsAndMcp) ||
    Array.isArray(remote.commandsAndMcp)
  ) {
    merged.commandsAndMcp = mergeIdKeyedRecordArrays(
      Array.isArray(local.commandsAndMcp) ? local.commandsAndMcp : [],
      Array.isArray(remote.commandsAndMcp) ? remote.commandsAndMcp : []
    );
  }

  if (local.plugins !== undefined || remote.plugins !== undefined) {
    merged.plugins = mergeIdKeyedRecordArrays(
      local.plugins ?? [],
      remote.plugins ?? []
    );
  }

  if (
    local.appearancePresets !== undefined ||
    remote.appearancePresets !== undefined
  ) {
    merged.appearancePresets = mergeIdKeyedRecordArrays(
      local.appearancePresets ?? [],
      remote.appearancePresets ?? []
    );
  }

  if (local.config !== undefined || remote.config !== undefined) {
    const cfgMerge = mergeConfigObject(
      baseConfig,
      local.config ?? {},
      remote.config ?? {}
    );
    merged.config = cfgMerge.merged;
    for (const c of cfgMerge.conflicts) {
      conflicts.push({ ...c, path: `config.${c.path}` });
    }
  }

  return { merged, conflicts };
}

function mergeIdKeyedRecordArrays<T extends Record<string, unknown>>(
  local: readonly T[],
  remote: readonly T[]
): T[] {
  const byKey = new Map<string, T>();
  const getKey = (item: T): string => {
    const id = item["id"] ?? item["packageName"] ?? item["name"];
    return typeof id === "string" && id.length > 0
      ? id
      : JSON.stringify(item);
  };
  for (const item of local) {
    byKey.set(getKey(item), structuredClone(item));
  }
  for (const item of remote) {
    const key = getKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, structuredClone(item));
      continue;
    }
    const existingTs =
      typeof existing["updatedAt"] === "number" ? existing["updatedAt"] : 0;
    const itemTs =
      typeof item["updatedAt"] === "number" ? item["updatedAt"] : 0;
    if (itemTs >= existingTs) {
      byKey.set(key, structuredClone(item));
    }
  }
  return Array.from(byKey.values());
}
