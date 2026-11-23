import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  SqliteMemoryStore,
  buildObsidianCurationPrompt,
  commitObsidianImportPlan,
  parseAgentCurationJson,
  planObsidianImport,
  redactSensitiveCredentials
} from "../index.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Obsidian Agent-Curated Import Plan & Commit", () => {
  it("redacts sensitive API keys, GitHub tokens, JWTs, and inline passwords", () => {
    const sample = [
      "OpenAI key: sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      "GitHub token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12345678",
      "password: SuperSecretPassword123!",
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    ].join("\n");

    const redacted = redactSensitiveCredentials(sample);
    assert.ok(redacted.count >= 4);
    assert.equal(redacted.text.includes("sk-proj-"), false);
    assert.equal(redacted.text.includes("ghp_"), false);
    assert.equal(redacted.text.includes("SuperSecretPassword123!"), false);
    assert.equal(redacted.text.includes("eyJhbGciOiJIUzI1Ni"), false);
    assert.ok(redacted.text.includes("[REDACTED_SECRET]"));
  });

  it("scans a vault, skips .obsidian/.trash/empty templates, deduplicates, redacts secrets, and falls back gracefully", async () => {
    const vaultDir = createTempDir("prismux-obs-vault-");
    mkdirSync(join(vaultDir, ".obsidian"), { recursive: true });
    mkdirSync(join(vaultDir, ".trash"), { recursive: true });
    mkdirSync(join(vaultDir, "daily"), { recursive: true });
    mkdirSync(join(vaultDir, "prismux"), { recursive: true });

    // Ignored directories
    writeFileSync(join(vaultDir, ".obsidian", "app.md"), "# Ignored config note", "utf8");
    writeFileSync(join(vaultDir, ".trash", "deleted.md"), "# Deleted note content", "utf8");

    // Empty / template noise notes
    writeFileSync(join(vaultDir, "daily", "2026-11-24-empty.md"), "# {{date}}\n\n- [ ]\nTODO:\n", "utf8");
    writeFileSync(join(vaultDir, "daily", "blank.md"), "   \n\n  ", "utf8");

    // High-signal preference & experience notes + duplicate
    writeFileSync(
      join(vaultDir, "daily", "preferences.md"),
      [
        "---",
        "tags: [coding, workflow]",
        "---",
        "# 个人开发偏好",
        "",
        "## 语言与沟通风格",
        "始终偏好使用简体中文进行技术交流，结论先行并保留关键代码路径。",
        "",
        "## 踩坑复盘",
        "Windows 下执行 Rust 链接踩坑偶发 0xC0000005，排查根因是高并发链接冲突，解决方案是固定传入 -j 1。"
      ].join("\n"),
      "utf8"
    );

    // Duplicate of preference note to verify deduplication
    writeFileSync(
      join(vaultDir, "daily", "preferences-copy.md"),
      "# 语言与沟通风格\n\n始终偏好使用简体中文进行技术交流，结论先行并保留关键代码路径。\n",
      "utf8"
    );

    // Project architecture note with an accidental API key that must be redacted
    writeFileSync(
      join(vaultDir, "prismux", "architecture.md"),
      [
        "# Prismux 架构决策",
        "",
        "最终决定采用单文件 SQLite WAL + FTS5 作为 Prismux 记忆引擎，绝不引入 PostgreSQL 外部依赖。",
        "测试误粘密钥：api_key=sk-proj-secret1234567890abcdef1234567890"
      ].join("\n"),
      "utf8"
    );

    const plan = await planObsidianImport(
      {
        vaultPath: vaultDir,
        useAgentCuration: true
      },
      {
        // Simulate unavailable CLI -> graceful structured-fallback without throwing
        agentCurator: async () => {
          throw new Error("CLI offline");
        }
      }
    );

    assert.equal(plan.ok, true);
    assert.equal(plan.curationSource, "structured-fallback");
    assert.equal(plan.stats.scannedFiles, 5);
    assert.ok(plan.stats.filteredNoiseCount >= 2);
    assert.ok(plan.stats.deduplicatedCount >= 1);
    assert.ok(plan.stats.redactedSecretCount >= 1);
    assert.ok(plan.items.length >= 3);
    assert.ok(plan.warnings.some((w) => w.includes("平滑回退")));

    // Verify no raw secret leaked into any curated item
    for (const item of plan.items) {
      assert.equal(item.summary.includes("sk-proj-secret"), false);
      assert.equal(item.selected, true);
      assert.equal(item.curationSource, "structured-fallback");
    }

    const kinds = new Set(plan.items.map((item) => item.kind));
    assert.ok(kinds.has("preference"));
    assert.ok(kinds.has("decision"));
    assert.ok(kinds.has("experience"));
  });

  it("uses Agent curation proposals when available and commits only user-selected items to SQLite", async () => {
    const vaultDir = createTempDir("prismux-obs-agent-");
    const dbDir = createTempDir("prismux-obs-db-");
    writeFileSync(
      join(vaultDir, "notes.md"),
      "# 团队约定\n\n我们决定所有插件都默认不预装，主秘书独立保留 AGENTS.md。\n",
      "utf8"
    );

    const promptCheck: string[] = [];
    const plan = await planObsidianImport(
      {
        vaultPath: vaultDir,
        namespace: "private/chief",
        useAgentCuration: true,
        provider: "claude-code"
      },
      {
        agentCurator: async ({ notes, defaultNamespace }) => {
          promptCheck.push(
            buildObsidianCurationPrompt({
              secretaryName: "猫猫",
              defaultNamespace,
              notes
            })
          );
          const parsed = parseAgentCurationJson(
            [
              "```json",
              JSON.stringify({
                items: [
                  {
                    title: "官方插件默认零预装原则",
                    summary: "四大官方插件 qq / pet / fishdock-hook / ssh 全部独立按需安装，绝不预装。",
                    kind: "decision",
                    tags: ["plugins", "architecture"],
                    sourceFile: "notes.md"
                  },
                  {
                    title: "主秘书独立身份文件约定",
                    summary: "主秘书独立持久化 ~/.prismux/chief/AGENTS.md，不随切换底层 Agent 而丢失。",
                    kind: "project",
                    tags: ["chief", "agents-md"],
                    sourceFile: "notes.md"
                  }
                ]
              }),
              "```"
            ].join("\n")
          );
          return parsed ? { items: parsed, curatorLabel: "猫猫 · Claude Code" } : null;
        }
      }
    );

    assert.equal(plan.curationSource, "agent");
    assert.equal(plan.curatorLabel, "猫猫 · Claude Code");
    assert.equal(plan.items.length, 2);
    assert.ok(promptCheck[0]?.includes("猫猫"));
    assert.equal(plan.items[0]?.curationSource, "agent");

    // User deselects item[1] before committing
    const reviewItems = plan.items.map((item, idx) => ({
      ...item,
      selected: idx === 0
    }));

    const store = new SqliteMemoryStore({
      dbPath: join(dbDir, "memory.db"),
      machineId: "test-machine",
      embeddingDimensions: 8,
      enableWal: true
    });
    await store.initialize();
    try {
      const committed = await commitObsidianImportPlan(store, "test-machine", {
        items: reviewItems
      });
      assert.equal(committed.ok, true);
      assert.equal(committed.committedCount, 1);
      assert.equal(committed.skippedCount, 1);
      assert.equal(committed.entryIds.length, 1);

      const stored = await store.listEntries("owner_chief", { limit: 10 });
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.title, "官方插件默认零预装原则");
      assert.ok(stored[0]?.content.includes("[Category: decision]"));
    } finally {
      await store.close();
    }
  });
});
