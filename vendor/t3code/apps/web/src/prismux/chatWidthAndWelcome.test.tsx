import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  AgyWelcomeGreeting,
  AgyWelcomeSuggestions,
  DEFAULT_AGY_WELCOME_SUGGESTIONS,
  DEFAULT_AGY_WELCOME_SUGGESTIONS_EN,
  DEFAULT_WELCOME_USER_FALLBACK,
  WELCOME_CLOSING_PROMPTS,
  WELCOME_EASTER_EGG_CHANCE_LATE_NIGHT,
  WELCOME_EASTER_EGG_CHANCE_REGULAR,
  WELCOME_EASTER_EGG_TEXT,
  WELCOME_GREETING_POOLS,
  extractUsernameFromPath,
  formatAgyWelcomeHeadline,
  pickWelcomeGreeting,
  recordWatermarkTap,
  resolveCurrentUserDisplayName,
  resolveWelcomeEasterEggChance,
  resolveWelcomeLanguage,
  resolveWelcomeTimeBand,
  resolveWelcomeWatermarkBrand,
} from "./AgyWelcomeHero";
import {
  DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX,
  MIN_CHAT_CONTENT_WIDTH_PX,
  clampChatWidthPct,
  computeRailHandleOffsets,
  computeSymmetricDragWidth,
  parseStoredChatWidthPct,
  resolveChatContentMaxWidthCss,
} from "./chatWidthController";
import { ChatWidthDragHandles } from "./ChatWidthDragHandles";

describe("chatWidthController — symmetric drag width & rail alignment", () => {
  it("resolves default elongated AGY width (960px) and container-relative custom clamp", () => {
    expect(resolveChatContentMaxWidthCss(0)).toBe(
      `min(100%, ${DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX}px)`,
    );
    expect(resolveChatContentMaxWidthCss(0, "wide")).toBe("min(100%, 1152px)");
    expect(resolveChatContentMaxWidthCss(0, "full")).toBe("calc(100% - 36px)");
    expect(resolveChatContentMaxWidthCss(78)).toBe("clamp(480px, 78%, calc(100% - 36px))");
  });

  it("clamps stored percentages safely into 0 (default) or [45, 100]", () => {
    expect(clampChatWidthPct(0)).toBe(0);
    expect(clampChatWidthPct(-20)).toBe(0);
    expect(clampChatWidthPct(10)).toBe(45);
    expect(clampChatWidthPct(76.6)).toBe(77);
    expect(clampChatWidthPct(140)).toBe(100);
    expect(parseStoredChatWidthPct(null)).toBe(0);
    expect(parseStoredChatWidthPct("not-a-number")).toBe(0);
    expect(parseStoredChatWidthPct("84")).toBe(84);
  });

  it("computes symmetric 2x drag deltas for both left and right edges with safe clamping", () => {
    const expandRight = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: 800,
      deltaX: 60,
      containerInnerWidthPx: 1200,
    });
    expect(expandRight.targetPx).toBe(920);
    expect(expandRight.pct).toBe(77);

    const expandLeft = computeSymmetricDragWidth({
      side: "left",
      startWidthPx: 800,
      deltaX: -60,
      containerInnerWidthPx: 1200,
    });
    expect(expandLeft.targetPx).toBe(920);
    expect(expandLeft.pct).toBe(77);

    const clampedMin = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: 600,
      deltaX: -200,
      containerInnerWidthPx: 1200,
    });
    expect(clampedMin.targetPx).toBe(MIN_CHAT_CONTENT_WIDTH_PX);
    expect(clampedMin.pct).toBe(45);

    const clampedMax = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: 960,
      deltaX: 400,
      containerInnerWidthPx: 1100,
    });
    expect(clampedMax.targetPx).toBe(1100);
    expect(clampedMax.pct).toBe(100);
  });

  it("computes rail handle positions flush with centered column edges and hides on tiny viewports", () => {
    const offsets = computeRailHandleOffsets({
      stageLeft: 260,
      stageWidth: 1200,
      columnLeft: 380,
      columnRight: 1340,
      handleWidth: 14,
    });
    expect(offsets).toEqual({ leftX: 106, rightX: 1080, visible: true });

    const hidden = computeRailHandleOffsets({
      stageLeft: 0,
      stageWidth: 300,
      columnLeft: 10,
      columnRight: 290,
    });
    expect(hidden.visible).toBe(false);
  });

  it("renders accessible left and right data-pmx-chat-width-handle rails", () => {
    const html = renderToStaticMarkup(
      <ChatWidthDragHandles
        stageRef={{ current: null }}
        widthPct={0}
        onCommitWidthPct={vi.fn()}
      />,
    );
    expect(html).toContain('data-pmx-chat-width-handle=""');
    expect(html).toContain('data-side="left"');
    expect(html).toContain('data-side="right"');
    expect(html).toContain('data-mode="rail"');
    expect(html).toContain('role="separator"');
  });
});

describe("AgyWelcomeHero — 6 time bands, bilingual pools, easter egg, dynamic Agent watermark & 5-tap trigger", () => {
  it("extracts real OS username across Windows, macOS, and Linux paths while ignoring system folders", () => {
    expect(extractUsernameFromPath("C:\\Users\\Fish\\.t3\\keybindings.json")).toBe("Fish");
    expect(extractUsernameFromPath("C:/Users/Alice/Projects/Prismux")).toBe("Alice");
    expect(extractUsernameFromPath("/Users/luna/.prismux")).toBe("luna");
    expect(extractUsernameFromPath("/home/devbox/repo")).toBe("devbox");
    expect(extractUsernameFromPath("C:\\Users\\Public\\Documents")).toBeNull();
    expect(extractUsernameFromPath("/Users/Shared/data")).toBeNull();

    expect(
      resolveCurrentUserDisplayName({
        keybindingsConfigPath: "C:\\Users\\Fish\\.t3\\keybindings.json",
        cwd: "D:\\Fish-code\\AGY\\Prismux",
      }),
    ).toBe("Fish");
    expect(resolveCurrentUserDisplayName({ cwd: "D:\\workspace" })).toBeNull();
  });

  it("maps every hour accurately across all 6 local time-of-day bands", () => {
    expect(resolveWelcomeTimeBand(5)).toBe("earlyMorning");
    expect(resolveWelcomeTimeBand(8)).toBe("earlyMorning");
    expect(resolveWelcomeTimeBand(9)).toBe("morning");
    expect(resolveWelcomeTimeBand(11)).toBe("morning");
    expect(resolveWelcomeTimeBand(12)).toBe("midday");
    expect(resolveWelcomeTimeBand(13)).toBe("midday");
    expect(resolveWelcomeTimeBand(14)).toBe("afternoon");
    expect(resolveWelcomeTimeBand(17)).toBe("afternoon");
    expect(resolveWelcomeTimeBand(18)).toBe("evening");
    expect(resolveWelcomeTimeBand(22)).toBe("evening");
    expect(resolveWelcomeTimeBand(23)).toBe("lateNight");
    expect(resolveWelcomeTimeBand(0)).toBe("lateNight");
    expect(resolveWelcomeTimeBand(4)).toBe("lateNight");
  });

  it("formats bilingual greetings across zh/en and falls back unrecognized usernames to User", () => {
    expect(resolveWelcomeLanguage("zh")).toBe("zh");
    expect(resolveWelcomeLanguage("zh-CN")).toBe("zh");
    expect(resolveWelcomeLanguage("en")).toBe("en");
    expect(resolveWelcomeLanguage("en-US")).toBe("en");

    // Morning zh with real username
    const zhMorning = pickWelcomeGreeting({
      hour: 10,
      language: "zh",
      userName: "Fish",
      rng: () => 0.5,
    });
    expect(zhMorning.isEasterEgg).toBe(false);
    expect(zhMorning.timeBand).toBe("morning");
    expect(zhMorning.resolvedUserName).toBe("Fish");
    expect(zhMorning.text).toContain("，Fish。");
    expect(
      WELCOME_GREETING_POOLS.morning.zh.some((g) => zhMorning.text.startsWith(`${g}，Fish。`)),
    ).toBe(true);
    expect(WELCOME_CLOSING_PROMPTS.zh.some((p) => zhMorning.text.endsWith(p))).toBe(true);

    // Afternoon en with missing username -> falls back to "User"
    const enFallback = pickWelcomeGreeting({
      hour: 15,
      language: "en",
      userName: null,
      rng: () => 0.5,
    });
    expect(enFallback.isEasterEgg).toBe(false);
    expect(enFallback.timeBand).toBe("afternoon");
    expect(enFallback.resolvedUserName).toBe(DEFAULT_WELCOME_USER_FALLBACK);
    expect(enFallback.text).toContain(", User. ");
    expect(
      WELCOME_GREETING_POOLS.afternoon.en.some((g) => enFallback.text.startsWith(`${g}, User. `)),
    ).toBe(true);
    expect(WELCOME_CLOSING_PROMPTS.en.some((p) => enFallback.text.endsWith(p))).toBe(true);

    // Legacy helper also falls back to "User"
    expect(formatAgyWelcomeHeadline("Fish", "zh")).toBe("欢迎回来，Fish。我们从哪里继续？");
    expect(formatAgyWelcomeHeadline(null, "zh")).toBe("欢迎回来，User。我们从哪里继续？");
    expect(formatAgyWelcomeHeadline("", "en")).toBe("Welcome back, User. Where should we pick up?");
  });

  it("enforces exact 6% regular (05:00-23:59) and 12% late-night (00:00-04:59) easter-egg probabilities and verbatim text", () => {
    expect(resolveWelcomeEasterEggChance(5)).toBe(WELCOME_EASTER_EGG_CHANCE_REGULAR);
    expect(resolveWelcomeEasterEggChance(14)).toBe(WELCOME_EASTER_EGG_CHANCE_REGULAR);
    expect(resolveWelcomeEasterEggChance(23)).toBe(WELCOME_EASTER_EGG_CHANCE_REGULAR);
    expect(resolveWelcomeEasterEggChance(0)).toBe(WELCOME_EASTER_EGG_CHANCE_LATE_NIGHT);
    expect(resolveWelcomeEasterEggChance(3)).toBe(WELCOME_EASTER_EGG_CHANCE_LATE_NIGHT);
    expect(resolveWelcomeEasterEggChance(4)).toBe(WELCOME_EASTER_EGG_CHANCE_LATE_NIGHT);

    // Regular hour boundary: 0.0599 -> triggers, 0.06 -> normal
    const regHit = pickWelcomeGreeting({
      hour: 14,
      language: "en",
      userName: "Fish",
      rng: () => 0.0599,
    });
    expect(regHit.isEasterEgg).toBe(true);
    expect(regHit.text).toBe(WELCOME_EASTER_EGG_TEXT);

    const regMiss = pickWelcomeGreeting({
      hour: 14,
      language: "zh",
      userName: "Fish",
      rng: () => 0.06,
    });
    expect(regMiss.isEasterEgg).toBe(false);
    expect(regMiss.text).not.toBe(WELCOME_EASTER_EGG_TEXT);

    // Deep night boundary (00:00-04:59): 0.1199 -> triggers, 0.12 -> normal
    const nightHit = pickWelcomeGreeting({
      hour: 2,
      language: "zh",
      userName: "Fish",
      rng: () => 0.1199,
    });
    expect(nightHit.isEasterEgg).toBe(true);
    expect(nightHit.text).toBe(WELCOME_EASTER_EGG_TEXT);

    const nightMiss = pickWelcomeGreeting({
      hour: 2,
      language: "en",
      userName: "Fish",
      rng: () => 0.12,
    });
    expect(nightMiss.isEasterEgg).toBe(false);

    // 23:00 is in lateNight greeting band, yet regular 05:00-23:59 6% easter probability
    const hour23Miss = pickWelcomeGreeting({
      hour: 23,
      language: "zh",
      userName: "Fish",
      rng: () => 0.09,
    });
    expect(hour23Miss.timeBand).toBe("lateNight");
    expect(hour23Miss.isEasterEgg).toBe(false);
  });

  it("switches dynamic Agent watermark logo by provider and falls back to Prismux prism SVG", () => {
    expect(resolveWelcomeWatermarkBrand(["codex"])).toBe("codex");
    expect(resolveWelcomeWatermarkBrand(["claudeAgent"])).toBe("claude-code");
    expect(resolveWelcomeWatermarkBrand(["antigravity"])).toBe("antigravity");
    expect(resolveWelcomeWatermarkBrand(["acpRegistry", "oh-my-pi"])).toBe("omp");
    expect(resolveWelcomeWatermarkBrand(["acpRegistry", "gemini-cli"])).toBe("gemini");
    expect(resolveWelcomeWatermarkBrand(["opencode"])).toBe("opencode");
    expect(resolveWelcomeWatermarkBrand(["cursor"])).toBe("cursor");
    expect(resolveWelcomeWatermarkBrand([null, undefined, ""])).toBe("prismux");

    const codexHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName="Fish"
        provider="codex"
        locale="zh"
        initialDate={new Date(2026, 5, 1, 10, 0)}
        rng={() => 0.5}
      />,
    );
    expect(codexHtml).toContain('data-pmx-welcome-watermark="1"');
    expect(codexHtml).toContain('data-pmx-welcome-watermark-brand="codex"');
    expect(codexHtml).toContain('data-agent-brand="codex"');
    expect(codexHtml).toContain('data-pmx-welcome-band="morning"');
    expect(codexHtml).toContain('data-pmx-welcome-lang="zh"');
    expect(codexHtml).toContain("Fish");
    // Refined single-line headline typography scale without text-balance forced wrapping
    expect(codexHtml).toContain("text-[clamp(1.05rem,1.55vw,1.375rem)]");
    expect(codexHtml).not.toContain("text-balance");

    const claudeHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName={null}
        provider="claudeAgent"
        locale="en"
        initialDate={new Date(2026, 5, 1, 20, 0)}
        rng={() => 0.5}
      />,
    );
    expect(claudeHtml).toContain('data-pmx-welcome-watermark-brand="claude-code"');
    expect(claudeHtml).toContain('data-agent-brand="claude-code"');
    expect(claudeHtml).toContain('data-pmx-welcome-band="evening"');
    expect(claudeHtml).toContain('data-pmx-welcome-lang="en"');
    expect(claudeHtml).toContain("User");

    const fallbackPrismHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName="Fish"
        locale="zh"
        initialDate={new Date(2026, 5, 1, 12, 30)}
        rng={() => 0.5}
      />,
    );
    expect(fallbackPrismHtml).toContain('data-pmx-welcome-watermark-brand="prismux"');
    expect(fallbackPrismHtml).toContain("<svg");
  });

  it("triggers secret easter egg on 5 rapid watermark taps within 1800ms and renders verbatim easter egg", () => {
    let taps: readonly number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = recordWatermarkTap(taps, 1000 + i * 250);
      expect(res.triggered).toBe(false);
      taps = res.timestamps;
    }
    expect(taps).toHaveLength(4);

    // 5th tap within 1800ms triggers immediately and resets tap buffer
    const fifth = recordWatermarkTap(taps, 1950);
    expect(fifth.triggered).toBe(true);
    expect(fifth.timestamps).toHaveLength(0);

    // Stale taps outside 1800ms window expire and do not trigger
    const afterExpiry = recordWatermarkTap([1000, 1200, 1400, 1600], 5000);
    expect(afterExpiry.triggered).toBe(false);
    expect(afterExpiry.timestamps).toEqual([5000]);

    // Rendered forced easter egg state outputs exact verbatim string even in English locale
    const easterHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName="Fish"
        provider="antigravity"
        locale="en"
        initialDate={new Date(2026, 5, 1, 10, 0)}
        rng={() => 0.99}
        forceEasterEgg
      />,
    );
    expect(easterHtml).toContain('data-pmx-welcome-easter-egg="1"');
    expect(WELCOME_EASTER_EGG_TEXT).toBe(
      "雑魚〜♡ ご主人ったら、就凭这点本事到底打算干嘛呀～？ぷぷっ♡",
    );
    expect(easterHtml).toContain(WELCOME_EASTER_EGG_TEXT);
    expect(easterHtml).toContain('data-pmx-welcome-watermark-brand="antigravity"');

    // Suggestions render cleanly in both zh and en
    const zhSuggestionsHtml = renderToStaticMarkup(<AgyWelcomeSuggestions locale="zh" />);
    expect(zhSuggestionsHtml).toContain('data-pmx-welcome-suggestions="1"');
    for (const item of DEFAULT_AGY_WELCOME_SUGGESTIONS) {
      expect(zhSuggestionsHtml).toContain(item.label);
    }
    const enSuggestionsHtml = renderToStaticMarkup(<AgyWelcomeSuggestions locale="en" />);
    for (const item of DEFAULT_AGY_WELCOME_SUGGESTIONS_EN) {
      expect(enSuggestionsHtml).toContain(item.label);
    }
  });
});
