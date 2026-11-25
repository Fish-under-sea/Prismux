import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { SqliteMemoryStore } from "@prismux/memory-core";
import { DEFAULT_CHIEF_SECRETARY_NAME } from "@prismux/protocol";
import {
  CHIEF_IDENTITY_HEADER_BEGIN,
  CHIEF_IDENTITY_HEADER_END,
  ChiefThreadManager
} from "../chief/ChiefThreadManager.js";
import { HandoffEngine } from "../handoff/HandoffEngine.js";
import { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import { DaemonBusinessService } from "../server/DaemonBusinessRoutes.js";
import { DaemonRpcServer } from "../server/DaemonRpcServer.js";
import { PairingManager } from "../server/PairingManager.js";

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

describe("Chief custom identity, independent AGENTS.md & Obsidian Agent curation routes", () => {
  it("auto-generates chief/AGENTS.md, preserves user prose across renames & engine switches, and builds ChiefSystemContext", async () => {
    const dataDir = createTempDir("prismux-chief-identity-");
    const manager = new ChiefThreadManager({ dataDir, defaultProvider: "claude-code" });
    const initial = await manager.init();

    assert.equal(initial.secretaryName, DEFAULT_CHIEF_SECRETARY_NAME);
    assert.equal(initial.agentsMdPath, join(dataDir, "chief", "AGENTS.md"));
    assert.equal(existsSync(initial.agentsMdPath), true);

    const initialMd = manager.getAgentsMd();
    assert.ok(initialMd.content.includes(CHIEF_IDENTITY_HEADER_BEGIN));
    assert.ok(initialMd.content.includes(CHIEF_IDENTITY_HEADER_END));
    assert.ok(initialMd.content.includes(DEFAULT_CHIEF_SECRETARY_NAME));

    // User customizes AGENTS.md prose below controlled header
    const customBodyMarker = "## 我的专属工作纪律\n- 每次部署前必须跑完回归测试并汇报摘要。\n";
    manager.saveAgentsMd({
      content: `${initialMd.content.trimEnd()}\n\n${customBodyMarker}`
    });

    // Rename secretary to "猫猫" -> header updates, user body stays untouched
    const renamed = manager.updateProfile({ secretaryName: "猫猫" });
    assert.equal(renamed.secretaryName, "猫猫");
    assert.equal(renamed.activeProvider, "claude-code");

    const afterRenameMd = readFileSync(initial.agentsMdPath, "utf8");
    assert.ok(afterRenameMd.includes("猫猫"));
    assert.ok(afterRenameMd.includes("@猫猫"));
    assert.ok(afterRenameMd.includes(customBodyMarker));

    // Hot-switch engines across Codex -> Antigravity -> Gemini: identity & AGENTS.md remain 100% intact
    const switched1 = await manager.switchProvider("codex", "gpt-5.4", "high");
    assert.equal(switched1.secretaryName, "猫猫");
    assert.equal(switched1.agentsMdPath, initial.agentsMdPath);

    const switched2 = await manager.switchProvider("antigravity", "gemini-3-pro");
    assert.equal(switched2.secretaryName, "猫猫");

    const switched3 = await manager.switchProvider("gemini");
    assert.equal(switched3.secretaryName, "猫猫");
    assert.equal(readFileSync(initial.agentsMdPath, "utf8"), afterRenameMd);

    // Reload from disk in a fresh manager instance
    const reloadedManager = new ChiefThreadManager({ dataDir });
    const reloadedSlot = await reloadedManager.init();
    assert.equal(reloadedSlot.secretaryName, "猫猫");
    assert.equal(reloadedSlot.activeProvider, "gemini");
    assert.equal(reloadedSlot.agentsMdPath, initial.agentsMdPath);

    // Build runtime Chief system context
    const ctx = reloadedManager.buildChiefSystemContext();
    assert.equal(ctx.secretaryName, "猫猫");
    assert.equal(ctx.agentsMdPath, initial.agentsMdPath);
    assert.ok(ctx.systemPrompt.includes("猫猫"));
    assert.ok(ctx.systemPrompt.includes("@猫猫"));
    assert.ok(ctx.systemPrompt.includes(customBodyMarker.trim()));

    // Reset restores clean default template while preserving current secretaryName ("猫猫")
    const resetRes = reloadedManager.saveAgentsMd({ reset: true });
    assert.equal(resetRes.ok, true);
    assert.ok(resetRes.content.includes("猫猫"));
    assert.equal(resetRes.content.includes("我的专属工作纪律"), false);
  });

  it("exposes /v1/chief/profile, /v1/chief/agents-md, and /v1/memory/import-obsidian/{plan,commit} over authenticated HTTP", async () => {
    const dataDir = createTempDir("prismux-daemon-routes-");
    const vaultDir = createTempDir("prismux-daemon-vault-");
    mkdirSync(join(vaultDir, "daily"), { recursive: true });
    writeFileSync(
      join(vaultDir, "daily", "work.md"),
      [
        "# 工作偏好与经验",
        "",
        "偏好使用 pnpm 管理 Monorepo 依赖，严禁混用 npm install。",
        "临时密钥误写：ghp_1234567890abcdefghijklmnopqrstuvwx"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(join(vaultDir, "daily", "empty.md"), "# {{date}}\n\nTODO:\n", "utf8");

    const chiefManager = new ChiefThreadManager({ dataDir, defaultProvider: "claude-code" });
    await chiefManager.init();
    const handoffEngine = new HandoffEngine();
    const ptyPool = new PersistentPtyPool();
    const memoryStore = new SqliteMemoryStore({
      dbPath: join(dataDir, "memory.db"),
      machineId: "daemon-test-machine",
      embeddingDimensions: 8,
      enableWal: true
    });
    await memoryStore.initialize();

    const businessService = new DaemonBusinessService({
      dataDir,
      hostVersion: "0.1.1-preview.1",
      machineId: "daemon-test-machine",
      chiefManager,
      handoffEngine,
      memoryStore,
      memoryDbPath: join(dataDir, "memory.db"),
      obsidianAgentCurator: async () => ({
        curatorLabel: "小棱 · Claude Code",
        items: [
          {
            title: "Monorepo 包管理偏好",
            summary: "统一使用 pnpm 管理 Monorepo 依赖，避免混用 npm install 造成锁文件污染。",
            kind: "preference",
            tags: ["pnpm", "monorepo"],
            sourceFile: "daily/work.md"
          },
          {
            title: "不需要导入的候选项",
            summary: "这条候选记忆将在审核阶段由用户取消勾选，不会被写入数据库。",
            kind: "knowledge",
            tags: ["skip-me"],
            sourceFile: "daily/work.md"
          }
        ]
      })
    });

    const token = "test-daemon-bearer-token";
    const qqGroupToken = "test-qq-group-bearer-token";
    const pairingManager = new PairingManager({ initialAuthToken: token });
    pairingManager.registerScopedToken(qqGroupToken, "qq_group:123456", "qq-group-test");

    const server = new DaemonRpcServer({
      port: 0,
      headless: true,
      pairingManager,
      ptyPool,
      chiefManager,
      handoffEngine,
      memoryStore,
      businessService
    });

    await server.start();
    const baseUrl = server.getHttpUrl();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
    const qqGroupHeaders = {
      Authorization: `Bearer ${qqGroupToken}`,
      "Content-Type": "application/json"
    };

    try {
      // 1. Update Chief name via PUT /v1/chief/profile
      const profileRes = await fetch(`${baseUrl}/v1/chief/profile`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ secretaryName: "小棱" })
      });
      assert.equal(profileRes.status, 200);
      const profileJson = (await profileRes.json()) as {
        ok: boolean;
        secretaryName: string;
        slot: { secretaryName: string; agentsMdPath: string };
      };
      assert.equal(profileJson.ok, true);
      assert.equal(profileJson.secretaryName, "小棱");
      assert.equal(profileJson.slot.secretaryName, "小棱");
      assert.ok(profileJson.slot.agentsMdPath.endsWith(join("chief", "AGENTS.md")));

      // 2. Read & Save & Reset /v1/chief/agents-md
      const mdGetRes = await fetch(`${baseUrl}/v1/chief/agents-md`, { headers });
      assert.equal(mdGetRes.status, 200);
      const mdGetJson = (await mdGetRes.json()) as { ok: boolean; content: string; path: string };
      assert.equal(mdGetJson.ok, true);
      assert.ok(mdGetJson.content.includes("小棱"));

      const customMd = `${mdGetJson.content}\n## 用户自定义规则\n- 保持极简风格。\n`;
      const mdPutRes = await fetch(`${baseUrl}/v1/chief/agents-md`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ content: customMd })
      });
      assert.equal(mdPutRes.status, 200);
      const mdPutJson = (await mdPutRes.json()) as { ok: boolean; content: string };
      assert.equal(mdPutJson.content, customMd);

      // 3. Switch provider via POST /v1/chief/switch -> secretaryName & AGENTS.md persist untouched
      const switchRes = await fetch(`${baseUrl}/v1/chief/switch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: "codex", model: "gpt-5.4", dialMode: "oracle" })
      });
      assert.equal(switchRes.status, 200);
      const switchJson = (await switchRes.json()) as {
        ok: boolean;
        slot: { activeProvider: string; secretaryName: string };
      };
      assert.equal(switchJson.slot.activeProvider, "codex");
      assert.equal(switchJson.slot.secretaryName, "小棱");

      const mdAfterSwitchRes = await fetch(`${baseUrl}/v1/chief/agents-md`, { headers });
      const mdAfterSwitchJson = (await mdAfterSwitchRes.json()) as { content: string };
      assert.equal(mdAfterSwitchJson.content, customMd);

      // 4. Obsidian Agent Plan -> reviewable items, secret redaction, noise filtering
      const planRes = await fetch(`${baseUrl}/v1/memory/import-obsidian/plan`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          vaultPath: vaultDir,
          namespace: "private/chief",
          useAgentCuration: true
        })
      });
      assert.equal(planRes.status, 200);
      const planJson = (await planRes.json()) as {
        ok: boolean;
        curationSource: string;
        curatorLabel?: string;
        items: Array<{ id: string; title: string; selected: boolean; kind: string }>;
        stats: { scannedFiles: number; filteredNoiseCount: number; redactedSecretCount: number };
      };
      assert.equal(planJson.ok, true);
      assert.equal(planJson.curationSource, "agent");
      assert.equal(planJson.curatorLabel, "小棱 · Claude Code");
      assert.equal(planJson.stats.scannedFiles, 2);
      assert.equal(planJson.stats.filteredNoiseCount, 1);
      assert.equal(planJson.stats.redactedSecretCount, 1);
      assert.equal(planJson.items.length, 2);

      // 5. Commit ONLY the first item (user unchecks item 2)
      const commitRes = await fetch(`${baseUrl}/v1/memory/import-obsidian/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: planJson.items.map((item, idx) => ({ ...item, selected: idx === 0 }))
        })
      });
      assert.equal(commitRes.status, 200);
      const commitJson = (await commitRes.json()) as {
        ok: boolean;
        committedCount: number;
        skippedCount: number;
      };
      assert.equal(commitJson.ok, true);
      assert.equal(commitJson.committedCount, 1);
      assert.equal(commitJson.skippedCount, 1);

      const entries = await memoryStore.listEntries("owner_chief", { limit: 10 });
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.title, "Monorepo 包管理偏好");

      // 6. Verify qq_group caller is physically blocked (403) from chief/obsidian routes
      const forbiddenRes = await fetch(`${baseUrl}/v1/chief/agents-md`, {
        headers: qqGroupHeaders
      });
      assert.equal(forbiddenRes.status, 403);

      const forbiddenPlanRes = await fetch(`${baseUrl}/v1/memory/import-obsidian/plan`, {
        method: "POST",
        headers: qqGroupHeaders,
        body: JSON.stringify({ vaultPath: vaultDir })
      });
      assert.equal(forbiddenPlanRes.status, 403);
    } finally {
      await server.stop();
      ptyPool.dispose();
      await memoryStore.close();
    }
  });
});
