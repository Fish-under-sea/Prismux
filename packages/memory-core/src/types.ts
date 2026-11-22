import type {
  CallerScope,
  MemoryEntry,
  MemoryKind,
  MemoryNamespace,
  MemoryQueryRequest,
  MemoryQueryResponse,
  MemoryUpsertInput,
  ObsidianImportRequest,
  ObsidianImportResult
} from "@prismux/protocol";

export interface MemoryStoreConfig {
  dbPath: string;
  machineId: string;
  embeddingDimensions: number;
  enableWal: boolean;
}

export interface ListEntriesOptions {
  namespaces?: MemoryNamespace[];
  kinds?: MemoryKind[];
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export interface MemoryStore {
  initialize(): Promise<void>;
  upsert(
    input: MemoryUpsertInput,
    embedding?: Float32Array | number[]
  ): Promise<MemoryEntry>;
  query(
    request: MemoryQueryRequest,
    trustedCallerScope?: CallerScope,
    queryEmbedding?: Float32Array | number[]
  ): Promise<MemoryQueryResponse>;
  softDelete(id: string, deletedAt?: number): Promise<boolean>;
  close(): Promise<void>;
}

export interface ObsidianVaultImporter {
  importVault(request: ObsidianImportRequest): Promise<ObsidianImportResult>;
}
