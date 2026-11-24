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
  CHAT_WIDTH_PX_STORAGE_KEY,
  CHAT_WIDTH_STORAGE_KEY,
  DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX,
  MAX_CHAT_CONTENT_WIDTH_PX,
  MIN_CHAT_CONTENT_WIDTH_PX,
  clampChatWidthPx,
  computeRailHandleOffsets,
  computeSymmetricDragWidth,
  measureAvailableColumnWidth,
  parseStoredChatWidthPx,
  readStoredChatWidthPx,
  resolveChatContentMaxWidthCss,
  writeStoredChatWidthPx,
} from "./chatWidthController";
import { ChatWidthDragHandles } from "./ChatWidthDragHandles";

describe("chatWidthController — symmetric drag width, nesting safety & rail alignment", () => {
  it("resolves idempotent pixel min(100%, <N>px) CSS values so nested composer containers never compound-shrink", () => {
    expect(resolveChatContentMaxWidthCss(0)).toBe(
      `min(100%, ${DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX}px)`,
    );
    expect(resolveChatContentMaxWidthCss(0, "wide")).toBe("min(100%, 1152px)");
    expect(resolveChatContentMaxWidthCss(0, "full")).toBe("100%");
    // Custom widths MUST emit length-based min(100%, Npx) — never percentage clamp() that collapses across 4 nested layers.
    expect(resolveChatContentMaxWidthCss(1080)).toBe("min(100%, 1080px)");
    expect(resolveChatContentMaxWidthCss(720)).toBe("min(100%, 720px)");
    expect(resolveChatContentMaxWidthCss(1080)).not.toContain("clamp(");
    expect(resolveChatContentMaxWidthCss(720)).not.toMatch(/\b\d{2}%/);
  });

  it("clamps pixel widths safely and self-heals illegal, corrupted, or legacy percentage cache values", () => {
    expect(clampChatWidthPx(0)).toBe(0);
    expect(clampChatWidthPx(-200)).toBe(0);
    expect(clampChatWidthPx(Number.NaN)).toBe(0);
    expect(clampChatWidthPx(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampChatWidthPx(300)).toBe(MIN_CHAT_CONTENT_WIDTH_PX);
    expect(clampChatWidthPx(1042.6)).toBe(1043);
    expect(clampChatWidthPx(9999)).toBe(MAX_CHAT_CONTENT_WIDTH_PX);

    // Illegal / corrupted / legacy-percentage cache values self-heal to 0 (default 960px)
    expect(parseStoredChatWidthPx(null)).toBe(0);
    expect(parseStoredChatWidthPx(undefined)).toBe(0);
    expect(parseStoredChatWidthPx("")).toBe(0);
    expect(parseStoredChatWidthPx("not-a-number")).toBe(0);
    expect(parseStoredChatWidthPx("NaN")).toBe(0);
    expect(parseStoredChatWidthPx("Infinity")).toBe(0);
    expect(parseStoredChatWidthPx("-400")).toBe(0);
    expect(parseStoredChatWidthPx("{}")).toBe(0);
    // Legacy percentage like "78" or tiny bogus value "45" self-heals instead of trapping user at 480px
    expect(parseStoredChatWidthPx("78")).toBe(0);
    expect(parseStoredChatWidthPx("45")).toBe(0);
    // Plausible pixel values clamp safely
    expect(parseStoredChatWidthPx("360")).toBe(MIN_CHAT_CONTENT_WIDTH_PX);
    expect(parseStoredChatWidthPx("1080")).toBe(1080);
    expect(parseStoredChatWidthPx("5000")).toBe(MAX_CHAT_CONTENT_WIDTH_PX);
  });

  it("reads/writes localStorage cleanly, clears stale v1 pct cache, and self-heals corrupt v2 entries", () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    const prevWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      localStorage: fakeStorage,
      dispatchEvent: vi.fn(),
    };
    try {
      // Legacy v1 broken percentage cache gets purged and returns default 0
      store.set(CHAT_WIDTH_STORAGE_KEY, "68");
      expect(readStoredChatWidthPx()).toBe(0);
      expect(store.has(CHAT_WIDTH_STORAGE_KEY)).toBe(false);

      // Corrupted v2 cache self-heals by deleting itself and returning 0
      store.set(CHAT_WIDTH_PX_STORAGE_KEY, "corrupt-width");
      expect(readStoredChatWidthPx()).toBe(0);
      expect(store.has(CHAT_WIDTH_PX_STORAGE_KEY)).toBe(false);

      // Out-of-bounds v2 cache normalizes in place
      store.set(CHAT_WIDTH_PX_STORAGE_KEY, "380");
      expect(readStoredChatWidthPx()).toBe(MIN_CHAT_CONTENT_WIDTH_PX);
      expect(store.get(CHAT_WIDTH_PX_STORAGE_KEY)).toBe(String(MIN_CHAT_CONTENT_WIDTH_PX));

      // Write valid width persists cleanly and clears v1
      store.set(CHAT_WIDTH_STORAGE_KEY, "55");
      expect(writeStoredChatWidthPx(1120)).toBe(1120);
      expect(store.get(CHAT_WIDTH_PX_STORAGE_KEY)).toBe("1120");
      expect(store.has(CHAT_WIDTH_STORAGE_KEY)).toBe(false);
      expect(readStoredChatWidthPx()).toBe(1120);

      // Reset to 0 removes storage key
      expect(writeStoredChatWidthPx(0)).toBe(0);
      expect(store.has(CHAT_WIDTH_PX_STORAGE_KEY)).toBe(false);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  });

  it("computes symmetric 2x drag deltas for both left/right handles (outward widens, inward narrows), sequential drags & bounds", () => {
    // Right handle dragged outward (+60px) -> widens by +120px
    const expandRight = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: 800,
      deltaX: 60,
      containerInnerWidthPx: 1400,
    });
    expect(expandRight.targetPx).toBe(920);
    expect(expandRight.pct).toBe(66);

    // Right handle dragged inward (-80px) -> narrows by -160px (never collapses to 480)
    const shrinkRight = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: expandRight.targetPx,
      deltaX: -80,
      containerInnerWidthPx: 1400,
    });
    expect(shrinkRight.targetPx).toBe(760);

    // Left handle dragged outward (-60px) -> widens by +120px
    const expandLeft = computeSymmetricDragWidth({
      side: "left",
      startWidthPx: shrinkRight.targetPx,
      deltaX: -60,
      containerInnerWidthPx: 1400,
    });
    expect(expandLeft.targetPx).toBe(880);

    // Left handle dragged inward (+50px) -> narrows by -100px
    const shrinkLeft = computeSymmetricDragWidth({
      side: "left",
      startWidthPx: expandLeft.targetPx,
      deltaX: 50,
      containerInnerWidthPx: 1400,
    });
    expect(shrinkLeft.targetPx).toBe(780);

    // Clamps cleanly at minimum (480px) without going negative
    const clampedMin = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: 600,
      deltaX: -200,
      containerInnerWidthPx: 1200,
    });
    expect(clampedMin.targetPx).toBe(MIN_CHAT_CONTENT_WIDTH_PX);
    expect(clampedMin.pct).toBe(40);

    // Clamps cleanly at container inner width maximum
    const clampedMax = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: 960,
      deltaX: 400,
      containerInnerWidthPx: 1100,
    });
    expect(clampedMax.targetPx).toBe(1100);
    expect(clampedMax.pct).toBe(100);

    // Ultra-narrow viewport (< 480px): minPx never exceeds maxPx (no inverted clamp)
    const ultraNarrow = computeSymmetricDragWidth({
      side: "right",
      startWidthPx: 400,
      deltaX: 50,
      containerInnerWidthPx: 400,
    });
    expect(ultraNarrow.targetPx).toBe(400);
    expect(ultraNarrow.pct).toBe(100);
  });

  it("measures true available column width accounting for lane horizontal padding", () => {
    const fakeParent = {
      clientWidth: 1152,
      getBoundingClientRect: () => ({ width: 1152 }),
    } as unknown as HTMLElement;
    const fakeColumn = { parentElement: fakeParent } as unknown as HTMLElement;
    const fakeStage = {
      clientWidth: 1152,
      getBoundingClientRect: () => ({ width: 1152 }),
    } as unknown as HTMLElement;
    const prevGetComputedStyle = (globalThis as Record<string, unknown>).getComputedStyle;
    (globalThis as Record<string, unknown>).getComputedStyle = () => ({
      paddingLeft: "48px",
      paddingRight: "48px",
    });
    try {
      expect(measureAvailableColumnWidth(fakeStage, fakeColumn)).toBe(1056);
      expect(measureAvailableColumnWidth(fakeStage, null)).toBe(1116);
    } finally {
      (globalThis as Record<string, unknown>).getComputedStyle = prevGetComputedStyle;
    }
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
        widthPx={0}
        onCommitWidthPx={vi.fn()}
      />,
    );
    expect(html).toContain('data-pmx-chat-width-handle=""');
    expect(html).toContain('data-side="left"');
    expect(html).toContain('data-side="right"');
    expect(html).toContain('data-mode="rail"');
    expect(html).toContain('role="separator"');
    expect(html).toContain("[-webkit-app-region:no-drag]");
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

  it("renders the welcome hero center Agent logo at full brand saturation without faded watermark opacity", () => {
    const claudeHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName="Fish"
        provider="claudeAgent"
        locale="zh"
        initialDate={new Date(2026, 5, 1, 10, 0)}
        rng={() => 0.5}
      />,
    );
    const buttonMatch = claudeHtml.match(/<button[^>]*data-pmx-welcome-watermark="1"[^>]*>/);
    expect(buttonMatch).not.toBeNull();
    const buttonTag = buttonMatch![0];
    expect(buttonTag).toContain("opacity-100");
    expect(buttonTag).toContain("text-foreground");
    expect(buttonTag).not.toMatch(/opacity-\[?0?\.?(?:2\d|3\d)/);
    expect(buttonTag).toContain('data-pmx-welcome-watermark-trigger="1"');
    expect(claudeHtml).toContain('fill="#d97757"');

    const antigravityHtml = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName="Fish"
        provider="antigravity"
        locale="zh"
        initialDate={new Date(2026, 5, 1, 10, 0)}
        rng={() => 0.5}
      />,
    );
    expect(antigravityHtml).toContain('data-pmx-welcome-watermark-brand="antigravity"');
    expect(antigravityHtml).toContain("#4285F4");
    expect(antigravityHtml).toContain("#EA4335");
    expect(antigravityHtml).toContain("#FBBC04");
    expect(antigravityHtml).toContain("#34A853");
    expect(antigravityHtml).not.toContain("#6366f1");
    expect(antigravityHtml).not.toContain("opacity-[0.28]");
  });
});
