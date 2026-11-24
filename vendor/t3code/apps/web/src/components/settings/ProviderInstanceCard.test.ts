import { RegistryContext } from "@effect/atom-react";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  IsoDateTime,
  ProviderDriverKind,
  ProviderInstanceId,
  SecretProviderId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import {
  ProviderInstanceCard,
  deriveProviderModelsForDisplay,
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

  it("renders aligned list delete button alongside Chat/CLI toggle and enable switch", () => {
    const html = renderCard({ mode: "list" });
    expect(html).toContain('data-provider-mode-toggle="antigravity"');
    expect(html).toContain('data-provider-delete-list="antigravity"');
    expect(html).toContain('aria-label="Delete Antigravity CLI configuration"');
  });

  it("renders Danger zone delete button in editor mode and hides it when readOnly", () => {
    const editableHtml = renderCard({ mode: "editor", readOnly: false });
    expect(editableHtml).toContain("Danger zone");
    expect(editableHtml).toContain('data-provider-delete-detail="antigravity"');
    expect(editableHtml).toContain("Delete provider configuration");

    const readOnlyHtml = renderCard({ mode: "editor", readOnly: true });
    expect(readOnlyHtml).not.toContain('data-provider-delete-detail="antigravity"');
  });

  it("renders high-contrast active highlight for Chat and CLI modes in both list and editor views", () => {
    for (const mode of ["list", "editor"] as const) {
      const chatHtml = renderCard({ mode, launchMode: "chat" });
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

      const cliHtml = renderCard({ mode, launchMode: "cli" });
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
    }
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
});
