import {
  AuthProvidersManageScope,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { getTranslationsSnapshot, initializeGT, msg } from "gt-react";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../i18n/locales";
import { m, setActiveLocale } from "../../i18n/messages";
import zhCatalog from "../../i18n/translations/zh.json";
import {
  buildProviderInstanceOverridePatch,
  buildProviderInstanceRows,
  buildProviderRemovalMutation,
  canDeleteProviderRow,
  classifyProviderRemoval,
  extractAcpRegistryManagedAgentId,
  orderProviderInstanceRows,
  reorderProviderInstanceIds,
  resolveNextSelectedProviderInstanceId,
  resolveRemoteOperateAccess,
} from "./ProviderSettingsPanel.logic";
import { reorderModelsWithinGroup } from "./ProviderModelsSection";

describe("buildProviderInstanceOverridePatch", () => {
  const projectId = ProjectId.make("project-a");
  const instanceId = ProviderInstanceId.make("codex_work");

  it("writes the same choice to every checkout of the project", () => {
    const siblingId = ProjectId.make("project-a-worktree");
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [siblingId]: { newWorktreesStartFromOrigin: true },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId, siblingId], instanceId, false),
    ).toEqual({
      [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      [siblingId]: {
        newWorktreesStartFromOrigin: true,
        providerInstances: { [instanceId]: { enabled: false } },
      },
    });
  });

  it("resets the only override by clearing the whole project entry", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, undefined),
    ).toEqual({ [projectId]: null });
  });

  it("sends providerInstances: {} explicitly when clearing the last instance override leaves other keys", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: true } },
        },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, undefined),
    ).toEqual({
      [projectId]: { newWorktreesStartFromOrigin: true, providerInstances: {} },
    });
  });
});

describe("remote operate access", () => {
  it("does not treat the old orchestration grant as provider management", () => {
    expect(
      resolveRemoteOperateAccess({
        session: {
          authenticated: true,
          scopes: ["orchestration:operate"],
          auth: { serverUpdateScope: "environment:maintain" },
        },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });

  it("accepts the orchestration grant from a server that predates providers:manage", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:operate"], auth: {} },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
  });
  it("derives access from the environment session's granted scopes", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: [AuthProvidersManageScope] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:read"] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: false },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });
});

describe("provider configuration deletion logic", () => {
  const codexDriver = ProviderDriverKind.make("codex");
  const claudeDriver = ProviderDriverKind.make("claudeAgent");
  const antigravityDriver = ProviderDriverKind.make("antigravity");
  const acpDriver = ProviderDriverKind.make("acpRegistry");

  const codexId = ProviderInstanceId.make("codex");
  const claudeId = ProviderInstanceId.make("claudeAgent");
  const antigravityId = ProviderInstanceId.make("antigravity");
  const dshId = ProviderInstanceId.make("dsh");
  const codexWorkId = ProviderInstanceId.make("codex_work");

  const visibleProviderSettings = [
    { provider: codexDriver, hasDefaultInstance: true },
    { provider: claudeDriver, hasDefaultInstance: true },
    { provider: antigravityDriver, hasDefaultInstance: true },
    { provider: acpDriver, hasDefaultInstance: false },
  ] as const;

  it("classifies deletability and removal kind across built-in, optional, and custom providers", () => {
    expect(classifyProviderRemoval({ isDefault: true, isCoreDefault: true })).toBe(
      "remove-builtin",
    );
    expect(classifyProviderRemoval({ isDefault: true, isCoreDefault: false })).toBe(
      "delete-optional",
    );
    expect(classifyProviderRemoval({ isDefault: false, isCoreDefault: false })).toBe(
      "delete-custom",
    );

    expect(
      canDeleteProviderRow({ explicitInstance: undefined, isCoreDefault: true, readOnly: false }),
    ).toBe(true);
    expect(
      canDeleteProviderRow({
        explicitInstance: { driver: antigravityDriver, enabled: true },
        isCoreDefault: false,
        readOnly: false,
      }),
    ).toBe(true);
    expect(
      canDeleteProviderRow({ explicitInstance: undefined, isCoreDefault: false, readOnly: false }),
    ).toBe(false);
    expect(
      canDeleteProviderRow({
        explicitInstance: { driver: codexDriver, enabled: true },
        isCoreDefault: true,
        readOnly: true,
      }),
    ).toBe(false);
  });

  it("builds visible rows, hides deleted optional/built-in providers permanently, and restores on re-add", () => {
    const withAntigravityAndDsh = buildProviderInstanceRows({
      visibleProviderSettings,
      providerInstances: {
        [antigravityId]: {
          driver: antigravityDriver,
          displayName: "Antigravity CLI",
          enabled: true,
        },
        [dshId]: {
          driver: acpDriver,
          displayName: "DeepSeek Harness (dsh)",
          enabled: true,
          config: { source: "local", commandPath: "dsh", commandArgs: ["acp"] },
        },
      },
      hiddenDefaultProviderInstances: [],
    });

    expect(withAntigravityAndDsh.map((row) => [row.instanceId, row.removalKind])).toEqual([
      [codexId, "remove-builtin"],
      [claudeId, "remove-builtin"],
      [antigravityId, "delete-optional"],
      [dshId, "delete-custom"],
    ]);

    // After deleting Antigravity CLI (removed from providerInstances) and Codex (recorded in hiddenDefaultProviderInstances):
    const afterDeletes = buildProviderInstanceRows({
      visibleProviderSettings,
      providerInstances: {
        [dshId]: {
          driver: acpDriver,
          displayName: "DeepSeek Harness (dsh)",
          enabled: true,
          config: { source: "local", commandPath: "dsh", commandArgs: ["acp"] },
        },
      },
      hiddenDefaultProviderInstances: [codexId],
    });

    expect(afterDeletes.map((row) => row.instanceId)).toEqual([claudeId, dshId]);

    // Deep-linked targetInstanceId does not keep a dismissed default-off provider in the list.
    const afterDeepLinkDelete = buildProviderInstanceRows({
      visibleProviderSettings,
      providerInstances: {},
      hiddenDefaultProviderInstances: [],
      targetInstanceId: antigravityId,
      dismissedInstanceIds: new Set([antigravityId]),
    });
    expect(afterDeepLinkDelete.map((row) => row.instanceId)).toEqual([codexId, claudeId]);

    // Re-adding Codex restores it even if a stale snapshot still mentioned it in hiddenDefaultProviderInstances.
    const afterReAdd = buildProviderInstanceRows({
      visibleProviderSettings,
      providerInstances: {
        [codexId]: { driver: codexDriver, displayName: "Codex", enabled: true },
      },
      hiddenDefaultProviderInstances: [codexId],
    });
    expect(afterReAdd.map((row) => row.instanceId)).toEqual([codexId, claudeId]);
  });

  it("falls back selection cleanly when deleting selected, trailing, unselected, or final rows", () => {
    const rows = [
      { instanceId: codexId },
      { instanceId: claudeId },
      { instanceId: antigravityId },
    ];

    // Deleting middle selected item advances to the next item.
    expect(resolveNextSelectedProviderInstanceId(rows, claudeId, claudeId)).toBe(antigravityId);
    // Deleting the last selected item falls back to the previous item.
    expect(resolveNextSelectedProviderInstanceId(rows, antigravityId, antigravityId)).toBe(
      claudeId,
    );
    // Deleting a non-selected item preserves the current selection.
    expect(resolveNextSelectedProviderInstanceId(rows, antigravityId, codexId)).toBe(codexId);
    // Deleting the only remaining item returns null (empty state).
    expect(resolveNextSelectedProviderInstanceId([{ instanceId: codexId }], codexId, codexId)).toBe(
      null,
    );
  });

  it("builds server mutations with hideDefault only for core built-in removals", () => {
    expect(
      buildProviderRemovalMutation({ instanceId: codexId, removalKind: "remove-builtin" }),
    ).toEqual({ operation: "remove", instanceId: codexId, hideDefault: true });

    expect(
      buildProviderRemovalMutation({ instanceId: antigravityId, removalKind: "delete-optional" }),
    ).toEqual({ operation: "remove", instanceId: antigravityId });

    expect(
      buildProviderRemovalMutation({ instanceId: codexWorkId, removalKind: "delete-custom" }),
    ).toEqual({ operation: "remove", instanceId: codexWorkId });
  });

  it("detects managed ACP registry binaries while skipping local ACP commands", () => {
    expect(
      extractAcpRegistryManagedAgentId({
        driver: acpDriver,
        config: { agentId: "devin", distribution: "auto" },
      }),
    ).toBe("devin");

    expect(
      extractAcpRegistryManagedAgentId({
        driver: acpDriver,
        config: { source: "local", commandPath: "dsh", agentId: "dsh" },
      }),
    ).toBeNull();

    expect(
      extractAcpRegistryManagedAgentId({
        driver: antigravityDriver,
        config: { authMethod: "local-cli" },
      }),
    ).toBeNull();
  });

  it("orders provider rows by saved providerOrder and computes drag-reorder permutations", () => {
    const ordered = buildProviderInstanceRows({
      visibleProviderSettings,
      providerInstances: {
        [antigravityId]: {
          driver: antigravityDriver,
          displayName: "Antigravity CLI",
          enabled: true,
        },
        [dshId]: {
          driver: acpDriver,
          displayName: "DeepSeek Harness (dsh)",
          enabled: true,
          config: { source: "local", commandPath: "dsh", commandArgs: ["acp"] },
        },
      },
      hiddenDefaultProviderInstances: [],
      providerOrder: [dshId, claudeId],
    });
    expect(ordered.map((row) => row.instanceId)).toEqual([dshId, claudeId, codexId, antigravityId]);

    expect(
      reorderProviderInstanceIds([codexId, claudeId, antigravityId, dshId], dshId, claudeId),
    ).toEqual([codexId, dshId, claudeId, antigravityId]);
    expect(reorderProviderInstanceIds([codexId, claudeId], codexId, codexId)).toBeNull();
    expect(
      orderProviderInstanceRows(
        [{ instanceId: codexId }, { instanceId: claudeId }],
        [claudeId, codexId],
      ).map((row) => row.instanceId),
    ).toEqual([claudeId, codexId]);
  });

  it("reorders models smoothly within the same display group while preventing cross-group drops", () => {
    const models = [
      { slug: "fav-a" },
      { slug: "fav-b" },
      { slug: "vis-a" },
      { slug: "vis-b" },
      { slug: "vis-c" },
      { slug: "hid-a" },
    ];
    const groupOf = (slug: string) =>
      slug.startsWith("fav-") ? "favorite" : slug.startsWith("hid-") ? "hidden" : "visible";

    expect(reorderModelsWithinGroup(models, groupOf, "vis-c", "vis-a")).toEqual([
      "fav-a",
      "fav-b",
      "vis-c",
      "vis-a",
      "vis-b",
      "hid-a",
    ]);
    expect(reorderModelsWithinGroup(models, groupOf, "fav-b", "fav-a")).toEqual([
      "fav-b",
      "fav-a",
      "vis-a",
      "vis-b",
      "vis-c",
      "hid-a",
    ]);
    // Cross-group and hidden drags are rejected cleanly.
    expect(reorderModelsWithinGroup(models, groupOf, "vis-a", "fav-a")).toBeNull();
    expect(reorderModelsWithinGroup(models, groupOf, "hid-a", "vis-c")).toBeNull();
  });
});

describe("provider configuration deletion zh-CN i18n copy", () => {
  beforeAll(async () => {
    await initializeGT({
      defaultLocale: DEFAULT_LOCALE,
      locales: [...SUPPORTED_LOCALES],
      loadTranslations: async (locale) => (locale === "zh" ? zhCatalog : {}),
      cacheExpiryTime: null,
    });
    await getTranslationsSnapshot("zh");
    setActiveLocale("zh");
  });

  afterAll(() => {
    setActiveLocale(DEFAULT_LOCALE);
  });

  it("resolves all provider deletion UI strings cleanly in Simplified Chinese", () => {
    expect(m(msg("Delete provider configuration"))).toBe("删除提供方配置");
    expect(m(msg("Delete {provider} configuration"), { provider: "Antigravity CLI" })).toBe(
      "删除 Antigravity CLI 配置",
    );
    expect(m(msg("Delete provider configuration?"))).toBe("确认删除提供方配置？");
    expect(m(msg("Instance ID: {instanceId}"), { instanceId: "antigravity" })).toBe(
      "实例 ID：antigravity",
    );
    expect(m(msg("Confirm delete"))).toBe("确认删除");
    expect(m(msg("Deleting..."))).toBe("正在删除…");
    expect(m(msg("Danger zone"))).toBe("危险操作");
    expect(m(msg("Could not delete provider configuration"))).toBe("无法删除提供方配置");
    expect(m(msg("Provider configuration deleted"))).toBe("已删除提供方配置");
    expect(
      m(msg("{provider} ({instanceId}) has been removed."), {
        provider: "Antigravity CLI",
        instanceId: "antigravity",
      }),
    ).toBe("已移除 Antigravity CLI（antigravity）。");
    expect(
      m(
        msg(
          'Deleting this configuration will remove its connection and model settings. Existing conversation history will be preserved, and you can add it again anytime via "+ Add provider".',
        ),
      ),
    ).toBe(
      "删除后将移除该提供方的连接与模型配置（已有历史会话记录保留，可随时通过「+ 添加提供方」重新添加）。",
    );
  });
});
