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

export const OBSIDIAN_CURATED_KINDS = [
  "preference",
  "decision",
  "project",
  "knowledge",
  "experience"
] as const;

export type ObsidianCuratedKind = (typeof OBSIDIAN_CURATED_KINDS)[number];

export type ObsidianCurationSource = "agent" | "structured-fallback";

export interface ObsidianCuratedItem {
  id: string;
  title: string;
  summary: string;
  kind: ObsidianCuratedKind;
  namespace: MemoryNamespace;
  tags: string[];
  sourceFile: string;
  selected: boolean;
  curationSource: ObsidianCurationSource;
  importance?: number;
  redactedSecretCount?: number;
}

export interface ObsidianImportPlanRequest {
  vaultPath: string;
  namespace?: MemoryNamespace;
  targetNamespace?: MemoryNamespace;
  useAgentCuration?: boolean;
  provider?: string;
  model?: string;
}

export interface ObsidianImportPlanStats {
  scannedFiles: number;
  curatedCount: number;
  deduplicatedCount: number;
  filteredNoiseCount: number;
  redactedSecretCount: number;
  skippedFiles: number;
}

export interface ObsidianImportPlanResponse {
  ok: boolean;
  vaultPath: string;
  defaultNamespace: MemoryNamespace;
  useAgentCuration: boolean;
  curationSource: ObsidianCurationSource;
  curatorLabel?: string;
  items: ObsidianCuratedItem[];
  stats: ObsidianImportPlanStats;
  warnings: string[];
}

export interface ObsidianImportCommitRequest {
  items: ObsidianCuratedItem[];
}

export interface ObsidianImportCommitResponse {
  ok: boolean;
  committedCount: number;
  skippedCount: number;
  redactedSecretCount: number;
  entryIds: string[];
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
