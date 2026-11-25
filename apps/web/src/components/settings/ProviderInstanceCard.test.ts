import { RegistryContext } from "@effect/atom-react";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  IsoDateTime,
  ProviderDriverKind,
  ProviderInstanceId,
  SecretProviderId,
  type ServerProvider,
  type ServerProviderModel,
} from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import {
  ProviderInstanceCard,
  deriveProviderModelsForDisplay,
  formatCompactProviderListStatus,
  nextProviderEnvironmentWithFieldSecret,
  nextProviderEnvironmentWithFieldValue,
} from "./ProviderInstanceCard";

describe("deriveProviderModelsForDisplay", () => {
  it("uses current config custom models instead of stale live custom rows", () => {
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "server-model",
        name: "Server Model",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "removed-custom",
        name: "Removed Custom",
        isCustom: true,
        capabilities: null,
      },
      {
        slug: "kept-custom",
        name: "Kept Custom",
        isCustom: true,
        capabilities: null,
      },
    ];

    expect(
      deriveProviderModelsForDisplay({
        liveModels,
        customModels: [{ slug: "kept-custom", name: "kept-custom", capabilities: null }],
      }).map((model) => model.slug),
    ).toEqual(["server-model", "kept-custom"]);
  });
});

describe("provider environment helpers", () => {
  const cursorApiKeyField = {
    name: "CURSOR_API_KEY",
    label: "Cursor API key",
    sensitive: true,
  };

  it("writes dedicated provider secrets as sensitive environment variables", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [{ name: "EXTRA_FLAG", value: "1", sensitive: false }],
        cursorApiKeyField,
        "  cursor-key  ",
      ),
    ).toEqual([
      { name: "EXTRA_FLAG", value: "1", sensitive: false },
      { name: "CURSOR_API_KEY", value: "cursor-key", sensitive: true },
    ]);
  });

  it("replaces redacted provider secrets without preserving redaction markers", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [
          {
            name: "CURSOR_API_KEY",
            value: "",
            sensitive: true,
            valueRedacted: true,
          },
        ],
        cursorApiKeyField,
        "new-key",
      ),
    ).toEqual([{ name: "CURSOR_API_KEY", value: "new-key", sensitive: true }]);
  });

  it("points a stored provider secret at a secret provider and drops the stored value", () => {
    const secret = {
      provider: SecretProviderId.make("personal"),
      reference: "op://Private/Cursor/credential",
    };
    const stored = [{ name: "CURSOR_API_KEY", value: "", sensitive: true, valueRedacted: true }];
    const referenced = nextProviderEnvironmentWithFieldSecret(stored, cursorApiKeyField, secret);

    expect(referenced).toEqual([{ name: "CURSOR_API_KEY", value: secret, sensitive: true }]);
    expect(
      nextProviderEnvironmentWithFieldSecret(referenced, cursorApiKeyField, undefined),
    ).toEqual([]);
  });

  it("applies the secure field default when replacing an existing non-sensitive value", () => {
    expect(
      nextProviderEnvironmentWithFieldValue(
        [{ name: "OPENAI_API_KEY", value: "old-key", sensitive: false }],
        {
          name: "OPENAI_API_KEY",
          label: "OpenAI API key",
        },
        "new-key",
      ),
    ).toEqual([{ name: "OPENAI_API_KEY", value: "new-key", sensitive: true }]);
  });
});

describe("ProviderInstanceCard dual-entry deletion controls", () => {
  const antigravityId = ProviderInstanceId.make("antigravity");
  const antigravityDriver = ProviderDriverKind.make("antigravity");

  beforeAll(() => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
  });

  const renderCard = (overrides: Partial<Parameters<typeof ProviderInstanceCard>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(
        RegistryContext.Provider,
        { value: appAtomRegistry },
        createElement(
          GTProvider,
          { locale: "en", translations: {} },
          createElement(ProviderInstanceCard, {
            instanceId: antigravityId,
            instance: {
              driver: antigravityDriver,
              displayName: "Antigravity CLI",
              enabled: true,
            },
            driverOption: undefined,
            liveProvider: undefined,
            mode: "list",
            selected: true,
            showDeleteSlot: true,
            removalKind: "delete-optional",
            onUpdate: async () => true,
            onDelete: () => {},
            onLaunchModeChange: () => {},
            launchMode: "chat",
            hiddenModels: [],
            favoriteModels: [],
            modelOrder: [],
            onHiddenModelsChange: () => {},
            onFavoriteModelsChange: () => {},
            onToggleFavorite: () => {},
            onModelOrderChange: () => {},
            ...overrides,
          }),
        ),
      ),
    );

  it("keeps list rows uncluttered with only the enable switch (launch mode and delete live in detail pane)", () => {
    const html = renderCard({ mode: "list" });
    expect(html).toContain('data-provider-list-row="antigravity"');
    expect(html).toContain('aria-label="Enable Antigravity CLI"');
    expect(html).not.toContain('data-provider-mode-toggle="antigravity"');
    expect(html).not.toContain('data-provider-delete-list="antigravity"');
  });

  it("renders Danger zone delete button in editor mode and hides it when readOnly", () => {
    const editableHtml = renderCard({ mode: "editor", readOnly: false });
    expect(editableHtml).toContain("Danger zone");
    expect(editableHtml).toContain('data-provider-delete-detail="antigravity"');
    expect(editableHtml).toContain("Delete provider configuration");

    const readOnlyHtml = renderCard({ mode: "editor", readOnly: true });
    expect(readOnlyHtml).not.toContain('data-provider-delete-detail="antigravity"');
  });

  it("renders high-contrast active highlight for Chat and CLI modes in the editor detail panel", () => {
    const chatHtml = renderCard({ mode: "editor", launchMode: "chat" });
    const chatActiveButton = chatHtml.match(/<button[^>]*data-launch-mode="chat"[^>]*>/)?.[0] ?? "";
    const cliInactiveButton = chatHtml.match(/<button[^>]*data-launch-mode="cli"[^>]*>/)?.[0] ?? "";
    expect(chatActiveButton).toContain('data-active="true"');
    expect(chatActiveButton).toContain('aria-checked="true"');
    expect(chatActiveButton).toContain("bg-primary");
    expect(chatActiveButton).toContain("text-primary-foreground");
    expect(chatActiveButton).toContain("font-semibold");
    expect(chatActiveButton).not.toContain("bg-background");
    expect(cliInactiveButton).toContain('data-active="false"');
    expect(cliInactiveButton).toContain("bg-transparent");
    expect(cliInactiveButton).not.toContain("bg-primary");

    const cliHtml = renderCard({ mode: "editor", launchMode: "cli" });
    const chatInactiveButton = cliHtml.match(/<button[^>]*data-launch-mode="chat"[^>]*>/)?.[0] ?? "";
    const cliActiveButton = cliHtml.match(/<button[^>]*data-launch-mode="cli"[^>]*>/)?.[0] ?? "";
    expect(cliActiveButton).toContain('data-active="true"');
    expect(cliActiveButton).toContain('aria-checked="true"');
    expect(cliActiveButton).toContain("bg-primary");
    expect(cliActiveButton).toContain("text-primary-foreground");
    expect(cliActiveButton).toContain("font-semibold");
    expect(cliActiveButton).not.toContain("bg-background");
    expect(chatInactiveButton).toContain('data-active="false"');
    expect(chatInactiveButton).toContain("bg-transparent");
    expect(chatInactiveButton).not.toContain("bg-primary");
  });

  it("mounts ProviderCliVersionBadge in the editor header for live CLI versions", () => {
    const codexId = ProviderInstanceId.make("codex");
    const codexDriver = ProviderDriverKind.make("codex");
    const liveProvider: ServerProvider = {
      instanceId: codexId,
      driver: codexDriver,
      displayName: "Codex",
      enabled: true,
      installed: true,
      version: "0.172.0",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: IsoDateTime.make("2026-11-24T00:00:00.000Z"),
      models: [],
      slashCommands: [],
      skills: [],
    };

    const editorHtml = renderCard({
      mode: "editor",
      instanceId: codexId,
      instance: { driver: codexDriver, displayName: "Codex", enabled: true },
      liveProvider,
      readOnly: false,
    });
    expect(editorHtml).toContain('data-cli-version-badge="codex"');
    expect(editorHtml).toContain('data-cli-version-state="latest"');
    expect(editorHtml).toContain("v0.172.0");

    const readOnlyHtml = renderCard({
      mode: "editor",
      instanceId: codexId,
      instance: { driver: codexDriver, displayName: "Codex", enabled: true },
      liveProvider,
      readOnly: true,
    });
    expect(readOnlyHtml).toContain('data-cli-version-badge="codex"');
    expect(readOnlyHtml).toContain('data-cli-version-state="readonly"');
    expect(readOnlyHtml).toContain("v0.172.0");
  });

  it("renders pure DeepSeek whale icon without DH initials badge even when legacy accentColor is stored", () => {
    const dshId = ProviderInstanceId.make("dsh");
    const acpDriver = ProviderDriverKind.make("acpRegistry");
    for (const mode of ["list", "editor"] as const) {
      const html = renderCard({
        mode,
        instanceId: dshId,
        instance: {
          driver: acpDriver,
          displayName: "DeepSeek Harness (dsh)",
          accentColor: "#4176E6",
          enabled: true,
          config: { source: "local", commandPath: "dsh", commandArgs: ["acp"] },
        },
      });
      expect(html).toContain('data-dsh-brand-icon="true"');
      expect(html).not.toContain(">DH<");
    }

    // Direct ProviderInstanceIcon check (Sidebar / Model Picker path)
    const iconHtml = renderToStaticMarkup(
      createElement(ProviderInstanceIcon, {
        driverKind: acpDriver,
        instanceId: dshId,
        displayName: "DeepSeek Harness (dsh)",
        accentColor: "#4176E6",
        showBadge: true,
      }),
    );
    expect(iconHtml).toContain('data-dsh-brand-icon="true"');
    expect(iconHtml).not.toContain(">DH<");
  });

  it("aligns provider list rows on horizontal midline with subtle single-line compact status", () => {
    expect(formatCompactProviderListStatus("已认证 · Local agy CLI · Google AI Ultra")).toBe(
      "已认证 · agy CLI · Ultra",
    );
    expect(formatCompactProviderListStatus("Authenticated · Local agy CLI · Google AI Pro")).toBe(
      "Authenticated · agy CLI · Pro",
    );
    expect(formatCompactProviderListStatus("可用")).toBe("可用");

    const listHtml = renderCard({
      mode: "list",
      liveProvider: {
        instanceId: antigravityId,
        driver: antigravityDriver,
        displayName: "Antigravity",
        enabled: true,
        installed: true,
        version: "1.5.17",
        status: "ready",
        auth: { status: "authenticated", label: "Local agy CLI · Google AI Ultra" },
        checkedAt: IsoDateTime.make("2026-11-24T00:00:00.000Z"),
        models: [],
        slashCommands: [],
        skills: [],
      },
    });
    expect(listHtml).toContain('data-provider-icon-slot="list"');
    expect(listHtml).toContain("items-center gap-2.5");
    expect(listHtml).not.toContain("items-start gap-3");
    expect(listHtml).toContain('data-provider-list-status="true"');
    expect(listHtml).toContain("text-2xs font-normal leading-snug text-muted-foreground/65");
    expect(listHtml).toContain("truncate whitespace-nowrap");
    expect(listHtml).not.toContain("line-clamp-2");
    expect(listHtml).toContain("agy CLI · Ultra");
  });

  it("renders redesigned detail header, swatch color picker, basic/connection cards, and collapsible Advanced", () => {
    const editorHtml = renderCard({
      mode: "editor",
      onRefresh: () => {},
      liveProvider: {
        instanceId: antigravityId,
        driver: antigravityDriver,
        displayName: "Antigravity",
        enabled: true,
        installed: true,
        version: "1.5.17",
        status: "ready",
        auth: { status: "authenticated", label: "Local agy CLI · Google AI Ultra" },
        checkedAt: IsoDateTime.make("2026-11-24T00:00:00.000Z"),
        models: [],
        slashCommands: [],
        skills: [],
      },
    });
    expect(editorHtml).toContain('data-provider-detail-header="antigravity"');
    expect(editorHtml).toContain('data-provider-icon-slot="editor"');
    expect(editorHtml).toContain('aria-label="Refresh provider status"');
    expect(editorHtml).toContain('data-accent-color-swatch="true"');
    expect(editorHtml).toContain("Basic configuration");
    expect(editorHtml).toContain("Connection &amp; runtime");
    expect(editorHtml).toContain('data-provider-advanced-toggle="antigravity"');
    expect(editorHtml).not.toContain(">Status</h3>");
    expect(editorHtml).toContain("Choose whether new sessions open in Chat or CLI mode.");
  });
});
