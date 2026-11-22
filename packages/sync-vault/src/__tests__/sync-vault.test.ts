import assert from "node:assert/strict";
import { createHash, createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  assertDistinctBackupPassphrase,
  BACKUP_HEADER_MAGIC,
  BackupDecryptionError,
  DEFAULT_METADATA_TIMEOUT_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_SYNC_DOMAIN_MATRIX,
  exportOfflineBackup,
  filterInboundPayload,
  filterOutboundPayload,
  GitHubSyncChannel,
  inspectSealedBackupHeader,
  mergeConfigObject,
  mergeMemoryRecords,
  mergeUsageLedger,
  readStreamWithStallWatchdog,
  requestWithStallWatchdog,
  resolvePortableDataDir,
  resolveVaultPaths,
  S3SyncChannel,
  sealBackupPayload,
  StallTimeoutError,
  SyncVaultEngine,
  unsealBackupPayload,
  WebDavSyncChannel,
  type Argon2KdfParams,
  type OfflineBackupSnapshot,
  type SyncVaultPayload
} from "../index.js";

const FAST_KDF: Partial<Argon2KdfParams> = {
  memory: 1024,
  passes: 1,
  parallelism: 1,
  tagLength: 32
};

function normalizeRawEtag(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) return null;
  const trimmed = first.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

async function readIncomingBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function listenServer(
  server: http.Server | https.Server
): Promise<{ port: number; baseUrl: string }> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const scheme = server instanceof https.Server ? "https" : "http";
  return {
    port: addr.port,
    baseUrl: `${scheme}://127.0.0.1:${addr.port}`
  };
}

async function closeServer(server: http.Server | https.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

function generateSelfSignedCertForLocalhost(): {
  keyPem: string;
  certPem: string;
} {
  const derLen = (len: number): Buffer => {
    if (len < 128) return Buffer.from([len]);
    const bytes: number[] = [];
    let n = len;
    while (n > 0) {
      bytes.unshift(n & 0xff);
      n >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  };
  const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
    const body = Buffer.concat(parts);
    return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
  };
  const derInt = (buf: Buffer): Buffer => {
    const firstByte = buf[0] ?? 0;
    const b =
      (firstByte & 0x80) !== 0 ? Buffer.concat([Buffer.from([0]), buf]) : buf;
    return tlv(0x02, b);
  };
  const derBitString = (buf: Buffer): Buffer =>
    tlv(0x03, Buffer.from([0]), buf);
  const oid = (bytes: number[]): Buffer => tlv(0x06, Buffer.from(bytes));

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const sha256RsaOid = tlv(
    0x30,
    oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
    tlv(0x05)
  );
  const cn = tlv(
    0x30,
    tlv(0x31, tlv(0x30, oid([0x55, 0x04, 0x03]), tlv(0x0c, Buffer.from("127.0.0.1"))))
  );
  const validity = tlv(
    0x30,
    tlv(0x17, Buffer.from("240101000000Z")),
    tlv(0x17, Buffer.from("350101000000Z"))
  );
  const san = tlv(
    0xa3,
    tlv(
      0x30,
      tlv(
        0x30,
        oid([0x55, 0x1d, 0x11]),
        tlv(0x04, tlv(0x30, tlv(0x87, Buffer.from([127, 0, 0, 1]))))
      )
    )
  );
  const tbs = tlv(
    0x30,
    tlv(0xa0, derInt(Buffer.from([2]))),
    derInt(Buffer.from([1])),
    sha256RsaOid,
    cn,
    validity,
    cn,
    spki,
    san
  );
  const sig = createSign("RSA-SHA256").update(tbs).sign(privateKey);
  const certDer = tlv(0x30, tbs, sha256RsaOid, derBitString(sig));
  const certB64 = certDer.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return {
    certPem: `-----BEGIN CERTIFICATE-----\n${certB64}\n-----END CERTIFICATE-----\n`,
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string
  };
}

function verifyS3SigV4Header(
  req: http.IncomingMessage,
  urlPath: string,
  payloadBytes: Buffer,
  expectedAccessKeyId: string,
  secretAccessKey: string
): boolean {
  const auth = req.headers.authorization;
  const amzDate = req.headers["x-amz-date"];
  const contentSha = req.headers["x-amz-content-sha256"];
  const host = req.headers.host;
  if (
    typeof auth !== "string" ||
    typeof amzDate !== "string" ||
    typeof contentSha !== "string" ||
    typeof host !== "string"
  ) {
    return false;
  }

  const expectedPayloadHash = createHash("sha256")
    .update(payloadBytes)
    .digest("hex");
  if (contentSha !== expectedPayloadHash) {
    return false;
  }

  const match =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)$/.exec(
      auth
    );
  if (!match) return false;

  const [, accessKey, dateStamp, region, signedHeadersStr, signature] = match;
  if (accessKey !== expectedAccessKeyId || !dateStamp || !region || !signedHeadersStr) {
    return false;
  }

  const signedHeaders = signedHeadersStr.split(";");
  const canonicalHeaders = signedHeaders
    .map((h) => {
      const val = req.headers[h];
      const normalized = Array.isArray(val) ? val.join(",") : (val ?? "");
      return `${h}:${normalized.trim()}\n`;
    })
    .join("");

  const canonicalRequest = [
    (req.method ?? "GET").toUpperCase(),
    urlPath,
    "",
    canonicalHeaders,
    signedHeadersStr,
    contentSha
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${dateStamp}/${region}/s3/aws4_request`,
    createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");

  const hmac = (k: Buffer | string, d: string): Buffer =>
    createHmac("sha256", k).update(d, "utf8").digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const expectedSig = hmac(kSigning, stringToSign).toString("hex");

  return signature === expectedSig;
}

// ============================================================================
// DoD 1: Stall Watchdog (3-min slow stream survives + 60s zero-byte stalls)
// ============================================================================

test("DoD 1a: slow stream lasting 3 minutes completes without disconnect when bytes flow every 20s", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal(DEFAULT_STALL_TIMEOUT_MS, 60_000);
  assert.equal(DEFAULT_METADATA_TIMEOUT_MS, 30_000);

  const stream = new PassThrough();
  const readPromise = readStreamWithStallWatchdog(stream, 60_000);

  const writtenChunks: Buffer[] = [];
  for (let i = 0; i < 9; i += 1) {
    t.mock.timers.tick(20_000);
    const chunk = Buffer.alloc(16, i + 1);
    writtenChunks.push(chunk);
    stream.write(chunk);
    await Promise.resolve();
  }
  stream.end();

  const result = await readPromise;
  assert.equal(result.length, 9 * 16);
  assert.deepEqual(result, Buffer.concat(writtenChunks));
});

test("DoD 1b: stream stalls after 60s zero-byte silence and ignores zero-byte writes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const stream = new PassThrough();
  const readPromise = readStreamWithStallWatchdog(stream, 60_000);

  let settledState: "pending" | "resolved" | "rejected" = "pending";
  let capturedError: unknown;
  const watched = readPromise.then(
    () => {
      settledState = "resolved";
    },
    (err: unknown) => {
      settledState = "rejected";
      capturedError = err;
    }
  );

  // Initial 16 bytes resets the 60s countdown.
  stream.write(Buffer.alloc(16, 0xaa));
  await Promise.resolve();

  // Advance 40s, write an empty 0-byte chunk (must NOT reset timer), advance 19s -> 59s total.
  t.mock.timers.tick(40_000);
  stream.write(Buffer.alloc(0));
  t.mock.timers.tick(19_000);
  await Promise.resolve();
  assert.equal(
    settledState,
    "pending",
    "Watchdog must not fire before 60,000 ms of silence"
  );

  // Advance another 1,500 ms -> crosses 60,000 ms silence threshold.
  t.mock.timers.tick(1_500);
  await watched;

  assert.equal(settledState, "rejected");
  assert.ok(capturedError instanceof StallTimeoutError);
  assert.equal(capturedError.timeoutMs, 60_000);
  assert.ok(capturedError.message.includes("连续 60 秒无数据收发"));
});

test("DoD 1c: real wall-clock HTTP slow trickle succeeds while stalled HTTP transfer and hung HEAD trigger StallTimeoutError", async () => {
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === "/slow-ok") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      let count = 0;
      const pushNext = (): void => {
        if (res.destroyed || res.writableEnded) return;
        res.write(Buffer.alloc(16, count + 1));
        count += 1;
        if (count >= 4) {
          res.end();
        } else {
          timers.push(setTimeout(pushNext, 55));
        }
      };
      pushNext();
      return;
    }

    if (req.url === "/stall-midway") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.write(Buffer.alloc(16, 0x55));
      // Intentionally stop sending without ending response.
      return;
    }

    if (req.url === "/hang-head" && req.method === "HEAD") {
      // Intentionally do not respond so metadata timeout triggers.
      return;
    }

    if (req.url === "/upload-ok" && req.method === "PUT") {
      const received = await readIncomingBody(req);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(String(received.length));
      return;
    }

    if (req.url === "/upload-stall" && req.method === "PUT") {
      // Never drain/respond after upload stream stalls.
      req.on("data", () => {
        // consume initial chunk then wait silently
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const { baseUrl } = await listenServer(server);
  try {
    // 4 chunks * 55ms = ~165ms total > stallTimeoutMs (110ms), yet every gap < 110ms -> succeeds!
    const okRes = await requestWithStallWatchdog({
      url: `${baseUrl}/slow-ok`,
      method: "GET",
      stallTimeoutMs: 110
    });
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.body.length, 64);

    // Slow streaming PUT upload: 4 chunks spaced 55ms apart (>110ms total) -> succeeds!
    const uploadStreamOk = new PassThrough();
    let upCount = 0;
    const pushUpload = (): void => {
      if (uploadStreamOk.destroyed || uploadStreamOk.writableEnded) return;
      uploadStreamOk.write(Buffer.alloc(32, upCount + 1));
      upCount += 1;
      if (upCount >= 4) {
        uploadStreamOk.end();
      } else {
        timers.push(setTimeout(pushUpload, 55));
      }
    };
    pushUpload();
    const okUploadRes = await requestWithStallWatchdog({
      url: `${baseUrl}/upload-ok`,
      method: "PUT",
      body: uploadStreamOk,
      stallTimeoutMs: 110
    });
    assert.equal(okUploadRes.statusCode, 200);
    assert.equal(okUploadRes.body.toString("utf8"), "128");

    // Stalled PUT upload stream -> triggers StallTimeoutError
    const stalledUploadStream = new PassThrough();
    stalledUploadStream.write(Buffer.alloc(16, 0x77));
    await assert.rejects(
      () =>
        requestWithStallWatchdog({
          url: `${baseUrl}/upload-stall`,
          method: "PUT",
          body: stalledUploadStream,
          stallTimeoutMs: 110
        }),
      (err: unknown) => {
        assert.ok(err instanceof StallTimeoutError);
        assert.equal(err.timeoutMs, 110);
        return true;
      }
    );

    // Stalled response -> triggers StallTimeoutError
    await assert.rejects(
      () =>
        requestWithStallWatchdog({
          url: `${baseUrl}/stall-midway`,
          method: "GET",
          stallTimeoutMs: 110
        }),
      (err: unknown) => {
        assert.ok(err instanceof StallTimeoutError);
        assert.equal(err.timeoutMs, 110);
        return true;
      }
    );

    // Hung HEAD metadata request -> triggers metadataTimeoutMs fast timeout
    await assert.rejects(
      () =>
        requestWithStallWatchdog({
          url: `${baseUrl}/hang-head`,
          method: "HEAD",
          metadataTimeoutMs: 90,
          stallTimeoutMs: 5_000
        }),
      (err: unknown) => {
        assert.ok(err instanceof StallTimeoutError);
        assert.equal(err.timeoutMs, 90);
        return true;
      }
    );
  } finally {
    for (const timer of timers) clearTimeout(timer);
    await closeServer(server);
  }
});

// ============================================================================
// DoD 2: Optimistic Locking (If-Match 412 & Degraded HEAD ETag), S3, GitHub
// ============================================================================

test("DoD 2a: WebDAV concurrent uploads from Device A and Device B reject stale write via If-Match (412)", async () => {
  let storedBytes: Buffer = Buffer.from("initial-v1");
  let currentVersion = 1;
  const currentEtag = (): string => `"etag-v${currentVersion}"`;

  const server = http.createServer(async (req, res) => {
    const expectedAuth =
      "Basic " + Buffer.from("alice:dav-secret").toString("base64");
    if (req.headers.authorization !== expectedAuth) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    if (req.method === "PROPFIND") {
      res.writeHead(207, { "Content-Type": "application/xml" });
      res.end(
        `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/vault.prismux-backup</d:href><d:propstat><d:prop><d:getetag>${currentEtag()}</d:getetag><d:getcontentlength>${storedBytes.length}</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
      );
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, {
        ETag: currentEtag(),
        "Content-Length": String(storedBytes.length)
      });
      res.end();
      return;
    }

    if (req.method === "GET") {
      res.writeHead(200, {
        ETag: currentEtag(),
        "Content-Length": String(storedBytes.length)
      });
      res.end(storedBytes);
      return;
    }

    if (req.method === "PUT") {
      const body = await readIncomingBody(req);
      const ifMatch = normalizeRawEtag(req.headers["if-match"]);
      if (ifMatch !== `etag-v${currentVersion}`) {
        res.writeHead(412, { ETag: currentEtag() });
        res.end("Precondition Failed");
        return;
      }
      currentVersion += 1;
      storedBytes = body;
      res.writeHead(200, { ETag: currentEtag() });
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  const { baseUrl } = await listenServer(server);
  try {
    const cfg = {
      enabled: true,
      endpointUrl: `${baseUrl}/dav`,
      username: "alice",
      password: "dav-secret",
      remotePath: "vault.prismux-backup"
    };
    const deviceA = new WebDavSyncChannel(cfg);
    const deviceB = new WebDavSyncChannel(cfg);

    const entries = await deviceA.propfind();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.etag, "etag-v1");

    const headA = await deviceA.head();
    const headB = await deviceB.head();
    assert.equal(headA.etag, "etag-v1");
    assert.equal(headB.etag, "etag-v1");

    const [resA, resB] = await Promise.all([
      deviceA.uploadConditional(Buffer.from("payload-from-A"), headA.etag),
      deviceB.uploadConditional(Buffer.from("payload-from-B"), headB.etag)
    ]);

    const successes = [resA, resB].filter((r) => !r.conflictDetected);
    const conflicts = [resA, resB].filter((r) => r.conflictDetected);
    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(successes[0]?.etag, "etag-v2");
    assert.equal(conflicts[0]?.etag, "etag-v2");

    const downloaded = await deviceA.download();
    assert.equal(
      downloaded.data.toString("utf8"),
      resA.conflictDetected ? "payload-from-B" : "payload-from-A"
    );
  } finally {
    await closeServer(server);
  }
});

test("DoD 2b: legacy NAS returning 501 on If-Match triggers degraded HEAD ETag check and blocks stale overwrite", async () => {
  let storedBytes: Buffer = Buffer.from("nas-initial-v1");
  let currentVersion = 1;
  let unconditionalPutCount = 0;
  const currentEtag = (): string => `"nas-v${currentVersion}"`;

  const server = http.createServer(async (req, res) => {
    if (req.method === "HEAD") {
      res.writeHead(200, {
        ETag: currentEtag(),
        "Content-Length": String(storedBytes.length)
      });
      res.end();
      return;
    }

    if (req.method === "GET") {
      res.writeHead(200, { ETag: currentEtag() });
      res.end(storedBytes);
      return;
    }

    if (req.method === "PUT") {
      const body = await readIncomingBody(req);
      if (
        req.headers["if-match"] !== undefined ||
        req.headers["if-none-match"] !== undefined
      ) {
        // Legacy NAS rejects conditional headers with 501 Not Implemented.
        res.writeHead(501);
        res.end("Not Implemented");
        return;
      }
      unconditionalPutCount += 1;
      currentVersion += 1;
      storedBytes = body;
      res.writeHead(200, { ETag: currentEtag() });
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  const { baseUrl } = await listenServer(server);
  try {
    const cfg = {
      enabled: true,
      endpointUrl: `${baseUrl}/legacy`,
      username: "nas",
      password: "nas-password",
      remotePath: "backup.prismux-backup"
    };
    const deviceA = new WebDavSyncChannel(cfg);
    const deviceB = new WebDavSyncChannel(cfg);

    const initialA = await deviceA.head();
    const initialB = await deviceB.head();
    assert.equal(initialA.etag, "nas-v1");
    assert.equal(initialB.etag, "nas-v1");

    // Device A writes first: gets 501 -> HEAD matches nas-v1 -> unconditional PUT succeeds.
    const writeA = await deviceA.uploadConditional(
      Buffer.from("device-A-win"),
      initialA.etag
    );
    assert.equal(writeA.conflictDetected, false);
    assert.equal(writeA.degradedToHead, true);
    assert.equal(writeA.etag, "nas-v2");

    // Device B writes with stale nas-v1: gets 501 -> HEAD sees nas-v2 != nas-v1 -> aborts BEFORE PUT!
    const writeB = await deviceB.uploadConditional(
      Buffer.from("device-B-stale"),
      initialB.etag
    );
    assert.equal(writeB.conflictDetected, true);
    assert.equal(writeB.degradedToHead, true);
    assert.equal(writeB.etag, "nas-v2");

    // First-create expectation (expectedEtag = null) on legacy NAS also detects existing remote file!
    const createConflict = await deviceB.uploadConditional(
      Buffer.from("device-B-create-conflict"),
      null
    );
    assert.equal(createConflict.conflictDetected, true);
    assert.equal(createConflict.degradedToHead, true);
    assert.equal(createConflict.etag, "nas-v2");

    assert.equal(
      unconditionalPutCount,
      1,
      "Stale Device B must never send unconditional PUT after degraded HEAD mismatch"
    );
    assert.equal(storedBytes.toString("utf8"), "device-A-win");
  } finally {
    await closeServer(server);
  }
});

test("DoD 2c: S3SyncChannel enforces path-style URLs, SigV4 region=auto signing, If-Match/HEAD fallback, and self-signed LAN TLS", async () => {
  const accessKeyId = "AKIA_PRISMUX_TEST";
  const secretAccessKey = "s3-super-secret-key-999";
  let objectData: Buffer | null = Buffer.from("s3-v1");
  let version = 1;
  let forceLegacy501 = false;
  const seenPaths: string[] = [];

  const handleS3 = async (
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    seenPaths.push(reqUrl.pathname);
    const body = await readIncomingBody(req);

    const sigValid = verifyS3SigV4Header(
      req,
      reqUrl.pathname,
      body,
      accessKeyId,
      secretAccessKey
    );
    if (!sigValid) {
      res.writeHead(403);
      res.end("SignatureDoesNotMatch");
      return;
    }

    if (req.method === "HEAD") {
      if (!objectData) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        ETag: `"s3-v${version}"`,
        "Content-Length": String(objectData.length)
      });
      res.end();
      return;
    }

    if (req.method === "GET") {
      if (!objectData) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { ETag: `"s3-v${version}"` });
      res.end(objectData);
      return;
    }

    if (req.method === "PUT") {
      if (
        forceLegacy501 &&
        (req.headers["if-match"] !== undefined ||
          req.headers["if-none-match"] !== undefined)
      ) {
        res.writeHead(501);
        res.end("NotImplemented");
        return;
      }

      const ifMatch = normalizeRawEtag(req.headers["if-match"]);
      if (ifMatch !== null && ifMatch !== `s3-v${version}`) {
        res.writeHead(412, { ETag: `"s3-v${version}"` });
        res.end("PreconditionFailed");
        return;
      }

      version += 1;
      objectData = body;
      res.writeHead(200, { ETag: `"s3-v${version}"` });
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  };

  const httpServer = http.createServer(handleS3);
  const { baseUrl: httpBaseUrl } = await listenServer(httpServer);

  const { keyPem, certPem } = generateSelfSignedCertForLocalhost();
  const httpsServer = https.createServer({ key: keyPem, cert: certPem }, handleS3);
  const { baseUrl: httpsBaseUrl } = await listenServer(httpsServer);

  try {
    const s3 = new S3SyncChannel({
      enabled: true,
      endpointUrl: httpBaseUrl,
      region: "auto",
      bucket: "prismux-vault",
      forcePathStyle: true,
      allowSelfSignedTls: false,
      accessKeyId,
      secretAccessKey,
      keyPrefix: "devices",
      remoteKey: "sync.prismux-backup"
    });

    assert.equal(
      s3.buildObjectUrl().pathname,
      "/prismux-vault/devices/sync.prismux-backup"
    );

    const virtualHosted = new S3SyncChannel({
      enabled: true,
      endpointUrl: "https://s3.us-east-1.amazonaws.com",
      region: "us-east-1",
      bucket: "prismux-vault",
      forcePathStyle: false,
      allowSelfSignedTls: false,
      accessKeyId,
      secretAccessKey,
      remoteKey: "sync.prismux-backup"
    });
    assert.equal(
      virtualHosted.buildObjectUrl().toString(),
      "https://prismux-vault.s3.us-east-1.amazonaws.com/sync.prismux-backup"
    );

    const head1 = await s3.head();
    assert.equal(head1.exists, true);
    assert.equal(head1.etag, "s3-v1");

    const okPut = await s3.uploadConditional(
      Buffer.from("s3-v2-data"),
      "s3-v1"
    );
    assert.equal(okPut.conflictDetected, false);
    assert.equal(okPut.etag, "s3-v2");

    const stalePut = await s3.uploadConditional(
      Buffer.from("s3-stale"),
      "s3-v1"
    );
    assert.equal(stalePut.conflictDetected, true);
    assert.equal(stalePut.etag, "s3-v2");

    // Verify 501 fallback on S3/MinIO
    forceLegacy501 = true;
    const staleFallback = await s3.uploadConditional(
      Buffer.from("s3-stale-fallback"),
      "s3-v1"
    );
    assert.equal(staleFallback.conflictDetected, true);
    assert.equal(staleFallback.degradedToHead, true);
    assert.equal(staleFallback.etag, "s3-v2");

    // Verify strict TLS rejects self-signed cert while allowSelfSignedTls=true succeeds
    const strictTlsS3 = new S3SyncChannel({
      enabled: true,
      endpointUrl: httpsBaseUrl,
      region: "auto",
      bucket: "prismux-vault",
      forcePathStyle: true,
      allowSelfSignedTls: false,
      accessKeyId,
      secretAccessKey,
      remoteKey: "sync.prismux-backup"
    });
    await assert.rejects(() => strictTlsS3.head());

    const trustedSelfSignedS3 = new S3SyncChannel({
      enabled: true,
      endpointUrl: httpsBaseUrl,
      region: "auto",
      bucket: "prismux-vault",
      forcePathStyle: true,
      allowSelfSignedTls: true,
      accessKeyId,
      secretAccessKey,
      remoteKey: "sync.prismux-backup"
    });
    const downloaded = await trustedSelfSignedS3.download();
    assert.equal(downloaded.data.toString("utf8"), "s3-v2-data");
    assert.ok(
      seenPaths.includes("/prismux-vault/devices/sync.prismux-backup")
    );
  } finally {
    await closeServer(httpServer);
    await closeServer(httpsServer);
  }
});

test("DoD 2d: GitHubSyncChannel supports sha optimistic locking, diff preview, and commit rollback", async () => {
  interface StoredCommit {
    sha: string;
    message: string;
    blobSha: string;
    contentB64: string;
  }

  const commits: StoredCommit[] = [
    {
      sha: "commit-1",
      message: "init backup",
      blobSha: "blob-1",
      contentB64: Buffer.from("gh-payload-v1").toString("base64")
    }
  ];

  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer gh-token-secret");
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = reqUrl.pathname;

    if (
      req.method === "GET" &&
      path === "/repos/fish/vault/contents/vault/sync.prismux-backup"
    ) {
      const ref = reqUrl.searchParams.get("ref") ?? "main";
      const targetCommit =
        ref === "main"
          ? commits[commits.length - 1]
          : commits.find((c) => c.sha === ref);
      if (!targetCommit) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "Not Found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sha: targetCommit.blobSha,
          size: Buffer.from(targetCommit.contentB64, "base64").length,
          encoding: "base64",
          content: targetCommit.contentB64
        })
      );
      return;
    }

    if (
      req.method === "PUT" &&
      path === "/repos/fish/vault/contents/vault/sync.prismux-backup"
    ) {
      const bodyJson = JSON.parse(
        (await readIncomingBody(req)).toString("utf8")
      ) as {
        message: string;
        content: string;
        branch: string;
        sha?: string;
      };
      const latest = commits[commits.length - 1];
      if (latest && bodyJson.sha !== latest.blobSha) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "sha does not match" }));
        return;
      }
      const nextNum = commits.length + 1;
      const nextCommit: StoredCommit = {
        sha: `commit-${nextNum}`,
        message: bodyJson.message,
        blobSha: `blob-${nextNum}`,
        contentB64: bodyJson.content
      };
      commits.push(nextCommit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          content: { sha: nextCommit.blobSha },
          commit: { sha: nextCommit.sha }
        })
      );
      return;
    }

    if (req.method === "GET" && path === "/repos/fish/vault/commits") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          [...commits].reverse().map((c) => ({
            sha: c.sha,
            commit: {
              message: c.message,
              author: { name: "Prismux", date: "2026-11-22T00:00:00Z" }
            }
          }))
        )
      );
      return;
    }

    if (
      req.method === "GET" &&
      path.startsWith("/repos/fish/vault/compare/")
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ahead",
          ahead_by: 1,
          behind_by: 0,
          files: [
            {
              filename: "vault/sync.prismux-backup",
              status: "modified",
              additions: 1,
              deletions: 1,
              changes: 2
            }
          ]
        })
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const { baseUrl } = await listenServer(server);
  try {
    const gh = new GitHubSyncChannel({
      enabled: true,
      owner: "fish",
      repo: "vault",
      branch: "main",
      token: "gh-token-secret",
      apiBaseUrl: baseUrl,
      filePath: "vault/sync.prismux-backup"
    });

    const head1 = await gh.head();
    assert.equal(head1.etag, "blob-1");

    const okWrite = await gh.uploadConditional(
      Buffer.from("gh-payload-v2"),
      "blob-1"
    );
    assert.equal(okWrite.conflictDetected, false);
    assert.equal(okWrite.etag, "blob-2");
    assert.equal(okWrite.commitSha, "commit-2");

    const staleWrite = await gh.uploadConditional(
      Buffer.from("gh-stale"),
      "blob-1"
    );
    assert.equal(staleWrite.conflictDetected, true);
    assert.equal(staleWrite.etag, "blob-2");

    const diff = await gh.previewDiff({
      localBytes: Buffer.from("gh-local-candidate")
    });
    assert.equal(diff.commits.length, 2);
    assert.equal(diff.compare?.aheadBy, 1);
    assert.equal(diff.compare?.files[0]?.filename, "vault/sync.prismux-backup");
    assert.equal(diff.localComparison?.changed, true);

    const rollback = await gh.rollbackToCommit("commit-1");
    assert.equal(rollback.conflictDetected, false);
    assert.equal(rollback.rolledBackToCommit, "commit-1");

    const afterRollback = await gh.download();
    assert.equal(afterRollback.data.toString("utf8"), "gh-payload-v1");
  } finally {
    await closeServer(server);
  }
});

test("DoD 2e: SyncVaultEngine end-to-end concurrent sync detects conflict, unseals remote, and three-way merges", async () => {
  let storedBlob: Buffer = sealBackupPayload(
    {
      schemaVersion: 1,
      privateMemory: [{ id: "01J00000000000000000000001", updatedAt: 100, text: "init" }],
      config: { theme: "dark", fontSize: 14 }
    } satisfies SyncVaultPayload,
    "passphrase-alpha",
    [],
    { kdfParams: FAST_KDF }
  );
  let version = 1;

  const server = http.createServer(async (req, res) => {
    if (req.method === "HEAD") {
      res.writeHead(200, { ETag: `"v${version}"` });
      res.end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, { ETag: `"v${version}"` });
      res.end(storedBlob);
      return;
    }
    if (req.method === "PUT") {
      const body = await readIncomingBody(req);
      if (normalizeRawEtag(req.headers["if-match"]) !== `v${version}`) {
        res.writeHead(412, { ETag: `"v${version}"` });
        res.end();
        return;
      }
      version += 1;
      storedBlob = body;
      res.writeHead(200, { ETag: `"v${version}"` });
      res.end();
      return;
    }
    res.writeHead(405);
    res.end();
  });

  const { baseUrl } = await listenServer(server);
  try {
    const engineA = new SyncVaultEngine({
      machineId: "machine-a",
      kdfParams: FAST_KDF,
      webdav: {
        enabled: true,
        endpointUrl: `${baseUrl}/sync`,
        username: "u",
        password: "dav-password-only"
      }
    });
    const engineB = new SyncVaultEngine({
      machineId: "machine-b",
      kdfParams: FAST_KDF,
      webdav: {
        enabled: true,
        endpointUrl: `${baseUrl}/sync`,
        username: "u",
        password: "dav-password-only"
      }
    });

    const baseConfig = { theme: "dark", fontSize: 14 };
    const payloadA: SyncVaultPayload = {
      schemaVersion: 1,
      privateMemory: [
        { id: "01J00000000000000000000001", updatedAt: 100, text: "init" },
        { id: "01J00000000000000000000002", updatedAt: 200, text: "from-A" }
      ],
      config: { theme: "liquid-glass", fontSize: 14 }
    };
    const payloadB: SyncVaultPayload = {
      schemaVersion: 1,
      privateMemory: [
        { id: "01J00000000000000000000001", updatedAt: 100, text: "init" },
        { id: "01J00000000000000000000003", updatedAt: 250, text: "from-B" }
      ],
      config: { theme: "dark", fontSize: 18 }
    };

    const resA = await engineA.syncNow({
      passphrase: "passphrase-alpha",
      localPayload: payloadA,
      baseConfig,
      expectedEtag: "v1"
    });
    assert.equal(resA.conflictDetected, false);
    assert.equal(resA.etag, "v2");

    // Device B uploads with stale v1 -> detects conflict and produces non-conflicting merged payload!
    const resB = await engineB.syncNow({
      passphrase: "passphrase-alpha",
      localPayload: payloadB,
      baseConfig,
      expectedEtag: "v1"
    });
    assert.equal(resB.conflictDetected, true);
    assert.equal(resB.etag, "v2");
    assert.deepEqual(resB.conflicts, []);
    assert.equal(resB.mergedPayload?.privateMemory?.length, 3);
    assert.deepEqual(resB.mergedPayload?.config, {
      theme: "liquid-glass",
      fontSize: 18
    });
  } finally {
    await closeServer(server);
  }
});

// ============================================================================
// DoD 3: Argon2id + ChaCha20-Poly1305 Seal, Offline Secrets, Portable, Matrix
// ============================================================================

test("DoD 3a: Argon2id + ChaCha20-Poly1305 seal/unseal rejects wrong passphrase, 1-byte tampering, and matching remote secrets", () => {
  const payload = { hello: "prismux", entries: [1, 2, 3] };
  const passphrase = "correct-horse-battery-staple";

  assert.throws(
    () =>
      assertDistinctBackupPassphrase("same-secret", [
        "other",
        "same-secret"
      ]),
    /must not match/i
  );

  assert.throws(
    () =>
      sealBackupPayload(payload, "s3-secret-pw", ["s3-secret-pw"], {
        kdfParams: FAST_KDF
      }),
    /must not match/i
  );

  // Test production default Argon2id parameters once as well.
  const prodSealed = sealBackupPayload(payload, passphrase, ["unrelated-secret"]);
  assert.equal(
    prodSealed.subarray(0, 8).toString("ascii"),
    BACKUP_HEADER_MAGIC
  );
  const prodUnsealed = unsealBackupPayload<typeof payload>(
    prodSealed,
    passphrase
  );
  assert.deepEqual(prodUnsealed.payload, payload);
  assert.equal(prodUnsealed.metadata.kdf, "argon2id");
  assert.equal(prodUnsealed.metadata.cipher, "chacha20-poly1305");

  // Fast KDF seal for comprehensive byte-tampering assertions.
  const sealed = sealBackupPayload(payload, passphrase, ["remote-pw"], {
    kdfParams: FAST_KDF
  });

  // Wrong passphrase rejected.
  assert.throws(
    () => unsealBackupPayload(sealed, "wrong-passphrase"),
    BackupDecryptionError
  );

  // Tampering 1 byte in magic header rejected.
  const badMagic = Buffer.from(sealed);
  badMagic[0] = badMagic[0]! ^ 0xff;
  assert.throws(
    () => unsealBackupPayload(badMagic, passphrase),
    BackupDecryptionError
  );

  // Tampering 1 byte inside metadata JSON rejected by AAD check.
  const inspected = inspectSealedBackupHeader(sealed);
  const badMeta = Buffer.from(sealed);
  const metaMid = 12 + Math.floor((inspected.headerBytes.length - 12) / 2);
  badMeta[metaMid] = badMeta[metaMid]! ^ 0x01;
  assert.throws(
    () => unsealBackupPayload(badMeta, passphrase),
    BackupDecryptionError
  );

  // Tampering 1 byte in ciphertext rejected by Poly1305 authTag.
  const badCipher = Buffer.from(sealed);
  const cipherIdx = inspected.headerBytes.length;
  badCipher[cipherIdx] = badCipher[cipherIdx]! ^ 0x01;
  assert.throws(
    () => unsealBackupPayload(badCipher, passphrase),
    BackupDecryptionError
  );

  // Tampering 1 byte in AuthTag rejected.
  const badTag = Buffer.from(sealed);
  badTag[badTag.length - 1] = badTag[badTag.length - 1]! ^ 0x01;
  assert.throws(
    () => unsealBackupPayload(badTag, passphrase),
    BackupDecryptionError
  );
});

test("DoD 3b: exportOfflineBackup strips apiKeys/authSessions/pluginCredentials unless double-confirmed", () => {
  const snapshot: OfflineBackupSnapshot = {
    schemaVersion: 1,
    machineId: "workstation-1",
    privateMemory: [{ id: "m1", content: "note" }],
    apiKeys: { openai: "sk-secret-123" },
    authSessions: [{ provider: "github", token: "gho_xxx" }],
    pluginCredentials: { qq: { accessToken: "qq-secret" } }
  };

  // Default export strips all secrets.
  const defaultExport = exportOfflineBackup(snapshot, {
    passphrase: "offline-passphrase",
    kdfParams: FAST_KDF
  });
  assert.equal(defaultExport.containsSecrets, false);
  assert.ok(defaultExport.strippedFields.includes("apiKeys"));
  assert.ok(defaultExport.strippedFields.includes("authSessions"));
  assert.ok(defaultExport.strippedFields.includes("pluginCredentials"));

  const unsealedDefault = unsealBackupPayload<OfflineBackupSnapshot>(
    defaultExport.sealedBytes,
    "offline-passphrase"
  );
  assert.equal(unsealedDefault.metadata.containsSecrets, false);
  assert.equal(unsealedDefault.payload.apiKeys, undefined);
  assert.equal(unsealedDefault.payload.authSessions, undefined);
  assert.equal(unsealedDefault.payload.pluginCredentials, undefined);
  assert.deepEqual(unsealedDefault.payload.privateMemory, snapshot.privateMemory);

  // includeSecrets without passphraseConfirmed MUST still strip secrets.
  const unconfirmedExport = exportOfflineBackup(snapshot, {
    passphrase: "offline-passphrase",
    includeSecrets: true,
    passphraseConfirmed: false,
    kdfParams: FAST_KDF
  });
  assert.equal(unconfirmedExport.containsSecrets, false);
  const unsealedUnconfirmed = unsealBackupPayload<OfflineBackupSnapshot>(
    unconfirmedExport.sealedBytes,
    "offline-passphrase"
  );
  assert.equal(unsealedUnconfirmed.payload.apiKeys, undefined);
  assert.equal(unsealedUnconfirmed.payload.authSessions, undefined);
  assert.equal(unsealedUnconfirmed.payload.pluginCredentials, undefined);

  // Double-confirmed export includes secrets.
  const confirmedExport = exportOfflineBackup(snapshot, {
    passphrase: "offline-passphrase",
    includeSecrets: true,
    passphraseConfirmed: true,
    kdfParams: FAST_KDF
  });
  assert.equal(confirmedExport.containsSecrets, true);
  assert.deepEqual(confirmedExport.strippedFields, []);
  const unsealedConfirmed = unsealBackupPayload<OfflineBackupSnapshot>(
    confirmedExport.sealedBytes,
    "offline-passphrase"
  );
  assert.equal(unsealedConfirmed.metadata.containsSecrets, true);
  assert.deepEqual(unsealedConfirmed.payload.apiKeys, snapshot.apiKeys);
  assert.deepEqual(unsealedConfirmed.payload.authSessions, snapshot.authSessions);
  assert.deepEqual(
    unsealedConfirmed.payload.pluginCredentials,
    snapshot.pluginCredentials
  );
});

test("DoD 3c: portable mode converges all vault paths into executableDir/data/ when directory exists", () => {
  const root = mkdtempSync(join(tmpdir(), "prismux-portable-test-"));
  const defaultDir = join(root, "default-user-dir");
  try {
    // No data/ directory -> standard mode
    const stdRes = resolvePortableDataDir({
      executableDir: root,
      defaultDataDir: defaultDir
    });
    assert.deepEqual(stdRes, { isPortable: false, dataDir: defaultDir });

    // `data` exists as a regular file, NOT a directory -> still standard mode
    const execWithFile = join(root, "exec-file");
    mkdirSync(execWithFile, { recursive: true });
    writeFileSync(join(execWithFile, "data"), "not-a-dir");
    const fileRes = resolvePortableDataDir({
      executableDir: execWithFile,
      defaultDataDir: defaultDir
    });
    assert.deepEqual(fileRes, { isPortable: false, dataDir: defaultDir });

    // `data/` exists as directory -> portable mode!
    const execPortable = join(root, "exec-portable");
    const expectedDataDir = join(execPortable, "data");
    mkdirSync(expectedDataDir, { recursive: true });
    const portRes = resolvePortableDataDir({
      executableDir: execPortable,
      defaultDataDir: defaultDir
    });
    assert.deepEqual(portRes, { isPortable: true, dataDir: expectedDataDir });

    const paths = resolveVaultPaths(portRes);
    assert.equal(paths.isPortable, true);
    for (const p of [
      paths.dataDir,
      paths.dbPath,
      paths.cacheDir,
      paths.logsDir,
      paths.configDir,
      paths.credentialsDir,
      paths.backupsDir,
      paths.syncStatePath
    ]) {
      assert.ok(
        p.startsWith(expectedDataDir),
        `Expected path "${p}" to reside inside "${expectedDataDir}"`
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DoD 3d: independent remote channel toggles preserve configuration when disabled", () => {
  const engine = new SyncVaultEngine({
    webdav: {
      enabled: true,
      endpointUrl: "https://dav.nutstore.example/dav",
      username: "fish",
      passwordRef: "webdav-pw"
    },
    s3: {
      enabled: true,
      endpointUrl: "https://nas.local:9000",
      region: "auto",
      bucket: "prismux-sync",
      forcePathStyle: true,
      allowSelfSignedTls: true,
      accessKeyId: "MINIO_KEY",
      secretKeyRef: "s3-secret"
    },
    github: {
      enabled: true,
      owner: "Fish-under-sea",
      repo: "prismux-backup",
      branch: "main",
      tokenRef: "gh-token"
    }
  });

  assert.deepEqual(engine.getEnabledChannels(), ["webdav", "s3", "github"]);

  // Disable S3 and verify every S3 config field remains intact.
  engine.setChannelEnabled("s3", false);
  assert.deepEqual(engine.getEnabledChannels(), ["webdav", "github"]);
  const s3Cfg = engine.getChannelConfig("s3");
  assert.ok(s3Cfg);
  assert.equal(s3Cfg.enabled, false);
  assert.equal(s3Cfg.endpointUrl, "https://nas.local:9000");
  assert.equal(s3Cfg.region, "auto");
  assert.equal(s3Cfg.bucket, "prismux-sync");
  assert.equal(s3Cfg.forcePathStyle, true);
  assert.equal(s3Cfg.allowSelfSignedTls, true);
  assert.equal(s3Cfg.accessKeyId, "MINIO_KEY");
  assert.equal(s3Cfg.secretKeyRef, "s3-secret");

  // Re-enabling S3 restores active state cleanly.
  engine.setChannelEnabled("s3", true);
  assert.deepEqual(engine.getEnabledChannels(), ["webdav", "s3", "github"]);
});

test("DoD 3f: zero-arg SyncVaultEngine preserves compatibility and enforces configured remote secret check", async () => {
  const emptyEngine = new SyncVaultEngine();
  assert.deepEqual(emptyEngine.getEnabledChannels(), []);
  assert.deepEqual(emptyEngine.getWatchdogConfig(), {
    stallTimeoutMs: 60_000,
    metadataTimeoutMs: 30_000
  });
  const emptyRun = await emptyEngine.syncNow();
  assert.equal(emptyRun.conflictDetected, false);
  assert.equal(emptyRun.etag, null);

  const engineWithSecretResolver = new SyncVaultEngine({
    kdfParams: FAST_KDF,
    resolveSecret: (ref) =>
      ref === "s3-secret" ? "resolved-s3-secret" : undefined,
    s3: {
      enabled: true,
      endpointUrl: "https://s3.example.com",
      region: "auto",
      bucket: "vault",
      forcePathStyle: true,
      allowSelfSignedTls: false,
      accessKeyId: "AK",
      secretKeyRef: "s3-secret"
    }
  });

  await assert.rejects(
    () =>
      engineWithSecretResolver.exportOfflineBackup(
        { privateMemory: [] },
        { passphrase: "resolved-s3-secret" }
      ),
    /must not match/i
  );
});

test("DoD 3e: three-way merge handles ULID tombstones, usage ledger deduplication, config conflicts, and 7-domain machine filtering", () => {
  // 1. ULID memory merge + soft-delete tombstone propagation
  const localMem = [
    { id: "01JAAA00000000000000000001", updatedAt: 100, content: "old" },
    {
      id: "01JAAA00000000000000000002",
      updatedAt: 200,
      deletedAt: 200,
      content: "deleted-locally"
    },
    {
      id: "01JAAA00000000000000000003",
      updatedAt: 300,
      content: "tie-active"
    }
  ];
  const remoteMem = [
    { id: "01JAAA00000000000000000001", updatedAt: 150, content: "newer" },
    {
      id: "01JAAA00000000000000000002",
      updatedAt: 120,
      deletedAt: null,
      content: "stale-resurrection-attempt"
    },
    {
      id: "01JAAA00000000000000000003",
      updatedAt: 300,
      deletedAt: 300,
      content: "tie-tombstone"
    }
  ];
  const mergedMem = mergeMemoryRecords(localMem, remoteMem);
  assert.equal(mergedMem.length, 3);
  assert.equal(mergedMem[0]?.content, "newer");
  assert.equal(mergedMem[1]?.deletedAt, 200);
  assert.equal(mergedMem[2]?.deletedAt, 300);
  // Idempotent across repeated merges
  assert.deepEqual(mergeMemoryRecords(mergedMem, remoteMem), mergedMem);

  // 2. Usage ledger deduplication by (machineId, entryId) prevents double counting
  const localUsage = [
    {
      machineId: "laptop-1",
      entryId: "usage-001",
      totalTokens: 1200,
      estimatedCostUsd: 0.02
    },
    {
      machineId: "laptop-1",
      entryId: "usage-002",
      totalTokens: 800,
      estimatedCostUsd: 0.01
    }
  ];
  const remoteUsage = [
    {
      machineId: "laptop-1",
      entryId: "usage-001",
      totalTokens: 1200,
      estimatedCostUsd: 0.02
    },
    {
      machineId: "desktop-2",
      entryId: "usage-001",
      totalTokens: 500,
      estimatedCostUsd: 0.01
    }
  ];
  const mergedUsage = mergeUsageLedger(localUsage, remoteUsage);
  assert.equal(mergedUsage.length, 3);
  const sumTokens = mergedUsage.reduce((acc, u) => acc + (u.totalTokens ?? 0), 0);
  assert.equal(sumTokens, 2500); // 1200 + 800 + 500 (NOT 1200+1200!)

  // 3. Config three-way merge detects conflicts without silent overwrite
  const baseCfg = {
    theme: "light",
    language: "zh-CN",
    glass: { blur: 18, rim: 0.45 }
  };
  const localCfg = {
    theme: "dark",
    language: "zh-CN",
    glass: { blur: 24, rim: 0.45 }
  };
  const remoteCfg = {
    theme: "liquid-glass",
    language: "en-US",
    glass: { blur: 24, rim: 0.6 }
  };
  const cfgResult = mergeConfigObject(baseCfg, localCfg, remoteCfg);
  assert.equal(cfgResult.merged["language"], "en-US");
  assert.deepEqual(cfgResult.merged["glass"], { blur: 24, rim: 0.6 });
  assert.equal(cfgResult.conflicts.length, 1);
  assert.deepEqual(cfgResult.conflicts[0], {
    path: "theme",
    baseValue: "light",
    localValue: "dark",
    remoteValue: "liquid-glass"
  });

  // 4. 7-domain matrix & local/allowedMachines filtering
  const rawPayload: SyncVaultPayload = {
    privateMemory: [{ id: "p1", updatedAt: 1 }],
    workspaceMemory: [{ id: "w1", updatedAt: 1 }],
    socialMemory: [{ id: "s1", updatedAt: 1 }],
    commandsAndMcp: {
      localSteamBridge: { path: "D:\\Steam", local: true },
      macOnlyMcp: { url: "http://10.0.0.2", allowedMachines: ["mac-pro"] },
      sharedMcp: { url: "https://mcp.shared.example" }
    },
    plugins: [
      { id: "plugin-a", allowedMachines: ["work-pc", "mac-pro"] },
      { id: "plugin-local", local: true }
    ],
    appearancePresets: [
      { id: "preset-shared" },
      { id: "preset-local-wall", local: true }
    ],
    usageLedger: [{ machineId: "work-pc", entryId: "u1", totalTokens: 100 }]
  };

  const matrix = {
    ...DEFAULT_SYNC_DOMAIN_MATRIX,
    socialMemory: { upload: false, download: false },
    workspaceMemory: { upload: true, download: false }
  };

  const outboundForWork = filterOutboundPayload(rawPayload, matrix, "work-pc");
  assert.equal(outboundForWork.socialMemory, undefined);
  assert.equal(outboundForWork.workspaceMemory?.length, 1);
  assert.deepEqual(outboundForWork.commandsAndMcp, {
    sharedMcp: { url: "https://mcp.shared.example" }
  });
  assert.deepEqual(outboundForWork.plugins, [
    { id: "plugin-a", allowedMachines: ["work-pc", "mac-pro"] }
  ]);
  assert.deepEqual(outboundForWork.appearancePresets, [{ id: "preset-shared" }]);

  const inboundForLaptop = filterInboundPayload(rawPayload, matrix, "laptop-9");
  assert.equal(inboundForLaptop.socialMemory, undefined);
  assert.equal(inboundForLaptop.workspaceMemory, undefined);
  assert.deepEqual(inboundForLaptop.plugins, []);
  assert.deepEqual(inboundForLaptop.commandsAndMcp, {
    sharedMcp: { url: "https://mcp.shared.example" }
  });
});
