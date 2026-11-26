import { assert, describe, it } from "@effect/vitest";
import type * as Electron from "electron";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/http";

import { buildPrismuxDaemonChildEnv } from "./PrismuxDaemonService.ts";
import {
  buildHostMetricsPayload,
  HOST_METRICS_ACTIVE_POLL_INTERVAL,
  HOST_METRICS_BACKGROUND_POLL_INTERVAL,
  postHostMetricsToDaemon,
  resolveHostMetricsCadence,
  shouldWakeHostMetricsReporter,
} from "./PrismuxHostMetricsReporter.ts";

describe("PrismuxHostMetricsReporter", () => {
  it("converts Electron app.getAppMetrics() KiB values to bytes and attaches Electron-hosted T3 Server PID", () => {
    const metrics = [
      {
        pid: 1000,
        type: "Browser",
        creationTime: 1_700_000_000_000,
        cpu: { percentCPUUsage: 0.8, cumulativeCPUUsage: 4.5, idleWakeupsPerSecond: 0 },
        memory: { workingSetSize: 150_000, peakWorkingSetSize: 180_000, privateBytes: 110_000 },
      },
      {
        pid: 1001,
        type: "Tab",
        name: "Workbench",
        creationTime: 1_700_000_001_000,
        cpu: { percentCPUUsage: 4.2, cumulativeCPUUsage: 12.8, idleWakeupsPerSecond: 0 },
        memory: { workingSetSize: 240_000, peakWorkingSetSize: 280_000, privateBytes: 190_000 },
      },
      {
        pid: 1002,
        type: "GPU",
        creationTime: 1_700_000_001_500,
        cpu: { percentCPUUsage: 3.1, cumulativeCPUUsage: 9.2, idleWakeupsPerSecond: 0 },
        memory: { workingSetSize: 120_000, peakWorkingSetSize: 140_000, privateBytes: 95_000 },
      },
    ] as unknown as ReadonlyArray<Electron.ProcessMetric>;

    const payload = buildHostMetricsPayload({
      metrics,
      mainPid: 1000,
      cpuCores: 32,
      collectedAt: 1_700_000_010_000,
      coreBackendSnapshot: {
        desiredRunning: true,
        ready: true,
        activePid: Option.some(2000),
        restartAttempt: 0,
        restartScheduled: false,
      },
      coreHttpUrl: "http://127.0.0.1:3773",
    });

    assert.equal(payload.mainPid, 1000);
    assert.equal(payload.cpuCores, 32);
    // Electron app.getAppMetrics().cpu.percentCPUUsage is already divided by NumberOfProcessors (system-total 0-100%).
    assert.equal(payload.cpuScale, "system-total");
    assert.equal(payload.electronProcesses.length, 3);
    assert.equal(payload.electronProcesses[0]?.workingSetBytes, 150_000 * 1024);
    assert.equal(payload.electronProcesses[0]?.privateMemoryBytes, 110_000 * 1024);
    assert.equal(payload.electronProcesses[0]?.cumulativeCpuSeconds, 4.5);
    assert.equal(payload.electronProcesses[1]?.cpuPercent, 4.2);
    assert.equal(payload.electronProcesses[1]?.cumulativeCpuSeconds, 12.8);
    assert.deepEqual(payload.coreServer, {
      pid: 2000,
      ready: true,
      desiredRunning: true,
      state: "running",
      hostedBy: "electron",
      httpUrl: "http://127.0.0.1:3773",
    });
  });

  it("marks T3 Server as electron-in-process when activePid equals Electron mainPid", () => {
    const payload = buildHostMetricsPayload({
      metrics: [],
      mainPid: 5555,
      collectedAt: 1_700_000_020_000,
      cpuCores: 8,
      coreBackendSnapshot: {
        desiredRunning: true,
        ready: true,
        activePid: Option.some(5555),
        restartAttempt: 0,
        restartScheduled: false,
      },
    });

    assert.equal(payload.coreServer?.pid, 5555);
    assert.equal(payload.coreServer?.hostedBy, "electron-in-process");
  });

  it.effect(
    "posts payload with Bearer auth to /v1/resources/host-metrics and injects PRISMUX_CORE_SERVER_PID into child env",
    () =>
      Effect.gen(function* () {
        const captured: Array<{
          url: string;
          method: string;
          auth: string | undefined;
        }> = [];
        const fakeClient = HttpClient.make((request) => {
          captured.push({
            url: request.url,
            method: request.method,
            auth: request.headers["authorization"],
          });
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ ok: true }), { status: 200 }),
            ),
          );
        });

        const payload = buildHostMetricsPayload({
          metrics: [],
          mainPid: 4242,
          collectedAt: 1_700_000_030_000,
          cpuCores: 8,
          coreBackendSnapshot: {
            desiredRunning: true,
            ready: true,
            activePid: Option.some(9191),
            restartAttempt: 0,
            restartScheduled: false,
          },
        });

        const ok = yield* postHostMetricsToDaemon({
          baseUrl: "http://127.0.0.1:19001",
          token: "secret-daemon-token",
          payload,
          httpClient: fakeClient,
        });

        assert.isTrue(ok);
        assert.equal(captured.length, 1);
        assert.equal(captured[0]?.method, "POST");
        assert.equal(captured[0]?.url, "http://127.0.0.1:19001/v1/resources/host-metrics");
        assert.equal(captured[0]?.auth, "Bearer secret-daemon-token");

        const env = buildPrismuxDaemonChildEnv({
          hostEnv: {},
          catalogPath: "C:\\Prismux\\official.json",
          mainPid: 4242,
          coreServerPid: 9191,
          coreHttpUrl: "http://127.0.0.1:3773",
        });
        assert.equal(env.PRISMUX_MAIN_PID, "4242");
        assert.equal(env.PRISMUX_CORE_SERVER_PID, "9191");
      }),
  );

  it("pauses host metrics when hidden/minimized/locked/suspended and relaxes background cadence to 10s", () => {
    const active = resolveHostMetricsCadence({
      windowVisible: true,
      windowFocused: true,
      systemLocked: false,
      systemSuspended: false,
    });
    assert.equal(active.mode, "active");
    if (active.mode === "active") {
      assert.equal(Duration.toMillis(active.interval), Duration.toMillis(HOST_METRICS_ACTIVE_POLL_INTERVAL));
      assert.equal(Duration.toMillis(active.interval), 2_000);
    }

    const background = resolveHostMetricsCadence({
      windowVisible: true,
      windowFocused: false,
      systemLocked: false,
      systemSuspended: false,
    });
    assert.equal(background.mode, "background");
    if (background.mode === "background") {
      assert.equal(
        Duration.toMillis(background.interval),
        Duration.toMillis(HOST_METRICS_BACKGROUND_POLL_INTERVAL),
      );
      assert.equal(Duration.toMillis(background.interval), 10_000);
    }

    const hidden = resolveHostMetricsCadence({
      windowVisible: false,
      windowFocused: false,
      systemLocked: false,
      systemSuspended: false,
    });
    const locked = resolveHostMetricsCadence({
      windowVisible: true,
      windowFocused: true,
      systemLocked: true,
      systemSuspended: false,
    });
    const suspended = resolveHostMetricsCadence({
      windowVisible: true,
      windowFocused: true,
      systemLocked: false,
      systemSuspended: true,
    });
    assert.equal(hidden.mode, "paused");
    assert.equal(locked.mode, "paused");
    assert.equal(suspended.mode, "paused");

    assert.isTrue(shouldWakeHostMetricsReporter(hidden, active));
    assert.isTrue(shouldWakeHostMetricsReporter(hidden, background));
    assert.isTrue(shouldWakeHostMetricsReporter(background, active));
    assert.isTrue(shouldWakeHostMetricsReporter(active, hidden));
    assert.isFalse(shouldWakeHostMetricsReporter(active, background));
    assert.isFalse(shouldWakeHostMetricsReporter(hidden, locked));
  });
});
