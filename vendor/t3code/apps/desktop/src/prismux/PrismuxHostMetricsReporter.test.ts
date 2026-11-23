import { assert, describe, it } from "@effect/vitest";
import type * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { buildPrismuxDaemonChildEnv } from "./PrismuxDaemonService.ts";
import {
  buildHostMetricsPayload,
  postHostMetricsToDaemon,
} from "./PrismuxHostMetricsReporter.ts";

describe("PrismuxHostMetricsReporter", () => {
  it("converts Electron app.getAppMetrics() KiB values to bytes and attaches Electron-hosted T3 Server PID", () => {
    const metrics = [
      {
        pid: 1000,
        type: "Browser",
        creationTime: 1_700_000_000_000,
        cpu: { percentCPUUsage: 6.4, idleWakeupsPerSecond: 0 },
        memory: { workingSetSize: 150_000, peakWorkingSetSize: 180_000, privateBytes: 110_000 },
      },
      {
        pid: 1001,
        type: "Tab",
        name: "Workbench",
        creationTime: 1_700_000_001_000,
        cpu: { percentCPUUsage: 18.2, idleWakeupsPerSecond: 0 },
        memory: { workingSetSize: 240_000, peakWorkingSetSize: 280_000, privateBytes: 190_000 },
      },
      {
        pid: 1002,
        type: "GPU",
        creationTime: 1_700_000_001_500,
        cpu: { percentCPUUsage: 9.6, idleWakeupsPerSecond: 0 },
        memory: { workingSetSize: 120_000, peakWorkingSetSize: 140_000, privateBytes: 95_000 },
      },
    ] as unknown as ReadonlyArray<Electron.ProcessMetric>;

    const payload = buildHostMetricsPayload({
      metrics,
      mainPid: 1000,
      cpuCores: 16,
      collectedAt: 1_700_000_010_000,
      t3BackendSnapshot: {
        desiredRunning: true,
        ready: true,
        activePid: Option.some(2000),
        restartAttempt: 0,
        restartScheduled: false,
      },
      t3HttpUrl: "http://127.0.0.1:3773",
    });

    assert.equal(payload.mainPid, 1000);
    assert.equal(payload.cpuCores, 16);
    assert.equal(payload.cpuScale, "single-core");
    assert.equal(payload.electronProcesses.length, 3);
    assert.equal(payload.electronProcesses[0]?.workingSetBytes, 150_000 * 1024);
    assert.equal(payload.electronProcesses[0]?.privateMemoryBytes, 110_000 * 1024);
    assert.equal(payload.electronProcesses[1]?.cpuPercent, 18.2);
    assert.deepEqual(payload.t3Server, {
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
      t3BackendSnapshot: {
        desiredRunning: true,
        ready: true,
        activePid: Option.some(5555),
        restartAttempt: 0,
        restartScheduled: false,
      },
    });

    assert.equal(payload.t3Server?.pid, 5555);
    assert.equal(payload.t3Server?.hostedBy, "electron-in-process");
  });

  it("posts payload with Bearer auth to /v1/resources/host-metrics and injects PRISMUX_T3_SERVER_PID into child env", async () => {
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
      t3BackendSnapshot: {
        desiredRunning: true,
        ready: true,
        activePid: Option.some(9191),
        restartAttempt: 0,
        restartScheduled: false,
      },
    });

    const ok = await Effect.runPromise(
      postHostMetricsToDaemon({
        baseUrl: "http://127.0.0.1:19001",
        token: "secret-daemon-token",
        payload,
        httpClient: fakeClient,
      }),
    );

    assert.isTrue(ok);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.method, "POST");
    assert.equal(captured[0]?.url, "http://127.0.0.1:19001/v1/resources/host-metrics");
    assert.equal(captured[0]?.auth, "Bearer secret-daemon-token");

    const env = buildPrismuxDaemonChildEnv({
      hostEnv: {},
      catalogPath: "C:\\Prismux\\official.json",
      mainPid: 4242,
      t3ServerPid: 9191,
      t3HttpUrl: "http://127.0.0.1:3773",
    });
    assert.equal(env.PRISMUX_MAIN_PID, "4242");
    assert.equal(env.PRISMUX_T3_SERVER_PID, "9191");
  });
});
