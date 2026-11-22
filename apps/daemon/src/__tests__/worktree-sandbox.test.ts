import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import {
  DEFAULT_ALLOWED_EGRESS_DOMAINS,
  SandboxEgressProxy,
  WorktreeSandbox,
  assertWriteTargetAllowed,
  buildIsolationSpec,
  isDomainAllowed,
  isWriteTargetAllowed,
  selectPlatformSandboxBackend
} from "../sandbox/WorktreeSandbox.js";

function sendHttpViaProxy(options: {
  proxyHost: string;
  proxyPort: number;
  targetUrl: string;
  method?: string;
  body?: string;
}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.request(
      {
        host: options.proxyHost,
        port: options.proxyPort,
        path: options.targetUrl,
        method: options.method ?? "GET",
        headers:
          options.body !== undefined
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(options.body)
              }
            : undefined
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolvePromise({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    req.on("error", rejectPromise);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

function sendConnectHandshake(options: {
  proxyHost: string;
  proxyPort: number;
  authority: string;
}): Promise<{
  statusLine: string;
  socket: net.Socket;
  bufferedTail: Buffer;
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = net.connect({
      host: options.proxyHost,
      port: options.proxyPort
    });

    let buffer = Buffer.alloc(0);
    let settled = false;

    const onError = (err: Error) => {
      if (!settled) {
        settled = true;
        rejectPromise(err);
      }
    };

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      settled = true;
      socket.off("data", onData);
      socket.off("error", onError);

      const headerText = buffer.subarray(0, headerEnd).toString("utf8");
      const statusLine = headerText.split("\r\n")[0] ?? "";
      const bufferedTail = buffer.subarray(headerEnd + 4);
      resolvePromise({ statusLine, socket, bufferedTail });
    };

    socket.on("error", onError);
    socket.on("data", onData);
    socket.once("connect", () => {
      socket.write(
        `CONNECT ${options.authority} HTTP/1.1\r\nHost: ${options.authority}\r\n\r\n`
      );
    });
  });
}

function readSocketUntilClose(
  socket: net.Socket,
  initialBuffer: Buffer = Buffer.alloc(0)
): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] =
      initialBuffer.length > 0 ? [initialBuffer] : [];
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.on("error", rejectPromise);
    socket.on("end", () => {
      resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

test("selectPlatformSandboxBackend and createPolicy defaults", () => {
  assert.equal(selectPlatformSandboxBackend("linux"), "bwrap");
  assert.equal(selectPlatformSandboxBackend("darwin"), "sandbox-exec");
  assert.equal(
    selectPlatformSandboxBackend("win32"),
    "windows-restricted-token"
  );

  const sandbox = new WorktreeSandbox();
  const defaultPolicy = sandbox.createPolicy({
    worktreePath: "/repo/worktree-a",
    platform: "linux"
  });

  assert.equal(defaultPolicy.backend, "bwrap");
  assert.equal(defaultPolicy.worktreePath, "/repo/worktree-a");
  assert.deepEqual(defaultPolicy.writableTempDirs, []);
  assert.equal(defaultPolicy.egress.enabled, false);
  assert.deepEqual(
    defaultPolicy.egress.allowedDomains,
    [...DEFAULT_ALLOWED_EGRESS_DOMAINS]
  );

  const customPolicy = sandbox.createPolicy({
    worktreePath: "C:\\work\\wt",
    writableTempDirs: ["C:\\temp\\wt-cache"],
    egressEnabled: true,
    allowedDomains: [],
    proxyPort: 18080,
    platform: "win32"
  });
  assert.equal(customPolicy.backend, "windows-restricted-token");
  assert.deepEqual(customPolicy.egress.allowedDomains, []);
  assert.equal(customPolicy.egress.proxyPort, 18080);
});

test("write target boundary blocks traversal, sibling prefixes, system paths, and symlinks", async (t) => {
  const sandbox = new WorktreeSandbox();

  // 1. Windows lexical, case-insensitivity, prefix spoofing & traversal checks
  const winPolicy = sandbox.createPolicy({
    worktreePath: "C:\\work\\wt",
    writableTempDirs: ["C:\\temp\\sandbox-cache"],
    platform: "win32"
  });

  assert.equal(sandbox.isWriteTargetAllowed(winPolicy, "C:\\work\\wt"), true);
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "C:\\work\\wt\\src\\index.ts"),
    true
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "c:\\WORK\\WT\\Src\\App.ts"),
    true
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "C:/work/wt/nested/file.json"),
    true
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "C:\\work\\wt\\..evil"),
    true
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(
      winPolicy,
      "C:\\temp\\sandbox-cache\\npm\\pkg.tgz"
    ),
    true
  );

  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "C:\\work\\wt-evil"),
    false
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "C:\\work\\wt-evil\\payload.txt"),
    false
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "C:\\work\\wt\\..\\secret.txt"),
    false
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(
      winPolicy,
      "C:\\work\\wt\\a\\..\\..\\outside\\pwn.txt"
    ),
    false
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(
      winPolicy,
      "C:\\Windows\\System32\\drivers\\etc\\hosts"
    ),
    false
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "D:\\work\\wt\\file.ts"),
    false
  );
  assert.equal(sandbox.isWriteTargetAllowed(winPolicy, ""), false);
  assert.equal(sandbox.isWriteTargetAllowed(winPolicy, "   "), false);
  assert.equal(
    sandbox.isWriteTargetAllowed(winPolicy, "C:\\work\\wt\\evil\0.txt"),
    false
  );

  assert.doesNotThrow(() =>
    sandbox.assertWriteTargetAllowed(winPolicy, "C:\\work\\wt\\ok.ts")
  );
  assert.throws(
    () => assertWriteTargetAllowed(winPolicy, "C:\\work\\wt-evil\\bad.ts"),
    /Sandbox write blocked/
  );

  // 2. POSIX case-sensitivity & traversal checks
  const linuxPolicy = sandbox.createPolicy({
    worktreePath: "/workspace/wt",
    writableTempDirs: ["/tmp/prismux-wt"],
    platform: "linux"
  });

  assert.equal(
    isWriteTargetAllowed(linuxPolicy, "/workspace/wt/src/main.ts"),
    true
  );
  assert.equal(
    isWriteTargetAllowed(linuxPolicy, "/tmp/prismux-wt/build.log"),
    true
  );
  assert.equal(
    isWriteTargetAllowed(linuxPolicy, "/workspace/wt-evil/main.ts"),
    false
  );
  assert.equal(
    isWriteTargetAllowed(linuxPolicy, "/WORKSPACE/wt/src/main.ts"),
    false
  );
  assert.equal(
    isWriteTargetAllowed(linuxPolicy, "/workspace/wt/../etc/shadow"),
    false
  );
  assert.equal(isWriteTargetAllowed(linuxPolicy, "/etc/passwd"), false);

  // 3. Real filesystem symlink / junction escape check
  const sandboxTestRoot = await mkdtemp(
    join(tmpdir(), "prismux-sandbox-fs-")
  );
  t.after(async () => {
    await rm(sandboxTestRoot, { recursive: true, force: true });
  });

  const realWorktree = join(sandboxTestRoot, "wt");
  const realTempDir = join(sandboxTestRoot, "tmp-cache");
  const outsideDir = join(sandboxTestRoot, "outside-secret");
  await mkdir(join(realWorktree, "src"), { recursive: true });
  await mkdir(realTempDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });

  const realCodeFile = join(realWorktree, "src", "app.ts");
  const outsideSecretFile = join(outsideDir, "token.txt");
  await writeFile(realCodeFile, "export const ok = true;\n", "utf8");
  await writeFile(outsideSecretFile, "TOP_SECRET\n", "utf8");

  const realPolicy = sandbox.createPolicy({
    worktreePath: realWorktree,
    writableTempDirs: [realTempDir]
  });

  assert.equal(sandbox.isWriteTargetAllowed(realPolicy, realCodeFile), true);
  assert.equal(
    sandbox.isWriteTargetAllowed(realPolicy, join(realTempDir, "cache.bin")),
    true
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(realPolicy, outsideSecretFile),
    false
  );

  const escapeLinkPath = join(realWorktree, "escape-link");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(outsideDir, escapeLinkPath, linkType);

  assert.equal(
    sandbox.isWriteTargetAllowed(
      realPolicy,
      join(escapeLinkPath, "token.txt")
    ),
    false
  );
  assert.equal(
    sandbox.isWriteTargetAllowed(
      realPolicy,
      join(escapeLinkPath, "brand-new-file.txt")
    ),
    false
  );
  assert.throws(
    () =>
      sandbox.assertWriteTargetAllowed(
        realPolicy,
        join(escapeLinkPath, "token.txt")
      ),
    /Sandbox write blocked/
  );
});

test("buildIsolationSpec generates valid specs for Linux bwrap, macOS sandbox-exec, and Windows restricted token", () => {
  const sandbox = new WorktreeSandbox();

  // 1. Linux bwrap (egress disabled & enabled)
  const linuxOfflinePolicy = sandbox.createPolicy({
    worktreePath: "/repo/wt-1",
    writableTempDirs: ["/tmp/wt-1-cache", "/var/tmp/wt-1-build"],
    egressEnabled: false,
    platform: "linux"
  });
  const linuxOfflineSpec = sandbox.buildIsolationSpec(
    linuxOfflinePolicy,
    "node",
    ["dist/runner.js", "--check"],
    {
      baseEnv: {
        PATH: "/usr/bin",
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_NO_ATTACH_CONSOLE: "1",
        HTTP_PROXY: "http://host-proxy:8888"
      }
    }
  );

  assert.equal(linuxOfflineSpec.backend, "bwrap");
  assert.equal(linuxOfflineSpec.command, "bwrap");
  assert.equal(linuxOfflineSpec.networkIsolated, true);
  assert.deepEqual(linuxOfflineSpec.args, [
    "--ro-bind",
    "/",
    "/",
    "--bind",
    "/repo/wt-1",
    "/repo/wt-1",
    "--bind",
    "/tmp/wt-1-cache",
    "/tmp/wt-1-cache",
    "--bind",
    "/var/tmp/wt-1-build",
    "/var/tmp/wt-1-build",
    "--unshare-net",
    "--chdir",
    "/repo/wt-1",
    "--",
    "node",
    "dist/runner.js",
    "--check"
  ]);
  assert.equal("ELECTRON_RUN_AS_NODE" in linuxOfflineSpec.env, false);
  assert.equal("ELECTRON_NO_ATTACH_CONSOLE" in linuxOfflineSpec.env, false);
  assert.equal("HTTP_PROXY" in linuxOfflineSpec.env, false);

  const linuxOnlinePolicy = sandbox.createPolicy({
    worktreePath: "/repo/wt-1",
    writableTempDirs: ["/tmp/wt-1-cache"],
    egressEnabled: true,
    proxyPort: 19090,
    platform: "linux"
  });
  const linuxOnlineSpec = buildIsolationSpec(linuxOnlinePolicy, "npm", [
    "test"
  ]);
  assert.equal(linuxOnlineSpec.args.includes("--unshare-net"), false);
  assert.equal(linuxOnlineSpec.networkIsolated, false);
  assert.equal(linuxOnlineSpec.env.HTTP_PROXY, "http://127.0.0.1:19090");
  assert.equal(linuxOnlineSpec.env.HTTPS_PROXY, "http://127.0.0.1:19090");

  // 2. macOS sandbox-exec SBPL
  const darwinOfflinePolicy = sandbox.createPolicy({
    worktreePath: "/Users/dev/wt-mac",
    writableTempDirs: ["/tmp/mac-wt-tmp"],
    egressEnabled: false,
    platform: "darwin"
  });
  const darwinSpec = sandbox.buildIsolationSpec(
    darwinOfflinePolicy,
    "git",
    ["status"],
    {
      baseEnv: {
        PATH: "/usr/bin",
        ELECTRON_RUN_AS_NODE: "1"
      }
    }
  );

  assert.equal(darwinSpec.backend, "sandbox-exec");
  assert.equal(darwinSpec.command, "sandbox-exec");
  assert.equal(darwinSpec.networkIsolated, true);
  assert.ok(darwinSpec.sbplProfile !== undefined);
  assert.equal(darwinSpec.args[0], "-p");
  assert.equal(darwinSpec.args[1], darwinSpec.sbplProfile);
  assert.deepEqual(darwinSpec.args.slice(2), ["git", "status"]);
  assert.match(darwinSpec.sbplProfile, /\(version 1\)/);
  assert.match(darwinSpec.sbplProfile, /\(deny file-write\*\)/);
  assert.match(
    darwinSpec.sbplProfile,
    /\(subpath "\/Users\/dev\/wt-mac"\)/
  );
  assert.match(darwinSpec.sbplProfile, /\(subpath "\/tmp\/mac-wt-tmp"\)/);
  assert.match(darwinSpec.sbplProfile, /\(deny network-outbound\)/);
  assert.equal("ELECTRON_RUN_AS_NODE" in darwinSpec.env, false);

  const darwinProxyPolicy = sandbox.createPolicy({
    worktreePath: "/Users/dev/wt-mac",
    writableTempDirs: [],
    egressEnabled: true,
    proxyPort: 28080,
    platform: "darwin"
  });
  const darwinProxySpec = buildIsolationSpec(darwinProxyPolicy, "curl", [
    "https://github.com"
  ]);
  assert.ok(darwinProxySpec.sbplProfile !== undefined);
  assert.match(darwinProxySpec.sbplProfile, /\(deny network-outbound\)/);
  assert.match(
    darwinProxySpec.sbplProfile,
    /\(allow network-outbound \(remote ip "127\.0\.0\.1:28080"\)\)/
  );

  // 3. Windows restricted token + env sanitization & isolation
  const winPolicyOffline = sandbox.createPolicy({
    worktreePath: "C:\\work\\wt-win",
    writableTempDirs: ["C:\\temp\\wt-win-tmp"],
    egressEnabled: false,
    platform: "win32"
  });
  const winSpecOffline = sandbox.buildIsolationSpec(
    winPolicyOffline,
    "node.exe",
    ["build.mjs"],
    {
      baseEnv: {
        SystemRoot: "C:\\Windows",
        ELECTRON_RUN_AS_NODE: "1",
        electron_run_as_node: "1",
        ELECTRON_NO_ATTACH_CONSOLE: "1",
        TMP: "C:\\Windows\\Temp",
        temp: "C:\\Users\\Fish\\AppData\\Local\\Temp",
        HTTP_PROXY: "http://127.0.0.1:7895",
        HTTPS_PROXY: "http://127.0.0.1:7895"
      }
    }
  );

  assert.equal(winSpecOffline.backend, "windows-restricted-token");
  assert.equal(winSpecOffline.command, "node.exe");
  assert.deepEqual(winSpecOffline.args, ["build.mjs"]);
  assert.equal(winSpecOffline.cwd, "C:\\work\\wt-win");
  assert.equal(winSpecOffline.env.SystemRoot, "C:\\Windows");
  assert.equal("ELECTRON_RUN_AS_NODE" in winSpecOffline.env, false);
  assert.equal("electron_run_as_node" in winSpecOffline.env, false);
  assert.equal("ELECTRON_NO_ATTACH_CONSOLE" in winSpecOffline.env, false);
  assert.equal("HTTP_PROXY" in winSpecOffline.env, false);
  assert.equal("HTTPS_PROXY" in winSpecOffline.env, false);
  assert.equal("temp" in winSpecOffline.env, false);
  assert.equal(winSpecOffline.env.TMP, "C:\\temp\\wt-win-tmp");
  assert.equal(winSpecOffline.env.TEMP, "C:\\temp\\wt-win-tmp");
  assert.equal(
    winSpecOffline.env.PRISMUX_SANDBOX_WORKTREE,
    "C:\\work\\wt-win"
  );
  assert.equal(
    winSpecOffline.env.PRISMUX_SANDBOX_MODE,
    "restricted-token"
  );
  assert.equal(winSpecOffline.windowsJobPolicy?.restrictedToken, true);
  assert.equal(winSpecOffline.windowsJobPolicy?.killOnJobClose, true);

  const winPolicyOnline = sandbox.createPolicy({
    worktreePath: "C:\\work\\wt-win",
    writableTempDirs: [],
    egressEnabled: true,
    platform: "win32"
  });
  const winSpecOnline = sandbox.buildIsolationSpec(
    winPolicyOnline,
    "pnpm.cmd",
    ["install"],
    {
      baseEnv: { ELECTRON_RUN_AS_NODE: "1" },
      proxyUrl: "http://127.0.0.1:39123"
    }
  );
  assert.equal(winSpecOnline.env.TMP, "C:\\work\\wt-win\\.prismux-tmp");
  assert.equal(winSpecOnline.env.TEMP, "C:\\work\\wt-win\\.prismux-tmp");
  assert.equal(winSpecOnline.env.HTTP_PROXY, "http://127.0.0.1:39123");
  assert.equal(winSpecOnline.env.HTTPS_PROXY, "http://127.0.0.1:39123");
  assert.equal("ELECTRON_RUN_AS_NODE" in winSpecOnline.env, false);
});

test("isDomainAllowed enforces exact and dot-separated subdomains and rejects spoofed domains", () => {
  const allowlist = [...DEFAULT_ALLOWED_EGRESS_DOMAINS];

  // Allowed exact & subdomains (including case & port normalization)
  assert.equal(isDomainAllowed("github.com", allowlist), true);
  assert.equal(isDomainAllowed("api.github.com", allowlist), true);
  assert.equal(isDomainAllowed("API.GITHUB.COM:443", allowlist), true);
  assert.equal(isDomainAllowed("codeload.github.com.", allowlist), true);
  assert.equal(isDomainAllowed("registry.npmjs.org", allowlist), true);
  assert.equal(isDomainAllowed("cdn.registry.npmjs.org:8443", allowlist), true);

  // Spoofed prefixes / suffixes / malformed inputs MUST be rejected
  assert.equal(isDomainAllowed("evil-github.com", allowlist), false);
  assert.equal(isDomainAllowed("mygithub.com", allowlist), false);
  assert.equal(isDomainAllowed("github.com.attacker.cn", allowlist), false);
  assert.equal(isDomainAllowed("github.com.evil.org", allowlist), false);
  assert.equal(isDomainAllowed("fake-registry.npmjs.org", allowlist), false);
  assert.equal(isDomainAllowed("registry.npmjs.org.evil.net", allowlist), false);
  assert.equal(isDomainAllowed("user@github.com", allowlist), false);
  assert.equal(isDomainAllowed("github.com/path", allowlist), false);
  assert.equal(isDomainAllowed("github.com:99999", allowlist), false);
  assert.equal(isDomainAllowed("", allowlist), false);
  assert.equal(isDomainAllowed("*", allowlist), false);

  // Wildcard / empty allowlist entries must never become open relay
  assert.equal(isDomainAllowed("evil.com", ["", "*"]), false);

  // IPv6 & IPv4 exact matching without false suffix matching
  assert.equal(isDomainAllowed("[::1]:8080", ["::1"]), true);
  assert.equal(isDomainAllowed("::1", ["[::1]"]), true);
  assert.equal(isDomainAllowed("127.0.0.1:4567", ["127.0.0.1"]), true);
  assert.equal(isDomainAllowed("999.127.0.0.1", ["127.0.0.1"]), false);
});

test("SandboxEgressProxy blocks all HTTP and CONNECT traffic when egress.enabled is false", async (t) => {
  let upstreamHits = 0;
  const upstreamServer = http.createServer((_req, res) => {
    upstreamHits += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise<void>((resolveListen) => {
    upstreamServer.listen(0, "127.0.0.1", resolveListen);
  });
  t.after(async () => {
    upstreamServer.closeAllConnections?.();
    await new Promise<void>((resolveClose) =>
      upstreamServer.close(() => resolveClose())
    );
  });

  const upstreamPort = (upstreamServer.address() as AddressInfo).port;
  const sandbox = new WorktreeSandbox();
  const policy = sandbox.createPolicy({
    worktreePath: process.cwd(),
    egressEnabled: false,
    allowedDomains: ["127.0.0.1"]
  });

  const proxy = sandbox.createEgressProxy(policy);
  await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const proxyPort = proxy.getPort();
  assert.equal(proxy.getProxyUrl(), `http://127.0.0.1:${proxyPort}`);

  // 1. HTTP GET must be rejected with 403 and never touch upstream
  const httpRes = await sendHttpViaProxy({
    proxyHost: "127.0.0.1",
    proxyPort,
    targetUrl: `http://127.0.0.1:${upstreamPort}/hello`
  });
  assert.equal(httpRes.statusCode, 403);
  const errorJson = JSON.parse(httpRes.body) as {
    error: string;
    host: string;
    reason: string;
  };
  assert.equal(errorJson.error, "EgressBlocked");
  assert.equal(errorJson.host, "127.0.0.1");
  assert.match(errorJson.reason, /disabled/i);

  // 2. HTTPS CONNECT must receive 403 Forbidden and close cleanly
  const connectRes = await sendConnectHandshake({
    proxyHost: "127.0.0.1",
    proxyPort,
    authority: `127.0.0.1:${upstreamPort}`
  });
  assert.match(connectRes.statusLine, /^HTTP\/1\.1 403 Forbidden/i);
  await readSocketUntilClose(connectRes.socket, connectRes.bufferedTail);

  assert.equal(upstreamHits, 0);

  const audit = proxy.getAuditLog();
  assert.equal(audit.length, 2);
  assert.equal(audit[0]?.protocol, "HTTP");
  assert.equal(audit[0]?.targetHost, "127.0.0.1");
  assert.equal(audit[0]?.decision, "deny");
  assert.equal(audit[1]?.protocol, "CONNECT");
  assert.equal(audit[1]?.targetHost, "127.0.0.1");
  assert.equal(audit[1]?.decision, "deny");
});

test("SandboxEgressProxy forwards allowlisted HTTP & CONNECT tunnels and blocks unauthorized domains with audit log", async (t) => {
  const upstreamServer = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/echo") {
      const bodyChunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
      req.on("end", () => {
        const text = Buffer.concat(bodyChunks).toString("utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ echoed: text }));
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/json",
      "X-Upstream-Seen": "prismux-test"
    });
    res.end(
      JSON.stringify({
        ok: true,
        method: req.method,
        url: req.url
      })
    );
  });

  await new Promise<void>((resolveListen) => {
    upstreamServer.listen(0, "127.0.0.1", resolveListen);
  });
  t.after(async () => {
    upstreamServer.closeAllConnections?.();
    await new Promise<void>((resolveClose) =>
      upstreamServer.close(() => resolveClose())
    );
  });

  const upstreamPort = (upstreamServer.address() as AddressInfo).port;
  const sandbox = new WorktreeSandbox();
  const policy = sandbox.createPolicy({
    worktreePath: process.cwd(),
    egressEnabled: true,
    allowedDomains: ["127.0.0.1"]
  });

  const proxy = new SandboxEgressProxy(policy);
  const proxyUrl = await proxy.start();
  t.after(async () => {
    await proxy.stop();
  });

  const proxyPort = proxy.getPort();
  assert.equal(proxyUrl, `http://127.0.0.1:${proxyPort}`);

  // 1. Allowlisted HTTP GET
  const getRes = await sendHttpViaProxy({
    proxyHost: "127.0.0.1",
    proxyPort,
    targetUrl: `http://127.0.0.1:${upstreamPort}/hello?x=1`
  });
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(JSON.parse(getRes.body), {
    ok: true,
    method: "GET",
    url: "/hello?x=1"
  });

  // 2. Allowlisted HTTP POST
  const postRes = await sendHttpViaProxy({
    proxyHost: "127.0.0.1",
    proxyPort,
    targetUrl: `http://127.0.0.1:${upstreamPort}/echo`,
    method: "POST",
    body: JSON.stringify({ hello: "sandbox" })
  });
  assert.equal(postRes.statusCode, 200);
  assert.deepEqual(JSON.parse(postRes.body), {
    echoed: JSON.stringify({ hello: "sandbox" })
  });

  // 3. Allowlisted CONNECT tunnel carries real bidirectional TCP traffic
  const tunnel = await sendConnectHandshake({
    proxyHost: "127.0.0.1",
    proxyPort,
    authority: `127.0.0.1:${upstreamPort}`
  });
  assert.match(
    tunnel.statusLine,
    /^HTTP\/1\.1 200 Connection Established/i
  );

  tunnel.socket.write(
    `GET /tunnel-check HTTP/1.1\r\nHost: 127.0.0.1:${upstreamPort}\r\nConnection: close\r\n\r\n`
  );
  const tunnelRawResponse = await readSocketUntilClose(
    tunnel.socket,
    tunnel.bufferedTail
  );
  assert.match(tunnelRawResponse, /^HTTP\/1\.1 200 OK/);
  assert.match(tunnelRawResponse, /X-Upstream-Seen: prismux-test/i);
  assert.match(tunnelRawResponse, /"url":"\/tunnel-check"/);

  // 4. Unauthorized HTTP request MUST return 403 without DNS/network dial
  const blockedHttp = await sendHttpViaProxy({
    proxyHost: "127.0.0.1",
    proxyPort,
    targetUrl: "http://blocked.example.com/secret"
  });
  assert.equal(blockedHttp.statusCode, 403);
  const blockedBody = JSON.parse(blockedHttp.body) as {
    error: string;
    host: string;
    reason: string;
  };
  assert.equal(blockedBody.error, "EgressBlocked");
  assert.equal(blockedBody.host, "blocked.example.com");

  // 5. Unauthorized CONNECT tunnel MUST return 403
  const blockedConnect = await sendConnectHandshake({
    proxyHost: "127.0.0.1",
    proxyPort,
    authority: "blocked.example.com:443"
  });
  assert.match(blockedConnect.statusLine, /^HTTP\/1\.1 403 Forbidden/i);
  await readSocketUntilClose(
    blockedConnect.socket,
    blockedConnect.bufferedTail
  );

  // 6. Verify full audit trail
  const audit = proxy.getAuditLog();
  assert.equal(audit.length, 5);
  assert.deepEqual(
    audit.map((entry) => ({
      protocol: entry.protocol,
      targetHost: entry.targetHost,
      decision: entry.decision
    })),
    [
      { protocol: "HTTP", targetHost: "127.0.0.1", decision: "allow" },
      { protocol: "HTTP", targetHost: "127.0.0.1", decision: "allow" },
      { protocol: "CONNECT", targetHost: "127.0.0.1", decision: "allow" },
      {
        protocol: "HTTP",
        targetHost: "blocked.example.com",
        decision: "deny"
      },
      {
        protocol: "CONNECT",
        targetHost: "blocked.example.com",
        decision: "deny"
      }
    ]
  );
  for (const entry of audit) {
    assert.equal(typeof entry.timestamp, "number");
    assert.ok(entry.timestamp > 0);
    assert.ok(entry.reason.length > 0);
  }
});
