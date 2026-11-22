export const MEMORY_KINDS = [
  "episodic",
  "fact",
  "preference",
  "member_profile",
  "handoff_note"
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemoryNamespace =
  | "private/chief"
  | `workspace/${string}`
  | `social/qq-group-${string}`;

export type CallerScope = "owner_chief" | `qq_group:${string}`;

export interface MemoryEntry {
  id: string;
  namespace: MemoryNamespace;
  kind: MemoryKind;
  title: string;
  content: string;
  sourceRef?: string | null;
  importance: number;
  machineId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface MemoryUpsertInput {
  id?: string;
  namespace: MemoryNamespace;
  kind: MemoryKind;
  title: string;
  content: string;
  sourceRef?: string | null;
  importance?: number;
  machineId: string;
}

export interface MemoryQueryRequest {
  callerScope: CallerScope;
  query: string;
  namespaces?: MemoryNamespace[];
  kinds?: MemoryKind[];
  limit?: number;
  mode?: "hybrid" | "fts" | "vector";
}

export interface MemoryQueryHit {
  entry: MemoryEntry;
  score: number;
  matchSource: "fts" | "vector" | "rrf";
}

export interface MemoryQueryResponse {
  hits: MemoryQueryHit[];
  totalCandidates: number;
  degradedToFtsOnly: boolean;
}

export interface ObsidianImportRequest {
  vaultPath: string;
  targetNamespace?: MemoryNamespace;
  dryRun?: boolean;
}

export interface ObsidianImportResult {
  scannedFiles: number;
  importedEntries: number;
  skippedFiles: number;
  warnings: string[];
}

export function isValidMemoryNamespace(value: string): value is MemoryNamespace {
  if (value === "private/chief") {
    return true;
  }
  if (value.startsWith("workspace/") && value.length > "workspace/".length) {
    return true;
  }
  if (
    value.startsWith("social/qq-group-") &&
    value.length > "social/qq-group-".length
  ) {
    return true;
  }
  return false;
}

/**
 * Enforces physical query-level isolation: a `qq_group:<gid>` caller can ONLY
 * access its own `social/qq-group-<gid>` namespace and never `private/chief` or `workspace/*`.
 */
export function isScopeAllowedForNamespace(
  callerScope: CallerScope,
  namespace: MemoryNamespace
): boolean {
  if (callerScope === "owner_chief") {
    return true;
  }
  if (callerScope.startsWith("qq_group:")) {
    const groupId = callerScope.slice("qq_group:".length);
    return groupId.length > 0 && namespace === `social/qq-group-${groupId}`;
  }
  return false;
}
