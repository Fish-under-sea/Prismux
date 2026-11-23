import { RegistryContext } from "@effect/atom-react";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  SecretProviderId,
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
});
