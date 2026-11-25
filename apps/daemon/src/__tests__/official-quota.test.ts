import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeJitteredQuotaCacheTtlMs,
  handleQuotaRoute,
  locateOfficialAgyExecutable,
  OFFICIAL_QUOTA_CACHE_JITTER_MS,
  OFFICIAL_QUOTA_CACHE_TTL_MAX_MS,
  OFFICIAL_QUOTA_CACHE_TTL_MIN_MS,
  OFFICIAL_QUOTA_CACHE_TTL_MS,
  OfficialQuotaService,
  parseAgyCreditsTsv,
  parseAgyUsageTsv,
  PrismuxDaemon,
  type OfficialCliExecResult,
  type OfficialQuotaCreditsResponse,
  type OfficialQuotaSummaryResponse,
  type QuotaInvalidateResponse
} from "../index.js";

const SAMPLE_AGY_USAGE_TSV = [
  "Gemini Models\tWeekly Limit Remaining\t93%\t2026-11-30T20:03:11Z",
  "Gemini Models\tFive Hour Limit Remaining\t92%\t2026-11-24T09:34:15Z",
  "Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-12-01T06:04:49Z",
  "Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-24T11:04:49Z"
].join("\n");

describe("OfficialQuotaService TSV parser, 15m±90s jitter TTL, and split /usage + /credits", () => {
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

  it("enforces 15m ± 90s random jitter TTL strictly within [810_000, 990_000] ms", async () => {
    assert.equal(OFFICIAL_QUOTA_CACHE_TTL_MS, 900_000);
    assert.equal(OFFICIAL_QUOTA_CACHE_JITTER_MS, 90_000);
    assert.equal(OFFICIAL_QUOTA_CACHE_TTL_MIN_MS, 810_000);
    assert.equal(OFFICIAL_QUOTA_CACHE_TTL_MAX_MS, 990_000);

    // Deterministic extreme and midpoint values via injectable random().
    assert.equal(
      computeJitteredQuotaCacheTtlMs(
        OFFICIAL_QUOTA_CACHE_TTL_MS,
        OFFICIAL_QUOTA_CACHE_JITTER_MS,
        () => 0
      ),
      810_000
    );
    assert.equal(
      computeJitteredQuotaCacheTtlMs(
        OFFICIAL_QUOTA_CACHE_TTL_MS,
        OFFICIAL_QUOTA_CACHE_JITTER_MS,
        () => 0.5
      ),
      900_000
    );
    assert.equal(
      computeJitteredQuotaCacheTtlMs(
        OFFICIAL_QUOTA_CACHE_TTL_MS,
        OFFICIAL_QUOTA_CACHE_JITTER_MS,
        () => 1
      ),
      990_000
    );

    // Sweep 200 samples across [0, 1] and verify strict [810_000, 990_000] bounds.
    for (let i = 0; i <= 200; i += 1) {
      const ttl = computeJitteredQuotaCacheTtlMs(
        OFFICIAL_QUOTA_CACHE_TTL_MS,
        OFFICIAL_QUOTA_CACHE_JITTER_MS,
        () => i / 200
      );
      assert.ok(
        ttl >= 810_000 && ttl <= 990_000,
        `Expected jittered TTL in [810_000, 990_000], got ${ttl}`
      );
    }

    // Verify OfficialQuotaService applies lower bound (random=0 -> 810_000 ms) accurately.
    let clockMin = Date.parse("2026-11-25T09:00:00Z");
    let minSpawns = 0;
    const minSvc = new OfficialQuotaService({
      now: () => clockMin,
      random: () => 0,
      refreshEnv: async () => {},
      locateExecutable: () => "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
      cliRunner: async () => {
        minSpawns += 1;
        return {
          stdout: "Gemini Models\tWeekly Limit Remaining\t91%\t2026-11-30T20:03:11Z\n",
          stderr: "",
          exitCode: 0
        };
      }
    });

    const minFirst = await minSvc.getSummary(false);
    assert.equal(minFirst.cached, false);
    assert.equal(minFirst.cacheTtlMs, 810_000);
    assert.equal(minSpawns, 1);

    clockMin += 809_999;
    const minWarm = await minSvc.getSummary(false);
    assert.equal(minWarm.cached, true);
    assert.equal(minSpawns, 1);

    clockMin += 1;
    const minExpired = await minSvc.getSummary(false);
    assert.equal(minExpired.cached, false);
    assert.equal(minSpawns, 2);

    // Verify OfficialQuotaService applies upper bound (random=1 -> 990_000 ms) accurately.
    let clockMax = Date.parse("2026-11-25T10:00:00Z");
    let maxSpawns = 0;
    const maxSvc = new OfficialQuotaService({
      now: () => clockMax,
      random: () => 1,
      refreshEnv: async () => {},
      locateExecutable: () => "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
      cliRunner: async () => {
        maxSpawns += 1;
        return {
          stdout: "Gemini Models\tWeekly Limit Remaining\t89%\t2026-11-30T20:03:11Z\n",
          stderr: "",
          exitCode: 0
        };
      }
    });

    const maxFirst = await maxSvc.getSummary(false);
    assert.equal(maxFirst.cached, false);
    assert.equal(maxFirst.cacheTtlMs, 990_000);
    assert.equal(maxSpawns, 1);

    clockMax += 989_999;
    const maxWarm = await maxSvc.getSummary(false);
    assert.equal(maxWarm.cached, true);
    assert.equal(maxSpawns, 1);

    clockMax += 1;
    const maxExpired = await maxSvc.getSummary(false);
    assert.equal(maxExpired.cached, false);
    assert.equal(maxSpawns, 2);
  });

  it("NEVER spawns /credits during getSummary() (Promise.all dual-spawn eliminated) and coalesces singleflight calls", async () => {
    let clock = Date.parse("2026-11-24T06:00:00Z");
    let usageCalls = 0;
    let creditsCalls = 0;
    const spawnedCommands: string[][] = [];
    let releaseDeferred: (() => void) | undefined;

    const service = new OfficialQuotaService({
      now: () => clock,
      random: () => 0.5, // exact 900_000 ms (15 minutes)
      refreshEnv: async () => {},
      locateExecutable: () => "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
      cliRunner: async (_exe, args): Promise<OfficialCliExecResult> => {
        spawnedCommands.push([...args]);
        if (args.includes("/usage")) {
          usageCalls += 1;
          if (usageCalls === 1) {
            await new Promise<void>((resolveWait) => {
              releaseDeferred = resolveWait;
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

    // Two concurrent getSummary calls share a SINGLE `/usage` execution and ZERO `/credits` spawns.
    const p1 = service.getSummary(false);
    const p2 = service.getQuotaSummary(false);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(usageCalls, 1);
    assert.equal(creditsCalls, 0);
    releaseDeferred?.();

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.cached, false);
    assert.equal(r2.cached, false);
    assert.equal(r1.cacheTtlMs, 900_000);
    assert.equal(r1.antigravity.available, true);
    assert.equal(r1.antigravity.windows[0]?.usedPercent, 7);
    assert.equal(r1.antigravity.remainingCredits, null);
    assert.equal(usageCalls, 1);
    assert.equal(creditsCalls, 0);

    // Within 15-minute TTL -> served from memory cache with zero spawns.
    clock += 10 * 60 * 1_000;
    const r3 = await service.getSummary(false);
    assert.equal(r3.cached, true);
    assert.equal(r3.antigravity.windows[0]?.usedPercent, 7);
    assert.equal(usageCalls, 1);
    assert.equal(creditsCalls, 0);

    // force=true bypasses TTL and fetches fresh `/usage` ONLY (still zero `/credits`).
    const r4 = await service.getSummary(true);
    assert.equal(r4.cached, false);
    assert.equal(r4.antigravity.windows[0]?.usedPercent, 10);
    assert.equal(usageCalls, 2);
    assert.equal(creditsCalls, 0);

    // After 15m TTL expires, non-forced call refreshes `/usage` ONLY.
    clock += 900_001;
    const r5 = await service.getSummary(false);
    assert.equal(r5.cached, false);
    assert.equal(usageCalls, 3);
    assert.equal(creditsCalls, 0);

    // Verify EVERY single command spawned by getSummary was strictly `/usage`.
    assert.equal(spawnedCommands.length, 3);
    for (const args of spawnedCommands) {
      assert.ok(args.includes("/usage"));
      assert.ok(!args.includes("/credits"));
    }

    // Static check: OfficialQuotaService.ts must never use Promise.all to dual-spawn CLI calls.
    const serviceSourcePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../src/system/OfficialQuotaService.ts"
    );
    const serviceSource = readFileSync(serviceSourcePath, "utf8");
    assert.ok(
      !serviceSource.includes("Promise.all"),
      "OfficialQuotaService.ts must not dual-spawn /usage and /credits via Promise.all"
    );
  });

  it("fetches on-demand getCredits() using ONLY '/credits' with its own 15m±90s TTL and singleflight deduplication", async () => {
    let clock = Date.parse("2026-11-25T11:00:00Z");
    let usageCalls = 0;
    let creditsCalls = 0;
    let releaseCredits: (() => void) | undefined;

    const service = new OfficialQuotaService({
      now: () => clock,
      random: () => 0, // 810_000 ms TTL
      refreshEnv: async () => {},
      locateExecutable: () => "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
      cliRunner: async (_exe, args): Promise<OfficialCliExecResult> => {
        if (args.includes("/usage")) {
          usageCalls += 1;
          return {
            stdout: "Gemini Models\tWeekly Limit Remaining\t93%\t2026-11-30T20:03:11Z\n",
            stderr: "",
            exitCode: 0
          };
        }
        assert.ok(args.includes("/credits"));
        creditsCalls += 1;
        if (creditsCalls === 1) {
          await new Promise<void>((resolveWait) => {
            releaseCredits = resolveWait;
          });
        }
        return {
          stdout: creditsCalls === 1 ? "Remaining credits\t42\n" : "Remaining credits\t95\n",
          stderr: "",
          exitCode: 0
        };
      }
    });

    // Rapid double popover open -> coalesced into a SINGLE `/credits` call and ZERO `/usage` calls.
    const c1p = service.getCredits(false);
    const c2p = service.getCredits(false);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(creditsCalls, 1);
    assert.equal(usageCalls, 0);
    releaseCredits?.();

    const [c1, c2] = await Promise.all([c1p, c2p]);
    assert.equal(c1.ok, true);
    assert.equal(c1.cached, false);
    assert.equal(c1.cacheTtlMs, 810_000);
    assert.equal(c1.remainingCredits, 42);
    assert.equal(c1.status, "ok");
    assert.equal(c1.available, true);
    assert.equal(c2.remainingCredits, 42);
    assert.equal(usageCalls, 0);
    assert.equal(creditsCalls, 1);

    // Within 810_000 ms jitter TTL -> served from cache with ZERO CLI spawns.
    clock += 809_999;
    const c3 = await service.getCredits(false);
    assert.equal(c3.cached, true);
    assert.equal(c3.remainingCredits, 42);
    assert.equal(creditsCalls, 1);
    assert.equal(usageCalls, 0);

    // After TTL expires -> refreshes `/credits` ONLY.
    clock += 1;
    const c4 = await service.getCredits(false);
    assert.equal(c4.cached, false);
    assert.equal(c4.remainingCredits, 95);
    assert.equal(creditsCalls, 2);
    assert.equal(usageCalls, 0);

    // force=true bypasses credits cache immediately.
    const c5 = await service.getCredits(true);
    assert.equal(c5.cached, false);
    assert.equal(creditsCalls, 3);
    assert.equal(usageCalls, 0);
  });

  it("degrades gracefully on timeout, unauthenticated CLI, or missing executable without throwing", async () => {
    const missingSvc = new OfficialQuotaService({
      refreshEnv: async () => {},
      locateExecutable: () => null
    });
    const missingRes = await missingSvc.getSummary(true);
    assert.equal(missingRes.ok, true);
    assert.equal(missingRes.antigravity.status, "not_installed");
    assert.equal(missingRes.antigravity.available, false);
    assert.equal(missingRes.antigravity.windows.length, 0);

    const missingCredits = await missingSvc.getCredits(true);
    assert.equal(missingCredits.ok, true);
    assert.equal(missingCredits.status, "not_installed");
    assert.equal(missingCredits.available, false);
    assert.equal(missingCredits.remainingCredits, null);

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
    const timeoutRes = await timeoutSvc.getSummary(true);
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
    const unauthRes = await unauthSvc.getSummary(true);
    assert.equal(unauthRes.antigravity.status, "unauthenticated");
    assert.equal(unauthRes.antigravity.available, false);
    assert.equal(unauthRes.antigravity.remainingCredits, null);
    assert.match(unauthRes.antigravity.error ?? "", /登录态/);
  });

  it("immediately clears BOTH /usage and /credits caches (incrementing monotonic cacheGeneration) on logout, disable, uninstall, error, or race", async () => {
    let clock = Date.parse("2026-11-25T08:00:00Z");
    let installed = true;
    let enabled = true;
    let mode: "ok" | "unauthenticated" | "error" | "relogin" = "ok";
    let usageCalls = 0;
    let creditsCalls = 0;

    const service = new OfficialQuotaService({
      now: () => clock,
      random: () => 0.5,
      isAntigravityEnabled: () => enabled,
      refreshEnv: async () => {},
      locateExecutable: () => (installed ? "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe" : null),
      cliRunner: async (_exe, args): Promise<OfficialCliExecResult> => {
        if (args.includes("/usage")) {
          usageCalls += 1;
          if (mode === "ok") {
            return {
              stdout: "Gemini Models\tWeekly Limit Remaining\t93%\t2026-11-30T20:03:11Z\n",
              stderr: "",
              exitCode: 0
            };
          }
          if (mode === "relogin") {
            return {
              stdout: "Gemini Models\tWeekly Limit Remaining\t88%\t2026-11-30T20:03:11Z\n",
              stderr: "",
              exitCode: 0
            };
          }
          if (mode === "unauthenticated") {
            return {
              stdout: "",
              stderr: "Error: User is not logged in. Please sign in first.",
              exitCode: 1
            };
          }
          return {
            stdout: "",
            stderr: "Internal CLI error: service unreachable",
            exitCode: 2
          };
        }
        creditsCalls += 1;
        if (mode === "unauthenticated") {
          return {
            stdout: "",
            stderr: "Error: User is not logged in.",
            exitCode: 1
          };
        }
        return {
          stdout: mode === "ok" ? "Remaining credits\t42\n" : mode === "relogin" ? "Remaining credits\t19\n" : "",
          stderr: mode === "error" ? "Internal CLI error" : "",
          exitCode: mode === "ok" || mode === "relogin" ? 0 : 2
        };
      }
    });

    // 1. Populate BOTH `/usage` and `/credits` caches independently.
    const gen0 = service.getCacheGeneration();
    const initial = await service.getSummary(false);
    assert.equal(initial.cached, false);
    assert.equal(initial.antigravity.available, true);
    assert.equal(initial.antigravity.windows[0]?.remainingPercent, 93);
    assert.equal(initial.antigravity.remainingCredits, null);
    assert.equal(usageCalls, 1);
    assert.equal(creditsCalls, 0);

    const initialCredits = await service.getCredits(false);
    assert.equal(initialCredits.cached, false);
    assert.equal(initialCredits.remainingCredits, 42);
    assert.equal(creditsCalls, 1);

    clock += 10_000;
    assert.equal((await service.getSummary(false)).cached, true);
    assert.equal((await service.getCredits(false)).cached, true);

    // 2. Logout detected on `/usage` forced refresh -> increments cacheGeneration & clears BOTH caches!
    mode = "unauthenticated";
    const afterLogout = await service.getSummary(true);
    assert.equal(afterLogout.antigravity.status, "unauthenticated");
    assert.equal(afterLogout.antigravity.available, false);
    assert.deepEqual(afterLogout.antigravity.windows, []);
    const genAfterLogout = service.getCacheGeneration();
    assert.ok(genAfterLogout > gen0, "cacheGeneration must monotonically increment on logout");

    // Subsequent non-forced `/usage` AND `/credits` calls NEVER see stale cached values!
    clock += 1_000;
    const stillLoggedOutSummary = await service.getSummary(false);
    assert.equal(stillLoggedOutSummary.cached, false);
    assert.equal(stillLoggedOutSummary.antigravity.status, "unauthenticated");
    const stillLoggedOutCredits = await service.getCredits(false);
    assert.equal(stillLoggedOutCredits.cached, false);
    assert.equal(stillLoggedOutCredits.status, "unauthenticated");
    assert.equal(stillLoggedOutCredits.remainingCredits, null);

    // 3. Relogin -> re-populate BOTH caches, then logout detected via `/credits` -> clears BOTH caches!
    mode = "relogin";
    clock += 1_000;
    assert.equal((await service.getSummary(false)).antigravity.windows[0]?.remainingPercent, 88);
    assert.equal((await service.getCredits(false)).remainingCredits, 19);
    const genBeforeCreditsLogout = service.getCacheGeneration();

    mode = "unauthenticated";
    const creditsLogout = await service.getCredits(true);
    assert.equal(creditsLogout.status, "unauthenticated");
    assert.ok(service.getCacheGeneration() > genBeforeCreditsLogout);
    // Usage cache MUST also be wiped immediately!
    const usageAfterCreditsLogout = await service.getSummary(false);
    assert.equal(usageAfterCreditsLogout.cached, false);
    assert.equal(usageAfterCreditsLogout.antigravity.status, "unauthenticated");

    // 4. Antigravity disabled -> clears BOTH caches immediately, bumps cacheGeneration, ZERO CLI spawns!
    mode = "relogin";
    assert.equal((await service.getSummary(false)).antigravity.available, true);
    assert.equal((await service.getCredits(false)).available, true);
    const usageBeforeDisable = usageCalls;
    const creditsBeforeDisable = creditsCalls;
    const genBeforeDisable = service.getCacheGeneration();

    enabled = false;
    const disabledSummary = await service.getSummary(false);
    assert.equal(disabledSummary.antigravity.status, "unauthenticated");
    assert.equal(disabledSummary.antigravity.available, false);
    assert.deepEqual(disabledSummary.antigravity.windows, []);
    assert.equal(usageCalls, usageBeforeDisable, "disabled AGY must not spawn CLI");
    assert.ok(service.getCacheGeneration() > genBeforeDisable);

    const disabledCredits = await service.getCredits(false);
    assert.equal(disabledCredits.status, "unauthenticated");
    assert.equal(disabledCredits.available, false);
    assert.equal(disabledCredits.remainingCredits, null);
    assert.equal(creditsCalls, creditsBeforeDisable, "disabled AGY must not spawn CLI");

    // Re-enabling starts fresh with empty cache (does not serve stale pre-disable data).
    enabled = true;
    const freshAfterReenable = await service.getSummary(false);
    assert.equal(freshAfterReenable.cached, false);
    assert.equal(freshAfterReenable.antigravity.available, true);

    // 5. CLI uninstalled after prior success -> immediately invalidates cached snapshot.
    installed = false;
    const afterUninstall = await service.getSummary(true);
    assert.equal(afterUninstall.antigravity.status, "not_installed");
    assert.equal(afterUninstall.antigravity.available, false);

    // 6. CLI error after prior success -> immediately invalidates cached snapshot.
    installed = true;
    mode = "relogin";
    assert.equal((await service.getSummary(false)).antigravity.available, true);
    mode = "error";
    const afterError = await service.getSummary(true);
    assert.equal(afterError.antigravity.status, "error");
    assert.equal(afterError.antigravity.available, false);

    // 7. Race guard: slow pre-logout non-forced `/usage` & `/credits` finishing AFTER logout
    //    must NEVER repopulate either cache.
    let releaseSlowUsage: (() => void) | undefined;
    let releaseSlowCredits: (() => void) | undefined;
    let raceUsageCall = 0;
    let raceCreditsCall = 0;
    const raceSvc = new OfficialQuotaService({
      now: () => clock,
      random: () => 0.5,
      refreshEnv: async () => {},
      locateExecutable: () => "/usr/local/bin/agy",
      cliRunner: async (_exe, args): Promise<OfficialCliExecResult> => {
        if (args.includes("/usage")) {
          raceUsageCall += 1;
          if (raceUsageCall === 1) {
            await new Promise<void>((resolveWait) => {
              releaseSlowUsage = resolveWait;
            });
            return {
              stdout: "Gemini Models\tWeekly Limit Remaining\t99%\t2026-11-30T20:03:11Z\n",
              stderr: "",
              exitCode: 0
            };
          }
          return { stdout: "", stderr: "Error: not logged in", exitCode: 1 };
        }
        raceCreditsCall += 1;
        if (raceCreditsCall === 1) {
          await new Promise<void>((resolveWait) => {
            releaseSlowCredits = resolveWait;
          });
          return { stdout: "Remaining credits\t500\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "Error: not logged in", exitCode: 1 };
      }
    });

    const slowUsage = raceSvc.getSummary(false);
    const slowCredits = raceSvc.getCredits(false);
    await new Promise((r) => setTimeout(r, 10));
    const forcedLogout = await raceSvc.getSummary(true);
    assert.equal(forcedLogout.antigravity.status, "unauthenticated");
    releaseSlowUsage?.();
    releaseSlowCredits?.();
    await Promise.all([slowUsage, slowCredits]);

    const verifyUsageAfterRace = await raceSvc.getSummary(false);
    assert.equal(verifyUsageAfterRace.cached, false);
    assert.equal(verifyUsageAfterRace.antigravity.status, "unauthenticated");

    const verifyCreditsAfterRace = await raceSvc.getCredits(false);
    assert.equal(verifyCreditsAfterRace.cached, false);
    assert.equal(verifyCreditsAfterRace.status, "unauthenticated");
  });

  it("handles GET /v1/quota/summary, GET /v1/quota/credits (?force=1), and POST /v1/quota/invalidate via QuotaRoutes", async () => {
    let usageCalls = 0;
    let creditsCalls = 0;
    const svc = new OfficialQuotaService({
      random: () => 0.5,
      refreshEnv: async () => {},
      locateExecutable: () => "/usr/local/bin/agy",
      cliRunner: async (_exe, args): Promise<OfficialCliExecResult> => {
        if (args.includes("/usage")) {
          usageCalls += 1;
          return {
            stdout: "Gemini Models\tWeekly Limit Remaining\t85%\t2026-11-30T20:03:11Z\n",
            stderr: "",
            exitCode: 0
          };
        }
        creditsCalls += 1;
        return {
          stdout: `Remaining credits\t${creditsCalls * 10}\n`,
          stderr: "",
          exitCode: 0
        };
      }
    });

    // GET /v1/quota/summary spawns ONLY /usage
    const summaryRes = await handleQuotaRoute(
      {
        method: "GET",
        pathname: "/v1/quota/summary",
        searchParams: new URLSearchParams(),
        callerScope: "owner_chief"
      },
      svc
    );
    assert.equal(summaryRes?.statusCode, 200);
    const summaryPayload = summaryRes?.payload as OfficialQuotaSummaryResponse;
    assert.equal(summaryPayload.antigravity.windows[0]?.remainingPercent, 85);
    assert.equal(summaryPayload.antigravity.remainingCredits, null);
    assert.equal(usageCalls, 1);
    assert.equal(creditsCalls, 0);

    // GET /v1/quota/credits spawns ONLY /credits
    const creditsRes = await handleQuotaRoute(
      {
        method: "GET",
        pathname: "/v1/quota/credits",
        searchParams: new URLSearchParams(),
        callerScope: "owner_chief"
      },
      svc
    );
    assert.equal(creditsRes?.statusCode, 200);
    const creditsPayload = creditsRes?.payload as OfficialQuotaCreditsResponse;
    assert.equal(creditsPayload.ok, true);
    assert.equal(creditsPayload.cached, false);
    assert.equal(creditsPayload.remainingCredits, 10);
    assert.equal(usageCalls, 1);
    assert.equal(creditsCalls, 1);

    // Repeat GET /v1/quota/credits hits cache (0 new spawns)
    const creditsCached = await handleQuotaRoute(
      {
        method: "GET",
        pathname: "/v1/quota/credits",
        searchParams: new URLSearchParams(),
        callerScope: "owner_chief"
      },
      svc
    );
    assert.equal((creditsCached?.payload as OfficialQuotaCreditsResponse).cached, true);
    assert.equal(creditsCalls, 1);

    // GET /v1/quota/credits?force=1 bypasses cache
    const creditsForced = await handleQuotaRoute(
      {
        method: "GET",
        pathname: "/v1/quota/credits",
        searchParams: new URLSearchParams("force=1"),
        callerScope: "owner_chief"
      },
      svc
    );
    assert.equal((creditsForced?.payload as OfficialQuotaCreditsResponse).cached, false);
    assert.equal((creditsForced?.payload as OfficialQuotaCreditsResponse).remainingCredits, 20);
    assert.equal(creditsCalls, 2);
    assert.equal(usageCalls, 1);

    // POST /v1/quota/invalidate clears BOTH caches and bumps cacheGeneration
    const genBefore = svc.getCacheGeneration();
    const invRes = await handleQuotaRoute(
      {
        method: "POST",
        pathname: "/v1/quota/invalidate",
        searchParams: new URLSearchParams(),
        callerScope: "owner_chief"
      },
      svc
    );
    assert.equal(invRes?.statusCode, 200);
    const invPayload = invRes?.payload as QuotaInvalidateResponse;
    assert.equal(invPayload.cleared, true);
    assert.ok(invPayload.cacheGeneration > genBefore);

    // ?enabled=0 returns unauthenticated immediately without spawning CLI
    const disabledCreditsRes = await handleQuotaRoute(
      {
        method: "GET",
        pathname: "/v1/quota/credits",
        searchParams: new URLSearchParams("enabled=0"),
        callerScope: "owner_chief"
      },
      svc
    );
    assert.equal(
      (disabledCreditsRes?.payload as OfficialQuotaCreditsResponse).status,
      "unauthenticated"
    );
    assert.equal(creditsCalls, 2);

    // Non-owner_chief scope is rejected with 403 on /v1/quota/credits
    await assert.rejects(
      () =>
        handleQuotaRoute(
          {
            method: "GET",
            pathname: "/v1/quota/credits",
            searchParams: new URLSearchParams(),
            callerScope: "qq_group:12345"
          },
          svc
        ),
      /FORBIDDEN_SCOPE|not permitted/i
    );
  });

  it("exposes authenticated GET /v1/quota/summary, /v1/quota/credits, and POST /v1/quota/invalidate on PrismuxDaemon with owner_chief scope", async () => {
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

      // Auth & scope enforcement on /summary, /credits, and /invalidate
      assert.equal((await fetch(`${info.httpUrl}/v1/quota/summary`)).status, 401);
      assert.equal((await fetch(`${info.httpUrl}/v1/quota/credits`)).status, 401);
      assert.equal(
        (
          await fetch(`${info.httpUrl}/v1/quota/summary`, {
            headers: { Authorization: `Bearer ${groupToken}` }
          })
        ).status,
        403
      );
      assert.equal(
        (
          await fetch(`${info.httpUrl}/v1/quota/credits`, {
            headers: { Authorization: `Bearer ${groupToken}` }
          })
        ).status,
        403
      );
      assert.equal(
        (
          await fetch(`${info.httpUrl}/v1/quota/invalidate`, {
            method: "POST",
            headers: { Authorization: `Bearer ${groupToken}` }
          })
        ).status,
        403
      );

      // Owner invalidation route works cleanly with zero CLI spawn
      const invRes = await fetch(`${info.httpUrl}/v1/quota/invalidate`, {
        method: "POST",
        headers: { Authorization: "Bearer owner-quota-token" }
      });
      assert.equal(invRes.status, 200);
      const invBody = (await invRes.json()) as QuotaInvalidateResponse;
      assert.equal(invBody.ok, true);
      assert.equal(invBody.cleared, true);
      assert.ok(invBody.cacheGeneration >= 1);

      // Owner disabled credits route returns unauthenticated with zero CLI spawn
      const disabledCredits = await fetch(`${info.httpUrl}/v1/quota/credits?enabled=0`, {
        headers: { Authorization: "Bearer owner-quota-token" }
      });
      assert.equal(disabledCredits.status, 200);
      const disabledBody = (await disabledCredits.json()) as OfficialQuotaCreditsResponse;
      assert.equal(disabledBody.ok, true);
      assert.equal(disabledBody.status, "unauthenticated");
      assert.equal(disabledBody.remainingCredits, null);

      const okRes = await fetch(`${info.httpUrl}/v1/quota/summary`, {
        headers: { Authorization: "Bearer owner-quota-token" }
      });
      assert.equal(okRes.status, 200);
      const body = (await okRes.json()) as OfficialQuotaSummaryResponse;
      assert.equal(body.ok, true);
      assert.equal(body.antigravity.id, "antigravity");
      assert.equal(body.antigravity.source, "official-cli");
      assert.ok(Array.isArray(body.antigravity.windows));
    } finally {
      await daemon.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("live local official probe: reads real agy -p '/usage' TSV on this machine without spawning /credits", async (t) => {
    const agyExe = locateOfficialAgyExecutable();
    if (!agyExe) {
      t.skip("agy CLI is not installed on this machine");
      return;
    }

    const service = new OfficialQuotaService();
    const res = await service.getSummary(true);
    assert.equal(res.ok, true);
    assert.equal(res.antigravity.executablePath, agyExe);
    assert.equal(res.antigravity.source, "official-cli");
    assert.equal(
      res.antigravity.available,
      true,
      `Expected live agy /usage to succeed, got: ${res.antigravity.status} (${res.antigravity.error})`
    );
    assert.ok(
      res.cacheTtlMs >= OFFICIAL_QUOTA_CACHE_TTL_MIN_MS &&
        res.cacheTtlMs <= OFFICIAL_QUOTA_CACHE_TTL_MAX_MS,
      `Expected jittered TTL in [810_000, 990_000], got ${res.cacheTtlMs}`
    );
    assert.equal(res.antigravity.remainingCredits, null);
    assert.ok(
      res.antigravity.windows.length >= 4,
      `Expected >=4 quota windows, got ${res.antigravity.windows.length}`
    );

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
