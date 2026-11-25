import {
  EnvironmentId,
  ProviderDriverKind,
  UsageLimitSourceId,
  type UnifiedSettings,
  type UsageLimitSourceSnapshot,
} from "@prismux/core-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mockState = vi.hoisted(() => ({
  locale: "zh-CN",
  snapshots: undefined as ReadonlyArray<UsageLimitSourceSnapshot> | undefined,
  updateSettings: vi.fn(),
}));

vi.mock("gt-react", async (original) => ({
  ...(await original()),
  useLocale: () => mockState.locale,
  useGT: () => (text: string) => text,
  useMessages: () => (text: string) => text,
}));

vi.mock("@effect/atom-react", async (original) => ({
  ...(await original()),
  useAtomValue: (_atom: unknown, select?: (value: unknown) => unknown) => {
    const config = { usageLimitSources: mockState.snapshots };
    return select ? select(config) : config;
  },
}));

vi.mock("../../hooks/useSettings", () => ({
  usePrimarySettingsAvailable: () => true,
  PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE: "",
  useUpdateEnvironmentSettings: () => mockState.updateSettings,
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("local"),
  usePrimaryEnvironment: () => ({ label: "本机" }),
}));

vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set(),
}));

vi.mock("../../state/entities", () => ({
  useServerConfigs: () => new Map(),
}));

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    configValueAtom: () => ({}),
  },
}));

vi.mock("./useScopedSettings", () => ({
  useClearScopedSettings: () => vi.fn(),
  useClearProjectOverrides: () => vi.fn(),
}));

vi.mock("./SecretSourceInput", () => ({
  SecretSourceInput: () => null,
  useSecretSources: () => [],
}));

import { UsageProviderSettings } from "./UsageProviderSettings";

describe("UsageProviderSettings", () => {
  afterEach(() => {
    mockState.locale = "zh-CN";
    mockState.snapshots = undefined;
    mockState.updateSettings.mockReset();
  });

  it("renders Chinese empty state with the Add relay button inside the card (not headerAction)", () => {
    const html = renderToStaticMarkup(
      <UsageProviderSettings
        environmentId={EnvironmentId.make("local")}
        environmentLabel="本机"
        sources={{}}
        readOnly={false}
      />,
    );

    expect(html).toContain('id="usage-providers"');
    expect(html).toContain("API 中转站配额");
    expect(html).toContain("尚未配置 API 中转站");
    expect(html).toContain("New API");
    expect(html).toContain("添加中转站");
    // Ensure the button sits inside settings-group (card), not floating in headerAction above it.
    const groupStart = html.indexOf('data-slot="settings-group"');
    const buttonIndex = html.indexOf("添加中转站");
    expect(groupStart).toBeGreaterThan(-1);
    expect(buttonIndex).toBeGreaterThan(groupStart);
    expect(html).not.toContain("hub.example.ts.net");
  });

  it("renders English copy cleanly when locale is en-US", () => {
    mockState.locale = "en-US";
    const html = renderToStaticMarkup(
      <UsageProviderSettings
        environmentId={EnvironmentId.make("local")}
        environmentLabel="Local"
        sources={{}}
        readOnly={false}
      />,
    );

    expect(html).toContain("API Relay Quotas");
    expect(html).toContain("No API relays configured");
    expect(html).toContain("Add relay");
  });

  it("renders configured relays with in-card toolbar, protocol badges, live balance/error pills, and Switch/Edit/Remove controls", () => {
    const newapiId = UsageLimitSourceId.make("newapi-api.example.com");
    const billingId = UsageLimitSourceId.make("relay-openai.example.com");
    const cliproxyId = UsageLimitSourceId.make("cliproxy-proxy.example.com-8318");

    const sources: UnifiedSettings["usageLimitSources"] = {
      [newapiId]: {
        kind: "newapi",
        label: "主站 New API",
        url: "https://api.example.com",
        managementKey: "••••••",
        userId: "42",
        enabled: true,
      },
      [billingId]: {
        kind: "openaiBilling",
        label: "备用中转",
        url: "https://openai.example.com/v1",
        managementKey: "••••••",
        enabled: true,
      },
      [cliproxyId]: {
        kind: "cliproxy",
        label: "旧版代理",
        url: "https://proxy.example.com:8318",
        managementKey: "••••••",
        enabled: false,
      },
    };

    mockState.snapshots = [
      {
        id: newapiId,
        kind: "newapi",
        label: "主站 New API",
        checkedAt: "2026-11-26T00:00:00.000Z",
        accounts: [
          {
            id: "42",
            driver: ProviderDriverKind.make("openaiCompatible"),
            plan: "New API · vip",
            usageLimits: {
              checkedAt: "2026-11-26T00:00:00.000Z",
              windows: [
                {
                  id: "relay-balance",
                  kind: "monthly",
                  label: "$12.50 left · $7.50 / $20.00",
                  usedPercent: 37.5,
                },
              ],
            },
          },
        ],
      },
      {
        id: billingId,
        kind: "openaiBilling",
        label: "备用中转",
        checkedAt: "2026-11-26T00:00:00.000Z",
        accounts: [],
        error: "The relay answered with HTTP 401.",
      },
    ];

    const html = renderToStaticMarkup(
      <UsageProviderSettings
        environmentId={EnvironmentId.make("local")}
        environmentLabel="本机"
        sources={sources}
        readOnly={false}
      />,
    );

    expect(html).toContain('data-relay-toolbar="true"');
    expect(html).toContain("已配置 3 个中转站");
    expect(html).toContain("主站 New API");
    expect(html).toContain("New API / One API");
    expect(html).toContain("UID 42");
    expect(html).toContain('data-relay-status="success"');
    expect(html).toContain("$12.50 left · $7.50 / $20.00");
    expect(html).toContain("OpenAI 兼容");
    expect(html).toContain('data-relay-status="error"');
    expect(html).toContain("The relay answered with HTTP 401.");
    expect(html).toContain("CLIProxyAPI（兼容）");
    expect(html).toContain("已停用");
    expect(html).toContain("编辑");
    expect(html).toContain("移除");
    expect(html).toContain('role="switch"');
  });
});
