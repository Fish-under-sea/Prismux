import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  DocumentCollector,
  ForwardIdentityGuard,
  MCP_TOOL_TIMEOUT_MS,
  McpTimeoutBreaker,
  McpToolTimeoutError,
  ObsidianVaultImporterImpl,
  SqliteMemoryStore,
  collectDocument,
  decodeUlidTimestamp,
  generateUlid,
  isValidUlid,
  withMcpTimeout
} from "../index.js";

test("generateUlid generates 26-char Crockford Base32 ULIDs monotonic within the same ms", () => {
  const fixedTs = 1_732_280_000_123;
  const ids: string[] = [];
  for (let i = 0; i < 300; i += 1) {
    const id = generateUlid(fixedTs);
    assert.equal(id.length, 26);
    assert.equal(isValidUlid(id), true);
    assert.equal(decodeUlidTimestamp(id), fixedTs);
    ids.push(id);
  }

  for (let i = 1; i < ids.length; i += 1) {
    assert.ok(
      ids[i]! > ids[i - 1]!,
      `Expected monotonic ULID ${ids[i]} > ${ids[i - 1]}`
    );
  }

  // Explicit earlier timestamp after auto-clock ULIDs must still encode the explicit timestamp.
  const autoId = generateUlid();
  assert.equal(isValidUlid(autoId), true);
  const pastTs = 1_600_000_000_000;
  const pastId = generateUlid(pastTs);
  assert.equal(decodeUlidTimestamp(pastId), pastTs);
});

test("SqliteMemoryStore physical isolation blocks qq_group cross-domain & cross-group leaks", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "prismux-mem-iso-"));
  const dbPath = join(tempRoot, "data", "memory.db");
  const store = new SqliteMemoryStore({
    dbPath,
    machineId: "test-win-1",
    embeddingDimensions: 4,
    enableWal: true
  });

  try {
    await store.initialize();
    assert.equal(store.isVectorSearchEnabled(), true);

    const priv = await store.upsert(
      {
        namespace: "private/chief",
        kind: "preference",
        title: "Personal API Vault",
        content: "ConfidentialAlphaToken lives only in chief private memory and AI notes",
        machineId: "test-win-1",
        importance: 0.95
      },
      [1, 0, 0, 0]
    );

    const ws = await store.upsert(
      {
        namespace: "workspace/secret-app",
        kind: "fact",
        title: "Unreleased Kernel",
        content: "SecretRepoKernel architecture blueprint and AI routing",
        machineId: "test-win-1",
        importance: 0.9
      },
      [1, 0, 0, 0]
    );

    const g1 = await store.upsert(
      {
        namespace: "social/qq-group-10001",
        kind: "episodic",
        title: "Group 10001 Dinner",
        content: "Group10001PizzaNight scheduled for Friday evening",
        machineId: "test-win-1",
        importance: 0.7
      },
      [0.85, 0.15, 0, 0]
    );

    const g2 = await store.upsert(
      {
        namespace: "social/qq-group-20002",
        kind: "episodic",
        title: "Group 20002 Secret",
        content: "Group20002SecretGame strategy discussion",
        machineId: "test-win-1",
        importance: 0.8
      },
      [1, 0, 0, 0]
    );

    // Confirm WAL mode is actually enabled on disk.
    const probeDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const modeRow = probeDb.prepare("PRAGMA journal_mode;").get() as {
        journal_mode: string;
      };
      assert.equal(modeRow.journal_mode.toLowerCase(), "wal");
    } finally {
      probeDb.close();
    }

    // Malicious FTS / hybrid queries as qq_group:10001 targeting other scopes.
    for (const leakedTerm of [
      "ConfidentialAlphaToken",
      "SecretRepoKernel",
      "Group20002SecretGame"
    ]) {
      const ftsRes = await store.query(
        {
          callerScope: "owner_chief",
          query: leakedTerm,
          namespaces: [
            "private/chief",
            "workspace/secret-app",
            "social/qq-group-20002"
          ],
          mode: "fts"
        },
        "qq_group:10001"
      );
      assert.equal(ftsRes.hits.length, 0, `Leaked on FTS query "${leakedTerm}"`);
    }

    // Short-term LIKE fallback (<3 chars) must also enforce physical qq_group isolation.
    const shortRes = await store.query(
      {
        callerScope: "owner_chief",
        query: "AI",
        namespaces: ["private/chief", "workspace/secret-app"]
      },
      "qq_group:10001"
    );
    assert.equal(shortRes.hits.length, 0);

    // Hybrid + vector query with exact [1, 0, 0, 0] matching private/chief, workspace, and g2
    // must NEVER return anything outside social/qq-group-10001.
    const vecRes = await store.query(
      {
        callerScope: "owner_chief",
        query: "",
        namespaces: [
          "private/chief",
          "workspace/secret-app",
          "social/qq-group-20002"
        ],
        mode: "vector",
        limit: 10
      },
      "qq_group:10001",
      [1, 0, 0, 0]
    );
    assert.equal(vecRes.hits.length, 1);
    assert.equal(vecRes.hits[0]!.entry.id, g1.id);
    assert.equal(vecRes.hits[0]!.entry.namespace, "social/qq-group-10001");

    // Legitimate query inside qq_group:10001 matches its own entry.
    const selfRes = await store.query(
      {
        callerScope: "qq_group:10001",
        query: "Group10001PizzaNight",
        namespaces: ["private/chief"]
      },
      "qq_group:10001"
    );
    assert.equal(selfRes.hits.length, 1);
    assert.equal(selfRes.hits[0]!.entry.id, g1.id);

    // getById & listEntries physical isolation.
    assert.equal(await store.getById(priv.id, "qq_group:10001"), null);
    assert.equal(await store.getById(ws.id, "qq_group:10001"), null);
    assert.equal(await store.getById(g2.id, "qq_group:10001"), null);
    const ownById = await store.getById(g1.id, "qq_group:10001");
    assert.equal(ownById?.id, g1.id);

    const listedByGroup = await store.listEntries("qq_group:10001", {
      namespaces: ["private/chief", "workspace/secret-app"]
    });
    assert.equal(listedByGroup.length, 1);
    assert.equal(listedByGroup[0]!.namespace, "social/qq-group-10001");

    // ForwardIdentityGuard unconditionally overwrites callerScope and _callerScope.
    const guard = new ForwardIdentityGuard();
    const maliciousPayload = {
      callerScope: "owner_chief",
      _callerScope: "owner_chief",
      query: "ConfidentialAlphaToken",
      namespaces: ["private/chief", "workspace/secret-app"]
    } as unknown as Parameters<ForwardIdentityGuard["bindCallerScope"]>[1];

    const bound = guard.bindCallerScope("qq_group:10001", maliciousPayload);
    assert.equal(bound.callerScope, "qq_group:10001");
    assert.equal(bound._callerScope, "qq_group:10001");
    assert.deepEqual(bound.namespaces, ["social/qq-group-10001"]);
    const guardedQuery = await store.query(bound);
    assert.equal(guardedQuery.hits.length, 0);
  } finally {
    await store.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("SqliteMemoryStore supports owner_chief cross-domain, CJK trigram, short-term LIKE, RRF, softDelete & graceful FTS fallback", async () => {
  const store = new SqliteMemoryStore({
    dbPath: ":memory:",
    machineId: "test-win-2",
    embeddingDimensions: 4,
    enableWal: false
  });

  try {
    await store.initialize();
    assert.equal(store.isVectorSearchEnabled(), true);

    const e1 = await store.upsert(
      {
        namespace: "private/chief",
        kind: "fact",
        title: "液态玻璃渲染",
        content: "Prismux 使用 360° Fresnel 液态玻璃和混合记忆引擎；支持 C++ 与 100% 离线。",
        sourceRef: "note:glass",
        machineId: "test-win-2",
        importance: 0.9
      },
      [1, 0, 0, 0]
    );

    const e2 = await store.upsert(
      {
        namespace: "workspace/prismux",
        kind: "handoff_note",
        title: "Memory Architecture",
        content: "Single-file SQLite WAL + FTS5 + sqlite-vec 混合记忆引擎支持 AI 检索。",
        sourceRef: "note:arch",
        machineId: "test-win-2",
        importance: 0.8
      },
      [0.6, 0.8, 0, 0]
    );

    const e3 = await store.upsert(
      {
        namespace: "workspace/prismux",
        kind: "fact",
        title: "Pure Semantic Match",
        content: "Completely unrelated lexical tokens here.",
        machineId: "test-win-2",
        importance: 0.5
      },
      [0.98, 0.02, 0, 0]
    );

    // Cross-domain CJK trigram query as owner_chief.
    const cjkRes = await store.query(
      {
        callerScope: "owner_chief",
        query: "混合记忆引擎"
      },
      "owner_chief"
    );
    assert.equal(cjkRes.degradedToFtsOnly, true);
    assert.equal(cjkRes.hits.length, 2);
    assert.ok(cjkRes.hits.every((h) => h.matchSource === "fts"));

    // Short-term (<3 chars) & LIKE wildcard escaping (`100%`).
    const shortAi = await store.query(
      {
        callerScope: "owner_chief",
        query: "AI"
      },
      "owner_chief"
    );
    assert.equal(shortAi.hits.length, 1);
    assert.equal(shortAi.hits[0]!.entry.id, e2.id);

    const pctRes = await store.query(
      {
        callerScope: "owner_chief",
        query: "100%"
      },
      "owner_chief"
    );
    assert.equal(pctRes.hits.length, 1);
    assert.equal(pctRes.hits[0]!.entry.id, e1.id);

    // Punctuation-heavy FTS5 query (`C++`) does not throw syntax errors.
    const cppRes = await store.query(
      {
        callerScope: "owner_chief",
        query: "C++"
      },
      "owner_chief"
    );
    assert.equal(cppRes.hits.length, 1);
    assert.equal(cppRes.hits[0]!.entry.id, e1.id);

    // Hybrid RRF query combines FTS5 + sqlite-vec.
    const rrfRes = await store.query(
      {
        callerScope: "owner_chief",
        query: "液态玻璃",
        mode: "hybrid"
      },
      "owner_chief",
      [1, 0, 0, 0]
    );
    assert.equal(rrfRes.degradedToFtsOnly, false);
    assert.ok(rrfRes.hits.length >= 2);
    assert.equal(rrfRes.hits[0]!.entry.id, e1.id);
    assert.equal(rrfRes.hits[0]!.matchSource, "rrf");
    // Pure vector candidate e3 should also be included via RRF fusion.
    assert.ok(rrfRes.hits.some((h) => h.entry.id === e3.id));

    // Vector-only query finds semantic neighbor e3 without lexical overlap.
    const vecOnly = await store.query(
      {
        callerScope: "owner_chief",
        query: "nonexistent lexical token",
        mode: "vector",
        namespaces: ["workspace/prismux"]
      },
      "owner_chief",
      [0.98, 0.02, 0, 0]
    );
    assert.equal(vecOnly.degradedToFtsOnly, false);
    assert.equal(vecOnly.hits[0]!.entry.id, e3.id);
    assert.equal(vecOnly.hits[0]!.matchSource, "vector");

    // Idempotent upsert by (namespace, sourceRef) updates existing row instead of inserting duplicate.
    const updatedE1 = await store.upsert(
      {
        namespace: "private/chief",
        kind: "fact",
        title: "液态玻璃渲染 v2",
        content: "Updated Prismux 液态玻璃引擎参数。",
        sourceRef: "note:glass",
        machineId: "test-win-2",
        importance: 0.99
      },
      [1, 0, 0, 0]
    );
    assert.equal(updatedE1.id, e1.id);
    assert.equal(updatedE1.createdAt, e1.createdAt);

    // Soft delete removes entry from queries, getById, and listEntries.
    const deleted = await store.softDelete(e2.id);
    assert.equal(deleted, true);
    assert.equal(await store.softDelete(e2.id), false);
    assert.equal(await store.getById(e2.id, "owner_chief"), null);
    const afterDeleteAi = await store.query(
      { callerScope: "owner_chief", query: "AI" },
      "owner_chief"
    );
    assert.equal(afterDeleteAi.hits.length, 0);
  } finally {
    await store.close();
  }

  // Graceful degradation to FTS-only when sqlite-vec extension fails to load.
  const degradedStore = new SqliteMemoryStore({
    dbPath: ":memory:",
    machineId: "test-degraded",
    embeddingDimensions: 4,
    enableWal: false,
    vectorExtensionPath: join(tmpdir(), "non-existent-vec0-extension.dll")
  });
  try {
    await degradedStore.initialize();
    assert.equal(degradedStore.isVectorSearchEnabled(), false);

    await degradedStore.upsert(
      {
        namespace: "private/chief",
        kind: "fact",
        title: "Offline Memory",
        content: "Graceful FTS5 fallback works even without sqlite-vec.",
        machineId: "test-degraded"
      },
      [1, 0, 0, 0]
    );

    const res = await degradedStore.query(
      {
        callerScope: "owner_chief",
        query: "fallback",
        mode: "hybrid"
      },
      "owner_chief",
      [1, 0, 0, 0]
    );
    assert.equal(res.degradedToFtsOnly, true);
    assert.equal(res.hits.length, 1);
    assert.equal(res.hits[0]!.matchSource, "fts");
  } finally {
    await degradedStore.close();
  }
});

test("ObsidianVaultImporterImpl scans vault, ignores system dirs, parses YAML/wikilinks & imports idempotently", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "prismux-obs-"));
  const vaultDir = join(tempRoot, "vault");
  const store = new SqliteMemoryStore({
    dbPath: join(tempRoot, "memory.db"),
    machineId: "obs-machine",
    embeddingDimensions: 4,
    enableWal: true
  });

  try {
    await mkdir(join(vaultDir, ".obsidian"), { recursive: true });
    await mkdir(join(vaultDir, ".trash"), { recursive: true });
    await mkdir(join(vaultDir, ".git"), { recursive: true });
    await mkdir(join(vaultDir, "Daily"), { recursive: true });
    await mkdir(join(vaultDir, "Secret App", "Sub"), { recursive: true });

    // Ignored directories
    await writeFile(join(vaultDir, ".obsidian", "ignored.md"), "# Should be ignored", "utf8");
    await writeFile(join(vaultDir, ".trash", "trashed.md"), "# Trashed note", "utf8");
    await writeFile(join(vaultDir, ".git", "internal.md"), "# Git internal", "utf8");

    // Empty note (skipped)
    await writeFile(join(vaultDir, "empty.md"), "   \n  \n", "utf8");

    // Root note -> private/chief
    await writeFile(
      join(vaultDir, "inbox-idea.md"),
      "# Root Idea\n\nRemember to check [[Secret App/Design|Architecture]].",
      "utf8"
    );

    // Daily note -> private/chief with YAML frontmatter
    await writeFile(
      join(vaultDir, "Daily", "2026-11-22.md"),
      [
        "---",
        'title: "Daily Standup Log"',
        "kind: episodic",
        "importance: 0.88",
        "tags: [journal, \"prismux\"]",
        "---",
        "Finished [[inbox-idea]] and reviewed [[Secret App/Design|Design Spec]]."
      ].join("\n"),
      "utf8"
    );

    // Project folder note -> workspace/secret-app with multiline tags
    await writeFile(
      join(vaultDir, "Secret App", "Sub", "Design.md"),
      [
        "---",
        "kind: fact",
        "tags:",
        "  - architecture",
        "  - sqlite-vec",
        "---",
        "Hybrid search notes referencing [[Daily/2026-11-22|Today]]."
      ].join("\n"),
      "utf8"
    );

    await store.initialize();
    const importer = new ObsidianVaultImporterImpl(store, "obs-machine");

    // Dry run scans and counts without writing to store.
    const dryRes = await importer.importVault({ vaultPath: vaultDir, dryRun: true });
    assert.equal(dryRes.scannedFiles, 4);
    assert.equal(dryRes.skippedFiles, 1);
    assert.equal(dryRes.importedEntries, 0);
    assert.equal((await store.listEntries("owner_chief")).length, 0);

    // Real import writes 3 entries.
    const importRes = await importer.importVault({ vaultPath: vaultDir });
    assert.equal(importRes.scannedFiles, 4);
    assert.equal(importRes.skippedFiles, 1);
    assert.equal(importRes.importedEntries, 3);

    const allEntries = await store.listEntries("owner_chief");
    assert.equal(allEntries.length, 3);

    const daily = allEntries.find(
      (e) => e.sourceRef === "obsidian:Daily/2026-11-22.md"
    );
    assert.ok(daily);
    assert.equal(daily.namespace, "private/chief");
    assert.equal(daily.kind, "episodic");
    assert.equal(daily.title, "Daily Standup Log");
    assert.equal(daily.importance, 0.88);
    assert.ok(daily.content.includes("[Tags: journal, prismux]"));
    assert.ok(daily.content.includes("Secret App/Design (Design Spec)"));

    const design = allEntries.find(
      (e) => e.sourceRef === "obsidian:Secret App/Sub/Design.md"
    );
    assert.ok(design);
    assert.equal(design.namespace, "workspace/secret-app");
    assert.ok(design.content.includes("[Tags: architecture, sqlite-vec]"));

    // Repeat import is strictly idempotent (still 3 entries, same IDs).
    const repeatRes = await importer.importVault({ vaultPath: vaultDir });
    assert.equal(repeatRes.importedEntries, 3);
    const afterRepeat = await store.listEntries("owner_chief");
    assert.equal(afterRepeat.length, 3);
    assert.equal(
      afterRepeat.find((e) => e.sourceRef === "obsidian:Daily/2026-11-22.md")?.id,
      daily.id
    );
    assert.ok(daily.content.includes("[WikiLinks: inbox-idea, Secret App/Design (Design Spec)]"));

    // Explicit targetNamespace overrides directory mapping.
    const overrideRes = await importer.importVault({
      vaultPath: vaultDir,
      targetNamespace: "workspace/forced-override"
    });
    assert.equal(overrideRes.importedEntries, 3);
    const overridden = await store.listEntries("owner_chief", {
      namespaces: ["workspace/forced-override"]
    });
    assert.equal(overridden.length, 3);

    // Verify persistence across reopen of the single SQLite file (both FTS5 and sqlite-vec).
    await store.close();
    const reopened = new SqliteMemoryStore({
      dbPath: join(tempRoot, "memory.db"),
      machineId: "obs-machine",
      embeddingDimensions: 4,
      enableWal: true
    });
    try {
      await reopened.initialize();
      assert.equal(reopened.isVectorSearchEnabled(), true);
      const persistedAll = await reopened.query(
        { callerScope: "owner_chief", query: "Daily Standup Log" },
        "owner_chief"
      );
      assert.equal(persistedAll.hits.length, 2);
      const persistedPrivate = await reopened.query(
        {
          callerScope: "owner_chief",
          query: "Daily Standup Log",
          namespaces: ["private/chief"]
        },
        "owner_chief"
      );
      assert.equal(persistedPrivate.hits.length, 1);
      assert.equal(persistedPrivate.hits[0]!.entry.id, daily.id);
    } finally {
      await reopened.close();
    }
  } finally {
    await store.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("DocumentCollector chunks email, HTML, Markdown (with breadcrumbs) and overlapping text", () => {
  const collector = new DocumentCollector();

  // 1. Email: extract headers, drop quoted replies and `-- ` signature.
  const emailChunks = collector.collect({
    kind: "email",
    sourceRef: "gmail:msg-1",
    raw: [
      "From: Alice <alice@example.com>",
      "Subject: Nightly Factory Report",
      "Date: Sun, 22 Nov 2026 09:00:00 +0800",
      "",
      "The build passed all unit tests.",
      "",
      "> Previous quoted message that must be stripped",
      "> Another quoted line",
      "",
      "-- ",
      "Alice Signature Line",
      "Phone: 12345"
    ].join("\n")
  });
  assert.equal(emailChunks.length, 1);
  assert.equal(emailChunks[0]!.metadata?.subject, "Nightly Factory Report");
  assert.equal(emailChunks[0]!.metadata?.from, "Alice <alice@example.com>");
  assert.ok(emailChunks[0]!.text.includes("The build passed all unit tests."));
  assert.equal(emailChunks[0]!.text.includes("Previous quoted message"), false);
  assert.equal(emailChunks[0]!.text.includes("Alice Signature Line"), false);

  // 2. HTML: remove script/style/noscript, convert blocks to newlines, decode entities once.
  const htmlChunks = collectDocument({
    kind: "html",
    sourceRef: "web:doc-1",
    raw: `
      <html>
        <head><style>.hidden { display: none; }</style><script>alert("xss")</script></head>
        <body>
          <noscript>Enable JS</noscript>
          <h1>Title &amp; Overview</h1>
          <p>Price &lt; 100 &amp;lt; literal &quot;ok&quot; &#39;yes&#39;&nbsp;done</p>
        </body>
      </html>
    `
  });
  assert.equal(htmlChunks.length, 1);
  const htmlText = htmlChunks[0]!.text;
  assert.equal(htmlText.includes("alert"), false);
  assert.equal(htmlText.includes("display: none"), false);
  assert.equal(htmlText.includes("Enable JS"), false);
  assert.ok(htmlText.includes("Title & Overview"));
  assert.ok(htmlText.includes(`Price < 100 &lt; literal "ok" 'yes' done`));

  // 3. Markdown: heading breadcrumbs and ignore `#` inside fenced code blocks.
  const mdChunks = collector.collect({
    kind: "markdown",
    sourceRef: "docs:arch.md",
    raw: [
      "# Prismux",
      "",
      "## Memory Core",
      "Uses SQLite WAL.",
      "",
      "```bash",
      "# this is a shell comment, not a heading",
      "echo ok",
      "```",
      "",
      "### Isolation",
      "Hardcoded namespace filters."
    ].join("\n")
  });
  assert.equal(mdChunks.length, 2);
  assert.deepEqual(mdChunks[0]!.headingPath, ["Prismux", "Memory Core"]);
  assert.equal(mdChunks[0]!.breadcrumb, "Prismux > Memory Core");
  assert.ok(mdChunks[0]!.text.startsWith("[Prismux > Memory Core]\n"));
  assert.ok(mdChunks[0]!.text.includes("# this is a shell comment"));
  assert.deepEqual(mdChunks[1]!.headingPath, [
    "Prismux",
    "Memory Core",
    "Isolation"
  ]);

  // 4. Text: paragraph boundaries + configurable overlap window.
  const textChunks = collector.collect({
    kind: "text",
    sourceRef: "txt:1",
    maxChunkChars: 60,
    overlapChars: 15,
    raw: [
      "Alpha paragraph with forty five characters total.",
      "",
      "Beta paragraph with another forty five characters.",
      "",
      "Gamma paragraph closing out the test sample."
    ].join("\n")
  });
  assert.ok(textChunks.length >= 3);
  assert.ok(textChunks[1]!.text.includes("Beta paragraph"));
  // Verify overlap carries trailing chars from chunk 0 into chunk 1.
  const tailOfFirst = textChunks[0]!.text.slice(-15);
  assert.ok(textChunks[1]!.text.startsWith(tailOfFirst));

  // Long single-paragraph sliding window keeps every chunk within maxChunkChars and preserves overlap.
  const longPara =
    "Word01 Word02 Word03 Word04 Word05 Word06 Word07 Word08 Word09 Word10 Word11 Word12 Word13 Word14 Word15 Word16";
  const longChunks = collector.collect({
    kind: "text",
    sourceRef: "txt:long",
    maxChunkChars: 40,
    overlapChars: 10,
    raw: longPara
  });
  assert.ok(longChunks.length >= 3);
  for (const chunk of longChunks) {
    assert.ok(chunk.text.length <= 40, `Chunk exceeded maxChunkChars: ${chunk.text.length}`);
  }
  assert.ok(longChunks[0]!.text.includes("Word01"));
  assert.ok(longChunks[longChunks.length - 1]!.text.includes("Word16"));
});

test("McpTimeoutBreaker and withMcpTimeout enforce timeout, abort signal, and clean up timers", async () => {
  assert.equal(MCP_TOOL_TIMEOUT_MS, 60_000);
  const breaker = new McpTimeoutBreaker(50);

  // Normal execution succeeds and resets activeCount to 0.
  const ok = await breaker.run("memory.query", async (signal) => {
    assert.equal(signal.aborted, false);
    return 42;
  });
  assert.equal(ok, 42);
  assert.deepEqual(breaker.getStats(), {
    activeCount: 0,
    completedCount: 1,
    timeoutCount: 0,
    errorCount: 0
  });

  // Hanging tool rejects promptly with McpToolTimeoutError and aborts signal.
  let observedAbort = false;
  let internalTimer: ReturnType<typeof setTimeout> | undefined;
  await assert.rejects(
    () =>
      breaker.run(
        "memory.slow",
        (signal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              observedAbort = true;
              if (internalTimer !== undefined) {
                clearTimeout(internalTimer);
              }
            });
            internalTimer = setTimeout(() => resolve("late"), 5_000);
          }),
        25
      ),
    (err: unknown) => {
      assert.ok(err instanceof McpToolTimeoutError);
      assert.equal(err.toolName, "memory.slow");
      assert.equal(err.timeoutMs, 25);
      return true;
    }
  );
  assert.equal(observedAbort, true);

  // Non-timeout error increments errorCount cleanly.
  await assert.rejects(
    () =>
      breaker.run("memory.boom", async () => {
        throw new Error("boom");
      }),
    /boom/
  );

  // Direct withMcpTimeout fast path clears timer immediately.
  const direct = await withMcpTimeout("memory.fast", () => "ready", 5_000);
  assert.equal(direct, "ready");
  assert.deepEqual(breaker.getStats(), {
    activeCount: 0,
    completedCount: 1,
    timeoutCount: 1,
    errorCount: 1
  });
});
