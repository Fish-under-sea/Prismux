// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  ALLOWED_UPDATE_CHANNELS,
  applyUpdaterSseEvent,
  buildUpdaterStageSteps,
  describeUpdaterProgressStage,
  formatProgressPercentDisplay,
  formatUpdaterStageWeightHint,
  normalizeUpdateChannel,
  parseUpdaterStatusPayload,
  resolveProgressBarPercent,
  resolveRuntimeVersion,
  selectRecommendedUpdateAsset,
} from "./prismuxUpdates.logic";

describe("prismuxUpdates.logic", () => {
  it("never falls back to hardcoded 0.1.0-alpha.1 when runtime version is missing", () => {
    expect(resolveRuntimeVersion("0.1.1-alpha.1", "0.1.0")).toBe("0.1.1-alpha.1");
    expect(resolveRuntimeVersion("", "0.1.1-alpha.1")).toBe("0.1.1-alpha.1");
    expect(resolveRuntimeVersion("0.0.0", "0.0.0")).toBe("");
    expect(resolveRuntimeVersion(null, undefined)).toBe("");
  });

  it("converges channels strictly to stable and prerelease with zero nightly option", () => {
    expect(ALLOWED_UPDATE_CHANNELS).toEqual(["stable", "prerelease"]);
    expect(ALLOWED_UPDATE_CHANNELS).not.toContain("nightly");
    expect(normalizeUpdateChannel("stable")).toBe("stable");
    expect(normalizeUpdateChannel("prerelease")).toBe("prerelease");
    expect(normalizeUpdateChannel("nightly")).toBe("prerelease");
    expect(normalizeUpdateChannel(undefined, false)).toBe("stable");
    expect(normalizeUpdateChannel(undefined, true)).toBe("prerelease");
  });

  it("tracks Gitee 3-part split-7z download, extraction, SHA-256 verification, and ready state via SSE", () => {
    const initial = parseUpdaterStatusPayload(
      {
        currentVersion: "0.1.1-alpha.1",
        portableMode: false,
        policy: { channel: "prerelease", routePreference: "auto" },
        checking: false,
        downloading: false,
        installState: "available",
      },
      "0.1.1-alpha.1",
    );
    expect(initial).not.toBeNull();

    const part2 = applyUpdaterSseEvent(initial, {
      event: "progress",
      data: {
        installState: "downloading",
        progress: {
          stage: "downloading",
          percent: 62,
          bytesDownloaded: 62_000_000,
          totalBytes: 100_000_000,
          currentPart: 2,
          totalParts: 3,
          partName: "Prismux-Setup.7z.002",
        },
      },
      rawData: "",
      receivedAt: Date.now(),
    });
    expect(part2?.downloading).toBe(true);
    expect(describeUpdaterProgressStage(part2?.progress ?? null)).toContain("2/3");
    expect(describeUpdaterProgressStage(part2?.progress ?? null)).toContain("Prismux-Setup.7z.002");

    const extracting = applyUpdaterSseEvent(part2, {
      event: "extracting",
      data: {
        installState: "extracting",
        progress: { stage: "extracting", percent: 90 },
      },
      rawData: "",
      receivedAt: Date.now(),
    });
    expect(describeUpdaterProgressStage(extracting?.progress ?? null)).toContain("解压合并");

    const ready = applyUpdaterSseEvent(extracting, {
      event: "ready",
      data: {
        installState: "ready",
        downloadedFilePath: "C:\\Users\\Fish\\.prismux\\updates\\Prismux-Setup-0.1.2.exe",
        downloadedSha256: "a".repeat(64),
        progress: { stage: "ready", percent: 100 },
      },
      rawData: "",
      receivedAt: Date.now(),
    });
    expect(ready?.downloading).toBe(false);
    expect(ready?.installState).toBe("ready");
    expect(ready?.downloadedFilePath).toContain("Prismux-Setup-0.1.2.exe");
    expect(ready?.downloadedSha256).toBe("a".repeat(64));
  });

  it("selects portable-zip in portable mode and setup-exe/split-7z in installer mode", () => {
    const assets = [
      {
        name: "Prismux-Portable.zip",
        kind: "portable-zip",
        effectiveUrl: "https://github.com/Fish-under-sea/Prismux/releases/download/v0.1.2/Prismux-Portable.zip",
        sizeBytes: 120_000_000,
        sha256: "b".repeat(64),
        expectedExeName: null,
        parts: [],
        source: "github" as const,
      },
      {
        name: "Prismux-Setup.7z",
        kind: "split-7z-exe",
        effectiveUrl: "https://gitee.com/Fish-under-sea/Prismux/releases/download/v0.1.2/Prismux-Setup.7z.001",
        sizeBytes: 110_000_000,
        sha256: "c".repeat(64),
        expectedExeName: "Prismux-Setup.exe",
        parts: [],
        source: "gitee" as const,
      },
    ];
    expect(selectRecommendedUpdateAsset(assets, true)?.kind).toBe("portable-zip");
    expect(selectRecommendedUpdateAsset(assets, false)?.kind).toBe("split-7z-exe");
  });

  it("parses autoCheckEnabled policy flag with default true and explicit false override", () => {
    const defaultStatus = parseUpdaterStatusPayload(
      {
        currentVersion: "0.1.2",
        policy: { channel: "prerelease", routePreference: "auto" },
      },
      "0.1.2",
    );
    expect(defaultStatus?.policy.autoCheckEnabled).toBe(true);

    const disabledStatus = parseUpdaterStatusPayload(
      {
        currentVersion: "0.1.2",
        policy: { channel: "stable", routePreference: "domestic", autoCheckEnabled: false },
      },
      "0.1.2",
    );
    expect(disabledStatus?.policy.autoCheckEnabled).toBe(false);
  });

  it("removes hardcoded 0.1.0-alpha.1 fallback, nightly channel, and legacy 公测版/内测版 copy from PrismuxUpdatesSettingsPage", () => {
    const pagePath = path.resolve(import.meta.dirname, "PrismuxUpdatesSettingsPage.tsx");
    const source = fs.readFileSync(pagePath, "utf8");
    expect(source).not.toContain("0.1.0-alpha.1");
    expect(source.toLowerCase()).not.toContain('"nightly"');
    expect(source).not.toContain("公测版");
    expect(source).not.toContain("内测版");
    expect(source).toContain("Preview");
    expect(source).toContain("prismux-auto-check-updates-switch");
    expect(source).toContain("自动检查更新");
    expect(source).toContain("installDownloadedUpdate");
  });

  it("computes weighted progress display, stage steps, and weight hints across 0->30->60->90->95->99.9->100%", () => {
    // Handshake with null percent -> strictly null (indeterminate shimmer), never hardcoded 14%/15%.
    expect(
      resolveProgressBarPercent({
        stage: "downloading",
        percent: null,
        bytesDownloaded: 0,
        totalBytes: null,
        currentPart: 1,
        totalParts: 3,
        partName: "Prismux-Setup.exe.7z.001",
        message: null,
        updatedAt: 1000,
      }),
    ).toBeNull();
    expect(formatProgressPercentDisplay(null)).toBeNull();

    // Split part 2/3 mid-download at 42.6%
    const part2Progress = {
      stage: "downloading" as const,
      percent: 42.6,
      bytesDownloaded: 90_000_000,
      totalBytes: 218_000_000,
      currentPart: 2,
      totalParts: 3,
      partName: "Prismux-Setup.exe.7z.002",
      message: null,
      updatedAt: 2000,
    };
    expect(resolveProgressBarPercent(part2Progress)).toBe(42.6);
    expect(formatProgressPercentDisplay(42.6)).toBe("43%");
    const splitHint = formatUpdaterStageWeightHint(part2Progress, true);
    expect(splitHint).toContain("0–90%");
    expect(splitHint).toContain("30%");
    expect(splitHint).toContain("90–95%");
    expect(splitHint).toContain("95–100%");

    const downloadingSteps = buildUpdaterStageSteps(part2Progress, false, true);
    expect(downloadingSteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:active",
      "extracting:pending",
      "verifying:pending",
      "ready:pending",
    ]);

    // Extracting 90->95%
    const extractingSteps = buildUpdaterStageSteps(
      { ...part2Progress, stage: "extracting", percent: 92 },
      false,
      true,
    );
    expect(extractingSteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:completed",
      "extracting:active",
      "verifying:pending",
      "ready:pending",
    ]);

    // Verifying 99.9% displays "99%" (never prematurely 100% before ready)
    expect(formatProgressPercentDisplay(99.9)).toBe("99%");
    const verifyingSteps = buildUpdaterStageSteps(
      { ...part2Progress, stage: "verifying", percent: 99.9 },
      false,
      true,
    );
    expect(verifyingSteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:completed",
      "extracting:completed",
      "verifying:active",
      "ready:pending",
    ]);

    // Ready hits 100% with all stages completed
    expect(formatProgressPercentDisplay(100)).toBe("100%");
    const readySteps = buildUpdaterStageSteps(
      { ...part2Progress, stage: "ready", percent: 100 },
      true,
      true,
    );
    expect(readySteps.map((s) => `${s.id}:${s.state}`)).toEqual([
      "downloading:completed",
      "extracting:completed",
      "verifying:completed",
      "ready:completed",
    ]);
  });

  it("enforces zero hardcoded 14%/15% fake widths, infinite SSE reconnect, polling fallback, and glass contrast across updater UI files", () => {
    const prismuxDir = path.resolve(import.meta.dirname, "..");
    const settingsSrc = fs.readFileSync(
      path.join(prismuxDir, "settings/PrismuxUpdatesSettingsPage.tsx"),
      "utf8",
    );
    const modalSrc = fs.readFileSync(
      path.join(prismuxDir, "updates/PrismuxUpdateReleaseModal.tsx"),
      "utf8",
    );
    const hostSrc = fs.readFileSync(
      path.join(prismuxDir, "updates/PrismuxAutoUpdateHost.tsx"),
      "utf8",
    );
    const capsuleSrc = fs.readFileSync(
      path.join(prismuxDir, "updates/PrismuxSidebarUpdateCapsule.tsx"),
      "utf8",
    );

    // Zero hardcoded 14% / 15% fake widths anywhere
    expect(modalSrc).not.toMatch(/\?\?\s*14\b/);
    expect(settingsSrc).not.toMatch(/\?\?\s*15\b/);
    expect(modalSrc).not.toContain("width: 14%");
    expect(settingsSrc).not.toContain("width: 15%");

    // Infinite reconnect (no maxReconnectAttempts option cap) + 500ms fallback poller
    expect(hostSrc).not.toMatch(/maxReconnectAttempts\s*:/);
    expect(settingsSrc).not.toMatch(/maxReconnectAttempts\s*:/);
    expect(hostSrc).toContain("startUpdaterStatusFallbackPoller");
    expect(settingsSrc).toContain("startUpdaterStatusFallbackPoller");

    // Settings page shares speed & store state
    expect(settingsSrc).toContain("formatTransferSpeed");
    expect(settingsSrc).toContain("prismuxUpdateNotifierStore");

    // Glass contrast guardrail: zero bg-background/45..85 across updated UI files
    for (const [label, src] of [
      ["PrismuxUpdatesSettingsPage", settingsSrc],
      ["PrismuxUpdateReleaseModal", modalSrc],
      ["PrismuxSidebarUpdateCapsule", capsuleSrc],
    ] as const) {
      expect(src, `${label} must not use washed-out bg-background/45..85`).not.toMatch(
        /\bbg-background\/(?:45|50|55|60|70|75|80|85)\b/,
      );
    }
  });
});
