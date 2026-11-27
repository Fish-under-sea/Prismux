import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  type OfficialTranslationApiVendor,
  type ReasoningTranslationProvider,
  type UnifiedSettings,
} from "@prismux/core-contracts";
import { getTranslationsSnapshot, initializeGT, msg } from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../i18n/locales";
import { m, setActiveLocale } from "../../i18n/messages";
import zhCatalog from "../../i18n/translations/zh.json";

vi.mock("gt-react", async (original) => {
  const actual = await original<typeof import("gt-react")>();
  return {
    ...actual,
    useGT: () => (text: string, vars?: Record<string, unknown>) =>
      m(actual.msg(text), vars as never),
    useMessages: () => (encoded: string, vars?: Record<string, unknown>) =>
      m(encoded, vars as never),
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children?: unknown; className?: string }) => (
    <a className={className}>{children as never}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
  useLocation: (opts?: {
    select?: (loc: { hash: string; pathname: string; state: Record<string, unknown> }) => unknown;
  }) => {
    const loc = { hash: "", pathname: "/settings/chat", state: {} };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

vi.mock("../../hooks/useSettings", async (original) => ({
  ...(await original<typeof import("../../hooks/useSettings")>()),
  usePrimarySettingsAvailable: () => true,
  PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE: "",
}));

vi.mock("../../state/environments", async (original) => ({
  ...(await original<typeof import("../../state/environments")>()),
  usePrimaryEnvironmentId: () => EnvironmentId.make("local"),
  usePrimaryEnvironment: () => ({ label: "本机" }),
}));

vi.mock("../../state/session", async (original) => ({
  ...(await original<typeof import("../../state/session")>()),
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: () => new Set(),
}));

vi.mock("../../state/entities", async (original) => ({
  ...(await original<typeof import("../../state/entities")>()),
  useServerConfigs: () => new Map(),
}));

vi.mock("./useScopedSettings", async (original) => ({
  ...(await original<typeof import("./useScopedSettings")>()),
  useClearScopedSettings: () => vi.fn(),
  useClearProjectOverrides: () => vi.fn(),
  useScopedSettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdateScopedSettings: () => vi.fn(),
}));

import {
  LOCAL_NMT_MIRROR_LABELS,
  OFFICIAL_API_VENDOR_LABELS,
  REASONING_TRANSLATION_PROVIDER_LABELS,
  ReasoningTranslationSettingsCardView,
  buildOfficialApiSettingsPatch,
  createOfficialApiDraftFromSaved,
  formatModelPackSize,
  isOfficialApiDraftDirty,
  officialApiVendorFields,
} from "./ReasoningTranslationSettingsCard";
import { LOCAL_NMT_MODEL_ID, type LocalNmtModelStatus } from "../../prismux/reasoningTranslation";

function makeSettings(
  overrides: Partial<UnifiedSettings> & {
    readonly reasoningTranslationProvider?: ReasoningTranslationProvider;
  } = {},
): UnifiedSettings {
  return {
    ...DEFAULT_UNIFIED_SETTINGS,
    ...overrides,
  };
}

function makeLocalStatus(overrides: Partial<LocalNmtModelStatus> = {}): LocalNmtModelStatus {
  return {
    installed: false,
    downloading: false,
    progressPercent: 0,
    downloadedBytes: 0,
    totalBytes: 56_995_684,
    modelId: LOCAL_NMT_MODEL_ID,
    modelDir: "/home/user/.prismux/models/reasoning-translate/mozilla-bergamot-enzh-v2.2",
    mirror: "hf_mirror",
    version: "2.2.0",
    error: null,
    sizeBytes: 0,
    ...overrides,
  };
}

describe("ReasoningTranslationSettingsCard (Simplified Chinese i18n & A+B+C UI)", () => {
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

  it("resolves all engine, mirror, and official vendor labels to native Simplified Chinese", () => {
    expect(m(REASONING_TRANSLATION_PROVIDER_LABELS.off)).toBe("关闭（默认 · 零外联）");
    expect(m(REASONING_TRANSLATION_PROVIDER_LABELS.local_nmt)).toBe(
      "本地离线翻译（免费 · 零外联）",
    );
    expect(m(REASONING_TRANSLATION_PROVIDER_LABELS.text_model)).toBe("指定文本生成模型");
    expect(m(REASONING_TRANSLATION_PROVIDER_LABELS.official_api)).toBe("官方翻译 API（自带密钥）");

    expect(m(LOCAL_NMT_MIRROR_LABELS.hf_mirror)).toBe("国内加速源（hf-mirror / jsDelivr）");
    expect(m(LOCAL_NMT_MIRROR_LABELS.huggingface)).toBe("官方源（Hugging Face / Mozilla）");

    expect(m(OFFICIAL_API_VENDOR_LABELS.deepl)).toBe("DeepL");
    expect(m(OFFICIAL_API_VENDOR_LABELS.azure)).toBe("Azure 翻译（Azure Translator）");
    expect(m(OFFICIAL_API_VENDOR_LABELS.volcano)).toBe("火山翻译（Volcano）");
    expect(m(OFFICIAL_API_VENDOR_LABELS.tencent)).toBe("腾讯翻译君（Tencent）");
    expect(m(OFFICIAL_API_VENDOR_LABELS.openai_compatible)).toBe(
      "OpenAI 兼容接口（Ollama / DeepSeek 等）",
    );
  });

  it("renders default off state in full Chinese with zero sub-panels and zero nested backdrop-blur", () => {
    const html = renderToStaticMarkup(
      <ReasoningTranslationSettingsCardView
        id="reasoning-translation"
        title={m(msg("Reasoning translation"))}
        settings={makeSettings({ reasoningTranslationProvider: "off" })}
        onUpdateSettings={vi.fn()}
        disableInitialStatusFetch
      />,
    );

    expect(html).toContain('id="reasoning-translation"');
    expect(html).toContain("思考过程汉化");
    expect(html).toContain("关闭（默认 · 零外联）");
    expect(html).toContain("默认关闭，思考内容严格留在本地且零外联请求");
    expect(html).not.toContain('data-slot="reasoning-translation-local-nmt-panel"');
    expect(html).not.toContain('data-slot="reasoning-translation-text-model-panel"');
    expect(html).not.toContain('data-slot="reasoning-translation-official-api-panel"');
    expect(html).not.toContain("backdrop-blur");
  });

  it("renders Engine B (local_nmt) across not-installed, downloading progress, ready, and test preview states in Chinese", () => {
    const notInstalledHtml = renderToStaticMarkup(
      <ReasoningTranslationSettingsCardView
        id="reasoning-translation"
        title={m(msg("Reasoning translation"))}
        settings={makeSettings({ reasoningTranslationProvider: "local_nmt" })}
        onUpdateSettings={vi.fn()}
        initialLocalStatus={makeLocalStatus({ installed: false, downloading: false })}
        disableInitialStatusFetch
      />,
    );
    expect(notInstalledHtml).toContain('data-slot="reasoning-translation-local-nmt-panel"');
    expect(notInstalledHtml).toContain("本地离线翻译包");
    expect(notInstalledHtml).toContain("未安装");
    expect(notInstalledHtml).toContain("下载镜像源");
    expect(notInstalledHtml).toContain("国内加速源（hf-mirror / jsDelivr）");
    expect(notInstalledHtml).toContain("一键下载离线翻译包");
    expect(notInstalledHtml).not.toContain("backdrop-blur");

    const downloadingHtml = renderToStaticMarkup(
      <ReasoningTranslationSettingsCardView
        id="reasoning-translation"
        title={m(msg("Reasoning translation"))}
        settings={makeSettings({ reasoningTranslationProvider: "local_nmt" })}
        onUpdateSettings={vi.fn()}
        initialLocalStatus={makeLocalStatus({
          installed: false,
          downloading: true,
          progressPercent: 42,
          downloadedBytes: 23_938_187,
        })}
        disableInitialStatusFetch
      />,
    );
    expect(downloadingHtml).toContain("正在下载 42%");
    expect(downloadingHtml).toContain('role="progressbar"');
    expect(downloadingHtml).toContain('aria-valuenow="42"');
    expect(downloadingHtml).toContain("motion-reduce:transition-none");
    expect(downloadingHtml).toContain("取消");

    const readyHtml = renderToStaticMarkup(
      <ReasoningTranslationSettingsCardView
        id="reasoning-translation"
        title={m(msg("Reasoning translation"))}
        settings={makeSettings({ reasoningTranslationProvider: "local_nmt" })}
        onUpdateSettings={vi.fn()}
        initialLocalStatus={makeLocalStatus({
          installed: true,
          downloading: false,
          progressPercent: 100,
          sizeBytes: 56_995_684,
        })}
        initialTestResult={{
          ok: true,
          translatedText: "在应用修复前检查文件路径。",
          latencyMs: 38,
          provider: "local_nmt",
          modelKey: LOCAL_NMT_MODEL_ID,
          error: null,
          errorCode: null,
        }}
        disableInitialStatusFetch
      />,
    );
    expect(readyHtml).toContain("已就绪 · 54.4 MB · 离线零外联");
    expect(readyHtml).toContain("测试本地翻译");
    expect(readyHtml).toContain("删除本地模型");
    expect(readyHtml).toContain("测试翻译成功（38 ms）");
    expect(readyHtml).toContain("在应用修复前检查文件路径。");
    expect(formatModelPackSize(56_995_684)).toBe("54.4 MB");
  });

  it("renders Engine A (text_model) in both follow-global and dedicated-model modes in Chinese", () => {
    const followGlobalHtml = renderToStaticMarkup(
      <ReasoningTranslationSettingsCardView
        id="reasoning-translation"
        title={m(msg("Reasoning translation"))}
        settings={makeSettings({
          reasoningTranslationProvider: "text_model",
          reasoningTranslationModelSelection: null,
        })}
        onUpdateSettings={vi.fn()}
        textGenerationSettingsLink={
          <a href="#text-generation-model">{m(msg("Configure text generation model →"))}</a>
        }
        disableInitialStatusFetch
      />,
    );
    expect(followGlobalHtml).toContain('data-slot="reasoning-translation-text-model-panel"');
    expect(followGlobalHtml).toContain("翻译模型选择");
    expect(followGlobalHtml).toContain("跟随全局文本生成模型");
    expect(followGlobalHtml).toContain("当前跟随全局文本生成模型：");
    expect(followGlobalHtml).toContain("配置文本生成模型 →");
    expect(followGlobalHtml).toContain("测试翻译");

    const customGlobalHtml = renderToStaticMarkup(
      <ReasoningTranslationSettingsCardView
        id="reasoning-translation"
        title={m(msg("Reasoning translation"))}
        settings={makeSettings({
          reasoningTranslationProvider: "text_model",
          reasoningTranslationModelSelection: null,
          textGenerationModelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-haiku-5-5",
          },
        })}
        providerEntries={[
          {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            driverKind: "claudeAgent" as never,
            displayName: "主力 Claude",
            hasCustomDisplayName: true,
            enabled: true,
            installed: true,
            status: "ready",
            isDefault: true,
            isAvailable: true,
            snapshot: {} as never,
            models: [],
          },
        ]}
        onUpdateSettings={vi.fn()}
        disableInitialStatusFetch
      />,
    );
    expect(customGlobalHtml).toContain("主力 Claude / claude-haiku-5-5");
    expect(customGlobalHtml).not.toContain("claudeAgent / claude-haiku-5-5");

    const dedicatedHtml = renderToStaticMarkup(
      <ReasoningTranslationSettingsCardView
        id="reasoning-translation"
        title={m(msg("Reasoning translation"))}
        settings={makeSettings({
          reasoningTranslationProvider: "text_model",
          reasoningTranslationModelSelection: {
            instanceId: ProviderInstanceId.make("dsh"),
            model: "deepseek-v4-flash",
          },
        })}
        onUpdateSettings={vi.fn()}
        dedicatedModelPicker={<div data-mock-picker="dedicated">DSH / deepseek-v4-flash</div>}
        disableInitialStatusFetch
      />,
    );
    expect(dedicatedHtml).toContain("指定专用翻译模型");
    expect(dedicatedHtml).toContain("专用翻译模型");
    expect(dedicatedHtml).toContain('data-mock-picker="dedicated"');
  });

  it("renders Engine C (official_api) vendor-specific fields, redacted placeholders, and clear-key button cleanly", () => {
    const renderVendor = (
      vendor: OfficialTranslationApiVendor,
      extra: Partial<UnifiedSettings["reasoningTranslationOfficialApi"]> = {},
    ) =>
      renderToStaticMarkup(
        <ReasoningTranslationSettingsCardView
          id="reasoning-translation"
          title={m(msg("Reasoning translation"))}
          settings={makeSettings({
            reasoningTranslationProvider: "official_api",
            reasoningTranslationOfficialApi: {
              ...DEFAULT_UNIFIED_SETTINGS.reasoningTranslationOfficialApi,
              vendor,
              ...extra,
            },
          })}
          onUpdateSettings={vi.fn()}
          disableInitialStatusFetch
        />,
      );

    // DeepL with redacted key
    const deeplHtml = renderVendor("deepl", { apiKey: "••••••" });
    expect(deeplHtml).toContain("翻译服务商");
    expect(deeplHtml).toContain("DeepL 密钥（Auth Key）");
    expect(deeplHtml).toContain("已保存凭据，输入新值可替换");
    expect(deeplHtml).toContain("保存配置");
    expect(deeplHtml).toContain("测试连通性");
    expect(deeplHtml).toContain("清除密钥");
    expect(deeplHtml).not.toContain('value="••••••"');
    expect(deeplHtml).not.toContain("SecretAccessKey");

    // Volcano shows both apiKey + apiSecret + region
    const volcanoHtml = renderVendor("volcano", { region: "cn-north-1" });
    expect(volcanoHtml).toContain("火山翻译（Volcano）");
    expect(volcanoHtml).toContain("AccessKeyId");
    expect(volcanoHtml).toContain("SecretAccessKey");
    expect(volcanoHtml).toContain("地域（Region）");
    expect(volcanoHtml).not.toContain("模型名称");

    // Tencent shows SecretId + SecretKey + region
    const tencentHtml = renderVendor("tencent", { region: "ap-beijing" });
    expect(tencentHtml).toContain("腾讯翻译君（Tencent）");
    expect(tencentHtml).toContain("SecretId");
    expect(tencentHtml).toContain("SecretKey");

    // Azure shows Subscription Key + region
    const azureHtml = renderVendor("azure", { region: "eastasia" });
    expect(azureHtml).toContain("Azure 翻译（Azure Translator）");
    expect(azureHtml).toContain("订阅密钥（Subscription Key）");
    expect(azureHtml).toContain("地域（Region）");

    // OpenAI-compatible shows Base URL + Model name + optional API Key
    const openaiHtml = renderVendor("openai_compatible", {
      endpoint: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
    });
    expect(openaiHtml).toContain("OpenAI 兼容接口（Ollama / DeepSeek 等）");
    expect(openaiHtml).toContain("接口地址（Base URL）");
    expect(openaiHtml).toContain("模型名称");
    expect(openaiHtml).toContain("API Key（本地 Ollama 可留空）");

    expect(officialApiVendorFields("volcano")).toEqual({
      showApiSecret: true,
      showRegion: true,
      showModel: false,
      showEndpoint: true,
    });
    expect(officialApiVendorFields("openai_compatible")).toEqual({
      showApiSecret: false,
      showRegion: false,
      showModel: true,
      showEndpoint: true,
    });
  });

  it("preserves redacted secrets on save when untouched, replaces when edited, and sends empty string when explicitly cleared", () => {
    const saved = {
      ...DEFAULT_UNIFIED_SETTINGS.reasoningTranslationOfficialApi,
      vendor: "volcano" as const,
      apiKey: "••••••",
      apiSecret: "••••••",
      region: "cn-north-1",
      endpoint: "",
      model: "",
    };

    const untouched = createOfficialApiDraftFromSaved(saved);
    expect(isOfficialApiDraftDirty(saved, untouched)).toBe(false);

    // Updating only region omits apiKey & apiSecret so server preserves redacted secrets
    const regionOnly = { ...untouched, region: "cn-beijing" };
    expect(isOfficialApiDraftDirty(saved, regionOnly)).toBe(true);
    const regionPatch = buildOfficialApiSettingsPatch(regionOnly);
    expect(regionPatch).toEqual({
      vendor: "volcano",
      region: "cn-beijing",
      endpoint: "",
      model: "",
    });
    expect("apiKey" in regionPatch).toBe(false);
    expect("apiSecret" in regionPatch).toBe(false);

    // Typing a new apiKey replaces only apiKey while preserving apiSecret
    const newKeyDraft = { ...untouched, apiKey: "  AKLT-new-key  " };
    const newKeyPatch = buildOfficialApiSettingsPatch(newKeyDraft);
    expect(newKeyPatch.apiKey).toBe("AKLT-new-key");
    expect("apiSecret" in newKeyPatch).toBe(false);

    // Explicit clear sends empty string
    const clearedDraft = { ...untouched, clearApiKey: true, clearApiSecret: true };
    const clearedPatch = buildOfficialApiSettingsPatch(clearedDraft);
    expect(clearedPatch.apiKey).toBe("");
    expect(clearedPatch.apiSecret).toBe("");
  });
});
