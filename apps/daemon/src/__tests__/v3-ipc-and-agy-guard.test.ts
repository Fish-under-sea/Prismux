import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { SqliteMemoryStore } from "@prismux/memory-core";
import type { PrismuxDispatchEnvelope } from "@prismux/protocol";
import {
  AntigravityGuardDeniedError,
  AntigravityPolicyError,
  AntigravityPolicyGuard,
  AntigravityPolicyStore,
  ArtifactResultBackdoor,
  DesktopIpcDispatchHub,
  OvernightFactory,
  OvernightRouteService,
  PrismuxDaemon,
  TaskDispatchRouter,
  type OutboundMailPayload,
  type OutboundMailReceipt
} from "../index.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      await fn();
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
}

function initTempGitRepo(rootDir: string, name = "demo-repo"): string {
  const repoDir = join(rootDir, name);
  mkdirSync(repoDir, { recursive: true });
  runGit(repoDir, ["init", "-b", "main"]);
  runGit(repoDir, ["config", "user.name", "Prismux Test"]);
  runGit(repoDir, ["config", "user.email", "test@prismux.local"]);
  writeFileSync(
    join(repoDir, "app.mjs"),
    "export function greet(name) {\n  return `hi ${name}`;\n}\n",
    "utf8"
  );
  runGit(repoDir, ["add", "app.mjs"]);
  runGit(repoDir, ["commit", "-m", "chore: initial commit"]);
  return repoDir;
}

interface ParsedSseEvent {
  id?: string;
  event: string;
  data: unknown;
}

async function openSseClient(
  url: string,
  headers: Record<string, string>
): Promise<{
  events: ParsedSseEvent[];
  waitForEvent: (
    predicate: (evt: ParsedSseEvent) => boolean,
    timeoutMs?: number
  ) => Promise<ParsedSseEvent>;
  close: () => void;
}> {
  const events: ParsedSseEvent[] = [];
  const waiters: Array<() => void> = [];

  const notify = () => {
    while (waiters.length > 0) {
      waiters.shift()?.();
    }
  };

  let reqRef: http.ClientRequest | undefined;
  let resRef: http.IncomingMessage | undefined;

  await new Promise<void>((resolveReady, rejectReady) => {
    const req = http.get(url, { headers }, (res) => {
      resRef = res;
      if (res.statusCode !== 200) {
        rejectReady(new Error(`Expected SSE 200, got ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let sepIdx = buffer.indexOf("\n\n");
        while (sepIdx >= 0) {
          const block = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          sepIdx = buffer.indexOf("\n\n");
          if (block.trim().length === 0 || block.trim().startsWith(":")) {
            continue;
          }
          let id: string | undefined;
          let event = "message";
          const dataLines: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith("id:")) {
              id = line.slice(3).trim();
            } else if (line.startsWith("event:")) {
              event = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }
          const rawData = dataLines.join("\n");
          let parsedData: unknown = rawData;
          try {
            parsedData = JSON.parse(rawData);
          } catch {
            // Keep plain string
          }
          events.push({ id, event, data: parsedData });
          notify();
        }
      });
      resolveReady();
    });
    reqRef = req;
    req.once("error", rejectReady);
  });

  const close = () => {
    try {
      resRef?.destroy();
    } catch {
      // ignore
    }
    try {
      reqRef?.destroy();
    } catch {
      // ignore
    }
  };

  const waitForEvent = async (
    predicate: (evt: ParsedSseEvent) => boolean,
    timeoutMs = 3_000
  ): Promise<ParsedSseEvent> => {
    const existing = events.find(predicate);
    if (existing) return existing;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(resolveWait, 40);
        waiters.push(() => {
          clearTimeout(timer);
          resolveWait();
        });
      });
      const match = events.find(predicate);
      if (match) return match;
    }
    throw new Error(
      `Timed out waiting for SSE event. Seen events: ${events.map((e) => e.event).join(", ")}`
    );
  };

  return { events, waitForEvent, close };
}

describe("Prismux v3 IPC Dispatch Hub + AGY Hard-Lock Role Guard + Double Backdoors", () => {
  test("AntigravityPolicyStore persists fail-closed defaults, enforces disclaimerAccepted === true, and survives reload", () => {
    const dataDir = makeTempDir("pmx-agy-policy-");
    const store = new AntigravityPolicyStore({ dataDir });

    const initial = store.getPolicy();
    assert.deepEqual(initial, {
      allowAntigravityAsControlledAgent: false,
      disclaimerAcceptedAt: null,
      disclaimerVersion: null,
      defaultLocked: true
    });

    // Attempting to unlock without disclaimerAccepted === true MUST fail with 400 AGY_DISCLAIMER_REQUIRED
    assert.throws(
      () => store.updatePolicy({ allowAntigravityAsControlledAgent: true }),
      (err: unknown) =>
        err instanceof AntigravityPolicyError &&
        err.statusCode === 400 &&
        err.code === "AGY_DISCLAIMER_REQUIRED"
    );
    assert.throws(
      () =>
        store.updatePolicy({
          allowAntigravityAsControlledAgent: true,
          disclaimerAccepted: false
        }),
      (err: unknown) =>
        err instanceof AntigravityPolicyError &&
        err.statusCode === 400 &&
        err.code === "AGY_DISCLAIMER_REQUIRED"
    );

    // Explicit disclaimer unlocks & persists to <dataDir>/config/antigravity-policy.json
    const unlocked = store.updatePolicy({
      allowAntigravityAsControlledAgent: true,
      disclaimerAccepted: true,
      disclaimerVersion: "v3-2026"
    });
    assert.equal(unlocked.allowAntigravityAsControlledAgent, true);
    assert.equal(unlocked.disclaimerVersion, "v3-2026");
    assert.equal(unlocked.defaultLocked, true);
    assert.ok(typeof unlocked.disclaimerAcceptedAt === "string");

    const expectedPath = join(dataDir, "config", "subscription-waiver.json");
    assert.equal(store.getFilePath(), expectedPath);
    assert.equal(existsSync(expectedPath), true);

    const reloadedStore = new AntigravityPolicyStore({ dataDir });
    assert.equal(
      reloadedStore.getPolicy().allowAntigravityAsControlledAgent,
      true
    );
    assert.equal(reloadedStore.getPolicy().disclaimerVersion, "v3-2026");

    // Re-locking immediately clears unlocked state
    const relocked = reloadedStore.updatePolicy({
      allowAntigravityAsControlledAgent: false
    });
    assert.deepEqual(relocked, {
      allowAntigravityAsControlledAgent: false,
      disclaimerAcceptedAt: null,
      disclaimerVersion: null,
      defaultLocked: true
    });

    // Fail-closed on tampered JSON (`true` without disclaimer metadata)
    writeFileSync(
      expectedPath,
      JSON.stringify({ allowAntigravityAsControlledAgent: true }),
      "utf8"
    );
    assert.equal(
      reloadedStore.reload().allowAntigravityAsControlledAgent,
      false
    );
  });

  test("AntigravityPolicyGuard enforces complete role hard-lock matrix", () => {
    const dataDir = makeTempDir("pmx-agy-guard-");
    const store = new AntigravityPolicyStore({ dataDir });
    const guard = new AntigravityPolicyGuard(store);

    // 1. Human desktop commanding personal AGY -> 100% ALLOWED (`mode: "send"`)
    const humanToAgy = guard.evaluateDispatch({
      callerKind: "human_desktop",
      targetProvider: "antigravity"
    });
    assert.equal(humanToAgy.allowed, true);
    assert.equal(humanToAgy.decision, "allow");
    assert.equal(humanToAgy.mode, "send");
    assert.equal(humanToAgy.requiresHumanConfirmation, false);

    // 2. AGY commander dispatching outward to Codex / Claude Code / OpenCode / DSH -> 100% ALLOWED
    for (const worker of ["codex", "claudeAgent", "claude-code", "opencode", "dsh"]) {
      const outward = guard.evaluateDispatch({
        callerKind: "antigravity_commander",
        targetProvider: worker
      });
      assert.equal(outward.allowed, true, `outward to ${worker}`);
      assert.equal(outward.mode, "send");
      assert.equal(outward.requiresHumanConfirmation, false);
    }

    // 3. Unattended cron & overnight_factory targeting AGY -> ALWAYS hard-denied (403 AGY_UNATTENDED_FORBIDDEN)
    for (const unattended of ["cron", "overnight_factory"] as const) {
      const denied = guard.evaluateDispatch({
        callerKind: unattended,
        targetProvider: "antigravity"
      });
      assert.equal(denied.allowed, false);
      assert.equal(denied.decision, "deny");
      assert.equal(denied.httpStatus, 403);
      assert.equal(denied.code, "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");
      assert.equal(denied.reasonCode, "AGY_UNATTENDED_FORBIDDEN");
    }

    // 4. Other AI agents / scripts / post-stop loop targeting AGY -> hard-denied when locked (403 AGY_CONTROLLED_AGENT_LOCKED)
    for (const automated of [
      "agent_subtask",
      "internal_script",
      "post_stop_loop"
    ] as const) {
      const denied = guard.evaluateDispatch({
        callerKind: automated,
        targetProvider: "agy"
      });
      assert.equal(denied.allowed, false);
      assert.equal(denied.httpStatus, 403);
      assert.equal(denied.code, "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");
      assert.equal(denied.reasonCode, "AGY_CONTROLLED_AGENT_LOCKED");
    }

    // 5. Remote secretary (QQ / Gmail) requesting personal AGY -> NEVER auto-send; forced Draft-Only
    for (const remote of ["secretary_qq", "secretary_gmail"] as const) {
      const staged = guard.evaluateDispatch({
        callerKind: remote,
        targetProvider: "antigravity",
        explicitAntigravityRequested: true
      });
      assert.equal(staged.allowed, true);
      assert.equal(staged.decision, "stage_draft_only");
      assert.equal(staged.mode, "draft_only");
      assert.equal(staged.status, "awaiting_human_confirmation");
      assert.equal(staged.requiresHumanConfirmation, true);
    }

    // 6. Unlock controlled toggle WITH disclaimer -> cron & overnight_factory STILL hard-denied!
    //    Stop-hook callback STILL blocked without human confirmation!
    //    Remote secretary STILL forced Draft-Only!
    store.updatePolicy({
      allowAntigravityAsControlledAgent: true,
      disclaimerAccepted: true,
      disclaimerVersion: "v3-2026"
    });

    const cronStillDenied = guard.evaluateDispatch({
      callerKind: "cron",
      targetProvider: "antigravity"
    });
    assert.equal(cronStillDenied.allowed, false);
    assert.equal(cronStillDenied.code, "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");
    assert.equal(cronStillDenied.reasonCode, "AGY_UNATTENDED_FORBIDDEN");
    assert.equal(cronStillDenied.httpStatus, 403);

    const overnightStillDenied = guard.evaluateDispatch({
      callerKind: "overnight_factory",
      targetProvider: "antigravity"
    });
    assert.equal(overnightStillDenied.allowed, false);
    assert.equal(overnightStillDenied.code, "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");
    assert.equal(overnightStillDenied.reasonCode, "AGY_UNATTENDED_FORBIDDEN");

    const stopHookStillDenied = guard.evaluateStopHookCallback("antigravity", {
      humanConfirmed: false
    });
    assert.equal(stopHookStillDenied.allowed, false);
    assert.equal(stopHookStillDenied.httpStatus, 403);
    assert.equal(stopHookStillDenied.code, "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");
    assert.equal(stopHookStillDenied.reasonCode, "AGY_HUMAN_CONFIRMATION_REQUIRED");

    const qqStillDraftOnly = guard.evaluateDispatch({
      callerKind: "secretary_qq",
      targetProvider: "antigravity",
      explicitAntigravityRequested: true
    });
    assert.equal(qqStillDraftOnly.decision, "stage_draft_only");
    assert.equal(qqStillDraftOnly.mode, "draft_only");
    assert.equal(qqStillDraftOnly.requiresHumanConfirmation, true);

    const subtaskUnlocked = guard.evaluateDispatch({
      callerKind: "agent_subtask",
      targetProvider: "antigravity"
    });
    assert.equal(subtaskUnlocked.allowed, true);
    assert.equal(subtaskUnlocked.mode, "send");

    // 7. Confirmation guard ONLY accepts "human_desktop"
    assert.equal(
      guard.assertHumanDesktopConfirmation("human_desktop"),
      "human_desktop"
    );
    assert.throws(
      () => guard.assertHumanDesktopConfirmation("secretary_qq"),
      (err: unknown) =>
        err instanceof AntigravityGuardDeniedError &&
        err.statusCode === 403 &&
        err.code === "AGY_HUMAN_CONFIRMATION_REQUIRED"
    );
  });

  test("TaskDispatchRouter implements Parameter Backdoor & difficulty routing cleanly", () => {
    const router = new TaskDispatchRouter();

    // backend_standard -> codex / gpt-6.2-sol / medium
    const std = router.route({
      prompt: "Add health endpoint validation",
      callerKind: "human_desktop",
      taskCategory: "backend_standard"
    });
    assert.equal(std.provider, "codex");
    assert.equal(std.modelId, "gpt-6.2-sol");
    assert.equal(std.reasoningEffort, "medium");

    // backend_hard -> codex / gpt-6.2-astra / high
    const hard = router.route({
      prompt: "Resolve distributed deadlock in worker queue",
      callerKind: "antigravity_commander",
      taskCategory: "backend_hard"
    });
    assert.equal(hard.provider, "codex");
    assert.equal(hard.modelId, "gpt-6.2-astra");
    assert.equal(hard.reasoningEffort, "high");

    // frontend / planning from human_desktop -> antigravity commander
    const desktopFrontend = router.route({
      prompt: "Polish liquid glass sidebar styling",
      callerKind: "human_desktop",
      taskCategory: "frontend"
    });
    assert.equal(desktopFrontend.provider, "antigravity");

    const desktopPlanning = router.route({
      prompt: "Plan v0.2.0 architecture",
      callerKind: "human_desktop",
      taskCategory: "planning"
    });
    assert.equal(desktopPlanning.provider, "antigravity");

    // frontend / planning from remote secretary WITHOUT explicit AGY -> automated worker (NO AGY!)
    const remoteFrontend = router.route({
      prompt: "帮我优化按钮样式和弹窗布局",
      callerKind: "secretary_qq",
      taskCategory: "frontend"
    });
    assert.equal(remoteFrontend.provider, "codex");
    assert.equal(remoteFrontend.explicitAntigravityRequested, false);

    // Explicit provider/model/effort overrides respected
    const override = router.route({
      prompt: "Refactor auth middleware",
      callerKind: "secretary_gmail",
      provider: "claudeAgent",
      modelId: "claude-opus-4-6",
      reasoningEffort: "xhigh"
    });
    assert.equal(override.provider, "claudeAgent");
    assert.equal(override.modelId, "claude-opus-4-6");
    assert.equal(override.reasoningEffort, "xhigh");
  });

  test("ArtifactResultBackdoor extracts git diff --numstat + plain Chinese summary and blocks AGY Stop-hook callbacks", () => {
    const rootDir = makeTempDir("pmx-artifact-");
    const repoDir = initTempGitRepo(rootDir, "artifact-repo");

    // Modify tracked file + create untracked file
    writeFileSync(
      join(repoDir, "app.mjs"),
      "export function greet(name) {\n  const clean = String(name).trim();\n  return `hello ${clean}`;\n}\n",
      "utf8"
    );
    writeFileSync(join(repoDir, "notes.txt"), "release note\n", "utf8");

    const policyStore = new AntigravityPolicyStore({ dataDir: rootDir });
    const policyGuard = new AntigravityPolicyGuard(policyStore);
    const backdoor = new ArtifactResultBackdoor({ policyGuard });

    const artifact = backdoor.extractArtifact({
      taskId: "task-art-1",
      threadId: "thread-art-1",
      workspacePath: repoDir,
      finalAssistantText: "已修复 greet() 的空白裁剪逻辑并补充 notes.txt 说明。",
      branchName: "factory/demo",
      testPassed: true
    });

    assert.equal(artifact.taskId, "task-art-1");
    assert.equal(artifact.threadId, "thread-art-1");
    assert.ok(artifact.modifiedFiles.includes("app.mjs"));
    assert.ok(artifact.modifiedFiles.includes("notes.txt"));
    assert.equal(artifact.diffStats.filesChanged, 2);
    assert.equal(artifact.diffStats.insertions, 2);
    assert.equal(artifact.diffStats.deletions, 1);
    assert.match(artifact.plainLanguageSummary, /已完成交付/);
    assert.match(artifact.plainLanguageSummary, /单测已通过/);

    const qqReply = backdoor.formatDirectReply(artifact, "qq");
    assert.match(qqReply, /任务完工直达回执/);
    assert.match(qqReply, /\+2 \/ -1/);

    // Stop-hook callback guard MUST block auto-re-invoking personal AGY
    assert.throws(
      () => backdoor.assertStopCallbackAllowed("antigravity"),
      (err: unknown) =>
        err instanceof AntigravityGuardDeniedError &&
        err.statusCode === 403 &&
        err.code === "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED" &&
        err.reasonCode === "AGY_CONTROLLED_AGENT_LOCKED"
    );
    // Allowed for automated worker callback
    assert.equal(backdoor.assertStopCallbackAllowed("codex").allowed, true);
  });

  test("End-to-end PrismuxDaemon HTTP + SSE dispatch hub: policy endpoints, SSE push, offline queueing, human confirm/cancel, and Artifact completion", async () => {
    const dataDir = makeTempDir("pmx-dispatch-daemon-");
    const repoDir = initTempGitRepo(dataDir, "live-workspace");
    const token = "v3-dispatch-test-token";

    const daemon = new PrismuxDaemon({
      headless: true,
      dataDir,
      host: "127.0.0.1",
      port: 0,
      authToken: token,
      disableAutoUpdateCheck: true
    });
    const ready = await daemon.start();
    cleanups.push(() => daemon.stop());

    // Register a non-owner scoped token to verify scope isolation on /v1/security & /v1/dispatch
    const groupToken = "qq-group-scoped-token";
    daemon.pairingManager.registerScopedToken(
      groupToken,
      "qq_group:777",
      "qq-group-777"
    );

    const authHeaders = {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };

    // 1. Policy GET/PUT validation & scope check
    const unauthPolicy = await fetch(
      `${ready.httpUrl}/v1/security/antigravity-policy`
    );
    assert.equal(unauthPolicy.status, 401);

    const groupPolicy = await fetch(
      `${ready.httpUrl}/v1/security/antigravity-policy`,
      { headers: { Authorization: `Bearer ${groupToken}` } }
    );
    assert.equal(groupPolicy.status, 403);

    const getPolicyRes = await fetch(
      `${ready.httpUrl}/v1/security/antigravity-policy`,
      { headers: authHeaders }
    );
    assert.equal(getPolicyRes.status, 200);
    const policyJson = (await getPolicyRes.json()) as {
      allowAntigravityAsControlledAgent: boolean;
      disclaimerAcceptedAt: string | null;
      disclaimerVersion: string | null;
      defaultLocked: boolean;
    };
    assert.equal(policyJson.allowAntigravityAsControlledAgent, false);
    assert.equal(policyJson.disclaimerAcceptedAt, null);
    assert.equal(policyJson.disclaimerVersion, null);
    assert.equal(policyJson.defaultLocked, true);

    const badUnlockRes = await fetch(
      `${ready.httpUrl}/v1/security/antigravity-policy`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ allowAntigravityAsControlledAgent: true })
      }
    );
    assert.equal(badUnlockRes.status, 400);
    const badUnlockJson = (await badUnlockRes.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(badUnlockJson.error.code, "AGY_DISCLAIMER_REQUIRED");

    // 2. Hard-deny unattended cron targeting AGY (HTTP 403 AGY_UNATTENDED_FORBIDDEN)
    const cronDenyRes = await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        prompt: "Run nightly cleanup",
        workspacePath: repoDir,
        callerKind: "cron",
        provider: "antigravity"
      })
    });
    assert.equal(cronDenyRes.status, 403);
    const cronDenyJson = (await cronDenyRes.json()) as {
      error: { code: string };
    };
    assert.equal(cronDenyJson.error.code, "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");

    // 3. Hard-deny agent_subtask targeting AGY while locked (HTTP 403 AGY_CONTROLLED_AGENT_LOCKED)
    const subtaskDenyRes = await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        prompt: "Callback commander automatically",
        workspacePath: repoDir,
        callerKind: "agent_subtask",
        provider: "antigravity"
      })
    });
    assert.equal(subtaskDenyRes.status, 403);
    const subtaskDenyJson = (await subtaskDenyRes.json()) as {
      error: { code: string };
    };
    assert.equal(subtaskDenyJson.error.code, "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");

    // 4. Offline queueing (tray / locked screen / no SSE renderer connected yet):
    //    Dispatch a QQ remote personal-AGY request -> HTTP 202 Draft-Only staged & queued!
    const qqDraftRes = await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        taskId: "qq-agy-draft-001",
        prompt: "请用个人版 Antigravity 重新设计工作台侧边栏",
        workspacePath: repoDir,
        worktreePath: join(repoDir, ".worktree-qq-draft"),
        callerKind: "secretary_qq",
        provider: "antigravity",
        explicitAntigravityRequested: true,
        memoryContextSummary: "[workspace/prismux] 液态玻璃四区透明度规范",
        replyChannel: { kind: "qq", targetId: "10001" }
      })
    });
    assert.equal(qqDraftRes.status, 202);
    const qqDraftJson = (await qqDraftRes.json()) as {
      ok: boolean;
      queuedForRenderer: boolean;
      envelope: PrismuxDispatchEnvelope;
    };
    assert.equal(qqDraftJson.ok, true);
    assert.equal(qqDraftJson.queuedForRenderer, true);
    assert.equal(qqDraftJson.envelope.mode, "draft_only");
    assert.equal(qqDraftJson.envelope.status, "awaiting_human_confirmation");
    assert.equal(qqDraftJson.envelope.requiresHumanConfirmation, true);

    // 5. Connect SSE client -> immediately receives `connected` + flushed queued `dispatch_thread`!
    const sse = await openSseClient(
      `${ready.httpUrl}/v1/dispatch/events?token=${encodeURIComponent(token)}`,
      {}
    );
    cleanups.push(() => sse.close());

    await sse.waitForEvent((e) => e.event === "connected");
    const flushedDraftEvt = await sse.waitForEvent(
      (e) =>
        e.event === "dispatch_thread" &&
        (e.data as PrismuxDispatchEnvelope).taskId === "qq-agy-draft-001"
    );
    const flushedEnvelope = flushedDraftEvt.data as PrismuxDispatchEnvelope;
    assert.equal(flushedEnvelope.mode, "draft_only");
    assert.equal(flushedEnvelope.status, "awaiting_human_confirmation");
    assert.equal(flushedEnvelope.requiresHumanConfirmation, true);

    // 6. GET /v1/dispatch/tasks lists the awaiting_human_confirmation draft
    const tasksRes = await fetch(
      `${ready.httpUrl}/v1/dispatch/tasks?status=awaiting_human_confirmation`,
      { headers: authHeaders }
    );
    assert.equal(tasksRes.status, 200);
    const tasksJson = (await tasksRes.json()) as {
      ok: boolean;
      total: number;
      awaitingConfirmationCount: number;
      tasks: PrismuxDispatchEnvelope[];
    };
    assert.equal(tasksJson.total, 1);
    assert.equal(tasksJson.awaitingConfirmationCount, 1);
    assert.equal(tasksJson.tasks[0]?.taskId, "qq-agy-draft-001");

    // 7. Non-human confirmation attempt MUST fail with HTTP 403
    const badConfirmRes = await fetch(
      `${ready.httpUrl}/v1/dispatch/qq-agy-draft-001/confirm`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ confirmedBy: "secretary_qq" })
      }
    );
    assert.equal(badConfirmRes.status, 403);
    const badConfirmJson = (await badConfirmRes.json()) as {
      error: { code: string };
    };
    assert.equal(badConfirmJson.error.code, "AGY_HUMAN_CONFIRMATION_REQUIRED");

    // 8. Human desktop confirmation unlocks Draft-Only -> `confirmed_sent` & emits `dispatch_confirmed`
    const okConfirmRes = await fetch(
      `${ready.httpUrl}/v1/dispatch/qq-agy-draft-001/confirm`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ confirmedBy: "human_desktop" })
      }
    );
    assert.equal(okConfirmRes.status, 200);
    const okConfirmJson = (await okConfirmRes.json()) as {
      ok: boolean;
      envelope: PrismuxDispatchEnvelope;
    };
    assert.equal(okConfirmJson.envelope.status, "confirmed_sent");
    assert.equal(okConfirmJson.envelope.mode, "send");
    assert.equal(okConfirmJson.envelope.confirmedBy, "human_desktop");

    const confirmedEvt = await sse.waitForEvent(
      (e) =>
        e.event === "dispatch_confirmed" &&
        (e.data as PrismuxDispatchEnvelope).taskId === "qq-agy-draft-001"
    );
    assert.equal(
      (confirmedEvt.data as PrismuxDispatchEnvelope).status,
      "confirmed_sent"
    );

    // 9. Stage another draft and cancel it via POST /v1/dispatch/:taskId/cancel
    await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        taskId: "qq-agy-draft-cancel",
        prompt: "用 AGY 试试看",
        workspacePath: repoDir,
        callerKind: "secretary_gmail",
        provider: "antigravity"
      })
    });
    const cancelRes = await fetch(
      `${ready.httpUrl}/v1/dispatch/qq-agy-draft-cancel/cancel`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ reason: "主人已取消" })
      }
    );
    assert.equal(cancelRes.status, 200);
    const cancelledEvt = await sse.waitForEvent(
      (e) =>
        e.event === "dispatch_cancelled" &&
        (e.data as PrismuxDispatchEnvelope).taskId === "qq-agy-draft-cancel"
    );
    assert.equal(
      (cancelledEvt.data as PrismuxDispatchEnvelope).status,
      "cancelled"
    );

    // 10. Automated coding task (non-AGY) -> immediate send (`gpt-6.2-astra` for backend_hard) + complete via ArtifactResultBackdoor
    const completedPayloads: string[] = [];
    daemon.dispatchHub.onTaskCompleted((payload) => {
      completedPayloads.push(payload.directReplyText);
    });

    const autoRes = await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        taskId: "auto-codex-hard-1",
        prompt: "Fix concurrency deadlock in worker queue",
        workspacePath: repoDir,
        callerKind: "secretary_qq",
        taskCategory: "backend_hard",
        replyChannel: { kind: "qq", targetId: "10001" }
      })
    });
    assert.equal(autoRes.status, 200);
    const autoJson = (await autoRes.json()) as {
      envelope: PrismuxDispatchEnvelope;
    };
    assert.equal(autoJson.envelope.provider, "codex");
    assert.equal(autoJson.envelope.modelId, "gpt-6.2-astra");
    assert.equal(autoJson.envelope.reasoningEffort, "high");
    assert.equal(autoJson.envelope.mode, "send");

    // Trying to complete with auto-callback targeting personal AGY MUST fail with HTTP 403!
    const badCompleteRes = await fetch(
      `${ready.httpUrl}/v1/dispatch/auto-codex-hard-1/complete`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          finalAssistantText: "Fixed deadlock",
          callbackTargetProvider: "antigravity"
        })
      }
    );
    assert.equal(badCompleteRes.status, 403);

    // Normal completion extracts real git diff & fires direct reply callback
    writeFileSync(
      join(repoDir, "app.mjs"),
      "export function greet(name) {\n  return `safe ${name}`;\n}\n",
      "utf8"
    );
    const completeRes = await fetch(
      `${ready.httpUrl}/v1/dispatch/auto-codex-hard-1/complete`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          threadId: "thread-codex-1",
          finalAssistantText: "已修复并发死锁问题，并通过回归验证。",
          testPassed: true
        })
      }
    );
    assert.equal(completeRes.status, 200);
    const completeJson = (await completeRes.json()) as {
      ok: boolean;
      artifact: {
        diffStats: { filesChanged: number; insertions: number; deletions: number };
        modifiedFiles: string[];
        plainLanguageSummary: string;
      };
      directReplyText: string;
    };
    assert.equal(completeJson.ok, true);
    assert.equal(completeJson.artifact.diffStats.filesChanged, 1);
    assert.ok(completeJson.artifact.modifiedFiles.includes("app.mjs"));
    assert.match(completeJson.directReplyText, /任务完工直达回执/);
    assert.equal(completedPayloads.length, 1);

    await sse.waitForEvent(
      (e) =>
        e.event === "dispatch_completed" &&
        (e.data as PrismuxDispatchEnvelope).taskId === "auto-codex-hard-1"
    );
  });

  test("DesktopIpcDispatchHub triggers headless fallback ONLY for non-AGY auto tasks when no renderer is connected", async () => {
    const dataDir = makeTempDir("pmx-headless-hub-");
    const policyStore = new AntigravityPolicyStore({ dataDir });
    const policyGuard = new AntigravityPolicyGuard(policyStore);
    const executedHeadless: string[] = [];

    const hub = new DesktopIpcDispatchHub({
      dataDir,
      policyGuard,
      headlessExecutor: (env) => {
        executedHeadless.push(`${env.taskId}:${env.provider}:${env.modelId}`);
      }
    });

    // Non-AGY auto task runs headless fallback
    const r1 = await hub.dispatchThread({
      taskId: "headless-codex-1",
      prompt: "Implement unit tests for parser",
      workspacePath: dataDir,
      callerKind: "secretary_qq",
      taskCategory: "backend_standard"
    });
    assert.equal(r1.envelope.status, "running");
    assert.deepEqual(executedHeadless, ["headless-codex-1:codex:gpt-6.2-sol"]);

    // Remote personal-AGY draft NEVER runs headless executor
    const r2 = await hub.dispatchThread({
      taskId: "headless-agy-draft",
      prompt: "请用 AGY 帮我设计页面",
      workspacePath: dataDir,
      callerKind: "secretary_qq",
      provider: "antigravity"
    });
    assert.equal(r2.envelope.status, "awaiting_human_confirmation");
    assert.equal(r2.envelope.mode, "draft_only");
    assert.equal(executedHeadless.length, 1);
  });

  test("OvernightFactory v3: skips heavy Oracle second-review by default, hard-refuses unattended AGY, and stages interactive Gmail AGY requests as Draft-Only", async () => {
    const rootDir = makeTempDir("pmx-v3-overnight-");
    const repoDir = initTempGitRepo(rootDir, "v3-factory-repo");
    const policyStore = new AntigravityPolicyStore({ dataDir: rootDir });
    const policyGuard = new AntigravityPolicyGuard(policyStore);
    const dispatchHub = new DesktopIpcDispatchHub({
      dataDir: rootDir,
      policyGuard
    });

    const memoryStore = new SqliteMemoryStore({
      dbPath: join(rootDir, "data", "memory.db"),
      machineId: "test-pc",
      embeddingDimensions: 768,
      enableWal: true
    });
    await memoryStore.initialize();
    cleanups.push(() => memoryStore.close());
    await memoryStore.upsert({
      namespace: "workspace/v3-factory-repo",
      kind: "fact",
      title: "Frontend Liquid Glass Tokens",
      content: "Keep contrast >= 4.5:1 across all frosted glass banners.",
      machineId: "test-pc"
    });

    const sentEmails: OutboundMailPayload[] = [];
    const mailer = {
      async send(payload: OutboundMailPayload): Promise<OutboundMailReceipt> {
        sentEmails.push(payload);
        return {
          messageId: `<v3-mail-${sentEmails.length}@prismux.local>`,
          acceptedAt: Date.now(),
          provider: "mock-gmail"
        };
      }
    };

    let codingRunCount = 0;
    const factory = new OvernightFactory({
      memoryStore,
      policyGuard,
      dispatchHub,
      outboundMailer: mailer,
      worktreeBaseDir: join(rootDir, "wt"),
      cleanupWorktree: true,
      secretaryBrain: "gemini-api",
      defaultRepoTarget: {
        repoPath: repoDir,
        repoSlug: "v3-factory-repo",
        workspaceNamespace: "workspace/v3-factory-repo",
        testCommand: `"${process.execPath}" -e "process.exit(0)"`
      },
      codingExecutor: async (ctx) => {
        codingRunCount += 1;
        await ctx.tools.writeFile(
          "app.mjs",
          "export function greet(name) {\n  return `welcome ${name}`;\n}\n"
        );
        return { summary: "更新 greet() 问候文案为 welcome" };
      }
    });

    // 1. Default non-AGY run: skips heavy Oracle second review, populates ArtifactResultBackdoor straight to HTML mail
    const autoResult = await factory.runEmailPipeline({
      messageId: "<v3-auto-1@gmail.com>",
      from: "Owner <owner@gmail.com>",
      to: ["owner+factory@gmail.com"],
      subject: "#factory Update greet message",
      textBody: "Please update greet() to return welcome."
    });
    assert.equal(autoResult.status, "completed");
    assert.equal(autoResult.oracleReviewSkipped, true);
    assert.equal(autoResult.threadId, autoResult.codingThreadId);
    assert.equal(autoResult.routedProvider, "codex");
    assert.equal(autoResult.routedModelId, "gpt-6.2-sol");
    assert.equal(autoResult.secretaryBrain, "gemini-api");
    assert.ok(autoResult.artifact !== undefined);
    assert.equal(autoResult.artifact?.diffStats.filesChanged, 1);
    assert.equal(codingRunCount, 1);
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0]!.html, /ArtifactResultBackdoor 直出/);

    // 2. Unattended overnight_factory targeting personal AGY -> HARD-REFUSED (403 AGY_UNATTENDED_FORBIDDEN)
    await assert.rejects(
      () =>
        factory.runEmailPipeline(
          {
            messageId: "<v3-unattended-agy@gmail.com>",
            from: "Owner <owner@gmail.com>",
            to: ["owner+factory@gmail.com"],
            subject: "#factory Run overnight refactor",
            textBody: "provider: antigravity\nRefactor everything automatically."
          },
          { callerKind: "overnight_factory" }
        ),
      (err: unknown) =>
        err instanceof AntigravityGuardDeniedError &&
        err.statusCode === 403 &&
        err.code === "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED" &&
        err.reasonCode === "AGY_UNATTENDED_FORBIDDEN"
    );
    assert.equal(codingRunCount, 1);

    // 3. Interactive Gmail (`secretary_gmail`) explicitly requesting personal AGY -> stages Draft-Only + Worktree + Memory + Email notice!
    const draftResult = await factory.runEmailPipeline(
      {
        messageId: "<v3-gmail-agy-draft@gmail.com>",
        from: "Owner <owner@gmail.com>",
        to: ["owner+factory@gmail.com"],
        subject: "#factory 请用个人版 Antigravity 优化 Liquid Glass 横幅",
        textBody: "帮我用个人版 Antigravity 调整 Liquid Glass 对比度。"
      },
      { callerKind: "secretary_gmail" }
    );
    assert.equal(draftResult.status, "awaiting_human_confirmation");
    assert.equal(draftResult.requiresHumanConfirmation, true);
    assert.equal(draftResult.worktreeCleaned, false);
    assert.ok(draftResult.worktreePath && existsSync(draftResult.worktreePath));
    assert.ok(draftResult.memoryContext.length >= 1);
    assert.equal(draftResult.dispatchEnvelope?.mode, "draft_only");
    assert.equal(
      draftResult.dispatchEnvelope?.status,
      "awaiting_human_confirmation"
    );
    assert.equal(codingRunCount, 1); // Coding executor MUST NOT run before human confirmation!
    assert.equal(sentEmails.length, 2);
    assert.match(sentEmails[1]!.subject, /待确认草稿/);
    assert.match(sentEmails[1]!.html, /确认放行并发送/);

    // Confirm task was also registered on DesktopIpcDispatchHub
    const stagedList = dispatchHub.listTasks({
      status: "awaiting_human_confirmation"
    });
    assert.equal(stagedList.total, 1);
    assert.equal(stagedList.tasks[0]?.taskId, draftResult.jobId);

    // 4. OvernightRouteService rejects configuring unattended agentProvider to personal Antigravity
    const routeService = new OvernightRouteService({
      dataDir: rootDir,
      policyGuard,
      dispatchHub
    });
    assert.equal(routeService.getConfig().strategy.oracleReviewEnabled, false);
    await assert.rejects(
      () =>
        routeService.updateConfig(
          { strategy: { agentProvider: "antigravity" } },
          "owner_chief"
        ),
      (err: unknown) =>
        err instanceof Error &&
        (err as { code?: string; statusCode?: number }).code ===
          "AGY_UNATTENDED_FORBIDDEN" &&
        (err as { statusCode?: number }).statusCode === 403
    );
    routeService.stop();
  });
});
