import type {
  MemoryEntry,
  MemoryQueryRequest,
  MemoryQueryResponse,
  MemoryUpsertInput
} from "@prismux/protocol";
import type { MemoryStore, MemoryStoreConfig } from "./types.js";

export * from "./types.js";
export * from "./ulid.js";
export * from "./CollectorAndGuard.js";
export * from "./SqliteMemoryStore.js";
export * from "./ObsidianImporter.js";

export const MEMORY_CORE_MILESTONE = "M2" as const;

/**
 * Legacy M1 scaffold kept compatible for callers not yet wired to M2 initialization.
 */
export class SqliteMemoryStoreSkeleton implements MemoryStore {
  readonly config: MemoryStoreConfig;

  constructor(config: MemoryStoreConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    throw new Error(
      `SqliteMemoryStoreSkeleton (${MEMORY_CORE_MILESTONE}) is a M1 scaffold; use SqliteMemoryStore for M2 SQLite WAL + FTS5 + sqlite-vec engine.`
    );
  }

  async upsert(_input: MemoryUpsertInput): Promise<MemoryEntry> {
    throw new Error("Memory upsert is implemented on SqliteMemoryStore in Milestone M2.");
  }

  async query(_request: MemoryQueryRequest): Promise<MemoryQueryResponse> {
    throw new Error("Memory query is implemented on SqliteMemoryStore in Milestone M2.");
  }

  async softDelete(_id: string, _deletedAt?: number): Promise<boolean> {
    throw new Error(
      "Memory softDelete is implemented on SqliteMemoryStore in Milestone M2."
    );
  }

  async close(): Promise<void> {
    return;
  }
}
