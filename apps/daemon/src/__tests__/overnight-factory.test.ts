import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { SqliteMemoryStore } from "@prismux/memory-core";
import { BRAND } from "@prismux/protocol";
import {
  DialModeToolDeniedError,
  HandoffEngine,
  isToolAllowedInDialMode,
} from "../handoff/HandoffEngine.js";
import { LifecycleHookBus } from "../hooks/LifecycleHookBus.js";
import {
  GmailOAuth2InboundAdapter,
  ImapIdleInboundAdapter,
  OVERNIGHT_FACTORY_MILESTONE,
  OvernightFactory,
  OvernightTaskCancelledError,
  analyzeDiffStaticRisks,
  buildFactoryBranchName,
  buildReviewDeepLink,
  createDefaultOvernightCodingExecutor,
  matchesFactoryTrigger,
  type FactoryMorningReport,
  type FactoryPluginNotification,
  type InboundEmailMessage,
  type OutboundMailPayload,
  type OutboundMailReceipt,
  type OutboundMailer,
  type OvernightExecutionStage,
} from "../workflows/OvernightFactory.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];
const originalElectronEnv = process.env.ELECTRON_RUN_AS_NODE;

after(async () => {
  if (originalElectronEnv === undefined) {
    delete process.env.ELECTRON_RUN_AS_NODE;
  } else {
    process.env.ELECTRON_RUN_AS_NODE = originalElectronEnv;
  }

  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn !== undefined) {
      await fn();
    }
  }

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runGitRepo(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

test("inbound trigger matching, branch naming, Gmail historyId cursor, and IMAP IDLE/UID polling", async (t) => {
  assert.equal(OVERNIGHT_FACTORY_MILESTONE, "M5");

  // 1. Trigger matching rules
  assert.equal(
    matchesFactoryTrigger({
      messageId: "<m1@gmail.com>",
      from: "me@gmail.com",
      to: ["Owner <fish+factory@gmail.com>"],
      subject: "Optimize startup latency",
      receivedAt: Date.now(),
    }),
    true,
  );

  assert.equal(
    matchesFactoryTrigger({
      messageId: "<m2@gmail.com>",
      from: "me@gmail.com",
      to: ["fish@gmail.com"],
      subject: "Refactor PTY pool #Factory",
      receivedAt: Date.now(),
    }),
    true,
  );

  assert.equal(
    matchesFactoryTrigger({
      messageId: "<m3@gmail.com>",
      from: "me@gmail.com",
      to: ["fish@gmail.com"],
      subject: "[idea] Add dark border toggle",
      receivedAt: Date.now(),
    }),
    true,
  );

  assert.equal(
    matchesFactoryTrigger({
      messageId: "<m4@gmail.com>",
      from: "me@gmail.com",
      to: ["fish@gmail.com"],
      subject: "Quick idea note",
      labels: ["INBOX", "#factory"],
      receivedAt: Date.now(),
    }),
    true,
  );

  assert.equal(
    matchesFactoryTrigger({
      messageId: "<m5@gmail.com>",
      from: "newsletter@example.com",
      to: ["fish@gmail.com"],
      subject: "Weekly digest",
      labels: ["INBOX"],
      textBody: "Body mentioning #factory should not trigger without subject/tag/alias",
      receivedAt: Date.now(),
    }),
    false,
  );

  // 2. Branch name format `factory/MMDD-<slug>` (including CJK fallback)
  const sampleDate = new Date(2026, 10, 23, 2, 30, 0).getTime();
  const asciiBranch = buildFactoryBranchName(
    "[Idea] #factory Fix add() overflow in math.mjs",
    sampleDate,
  );
  assert.match(asciiBranch, /^factory\/1123-fix-add-overflow-in-math-mjs$/);

  const cjkBranch = buildFactoryBranchName("#factory 修复中文标题分支名", sampleDate);
  assert.match(cjkBranch, /^factory\/1123-idea-[a-f0-9]{8}$/);

  // 3. Real HTTP mock for Gmail OAuth2 token refresh + historyId incremental cursor
  const rawIdeaBody = "Please fix math.mjs add() overflow.\n--\nSent from Gemini";
  const mockGmailServer = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "POST" && url === "/token") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "ya29.mock-access-token",
          expires_in: 3600,
        }),
      );
      return;
    }

    if (req.headers.authorization !== "Bearer ya29.mock-access-token") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (url.startsWith("/gmail/v1/users/me/history")) {
      const parsed = new URL(url, "http://127.0.0.1");
      const startId = parsed.searchParams.get("startHistoryId");
      if (startId === "1000") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            historyId: "1042",
            history: [{ messagesAdded: [{ message: { id: "gmail-msg-1" } }] }],
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ historyId: "1042", history: [] }));
      return;
    }

    if (url.startsWith("/gmail/v1/users/me/messages/gmail-msg-1")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "gmail-msg-1",
          historyId: "1042",
          internalDate: String(sampleDate),
          labelIds: ["INBOX", "factory"],
          payload: {
            mimeType: "multipart/alternative",
            headers: [
              { name: "Message-ID", value: "<gmail-msg-1@mail.gmail.com>" },
              { name: "From", value: "Fish <fish@gmail.com>" },
              { name: "To", value: "fish+factory@gmail.com" },
              { name: "Subject", value: "[Idea] Fix math bug" },
            ],
            parts: [
              {
                mimeType: "text/plain",
                body: { data: toBase64Url(rawIdeaBody) },
              },
            ],
          },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolveListen) => {
    mockGmailServer.listen(0, "127.0.0.1", resolveListen);
  });
  t.after(async () => {
    mockGmailServer.closeAllConnections?.();
    await new Promise<void>((resolveClose) => mockGmailServer.close(() => resolveClose()));
  });

  const gmailPort = (mockGmailServer.address() as AddressInfo).port;
  const gmailAdapter = new GmailOAuth2InboundAdapter({
    userEmail: "fish@gmail.com",
    clientId: "mock-client",
    clientSecret: "mock-secret",
    refreshToken: "mock-refresh",
    initialHistoryId: "1000",
    tokenUrl: `http://127.0.0.1:${gmailPort}/token`,
    apiBaseUrl: `http://127.0.0.1:${gmailPort}/gmail/v1`,
  });

  const gmailPoll1 = await gmailAdapter.pollIncremental();
  assert.equal(gmailPoll1.messages.length, 1);
  assert.equal(gmailPoll1.nextCursor, "1042");
  assert.equal(gmailAdapter.getHistoryId(), "1042");
  assert.equal(gmailPoll1.messages[0]?.subject, "[Idea] Fix math bug");
  assert.equal(gmailPoll1.messages[0]?.textBody, rawIdeaBody);

  const gmailPoll2 = await gmailAdapter.pollIncremental();
  assert.equal(gmailPoll2.messages.length, 0);
  assert.equal(gmailPoll2.nextCursor, "1042");

  // 4. Real TCP mock IMAP server verifying UID incremental polling + IDLE stopper cleanup
  const rawRfc822 = [
    "Message-ID: <imap-uid-12@example.com>",
    "From: owner@example.com",
    "To: owner+factory@example.com",
    "Subject: #factory Add clamp helper",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Implement clamp(value, min, max) cleanly.",
  ].join("\r\n");

  const imapServer = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("* OK Mock IMAP4rev1 Ready\r\n");
    let buf = "";
    socket.on("data", (chunk: string) => {
      buf += chunk;
      while (buf.includes("\n")) {
        const idx = buf.indexOf("\n");
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.length === 0) continue;
        const spaceIdx = line.indexOf(" ");
        const tag = spaceIdx > 0 ? line.slice(0, spaceIdx) : "A0";
        const cmd = spaceIdx > 0 ? line.slice(spaceIdx + 1) : line;
        if (cmd.startsWith("LOGIN") || cmd.startsWith("SELECT")) {
          socket.write(`${tag} OK Completed\r\n`);
        } else if (cmd.startsWith("UID SEARCH")) {
          socket.write("* SEARCH 12\r\n");
          socket.write(`${tag} OK Search completed\r\n`);
        } else if (cmd.startsWith("UID FETCH 12")) {
          const byteLen = Buffer.byteLength(rawRfc822, "utf8");
          socket.write(`* 1 FETCH (UID 12 BODY[] {${byteLen}}\r\n${rawRfc822})\r\n`);
          socket.write(`${tag} OK Fetch completed\r\n`);
        } else if (cmd === "LOGOUT") {
          socket.write(`* BYE Logging out\r\n${tag} OK Logout\r\n`);
          socket.end();
        } else {
          socket.write(`${tag} OK\r\n`);
        }
      }
    });
  });

  await new Promise<void>((resolveListen) => {
    imapServer.listen(0, "127.0.0.1", resolveListen);
  });
  t.after(async () => {
    await new Promise<void>((resolveClose) => imapServer.close(() => resolveClose()));
  });

  const imapPort = (imapServer.address() as AddressInfo).port;
  const imapAdapter = new ImapIdleInboundAdapter({
    host: "127.0.0.1",
    port: imapPort,
    secure: false,
    username: "owner",
    password: "secret",
    initialUid: 10,
  });

  const imapPoll = await imapAdapter.pollIncremental();
  assert.equal(imapPoll.messages.length, 1);
  assert.equal(imapPoll.messages[0]?.uid, 12);
  assert.equal(imapPoll.nextCursor, "12");
  assert.equal(matchesFactoryTrigger(imapPoll.messages[0]!), true);

  const stopIdle = await imapAdapter.startIdle(() => {});
  await stopIdle();
});

test("end-to-end overnight factory pipeline with real git worktree, SqliteMemoryStore, WorktreeSandbox, self-heal, Oracle review, Stop hook, and HTML morning report", async () => {
  process.env.ELECTRON_RUN_AS_NODE = "1";

  const rootDir = mkdtempSync(join(tmpdir(), "prismux-factory-e2e-"));
  tempDirs.push(rootDir);

  const repoDir = join(rootDir, "math-toolbox");
  const worktreesDir = join(rootDir, "factory-worktrees");
  const sensitiveDir = join(rootDir, "sensitive-outside");
  const outsideSecretFile = join(sensitiveDir, "prod.env");
  const dbPath = join(rootDir, "data", "memory.db");

  mkdirSync(repoDir, { recursive: true });
  mkdirSync(sensitiveDir, { recursive: true });
  writeFileSync(outsideSecretFile, "TOP_SECRET_DO_NOT_TOUCH=1\n", "utf8");

  // 1. Initialize real git repo on `main` with a buggy `math.mjs` & failing `math.test.mjs`
  runGitRepo(repoDir, ["init", "-b", "main"]);
  runGitRepo(repoDir, ["config", "user.name", "Prismux Test"]);
  runGitRepo(repoDir, ["config", "user.email", "test@prismux.local"]);

  writeFileSync(
    join(repoDir, "math.mjs"),
    ["export function add(a, b) {", "  return a - b;", "}", ""].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(repoDir, "math.test.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'import { add } from "./math.mjs";',
      "",
      'test("add computes arithmetic sum", () => {',
      "  assert.equal(add(2, 3), 5);",
      "  assert.equal(add(-1, 4), 3);",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  runGitRepo(repoDir, ["add", "math.mjs", "math.test.mjs"]);
  runGitRepo(repoDir, ["commit", "-m", "chore: initial buggy math module"]);
  const mainHeadBefore = runGitRepo(repoDir, ["rev-parse", "HEAD"]).trim();

  // Confirm initial `main` test genuinely fails before OvernightFactory repairs it in a worktree
  const cleanNodeEnv = { ...process.env };
  delete cleanNodeEnv.NODE_TEST_CONTEXT;
  delete cleanNodeEnv.ELECTRON_RUN_AS_NODE;
  assert.throws(() =>
    execFileSync("node", ["--test", "math.test.mjs"], {
      cwd: repoDir,
      env: cleanNodeEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
  );

  // 2. Start real SqliteMemoryStore and seed workspace & chief memories
  const memoryStore = new SqliteMemoryStore({
    dbPath,
    machineId: "factory-test-machine",
    embeddingDimensions: 768,
    enableWal: true,
  });
  await memoryStore.initialize();
  cleanups.push(async () => {
    await memoryStore.close();
  });

  await memoryStore.upsert({
    namespace: "workspace/math-toolbox",
    kind: "fact",
    title: "math-toolbox ESM & Testing Architecture",
    content:
      "Use pure ESM .mjs modules with zero external dependencies and node:test assertions for math.mjs.",
    sourceRef: "repo:math-toolbox:spec",
    importance: 0.95,
    machineId: "factory-test-machine",
  });
  await memoryStore.upsert({
    namespace: "private/chief",
    kind: "preference",
    title: "Chief Coding & Review Preference",
    content:
      "Prefer concise pure functions in math.mjs and verify all edge arithmetic cases before commit.",
    sourceRef: "chief:pref:coding",
    importance: 0.9,
    machineId: "factory-test-machine",
  });

  // 3. Configure LifecycleHookBus & HandoffEngine & OutboundMailer & Plugin Notifier
  const hookEventsSeen: string[] = [];
  const hookBus = new LifecycleHookBus({ defaultPermissionMode: "auto" });
  hookBus.register(
    {
      id: "observe-session-start",
      event: "SessionStart",
      onFailure: "block",
      timeoutMs: 1_000,
    },
    () => {
      hookEventsSeen.push("SessionStart");
    },
  );
  hookBus.register(
    {
      id: "observe-stop-hook",
      event: "Stop",
      onFailure: "block",
      timeoutMs: 1_000,
    },
    (ctx) => {
      hookEventsSeen.push(`Stop:${ctx.threadId}`);
    },
  );

  const handoffEngine = new HandoffEngine();
  const sentMails: OutboundMailPayload[] = [];
  const outboundMailer: OutboundMailer = {
    async send(payload: OutboundMailPayload): Promise<OutboundMailReceipt> {
      sentMails.push(payload);
      return {
        messageId: `<report-${sentMails.length}@prismux.local>`,
        acceptedAt: Date.now(),
        provider: "mock-smtp",
      };
    },
  };
  const pluginNotifications: FactoryPluginNotification[] = [];

  let observedWorktreePath = "";
  let sandboxOutOfTreeBlocked = false;
  let oracleVerifiedReadOnly = false;

  const factory = new OvernightFactory({
    mode: "gmail-oauth2",
    matchAliasOrTag: "#factory",
    memoryStore,
    handoffEngine,
    hookBus,
    outboundMailer,
    worktreeBaseDir: worktreesDir,
    maxSelfHealAttempts: 3,
    cleanupWorktree: true,
    defaultRepoTarget: {
      repoPath: repoDir,
      repoSlug: "math-toolbox",
      workspaceNamespace: "workspace/math-toolbox",
      testCommand: "node --test math.test.mjs",
    },
    codingExecutor: async (ctx) => {
      observedWorktreePath = ctx.worktreePath;
      assert.notEqual(ctx.worktreePath, repoDir);
      assert.equal(existsSync(join(ctx.worktreePath, "math.mjs")), true);

      // Verify Stage A retrieved workspace & chief memories + cleaned email body
      assert.ok(ctx.memoryHits.length >= 1);
      assert.equal(
        ctx.memoryHits.some(
          (hit) =>
            hit.entry.namespace === "workspace/math-toolbox" ||
            hit.entry.namespace === "private/chief",
        ),
        true,
      );
      assert.equal(ctx.cleanedEmailText.includes("Sent from Gemini App"), false);
      assert.equal(ctx.cleanedEmailText.includes("Quoted history"), false);

      // Verify WorktreeSandbox blocks out-of-worktree writes (`isWriteTargetAllowed === false` + `assertWriteTargetAllowed` throws)
      assert.equal(ctx.sandbox.isWriteTargetAllowed(ctx.sandboxPolicy, outsideSecretFile), false);
      assert.equal(ctx.tools.isWriteAllowed(outsideSecretFile), false);
      assert.throws(
        () => ctx.sandbox.assertWriteTargetAllowed(ctx.sandboxPolicy, outsideSecretFile),
        /Sandbox write blocked/,
      );
      await assert.rejects(
        () => ctx.tools.writeFile(outsideSecretFile, "PWNED=true\n"),
        /Sandbox write blocked/,
      );
      assert.equal(readFileSync(outsideSecretFile, "utf8"), "TOP_SECRET_DO_NOT_TOUCH=1\n");
      sandboxOutOfTreeBlocked = true;

      // Verify ELECTRON_RUN_AS_NODE is sanitized from child execution env
      assert.equal("ELECTRON_RUN_AS_NODE" in ctx.isolationSpec.env, false);

      if (ctx.attempt === 1) {
        // Attempt 1 intentionally introduces a subtle off-by-one bug to exercise self-healing
        await ctx.tools.writeFile(
          "math.mjs",
          ["export function add(a, b) {", "  return a + b + 1;", "}", ""].join("\n"),
        );
        return {
          summary: "尝试修复 math.mjs 加法函数（第 1 轮）",
          modifiedFiles: ["math.mjs"],
          tokenStats: {
            inputTokens: 420,
            outputTokens: 110,
            estimatedCostUsd: 0.0021,
            model: "gemini-4-neon",
            provider: "antigravity",
          },
        };
      }

      // Attempt 2 sees real node:test failure feedback from attempt 1 and fixes `add()` cleanly
      assert.ok(ctx.lastTestFailure && ctx.lastTestFailure.length > 0);
      assert.match(ctx.lastTestFailure, /add computes arithmetic sum|AssertionError|fail 1/i);
      await ctx.tools.writeFile(
        "math.mjs",
        ["export function add(a, b) {", "  return a + b;", "}", ""].join("\n"),
      );
      return {
        summary: "修复 math.mjs 中 add(a, b) 误做减法的运算符缺陷并通过单测",
        modifiedFiles: ["math.mjs"],
        tokenStats: {
          inputTokens: 610,
          outputTokens: 145,
          estimatedCostUsd: 0.0034,
          model: "gemini-4-neon",
          provider: "antigravity",
        },
      };
    },
    oracleReviewer: async (ctx) => {
      assert.equal(handoffEngine.getDialMode(ctx.reviewThreadId), "review");
      assert.equal(isToolAllowedInDialMode("review", "write_file"), false);
      assert.throws(() => ctx.assertReadOnlyTool("write_file"), DialModeToolDeniedError);
      ctx.assertReadOnlyTool("git_diff");
      oracleVerifiedReadOnly = true;

      assert.match(ctx.diff, /-\s*return a - b;/);
      assert.match(ctx.diff, /\+\s*return a \+ b;/);
      return {
        comments: ["已核验 diff：`add(a, b)` 运算符已修正为 `+`，无额外副作用且原有单测全绿。"],
        tokenStats: {
          inputTokens: 300,
          outputTokens: 80,
          estimatedCostUsd: 0.0015,
        },
      };
    },
    onNotifyPlugins: (notification) => {
      pluginNotifications.push(notification);
    },
  });

  const inboundEmail: InboundEmailMessage = {
    messageId: "<factory-e2e-001@gmail.com>",
    from: "Fish <fish@gmail.com>",
    to: ["fish+factory@gmail.com"],
    subject: "[Idea] #factory Fix add bug in math.mjs",
    labels: ["INBOX", "#factory"],
    receivedAt: new Date(2026, 10, 23, 3, 15, 0).getTime(),
    textBody: [
      "请修复 math.mjs 中的 add() 函数把加法写成减法的 Bug，并确保 node --test math.test.mjs 通过。",
      "",
      "-- ",
      "Sent from Gemini App",
      "> Quoted history that should be stripped by DocumentCollector",
    ].join("\n"),
  };

  // 4. Execute full 4-stage pipeline
  const result = await factory.runEmailPipeline(inboundEmail);

  assert.equal(result.status, "completed");
  assert.match(result.branchName ?? "", /^factory\/1123-fix-add-bug-in-math-mjs$/);
  assert.equal(result.selfHealAttempts, 2);
  assert.equal(result.testPassed, true);
  assert.equal(sandboxOutOfTreeBlocked, true);
  assert.equal(oracleVerifiedReadOnly, true);
  assert.equal(result.worktreeCleaned, true);
  assert.equal(existsSync(observedWorktreePath), false);

  // Verify `main` branch HEAD hash is 100% untouched, while new branch commit exists and holds the fix
  const mainHeadAfter = runGitRepo(repoDir, ["rev-parse", "main"]).trim();
  assert.equal(mainHeadAfter, mainHeadBefore);

  const branchHead = runGitRepo(repoDir, ["rev-parse", result.branchName!]).trim();
  assert.equal(branchHead, result.commitSha);
  assert.notEqual(branchHead, mainHeadBefore);

  const committedMath = runGitRepo(repoDir, ["show", `${result.commitSha}:math.mjs`]);
  assert.match(committedMath, /return a \+ b;/);

  // Verify changed file stats and diff
  assert.equal(result.changedFiles.length, 1);
  assert.equal(result.changedFiles[0]?.path, "math.mjs");
  assert.equal(result.changedFiles[0]?.additions, 1);
  assert.equal(result.changedFiles[0]?.deletions, 1);

  // Verify Stage D Stop hook, HTML report (all 7 sections), Mailer & Plugin notification
  assert.ok(hookEventsSeen.includes("SessionStart"));
  assert.ok(hookEventsSeen.includes(`Stop:${result.reviewThreadId}`));

  assert.equal(sentMails.length, 1);
  const sentMail = sentMails[0]!;
  assert.deepEqual(sentMail.to, ["fish@gmail.com"]);
  assert.equal(sentMail.inReplyTo, inboundEmail.messageId);

  const html = sentMail.html;
  const expectedDeepLink = buildReviewDeepLink(result.reviewThreadId!);
  assert.equal(result.deepLink, expectedDeepLink);
  assert.ok(
    expectedDeepLink.startsWith(`${BRAND.uriScheme}://review/`),
    `Expected deepLink starting with ${BRAND.uriScheme}://review/`,
  );

  // 7 required sections in HTML morning report
  assert.match(html, /1\. 一句话成果总结/);
  assert.match(html, /修复 math\.mjs 中 add\(a, b\) 误做减法的运算符缺陷/);
  assert.match(html, /2\. 修改文件统计/);
  assert.match(html, /math\.mjs/);
  assert.match(html, /3\. 关键 Diff 高亮/);
  assert.match(html, /data-diff="add"/);
  assert.match(html, /data-diff="del"/);
  assert.match(html, /#dafbe1/);
  assert.match(html, /#ffebe9/);
  assert.match(html, /4\. 单测完整输出/);
  assert.match(html, /PASSED/);
  assert.match(html, /5\. Oracle 只读审阅评语/);
  assert.match(html, /运算符已修正为/);
  assert.match(html, /6\. Token 消耗与估算成本/);
  assert.match(html, /910/); // coding(610) + review(300) input tokens
  assert.match(html, /\$0\.0049/); // 0.0034 + 0.0015
  assert.match(html, /7\. 一键唤醒桌面工作台审阅并合并分支/);
  assert.ok(html.includes(expectedDeepLink));

  assert.equal(pluginNotifications.length, 1);
  assert.equal(pluginNotifications[0]?.islandCard.kind, "factory_complete");
  assert.equal(pluginNotifications[0]?.deepLink, expectedDeepLink);

  // 5. Deduplication check: re-running same messageId must be skipped with no extra emails/commits
  const dupResult = await factory.runEmailPipeline(inboundEmail);
  assert.equal(dupResult.status, "skipped_duplicate");
  assert.equal(sentMails.length, 1);

  // 6. pollInbound filters non-matching emails, deduplicates already-processed messages, and executes new triggers
  const pollAdapter = new GmailOAuth2InboundAdapter({
    userEmail: "fish@gmail.com",
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rtok",
    initialHistoryId: "2000",
    historyFetcher: async () => ({
      historyId: "2050",
      messages: [
        {
          messageId: "<unrelated-news@example.com>",
          from: "news@example.com",
          to: ["fish@gmail.com"],
          subject: "Weekly newsletter",
        },
        inboundEmail,
        {
          messageId: "<factory-e2e-002@gmail.com>",
          from: "Fish <fish@gmail.com>",
          to: ["fish@gmail.com"],
          subject: "[Idea] Second math check",
          textBody: "Ensure math.mjs add(a, b) stays clean.",
        },
      ],
    }),
  });

  const pollResults = await factory.pollInbound(pollAdapter);
  assert.equal(pollResults.length, 2);
  assert.equal(pollResults[0]?.status, "skipped_duplicate");
  assert.equal(pollResults[1]?.status, "completed");
  assert.deepEqual(pollAdapter.getAcknowledgedMessageIds(), ["<factory-e2e-002@gmail.com>"]);
  assert.equal(sentMails.length, 2);
});

test("security hook veto overrides auto mode, static risk analyzer detects diff pitfalls, and HTML report escapes XSS", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "prismux-factory-sec-"));
  tempDirs.push(rootDir);

  const repoDir = join(rootDir, "sec-repo");
  mkdirSync(repoDir, { recursive: true });
  runGitRepo(repoDir, ["init", "-b", "main"]);
  runGitRepo(repoDir, ["config", "user.name", "Sec Test"]);
  runGitRepo(repoDir, ["config", "user.email", "sec@prismux.local"]);
  writeFileSync(join(repoDir, "app.mjs"), "export const v = 1;\n", "utf8");
  runGitRepo(repoDir, ["add", "app.mjs"]);
  runGitRepo(repoDir, ["commit", "-m", "init"]);

  // 1. Security-critical hook must veto even under Stage B `auto` permission mode
  const hookBus = new LifecycleHookBus({ defaultPermissionMode: "auto" });
  hookBus.register(
    {
      id: "veto-env-write",
      event: "PreToolUse",
      onFailure: "block",
      securityCritical: true,
      timeoutMs: 500,
    },
    (ctx) => {
      if (ctx.toolName === "write_file" && String(ctx.toolInput?.filePath ?? "").endsWith(".env")) {
        return {
          decision: "block",
          exitCode: 2,
          feedback: "安全策略阻断：禁止在夜间工场写入 .env 凭据文件",
        };
      }
      return { decision: "allow", exitCode: 0 };
    },
  );

  const factory = new OvernightFactory({
    hookBus,
    worktreeBaseDir: join(rootDir, "wt"),
    cleanupWorktree: true,
    defaultRepoTarget: {
      repoPath: repoDir,
      testCommand: `"${process.execPath}" -e "process.exit(0)"`,
    },
    codingExecutor: async (ctx) => {
      await ctx.tools.writeFile(".env", "SECRET=123\n");
    },
  });

  await assert.rejects(
    () =>
      factory.runEmailPipeline({
        messageId: "<sec-veto-1@gmail.com>",
        from: "fish@gmail.com",
        to: ["fish+factory@gmail.com"],
        subject: "#factory Attempt credential write",
      }),
    /禁止在夜间工场写入 \.env 凭据文件/,
  );

  // 2. Built-in static risk analyzer checks
  const riskyDiff = [
    "diff --git a/src/auth.ts b/src/auth.ts",
    "--- a/src/auth.ts",
    "+++ b/src/auth.ts",
    "@@ -1,2 +1,6 @@",
    '+const apiKey = "sk-1234567890abcdef1234567890";',
    "+try { doRisky(); } catch (e) {}",
    "+console.log('debug leak');",
    "+export const parsed: any = eval('1+1');",
  ].join("\n");

  const findings = analyzeDiffStaticRisks(
    riskyDiff,
    [{ path: "src/auth.ts", status: "modified", additions: 4, deletions: 0 }],
    true,
  );
  assert.ok(findings.some((f) => f.includes("[Security]") && f.includes("凭据")));
  assert.ok(findings.some((f) => f.includes("[Reliability]")));
  assert.ok(findings.some((f) => f.includes("[Hygiene]")));
  assert.ok(findings.some((f) => f.includes("[Typing]")));
  assert.ok(findings.some((f) => f.includes("[Coverage]")));

  // 3. HTML XSS sanitization checks across every dynamic field
  const xssReport: FactoryMorningReport = {
    jobId: 'job-<script>alert("id")</script>',
    threadId: 'thr-"onmouseover="alert(1)',
    branchName: "factory/1123-<img src=x onerror=alert(1)>",
    summary: '<script>alert("summary")</script> 完成修复',
    changedFilesCount: 1,
    changedFiles: [
      {
        path: 'src/<svg onload="alert(1)">.ts',
        status: "modified",
        additions: 1,
        deletions: 1,
      },
    ],
    diff: '+const x = "<script>alert(1)</script>";\n-const y = "<img src=x>";',
    testCommand: "node --test <script>",
    testOutput: '<script>evil()</script> & "quoted"',
    testPassed: true,
    reviewComments: ['<img src=x onerror=alert("oracle")>'],
    tokenStats: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCostUsd: 0.0001,
      model: "<script>m</script>",
    },
    deepLink: "javascript:alert(1)",
  };

  const xssHtml = factory.renderMorningReportHtml(xssReport);
  assert.equal(xssHtml.includes("<script>"), false);
  assert.equal(xssHtml.includes("<img src=x"), false);
  assert.equal(xssHtml.includes("<svg "), false);
  assert.equal(xssHtml.includes("javascript:alert(1)"), false);
  assert.ok(xssHtml.includes("&lt;script&gt;"));
  assert.ok(xssHtml.includes(`${BRAND.uriScheme}://review/`));
});

test("createDefaultOvernightCodingExecutor preserves native CLI identity, hard-blocks personal AGY, emits live stage progress, supports allowNoFileChanges, and honors AbortSignal cancellation", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "prismux-factory-default-exec-"));
  tempDirs.push(rootDir);

  const repoDir = join(rootDir, "exec-repo");
  mkdirSync(repoDir, { recursive: true });
  runGitRepo(repoDir, ["init", "-b", "main"]);
  runGitRepo(repoDir, ["config", "user.name", "Exec Test"]);
  runGitRepo(repoDir, ["config", "user.email", "exec@prismux.local"]);
  writeFileSync(join(repoDir, "readme.md"), "# Init\n", "utf8");
  runGitRepo(repoDir, ["add", "readme.md"]);
  runGitRepo(repoDir, ["commit", "-m", "init"]);

  const capturedInvocations: Array<{
    command: string;
    args: readonly string[];
    env: NodeJS.ProcessEnv;
  }> = [];

  const defaultExecutor = createDefaultOvernightCodingExecutor({
    findExecutable: (candidates) => `/mock/bin/${candidates[0]}`,
    spawnRunner: async ({ executablePath, args, env, onLine }) => {
      capturedInvocations.push({ command: executablePath, args, env });
      onLine?.("Analyzing workspace...", "info");
      return {
        exitCode: 0,
        stdout: "Done cleanly\n",
        stderr: "",
        combinedOutput: "Done cleanly\n",
      };
    },
  });

  const stages: OvernightExecutionStage[] = [];
  const factory = new OvernightFactory({
    worktreeBaseDir: join(rootDir, "wt"),
    cleanupWorktree: true,
    defaultRepoTarget: {
      repoPath: repoDir,
      testCommand: `"${process.execPath}" -e "process.exit(0)"`,
    },
    codingExecutor: defaultExecutor,
  });

  // 1. Codex run completes with allowNoFileChanges=true, strips ELECTRON_RUN_AS_NODE, and never overrides originator
  process.env.ELECTRON_RUN_AS_NODE = "1";
  const codexRes = await factory.runEmailPipeline(
    {
      messageId: "<default-exec-1@qq.com>",
      from: "owner@qq.com",
      to: ["owner@qq.com"],
      subject: "#factory Audit readme",
      textBody: "Review readme and verify status",
    },
    {
      agentProvider: "codex",
      agentModel: "gpt-5.4-codex",
      allowNoFileChanges: true,
      onProgress: (evt) => {
        stages.push(evt.stage);
      },
    },
  );
  assert.equal(codexRes.status, "completed");
  assert.equal(capturedInvocations.length, 1);
  assert.equal(capturedInvocations[0]?.command, "/mock/bin/codex");
  assert.ok(capturedInvocations[0]?.args.includes("exec"));
  assert.ok(capturedInvocations[0]?.args.includes("gpt-5.4-codex"));
  assert.equal(capturedInvocations[0]?.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(capturedInvocations[0]?.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE, undefined);
  assert.equal(capturedInvocations[0]?.env.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.ok(stages.includes("preparing_worktree"));
  assert.ok(stages.includes("running_agent"));
  assert.ok(stages.includes("verifying"));
  assert.ok(stages.includes("reporting"));
  assert.ok(stages.includes("completed"));

  // 2. Personal AGY hard-blocked even directly inside default coding executor
  await assert.rejects(
    () =>
      factory.runEmailPipeline(
        {
          messageId: "<default-exec-agy@qq.com>",
          from: "owner@qq.com",
          to: ["owner@qq.com"],
          subject: "#factory Try AGY",
          textBody: "Should fail",
        },
        {
          agentProvider: "antigravity",
          allowNoFileChanges: true,
        },
      ),
    /AGY|Antigravity/i,
  );

  // 3. Pre-aborted AbortSignal throws OvernightTaskCancelledError cleanly
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      factory.runEmailPipeline(
        {
          messageId: "<default-exec-cancel@qq.com>",
          from: "owner@qq.com",
          to: ["owner@qq.com"],
          subject: "#factory Cancelled task",
          textBody: "Should cancel immediately",
        },
        {
          agentProvider: "codex",
          allowNoFileChanges: true,
          signal: controller.signal,
        },
      ),
    (err: unknown) => err instanceof OvernightTaskCancelledError,
  );
});
