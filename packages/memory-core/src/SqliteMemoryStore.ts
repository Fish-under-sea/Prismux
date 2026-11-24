import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import {
  MEMORY_KINDS,
  isValidMemoryNamespace,
  type CallerScope,
  type MemoryEntry,
  type MemoryKind,
  type MemoryNamespace,
  type MemoryQueryHit,
  type MemoryQueryRequest,
  type MemoryQueryResponse,
  type MemoryUpsertInput
} from "@prismux/protocol";
import { validateTrustedCallerScope } from "./CollectorAndGuard.js";
import {
  loadSqliteVecExtension,
  type SqliteVecCandidateSource,
  type SqliteVecLoadStatus
} from "./sqliteVecResolver.js";
import type { ListEntriesOptions, MemoryStore, MemoryStoreConfig } from "./types.js";
import { generateUlid } from "./ulid.js";

const RRF_K = 60;
const SQLITE_VEC_MAX_K = 4096;

export interface SqliteMemoryStoreConfig extends MemoryStoreConfig {
  /** Whether to attempt loading the `sqlite-vec` extension (default: true). */
  loadVectorExtension?: boolean;
  /** Optional explicit extension shared-library path override (for testing/packaging). */
  vectorExtensionPath?: string;
  /** Optional Electron `resourcesPath` override for packaged resource discovery & tests. */
  resourcesPath?: string | null;
  /** Whether to allow fallback `import("sqlite-vec")` lookup (default: true). */
  allowPackageImport?: boolean;
}

type DbRow = Record<string, SQLOutputValue>;

type ScopeClause =
  | {
      kind: "qq_group";
      groupId: string;
      sql: string;
      params: SQLInputValue[];
    }
  | {
      kind: "owner_chief";
      sql: string;
      params: SQLInputValue[];
    };

function mapRowToMemoryEntry(row: DbRow): MemoryEntry {
  return {
    id: String(row.id),
    namespace: String(row.namespace) as MemoryNamespace,
    kind: String(row.kind) as MemoryKind,
    title: String(row.title),
    content: String(row.content),
    sourceRef: row.source_ref === null || row.source_ref === undefined
      ? null
      : String(row.source_ref),
    importance: Number(row.importance),
    machineId: String(row.machine_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at === null || row.deleted_at === undefined
      ? null
      : Number(row.deleted_at)
  };
}

function toEmbeddingFloat32(
  embedding: Float32Array | number[],
  expectedDims: number
): Float32Array {
  const vec =
    embedding instanceof Float32Array
      ? new Float32Array(embedding)
      : Float32Array.from(embedding);

  if (vec.length !== expectedDims) {
    throw new RangeError(
      `Embedding dimension mismatch: expected ${expectedDims}, received ${vec.length}.`
    );
  }

  for (let i = 0; i < vec.length; i += 1) {
    if (!Number.isFinite(vec[i])) {
      throw new RangeError(`Embedding contains non-finite value at index ${i}.`);
    }
  }
  return vec;
}

function escapeLikePattern(term: string): string {
  return term
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function quoteFts5Term(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

function bm25ToPositiveScore(bm25Rank: number): number {
  if (!Number.isFinite(bm25Rank)) {
    return 0.5;
  }
  // FTS5 bm25() returns negative scores where more negative = stronger match.
  // Logistic transform maps (-inf, +inf) monotonically into (0, 1) with stronger matches -> closer to 1.
  const clamped = Math.max(-50, Math.min(50, bm25Rank));
  return 1 / (1 + Math.exp(clamped));
}

function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      if (db.isTransaction) {
        db.exec("ROLLBACK");
      }
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

/**
 * Single-file SQLite WAL + FTS5 (trigram) + sqlite-vec hybrid memory engine
 * with hardcoded SQL-level physical scope isolation.
 */
export class SqliteMemoryStore implements MemoryStore {
  readonly config: SqliteMemoryStoreConfig;
  private db: DatabaseSync | undefined;
  private vecEnabled = false;
  private vecVersion: string | null = null;
  private vecExtensionPath: string | null = null;
  private vecSource: SqliteVecCandidateSource | null = null;
  private vecLoadError: string | null = null;

  constructor(config: SqliteMemoryStoreConfig) {
    if (!Number.isInteger(config.embeddingDimensions) || config.embeddingDimensions <= 0) {
      throw new RangeError(
        `Invalid embeddingDimensions: ${config.embeddingDimensions}; expected positive integer.`
      );
    }
    this.config = config;
  }

  isVectorSearchEnabled(): boolean {
    return this.vecEnabled;
  }

  getRetrievalMode(): "fts5+sqlite-vec" | "fts5-only" {
    return this.vecEnabled ? "fts5+sqlite-vec" : "fts5-only";
  }

  getVectorExtensionVersion(): string | null {
    return this.vecVersion;
  }

  getVectorExtensionPath(): string | null {
    return this.vecExtensionPath;
  }

  getVectorExtensionStatus(): SqliteVecLoadStatus {
    return {
      loaded: this.vecEnabled,
      mode: this.getRetrievalMode(),
      version: this.vecVersion,
      extensionPath: this.vecExtensionPath,
      source: this.vecSource,
      error: this.vecLoadError
    };
  }

  async initialize(): Promise<void> {
    if (this.db !== undefined) {
      return;
    }

    if (this.config.dbPath !== ":memory:") {
      mkdirSync(dirname(this.config.dbPath), { recursive: true });
    }

    const db = new DatabaseSync(this.config.dbPath, { allowExtension: true });
    try {
      if (this.config.enableWal) {
        db.exec("PRAGMA journal_mode = WAL;");
      }
      db.exec("PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");

      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_entries (
          id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL CHECK (
            namespace = 'private/chief'
            OR namespace LIKE 'workspace/%'
            OR namespace LIKE 'social/qq-group-%'
          ),
          kind TEXT NOT NULL CHECK (
            kind IN ('episodic', 'fact', 'preference', 'member_profile', 'handoff_note')
          ),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          source_ref TEXT,
          importance REAL NOT NULL DEFAULT 0.5,
          machine_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_memory_ns_updated
          ON memory_entries(namespace, updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_memory_ns_source_ref
          ON memory_entries(namespace, source_ref);

        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
          id UNINDEXED,
          namespace UNINDEXED,
          title,
          content,
          tokenize = 'trigram'
        );

        CREATE TABLE IF NOT EXISTS memory_recall_snapshots (
          session_id TEXT NOT NULL,
          caller_scope TEXT NOT NULL,
          query_text TEXT NOT NULL,
          frozen_block TEXT NOT NULL,
          entries_json TEXT NOT NULL,
          revisions_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, caller_scope)
        );
      `);

      this.vecEnabled = false;
      this.vecVersion = null;
      this.vecExtensionPath = null;
      this.vecSource = null;
      this.vecLoadError = null;
      if (this.config.loadVectorExtension !== false) {
        const vecLoad = await loadSqliteVecExtension(db, {
          ...(this.config.vectorExtensionPath !== undefined
            ? { explicitPath: this.config.vectorExtensionPath }
            : {}),
          ...(this.config.resourcesPath !== undefined
            ? { resourcesPath: this.config.resourcesPath }
            : {}),
          ...(this.config.allowPackageImport !== undefined
            ? { allowPackageImport: this.config.allowPackageImport }
            : {})
        });
        if (vecLoad.loaded) {
          try {
            db.exec(
              `CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[${this.config.embeddingDimensions}] distance_metric=cosine)`
            );
            this.vecEnabled = true;
            this.vecVersion = vecLoad.version;
            this.vecExtensionPath = vecLoad.extensionPath;
            this.vecSource = vecLoad.source;
            this.vecLoadError = null;
          } catch (error) {
            this.vecEnabled = false;
            this.vecVersion = null;
            this.vecExtensionPath = null;
            this.vecSource = null;
            this.vecLoadError = `创建 memory_vec 虚拟表失败：${
              error instanceof Error ? error.message : String(error)
            }`;
          }
        } else {
          this.vecLoadError = vecLoad.error;
        }
      } else {
        this.vecLoadError = "已显式禁用 sqlite-vec 扩展加载（loadVectorExtension=false）。";
      }

      this.db = db;
    } catch (error) {
      try {
        if (db.isOpen) {
          db.close();
        }
      } catch {
        // Ignore close error on failed initialization.
      }
      throw error;
    }
  }

  async upsert(
    input: MemoryUpsertInput,
    embedding?: Float32Array | number[]
  ): Promise<MemoryEntry> {
    const db = this.requireDb();

    if (!isValidMemoryNamespace(input.namespace)) {
      throw new Error(`Invalid memory namespace: "${input.namespace}"`);
    }
    if (!MEMORY_KINDS.includes(input.kind)) {
      throw new Error(`Invalid memory kind: "${input.kind}"`);
    }

    const importance = input.importance ?? 0.5;
    if (!Number.isFinite(importance)) {
      throw new RangeError(`Invalid memory importance: ${String(importance)}`);
    }

    const normalizedEmbedding =
      this.vecEnabled && embedding !== undefined
        ? toEmbeddingFloat32(embedding, this.config.embeddingDimensions)
        : undefined;

    const sourceRef =
      input.sourceRef === undefined || input.sourceRef === null || input.sourceRef.length === 0
        ? null
        : input.sourceRef;

    const now = Date.now();

    return runInTransaction(db, () => {
      let existingRow: DbRow | undefined;

      if (input.id !== undefined && input.id.length > 0) {
        existingRow = db
          .prepare(
            "SELECT id, created_at, updated_at FROM memory_entries WHERE id = ? LIMIT 1"
          )
          .get(input.id);
      } else if (sourceRef !== null) {
        existingRow = db
          .prepare(
            "SELECT id, created_at, updated_at FROM memory_entries WHERE namespace = ? AND source_ref = ? LIMIT 1"
          )
          .get(input.namespace, sourceRef);
      }

      const id = existingRow
        ? String(existingRow.id)
        : input.id && input.id.length > 0
          ? input.id
          : generateUlid(now);
      const createdAt = existingRow ? Number(existingRow.created_at) : now;
      const updatedAt = existingRow
        ? Math.max(now, Number(existingRow.updated_at ?? existingRow.created_at))
        : now;

      db.prepare(`
        INSERT INTO memory_entries (
          id, namespace, kind, title, content, source_ref, importance, machine_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(id) DO UPDATE SET
          namespace = excluded.namespace,
          kind = excluded.kind,
          title = excluded.title,
          content = excluded.content,
          source_ref = excluded.source_ref,
          importance = excluded.importance,
          machine_id = excluded.machine_id,
          updated_at = excluded.updated_at,
          deleted_at = NULL
      `).run(
        id,
        input.namespace,
        input.kind,
        input.title,
        input.content,
        sourceRef,
        importance,
        input.machineId,
        createdAt,
        updatedAt
      );

      db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
      db.prepare(
        "INSERT INTO memory_fts (id, namespace, title, content) VALUES (?, ?, ?, ?)"
      ).run(id, input.namespace, input.title, input.content);

      if (this.vecEnabled) {
        db.prepare("DELETE FROM memory_vec WHERE id = ?").run(id);
        if (normalizedEmbedding !== undefined) {
          db.prepare("INSERT INTO memory_vec (id, embedding) VALUES (?, ?)").run(
            id,
            normalizedEmbedding
          );
        }
      }

      return {
        id,
        namespace: input.namespace,
        kind: input.kind,
        title: input.title,
        content: input.content,
        sourceRef,
        importance,
        machineId: input.machineId,
        createdAt,
        updatedAt,
        deletedAt: null
      };
    });
  }

  async softDelete(id: string, deletedAt?: number): Promise<boolean> {
    const db = this.requireDb();
    const ts = deletedAt ?? Date.now();
    if (!Number.isFinite(ts)) {
      throw new RangeError(`Invalid deletedAt timestamp: ${String(deletedAt)}`);
    }

    return runInTransaction(db, () => {
      const result = db
        .prepare(
          "UPDATE memory_entries SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
        )
        .run(ts, ts, id);

      db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
      if (this.vecEnabled) {
        db.prepare("DELETE FROM memory_vec WHERE id = ?").run(id);
      }

      return Number(result.changes) > 0;
    });
  }

  async getById(
    id: string,
    trustedCallerScope: CallerScope
  ): Promise<MemoryEntry | null> {
    const db = this.requireDb();
    const scopeClause = this.buildScopeClause(trustedCallerScope);
    if (scopeClause === null) {
      return null;
    }

    const row = db
      .prepare(
        `SELECT id, namespace, kind, title, content, source_ref, importance, machine_id, created_at, updated_at, deleted_at
         FROM memory_entries m
         WHERE m.id = ? AND ${scopeClause.sql}
         LIMIT 1`
      )
      .get(id, ...scopeClause.params);

    if (!row) {
      return null;
    }
    const entry = mapRowToMemoryEntry(row);
    if (
      scopeClause.kind === "qq_group" &&
      entry.namespace !== `social/qq-group-${scopeClause.groupId}`
    ) {
      return null;
    }
    return entry;
  }

  /**
   * Batch-fetches active memory entries by ID under strict physical scope isolation.
   * For `qq_group:<gid>`, SQL unconditionally binds `namespace = 'social/qq-group-' || ? AND deleted_at IS NULL`.
   */
  async getEntriesByIds(
    ids: readonly string[],
    trustedCallerScope: CallerScope
  ): Promise<MemoryEntry[]> {
    const db = this.requireDb();
    const uniqueIds = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
    if (uniqueIds.length === 0) {
      return [];
    }

    const scopeClause = this.buildScopeClause(trustedCallerScope, undefined, false);
    if (scopeClause === null) {
      return [];
    }

    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT id, namespace, kind, title, content, source_ref, importance, machine_id, created_at, updated_at, deleted_at
         FROM memory_entries m
         WHERE m.id IN (${placeholders})
           AND ${scopeClause.sql}`
      )
      .all(...uniqueIds, ...scopeClause.params);

    const entries = rows.map(mapRowToMemoryEntry);
    if (scopeClause.kind === "qq_group") {
      const expectedNamespace = `social/qq-group-${scopeClause.groupId}`;
      return entries.filter((entry) => entry.namespace === expectedNamespace);
    }
    return entries;
  }

  /**
   * Persists a session-level frozen prompt-cache recall snapshot keyed strictly by `(sessionId, callerScope)`.
   */
  saveRecallSnapshotRecord(record: {
    sessionId: string;
    callerScope: CallerScope;
    queryText: string;
    frozenBlock: string;
    entriesJson: string;
    revisionsJson: string;
    createdAt: number;
    updatedAt: number;
  }): void {
    const db = this.requireDb();
    const verifiedScope = validateTrustedCallerScope(record.callerScope);
    db.prepare(`
      INSERT INTO memory_recall_snapshots (
        session_id, caller_scope, query_text, frozen_block, entries_json, revisions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, caller_scope) DO UPDATE SET
        query_text = excluded.query_text,
        frozen_block = excluded.frozen_block,
        entries_json = excluded.entries_json,
        revisions_json = excluded.revisions_json,
        updated_at = excluded.updated_at
    `).run(
      record.sessionId,
      verifiedScope,
      record.queryText,
      record.frozenBlock,
      record.entriesJson,
      record.revisionsJson,
      record.createdAt,
      record.updatedAt
    );
  }

  /**
   * Loads a persisted recall snapshot strictly bound to `(sessionId, trustedCallerScope)`.
   */
  loadRecallSnapshotRecord(
    sessionId: string,
    trustedCallerScope: CallerScope
  ): {
    sessionId: string;
    callerScope: CallerScope;
    queryText: string;
    frozenBlock: string;
    entriesJson: string;
    revisionsJson: string;
    createdAt: number;
    updatedAt: number;
  } | null {
    const db = this.requireDb();
    const verifiedScope = validateTrustedCallerScope(trustedCallerScope);
    const row = db
      .prepare(
        `SELECT session_id, caller_scope, query_text, frozen_block, entries_json, revisions_json, created_at, updated_at
         FROM memory_recall_snapshots
         WHERE session_id = ? AND caller_scope = ?
         LIMIT 1`
      )
      .get(sessionId, verifiedScope);
    if (!row) {
      return null;
    }
    return {
      sessionId: String(row.session_id),
      callerScope: validateTrustedCallerScope(String(row.caller_scope)),
      queryText: String(row.query_text),
      frozenBlock: String(row.frozen_block),
      entriesJson: String(row.entries_json),
      revisionsJson: String(row.revisions_json),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at)
    };
  }

  deleteRecallSnapshotRecord(
    sessionId: string,
    trustedCallerScope: CallerScope
  ): boolean {
    const db = this.requireDb();
    const verifiedScope = validateTrustedCallerScope(trustedCallerScope);
    const res = db
      .prepare(
        "DELETE FROM memory_recall_snapshots WHERE session_id = ? AND caller_scope = ?"
      )
      .run(sessionId, verifiedScope);
    return Number(res.changes) > 0;
  }

  async listEntries(
    trustedCallerScope: CallerScope,
    options?: ListEntriesOptions
  ): Promise<MemoryEntry[]> {
    const db = this.requireDb();
    const scopeClause = this.buildScopeClause(
      trustedCallerScope,
      options?.namespaces,
      options?.includeDeleted ?? false
    );
    if (scopeClause === null) {
      return [];
    }

    const kindClause = this.buildKindClause(options?.kinds);
    if (kindClause === null) {
      return [];
    }

    const limit = Math.max(1, Math.min(1000, Math.floor(options?.limit ?? 100)));
    const offset = Math.max(0, Math.floor(options?.offset ?? 0));

    const rows = db
      .prepare(
        `SELECT id, namespace, kind, title, content, source_ref, importance, machine_id, created_at, updated_at, deleted_at
         FROM memory_entries m
         WHERE ${scopeClause.sql}
           ${kindClause.sql}
         ORDER BY m.updated_at DESC, m.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...scopeClause.params, ...kindClause.params, limit, offset);

    const entries = rows.map(mapRowToMemoryEntry);
    if (scopeClause.kind === "qq_group") {
      const expectedNamespace = `social/qq-group-${scopeClause.groupId}`;
      return entries.filter((entry) => entry.namespace === expectedNamespace);
    }
    return entries;
  }

  async query(
    request: MemoryQueryRequest,
    trustedCallerScope?: CallerScope,
    queryEmbedding?: Float32Array | number[]
  ): Promise<MemoryQueryResponse> {
    const db = this.requireDb();

    // Transport-injected trustedCallerScope always overrides payload-level fields.
    const rawScope =
      trustedCallerScope ??
      (request as { _callerScope?: CallerScope })._callerScope ??
      request.callerScope;
    const scopeClause = this.buildScopeClause(rawScope, request.namespaces);
    const mode = request.mode ?? "hybrid";
    const canRunVector =
      this.vecEnabled && queryEmbedding !== undefined && mode !== "fts";

    if (scopeClause === null) {
      return {
        hits: [],
        totalCandidates: 0,
        degradedToFtsOnly: !canRunVector
      };
    }

    const kindClause = this.buildKindClause(request.kinds);
    if (kindClause === null) {
      return {
        hits: [],
        totalCandidates: 0,
        degradedToFtsOnly: !canRunVector
      };
    }

    const limit = Math.max(1, Math.min(200, Math.floor(request.limit ?? 10)));
    const candidateLimit = Math.min(SQLITE_VEC_MAX_K, Math.max(limit * 10, 100));
    const cleanedQuery = request.query.replace(/\0/g, "").trim();

    let validatedQueryVec: Float32Array | undefined;
    if (canRunVector && queryEmbedding !== undefined) {
      validatedQueryVec = toEmbeddingFloat32(
        queryEmbedding,
        this.config.embeddingDimensions
      );
    }

    if (canRunVector && validatedQueryVec !== undefined) {
      const vecHits = this.executeVectorQuery(
        db,
        validatedQueryVec,
        scopeClause,
        kindClause,
        candidateLimit
      );

      if (mode === "vector" || cleanedQuery.length === 0) {
        const sliced = this.enforceScopeFilter(vecHits, scopeClause).slice(0, limit);
        return {
          hits: sliced,
          totalCandidates: vecHits.length,
          degradedToFtsOnly: false
        };
      }

      const ftsHits = this.executeLexicalQuery(
        db,
        cleanedQuery,
        scopeClause,
        kindClause,
        candidateLimit
      );

      const fused = this.fuseRrf(ftsHits, vecHits);
      const safeFused = this.enforceScopeFilter(fused, scopeClause);
      return {
        hits: safeFused.slice(0, limit),
        totalCandidates: safeFused.length,
        degradedToFtsOnly: false
      };
    }

    const lexicalHits =
      cleanedQuery.length > 0
        ? this.executeLexicalQuery(
            db,
            cleanedQuery,
            scopeClause,
            kindClause,
            candidateLimit
          )
        : [];
    const safeLexical = this.enforceScopeFilter(lexicalHits, scopeClause);

    return {
      hits: safeLexical.slice(0, limit),
      totalCandidates: safeLexical.length,
      degradedToFtsOnly: true
    };
  }

  async close(): Promise<void> {
    if (this.db !== undefined) {
      if (this.db.isOpen) {
        this.db.close();
      }
      this.db = undefined;
      this.vecEnabled = false;
      this.vecVersion = null;
      this.vecExtensionPath = null;
      this.vecSource = null;
      this.vecLoadError = null;
    }
  }

  private requireDb(): DatabaseSync {
    if (this.db === undefined || !this.db.isOpen) {
      throw new Error(
        "SqliteMemoryStore is not initialized. Call initialize() before querying or writing."
      );
    }
    return this.db;
  }

  private buildScopeClause(
    callerScope: CallerScope,
    requestedNamespaces?: MemoryNamespace[],
    includeDeleted = false
  ): ScopeClause | null {
    const verifiedScope = validateTrustedCallerScope(callerScope);
    const deletedFilter = includeDeleted ? "" : " AND m.deleted_at IS NULL";

    if (verifiedScope.startsWith("qq_group:")) {
      const groupId = verifiedScope.slice("qq_group:".length);
      // Hardcoded physical SQL isolation: qq_group callers can NEVER query
      // private/chief, workspace/*, or other groups regardless of request.namespaces.
      return {
        kind: "qq_group",
        groupId,
        sql: `m.namespace = 'social/qq-group-' || ?${deletedFilter}`,
        params: [groupId]
      };
    }

    if (requestedNamespaces !== undefined && requestedNamespaces.length > 0) {
      const validNamespaces = [
        ...new Set(requestedNamespaces.filter((ns) => isValidMemoryNamespace(ns)))
      ];
      if (validNamespaces.length === 0) {
        return null;
      }
      const placeholders = validNamespaces.map(() => "?").join(", ");
      return {
        kind: "owner_chief",
        sql: `m.namespace IN (${placeholders})${deletedFilter}`,
        params: validNamespaces
      };
    }

    return {
      kind: "owner_chief",
      sql: includeDeleted ? "1 = 1" : "m.deleted_at IS NULL",
      params: []
    };
  }

  private buildKindClause(
    kinds?: MemoryKind[]
  ): { sql: string; params: SQLInputValue[] } | null {
    if (kinds === undefined || kinds.length === 0) {
      return { sql: "", params: [] };
    }
    const validKinds = [...new Set(kinds.filter((k) => MEMORY_KINDS.includes(k)))];
    if (validKinds.length === 0) {
      return null;
    }
    const placeholders = validKinds.map(() => "?").join(", ");
    return {
      sql: `AND m.kind IN (${placeholders})`,
      params: validKinds
    };
  }

  private executeLexicalQuery(
    db: DatabaseSync,
    cleanedQuery: string,
    scopeClause: ScopeClause,
    kindClause: { sql: string; params: SQLInputValue[] },
    candidateLimit: number
  ): MemoryQueryHit[] {
    const terms = cleanedQuery.split(/\s+/).filter((t) => t.length > 0);
    if (terms.length === 0) {
      return [];
    }

    const allSupportTrigram = terms.every((term) => [...term].length >= 3);
    if (allSupportTrigram) {
      const quoted = terms.map(quoteFts5Term);
      const runFts = (matchExpr: string): DbRow[] =>
        db
          .prepare(
            `SELECT
               m.id, m.namespace, m.kind, m.title, m.content, m.source_ref,
               m.importance, m.machine_id, m.created_at, m.updated_at, m.deleted_at,
               bm25(memory_fts) AS bm25_rank
             FROM memory_fts
             INNER JOIN memory_entries m ON m.id = memory_fts.id
             WHERE memory_fts MATCH ?
               AND ${scopeClause.sql}
               ${kindClause.sql}
             ORDER BY bm25_rank ASC, m.importance DESC, m.updated_at DESC
             LIMIT ?`
          )
          .all(matchExpr, ...scopeClause.params, ...kindClause.params, candidateLimit);

      let rows = runFts(quoted.join(" AND "));
      if (rows.length === 0 && quoted.length > 1) {
        rows = runFts(quoted.join(" OR "));
      }

      return rows.map((row) => ({
        entry: mapRowToMemoryEntry(row),
        score: bm25ToPositiveScore(Number(row.bm25_rank)),
        matchSource: "fts"
      }));
    }

    // Short-term fallback (< 3 Unicode codepoints): parameterized LIKE with ESCAPE '\'.
    const termPredicates = terms.map(
      () => "(m.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')"
    );
    const termParams: SQLInputValue[] = [];
    for (const term of terms) {
      const pattern = `%${escapeLikePattern(term)}%`;
      termParams.push(pattern, pattern);
    }

    const runLike = (joiner: "AND" | "OR"): DbRow[] => {
      const matchCountExpr =
        joiner === "OR"
          ? `(${termPredicates.map((p) => `CASE WHEN ${p} THEN 1 ELSE 0 END`).join(" + ")})`
          : `${terms.length}`;
      const selectParams = joiner === "OR" ? termParams : [];

      return db
        .prepare(
          `SELECT
             m.id, m.namespace, m.kind, m.title, m.content, m.source_ref,
             m.importance, m.machine_id, m.created_at, m.updated_at, m.deleted_at,
             ${matchCountExpr} AS matched_terms
           FROM memory_entries m
           WHERE (${termPredicates.join(` ${joiner} `)})
             AND ${scopeClause.sql}
             ${kindClause.sql}
           ORDER BY matched_terms DESC, m.importance DESC, m.updated_at DESC
           LIMIT ?`
        )
        .all(
          ...selectParams,
          ...termParams,
          ...scopeClause.params,
          ...kindClause.params,
          candidateLimit
        );
    };

    let rows = runLike("AND");
    if (rows.length === 0 && terms.length > 1) {
      rows = runLike("OR");
    }

    return rows.map((row) => {
      const entry = mapRowToMemoryEntry(row);
      const matched = Number(row.matched_terms ?? 1);
      const termRatio = matched / terms.length;
      return {
        entry,
        score: Math.min(1, termRatio * 0.8 + Math.max(0, Math.min(1, entry.importance)) * 0.2),
        matchSource: "fts"
      };
    });
  }

  private executeVectorQuery(
    db: DatabaseSync,
    queryVec: Float32Array,
    scopeClause: ScopeClause,
    kindClause: { sql: string; params: SQLInputValue[] },
    candidateLimit: number
  ): MemoryQueryHit[] {
    const countRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM memory_vec")
      .get();
    const totalVecRows = Number(countRow?.cnt ?? 0);
    if (totalVecRows === 0) {
      return [];
    }

    const knnK = Math.min(SQLITE_VEC_MAX_K, Math.max(candidateLimit, totalVecRows));
    let rows = db
      .prepare(
        `SELECT
           m.id, m.namespace, m.kind, m.title, m.content, m.source_ref,
           m.importance, m.machine_id, m.created_at, m.updated_at, m.deleted_at,
           v.distance AS vec_distance
         FROM memory_vec v
         INNER JOIN memory_entries m ON m.id = v.id
         WHERE v.embedding MATCH ? AND v.k = ?
           AND ${scopeClause.sql}
           ${kindClause.sql}
         ORDER BY COALESCE(v.distance, 2.0) ASC, m.importance DESC, m.updated_at DESC
         LIMIT ?`
      )
      .all(queryVec, knnK, ...scopeClause.params, ...kindClause.params, candidateLimit);

    // If the global vector index has >4096 rows (sqlite-vec k cap) and a tightly scoped
    // namespace filter left fewer rows than requested, scan the scoped subset directly.
    if (totalVecRows > SQLITE_VEC_MAX_K && rows.length < candidateLimit) {
      rows = db
        .prepare(
          `SELECT
             m.id, m.namespace, m.kind, m.title, m.content, m.source_ref,
             m.importance, m.machine_id, m.created_at, m.updated_at, m.deleted_at,
             vec_distance_cosine(v.embedding, ?) AS vec_distance
           FROM memory_vec v
           INNER JOIN memory_entries m ON m.id = v.id
           WHERE ${scopeClause.sql}
             ${kindClause.sql}
           ORDER BY COALESCE(vec_distance, 2.0) ASC, m.importance DESC, m.updated_at DESC
           LIMIT ?`
        )
        .all(queryVec, ...scopeClause.params, ...kindClause.params, candidateLimit);
    }

    return rows.map((row) => {
      const distance =
        row.vec_distance === null || row.vec_distance === undefined
          ? 2.0
          : Number(row.vec_distance);
      return {
        entry: mapRowToMemoryEntry(row),
        score: 1 / (1 + Math.max(0, distance)),
        matchSource: "vector"
      };
    });
  }

  private fuseRrf(
    ftsHits: MemoryQueryHit[],
    vecHits: MemoryQueryHit[]
  ): MemoryQueryHit[] {
    const fused = new Map<string, { entry: MemoryEntry; score: number }>();

    for (let i = 0; i < ftsHits.length; i += 1) {
      const hit = ftsHits[i]!;
      const rrfDelta = 1 / (RRF_K + (i + 1));
      const prev = fused.get(hit.entry.id);
      if (prev) {
        prev.score += rrfDelta;
      } else {
        fused.set(hit.entry.id, { entry: hit.entry, score: rrfDelta });
      }
    }

    for (let i = 0; i < vecHits.length; i += 1) {
      const hit = vecHits[i]!;
      const rrfDelta = 1 / (RRF_K + (i + 1));
      const prev = fused.get(hit.entry.id);
      if (prev) {
        prev.score += rrfDelta;
      } else {
        fused.set(hit.entry.id, { entry: hit.entry, score: rrfDelta });
      }
    }

    return [...fused.values()]
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (b.entry.importance !== a.entry.importance) {
          return b.entry.importance - a.entry.importance;
        }
        if (b.entry.updatedAt !== a.entry.updatedAt) {
          return b.entry.updatedAt - a.entry.updatedAt;
        }
        return a.entry.id.localeCompare(b.entry.id);
      })
      .map((item) => ({
        entry: item.entry,
        score: item.score,
        matchSource: "rrf"
      }));
  }

  private enforceScopeFilter(
    hits: MemoryQueryHit[],
    scopeClause: ScopeClause
  ): MemoryQueryHit[] {
    if (scopeClause.kind === "qq_group") {
      const expectedNamespace = `social/qq-group-${scopeClause.groupId}`;
      return hits.filter((hit) => hit.entry.namespace === expectedNamespace);
    }
    return hits;
  }
}
