import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import type { PtyReplayFrame } from "@prismux/protocol";
import {
  DEFAULT_PTY_RING_BUFFER_BYTES,
  PersistentPtyPool,
  resolveDefaultShell,
  sanitizePtyEnv
} from "../pty/PersistentPtyPool.js";

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 5000,
  description = "condition"
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
    }
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 15);
    });
  }
}

function concatFrames(frames: readonly PtyReplayFrame[]): string {
  return frames.map((frame) => frame.data).join("");
}

test("spawns real Node child process, strips ELECTRON_RUN_AS_NODE, handles write/resize/kill", async (t) => {
  const pool = new PersistentPtyPool();
  t.after(async () => {
    await pool.dispose();
  });

  const directCleaned = sanitizePtyEnv({
    KEEP_ME: "yes",
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
    electron_run_as_node: "1",
    UNSET_VAR: undefined
  });
  assert.deepEqual(directCleaned, { KEEP_ME: "yes" });

  assert.ok(resolveDefaultShell().length > 0);

  const childScript = [
    "process.stdout.write('ENV:' + JSON.stringify({",
    "  hasRunAsNode: 'ELECTRON_RUN_AS_NODE' in process.env,",
    "  hasNoAttach: 'ELECTRON_NO_ATTACH_CONSOLE' in process.env,",
    "  custom: process.env.PRISMUX_TEST_MARKER",
    "}) + '\\n');",
    "process.stderr.write('STDERR_READY\\n');",
    "process.stdin.setEncoding('utf8');",
    "let buf = '';",
    "process.stdin.on('data', (chunk) => {",
    "  buf += chunk;",
    "  const lines = buf.split(/\\r?\\n/);",
    "  buf = lines.pop() ?? '';",
    "  for (const line of lines) {",
    "    if (line === 'QUIT') { process.stdout.write('BYE\\n'); process.exit(0); }",
    "    process.stdout.write('ECHO:' + line + '\\n');",
    "  }",
    "});"
  ].join("\n");

  const session = pool.spawnSession({
    ptyId: "node-env-echo",
    cwd: process.cwd(),
    command: process.execPath,
    args: ["-e", childScript],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
      PRISMUX_TEST_MARKER: "clean-ok",
      DROPPED_UNDEFINED: undefined
    },
    cols: 100,
    rows: 40
  });

  assert.equal(session.ptyId, "node-env-echo");
  assert.equal(session.alive, true);
  assert.deepEqual(pool.getSessionDimensions("node-env-echo"), {
    cols: 100,
    rows: 40
  });

  await waitForCondition(
    () => {
      const text = concatFrames(pool.replay("node-env-echo").frames);
      return text.includes("ENV:") && text.includes("STDERR_READY");
    },
    5000,
    "initial child ENV and stderr output"
  );

  const initialOutput = concatFrames(pool.replay("node-env-echo").frames);
  const envLine = initialOutput
    .split(/\r?\n/)
    .find((line) => line.startsWith("ENV:"));
  assert.ok(envLine !== undefined, "expected ENV line from child");
  const envReport = JSON.parse(envLine.slice("ENV:".length)) as {
    hasRunAsNode: boolean;
    hasNoAttach: boolean;
    custom?: string;
  };
  assert.equal(envReport.hasRunAsNode, false);
  assert.equal(envReport.hasNoAttach, false);
  assert.equal(envReport.custom, "clean-ok");

  assert.equal(pool.resize("node-env-echo", 140, 50), true);
  assert.deepEqual(pool.getSessionDimensions("node-env-echo"), {
    cols: 140,
    rows: 50
  });
  assert.equal(pool.resize("node-env-echo", 0, 20), false);
  assert.equal(pool.resize("missing-pty", 80, 24), false);

  assert.equal(pool.write("node-env-echo", "hello-prismux\n"), true);
  await waitForCondition(
    () =>
      concatFrames(pool.replay("node-env-echo").frames).includes(
        "ECHO:hello-prismux"
      ),
    5000,
    "child stdin echo"
  );

  const killed = await pool.kill("node-env-echo");
  assert.equal(killed, true);
  assert.equal(pool.getSession("node-env-echo")?.alive, false);
  assert.equal(pool.write("node-env-echo", "after-kill\n"), false);
  assert.equal(pool.resize("node-env-echo", 80, 24), false);
  assert.equal(await pool.kill("node-env-echo"), false);

  // Invalid executable must emit diagnostic frame and transition alive -> false without crashing.
  pool.spawnSession({
    ptyId: "missing-cmd",
    cwd: process.cwd(),
    command: "prismux-nonexistent-binary-test-xyz"
  });
  await waitForCondition(
    () =>
      pool.getSession("missing-cmd")?.alive === false &&
      concatFrames(pool.replay("missing-cmd").frames).includes("[pty error]"),
    5000,
    "ENOENT child error handling"
  );
});

test("enforces 2MB default limit and evicts bounded UTF-8 frames without U+FFFD corruption", async (t) => {
  assert.equal(DEFAULT_PTY_RING_BUFFER_BYTES, 2 * 1024 * 1024);

  const smallLimit = 48;
  const pool = new PersistentPtyPool(smallLimit);
  assert.equal(pool.getRingBufferLimitBytes(), smallLimit);
  t.after(async () => {
    await pool.dispose();
  });

  pool.registerSession({
    ptyId: "utf8-ring",
    cwd: process.cwd()
  });

  const chunks = [
    "你好世界，第一段输出。",
    "🔥🚀✨表情与中文混排测试",
    "第二段增量数据ABC123",
    "超长多字节单帧覆盖边界：甲乙丙丁戊己庚辛壬癸🚀🎉🔥🌟💡"
  ];

  let totalWrittenBytes = 0;
  for (const chunk of chunks) {
    totalWrittenBytes += Buffer.byteLength(chunk, "utf8");
    const frame = pool.appendFrame("utf8-ring", chunk);
    assert.ok(frame.seq >= 1);
    const replay = pool.replay("utf8-ring");
    assert.ok(
      replay.bufferBytes <= smallLimit,
      `bufferBytes ${replay.bufferBytes} exceeded ${smallLimit}`
    );
    assert.equal(
      replay.droppedBytes + replay.bufferBytes,
      totalWrittenBytes,
      "droppedBytes + bufferBytes must equal total bytes written"
    );
    for (const retained of replay.frames) {
      assert.equal(
        retained.data.includes("\uFFFD"),
        false,
        `unexpected replacement character in frame: ${retained.data}`
      );
    }
  }

  const finalSmallReplay = pool.replay("utf8-ring");
  assert.equal(finalSmallReplay.latestSeq, chunks.length);
  assert.ok(finalSmallReplay.oldestSeq > 1);
  assert.equal(pool.replay("utf8-ring", finalSmallReplay.latestSeq).frames.length, 0);

  // Sweep misaligned UTF-8 boundaries across 1/2/3/4-byte code points.
  for (const limit of [7, 10, 11, 13]) {
    const sweepPool = new PersistentPtyPool(limit);
    sweepPool.registerSession({ ptyId: "sweep", cwd: process.cwd() });
    const payload = "A中B文🚀C测🔥D试";
    const expectedBytes = Buffer.byteLength(payload, "utf8");
    sweepPool.appendFrame("sweep", payload);
    const result = sweepPool.replay("sweep");
    assert.ok(result.bufferBytes <= limit);
    assert.equal(result.droppedBytes + result.bufferBytes, expectedBytes);
    assert.equal(concatFrames(result.frames).includes("\uFFFD"), false);
    await sweepPool.dispose();
  }

  // Verify real child process chunk splitting mid-UTF-8 character via StringDecoder.
  const splitChildPool = new PersistentPtyPool();
  t.after(async () => {
    await splitChildPool.dispose();
  });
  const splitScript = [
    "const bytes = Buffer.from('跨块中文🚀完成\\n', 'utf8');",
    "process.stdout.write(bytes.subarray(0, 5));",
    "setTimeout(() => { process.stdout.write(bytes.subarray(5)); }, 25);"
  ].join("\n");

  splitChildPool.spawnSession({
    ptyId: "utf8-split-stream",
    cwd: process.cwd(),
    command: process.execPath,
    args: ["-e", splitScript]
  });

  await waitForCondition(
    () =>
      concatFrames(splitChildPool.replay("utf8-split-stream").frames).includes(
        "完成"
      ),
    5000,
    "split UTF-8 stdout completion"
  );

  const combinedSplit = concatFrames(
    splitChildPool.replay("utf8-split-stream").frames
  );
  assert.equal(combinedSplit.includes("\uFFFD"), false);
  assert.equal(combinedSplit.trim(), "跨块中文🚀完成");
});

test("loses zero output across client disconnect/unsubscribe and replays missed frames before live stream", async (t) => {
  const pool = new PersistentPtyPool();
  t.after(async () => {
    await pool.dispose();
  });

  const script = [
    "process.stdout.write('BOOT_READY\\n');",
    "process.stdin.setEncoding('utf8');",
    "let buffer = '';",
    "process.stdin.on('data', (chunk) => {",
    "  buffer += chunk;",
    "  const lines = buffer.split(/\\r?\\n/);",
    "  buffer = lines.pop() ?? '';",
    "  for (const line of lines) {",
    "    if (line.length > 0) process.stdout.write('ACK:' + line + '\\n');",
    "  }",
    "});"
  ].join("\n");

  pool.spawnSession({
    ptyId: "reconnect-pty",
    cwd: process.cwd(),
    command: process.execPath,
    args: ["-e", script]
  });

  const clientAFrames: PtyReplayFrame[] = [];
  const unsubA = pool.subscribe("reconnect-pty", (frame) => {
    clientAFrames.push(frame);
  });

  await waitForCondition(
    () => concatFrames(clientAFrames).includes("BOOT_READY"),
    5000,
    "client A initial frame"
  );
  assert.equal(pool.write("reconnect-pty", "BEFORE_DISCONNECT\n"), true);
  await waitForCondition(
    () => concatFrames(clientAFrames).includes("ACK:BEFORE_DISCONNECT"),
    5000,
    "client A pre-disconnect ack"
  );

  const lastSeenSeqByA = clientAFrames[clientAFrames.length - 1]?.seq ?? 0;
  assert.ok(lastSeenSeqByA >= 1);

  // Simulate desktop window closing / WS disconnect: unsubscribe MUST NOT kill child.
  unsubA();
  assert.equal(pool.getSession("reconnect-pty")?.alive, true);

  assert.equal(pool.write("reconnect-pty", "WHILE_OFFLINE_1\n"), true);
  assert.equal(pool.write("reconnect-pty", "WHILE_OFFLINE_2\n"), true);

  await waitForCondition(() => {
    const missedText = concatFrames(
      pool.replay("reconnect-pty", lastSeenSeqByA).frames
    );
    return (
      missedText.includes("ACK:WHILE_OFFLINE_1") &&
      missedText.includes("ACK:WHILE_OFFLINE_2")
    );
  }, 5000, "child output buffered while disconnected");

  // Client A definitely did not receive offline frames after unsubscribing.
  assert.equal(concatFrames(clientAFrames).includes("WHILE_OFFLINE"), false);

  const missedReplay = pool.replay("reconnect-pty", lastSeenSeqByA);
  assert.ok(missedReplay.frames.length >= 1);
  assert.ok(missedReplay.latestSeq > lastSeenSeqByA);
  assert.ok(
    concatFrames(missedReplay.frames).includes("ACK:WHILE_OFFLINE_1") &&
      concatFrames(missedReplay.frames).includes("ACK:WHILE_OFFLINE_2")
  );

  // Client B reconnects with replayFromSeq = lastSeenSeqByA and then continues receiving live frames.
  const clientBFrames: PtyReplayFrame[] = [];
  const unsubB = pool.subscribe(
    "reconnect-pty",
    (frame) => {
      clientBFrames.push(frame);
    },
    { replayFromSeq: lastSeenSeqByA }
  );

  assert.equal(pool.write("reconnect-pty", "AFTER_RECONNECT\n"), true);
  await waitForCondition(
    () => concatFrames(clientBFrames).includes("ACK:AFTER_RECONNECT"),
    5000,
    "client B live output after reconnect"
  );

  const clientBText = concatFrames(clientBFrames);
  assert.equal(clientBText.includes("BOOT_READY"), false);
  assert.equal(clientBText.includes("ACK:BEFORE_DISCONNECT"), false);
  assert.ok(clientBText.includes("ACK:WHILE_OFFLINE_1"));
  assert.ok(clientBText.includes("ACK:WHILE_OFFLINE_2"));
  assert.ok(clientBText.includes("ACK:AFTER_RECONNECT"));

  for (let i = 1; i < clientBFrames.length; i += 1) {
    const prev = clientBFrames[i - 1];
    const curr = clientBFrames[i];
    assert.ok(prev !== undefined && curr !== undefined);
    assert.ok(curr.seq > prev.seq, "replayed and live frames must stay strictly ordered");
  }

  unsubB();
  assert.equal(await pool.kill("reconnect-pty"), true);
});

test("scans .claude/worktrees/* into agent-scratch and adopts into default thread", async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "prismux-pty-worktrees-"));
  const pool = new PersistentPtyPool();
  t.after(async () => {
    await pool.dispose();
    await rm(tempRoot, { recursive: true, force: true });
  });

  const worktreesDir = join(tempRoot, ".claude", "worktrees");
  const alphaDir = join(worktreesDir, "feat-alpha");
  const betaDir = join(worktreesDir, "feat-beta");
  const alphaGitDir = join(tempRoot, ".git", "worktrees", "feat-alpha");

  await mkdir(alphaDir, { recursive: true });
  await mkdir(alphaGitDir, { recursive: true });
  await writeFile(
    join(alphaDir, ".git"),
    "gitdir: ../../../.git/worktrees/feat-alpha\n",
    "utf8"
  );
  await writeFile(
    join(alphaGitDir, "HEAD"),
    "ref: refs/heads/feat-alpha\n",
    "utf8"
  );

  await mkdir(join(betaDir, ".git"), { recursive: true });
  await writeFile(
    join(betaDir, ".git", "HEAD"),
    "ref: refs/heads/feat-beta\n",
    "utf8"
  );

  // Regular file inside .claude/worktrees should be ignored.
  await writeFile(join(worktreesDir, "README.txt"), "not a worktree\n", "utf8");

  const scan1 = await pool.scanAgentScratchWorktrees(tempRoot);
  assert.equal(scan1.repoRoot, resolve(tempRoot));
  assert.equal(scan1.group, "agent-scratch");
  assert.deepEqual(scan1.discoveredWorktrees, [alphaDir, betaDir]);
  assert.equal(scan1.sessions.length, 2);

  const alphaSession = scan1.sessions.find((s) => s.cwd === alphaDir);
  const betaSession = scan1.sessions.find((s) => s.cwd === betaDir);
  assert.ok(alphaSession !== undefined);
  assert.ok(betaSession !== undefined);
  assert.equal(alphaSession.group, "agent-scratch");
  assert.equal(alphaSession.worktreeBranch, "feat-alpha");
  assert.equal(betaSession.group, "agent-scratch");
  assert.equal(betaSession.worktreeBranch, "feat-beta");

  const spawnedBeta = pool.spawnSession({
    ptyId: betaSession.ptyId,
    command: process.execPath,
    args: ["-e", "process.stdout.write(process.cwd() + '\\n');"]
  });
  assert.equal(spawnedBeta.group, "agent-scratch");
  assert.equal(spawnedBeta.cwd, betaDir);
  assert.equal(spawnedBeta.worktreeBranch, "feat-beta");
  await waitForCondition(
    () =>
      concatFrames(pool.replay(betaSession.ptyId).frames).includes("feat-beta"),
    5000,
    "scratch session spawned in worktree cwd"
  );

  const adopted = pool.adoptScratchWorktree(alphaSession.ptyId, "Prismux");
  assert.ok(adopted.adoptedThreadId.startsWith("thread-prismux-"));
  assert.equal(adopted.session.ptyId, alphaSession.ptyId);
  assert.equal(adopted.session.group, "default");
  assert.equal(pool.getSession(alphaSession.ptyId)?.group, "default");
  assert.equal(pool.getSession(betaSession.ptyId)?.group, "agent-scratch");

  // Re-scanning must not duplicate sessions or demote an already adopted thread.
  const scan2 = await pool.scanAgentScratchWorktrees(tempRoot);
  assert.equal(pool.listSessions().length, 2);
  const alphaAfterRescan = scan2.sessions.find((s) => s.cwd === alphaDir);
  const betaAfterRescan = scan2.sessions.find((s) => s.cwd === betaDir);
  assert.equal(alphaAfterRescan?.group, "default");
  assert.equal(betaAfterRescan?.group, "agent-scratch");
});

after(async () => {
  // Ensures test module defines clean suite-level teardown compatibility.
});
