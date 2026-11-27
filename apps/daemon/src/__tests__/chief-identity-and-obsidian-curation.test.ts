import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { SqliteMemoryStore } from "@prismux/memory-core";
import { CANONICAL_PROVIDER_DISPLAY_NAMES, DEFAULT_CHIEF_SECRETARY_NAME } from "@prismux/protocol";
import {
  CHIEF_IDENTITY_HEADER_BEGIN,
  CHIEF_IDENTITY_HEADER_END,
  ChiefThreadManager,
} from "../chief/ChiefThreadManager.js";
import { formatProviderDisplay } from "../chief/ChiefObsidianCurator.js";
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
    assert.ok(initialMd.content.includes("Codex / Claude / Antigravity / Gemini"));
    assert.equal(initialMd.content.includes("Claude Code"), false);

    // User customizes AGENTS.md prose below controlled header
    const customBodyMarker = "## 我的专属工作纪律\n- 每次部署前必须跑完回归测试并汇报摘要。\n";
    manager.saveAgentsMd({
      content: `${initialMd.content.trimEnd()}\n\n${customBodyMarker}`,
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

  it("formats Chief Obsidian curator provider labels consistently with agent settings (Claude / DSH / Pi / custom ACP)", () => {
    assert.equal(formatProviderDisplay("claude-code"), "Claude");
    assert.equal(formatProviderDisplay("codex"), "Codex");
    assert.equal(formatProviderDisplay("dsh"), "DSH");
    assert.equal(formatProviderDisplay("pi"), "Pi");
    assert.equal(formatProviderDisplay("glm-acp-agent"), "glm-acp-agent");
    assert.equal(formatProviderDisplay("qwen-code"), "qwen-code");
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
        "临时密钥误写：ghp_1234567890abcdefghijklmnopqrstuvwx",
      ].join("\n"),
      "utf8",
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
      enableWal: true,
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
        curatorLabel: `小棱 · ${CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent}`,
        items: [
          {
            title: "Monorepo 包管理偏好",
            summary: "统一使用 pnpm 管理 Monorepo 依赖，避免混用 npm install 造成锁文件污染。",
            kind: "preference",
            tags: ["pnpm", "monorepo"],
            sourceFile: "daily/work.md",
          },
          {
            title: "不需要导入的候选项",
            summary: "这条候选记忆将在审核阶段由用户取消勾选，不会被写入数据库。",
            kind: "knowledge",
            tags: ["skip-me"],
            sourceFile: "daily/work.md",
          },
        ],
      }),
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
      businessService,
    });

    await server.start();
    const baseUrl = server.getHttpUrl();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const qqGroupHeaders = {
      Authorization: `Bearer ${qqGroupToken}`,
      "Content-Type": "application/json",
    };

    try {
      // 1. Update Chief name via PUT /v1/chief/profile
      const profileRes = await fetch(`${baseUrl}/v1/chief/profile`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ secretaryName: "小棱" }),
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
        body: JSON.stringify({ content: customMd }),
      });
      assert.equal(mdPutRes.status, 200);
      const mdPutJson = (await mdPutRes.json()) as { ok: boolean; content: string };
      assert.equal(mdPutJson.content, customMd);

      // 3. Switch provider via POST /v1/chief/switch -> secretaryName & AGENTS.md persist untouched
      const switchRes = await fetch(`${baseUrl}/v1/chief/switch`, {
        method: "POST",
        headers,
        body: JSON.stringify({ provider: "codex", model: "gpt-5.4", dialMode: "oracle" }),
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
          useAgentCuration: true,
        }),
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
      assert.equal(planJson.curatorLabel, `小棱 · ${CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent}`);
      assert.equal(planJson.stats.scannedFiles, 2);
      assert.equal(planJson.stats.filteredNoiseCount, 1);
      assert.equal(planJson.stats.redactedSecretCount, 1);
      assert.equal(planJson.items.length, 2);

      // 5. Commit ONLY the first item (user unchecks item 2)
      const commitRes = await fetch(`${baseUrl}/v1/memory/import-obsidian/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: planJson.items.map((item, idx) => ({ ...item, selected: idx === 0 })),
        }),
      });
      assert.equal(commitRes.status, 200);
      const commitJson = (await commitRes.json()) as {
        ok: boolean;
        committedCount: number;
        skippedCount: number;
        namespace: string;
        namespaces: string[];
      };
      assert.equal(commitJson.ok, true);
      assert.equal(commitJson.committedCount, 1);
      assert.equal(commitJson.skippedCount, 1);
      assert.equal(commitJson.namespace, "private/chief");
      assert.deepEqual(commitJson.namespaces, ["private/chief"]);

      // 5b. Verify GET /v1/memory/stats reports dbSizeBytes (> 0) and POST /v1/memory/search honors singular `namespace`
      const statsRes = await fetch(`${baseUrl}/v1/memory/stats`, { headers });
      assert.equal(statsRes.status, 200);
      const statsJson = (await statsRes.json()) as {
        ok: boolean;
        totalEntries: number;
        dbSizeBytes?: number;
      };
      assert.equal(statsJson.ok, true);
      assert.equal(statsJson.totalEntries, 1);
      assert.equal(typeof statsJson.dbSizeBytes, "number");
      assert.ok(
        (statsJson.dbSizeBytes ?? 0) > 0,
        "memory stats should report real dbSizeBytes > 0",
      );

      const searchMatchRes = await fetch(`${baseUrl}/v1/memory/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: "Monorepo", namespace: "private/chief", limit: 10 }),
      });
      assert.equal(searchMatchRes.status, 200);
      const searchMatchJson = (await searchMatchRes.json()) as {
        hits: Array<{ entry: { title: string; namespace: string } }>;
      };
      assert.equal(searchMatchJson.hits.length, 1);
      assert.equal(searchMatchJson.hits[0]?.entry.namespace, "private/chief");

      const searchMismatchRes = await fetch(`${baseUrl}/v1/memory/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: "Monorepo", namespace: "workspace/other-repo", limit: 10 }),
      });
      assert.equal(searchMismatchRes.status, 200);
      const searchMismatchJson = (await searchMismatchRes.json()) as {
        hits: Array<{ entry: { title: string } }>;
      };
      assert.equal(searchMismatchJson.hits.length, 0);

      // 5c. Verify structured-fallback Obsidian plan formats provider display label (respecting override) and reports fallbackReason + warnings
      const fallbackBusiness = new DaemonBusinessService({
        dataDir,
        hostVersion: "0.2.4-rc.4",
        machineId: "test-machine",
        chiefManager,
        handoffEngine,
        memoryStore,
        memoryDbPath: join(dataDir, "memory.db"),
        obsidianAgentCurator: async () => null,
      });
      const fallbackPlan = (await fallbackBusiness.planObsidianVaultImport(
        {
          vaultPath: vaultDir,
          namespace: "private/chief",
          useAgentCuration: true,
          provider: "dsh",
        },
        "owner_chief",
      )) as {
        curationSource: string;
        curatorLabel?: string;
        fallbackReason?: string;
        warnings: string[];
      };
      assert.equal(fallbackPlan.curationSource, "structured-fallback");
      assert.equal(fallbackPlan.curatorLabel, "小棱 · DSH");
      assert.ok(
        typeof fallbackPlan.fallbackReason === "string" &&
          fallbackPlan.fallbackReason.includes("DSH"),
        "fallbackReason should explain DSH fallback clearly",
      );
      assert.ok(
        fallbackPlan.warnings.includes(fallbackPlan.fallbackReason),
        "warnings should include fallbackReason",
      );

      const entries = await memoryStore.listEntries("owner_chief", { limit: 10 });
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.title, "Monorepo 包管理偏好");

      // 6. Verify qq_group caller is physically blocked (403) from chief/obsidian routes
      const forbiddenRes = await fetch(`${baseUrl}/v1/chief/agents-md`, {
        headers: qqGroupHeaders,
      });
      assert.equal(forbiddenRes.status, 403);

      const forbiddenPlanRes = await fetch(`${baseUrl}/v1/memory/import-obsidian/plan`, {
        method: "POST",
        headers: qqGroupHeaders,
        body: JSON.stringify({ vaultPath: vaultDir }),
      });
      assert.equal(forbiddenPlanRes.status, 403);

      // 7. Verify authenticated soft-delete HTTP routes (`DELETE /v1/memory/entries/:id` & `POST /v1/memory/delete`)
      const targetId = entries[0]!.id;
      const forbiddenDeleteRes = await fetch(
        `${baseUrl}/v1/memory/entries/${encodeURIComponent(targetId)}`,
        {
          method: "DELETE",
          headers: qqGroupHeaders,
        },
      );
      assert.equal(forbiddenDeleteRes.status, 403);

      const forbiddenPostDeleteRes = await fetch(`${baseUrl}/v1/memory/delete`, {
        method: "POST",
        headers: qqGroupHeaders,
        body: JSON.stringify({ id: targetId }),
      });
      assert.equal(forbiddenPostDeleteRes.status, 403);

      const badDeleteRes = await fetch(`${baseUrl}/v1/memory/delete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "   " }),
      });
      assert.equal(badDeleteRes.status, 400);

      const deleteRes = await fetch(
        `${baseUrl}/v1/memory/entries/${encodeURIComponent(targetId)}`,
        {
          method: "DELETE",
          headers,
        },
      );
      assert.equal(deleteRes.status, 200);
      const deleteJson = (await deleteRes.json()) as {
        ok: boolean;
        id: string;
        deleted: boolean;
        deletedAt: number;
      };
      assert.equal(deleteJson.ok, true);
      assert.equal(deleteJson.id, targetId);
      assert.equal(deleteJson.deleted, true);
      assert.ok(deleteJson.deletedAt > 0);

      // Re-deleting an already soft-deleted entry returns 404.
      const deleteAgainRes = await fetch(
        `${baseUrl}/v1/memory/entries/${encodeURIComponent(targetId)}`,
        {
          method: "DELETE",
          headers,
        },
      );
      assert.equal(deleteAgainRes.status, 404);

      const statsAfterDeleteRes = await fetch(`${baseUrl}/v1/memory/stats`, { headers });
      const statsAfterDeleteJson = (await statsAfterDeleteRes.json()) as { totalEntries: number };
      assert.equal(statsAfterDeleteJson.totalEntries, 0);

      // Verify POST /v1/memory/delete also soft-deletes cleanly.
      const secondEntry = await memoryStore.upsert({
        namespace: "private/chief",
        kind: "fact",
        title: "待软删测试条目",
        content: "验证 POST /v1/memory/delete 路由生效",
        machineId: "test-machine",
      });
      const postDeleteRes = await fetch(`${baseUrl}/v1/memory/delete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: secondEntry.id }),
      });
      assert.equal(postDeleteRes.status, 200);
      const postDeleteJson = (await postDeleteRes.json()) as {
        ok: boolean;
        id: string;
        deleted: boolean;
      };
      assert.equal(postDeleteJson.ok, true);
      assert.equal(postDeleteJson.id, secondEntry.id);
      assert.equal(postDeleteJson.deleted, true);
      assert.equal((await memoryStore.listEntries("owner_chief", { limit: 10 })).length, 0);
    } finally {
      await server.stop();
      ptyPool.dispose();
      await memoryStore.close();
    }
  });
});
