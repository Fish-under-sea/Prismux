import assert from "node:assert/strict";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type {
  PluginContext,
  PluginCredentialsHandle,
  PluginDisposable
} from "@prismux/protocol";
import {
  SshHostPool,
  SshSecurityError,
  SshValidationError,
  apply,
  applyWithOptions,
  buildSafeSshArgs,
  manifest,
  resolveSafeSftpPath,
  type SshHostProfile,
  type SshPluginRuntime
} from "../index.js";

function createIsolatedEncryptedCredentials(
  credFilePath: string,
  pluginId: string
): PluginCredentialsHandle {
  const key = Buffer.from(
    hkdfSync("sha256", randomBytes(32), pluginId, "ssh-test-cred-v1", 32)
  );
  const aad = Buffer.from(`ssh-test:${pluginId}`, "utf8");

  const readMap = (): Record<string, string> => {
    if (!existsSync(credFilePath)) {
      return {};
    }
    const raw = readFileSync(credFilePath);
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("chacha20-poly1305", key, iv, {
      authTagLength: 16
    });
    decipher.setAAD(aad, { plaintextLength: ct.byteLength });
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8"
    );
    return JSON.parse(pt) as Record<string, string>;
  };

  const writeMap = (map: Record<string, string>): void => {
    const iv = randomBytes(12);
    const pt = Buffer.from(JSON.stringify(map), "utf8");
    const cipher = createCipheriv("chacha20-poly1305", key, iv, {
      authTagLength: 16
    });
    cipher.setAAD(aad, { plaintextLength: pt.byteLength });
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    writeFileSync(credFilePath, Buffer.concat([iv, tag, ct]), { mode: 0o600 });
    chmodSync(credFilePath, 0o600);
  };

  return {
    async get(credKey) {
      const map = readMap();
      return Object.prototype.hasOwnProperty.call(map, credKey)
        ? (map[credKey] ?? null)
        : null;
    },
    async set(credKey, value) {
      const map = readMap();
      map[credKey] = value;
      writeMap(map);
    },
    async delete(credKey) {
      if (!existsSync(credFilePath)) {
        return;
      }
      const map = readMap();
      delete map[credKey];
      writeMap(map);
    }
  };
}

function createHarnessContext(
  realm: "daemon" | "ui",
  credentials: PluginCredentialsHandle
): {
  ctx: PluginContext;
  routes: Map<string, (payload: unknown) => Promise<unknown> | unknown>;
  panels: Map<string, { title: string; component?: unknown }>;
  disposables: PluginDisposable[];
  disposeAll: () => Promise<void>;
} {
  const routes = new Map<string, (payload: unknown) => Promise<unknown> | unknown>();
  const panels = new Map<string, { title: string; component?: unknown }>();
  const disposables: PluginDisposable[] = [];

  const ctx: PluginContext = {
    manifest,
    realm,
    distribution: "managed",
    credentials,
    logger: {
      info() {},
      warn() {},
      error() {}
    },
    effect(disposable) {
      disposables.push(disposable);
    },
    registerRoute(method, path, handler) {
      const key = `${method} ${path}`;
      routes.set(key, handler as (payload: unknown) => Promise<unknown> | unknown);
      disposables.push(() => {
        routes.delete(key);
      });
    },
    registerPanel(panelId, definition) {
      panels.set(panelId, definition);
      disposables.push(() => {
        panels.delete(panelId);
      });
    }
  };

  return {
    ctx,
    routes,
    panels,
    disposables,
    async disposeAll() {
      while (disposables.length > 0) {
        const fn = disposables.pop();
        if (fn !== undefined) {
          await fn();
        }
      }
    }
  };
}

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SshHostPool isolates secrets exclusively in encrypted ctx.credentials and forbids inline secrets in profile JSON", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-ssh-pool-"));
  tempDirs.push(workDir);

  const credFile = join(workDir, "ssh.enc");
  const storagePath = join(workDir, "hosts.json");
  const credentials = createIsolatedEncryptedCredentials(credFile, "ssh");

  const pool = new SshHostPool({ credentials, storagePath });

  const secretPassword = "super-secret-ssh-password-99";
  const secretPassphrase = "ed25519-key-passphrase-42";
  const secretPem = "-----BEGIN OPENSSH PRIVATE KEY-----\nTESTKEYDATA\n-----END OPENSSH PRIVATE KEY-----";

  const created = await pool.createHost(
    {
      id: "prod-bastion",
      host: "bastion.internal.example",
      port: 2222,
      username: "deploy_ops",
      label: "生产跳板机",
      authType: "key",
      privateKeyPath: "/home/deploy/.ssh/id_ed25519",
      sftpRootDir: "/srv/releases",
      knownHostsPolicy: "strict"
    },
    {
      password: secretPassword,
      passphrase: secretPassphrase,
      privateKeyPem: secretPem
    }
  );

  assert.equal(created.id, "prod-bastion");
  assert.equal(created.credentialRef, "ssh:host:prod-bastion");

  // Profile JSON on disk & exported JSON MUST NOT contain any secret material
  const exportedJson = pool.exportProfilesJson();
  const diskProfileJson = readFileSync(storagePath, "utf8");
  for (const rawJson of [exportedJson, diskProfileJson]) {
    assert.equal(rawJson.includes(secretPassword), false);
    assert.equal(rawJson.includes(secretPassphrase), false);
    assert.equal(rawJson.includes("TESTKEYDATA"), false);
    assert.equal(rawJson.includes("password"), false);
    assert.equal(rawJson.includes("passphrase"), false);
  }

  // Encrypted credential blob on disk MUST NOT contain plaintext secrets either
  const rawEncryptedBlob = readFileSync(credFile);
  assert.equal(rawEncryptedBlob.includes(Buffer.from(secretPassword)), false);
  assert.equal(rawEncryptedBlob.includes(Buffer.from(secretPassphrase)), false);
  assert.equal(rawEncryptedBlob.includes(Buffer.from("TESTKEYDATA")), false);

  // Secrets decrypt cleanly from ctx.credentials
  const loadedSecrets = await pool.getHostSecrets("prod-bastion");
  assert.deepEqual(loadedSecrets, {
    password: secretPassword,
    passphrase: secretPassphrase,
    privateKeyPem: secretPem
  });

  // Attempting to embed inline password or passphrase directly on profile object throws SshSecurityError
  await assert.rejects(
    () =>
      pool.upsertHost({
        id: "unsafe-inline",
        host: "10.0.0.5",
        port: 22,
        username: "ops",
        passphrase: "must-fail-inline-secret"
      } as unknown as SshHostProfile),
    SshSecurityError
  );

  // Attempting to load profile JSON containing inline secrets throws SshSecurityError
  assert.throws(
    () =>
      pool.loadProfilesFromJson(
        JSON.stringify({
          hosts: [
            {
              id: "bad-json",
              host: "10.0.0.8",
              port: 22,
              username: "ops",
              password: "leak"
            }
          ]
        })
      ),
    SshSecurityError
  );

  // CRUD update + reload from disk + delete (purging encrypted secrets)
  const updated = await pool.updateHost("prod-bastion", { port: 22022 });
  assert.equal(updated.port, 22022);
  assert.equal(pool.listHosts().length, 1);

  const reloadedPool = new SshHostPool({ credentials, storagePath });
  const reloadedHosts = reloadedPool.loadFromDisk();
  assert.equal(reloadedHosts.length, 1);
  assert.equal(reloadedHosts[0]?.port, 22022);
  assert.equal(
    (await reloadedPool.getHostSecrets("prod-bastion"))?.passphrase,
    secretPassphrase
  );

  const deleted = await reloadedPool.deleteHost("prod-bastion");
  assert.equal(deleted, true);
  assert.equal(reloadedPool.getHost("prod-bastion"), undefined);
  assert.equal(await reloadedPool.getHostSecrets("prod-bastion"), null);
});

test("buildSafeSshArgs validates host, port, username and blocks option/shell injection", () => {
  // Valid hostname, IPv4, IPv6, and port bounds
  const hostnameArgs = buildSafeSshArgs(
    {
      id: "node-1",
      host: "web-01.prod.example.com",
      port: 22,
      username: "deploy_01",
      privateKeyPath: "/keys/id_ed25519",
      knownHostsPolicy: "accept-new"
    },
    { batchMode: true, connectTimeoutSec: 15, allocateTty: true }
  );
  assert.deepEqual(hostnameArgs, [
    "-p",
    "22",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "-tt",
    "-i",
    "/keys/id_ed25519",
    "--",
    "deploy_01@web-01.prod.example.com"
  ]);

  const ipv4Args = buildSafeSshArgs({
    id: "v4",
    host: "192.168.10.25",
    port: 1,
    username: "root"
  });
  assert.equal(ipv4Args.at(-1), "root@192.168.10.25");

  const ipv6Args = buildSafeSshArgs({
    id: "v6",
    host: "2001:db8::1",
    port: 65535,
    username: "admin.user-1"
  });
  assert.equal(ipv6Args.at(-1), "admin.user-1@2001:db8::1");

  // Option injection attempts (`-` prefix)
  assert.throws(
    () =>
      buildSafeSshArgs({
        id: "inj-user",
        host: "example.com",
        port: 22,
        username: "-oProxyCommand=calc.exe"
      }),
    SshSecurityError
  );
  assert.throws(
    () =>
      buildSafeSshArgs({
        id: "inj-host",
        host: "-oProxyCommand=id",
        port: 22,
        username: "ops"
      }),
    SshSecurityError
  );
  assert.throws(
    () =>
      buildSafeSshArgs({
        id: "inj-key",
        host: "example.com",
        port: 22,
        username: "ops",
        privateKeyPath: "-oPermitLocalCommand=yes"
      }),
    SshSecurityError
  );

  // Shell metacharacter injection attempts
  for (const malicious of [
    "ops;rm -rf /",
    "ops&&id",
    "ops|cat",
    "ops`id`",
    "ops$(id)",
    "ops name",
    "ops\nid",
    "ops\0id",
    "ops^calc",
    "ops!echo"
  ]) {
    assert.throws(
      () =>
        buildSafeSshArgs({
          id: "meta-user",
          host: "example.com",
          port: 22,
          username: malicious
        }),
      Error
    );
    assert.throws(
      () =>
        buildSafeSshArgs({
          id: "meta-host",
          host: malicious,
          port: 22,
          username: "ops"
        }),
      Error
    );
  }

  // Invalid port bounds
  for (const badPort of [0, -1, 65536, 22.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        buildSafeSshArgs({
          id: "bad-port",
          host: "example.com",
          port: badPort,
          username: "ops"
        }),
      SshValidationError
    );
  }
});

test("resolveSafeSftpPath blocks '..' traversal, absolute paths, and symlink/junction escapes", () => {
  const sandboxBase = mkdtempSync(join(tmpdir(), "prismux-sftp-jail-"));
  tempDirs.push(sandboxBase);

  const sftpRoot = join(sandboxBase, "sftp-root");
  const insideDir = join(sftpRoot, "releases", "v1");
  const outsideDir = join(sandboxBase, "outside-secrets");
  mkdirSync(insideDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(insideDir, "app.zip"), "ok");
  writeFileSync(join(outsideDir, "master.key"), "TOP_SECRET");

  const realRoot = realpathSync(sftpRoot);

  // Safe relative paths
  assert.equal(resolveSafeSftpPath(sftpRoot, "."), realRoot);
  assert.equal(resolveSafeSftpPath(sftpRoot, ""), realRoot);
  assert.equal(
    resolveSafeSftpPath(sftpRoot, "releases/v1/app.zip"),
    join(realRoot, "releases", "v1", "app.zip")
  );
  assert.equal(
    resolveSafeSftpPath(sftpRoot, "./releases/./v1/new-upload.tar.gz"),
    join(realRoot, "releases", "v1", "new-upload.tar.gz")
  );

  // Lexical `..` traversal, absolute paths, drive letters, and NUL bytes
  for (const badPath of [
    "..",
    "../outside-secrets/master.key",
    "releases/../../outside-secrets/master.key",
    "releases\\..\\..\\outside-secrets",
    "/etc/passwd",
    "\\Windows\\System32\\drivers\\etc\\hosts",
    "C:\\Windows\\win.ini",
    "releases/file\0.txt"
  ]) {
    assert.throws(
      () => resolveSafeSftpPath(sftpRoot, badPath),
      SshSecurityError
    );
  }

  // Symlink / NTFS directory junction escape outside root
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const escapeLinkPath = join(sftpRoot, "escape-link");
  symlinkSync(outsideDir, escapeLinkPath, linkType);

  assert.throws(
    () => resolveSafeSftpPath(sftpRoot, "escape-link/master.key"),
    SshSecurityError
  );
  assert.throws(
    () => resolveSafeSftpPath(sftpRoot, "escape-link/new-child/file.txt"),
    SshSecurityError
  );

  // Internal symlink/junction pointing INSIDE root remains permitted and resolves inside root
  const internalLinkPath = join(sftpRoot, "latest");
  symlinkSync(insideDir, internalLinkPath, linkType);
  const resolvedInternal = resolveSafeSftpPath(sftpRoot, "latest/app.zip");
  assert.equal(resolvedInternal, join(realRoot, "releases", "v1", "app.zip"));
});

test("plugin-ssh apply(ctx) wires daemon routes, UI panel, and closes all active sessions on ctx.effect()", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-ssh-lifecycle-"));
  tempDirs.push(workDir);
  const credentials = createIsolatedEncryptedCredentials(
    join(workDir, "ssh.enc"),
    "ssh"
  );

  const daemonHarness = createHarnessContext("daemon", credentials);
  let runtime: SshPluginRuntime | undefined;
  applyWithOptions(daemonHarness.ctx, {
    storagePath: join(workDir, "hosts.json"),
    onRuntimeCreated(r) {
      runtime = r;
    }
  });

  assert.ok(runtime?.pool);
  assert.ok(runtime?.sessions);
  assert.equal(daemonHarness.routes.size, 5);

  const postHost = daemonHarness.routes.get("POST /plugins/ssh/hosts");
  const prepareSession = daemonHarness.routes.get(
    "POST /plugins/ssh/sessions/prepare"
  );
  const resolveSftp = daemonHarness.routes.get("POST /plugins/ssh/sftp/resolve");
  assert.ok(postHost && prepareSession && resolveSftp);

  const sftpRoot = join(workDir, "sftp");
  mkdirSync(sftpRoot, { recursive: true });

  await postHost({
    profile: {
      id: "staging",
      host: "staging.example.net",
      port: 2222,
      username: "deployer",
      sftpRootDir: sftpRoot
    },
    secrets: { passphrase: "staging-key-passphrase" }
  });

  let closedByEffect = false;
  const prepared = (await prepareSession({
    hostId: "staging",
    kind: "pty",
    onClose() {
      closedByEffect = true;
    }
  })) as {
    session: { sessionId: string; closed: boolean };
    spawn: { command: string; args: string[]; shell: boolean };
  };

  assert.equal(prepared.spawn.command, "ssh");
  assert.equal(prepared.spawn.shell, false);
  assert.equal(prepared.spawn.args.at(-1), "deployer@staging.example.net");
  assert.equal(runtime.sessions.getActiveCount(), 1);

  const sftpResolved = (await resolveSftp({
    hostId: "staging",
    requestedPath: "bundle/release.zip"
  })) as { resolvedPath: string };
  assert.equal(
    sftpResolved.resolvedPath,
    join(realpathSync(sftpRoot), "bundle", "release.zip")
  );

  // Unmount daemon realm -> ctx.effect() closes all active sessions & clears routes
  await daemonHarness.disposeAll();
  assert.equal(closedByEffect, true);
  assert.equal(runtime.sessions.isDisposed(), true);
  assert.equal(runtime.sessions.getActiveCount(), 0);
  assert.equal(daemonHarness.routes.size, 0);

  // UI realm registers panel and disposes cleanly
  const uiHarness = createHarnessContext("ui", credentials);
  apply(uiHarness.ctx);
  assert.equal(uiHarness.panels.has("ssh-workbench"), true);
  await uiHarness.disposeAll();
  assert.equal(uiHarness.panels.size, 0);
});
