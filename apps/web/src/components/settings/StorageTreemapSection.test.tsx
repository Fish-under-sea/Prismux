import { GTProvider, initializeGT } from "gt-react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./settingsLayout", () => ({
  SettingsSection: ({
    title,
    headerAction,
    children,
  }: {
    title: string;
    headerAction?: ReactNode;
    children: ReactNode;
  }) => (
    <section aria-label={title}>
      {headerAction}
      {children}
    </section>
  ),
}));

import type {
  DaemonStorageInventoryResponse,
  DaemonStorageNodeDto,
} from "../../prismux/daemonClient";
import { StorageTreemapSection } from "./StorageTreemapSection";
import {
  buildCompactDatabaseCleanRequest,
  buildDisposableCleanRequest,
  buildManagedCleanRequest,
  computeSquarifiedTreemap,
  resolveStorageDrillLevel,
  resolveStorageFootprintTone,
  summarizeStorageTiers,
} from "./StorageTreemapSection.logic";

const SAMPLE_CATEGORIES: readonly DaemonStorageNodeDto[] = [
  {
    id: "worktrees",
    name: "Git Worktrees",
    path: "C:/Users/demo/.prismux/worktrees",
    bytes: 3_200_000_000,
    fileCount: 4120,
    tier: "managed",
    categoryId: "worktrees",
    cleanable: true,
    cleanAction: "clean-worktrees",
    children: [
      {
        id: "worktrees/repo-a",
        name: "repo-a",
        path: "C:/Users/demo/.prismux/worktrees/repo-a",
        bytes: 2_100_000_000,
        fileCount: 2800,
        tier: "managed",
        categoryId: "worktrees",
        cleanable: true,
        cleanAction: "clean-worktrees",
      },
      {
        id: "worktrees/repo-b",
        name: "repo-b",
        path: "C:/Users/demo/.prismux/worktrees/repo-b",
        bytes: 1_100_000_000,
        fileCount: 1320,
        tier: "managed",
        categoryId: "worktrees",
        cleanable: true,
        cleanAction: "clean-worktrees",
      },
    ],
  },
  {
    id: "cache",
    name: "Electron & Web Cache",
    path: "C:/Users/demo/AppData/Roaming/Prismux/Cache",
    bytes: 1_400_000_000,
    fileCount: 950,
    tier: "disposable",
    categoryId: "cache",
    cleanable: true,
    cleanAction: "clean-cache",
  },
  {
    id: "logs",
    name: "Daemon & Server Logs",
    path: "C:/Users/demo/.prismux/logs",
    bytes: 350_000_000,
    fileCount: 84,
    tier: "disposable",
    categoryId: "logs",
    cleanable: true,
    cleanAction: "clean-logs",
  },
  {
    id: "memory-db",
    name: "Core SQLite & Credentials",
    path: "C:/Users/demo/.prismux/data/memory.db",
    bytes: 650_000_000,
    fileCount: 6,
    tier: "protected",
    categoryId: "core-db",
    cleanable: false,
  },
];

describe("computeSquarifiedTreemap", () => {
  it("conserves 100% of container area with zero overlapping rectangles", () => {
    const rects = computeSquarifiedTreemap(SAMPLE_CATEGORIES, { width: 1000, height: 400 });
    expect(rects).toHaveLength(4);

    const totalAreaPercent = rects.reduce(
      (sum, rect) => sum + rect.widthPercent * rect.heightPercent,
      0,
    );
    expect(totalAreaPercent).toBeCloseTo(10_000, 3);

    const totalShare = rects.reduce((sum, rect) => sum + rect.sharePercent, 0);
    expect(totalShare).toBeCloseTo(100, 3);

    for (let i = 0; i < rects.length; i += 1) {
      const a = rects[i]!;
      expect(a.xPercent).toBeGreaterThanOrEqual(-1e-6);
      expect(a.yPercent).toBeGreaterThanOrEqual(-1e-6);
      expect(a.xPercent + a.widthPercent).toBeLessThanOrEqual(100 + 1e-6);
      expect(a.yPercent + a.heightPercent).toBeLessThanOrEqual(100 + 1e-6);
      for (let j = i + 1; j < rects.length; j += 1) {
        const b = rects[j]!;
        const overlapX =
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY =
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(Math.max(0, overlapX) * Math.max(0, overlapY)).toBeLessThan(1e-3);
      }
    }
  });

  it("ignores zero/negative byte items and handles empty or single-item inputs cleanly", () => {
    expect(computeSquarifiedTreemap([], { width: 800, height: 300 })).toEqual([]);
    expect(
      computeSquarifiedTreemap(
        [
          { id: "zero", bytes: 0 },
          { id: "neg", bytes: -5 },
        ],
        { width: 800, height: 300 },
      ),
    ).toEqual([]);

    const single = computeSquarifiedTreemap([{ id: "only", bytes: 1024 }], {
      width: 800,
      height: 300,
    });
    expect(single).toHaveLength(1);
    expect(single[0]?.widthPercent).toBeCloseTo(100, 5);
    expect(single[0]?.heightPercent).toBeCloseTo(100, 5);
    expect(single[0]?.sharePercent).toBeCloseTo(100, 5);
  });
});

describe("StorageTreemapSection drill-down and cleanup builders", () => {
  it("drills down into children with breadcrumbs and ignores stale path segments", () => {
    const level = resolveStorageDrillLevel(SAMPLE_CATEGORIES, ["worktrees"]);
    expect(level.breadcrumbs).toEqual([{ id: "worktrees", name: "Git Worktrees" }]);
    expect(level.nodes.map((node) => node.id)).toEqual(["worktrees/repo-a", "worktrees/repo-b"]);

    const stale = resolveStorageDrillLevel(SAMPLE_CATEGORIES, ["worktrees", "removed-child"]);
    expect(stale.breadcrumbs).toEqual([{ id: "worktrees", name: "Git Worktrees" }]);
    expect(stale.nodes).toHaveLength(2);
  });

  it("builds tier-safe cleanup payloads that never include protected categories", () => {
    const disposableReq = buildDisposableCleanRequest(SAMPLE_CATEGORIES);
    expect(disposableReq).toEqual({
      targetIds: ["cache", "logs"],
      actions: ["clean-cache", "clean-logs"],
    });

    const managedWithSharedAction: readonly DaemonStorageNodeDto[] = [
      ...SAMPLE_CATEGORIES,
      {
        id: "worktrees-secondary",
        name: "Secondary Worktrees",
        path: "C:/Users/demo/.prismux/worktrees-secondary",
        bytes: 900_000_000,
        fileCount: 310,
        tier: "managed",
        categoryId: "worktrees",
        cleanable: true,
        cleanAction: "clean-worktrees",
      },
    ];
    const managedReq = buildManagedCleanRequest(
      managedWithSharedAction,
      new Set(["worktrees", "memory-db", "cache"]),
    );
    expect(managedReq).toEqual({
      targetIds: ["worktrees"],
    });
    expect(managedReq?.actions).toBeUndefined();

    expect(buildCompactDatabaseCleanRequest()).toEqual({ actions: ["compact-db"] });
  });

  it("summarizes tier totals and computes warning/danger tones at 5 GiB threshold", () => {
    const summary = summarizeStorageTiers(SAMPLE_CATEGORIES);
    expect(summary.disposable.bytes).toBe(1_750_000_000);
    expect(summary.managed.bytes).toBe(3_200_000_000);
    expect(summary.protected.bytes).toBe(650_000_000);

    const fiveGiB = 5 * 1024 * 1024 * 1024;
    expect(resolveStorageFootprintTone(fiveGiB - 1, fiveGiB)).toBe("default");
    expect(resolveStorageFootprintTone(fiveGiB, fiveGiB)).toBe("warning");
    expect(resolveStorageFootprintTone(fiveGiB * 1.6, fiveGiB)).toBe("danger");
  });

  beforeAll(async () => {
    await initializeGT({
      defaultLocale: "en",
      locales: ["en", "zh"],
      loadTranslations: async () => ({}),
      cacheExpiryTime: null,
    });
  });

  it("renders treemap blocks, quota guard policies, and safe cleanup actions cleanly", () => {
    const inventory: DaemonStorageInventoryResponse = {
      scannedAt: "2026-11-26T00:00:00.000Z",
      durationMs: 42,
      totalBytes: 5_600_000_000,
      reclaimableDisposableBytes: 1_750_000_000,
      reclaimableManagedBytes: 3_200_000_000,
      protectedBytes: 650_000_000,
      warningThresholdBytes: 5 * 1024 * 1024 * 1024,
      roots: [],
      categories: SAMPLE_CATEGORIES,
      policies: [
        { id: "logs-ttl", label: "Logs retention", limitLabel: "14d / 512 MB", active: true },
        { id: "cache-cap", label: "Cache cap", limitLabel: "1 GB", active: true },
      ],
    };

    const html = renderToStaticMarkup(
      <GTProvider locale="en" translations={{}}>
        <StorageTreemapSection inventory={inventory} loading={false} error={null} />
      </GTProvider>,
    );

    expect(html).toContain("storage-treemap-canvas");
    expect(html).toContain("treemap-block-worktrees");
    expect(html).toContain('data-tier="protected"');
    expect(html).toContain("Logs retention");
    expect(html).toContain("Clean regenerable cache");
    expect(html).toContain("Compact database");
  });
});
