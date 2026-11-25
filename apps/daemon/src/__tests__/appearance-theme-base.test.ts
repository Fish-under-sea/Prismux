import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

import {
  AppearanceConfigStore,
  createDefaultAppearanceConfig,
  mergeAppearanceConfig,
  type GlassThemeBase
} from "../appearance/AppearanceConfigStore.js";

const ALL_GLASS_THEME_BASES: readonly GlassThemeBase[] = [
  "pure",
  "starry-violet",
  "emerald-stars",
  "sakura-drift",
  "ocean-caustics",
  "gilded-lunar"
];

const tempDirs: string[] = [];

NodeTest.after(() => {
  for (const dir of tempDirs) {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

NodeTest.describe("AppearanceConfigStore · glassThemeBase persistence & validation", () => {
  NodeTest.it("defaults glassThemeBase to 'pure' on fresh factory config and missing disk file", () => {
    const defaults = createDefaultAppearanceConfig();
    NodeAssert.equal(defaults.glassThemeBase, "pure");

    const dataDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "prismux-theme-base-default-"));
    tempDirs.push(dataDir);

    const store = new AppearanceConfigStore({ dataDir });
    const loaded = store.get();
    NodeAssert.equal(loaded.recoveredFromCorruption, false);
    NodeAssert.equal(loaded.config.glassThemeBase, "pure");
  });

  NodeTest.it("persists and reloads all 6 valid GlassThemeBase values atomically across store restarts", () => {
    const dataDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "prismux-theme-base-roundtrip-")
    );
    tempDirs.push(dataDir);

    const writer = new AppearanceConfigStore({ dataDir });
    for (const base of ALL_GLASS_THEME_BASES) {
      const updated = writer.update({ glassThemeBase: base });
      NodeAssert.equal(updated.glassThemeBase, base);

      const reader = new AppearanceConfigStore({ dataDir });
      const reloaded = reader.get();
      NodeAssert.equal(reloaded.recoveredFromCorruption, false);
      NodeAssert.equal(reloaded.config.glassThemeBase, base);

      const rawDisk = JSON.parse(NodeFS.readFileSync(writer.filePath, "utf8")) as {
        glassThemeBase?: string;
      };
      NodeAssert.equal(rawDisk.glassThemeBase, base);
    }
  });

  NodeTest.it(
    "falls back invalid or unknown glassThemeBase values safely to 'pure' while preserving valid values on unrelated patches",
    () => {
      const dataDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "prismux-theme-base-invalid-")
      );
      tempDirs.push(dataDir);

      const store = new AppearanceConfigStore({ dataDir });
      store.update({ glassThemeBase: "starry-violet" });

      const afterPartial = store.update({ fresnelStrength: 82 });
      NodeAssert.equal(afterPartial.fresnelStrength, 82);
      NodeAssert.equal(afterPartial.glassThemeBase, "starry-violet");

      const invalidInputs: readonly unknown[] = [
        "unknown-theme",
        "",
        "STARRY-VIOLET",
        123,
        null,
        { id: "starry-violet" }
      ];
      for (const bad of invalidInputs) {
        store.update({ glassThemeBase: "emerald-stars" });
        const merged = mergeAppearanceConfig(store.get().config, { glassThemeBase: bad });
        NodeAssert.equal(
          merged.glassThemeBase,
          "pure",
          `mergeAppearanceConfig should fall back invalid value ${JSON.stringify(bad)} to 'pure'`
        );
        const saved = store.update({ glassThemeBase: bad });
        NodeAssert.equal(saved.glassThemeBase, "pure");
      }
    }
  );

  NodeTest.it(
    "loads legacy appearance.json lacking glassThemeBase and sanitizes invalid on-disk values cleanly to 'pure'",
    () => {
      const dataDir = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "prismux-theme-base-legacy-")
      );
      tempDirs.push(dataDir);

      const filePath = NodePath.join(dataDir, "appearance.json");
      NodeFS.writeFileSync(
        filePath,
        JSON.stringify({
          schemaVersion: 1,
          themeMode: "glass",
          glassPreset: "balanced",
          fresnelStrength: 75
        }),
        "utf8"
      );

      const legacyStore = new AppearanceConfigStore({ dataDir });
      const legacyLoaded = legacyStore.get();
      NodeAssert.equal(legacyLoaded.recoveredFromCorruption, false);
      NodeAssert.equal(legacyLoaded.config.glassThemeBase, "pure");
      NodeAssert.equal(legacyLoaded.config.glassPreset, "balanced");
      NodeAssert.equal(legacyLoaded.config.fresnelStrength, 75);

      NodeFS.writeFileSync(
        filePath,
        JSON.stringify({
          schemaVersion: 1,
          themeMode: "glass",
          glassPreset: "clear",
          glassThemeBase: "nonexistent-substrate",
          wallpaperDim: 44
        }),
        "utf8"
      );
      const sanitizedStore = new AppearanceConfigStore({ dataDir });
      const sanitizedLoaded = sanitizedStore.get();
      NodeAssert.equal(sanitizedLoaded.recoveredFromCorruption, false);
      NodeAssert.equal(sanitizedLoaded.config.glassThemeBase, "pure");
      NodeAssert.equal(sanitizedLoaded.config.wallpaperDim, 44);
    }
  );
});
