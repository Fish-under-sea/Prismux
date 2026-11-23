import { resolveLocale } from "@t3tools/client-runtime/locales";
import { getTranslationsSnapshot, initializeGT, msg } from "gt-react";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  SETTINGS_NAV_LABELS,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  searchSettings,
} from "../components/settings/settingsSearch";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locales";
import { m, setActiveLocale } from "./messages";
import enCatalog from "./translations/en.json";
import zhCatalog from "./translations/zh.json";

describe("Prismux Simplified Chinese i18n catalog", () => {
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

  it("maps zh / zh-CN / zh-Hans to the zh catalog and keeps English as default", () => {
    expect(resolveLocale("system", ["zh-CN", "en-US"], SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe(
      "zh",
    );
    expect(resolveLocale("system", ["zh-Hans"], SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("zh");
    expect(resolveLocale("zh", ["en-US"], SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("zh");
    expect(resolveLocale("en", ["zh-CN"], SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("en");
  });

  it("keeps zh.json keys in exact parity with en.json", () => {
    const enKeys = Object.keys(enCatalog).toSorted();
    const zhKeys = Object.keys(zhCatalog).toSorted();
    expect(zhKeys).toEqual(enKeys);
  });

  it("translates all Prismux settings navigation, breadcrumb, and search labels to Simplified Chinese", () => {
    expect(m(SETTINGS_SECTION_LABELS["/settings/wallpaper"])).toBe("壁纸引擎");
    expect(m(SETTINGS_SECTION_LABELS["/settings/plugins"])).toBe("插件中心");
    expect(m(SETTINGS_SECTION_LABELS["/settings/memory-sync"])).toBe("记忆与同步");
    expect(m(SETTINGS_SECTION_LABELS["/settings/updates"])).toBe("软件更新");

    expect(m(SETTINGS_NAV_LABELS["/settings/wallpaper"])).toBe("壁纸引擎");
    expect(m(SETTINGS_NAV_LABELS["/settings/plugins"])).toBe("插件中心");
    expect(m(SETTINGS_NAV_LABELS["/settings/memory-sync"])).toBe("记忆与同步");
    expect(m(SETTINGS_NAV_LABELS["/settings/updates"])).toBe("软件更新");

    expect(m(msg("Prismux"))).toBe("Prismux");
    expect(m(msg("Wallpaper Engine"))).toBe("壁纸引擎");
    expect(m(msg("Plugin Center"))).toBe("插件中心");
  });

  it("finds Prismux settings items by both Chinese and English queries", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["壁纸引擎", "prismux-wallpaper"],
      ["动态壁纸", "prismux-wallpaper"],
      ["插件中心", "prismux-plugins"],
      ["官方插件", "prismux-plugins"],
      ["记忆与同步", "prismux-memory-sync"],
      ["主秘书", "prismux-memory-sync"],
      ["软件更新", "prismux-updates"],
      ["双源", "prismux-updates"],
      ["Wallpaper Engine", "prismux-wallpaper"],
      ["Plugin Center", "prismux-plugins"],
      ["Memory & Sync", "prismux-memory-sync"],
      ["Prismux Updates", "prismux-updates"],
      ["入门引导", "welcome-page"],
      ["欢迎页", "welcome-page"],
    ];

    for (const [query, expectedId] of cases) {
      expect(searchSettings(query, SETTINGS_SEARCH_ITEMS, m)[0]?.id, query).toBe(expectedId);
    }
  });

  it("provides Prismux-branded Chinese translations for onboarding and FirstRunGate", () => {
    expect(m(msg("Prismux could not confirm this workspace."))).toBe("Prismux 无法确认此工作区。");
    expect(m(msg("Prismux app for iPhone and Android"))).toBe(
      "适用于 iPhone 和 Android 的 Prismux 应用",
    );
    expect(m(msg("Onboarding"))).toBe("入门引导");
    expect(m(msg("Getting started"))).toBe("开始入门引导");
    expect(
      m(msg("Reopen the Prismux welcome guide to set up agents or import existing projects.")),
    ).toBe("随时重新打开 Prismux 入门引导，配置智能体或导入已有项目。");
    expect(m(msg("Welcome page"))).toBe("入门引导");

    // JSX `<T>` entries in zh.json
    expect(zhCatalog["43686eb6ef8468ad"]).toBe("欢迎使用 Prismux");
    expect(zhCatalog["267bdb24bf6000b7"]).toBe("重新查看入门引导");
    expect(zhCatalog["646a12cf30df6e72"]).toBe("在手机上使用 Prismux");
    expect(zhCatalog["25db20a0210577c5"]).toEqual([
      "Prismux 会收集匿名使用数据以改进应用。如需退出，请参阅",
      " ",
      { t: "a", i: 1, c: "隐私政策" },
      "。",
    ]);
  });

  it("translates Issue #1 local agy CLI Antigravity settings copy to Simplified Chinese", () => {
    expect(m(msg("Local agy CLI"))).toBe("本机 agy CLI");
    expect(m(msg("Connecting to local agy CLI…"))).toBe("正在连接本机 agy CLI…");
    expect(m(msg("Checking local agy CLI and loading models…"))).toBe(
      "正在检测本机 agy CLI 并加载模型…",
    );
    expect(m(msg("Reusing local agy CLI sign-in (~/.gemini/antigravity-cli)."))).toBe(
      "正在复用本机 agy CLI 登录态（~/.gemini/antigravity-cli）。",
    );
    expect(
      m(
        msg(
          "Reuse local agy CLI sign-in (~/.gemini/antigravity-cli) on {environment} to load models.",
        ),
        { environment: "Local" },
      ),
    ).toBe("在 Local 上复用本机 agy CLI 登录态（~/.gemini/antigravity-cli）以加载模型。");
    expect(m(msg("Sync models"))).toBe("同步模型");
    expect(m(msg("Retry sync"))).toBe("重试同步");
    expect(m(msg("Connect local CLI"))).toBe("连接本机 CLI");
    expect(m(msg("Using local agy CLI."))).toBe("正在使用本机 agy CLI。");
    expect(m(msg("Uses local agy CLI on PATH or the custom binary path below."))).toBe(
      "使用 PATH 中的本机 agy CLI，或下方指定的自定义可执行文件路径。",
    );
    expect(
      m(
        msg(
          "Local agy CLI reuses your ~/.gemini/antigravity-cli login; Google accounts use your subscription; API keys and Agent Platform bill usage.",
        ),
      ),
    ).toBe(
      "本机 agy CLI 会复用你的 ~/.gemini/antigravity-cli 登录态；Google 账号使用订阅额度；API 密钥和 Agent Platform 按用量计费。",
    );
    expect(
      m(
        msg(
          "Already signed in with agy CLI (~/.gemini/antigravity-cli)? Reuse it directly with the native Google Antigravity icon and limits.",
        ),
      ),
    ).toBe(
      "已通过 agy CLI（~/.gemini/antigravity-cli）登录？可直接复用并保留原生 Google Antigravity 图标与额度显示。",
    );
    // JSX `<T>` entry in zh.json
    expect(zhCatalog["a1761e822ab06189"]).toBe("使用本机 agy CLI");
  });
});
