import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  locateOfficialAgyExecutable,
  OfficialQuotaService,
  parseAgyCreditsTsv,
  parseAgyUsageTsv,
  PrismuxDaemon,
  type OfficialCliExecResult
} from "../index.js";

const SAMPLE_AGY_USAGE_TSV = [
  "Gemini Models\tWeekly Limit Remaining\t93%\t2026-11-30T20:03:11Z",
  "Gemini Models\tFive Hour Limit Remaining\t92%\t2026-11-24T09:34:15Z",
  "Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-12-01T06:04:49Z",
  "Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-24T11:04:49Z"
].join("\n");

describe("OfficialQuotaService TSV parser & caching", () => {
  it("parses agy -p '/usage' TSV lines into canonical windows with remaining <-> used conversion", () => {
    const windows = parseAgyUsageTsv(SAMPLE_AGY_USAGE_TSV);
    assert.equal(windows.length, 4);

    assert.deepEqual(
      windows.map((w) => ({
        id: w.id,
        group: w.group,
        window: w.window,
        shortLabel: w.shortLabel,
        detailLabel: w.detailLabel,
        remainingPercent: w.remainingPercent,
        usedPercent: w.usedPercent,
        resetAtIso: w.resetAtIso
      })),
      [
        {
          id: "gemini:weekly",
          group: "Gemini",
          window: "weekly",
          shortLabel: "Gemini 周",
          detailLabel: "Gemini · 每周",
          remainingPercent: 93,
          usedPercent: 7,
          resetAtIso: "2026-11-30T20:03:11.000Z"
        },
        {
          id: "gemini:5h",
          group: "Gemini",
          window: "5h",
          shortLabel: "Gemini 5h",
          detailLabel: "Gemini · 5h",
          remainingPercent: 92,
          usedPercent: 8,
          resetAtIso: "2026-11-24T09:34:15.000Z"
        },
        {
          id: "claude-gpt:weekly",
          group: "Claude/GPT",
          window: "weekly",
          shortLabel: "Claude/GPT 周",
          detailLabel: "Claude/GPT · 每周",
          remainingPercent: 100,
          usedPercent: 0,
          resetAtIso: "2026-12-01T06:04:49.000Z"
        },
        {
          id: "claude-gpt:5h",
          group: "Claude/GPT",
          window: "5h",
          shortLabel: "Claude/GPT 5h",
          detailLabel: "Claude/GPT · 5h",
          remainingPercent: 100,
          usedPercent: 0,
          resetAtIso: "2026-11-24T11:04:49.000Z"
        }
      ]
    );

    // Strips ANSI codes and ignores malformed lines cleanly.
    const noisy = `\u001b[32mGemini Models\u001b[0m\tWeekly Limit Remaining\t80%\t2026-11-30T20:03:11Z\nnot-a-tsv-line\n`;
    const parsedNoisy = parseAgyUsageTsv(noisy);
    assert.equal(parsedNoisy.length, 1);
    assert.equal(parsedNoisy[0]?.usedPercent, 20);
    assert.equal(parsedNoisy[0]?.remainingPercent, 80);

    // Credits parser
    assert.equal(parseAgyCreditsTsv("Remaining credits\t0\n"), 0);
    assert.equal(parseAgyCreditsTsv("Remaining credits\t1,250\n"), 1250);
    assert.equal(parseAgyCreditsTsv("no credits line"), null);
  });

  it("caches for 3 minutes, coalesces concurrent singleflight requests, and bypasses cache on force=true", async () => {
    let clock = Date.parse("2026-11-24T06:00:00Z");
    let usageCalls = 0;
    let creditsCalls = 0;
    let releaseDeferred: (() => void) | undefined;

    const service = new OfficialQuotaService({
      cacheTtlMs: 180_000,
      now: () => clock,
      refreshEnv: async () => {},
      locateExecutable: () => "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
      cliRunner: async (_exe, args): Promise<OfficialCliExecResult> => {
        if (args.includes("/usage")) {
          usageCalls += 1;
          if (usageCalls === 1) {
            await new Promise<void>((resolve) => {
              releaseDeferred = resolve;
            });
          }
          const remaining = usageCalls === 1 ? "93%" : "90%";
          return {
            stdout: `Gemini Models\tWeekly Limit Remaining\t${remaining}\t2026-11-30T20:03:11Z\n`,
            stderr: "",
            exitCode: 0
          };
        }
        creditsCalls += 1;
        return {
          stdout: "Remaining credits\t42\n",
          stderr: "",
          exitCode: 0
        };
      }
    });

    // Two concurrent requests share a single official CLI execution (singleflight).
    const p1 = service.getQuotaSummary(false);
    const p2 = service.getQuotaSummary(false);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(usageCalls, 1);
    releaseDeferred?.();

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.cached, false);
    assert.equal(r2.cached, false);
    assert.equal(r1.antigravity.available, true);
    assert.equal(r1.antigravity.windows[0]?.usedPercent, 7);
    assert.equal(r1.antigravity.remainingCredits, 42);
    assert.equal(usageCalls, 1);
    assert.equal(creditsCalls, 1);

    // Within 3-minute TTL -> served from memory cache with zero spawns.
    clock += 60_000;
    const r3 = await service.getQuotaSummary(false);
    assert.equal(r3.cached, true);
    assert.equal(r3.antigravity.windows[0]?.usedPercent, 7);
    assert.equal(usageCalls, 1);

    // force=true bypasses TTL and fetches fresh value.
    const r4 = await service.getQuotaSummary(true);
    assert.equal(r4.cached, false);
    assert.equal(r4.antigravity.windows[0]?.usedPercent, 10);
    assert.equal(usageCalls, 2);

    // After TTL expires, non-forced call refreshes automatically.
    clock += 181_000;
    const r5 = await service.getQuotaSummary(false);
    assert.equal(r5.cached, false);
    assert.equal(usageCalls, 3);
  });

  it("degrades gracefully on timeout, unauthenticated CLI, or missing executable without throwing", async () => {
    const missingSvc = new OfficialQuotaService({
      refreshEnv: async () => {},
      locateExecutable: () => null
    });
    const missingRes = await missingSvc.getQuotaSummary(true);
    assert.equal(missingRes.ok, true);
    assert.equal(missingRes.antigravity.status, "not_installed");
    assert.equal(missingRes.antigravity.available, false);
    assert.equal(missingRes.antigravity.windows.length, 0);

    const timeoutSvc = new OfficialQuotaService({
      refreshEnv: async () => {},
      locateExecutable: () => "/usr/local/bin/agy",
      cliRunner: async () => ({
        stdout: "",
        stderr: "command timed out",
        exitCode: null,
        timedOut: true,
        errorMessage: "ETIMEDOUT"
      })
    });
    const timeoutRes = await timeoutSvc.getQuotaSummary(true);
    assert.equal(timeoutRes.antigravity.status, "timeout");
    assert.equal(timeoutRes.antigravity.available, false);
    assert.match(timeoutRes.antigravity.error ?? "", /超时/);

    const unauthSvc = new OfficialQuotaService({
      refreshEnv: async () => {},
      locateExecutable: () => "/usr/local/bin/agy",
      cliRunner: async () => ({
        stdout: "",
        stderr: "Error: User is not logged in. Please log in first.",
        exitCode: 1
      })
    });
    const unauthRes = await unauthSvc.getQuotaSummary(true);
    assert.equal(unauthRes.antigravity.status, "unauthenticated");
    assert.equal(unauthRes.antigravity.available, false);
    assert.match(unauthRes.antigravity.error ?? "", /登录态/);
  });

  it("exposes authenticated GET /v1/quota/summary on PrismuxDaemon and enforces owner_chief scope", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "prismux-quota-route-"));
    const daemon = new PrismuxDaemon({
      headless: true,
      dataDir,
      authToken: "owner-quota-token",
      disableAutoUpdateCheck: true
    });

    const groupToken = "qq-group-scoped-token";
    daemon.pairingManager.registerScopedToken(
      groupToken,
      "qq_group:998877",
      "qq-group-test"
    );

    try {
      const info = await daemon.start();

      const unauth = await fetch(`${info.httpUrl}/v1/quota/summary`);
      assert.equal(unauth.status, 401);

      const forbidden = await fetch(`${info.httpUrl}/v1/quota/summary`, {
        headers: { Authorization: `Bearer ${groupToken}` }
      });
      assert.equal(forbidden.status, 403);

      const okRes = await fetch(`${info.httpUrl}/v1/quota/summary`, {
        headers: { Authorization: "Bearer owner-quota-token" }
      });
      assert.equal(okRes.status, 200);
      const body = (await okRes.json()) as {
        ok: boolean;
        antigravity: {
          id: string;
          source: string;
          status: string;
          available: boolean;
          windows: Array<{ id: string; usedPercent: number; remainingPercent: number }>;
        };
      };
      assert.equal(body.ok, true);
      assert.equal(body.antigravity.id, "antigravity");
      assert.equal(body.antigravity.source, "official-cli");
      assert.ok(Array.isArray(body.antigravity.windows));
    } finally {
      await daemon.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("live local official probe: reads real agy -p '/usage' TSV on this machine", async (t) => {
    const agyExe = locateOfficialAgyExecutable();
    if (!agyExe) {
      t.skip("agy CLI is not installed on this machine");
      return;
    }

    const service = new OfficialQuotaService();
    const res = await service.getQuotaSummary(true);
    assert.equal(res.ok, true);
    assert.equal(res.antigravity.executablePath, agyExe);
    assert.equal(res.antigravity.source, "official-cli");
    assert.equal(res.antigravity.available, true, `Expected live agy /usage to succeed, got: ${res.antigravity.status} (${res.antigravity.error})`);
    assert.ok(res.antigravity.windows.length >= 4, `Expected >=4 quota windows, got ${res.antigravity.windows.length}`);

    const ids = res.antigravity.windows.map((w) => w.id);
    assert.ok(ids.includes("gemini:weekly"));
    assert.ok(ids.includes("gemini:5h"));
    assert.ok(ids.includes("claude-gpt:weekly"));
    assert.ok(ids.includes("claude-gpt:5h"));

    for (const win of res.antigravity.windows) {
      assert.equal(win.usedPercent + win.remainingPercent, 100);
      assert.ok(win.usedPercent >= 0 && win.usedPercent <= 100);
      assert.ok(win.resetAtIso !== null && Number.isFinite(Date.parse(win.resetAtIso)));
    }
  });
});
