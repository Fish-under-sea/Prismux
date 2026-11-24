import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AgentAuxService,
  AgentAuxValidationError,
  extractBoardMentions
} from "../agentAux/AgentAuxService.js";
import { ChiefThreadManager } from "../chief/ChiefThreadManager.js";
import { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import { DaemonRpcServer } from "../server/DaemonRpcServer.js";
import { PairingManager } from "../server/PairingManager.js";

function withTempRoot(fn: (root: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "prismux-agent-aux-test-"));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      rmSync(dir, { recursive: true, force: true });
    });
}

test("extractBoardMentions mirrors AGY word-start, prefix, and @all rules", () => {
  const names = ["coordinator", "worker-1", "worker-2", "ui-dev"];
  const direct = extractBoardMentions(
    "@coordinator @worker done with email@worker-1.com and @ui-dev!",
    names
  );
  assert.deepEqual(direct.mentions, ["coordinator", "worker-1", "worker-2", "ui-dev"]);
  assert.equal(direct.all, false);

  const broadcast = extractBoardMentions("Heads up @all please sync.", names);
  assert.equal(broadcast.all, true);
  assert.deepEqual(broadcast.mentions, []);
});

test("AgentAuxService reads AGY native swarm from coordinator and worker sessions", async () => {
  await withTempRoot((root) => {
    const appData = join(root, "antigravity");
    const coordId = "11111111-2222-3333-4444-555555555555";
    const workerId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const retiredId = "99999999-8888-7777-6666-555555555555";

    const swarmDir = join(appData, "brain", coordId, ".system_generated", "swarm");
    mkdirSync(swarmDir, { recursive: true });
    mkdirSync(join(appData, "brain", coordId, ".system_generated", "logs"), {
      recursive: true
    });
    mkdirSync(join(appData, "brain", workerId, ".system_generated", "logs"), {
      recursive: true
    });

    writeFileSync(
      join(swarmDir, "members.json"),
      JSON.stringify({
        title: "Prismux 蜂群联调",
        members: {
          coordinator: {
            conversation_id: coordId,
            model: "gemini-2.5-pro",
            role: "coordinator",
            wake_mode: "mentions",
            last_read_seq: 3,
            killed: false
          },
          "agent-ui": {
            conversation_id: workerId,
            model: "claude-sonnet-4-5",
            role: "worker",
            wake_mode: "working",
            last_read_seq: 1,
            killed: false,
            workspace_mode: "share"
          },
          "old-helper": {
            conversation_id: retiredId,
            model: "gemini-2.5-flash",
            role: "worker",
            wake_mode: "mentions",
            last_read_seq: 1,
            killed: true
          }
        }
      }),
      "utf8"
    );

    const boardLines = [
      JSON.stringify({
        seq: 1,
        agent: "coordinator",
        text: "@agent-ui 请构建像素蜜蜂侧边栏组件。",
        time: "2026-11-24 10:00:00"
      }),
      JSON.stringify({
        seq: 2,
        agent: "agent-ui",
        text: "@coordinator 已完成画布绘制，参见 #1。",
        time: "2026-11-24 10:02:00"
      }),
      JSON.stringify({
        seq: 3,
        agent: "coordinator",
        text: "@all 准备联调测试。",
        time: "2026-11-24 10:05:00"
      })
    ];
    writeFileSync(join(swarmDir, "board.jsonl"), `${boardLines.join("\n")}\n`, "utf8");

    writeFileSync(
      join(swarmDir, "plan.json"),
      JSON.stringify({
        goal: { title: "交付原生蜂群侧边栏", line: "实现一比一视觉还原与多 Agent 适配" },
        tasks: { "agent-ui": "像素蜜蜂与图谱视图" },
        threads: [{ id: "t-ui", title: "前端侧边栏", tasks: ["agent-ui"] }]
      }),
      "utf8"
    );

    writeFileSync(
      join(swarmDir, "view.json"),
      JSON.stringify({
        as_of_seq: 3,
        headline: "前端组件绘制中",
        phase: { label: "实现阶段", index: 2, total: 3 },
        workstreams: [
          {
            id: "ws-ui",
            title: "蜂群视图组件",
            owners: ["agent-ui"],
            state: "active",
            note: "正在编写单测"
          }
        ]
      }),
      "utf8"
    );

    // Coordinator ended turn on swarm_wait -> waiting
    writeFileSync(
      join(appData, "brain", coordId, ".system_generated", "logs", "transcript.jsonl"),
      [
        JSON.stringify({
          step_index: 0,
          type: "PLANNER_RESPONSE",
          tool_calls: [{ name: "swarm_wait", args: { since: 3 } }]
        }),
        JSON.stringify({ step_index: 1, type: "GENERIC", status: "DONE" })
      ].join("\n") + "\n",
      "utf8"
    );

    // Worker mid-turn with active toolSummary -> working
    writeFileSync(
      join(appData, "brain", workerId, ".system_generated", "logs", "transcript.jsonl"),
      [
        JSON.stringify({
          step_index: 0,
          type: "PLANNER_RESPONSE",
          thinking: "**Designing SwarmBeeSprite canvas**",
          tool_calls: [
            {
              name: "edit_file",
              args: {
                Path: "\"SwarmBeeSprite.tsx\"",
                toolSummary: "\"Implement 22x18 pixel bee canvas\""
              }
            }
          ]
        })
      ].join("\n") + "\n",
      "utf8"
    );

    const service = new AgentAuxService({
      agyAppDataDirs: [appData],
      claudeHomeDir: join(root, "no-claude"),
      codexHomeDir: join(root, "no-codex")
    });

    // Direct lookup by coordinator sessionId
    const coordSnap = service.inspect({ provider: "antigravity", sessionId: coordId });
    assert.equal(coordSnap.active, true);
    assert.equal(coordSnap.hasLiveWork, true);
    assert.equal(coordSnap.kind, "agy-swarm");
    assert.equal(coordSnap.title, "Prismux 蜂群联调");
    assert.equal(coordSnap.activationKey, `agy-swarm:${coordId}`);
    assert.ok(coordSnap.swarm);
    assert.equal(coordSnap.swarm.selfMember, "coordinator");
    assert.equal(coordSnap.swarm.head, 3);
    assert.equal(coordSnap.swarm.messages.length, 3);
    assert.equal(coordSnap.swarm.plan?.goal?.title, "交付原生蜂群侧边栏");
    assert.equal(coordSnap.swarm.view?.headline, "前端组件绘制中");

    const coordMember = coordSnap.swarm.members.find((m) => m.name === "coordinator");
    const uiMember = coordSnap.swarm.members.find((m) => m.name === "agent-ui");
    const retiredMember = coordSnap.swarm.members.find((m) => m.name === "old-helper");
    assert.equal(coordMember?.status, "waiting");
    assert.equal(uiMember?.status, "working");
    assert.equal(uiMember?.activity, "Implement 22x18 pixel bee canvas");
    assert.equal(uiMember?.unread, 2);
    assert.equal(retiredMember?.status, "killed");
    assert.ok(
      coordSnap.swarm.edges.some(
        (e) => e.from === "coordinator" && e.to === "agent-ui" && e.direct === 1
      )
    );

    // Reverse lookup by worker conversation_id
    const workerSnap = service.inspect({ provider: "agy", sessionId: workerId });
    assert.equal(workerSnap.active, true);
    assert.equal(workerSnap.kind, "agy-swarm");
    assert.equal(workerSnap.swarm?.id, coordId);
    assert.equal(workerSnap.swarm?.selfMember, "agent-ui");
  });
});

test("AgentAuxService detects AGY detached subagents with transcript steps", async () => {
  await withTempRoot((root) => {
    const appData = join(root, "antigravity-acp");
    const parentId = "12345678-1234-1234-1234-1234567890ab";
    const childId = "abcdef12-3456-7890-abcd-ef1234567890";

    const subDir = join(appData, "brain", parentId, ".system_generated", "subagents");
    mkdirSync(subDir, { recursive: true });
    mkdirSync(join(appData, "brain", childId, ".system_generated", "logs"), {
      recursive: true
    });

    writeFileSync(
      join(subDir, `${childId}.json`),
      JSON.stringify({
        conversationId: childId,
        state: "RUNNING",
        subagentDescriptor: { role: "code-auditor" }
      }),
      "utf8"
    );

    writeFileSync(
      join(appData, "brain", childId, ".system_generated", "logs", "transcript.jsonl"),
      JSON.stringify({
        step_index: 0,
        type: "PLANNER_RESPONSE",
        content: "Auditing files...",
        tool_calls: [{ name: "read_file", args: { Path: "\"src/index.ts\"" } }]
      }) + "\n",
      "utf8"
    );

    const service = new AgentAuxService({
      agyAppDataDirs: [appData],
      claudeHomeDir: join(root, "no-claude"),
      codexHomeDir: join(root, "no-codex")
    });

    const snap = service.inspect({ provider: "antigravity", sessionId: parentId });
    assert.equal(snap.active, true);
    assert.equal(snap.kind, "agy-subagents");
    assert.equal(snap.agySubagents?.length, 1);
    assert.equal(snap.agySubagents?.[0]?.role, "code-auditor");
    assert.equal(snap.agySubagents?.[0]?.status, "working");
    assert.equal(snap.agySubagents?.[0]?.steps.length, 1);
  });
});

test("AgentAuxService reads Claude Code teams, inboxes, and shared tasks with strict project isolation", async () => {
  await withTempRoot((root) => {
    const claudeHome = join(root, ".claude");
    const projectA = join(root, "repo-alpha");
    const projectB = join(root, "repo-beta");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });

    const teamDir = join(claudeHome, "teams", "alpha-squad");
    const inboxDir = join(teamDir, "inboxes");
    const tasksDir = join(claudeHome, "tasks", "alpha-squad");
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(tasksDir, { recursive: true });

    writeFileSync(
      join(teamDir, "config.json"),
      JSON.stringify({
        name: "alpha-squad",
        description: "重构认证模块团队",
        leadSessionId: "cc-session-alpha",
        leadAgentId: "lead@alpha-squad",
        members: [
          {
            agentId: "lead@alpha-squad",
            name: "team-lead",
            agentType: "team-lead",
            model: "claude-opus-4-6",
            color: "amber",
            cwd: projectA,
            backendType: "in-process",
            status: "working"
          },
          {
            agentId: "reviewer@alpha-squad",
            name: "security-reviewer",
            agentType: "reviewer",
            model: "claude-sonnet-4-6",
            color: "cyan",
            cwd: projectA,
            backendType: "tmux",
            status: "idle"
          }
        ]
      }),
      "utf8"
    );

    writeFileSync(
      join(inboxDir, "security-reviewer.json"),
      JSON.stringify([
        {
          from: "team-lead",
          text: "请审计 OAuth 回调校验逻辑。",
          summary: "请求安全审计",
          timestamp: "2026-11-24T09:00:00Z",
          read: false
        }
      ]),
      "utf8"
    );

    writeFileSync(
      join(inboxDir, "team-lead.json"),
      JSON.stringify([
        {
          from: "security-reviewer",
          text: "@team-lead 已完成检查，发现 1 处 state 参数校验缺失。",
          summary: "安全检查反馈",
          timestamp: "2026-11-24T09:05:00Z",
          read: true
        }
      ]),
      "utf8"
    );

    writeFileSync(
      join(tasksDir, "1.json"),
      JSON.stringify({
        id: "1",
        subject: "修复 OAuth state 校验",
        description: "补齐 CSRF state 校验并新增单测",
        status: "in_progress",
        owner: "team-lead",
        blockedBy: []
      }),
      "utf8"
    );

    writeFileSync(
      join(tasksDir, "2.json"),
      JSON.stringify({
        id: "2",
        subject: "发布回归验证",
        description: "等待任务 #1 完成后回归",
        status: "pending",
        owner: "security-reviewer",
        blockedBy: ["1"]
      }),
      "utf8"
    );

    const service = new AgentAuxService({
      agyAppDataDirs: [],
      claudeHomeDir: claudeHome,
      codexHomeDir: join(root, "no-codex")
    });

    // Matched by cwd
    const matched = service.inspect({ provider: "claudeAgent", cwd: projectA });
    assert.equal(matched.active, true);
    assert.equal(matched.hasLiveWork, true);
    assert.equal(matched.kind, "claude-team");
    assert.equal(matched.claudeTeam?.teamName, "alpha-squad");
    assert.equal(matched.claudeTeam?.members.length, 2);
    assert.equal(matched.claudeTeam?.messages.length, 2);
    assert.equal(matched.claudeTeam?.messages[0]?.agent, "team-lead");
    assert.equal(matched.claudeTeam?.messages[0]?.recipient, "security-reviewer");
    assert.equal(matched.claudeTeam?.messages[1]?.agent, "security-reviewer");
    assert.equal(matched.tasks?.length, 2);
    assert.equal(matched.tasks?.[1]?.status, "blocked");
    assert.deepEqual(matched.tasks?.[1]?.blockedBy, ["1"]);

    // Unrelated project MUST NOT leak alpha-squad!
    const unrelated = service.inspect({
      provider: "claudeAgent",
      sessionId: "cc-session-other",
      cwd: projectB
    });
    assert.equal(unrelated.active, false);
    assert.equal(unrelated.kind, null);
    assert.equal(unrelated.claudeTeam, undefined);
  });
});

test("AgentAuxService reads Codex read-only goals_1.sqlite and state_5.sqlite spawn edges", async () => {
  await withTempRoot((root) => {
    const codexHome = join(root, ".codex");
    mkdirSync(codexHome, { recursive: true });

    const parentThread = "codex-thread-parent-1";
    const childThread = "codex-thread-child-1";

    const goalsDb = new DatabaseSync(join(codexHome, "goals_1.sqlite"));
    goalsDb.exec(`
      CREATE TABLE thread_goals (
        thread_id TEXT PRIMARY KEY NOT NULL,
        goal_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        token_budget INTEGER,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        time_used_seconds INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `);
    goalsDb
      .prepare(
        "INSERT INTO thread_goals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        parentThread,
        "goal-101",
        "完成 Prismux 多代理侧边栏适配",
        "active",
        100000,
        25000,
        120,
        1700000000000,
        1700000120000
      );
    goalsDb.close();

    const stateDb = new DatabaseSync(join(codexHome, "state_5.sqlite"));
    stateDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        agent_nickname TEXT,
        agent_role TEXT,
        model TEXT,
        reasoning_effort TEXT,
        cwd TEXT NOT NULL,
        updated_at_ms INTEGER
      );
      CREATE TABLE thread_spawn_edges (
        parent_thread_id TEXT NOT NULL,
        child_thread_id TEXT NOT NULL PRIMARY KEY,
        status TEXT NOT NULL
      );
    `);
    stateDb
      .prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        childThread,
        "检查类型定义",
        "verifier",
        "reviewer",
        "gpt-5.3-codex",
        "high",
        root,
        1700000120000
      );
    stateDb
      .prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, ?)")
      .run(parentThread, childThread, "running");
    stateDb.close();

    const service = new AgentAuxService({
      agyAppDataDirs: [],
      claudeHomeDir: join(root, "no-claude"),
      codexHomeDir: codexHome
    });

    const snap = service.inspect({ provider: "codex", sessionId: parentThread });
    assert.equal(snap.active, true);
    assert.equal(snap.hasLiveWork, true);
    assert.equal(snap.kind, "codex-collab");
    assert.equal(snap.codex?.goals.length, 1);
    assert.equal(snap.codex?.spawnedThreads.length, 1);
    assert.equal(snap.codex?.spawnedThreads[0]?.nickname, "verifier");
    assert.equal(snap.tasks?.length, 1);
    assert.equal(snap.tasks?.[0]?.progressLabel, "25%");
  });
});

test("AgentAuxService rejects path traversal and serves HTTP GET /v1/agent-aux/inspect", async () => {
  await withTempRoot(async (root) => {
    const appData = join(root, "antigravity");
    const coordId = "22222222-3333-4444-5555-666666666666";
    const swarmDir = join(appData, "brain", coordId, ".system_generated", "swarm");
    mkdirSync(swarmDir, { recursive: true });
    writeFileSync(
      join(swarmDir, "members.json"),
      JSON.stringify({
        title: "HTTP 集成蜂群",
        members: {
          coordinator: {
            conversation_id: coordId,
            role: "coordinator",
            model: "gemini-2.5-pro",
            wake_mode: "working",
            killed: false
          }
        }
      }),
      "utf8"
    );

    const service = new AgentAuxService({
      agyAppDataDirs: [appData],
      claudeHomeDir: join(root, "no-claude"),
      codexHomeDir: join(root, "no-codex")
    });

    for (const badId of ["../etc/passwd", "..\\windows", "foo/bar", "bad%20id", ".hidden"]) {
      assert.throws(
        () => service.inspect({ provider: "antigravity", sessionId: badId }),
        (err: unknown) =>
          err instanceof AgentAuxValidationError && err.statusCode === 400
      );
    }

    const inactive = service.inspect({
      provider: "antigravity",
      sessionId: "00000000-0000-0000-0000-000000000000"
    });
    assert.equal(inactive.active, false);
    assert.equal(inactive.kind, null);

    const ptyPool = new PersistentPtyPool();
    const chiefManager = new ChiefThreadManager({
      dataDir: join(root, "daemon-data"),
      defaultProvider: "codex"
    });
    const pairingManager = new PairingManager({ initialAuthToken: "test-aux-token" });
    const server = new DaemonRpcServer({
      host: "127.0.0.1",
      port: 0,
      headless: true,
      ptyPool,
      chiefManager,
      pairingManager,
      agentAuxService: service
    });

    await server.start();
    try {
      const base = server.getHttpUrl();

      // Unauthorized
      const unauth = await fetch(`${base}/v1/agent-aux/inspect?sessionId=${coordId}`);
      assert.equal(unauth.status, 401);

      // Path traversal rejected with HTTP 400
      const badRes = await fetch(
        `${base}/v1/agent-aux/inspect?provider=antigravity&sessionId=${encodeURIComponent("../secret")}`,
        { headers: { Authorization: "Bearer test-aux-token" } }
      );
      assert.equal(badRes.status, 400);

      // Valid swarm inspection returns HTTP 200
      const okRes = await fetch(
        `${base}/v1/agent-aux/inspect?provider=antigravity&sessionId=${coordId}`,
        { headers: { Authorization: "Bearer test-aux-token" } }
      );
      assert.equal(okRes.status, 200);
      const payload = (await okRes.json()) as {
        ok: boolean;
        active: boolean;
        kind: string;
        title: string;
      };
      assert.equal(payload.ok, true);
      assert.equal(payload.active, true);
      assert.equal(payload.kind, "agy-swarm");
      assert.equal(payload.title, "HTTP 集成蜂群");
    } finally {
      await server.stop();
      ptyPool.dispose();
    }
  });
});
