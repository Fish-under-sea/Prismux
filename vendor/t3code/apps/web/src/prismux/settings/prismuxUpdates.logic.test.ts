// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  ALLOWED_UPDATE_CHANNELS,
  applyUpdaterSseEvent,
  describeUpdaterProgressStage,
  normalizeUpdateChannel,
  parseUpdaterStatusPayload,
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

  it("removes hardcoded 0.1.0-alpha.1 fallback and nightly channel from PrismuxUpdatesSettingsPage", () => {
    const pagePath = path.resolve(import.meta.dirname, "PrismuxUpdatesSettingsPage.tsx");
    const source = fs.readFileSync(pagePath, "utf8");
    expect(source).not.toContain("0.1.0-alpha.1");
    expect(source.toLowerCase()).not.toContain('"nightly"');
    expect(source).toContain("installDownloadedUpdate");
  });
});
