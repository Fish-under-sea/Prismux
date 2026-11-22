import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OFFICIAL_PLUGIN_IDS } from "@prismux/protocol";
import {
  closePane,
  collectLeafPaneIds,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  PRESET_TREES,
  resizeSplit,
  splitPane
} from "../layout/splitTree.js";
import {
  EmptyContinueSubmissionLatch,
  resolvePromptSubmission,
  STANDARD_CONTINUE_COMMAND
} from "../logic/emptyInputContinue.js";
import {
  createDefaultNavAndCommandState,
  exportNavAndCommandSyncPayload,
  filterSlashCommands,
  getVisibleSidebarItems,
  moveCommandHighlightIndex,
  moveSidebarItem,
  moveSlashCommand,
  overrideSidebarItemDisplay,
  overrideSlashCommandDisplay,
  restoreNavAndCommandSyncPayload,
  shouldIgnorePopoverCloseOnEventTarget,
  toggleSidebarItemVisibility,
  toggleSlashCommandVisibility
} from "../logic/navAndCommandStore.js";
import {
  buildCommunityAuditDraft,
  DEFAULT_OFFICIAL_PLUGIN_CATALOG,
  validateNpmPackageSpec
} from "../logic/pluginMarketCatalog.js";
import {
  getDeepSeekTrackStyle,
  getReasoningTrackStyle,
  isDeepSeekModel
} from "../logic/reasoningThemeTokens.js";
import {
  deduplicateMachineUsage,
  formatLedgerMetric,
  formatMachineIdLabel,
  summarizeUsageLedger,
  UNKNOWN_METRIC_LABEL
} from "../logic/usageFormatting.js";
import {
  extractVisibilityPayload,
  resolveVisibilityOcclusion
} from "../logic/visibilityBridge.js";
import {
  applyAppearanceToDocument,
  DEFAULT_APPEARANCE_STATE,
  parseWbThemeImport,
  sanitizeWbThemeForExport,
  type WbThemeBundle
} from "../theme/themeEngine.js";

function createFakeDocument() {
  const attributes = new Map<string, string>();
  const styleProps = new Map<string, string>();
  return {
    attributes,
    styleProps,
    doc: {
      documentElement: {
        getAttribute(name: string) {
          return attributes.get(name) ?? null;
        },
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
        style: {
          setProperty(name: string, value: string) {
            styleProps.set(name, value);
          }
        }
      }
    } as unknown as Document
  };
}

describe("EmptyContinueSubmissionLatch & empty-input Continue", () => {
  it("converts blank input to standard Continue instruction and blocks rapid double-fire", async () => {
    let clock = 1_000;
    const latch = new EmptyContinueSubmissionLatch({
      cooldownMs: 400,
      now: () => clock
    });

    const resolved = resolvePromptSubmission("   \n\t ", "enter", "chief-1");
    assert.equal(resolved.text, STANDARD_CONTINUE_COMMAND);
    assert.equal(resolved.isAutoContinue, true);

    const first = latch.tryBegin("", { trigger: "button", threadId: "chief-1" });
    assert.equal(first.accepted, true);
    assert.equal(first.intent.text, STANDARD_CONTINUE_COMMAND);
    assert.ok(first.submissionId);

    // Simultaneous Enter key while inflight must be blocked
    const secondWhileInflight = latch.tryBegin("   ", {
      trigger: "enter",
      threadId: "chief-1"
    });
    assert.equal(secondWhileInflight.accepted, false);
    assert.equal(secondWhileInflight.reason, "duplicate_inflight");

    latch.complete(first.submissionId);

    // Bounce click within cooldown must also be blocked even after inflight completes
    clock += 120;
    const thirdInCooldown = latch.tryBegin("", {
      trigger: "button",
      threadId: "chief-1"
    });
    assert.equal(thirdInCooldown.accepted, false);
    assert.equal(thirdInCooldown.reason, "duplicate_cooldown");

    // Once cooldown expires, submitting again succeeds cleanly
    clock += 500;
    let executedCount = 0;
    const fourth = await latch.submitOnce(
      "",
      async (intent) => {
        executedCount += 1;
        return intent.text;
      },
      { trigger: "enter", threadId: "chief-1" }
    );
    assert.equal(fourth.executed, true);
    assert.equal(executedCount, 1);
    assert.equal(fourth.latch.intent.text, STANDARD_CONTINUE_COMMAND);
  });
});

describe("DeepSeek reasoning effort theme tokens", () => {
  it("renders deep navy track + #6cb6ff non-purple highlight in dark and liquid-glass modes", () => {
    assert.equal(isDeepSeekModel("deepseek-r1", "deepseek"), true);
    assert.equal(isDeepSeekModel("claude-sonnet-4-5", "anthropic"), false);

    for (const mode of ["dark", "liquid-glass"] as const) {
      const style = getDeepSeekTrackStyle(mode);
      assert.equal(style.variant, "deepseek-dark");
      assert.equal(style.trackBackground, "#0b192e");
      assert.equal(style.highlightTextColor, "#6cb6ff");
      assert.equal(style.fillStartHex, "#1d4ed8");
      assert.equal(style.fillEndHex, "#6cb6ff");
      assert.doesNotMatch(
        `${style.trackBackground} ${style.fillGradient} ${style.highlightTextColor}`,
        /#(?:7c3aed|8b5cf6|9333ea|a855f7|c084fc)/i
      );
    }

    const lightStyle = getReasoningTrackStyle("deepseek-reasoner", "light");
    assert.equal(lightStyle.variant, "deepseek-light");
    assert.equal(lightStyle.trackBackground, "#eef5ff");
    assert.notEqual(lightStyle.trackBackground, "#0b192e");
  });
});

describe("NavAndCommandOrder store & cross-device sync", () => {
  it("reorders, hides, overrides titles/icons, filters / commands, and restores across devices", () => {
    let state = createDefaultNavAndCommandState(100);
    const initialVisible = getVisibleSidebarItems(state);
    assert.ok(initialVisible.length >= 6);

    // Move second item up to index 0, hide one item, and override display title + 16x16 icon
    const secondId = initialVisible[1]!.id;
    state = moveSidebarItem(state, secondId, "up", 200);
    state = overrideSidebarItemDisplay(
      state,
      secondId,
      { customTitle: "自定义工作树", customIcon: "★" },
      210
    );
    const hiddenId = initialVisible[3]!.id;
    state = toggleSidebarItemVisibility(state, hiddenId, false, 220);

    const updatedVisible = getVisibleSidebarItems(state);
    assert.equal(updatedVisible[0]?.id, secondId);
    assert.equal(updatedVisible[0]?.displayTitle, "自定义工作树");
    assert.equal(updatedVisible[0]?.displayIcon, "★");
    assert.equal(
      updatedVisible.some((item) => item.id === hiddenId),
      false
    );

    // Reorder /handoff to top & filter
    state = moveSlashCommand(state, "cmd-handoff", "up", 230);
    state = overrideSlashCommandDisplay(
      state,
      "cmd-handoff",
      { customTitle: "无损交接" },
      240
    );
    state = toggleSlashCommandVisibility(state, "cmd-theme", false, 250);

    const allVisibleCommands = filterSlashCommands(state, "/");
    assert.equal(allVisibleCommands[0]?.id, "cmd-handoff");
    assert.equal(allVisibleCommands[0]?.displayTitle, "无损交接");
    assert.equal(
      allVisibleCommands.some((cmd) => cmd.id === "cmd-theme"),
      false
    );
    assert.equal(filterSlashCommands(state, "交接").length, 1);

    // Keyboard wrap navigation & inner popover scroll guard
    assert.equal(moveCommandHighlightIndex(0, 4, "ArrowUp"), 3);
    assert.equal(moveCommandHighlightIndex(3, 4, "ArrowDown"), 0);
    const fakePopover = {
      contains(node: unknown) {
        return node === "inside-list";
      }
    };
    assert.equal(
      shouldIgnorePopoverCloseOnEventTarget(fakePopover, "inside-list"),
      true
    );
    assert.equal(
      shouldIgnorePopoverCloseOnEventTarget(fakePopover, "outside-window"),
      false
    );

    // Cross-device export & restore
    const snapshot = exportNavAndCommandSyncPayload(state, "macbook-pro");
    const restored = restoreNavAndCommandSyncPayload(snapshot);
    assert.equal(restored.machineId, "macbook-pro");
    assert.equal(getVisibleSidebarItems(restored)[0]?.id, secondId);
    assert.equal(
      getVisibleSidebarItems(restored)[0]?.displayTitle,
      "自定义工作树"
    );
    assert.equal(filterSlashCommands(restored, "/")[0]?.id, "cmd-handoff");
  });
});

describe("UsageLedger formatting & multi-machine deduplication", () => {
  it("strictly renders '未告知' for unknown metrics while preserving real 0 values", () => {
    assert.equal(formatLedgerMetric(undefined), UNKNOWN_METRIC_LABEL);
    assert.equal(formatLedgerMetric(null), UNKNOWN_METRIC_LABEL);
    assert.equal(formatLedgerMetric(Number.NaN), UNKNOWN_METRIC_LABEL);
    assert.equal(
      formatLedgerMetric(undefined, { unit: "ratio-percent" }),
      UNKNOWN_METRIC_LABEL
    );
    assert.equal(formatMachineIdLabel(""), UNKNOWN_METRIC_LABEL);

    // Real 0 must still display 0, never collapsed into unknown
    assert.equal(formatLedgerMetric(0, { unit: "tokens" }), "0");
    assert.equal(formatLedgerMetric(0, { unit: "ratio-percent" }), "0.0%");
    assert.equal(formatLedgerMetric(0, { unit: "usd" }), "$0.00");

    // Deduplicate same (machineId, providerId) records during sync restore
    const deduped = deduplicateMachineUsage([
      {
        machineId: "fish-win11",
        providerId: "claude-code",
        todayTokens: 1200,
        weekTokens: 5000,
        quotaUsedRatio: 0.25
      },
      {
        machineId: "fish-win11",
        providerId: "claude-code",
        todayTokens: 1500,
        weekTokens: 5200,
        quotaUsedRatio: 0.3
      },
      {
        machineId: "nas-debian",
        providerId: "claude-code",
        todayTokens: 800,
        weekTokens: 2000
      }
    ]);
    assert.equal(deduped.length, 2);

    const summary = summarizeUsageLedger(deduped);
    assert.equal(summary.totalTodayTokens, 2300);
    assert.equal(summary.totalWeekTokens, 7200);
    assert.ok(summary.unknownFieldCount > 0);
  });
});

describe("SplitWorkspace binary split tree", () => {
  it("supports preset layouts, splitting, ratio clamping, and pane closing", () => {
    assert.deepEqual(collectLeafPaneIds(PRESET_TREES["secretary-standby"]), [
      "chief-chat"
    ]);
    const codingLeaves = collectLeafPaneIds(PRESET_TREES["multi-agent-coding"]);
    assert.deepEqual(codingLeaves, [
      "worktree-tree",
      "pty-terminal",
      "git-diff",
      "approval-inbox",
      "live-preview"
    ]);

    const splitted = splitPane(
      PRESET_TREES["secretary-standby"],
      "chief-chat",
      "horizontal",
      "pty-terminal"
    );
    assert.equal(splitted.kind, "split");
    assert.deepEqual(collectLeafPaneIds(splitted), [
      "chief-chat",
      "pty-terminal"
    ]);

    const clampedLow = resizeSplit(splitted, splitted.id, 0.01);
    assert.equal(clampedLow.kind, "split");
    assert.equal(clampedLow.ratio, MIN_SPLIT_RATIO);

    const clampedHigh = resizeSplit(splitted, splitted.id, 0.99);
    assert.equal(clampedHigh.kind, "split");
    assert.equal(clampedHigh.ratio, MAX_SPLIT_RATIO);

    const closed = closePane(clampedHigh, "pty-terminal");
    assert.deepEqual(collectLeafPaneIds(closed), ["chief-chat"]);
    // Closing the final remaining leaf keeps it safely intact
    assert.deepEqual(collectLeafPaneIds(closePane(closed, "chief-chat")), [
      "chief-chat"
    ]);
  });
});

describe("ThemeEngine .wb-theme sanitization & document sync", () => {
  it("strips local paths and credentials on export and parses valid imports", () => {
    const dirtyBundle = {
      schemaVersion: 1 as const,
      name: "Ocean Glass",
      exportedAt: "2026-11-22T15:00:00Z",
      themeMode: "liquid-glass" as const,
      layoutPreset: "multi-agent-coding" as const,
      glass: DEFAULT_APPEARANCE_STATE.glass,
      wallpaper: {
        sourceType: "scene" as const,
        sourcePath: "D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\123",
        veilOpacity: 0.3,
        vignetteStrength: 0.2,
        blurPx: 4,
        fpsLimit: 60,
        pauseWhenOccluded: true,
        audioReactive: false
      },
      typography: DEFAULT_APPEARANCE_STATE.typography,
      splitTree: PRESET_TREES["multi-agent-coding"],
      apiKey: "sk-secret-do-not-leak",
      token: "ghp_secret",
      vaultPath: "C:\\Users\\Fish\\Vault",
      nested: {
        password: "my-password",
        executableDir: "C:\\Program Files\\Prismux"
      }
    } as unknown as WbThemeBundle & Record<string, unknown>;

    const clean = sanitizeWbThemeForExport(dirtyBundle);
    const serialized = JSON.stringify(clean);
    assert.equal(serialized.includes("sk-secret-do-not-leak"), false);
    assert.equal(serialized.includes("ghp_secret"), false);
    assert.equal(serialized.includes("my-password"), false);
    assert.equal(serialized.includes("SteamLibrary"), false);
    assert.equal(serialized.includes("Vault"), false);
    assert.equal(
      (clean.wallpaper as Record<string, unknown>).sourcePath,
      undefined
    );

    const reimported = parseWbThemeImport(serialized);
    assert.equal(reimported.name, "Ocean Glass");
    assert.equal(reimported.themeMode, "liquid-glass");
    assert.throws(() => parseWbThemeImport("{not-valid-json"));
    assert.throws(() =>
      parseWbThemeImport(JSON.stringify({ schemaVersion: 99 }))
    );

    // Verify applyAppearanceToDocument writes attributes & clear 0% fill without #000
    const { attributes, styleProps, doc } = createFakeDocument();
    applyAppearanceToDocument(
      {
        ...DEFAULT_APPEARANCE_STATE,
        glass: {
          ...DEFAULT_APPEARANCE_STATE.glass,
          content: { fill: 0, blur: 12 },
          preset: "custom"
        }
      },
      doc
    );
    assert.equal(attributes.get("data-prismux-theme"), "dark");
    assert.equal(attributes.get("data-prismux-mode"), "glass");
    assert.equal(attributes.get("data-prismux-glass"), "1");
    assert.equal(styleProps.get("--prismux-glass-content-fill"), "0%");
    assert.notEqual(styleProps.get("--prismux-glass-tint"), "#000");
  });
});

describe("Plugin market catalog & 0 FPS occlusion resolver", () => {
  it("lists all 4 un-preinstalled official plugins and flags modelVisible community plugins", () => {
    assert.deepEqual(
      DEFAULT_OFFICIAL_PLUGIN_CATALOG.map((p) => p.id),
      [...OFFICIAL_PLUGIN_IDS]
    );

    assert.equal(validateNpmPackageSpec("git+https://github.com/a/b.git").valid, false);
    assert.equal(validateNpmPackageSpec("@scope/prismux-plugin-demo").valid, true);

    const safeDraft = buildCommunityAuditDraft("prismux-plugin-clock", {
      modelVisible: false
    });
    assert.equal(safeDraft.noGitUsed, true);
    assert.deepEqual(safeDraft.ignoredScripts, [
      "preinstall",
      "install",
      "postinstall"
    ]);
    assert.equal(safeDraft.requiresYellowWarningConfirm, false);

    const riskyDraft = buildCommunityAuditDraft(
      "@community/prismux-plugin-prompt-helper",
      { modelVisible: true }
    );
    assert.equal(riskyDraft.modelVisible, true);
    assert.equal(riskyDraft.requiresYellowWarningConfirm, true);
    assert.ok(riskyDraft.warnings.length > 0);
  });

  it("forces wallpaper occlusion to 0 FPS when window is hidden, minimized, or occluded", () => {
    assert.equal(
      resolveVisibilityOcclusion({
        documentHidden: false,
        pauseWhenOccluded: true,
        signal: extractVisibilityPayload({ occluded: false, targetFps: 60 })
      }),
      false
    );
    assert.equal(
      resolveVisibilityOcclusion({
        documentHidden: true,
        pauseWhenOccluded: true,
        signal: null
      }),
      true
    );
    assert.equal(
      resolveVisibilityOcclusion({
        documentHidden: false,
        pauseWhenOccluded: true,
        signal: extractVisibilityPayload({ minimized: true, targetFps: 0 })
      }),
      true
    );
    assert.equal(
      resolveVisibilityOcclusion({
        documentHidden: true,
        pauseWhenOccluded: false,
        signal: { occluded: true }
      }),
      false
    );
  });
});
