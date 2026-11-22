import type {
  MemoryEntry,
  MemoryQueryRequest,
  MemoryQueryResponse,
  MemoryUpsertInput,
  ObsidianImportRequest,
  ObsidianImportResult
} from "@prismux/protocol";

export * from "./CollectorAndGuard.js";

export const MEMORY_CORE_MILESTONE = "M2" as const;

export interface MemoryStoreConfig {
  dbPath: string;
  machineId: string;
  embeddingDimensions: number;
  enableWal: boolean;
}

export interface MemoryStore {
  initialize(): Promise<void>;
  upsert(input: MemoryUpsertInput): Promise<MemoryEntry>;
  query(request: MemoryQueryRequest): Promise<MemoryQueryResponse>;
  softDelete(id: string, deletedAt?: number): Promise<boolean>;
  close(): Promise<void>;
}

export interface ObsidianVaultImporter {
  importVault(request: ObsidianImportRequest): Promise<ObsidianImportResult>;
}

/**
 * Milestone M2 skeleton for single-file SQLite WAL + FTS5 + sqlite-vec engine.
 * Zero external PostgreSQL / Qdrant / MinIO / Obsidian client dependencies.
 */
export class SqliteMemoryStoreSkeleton implements MemoryStore {
  readonly config: MemoryStoreConfig;

  constructor(config: MemoryStoreConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    throw new Error(
      `SqliteMemoryStoreSkeleton (${MEMORY_CORE_MILESTONE}) is a M1 scaffold; SQLite WAL + FTS5 + sqlite-vec engine lands in M2.`
    );
  }

  async upsert(_input: MemoryUpsertInput): Promise<MemoryEntry> {
    throw new Error("Memory upsert is implemented in Milestone M2.");
  }

  async query(_request: MemoryQueryRequest): Promise<MemoryQueryResponse> {
    throw new Error("Memory query is implemented in Milestone M2.");
  }

  async softDelete(_id: string, _deletedAt?: number): Promise<boolean> {
    throw new Error("Memory softDelete is implemented in Milestone M2.");
  }

  async close(): Promise<void> {
    return;
  }
}
