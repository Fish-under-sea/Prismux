import { resolveLocale } from "@prismux/client-runtime/locales";
import { getTranslationsSnapshot, initializeGT, msg } from "gt-react";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import {
  SETTINGS_NAV_LABELS,
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
  searchSettings,
  settingsNavGroups,
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
    expect(m(SETTINGS_SECTION_LABELS["/settings/providers"])).toBe("智能体配置");
    expect(m(SETTINGS_SECTION_LABELS["/settings/chat"])).toBe("对话");
    expect(m(SETTINGS_SECTION_LABELS["/settings/appearance"])).toBe("外观");
    expect(m(SETTINGS_SECTION_LABELS["/settings/wallpaper"])).toBe("壁纸");
    expect(m(SETTINGS_SECTION_LABELS["/settings/projects"])).toBe("项目与归档");
    expect(m(SETTINGS_SECTION_LABELS["/settings/plugins"])).toBe("插件中心");
    expect(m(SETTINGS_SECTION_LABELS["/settings/memory"])).toBe("秘书与记忆");
    expect(m(SETTINGS_SECTION_LABELS["/settings/sync"])).toBe("远程同步");
    expect(m(SETTINGS_SECTION_LABELS["/settings/connections"])).toBe("环境与远控");
    expect(m(SETTINGS_SECTION_LABELS["/settings/maintenance"])).toBe("维护与诊断");
    expect(m(SETTINGS_SECTION_LABELS["/settings/overnight-factory"])).toBe("夜间工场与邮箱");
    expect(m(SETTINGS_SECTION_LABELS["/settings/memory-sync"])).toBe("记忆与同步");
    expect(m(SETTINGS_SECTION_LABELS["/settings/updates"])).toBe("软件更新");

    expect(m(SETTINGS_NAV_LABELS["/settings/providers"])).toBe("智能体配置");
    expect(m(SETTINGS_NAV_LABELS["/settings/chat"])).toBe("对话");
    expect(m(SETTINGS_NAV_LABELS["/settings/appearance"])).toBe("外观");
    expect(m(SETTINGS_NAV_LABELS["/settings/wallpaper"])).toBe("壁纸");
    expect(m(SETTINGS_NAV_LABELS["/settings/projects"])).toBe("项目与归档");
    expect(m(SETTINGS_NAV_LABELS["/settings/plugins"])).toBe("插件中心");
    expect(m(SETTINGS_NAV_LABELS["/settings/memory"])).toBe("秘书与记忆");
    expect(m(SETTINGS_NAV_LABELS["/settings/sync"])).toBe("远程同步");
    expect(m(SETTINGS_NAV_LABELS["/settings/connections"])).toBe("环境与远控");
    expect(m(SETTINGS_NAV_LABELS["/settings/maintenance"])).toBe("维护与诊断");
    expect(m(SETTINGS_NAV_LABELS["/settings/overnight-factory"])).toBe("夜间工场与邮箱");
    expect(m(SETTINGS_NAV_LABELS["/settings/memory-sync"])).toBe("记忆与同步");
    expect(m(SETTINGS_NAV_LABELS["/settings/updates"])).toBe("软件更新");

    // Verify exact 4-group Simplified Chinese sidebar hierarchy and item order
    const zhGroups = settingsNavGroups(false, false).map((group) => ({
      heading: m(group.heading),
      labels: group.paths.map((path) => m(SETTINGS_NAV_LABELS[path])),
    }));
    expect(zhGroups).toEqual([
      {
        heading: "常用与外观",
        labels: ["通用", "对话", "语音", "外观", "壁纸", "快捷键"],
      },
      {
        heading: "智能体与工作区",
        labels: ["智能体配置", "秘书与记忆", "项目与归档", "浏览器与设备", "源码管理与工作树"],
      },
      {
        heading: "扩展与连接",
        labels: ["插件中心", "远程同步", "环境与远控"],
      },
      {
        heading: "系统与关于",
        labels: ["维护与诊断", "关于与更新"],
      },
    ]);

    expect(m(msg("Project configuration"))).toBe("项目配置");
    expect(m(msg("Archived threads"))).toBe("已归档线程");
    expect(m(msg("Projects and archive settings sections"))).toBe("项目与归档设置分区");
    expect(m(msg("Remote sync"))).toBe("远程同步");
    expect(m(msg("Environments & remote"))).toBe("环境与远控");
    expect(m(msg("Prismux"))).toBe("Prismux");
    expect(m(msg("Wallpaper Engine"))).toBe("壁纸引擎");
    expect(m(msg("Plugin Center"))).toBe("插件中心");
    expect(m(msg("Work steps display"))).toBe("工作步骤展示");
    expect(m(msg("Work steps collapse timing"))).toBe("工作步骤收起时机");
    expect(m(msg("Replies shown when collapsed"))).toBe("收起后显示的回复");
    expect(m(msg("Standard", { $context: "work steps display level" }))).toBe("标准");
    expect(m(msg("After response ends", { $context: "work steps collapse timing" }))).toBe(
      "回答结束后",
    );
    expect(m(msg("All replies", { $context: "collapsed assistant replies" }))).toBe("全部回复");

    // Agent configurator 3-tab redesign, unified 柱状 effort wording, prismux.json, and provider detail headings
    expect(m(msg("Agent configurator"))).toBe("智能体配置");
    expect(m(msg("Providers & instances"))).toBe("提供方与实例");
    expect(m(msg("Defaults & policies"))).toBe("默认模型与策略");
    expect(m(msg("Compliance & subscription waiver"))).toBe("合规与订阅免责");
    expect(m(msg("Default chat models"))).toBe("对话默认模型");
    expect(m(msg("Global launch & update policy"))).toBe("全局启动与检测策略");
    expect(m(msg("Basic configuration"))).toBe("基本配置");
    expect(m(msg("Connection & runtime"))).toBe("连接与运行环境");
    expect(m(msg("Choose whether new sessions open in Chat or CLI mode."))).toBe(
      "选择新建会话默认进入 Chat 还是 CLI 模式。",
    );
    expect(m(msg("Threads & default behavior"))).toBe("线程与默认行为");
    expect(m(msg("New thread defaults"))).toBe("新会话默认行为");
    expect(m(msg("Auto-settle, snooze & rate limits"))).toBe("自动沉淀、推迟与限流恢复");
    expect(m(msg("Bars", { $context: "show effort as bars" }))).toBe("柱状");
    expect(m(msg("Bars (default)"))).toBe("柱状（默认）");
    expect(m(msg("Word", { $context: "show effort as a word" }))).toBe("文字");
    expect(m(msg("Import from prismux.json"))).toBe("从 prismux.json 导入");
    expect(m(msg("prismux.json is invalid"))).toBe("prismux.json 无效");
    expect(m(msg("Inherited from the repository's prismux.json"))).toBe("继承自仓库的 prismux.json");
    expect(m(msg("Prismux system footprint"))).toBe("Prismux 系统资源占用");
    expect(zhCatalog["84795e1ec8a16024"]).toBe("Prismux 系统资源占用");
    expect(m(msg("Running natively"))).toBe("原生运行");
    expect(
      m(msg("{count, plural, one {{count} process} other {{count} processes}}"), { count: 4 }),
    ).toBe("4 个进程");
    expect(m(msg("{bytes} observed"), { bytes: "12 MB" })).toBe("累计观测 12 MB");
    expect(m(msg("{retained}/{scanned} retained"), { retained: 12, scanned: 120 })).toBe(
      "已跟踪 12/120",
    );
    expect(m(msg("Normal (unthrottled)"))).toBe("正常（未限频）");
    expect(m(msg("Throttled"))).toBe("已限频");
    expect(m(msg("Nominal", { $context: "host thermal state" }))).toBe("正常");
    expect(m(msg("Fair", { $context: "host thermal state" }))).toBe("温热");
    expect(m(msg("Serious", { $context: "host thermal state" }))).toBe("偏热");
    expect(m(msg("Critical", { $context: "host thermal state" }))).toBe("过热");
    expect(m(msg("No sensor data", { $context: "host thermal state" }))).toBe("暂无传感器数据");
    expect(m(msg("Prismux process"))).toBe("Prismux 进程");
    expect(zhCatalog["167f72627cd1b9d3"]).toBe(
      "原生计数器可识别是哪个进程正在读写。这些应用层计数器可识别已知的 Prismux 操作，便于将进程峰值与具体的持久化和日志路径关联起来。",
    );
    expect(zhCatalog["6592fb0f2e315bdf"]).toBe("使用 Prismux 桌面版自动返回");
    expect(
      m(
        msg(
          "For thread titles and other generated text. Source control has its own setting. Text generators from Agent configurator also appear here.",
        ),
      ),
    ).toBe("用于生成会话标题和其他文本。版本控制有单独的设置。“智能体配置”中添加的文本生成器也会显示在这里。");
    expect(m(msg("Default reasoning effort"))).toBe("默认思考强度");
    expect(
      m(
        msg(
          "Default reasoning effort for models without an explicit override. Automatically maps to each model's closest supported level.",
        ),
      ),
    ).toBe("未单独覆盖时模型的默认思考强度，会自动映射到各模型最接近的支持档位。");
    expect(
      m(
        msg(
          "Default reasoning effort for models without an explicit override in this project. Automatically maps to each model's closest supported level.",
        ),
      ),
    ).toBe("此项目中未单独覆盖时模型的默认思考强度，会自动映射到各模型最接近的支持档位。");
    expect(m(msg("Reset default reasoning effort to default"))).toBe("将默认思考强度重置为默认值");

    // Reasoning / CoT translation (思考过程汉化)
    expect(m(msg("Reasoning translation"))).toBe("思考过程汉化");
    expect(
      m(msg("Off (keep original)", { $context: "reasoning translation provider" })),
    ).toBe("关闭（保留原文）");
    expect(
      m(msg("Bing Translate (no key)", { $context: "reasoning translation provider" })),
    ).toBe("Bing 翻译（免密）");
    expect(
      m(msg("Google Translate (no key)", { $context: "reasoning translation provider" })),
    ).toBe("Google 翻译（免密）");
    expect(
      m(msg("Designated text generation model", { $context: "reasoning translation provider" })),
    ).toBe("指定文本生成模型");
    expect(
      m(
        msg(
          "Enable real-time Chinese translation of model reasoning. Click 'View original' anytime to switch back.",
        ),
      ),
    ).toBe("开启后可实时将模型英文思考过程汉化为中文，点击「查看原文」可随时切回。");
    expect(
      m(
        msg(
          "No sign-in or API key required. When enabled, reasoning text is sent to the selected online translation service and may contain code or conversation details.",
        ),
      ),
    ).toBe("无需额外登录或 API Key；开启后思考内容会发送至所选在线翻译服务，可能包含代码或对话细节。");
    expect(
      m(
        msg(
          "Reuses your configured Text generation model for high-quality translation (follows the subscription risk waiver guard),",
        ),
      ),
    ).toBe("将复用「文本生成模型」设置的模型进行高质量汉化（遵循订阅免责护栏），");
    expect(m(msg("Configure text generation model →"))).toBe("配置文本生成模型 →");
    expect(m(msg("Reset reasoning translation to default"))).toBe("将思考过程汉化重置为默认值");
    expect(m(msg("Translating reasoning…"))).toBe("正在汉化思考过程…");
    expect(m(msg("View original"))).toBe("查看原文");
    expect(m(msg("View translation"))).toBe("查看译文");
    expect(m(msg("Translation unavailable, showing original"))).toBe("翻译暂不可用，已显示原文");
    expect(m(msg("Antigravity subscription waiver required; showing original."))).toBe(
      "Antigravity 需签署免责后方可自动汉化，已显示原文。",
    );
  });

  it("finds Prismux settings items by both Chinese and English queries", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["壁纸", "prismux-wallpaper"],
      ["壁纸引擎", "prismux-wallpaper"],
      ["动态壁纸", "prismux-wallpaper"],
      ["插件中心", "prismux-plugins"],
      ["官方插件", "prismux-plugins"],
      ["记忆", "prismux-memory"],
      ["主秘书", "prismux-chief-slot"],
      ["同步", "prismux-sync"],
      ["远程同步", "prismux-sync"],
      ["已归档线程", "archive"],
      ["WebDAV", "prismux-sync"],
      ["工作步骤展示", "work-steps-display"],
      ["工作步骤收起时机", "work-steps-collapse-timing"],
      ["收起后显示的回复", "collapsed-assistant-reply-mode"],
      ["二维码扫码配对", "mobile-qr-pairing"],
      ["软件更新", "prismux-updates"],
      ["双源", "prismux-updates"],
      ["Wallpaper Engine", "prismux-wallpaper"],
      ["Plugin Center", "prismux-plugins"],
      ["Memory", "prismux-memory"],
      ["Sync", "prismux-sync"],
      ["Prismux Updates", "prismux-updates"],
      ["入门引导", "welcome-page"],
      ["欢迎页", "welcome-page"],
      ["被控代理", "subscription-risk-waiver"],
      ["个人订阅", "subscription-risk-waiver"],
      ["智能体配置", "providers"],
      ["智能体配置器", "providers"],
      ["智能体提供方", "providers"],
      ["秘书与记忆", "prismux-memory"],
      ["主秘书与记忆", "prismux-memory"],
      ["默认思考强度", "default-reasoning-effort"],
      ["思考过程汉化", "reasoning-translation"],
      ["思维链翻译", "reasoning-translation"],
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
          "Already signed in with agy CLI? Reuse it directly via the official agy acp channel with the native Google Antigravity icon.",
        ),
      ),
    ).toBe("已通过 agy CLI 登录？可直接经由官方 agy acp 通道复用并保留原生 Google Antigravity 图标。");
    expect(
      m(
        msg(
          "Reusing local agy CLI via official ACP ({plan}). Check quotas or credits with /usage or /credits in agy.",
        ),
        { plan: "Google AI Ultra" },
      ),
    ).toBe(
      "正在通过官方 ACP 复用本机 agy CLI（Google AI Ultra）。查看配额或余额请在终端运行 agy 并输入 /usage 或 /credits。",
    );
    expect(
      m(
        msg(
          "Connect local agy CLI via official ACP on {environment} to load models. Sign in in a terminal with 'agy' or 'agy acp --login'.",
        ),
        { environment: "Local" },
      ),
    ).toBe(
      "在 Local 上通过官方 ACP 连接本机 agy CLI 以加载模型。请先在终端运行 'agy' 或 'agy acp --login' 完成登录。",
    );
    // JSX `<T>` entry in zh.json
    expect(zhCatalog["a1761e822ab06189"]).toBe("使用本机 agy CLI");
  });

  it("translates v0.1.1-alpha.1 diagnostics, updates, mobile web, voice mirror, and Issue #6/#7 copy", () => {
    expect(m(msg("Service Diagnostics"))).toBe("服务体检");
    expect(m(msg("Prismux Service Diagnostics"))).toBe("Prismux 服务体检中心");
    expect(m(msg("FTS5 + sqlite-vec hybrid"))).toBe("FTS5 + sqlite-vec 混合态");
    expect(m(msg("FTS5 degraded mode"))).toBe("FTS5 降级态");
    expect(m(msg("Mobile Web access"))).toBe("手机扫码访问本机 Prismux Web");
    expect(m(msg("Whisper model download mirror (HF_ENDPOINT)"))).toBe(
      "Whisper 模型国内下载镜像（HF_ENDPOINT）",
    );
    expect(m(msg("Continue in terminal"))).toBe("在终端中继续");
    expect(m(msg("Return to chat"))).toBe("切回对话视图");
    expect(m(msg("Default launch mode"))).toBe("默认启动模式");
    expect(m(msg("Install guide"))).toBe("官方安装指南");
    expect(m(msg("CLI not installed"))).toBe("未安装 CLI");
    expect(m(msg("Hand off to another agent"))).toBe("交接给其他智能体");
    expect(m(msg("Latest status (recommended)"))).toBe("最新进展摘要（推荐）");
    expect(m(msg("Full transcript"))).toBe("完整对话记录");
    expect(
      m(msg("Install the {provider} CLI to open it in a terminal."), { provider: "Codex" }),
    ).toBe("请先安装 Codex CLI，才能在终端中打开它。");
    expect(m(msg("{agent} isn't installed on this machine."), { agent: "DSH" })).toBe(
      "本机尚未安装 DSH。",
    );
    expect(m(msg("Run Prismux's CLI as `prismux` (with `t3` alias) from any terminal."))).toBe(
      "在任意终端中以 `prismux`（兼容 `t3` 别名）运行 Prismux 命令行工具。",
    );
    expect(
      m(
        msg("Another prismux at {path} runs first in a new terminal. Remove it to use Prismux's.", {
          path: "/usr/local/bin/prismux",
        }),
      ),
    ).toBe("新终端中将优先运行位于 /usr/local/bin/prismux 的另一个 prismux。请先移除它以使用 Prismux 的版本。");
    expect(m(msg("手机模拟器"))).toBe("手机模拟器");
    expect(m(msg("零依赖内置 iPhone 16 Pro / Android 机身外壳与真机触摸仿真。"))).toBe(
      "零依赖内置 iPhone 16 Pro / Android 机身外壳与真机触摸仿真。",
    );
    // JSX `<T>` entries in zh.json + retired omp keys removed
    expect(zhCatalog["d9de785e4e7e3489"]).toBe("前往软件更新");
    expect(zhCatalog["62efb97188343665"]).toBe("开启局域网访问");
    expect(enCatalog).not.toHaveProperty("0a3d168145e42282");
    expect(zhCatalog).not.toHaveProperty("0a3d168145e42282");
    expect(enCatalog).not.toHaveProperty("d18fbf732abd8379");
    expect(zhCatalog).not.toHaveProperty("d18fbf732abd8379");
    expect(
      (SETTINGS_SEARCH_ITEMS as ReadonlyArray<{ readonly id: string }>).some(
        (item) => item.id === "prismux-diagnostics",
      ),
    ).toBe(false);

    // RC.2 segmented settings tab & Antigravity compliance labels
    expect(m(msg("Theme & colors"))).toBe("主题与配色");
    expect(m(msg("Liquid glass & corners"))).toBe("液态玻璃与圆角");
    expect(m(msg("Fonts & typography"))).toBe("字体与排版");
    expect(m(msg("Composer & sending"))).toBe("输入与发送");
    expect(m(msg("Reading & display"))).toBe("阅读与展示");
    expect(m(msg("Threads & defaults"))).toBe("线程与默认配置");
    expect(m(msg("Background & cleanup"))).toBe("后台运行与清理");
    expect(m(msg("Service diagnostics"))).toBe("服务健康诊断");
    expect(m(msg("Telemetry & tracing"))).toBe("性能遥测与追踪");
    expect(m(msg("Tools & help"))).toBe("工具与帮助");
    expect(m(msg("Dictation & transcription"))).toBe("听写与转写");
    expect(m(msg("Local models & dictionary"))).toBe("本地模型与词典");
    expect(m(msg("Hosts & repositories"))).toBe("托管平台与仓库");
    expect(m(msg("AI commits & review"))).toBe("AI 提交与审查");
    expect(m(msg("Worktrees & branches"))).toBe("工作树与分支");
    expect(m(msg("Diffs & PRs"))).toBe("差异与 PR");
    expect(m(msg("Built-in browser"))).toBe("内置浏览器");
    expect(m(msg("Mobile devices & remote hosts"))).toBe("移动设备与远端主机");
    expect(m(msg("QR remote control & LAN access"))).toBe("扫码远控与局域网访问");
    expect(m(msg("Antigravity controlled-agent lock"))).toBe("Antigravity 被控代理安全锁");
  });

  it("translates Orca composer (#313), sidebar + icon rail (#315/Spec 2), settings nav (Spec 1), live telemetry (Spec 3), and usage call logs (Spec 4A)", () => {
    // Orca composer & 4-tier permission shield
    expect(m(msg("Ask anything, @ to mention files, / for commands"))).toBe(
      "随心输入，@ 引用文件，/ 使用命令",
    );
    expect(m(msg("Ask for approval"))).toBe("请求批准");
    expect(m(msg("Accept edits"))).toBe("接受编辑");
    expect(m(msg("Approve for me"))).toBe("替我批准");
    expect(m(msg("Never asks before edits or commands"))).toBe("编辑或运行命令前从不询问");
    expect(m(msg("More models ({count})"), { count: 4 })).toBe("更多模型 (4)");
    expect(m(msg("Show fewer models"))).toBe("收起更多模型");

    // Orca left sidebar + icon rail
    expect(m(msg("Service diagnostics", { $context: "sidebar quick navigation" }))).toBe("服务体检");
    expect(m(msg("Automations", { $context: "sidebar quick navigation" }))).toBe("自动化");
    expect(m(msg("Prismux Mobile", { $context: "sidebar quick navigation" }))).toBe("Prismux 手机端");
    expect(m(msg("Plugins", { $context: "sidebar quick navigation" }))).toBe("插件中心");
    expect(m(msg("Locate current thread"))).toBe("定位当前会话");
    expect(m(msg("Wallpaper & appearance"))).toBe("壁纸与外观");
    expect(m(msg("Collapse sidebar"))).toBe("折叠侧边栏");
    expect(m(msg("Expand sidebar"))).toBe("展开侧边栏");
    expect(m(msg("Notifications & pending approvals"))).toBe("通知与待审批");
    expect(zhCatalog["c9e6702d622a8ef6"]).toBe("Prismux GitHub 仓库");
    expect(zhCatalog["a819ac2e9d61e812"]).toBe("反馈问题");

    // Spec 1 Settings nav groups, merged Appearance & Wallpaper, About & Updates, and internal re-grouping
    expect(m(msg("Appearance & Wallpaper"))).toBe("外观与壁纸");
    expect(m(msg("About & Updates"))).toBe("关于与更新");
    expect(m(msg("General & appearance"))).toBe("常用与外观");
    expect(m(msg("Agents & workspace"))).toBe("智能体与工作区");
    expect(m(msg("Extensions & connections"))).toBe("扩展与连接");
    expect(m(msg("System & about"))).toBe("系统与关于");
    expect(m(msg("Follow-ups & subagents"))).toBe("自动续跑与子线程");
    expect(m(msg("Activity & accessibility"))).toBe("活动与辅助功能");
    expect(m(msg("Background & recovery"))).toBe("后台防休眠与重启续跑");
    expect(m(msg("CLI, mobile access & onboarding"))).toBe("命令行、移动访问与引导");
    expect(m(msg("Defaults & CLI updates"))).toBe("默认模式与 CLI 更新检测");
    expect(m(msg("Live wallpaper & Steam Workshop 431960"))).toBe("动态壁纸引擎与 Steam 431960");
    expect(m(msg("Multi-environment linking"))).toBe("多环境联动");
    expect(zhCatalog["d62a257591810bd5"]).toBe("前往聊天设置");
    expect(zhCatalog["f3e68622c75839ac"]).toBe("前往工作树设置");
    expect(zhCatalog["be0677cf0324fc67"]).toBe("前往环境设置");
    expect(zhCatalog["cdfd32ad4d328c61"]).toBe(
      "将运行中与监控中的会话收纳到「进行中」分组，需要你介入时会自动回到收件箱顶部。",
    );

    // Spec 3 Live session telemetry strip
    expect(m(msg("Context {percent}"), { percent: "42%" })).toBe("上下文 42%");
    expect(m(msg("Cache hit {rate}"), { rate: "88%" })).toBe("缓存命中 88%");
    expect(m(msg("Live session telemetry"))).toBe("实时会话遥测");

    // Spec 4A Usage page summary metrics & Call Logs
    expect(m(msg("Avg TTFT"))).toBe("平均首字响应");
    expect(m(msg("Avg speed"))).toBe("平均速度");
    expect(m(msg("Cache hit rate"))).toBe("实际缓存命中率");
    expect(m(msg("Call Logs"))).toBe("调用日志");

    // 4-tier work steps Chinese action labels
    expect(m(msg("Edited file"))).toBe("已修改文件");
    expect(m(msg("Searched"))).toBe("已搜索");
    expect(m(msg("Thought for {duration}"), { duration: "2.4s" })).toBe("思考了 2.4s");
    expect(m(msg("Web fetch"))).toBe("网页抓取");
    expect(m(msg("Reasoning"))).toBe("思考过程");
    expect(m(msg("Result"))).toBe("结果");
    expect(m(msg("MCP tool"))).toBe("MCP 工具");
    expect(m(msg("Todo list"))).toBe("任务清单");
    expect(m(msg("Plan"))).toBe("执行计划");
    expect(m(msg("Edited {fileName}"), { fileName: "app.ts" })).toBe("已修改 app.ts");
    expect(m(msg("Created {fileName}"), { fileName: "new.ts" })).toBe("已创建 new.ts");
    expect(m(msg("Deleted {fileName}"), { fileName: "old.ts" })).toBe("已删除 old.ts");
    expect(m(msg("Fetched {url}"), { url: "https://prismux.dev" })).toBe("已抓取 https://prismux.dev");
    expect(m(msg("Updating plan"))).toBe("正在更新计划");
    expect(m(msg("Updated plan"))).toBe("已更新计划");
    expect(m(msg("Running tool"))).toBe("正在调用工具");
    expect(m(msg("Used tool"))).toBe("已调用工具");
  });

  it("enforces Prismux brand cleanup across zh.json while preserving T3 Connect relay copy", () => {
    const serializedValues = Object.values(zhCatalog).map((value) => JSON.stringify(value));
    const legacyBrandPattern = new RegExp(
      `${["T3", " Code"].join("")}|T3 Server|T3 server|T3 服务器|T3 主目录|T3 home|Magpie|magpie`,
    );
    const residue = serializedValues.filter((entry) => legacyBrandPattern.test(entry));
    expect(residue).toEqual([]);

    const t3ConnectEntries = serializedValues.filter((entry) => entry.includes("T3 Connect"));
    expect(t3ConnectEntries.length).toBeGreaterThan(100);

    expect(m(msg("Open pull requests in Prismux"))).toBe("在 Prismux 中打开 PR");
    expect(m(msg("prismux command"))).toBe("prismux 命令");
    expect(m(msg("Use Prismux in another app (MCP)"))).toBe("在其他应用中使用 Prismux（MCP）");
    expect(m(msg("Drop Prismux or VS Code .json files"))).toBe(
      "拖入 Prismux 或 VS Code .json 文件",
    );
  });

  it("auto-detects supported UI languages by host IANA timezone on default system mode and never overrides explicit user choices", async () => {
    const { resolveLocale } = await import("@prismux/client-runtime/locales");
    const { resolveEffectiveSystemLocales, resolveLocaleFromTimezone } = await import("./runtime");
    const { DEFAULT_LOCALE, SUPPORTED_LOCALES } = await import("./locales");

    expect(resolveLocaleFromTimezone("Asia/Shanghai")).toBe("zh");
    expect(resolveLocaleFromTimezone("Asia/Tokyo")).toBe("ja");
    expect(resolveLocaleFromTimezone("Asia/Seoul")).toBe("ko");
    expect(resolveLocaleFromTimezone("Europe/Berlin")).toBe("de");
    expect(resolveLocaleFromTimezone("Europe/Paris")).toBe("fr");
    expect(resolveLocaleFromTimezone("Europe/Madrid")).toBe("es");
    expect(resolveLocaleFromTimezone("America/Sao_Paulo")).toBe("pt-BR");
    expect(resolveLocaleFromTimezone("Europe/Moscow")).toBe("ru");
    expect(resolveLocaleFromTimezone("Europe/Stockholm")).toBe("sv");
    expect(resolveLocaleFromTimezone("America/New_York")).toBeNull();

    // Default "system" mode on Windows Electron (navigator.languages = ["en-US"]) in Asia/Shanghai -> zh
    const cnEffective = resolveEffectiveSystemLocales({
      navigatorLanguages: ["en-US"],
      timeZone: "Asia/Shanghai",
    });
    expect(resolveLocale("system", cnEffective, SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("zh");

    // Default "system" mode in Asia/Tokyo -> ja
    const jpEffective = resolveEffectiveSystemLocales({
      navigatorLanguages: ["en-US"],
      timeZone: "Asia/Tokyo",
    });
    expect(resolveLocale("system", jpEffective, SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("ja");

    // Unsupported/English timezone stays English
    const usEffective = resolveEffectiveSystemLocales({
      navigatorLanguages: ["en-US"],
      timeZone: "America/New_York",
    });
    expect(resolveLocale("system", usEffective, SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("en");

    // Explicit user override ("en" or "fr") is NEVER replaced by timezone detection!
    expect(resolveLocale("en", cnEffective, SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("en");
    expect(resolveLocale("fr", cnEffective, SUPPORTED_LOCALES, DEFAULT_LOCALE)).toBe("fr");
  });
});
