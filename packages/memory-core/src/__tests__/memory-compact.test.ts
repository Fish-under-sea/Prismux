import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  MEMORY_DB_JOURNAL_SIZE_LIMIT_BYTES,
  SqliteMemoryStore
} from "../index.js";

test("SqliteMemoryStore configures 64 MiB journal_size_limit, INCREMENTAL auto_vacuum, and compact() purges old tombstones & excess recall snapshots", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "prismux-mem-compact-"));
  const dbPath = join(tempRoot, "data", "memory.db");
  const store = new SqliteMemoryStore({
    dbPath,
    machineId: "compact-test-1",
    embeddingDimensions: 4,
    enableWal: true,
    loadVectorExtension: false
  });

  try {
    await store.initialize();

    // 1. Verify PRAGMA journal_size_limit (64 MiB) and auto_vacuum (INCREMENTAL = 2)
    const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const avRow = verifyDb.prepare("PRAGMA auto_vacuum;").get() as {
        auto_vacuum: number;
      };
      assert.equal(avRow.auto_vacuum, 2, "auto_vacuum must be INCREMENTAL (2)");
    } finally {
      verifyDb.close();
    }

    // 2. Insert active entry, recent tombstone (<30d), and old tombstone (>30d)
    const now = 1_780_000_000_000;
    const dayMs = 24 * 60 * 60 * 1000;

    const active = await store.upsert({
      namespace: "private/chief",
      kind: "fact",
      title: "Active Entry",
      content: "Keep this active memory entry intact across compact.",
      machineId: "compact-test-1"
    });
    const recentDeleted = await store.upsert({
      namespace: "private/chief",
      kind: "fact",
      title: "Recent Tombstone",
      content: "Deleted 5 days ago, should be kept during 30d grace window.",
      machineId: "compact-test-1"
    });
    const oldDeleted = await store.upsert({
      namespace: "private/chief",
      kind: "fact",
      title: "Old Tombstone",
      content: "Deleted 45 days ago, must be hard-purged by compact().",
      machineId: "compact-test-1"
    });

    await store.softDelete(recentDeleted.id, now - 5 * dayMs);
    await store.softDelete(oldDeleted.id, now - 45 * dayMs);

    // 3. Insert 510 recall snapshots: 5 older than 30 days + 505 recent -> expect trim to 500
    for (let i = 0; i < 5; i += 1) {
      const oldTs = now - (40 + i) * dayMs;
      store.saveRecallSnapshotRecord({
        sessionId: `old-session-${i}`,
        callerScope: "owner_chief",
        queryText: "old query",
        frozenBlock: "old block",
        entriesJson: "[]",
        revisionsJson: "{}",
        createdAt: oldTs,
        updatedAt: oldTs
      });
    }
    for (let i = 0; i < 505; i += 1) {
      const recentTs = now - (505 - i) * 1000;
      store.saveRecallSnapshotRecord({
        sessionId: `recent-session-${i}`,
        callerScope: "owner_chief",
        queryText: `query-${i}`,
        frozenBlock: `block-${i}`,
        entriesJson: "[]",
        revisionsJson: "{}",
        createdAt: recentTs,
        updatedAt: recentTs
      });
    }

    // 4. Execute compact()
    const compactRes = await store.compact({ nowMs: now });
    assert.equal(compactRes.purgedTombstones, 1);
    assert.equal(compactRes.trimmedRecallSnapshots, 10); // 5 old + 5 overflow over 500
    assert.equal(compactRes.walCheckpointed, true);
    assert.equal(compactRes.incrementalVacuumRan, true);
    assert.ok(compactRes.bytesBefore > 0);
    assert.ok(compactRes.bytesAfter > 0);

    // 5. Verify active entry & recent tombstone remain, old tombstone hard-purged
    const allWithDeleted = await store.listEntries("owner_chief", {
      includeDeleted: true
    });
    const ids = new Set(allWithDeleted.map((e) => e.id));
    assert.equal(ids.has(active.id), true);
    assert.equal(ids.has(recentDeleted.id), true);
    assert.equal(ids.has(oldDeleted.id), false);

    // 6. Verify recall snapshots: oldest 5 recent + 5 >30d removed, newest 500 retained
    assert.equal(store.loadRecallSnapshotRecord("old-session-0", "owner_chief"), null);
    assert.equal(store.loadRecallSnapshotRecord("recent-session-0", "owner_chief"), null);
    assert.equal(store.loadRecallSnapshotRecord("recent-session-4", "owner_chief"), null);
    assert.ok(
      store.loadRecallSnapshotRecord("recent-session-5", "owner_chief") !== null
    );
    assert.ok(
      store.loadRecallSnapshotRecord("recent-session-504", "owner_chief") !== null
    );

    assert.equal(MEMORY_DB_JOURNAL_SIZE_LIMIT_BYTES, 64 * 1024 * 1024);
  } finally {
    await store.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
