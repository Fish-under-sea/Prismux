import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { DeclarativeGlassRenderer, type DeclarativeUiPanelSpec } from "@prismux/appearance";
import {
  PLUGIN_DEVELOPMENT_GUIDE_REPO_PATH,
  PLUGIN_DEVELOPMENT_GUIDE_URL,
  PLUGIN_HOOKS_AND_THEME_REPO_PATH,
  PLUGIN_HOOKS_AND_THEME_URL,
  PLUGIN_REQUIREMENT_PLACEHOLDER_BLOCK,
  PluginCreatorGuideModal,
  buildPluginCreatorAgentPrompt,
} from "./PluginCreatorGuideModal";
import { PluginDetailDrawer } from "./PluginDetailDrawer";
import { PluginRollbackDialog } from "./PluginRollbackDialog";
import { PluginTrustAuditModal } from "./PluginTrustAuditModal";
import {
  PrismuxPluginCenterView,
  parsePluginRegistryOverrideFromUpdaterStatus,
  pluginRegistryOverrideToNetworkPreference,
} from "./PrismuxPluginCenterView";
import {
  DEFAULT_GROUP_DISPLAY_LIMIT,
  DEFAULT_RETIRED_OFFICIAL_PLUGINS,
  comparePluginSemver,
  computePluginCounts,
  evaluatePluginTrustAudit,
  filterPluginCenterItems,
  isAuditRequiredError,
  mergePluginCenterItems,
  parseCatalogPluginsPayload,
  parseRetiredPluginsPayload,
  selectVisiblePluginsForGroup,
  type InstalledPluginRaw,
  type OfficialCatalogPluginRaw,
  type PluginCenterItem,
} from "./pluginCenterModel";

function makeOfficialCatalogFixture(): OfficialCatalogPluginRaw[] {
  return [
    {
      id: "qq",
      packageName: "@prismux/plugin-qq",
      version: "0.2.0",
      description: "OneBot v11 QQ private Chief Supervisor bridge and isolated group companion plugin.",
      enginesPrismux: ">=0.1.0-0 <2.0.0",
      realms: ["daemon", "ui"],
      permissions: ["network:outbound", "network:inbound", "memory:social-qq", "hooks:subscribe"],
      modelVisible: false,
      modifiesSystemPrompt: false,
      sha256: "ba6f307528f32edfbf0dd174a1bfa2be7c8d4a1c4a9f22a080ee8483cb7bd28f",
      bytes: 72311,
      status: "verified",
      installed: true,
      enabled: true,
      mounted: true,
      installedVersion: "0.1.0-alpha.3",
      previousVersion: "0.1.0-alpha.2",
      distribution: "managed",
    },
    {
      id: "fishdock-hook",
      packageName: "@prismux/plugin-fishdock-hook",
      version: "0.1.0-alpha.3",
      description: "Bridge plugin pushing PreToolUse approvals and alerts to FISH-Dock Dynamic Island.",
      enginesPrismux: ">=0.1.0-0 <2.0.0",
      realms: ["daemon"],
      permissions: ["network:outbound", "hooks:subscribe", "notifications:push"],
      modelVisible: false,
      modifiesSystemPrompt: false,
      sha256: "b3fec9a26034ccacc19acd6e36a11179a7ef76c6c749d90756512704a6da06f9",
      bytes: 36977,
      status: "verified",
      installed: false,
      enabled: false,
      mounted: false,
    },
  ];
}

function makeCommunityInstalledFixture(): InstalledPluginRaw[] {
  return [
    {
      id: "glass-nord-theme",
      packageName: "prismux-plugin-theme-nord",
      version: "1.0.0",
      description: "Nord inspired frosted liquid glass palette preset.",
      enginesPrismux: ">=0.1.0 <2.0.0",
      realms: ["ui"],
      permissions: ["ui:panel"],
      modelVisible: false,
      modifiesSystemPrompt: false,
      distribution: "managed",
      enabled: true,
      mounted: true,
      source: "npm",
      sha256: "abcdef0123456789abcdef0123456789",
      installedAt: 1763800000000,
    },
    {
      id: "ai-prompt-helper",
      packageName: "prismux-plugin-prompt-helper",
      version: "1.2.0",
      description: "Injects custom review instructions for model tools.",
      enginesPrismux: ">=0.1.0 <2.0.0",
      realms: ["daemon"],
      permissions: ["hooks:intercept", "network:outbound"],
      modelVisible: true,
      modifiesSystemPrompt: true,
      distribution: "managed",
      enabled: true,
      mounted: true,
      source: "npm",
      sha256: "99999999999999999999999999999999",
      installedAt: 1763800100000,
    },
  ];
}

describe("Plugin Center model: 4-state tabs, category chips, search, and update detection", () => {
  it("merges catalog + installed, detects SemVer updates, classifies categories, and filters accurately", () => {
    expect(comparePluginSemver("0.2.0", "0.1.0-alpha.3")).toBe(1);
    expect(comparePluginSemver("0.1.0-alpha.3", "0.1.0-alpha.3")).toBe(0);
    expect(comparePluginSemver("0.1.0-alpha.2", "0.1.0-alpha.3")).toBe(-1);

    const items = mergePluginCenterItems(
      makeOfficialCatalogFixture(),
      makeCommunityInstalledFixture(),
    );

    const counts = computePluginCounts(items);
    expect(counts.all).toBe(4);
    expect(counts.installed).toBe(3); // qq + glass-nord-theme + ai-prompt-helper
    expect(counts.available).toBe(1); // fishdock-hook
    expect(counts.updates).toBe(1); // qq: 0.1.0-alpha.3 -> 0.2.0

    // Category distribution
    expect(counts.byCategory.communication).toBe(2); // qq, fishdock-hook
    expect(counts.byCategory.pet).toBe(0);
    expect(counts.byCategory.ops).toBe(0);
    expect(counts.byCategory.theme).toBe(1); // glass-nord-theme
    expect(counts.byCategory.tools).toBe(1); // ai-prompt-helper

    // Four-state tabs
    expect(
      filterPluginCenterItems(items, { tab: "installed", category: "all", query: "" }).map(
        (i) => i.id,
      ),
    ).toEqual(["qq", "glass-nord-theme", "ai-prompt-helper"]);
    expect(
      filterPluginCenterItems(items, { tab: "available", category: "all", query: "" }).map(
        (i) => i.id,
      ),
    ).toEqual(["fishdock-hook"]);
    expect(
      filterPluginCenterItems(items, { tab: "updates", category: "all", query: "" }).map(
        (i) => i.id,
      ),
    ).toEqual(["qq"]);

    // Category Chips + Instant Search
    expect(
      filterPluginCenterItems(items, { tab: "all", category: "theme", query: "" }).map((i) => i.id),
    ).toEqual(["glass-nord-theme"]);
    expect(
      filterPluginCenterItems(items, { tab: "all", category: "all", query: "hooks:intercept" }).map(
        (i) => i.id,
      ),
    ).toEqual(["ai-prompt-helper"]);
    expect(
      filterPluginCenterItems(items, { tab: "all", category: "communication", query: "onebot" }).map(
        (i) => i.id,
      ),
    ).toEqual(["qq"]);

    // Deprecated entries are filtered out of active catalog and parsed via retiredPlugins
    const parsedActive = parseCatalogPluginsPayload({
      plugins: [
        { id: "qq", version: "0.1.2-preview.1", status: "verified" },
        { id: "pet", version: "0.1.2-preview.1", status: "deprecated" },
      ],
    });
    expect(parsedActive.map((item) => item.id)).toEqual(["qq"]);
    const retired = parseRetiredPluginsPayload({});
    expect(retired.map((item) => item.id)).toEqual(["pet", "ssh"]);
    expect(retired.every((item) => item.status === "deprecated" && item.replacedByBuiltin)).toBe(
      true,
    );
  });
});

describe("Plugin Center 12-item group cap & pinned-installed retention rule", () => {
  it("caps default group display at 12 items in catalog order while ALWAYS pinning installed plugins located past index 12", () => {
    expect(DEFAULT_GROUP_DISPLAY_LIMIT).toBe(12);

    const twentyItems = Array.from({ length: 20 }, (_, idx) => ({
      id: `plugin-${idx + 1}`,
      // Put 3 installed plugins AFTER the 12-item boundary!
      installed: idx === 14 || idx === 17 || idx === 19,
    }));

    const collapsed = selectVisiblePluginsForGroup(twentyItems, {
      isFiltering: false,
      expanded: false,
    });

    // Preserves catalog order (first 12 + 3 installed past index 12 = 15 visible, 5 hidden)
    // so installing a plugin never jumps its card across the grid!
    expect(collapsed.visible).toHaveLength(15);
    expect(collapsed.hiddenCount).toBe(5);
    expect(collapsed.isTruncated).toBe(true);
    expect(collapsed.pinnedInstalledCount).toBe(3);

    const visibleIds = collapsed.visible.map((item) => item.id);
    expect(visibleIds.slice(0, 12)).toEqual(
      Array.from({ length: 12 }, (_, idx) => `plugin-${idx + 1}`),
    );
    expect(visibleIds.slice(12)).toEqual(["plugin-15", "plugin-18", "plugin-20"]);

    // Expanding shows all 20
    const expanded = selectVisiblePluginsForGroup(twentyItems, {
      isFiltering: false,
      expanded: true,
    });
    expect(expanded.visible).toHaveLength(20);
    expect(expanded.hiddenCount).toBe(0);
    expect(expanded.isTruncated).toBe(false);

    // Filtering/searching shows all matching items without truncation
    const filtered = selectVisiblePluginsForGroup(twentyItems, {
      isFiltering: true,
      expanded: false,
    });
    expect(filtered.visible).toHaveLength(20);
    expect(filtered.hiddenCount).toBe(0);
  });

  it("never truncates installed plugins even when more than 12 plugins are installed", () => {
    const items = Array.from({ length: 20 }, (_, idx) => ({
      id: `plugin-${idx + 1}`,
      installed: idx < 15,
    }));

    const result = selectVisiblePluginsForGroup(items, {
      isFiltering: false,
      expanded: false,
    });

    expect(result.visible).toHaveLength(15);
    expect(result.visible.every((item) => item.installed)).toBe(true);
    expect(result.hiddenCount).toBe(5);
    expect(result.isTruncated).toBe(true);
  });
});

describe("Trust Audit Confirmation Gate (modelVisible / prompt / sensitive permissions)", () => {
  it("forces structured trust audit for modelVisible: true, prompt-modifying, or sensitive net/fs/shell plugins on install & upgrade", () => {
    // modelVisible: true
    const modelAudit = evaluatePluginTrustAudit(
      {
        source: "npm",
        targetLabel: "prismux-plugin-prompt-helper",
        packageNameOrTarball: "prismux-plugin-prompt-helper",
        modelVisible: true,
        permissions: ["hooks:intercept"],
      },
      "install",
    );
    expect(modelAudit.required).toBe(true);
    expect(modelAudit.severity).toBe("critical");
    expect(modelAudit.riskReasons.some((r) => r.includes("modelVisible: true"))).toBe(true);

    // Sensitive shell/fs/network on upgrade (community ops plugin)
    const opsUpgradeAudit = evaluatePluginTrustAudit(
      {
        source: "npm",
        targetLabel: "远程运维扩展 (prismux-plugin-ops-demo)",
        packageNameOrTarball: "prismux-plugin-ops-demo",
        fromVersion: "0.1.0-alpha.3",
        toVersion: "0.2.0",
        sha256: "54c90bdb7d09d4472145c70aaa8b463028e9dce6ed953aa8c31e1f4aca782265",
        modelVisible: false,
        permissions: ["network:outbound", "pty:spawn", "fs:read", "fs:write"],
      },
      "upgrade",
    );
    expect(opsUpgradeAudit.required).toBe(true);
    expect(opsUpgradeAudit.severity).toBe("critical");
    expect(opsUpgradeAudit.operation).toBe("upgrade");
    expect(opsUpgradeAudit.sensitivePermissions.length).toBe(4);

    // Safe 0-Token non-sensitive UI theme plugin
    const safeUiAudit = evaluatePluginTrustAudit(
      {
        source: "npm",
        targetLabel: "极光主题 (prismux-plugin-theme-nord)",
        packageNameOrTarball: "prismux-plugin-theme-nord",
        modelVisible: false,
        permissions: ["ui:panel", "hooks:subscribe"],
      },
      "install",
    );
    expect(safeUiAudit.required).toBe(false);
    expect(safeUiAudit.severity).toBe("info");

    // Daemon 409 audit object permissions extraction
    const parsedAuditErr = isAuditRequiredError({
      status: 409,
      code: "AUDIT_CONFIRMATION_REQUIRED",
      details: {
        error: {
          details: {
            permissions: [
              { permission: "hooks:intercept", labelZh: "拦截钩子", elevated: true },
              "network:outbound",
            ],
            warnings: ["需要二次确认"],
          },
        },
      },
    });
    expect(parsedAuditErr.required).toBe(true);
    expect(parsedAuditErr.permissions).toEqual(["hooks:intercept", "network:outbound"]);
    expect(parsedAuditErr.reasons).toEqual(["需要二次确认"]);

    // Modal markup check: role="alertdialog", SHA-256 / npm package, inline error visible inside modal, consent checkbox
    const modalHtml = renderToStaticMarkup(
      <PluginTrustAuditModal
        audit={opsUpgradeAudit}
        error="模拟下载超时：GitHub 与 Gitee 均不可达"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(modalHtml).toContain('role="alertdialog"');
    expect(modalHtml).toContain("z-[80]");
    expect(modalHtml).toContain("top-0 right-0 bottom-[var(--pmx-status-bar-height,20px)] left-0");
    expect(modalHtml).toContain("pmx-plugin-overlay-surface");
    expect(modalHtml).toContain("升级前信任审计确认");
    expect(modalHtml).toContain("v0.1.0-alpha.3 → v0.2.0");
    expect(modalHtml).toContain("54c90bdb7d09d4472145c70aaa8b463028e9dce6ed953aa8c31e1f4aca782265");
    expect(modalHtml).toContain('data-testid="plugin-trust-audit-error"');
    expect(modalHtml).toContain("模拟下载超时：GitHub 与 Gitee 均不可达");
    expect(modalHtml).toContain('type="checkbox"');
    expect(modalHtml).toContain("请先勾选上方风险确认框以启用放行按钮");
    expect(modalHtml).toContain("确认信任并升级");
  });
});

describe("Plugin Detail Drawer & Plugin Center View rendering", () => {
  it("renders detail drawer with contributions, DeclarativeGlassRenderer, runtime logs, rollback, and safe uninstall", () => {
    const items = mergePluginCenterItems(
      makeOfficialCatalogFixture(),
      makeCommunityInstalledFixture(),
    );
    const qqPlugin: PluginCenterItem = items.find((item) => item.id === "qq")!;

    const drawerHtml = renderToStaticMarkup(
      <PluginDetailDrawer
        plugin={qqPlugin}
        logs={[
          {
            id: "log-1",
            timestamp: 1763800000000,
            level: "info",
            source: "cordis-host",
            message: "Mounted qq declarative bridge panel.",
          },
        ]}
        busyKey={null}
        onClose={() => undefined}
        onInstallOrUpgrade={() => undefined}
        onToggle={() => undefined}
        onRollback={() => undefined}
        onUninstall={() => undefined}
        onRefreshLogs={() => undefined}
        onClearLogs={() => undefined}
        onDeclarativeAction={() => undefined}
        onDeclarativeAtomChange={() => undefined}
      />,
    );

    expect(drawerHtml).toContain('role="dialog"');
    expect(drawerHtml).toContain("z-[70]");
    expect(drawerHtml).toContain("top-0 right-0 bottom-[var(--pmx-status-bar-height,20px)] left-0");
    expect(drawerHtml).toContain("pmx-plugin-overlay-surface");
    expect(drawerHtml).toContain('aria-label="关闭插件详情抽屉"');
    expect(drawerHtml).toContain("distribution: managed");
    expect(drawerHtml).toContain("能力贡献清单");
    expect(drawerHtml).toContain("qq-bridge-console");
    expect(drawerHtml).toContain("POST /plugins/qq/onebot/webhook");
    expect(drawerHtml).toContain('data-pmx-declarative-ui="components"');
    expect(drawerHtml).toContain("运行日志查看器");
    expect(drawerHtml).toContain("复制日志");
    expect(drawerHtml).toContain("Mounted qq declarative bridge panel.");
    expect(drawerHtml).toContain("一键回滚至 v0.1.0-alpha.2");
    expect(drawerHtml).toContain("安全卸载");

    // Dedicated rollback confirmation dialog (Cancel-focused security dialog)
    const rollbackHtml = renderToStaticMarkup(
      <PluginRollbackDialog
        plugin={qqPlugin}
        error="模拟回滚网络超时"
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(rollbackHtml).toContain('role="alertdialog"');
    expect(rollbackHtml).toContain("z-[80]");
    expect(rollbackHtml).toContain("pmx-plugin-overlay-surface");
    expect(rollbackHtml).toContain("v0.1.0-alpha.3 → v0.1.0-alpha.2");
    expect(rollbackHtml).toContain("确认回滚至 v0.1.0-alpha.2");
    expect(rollbackHtml).toContain("模拟回滚网络超时");
  });

  it("renders redesigned PrismuxPluginCenterView with unified settings glass, zero-preinstall banner, no featured/retired bloat, dynamic non-zero categories, and creator guide CTA", () => {
    const noopDaemon = {
      requestJson: async <T,>(): Promise<T> => ({ ok: true, plugins: [] }) as T,
    };

    // Case 1: Mixed official + community plugins (communication=2, theme=1, tools=1; pet=0, ops=0)
    const mixedHtml = renderToStaticMarkup(
      <PrismuxPluginCenterView
        daemon={noopDaemon}
        daemonReady={true}
        initialCatalog={makeOfficialCatalogFixture()}
        initialInstalled={makeCommunityInstalledFixture()}
        initialRetired={DEFAULT_RETIRED_OFFICIAL_PLUGINS}
        skipInitialFetch={true}
      />,
    );

    // Zero-preinstall mandatory banner (2 active official plugins) + unified SettingsGroup glass
    expect(mixedHtml).toContain("两大官方插件默认零预装声明");
    expect(mixedHtml).toContain("fishdock-hook");
    expect(mixedHtml).toContain('data-slot="settings-group"');
    expect(mixedHtml).toContain("bg-card/40");
    expect(mixedHtml).not.toContain("bg-card/80");
    expect(mixedHtml).not.toContain("bg-card/85");

    // Redundant Featured Recommendations & bottom Retired Plugins cards are completely removed from UI
    expect(mixedHtml).not.toContain('data-testid="plugin-featured-section"');
    expect(mixedHtml).not.toContain("精选推荐");
    expect(mixedHtml).not.toContain('data-testid="plugin-retired-section"');
    expect(mixedHtml).not.toContain('data-testid="plugin-retired-pet"');
    expect(mixedHtml).not.toContain('data-testid="plugin-retired-ssh"');
    expect(mixedHtml).not.toContain("已停用插件说明");
    expect(mixedHtml).not.toContain('data-testid="plugin-card-pet"');
    expect(mixedHtml).not.toContain('data-testid="plugin-card-ssh"');

    // Four-state segmented tabs with live counts
    expect(mixedHtml).toContain('data-slot="toggle-group"');
    expect(mixedHtml).toContain('data-testid="plugin-tab-all"');
    expect(mixedHtml).toContain("已安装 (3)");
    expect(mixedHtml).toContain('data-testid="plugin-tab-available"');
    expect(mixedHtml).toContain("有更新 (1)");

    // Instant search & dynamic category chips (ONLY count > 0 categories shown; ZERO empty "0" chips!)
    expect(mixedHtml).toContain('data-testid="plugin-search-input"');
    for (const nonZeroCat of ["all", "communication", "theme", "tools"]) {
      expect(mixedHtml).toContain(`data-testid="plugin-category-${nonZeroCat}"`);
    }
    expect(mixedHtml).not.toContain('data-testid="plugin-category-pet"');
    expect(mixedHtml).not.toContain('data-testid="plugin-category-ops"');

    // Scriptless npm import, local .wb-plugin import, single-source registry selector & Creator Guide button
    expect(mixedHtml).toContain("社区 npm 插件流式导入");
    expect(mixedHtml).toContain('data-testid="plugin-registry-select"');
    expect(mixedHtml).toContain('data-testid="plugin-creator-guide-btn"');
    expect(mixedHtml).toContain("创作指引");
    expect(mixedHtml).toContain('data-testid="plugin-local-archive-btn"');
    expect(mixedHtml).toContain("导入本地 .wb-plugin");
    expect(mixedHtml).toContain("免 Git 依赖");
    expect(mixedHtml).toContain("禁用安装脚本");

    // Denoised user-facing copy (zero raw internal jargon on the main Plugin Center page)
    expect(mixedHtml).not.toContain("ctx.effect()");
    expect(mixedHtml).not.toContain("0600");
    expect(mixedHtml).not.toContain("distribution: managed");
    expect(mixedHtml).not.toContain("0 Token");

    // Single-source Daemon pluginRegistryOverride helpers
    expect(pluginRegistryOverrideToNetworkPreference("auto")).toBe("auto");
    expect(pluginRegistryOverrideToNetworkPreference("npmmirror")).toBe("domestic");
    expect(pluginRegistryOverrideToNetworkPreference("npmjs")).toBe("global");
    expect(
      parsePluginRegistryOverrideFromUpdaterStatus({
        policy: { pluginRegistryOverride: "npmmirror" },
      }),
    ).toBe("npmmirror");
    expect(
      parsePluginRegistryOverrideFromUpdaterStatus({
        policy: { pluginRegistryOverride: "npmjs" },
      }),
    ).toBe("npmjs");
    expect(parsePluginRegistryOverrideFromUpdaterStatus({ policy: {} })).toBe("auto");
    expect(parsePluginRegistryOverrideFromUpdaterStatus(null)).toBe("auto");

    // Case 2: Official catalog only (all plugins in communication; <= 1 non-zero category)
    // Secondary category strip is completely hidden — zero empty "桌宠 0 / 运维 0 / 主题 0 / 工具 0" labels!
    const officialOnlyHtml = renderToStaticMarkup(
      <PrismuxPluginCenterView
        daemon={noopDaemon}
        daemonReady={true}
        initialCatalog={makeOfficialCatalogFixture()}
        initialInstalled={[]}
        skipInitialFetch={true}
      />,
    );
    expect(officialOnlyHtml).not.toContain('data-testid="plugin-category-');
    expect(officialOnlyHtml).toContain('data-testid="plugin-card-qq"');
    expect(officialOnlyHtml).toContain('data-testid="plugin-card-fishdock-hook"');
  });

  it("renders PluginCreatorGuideModal with both official doc links and builds Agent prompt with placeholder or custom requirement", () => {
    // Closed modal renders nothing
    expect(
      renderToStaticMarkup(<PluginCreatorGuideModal open={false} onClose={() => undefined} />),
    ).toBe("");

    // Default prompt (empty user requirement) embeds docs, contracts, exact 6 hooks, theme tokens & placeholder block
    const defaultPrompt = buildPluginCreatorAgentPrompt("");
    expect(defaultPrompt).toContain(PLUGIN_DEVELOPMENT_GUIDE_URL);
    expect(defaultPrompt).toContain(PLUGIN_DEVELOPMENT_GUIDE_REPO_PATH);
    expect(defaultPrompt).toContain(PLUGIN_HOOKS_AND_THEME_URL);
    expect(defaultPrompt).toContain(PLUGIN_HOOKS_AND_THEME_REPO_PATH);
    expect(defaultPrompt).toContain("engines");
    expect(defaultPrompt).toContain("ctx.effect()");
    for (const hookName of [
      "SessionStart",
      "PreToolUse",
      "PostToolUse",
      "Notification",
      "SubagentStop",
      "Stop",
    ]) {
      expect(defaultPrompt).toContain(hookName);
    }
    expect(defaultPrompt).toContain("html[data-pmx-theme");
    expect(defaultPrompt).toContain("--pmx-");
    expect(defaultPrompt).toContain('ui: "components"');
    expect(defaultPrompt).toContain("pnpm plugin:pack");
    expect(defaultPrompt).toContain(PLUGIN_REQUIREMENT_PLACEHOLDER_BLOCK);

    // Custom user requirement replaces placeholder cleanly
    const customPrompt = buildPluginCreatorAgentPrompt("  做一个飞书通知插件，推送 Stop 摘要  ");
    expect(customPrompt).toContain("【我的插件创作需求】\n做一个飞书通知插件，推送 Stop 摘要");
    expect(customPrompt).not.toContain("请在此替换为你想实现的功能");

    // Open modal markup verification
    const modalHtml = renderToStaticMarkup(
      <PluginCreatorGuideModal
        open={true}
        initialRequirement="构建一个自定义 GitHub PR 提醒插件"
        onClose={() => undefined}
      />,
    );
    expect(modalHtml).toContain('role="dialog"');
    expect(modalHtml).toContain('aria-modal="true"');
    expect(modalHtml).toContain('data-pmx-glass-zone="overlays"');
    expect(modalHtml).toContain("dialog-glass");
    expect(modalHtml).toContain("Prismux 插件创作指引");
    expect(modalHtml).toContain('data-testid="plugin-doc-link-dev-guide"');
    expect(modalHtml).toContain('data-testid="plugin-doc-link-hooks-theme"');
    expect(modalHtml).toContain(PLUGIN_DEVELOPMENT_GUIDE_URL);
    expect(modalHtml).toContain(PLUGIN_HOOKS_AND_THEME_URL);
    expect(modalHtml).toContain(PLUGIN_DEVELOPMENT_GUIDE_REPO_PATH);
    expect(modalHtml).toContain(PLUGIN_HOOKS_AND_THEME_REPO_PATH);
    expect(modalHtml).toContain('data-testid="plugin-creator-requirement-input"');
    expect(modalHtml).toContain('data-testid="plugin-creator-prompt-preview"');
    expect(modalHtml).toContain("构建一个自定义 GitHub PR 提醒插件");
    expect(modalHtml).toContain('data-testid="plugin-creator-copy-btn"');
    expect(modalHtml).toContain("复制 Agent 提示词");
  });

  it("renders DeclarativeGlassRenderer across all 8 primitives while escaping XSS and blocking raw HTML/CSS/prototype pollution", () => {
    const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const validSpec: DeclarativeUiPanelSpec = {
      ui: "components",
      schemaVersion: 1,
      title: "液态玻璃声明式测试",
      atoms: [
        { key: "enabled", type: "boolean", defaultValue: true },
        { key: "url", type: "string", defaultValue: "https://prismux.local" },
      ],
      actions: [{ id: "save", label: "保存" }],
      root: {
        type: "Stack",
        direction: "column",
        gap: "sm",
        children: [
          {
            type: "Card",
            title: "安全卡片",
            children: [
              { type: "Text", content: xssPayload },
              { type: "Badge", label: "0 Token", variant: "info" },
              { type: "Switch", label: "启用开关", atomKey: "enabled" },
              { type: "Input", label: "接口地址", atomKey: "url", inputType: "url" },
              {
                type: "Button",
                label: "保存",
                actionId: "save",
                disabled: true,
                disabledReason: "演示禁用原因",
              },
            ],
          },
          {
            type: "Table",
            caption: "安全表格",
            columns: [{ key: "col", label: "值", sortable: true }],
            rows: [{ col: xssPayload }],
          },
        ],
      },
    };

    const html = renderToStaticMarkup(<DeclarativeGlassRenderer spec={validSpec} />);
    for (const primitive of ["Stack", "Card", "Text", "Badge", "Button", "Switch", "Input", "Table"]) {
      expect(html).toContain(`data-pmx-decl-node="${primitive}"`);
    }
    expect(html).toContain("pmx-decl-sort-btn");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("演示禁用原因");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");

    // Malicious injection & prototype pollution blocked with role="alert"
    const injectedHtml = renderToStaticMarkup(
      <DeclarativeGlassRenderer
        spec={{
          ui: "components",
          root: { type: "Card", title: "bad", dangerouslySetInnerHTML: { __html: "<svg/>" } },
        }}
      />,
    );
    expect(injectedHtml).toContain('role="alert"');
    expect(injectedHtml).toContain('data-pmx-decl-error="FORBIDDEN_INJECTION_KEY"');

    const protoHtml = renderToStaticMarkup(
      <DeclarativeGlassRenderer
        spec={JSON.parse(
          '{"ui":"components","root":{"type":"Text","content":"ok","__proto__":{"pwn":true}}}',
        )}
      />,
    );
    expect(protoHtml).toContain('role="alert"');
    expect(protoHtml).toContain('data-pmx-decl-error="PROTOTYPE_POLLUTION_KEY"');
  });
});
