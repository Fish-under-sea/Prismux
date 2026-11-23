import { ArrowUpRightIcon, SparklesIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { getI18nSnapshot, subscribeI18n } from "../i18n/runtime";
import { cn } from "../lib/utils";
import { AgentBrandLogo, resolveAgentBrandId, type AgentBrandId } from "./agentBrand";

const SYSTEM_USER_FOLDER_NAMES = new Set([
  "public",
  "default",
  "default user",
  "all users",
  "shared",
  "root",
  "guest",
  "administrator",
]);

export const DEFAULT_WELCOME_USER_FALLBACK = "User";

export const WELCOME_EASTER_EGG_TEXT =
  "雑魚〜♡ ご主人ったら、就凭这点本事到底打算干嘛呀～？ぷぷっ♡";

export const WELCOME_EASTER_EGG_CHANCE_REGULAR = 0.06;
export const WELCOME_EASTER_EGG_CHANCE_LATE_NIGHT = 0.12;
export const WELCOME_LOGO_EASTER_TAP_THRESHOLD = 5;
export const WELCOME_LOGO_EASTER_TAP_WINDOW_MS = 1800;

export type WelcomeLanguage = "zh" | "en";

export type WelcomeTimeBand =
  | "earlyMorning"
  | "morning"
  | "midday"
  | "afternoon"
  | "evening"
  | "lateNight";

export type WelcomeWatermarkBrandId = Exclude<AgentBrandId, "custom"> | "prismux";

export const WELCOME_GREETING_POOLS: Readonly<
  Record<WelcomeTimeBand, Readonly<Record<WelcomeLanguage, readonly string[]>>>
> = {
  // 05:00–08:59
  earlyMorning: {
    zh: ["早安", "早上好", "早八人报道", "早起鸟上线啦", "晨光正好", "满血复活的一天"],
    en: [
      "Good morning",
      "Rise and shine",
      "Early bird online",
      "Fresh caffeine boost",
      "New day, clean slate",
    ],
  },
  // 09:00–11:59
  morning: {
    zh: ["上午好", "很高兴见到你", "欢迎回来", "电量满格", "进入心流模式", "今日份灵感已送达"],
    en: [
      "Good morning",
      "Welcome back",
      "Great to see you",
      "Full battery mode",
      "Flow state ready",
      "Let's lock in",
    ],
  },
  // 12:00–13:59
  midday: {
    zh: ["中午好", "干饭时间到", "午间摸鱼时刻", "能量补给中", "记得好好吃饭呀"],
    en: [
      "Happy midday",
      "Lunch break check-in",
      "Midday recharge",
      "Fueling up",
      "Good afternoon",
    ],
  },
  // 14:00–17:59
  afternoon: {
    zh: ["下午好", "欢迎回来", "续杯冰美式", "拒绝下午犯困", "午后高能时段", "很高兴见到你"],
    en: [
      "Good afternoon",
      "Welcome back",
      "Coffee refill time",
      "Afternoon sprint",
      "Beat the afternoon slump",
    ],
  },
  // 18:00–22:59
  evening: {
    zh: ["晚上好", "黄金写码时间", "夜晚高产模式", "欢迎回到秘密基地", "辛苦了一天"],
    en: ["Good evening", "Welcome back", "Prime coding hours", "Evening flow", "Back at HQ"],
  },
  // 23:00–04:59
  lateNight: {
    zh: [
      "夜猫子上线",
      "深夜修仙中",
      "熬夜冠军",
      "月亮不睡你不睡",
      "凌晨档灵感爆棚",
      "夜深了",
      "熬夜也要爱惜头发哦",
    ],
    en: [
      "Night owl online",
      "Burning the midnight oil",
      "Late-night legend",
      "Still up",
      "3 AM inspiration mode",
      "Quiet hours, loud ideas",
    ],
  },
};

export const WELCOME_CLOSING_PROMPTS: Readonly<Record<WelcomeLanguage, readonly string[]>> = {
  zh: [
    "接下来做什么？",
    "我们从哪里继续？",
    "今天打算整点什么活？",
    "今天要爆改点什么？",
    "先拿哪个 Bug 开刀？",
    "又有什么奇思妙想？",
    "准备好发车了吗？",
  ],
  en: [
    "What's next?",
    "Where should we pick up?",
    "What are we shipping today?",
    "Which bug goes first?",
    "Got a wild idea to build?",
    "Ready to lock in?",
  ],
};

export interface WelcomeUserNameSources {
  readonly explicitName?: string | null | undefined;
  readonly keybindingsConfigPath?: string | null | undefined;
  readonly scratchWorkspaceRoot?: string | null | undefined;
  readonly newProjectsRoot?: string | null | undefined;
  readonly cwd?: string | null | undefined;
  readonly hostname?: string | null | undefined;
}

/**
 * Extracts the current OS username from real local paths (Windows `C:\Users\<name>`,
 * macOS `/Users/<name>`, Linux `/home/<name>`), skipping generic OS directories.
 */
export function extractUsernameFromPath(filePath: string | null | undefined): string | null {
  if (typeof filePath !== "string") return null;
  const trimmed = filePath.trim();
  if (!trimmed) return null;

  const patterns = [
    /^[A-Za-z]:[\\/]Users[\\/]([^\\/]+)/i,
    /^\/Users\/([^/]+)/,
    /^\/home\/([^/]+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed);
    const candidate = match?.[1]?.trim();
    if (candidate && !SYSTEM_USER_FOLDER_NAMES.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolves a friendly current user display name for the AGY 2.0 welcome hero greeting.
 * Returns `null` when unavailable so callers can apply the canonical `"User"` fallback.
 */
export function resolveCurrentUserDisplayName(sources: WelcomeUserNameSources): string | null {
  const explicit = sources.explicitName?.trim();
  if (explicit) return explicit;

  for (const pathCandidate of [
    sources.keybindingsConfigPath,
    sources.scratchWorkspaceRoot,
    sources.newProjectsRoot,
    sources.cwd,
  ]) {
    const extracted = extractUsernameFromPath(pathCandidate);
    if (extracted) return extracted;
  }

  return null;
}

export function resolveWelcomeLanguage(rawLocale: string | null | undefined): WelcomeLanguage {
  const normalized = (rawLocale ?? "").trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  if (typeof document !== "undefined") {
    const docLang = (document.documentElement.lang ?? "").trim().toLowerCase();
    if (docLang.startsWith("zh")) return "zh";
    if (docLang.startsWith("en")) return "en";
  }
  if (typeof navigator !== "undefined") {
    const navLang = (navigator.language ?? "").trim().toLowerCase();
    if (navLang.startsWith("zh")) return "zh";
  }
  return "en";
}

function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 9;
  const floored = Math.floor(hour);
  return ((floored % 24) + 24) % 24;
}

/**
 * Maps local system hour (`0..23`) into the 6 approved time-of-day greeting bands:
 * - `05:00–08:59`: `earlyMorning`
 * - `09:00–11:59`: `morning`
 * - `12:00–13:59`: `midday`
 * - `14:00–17:59`: `afternoon`
 * - `18:00–22:59`: `evening`
 * - `23:00–04:59`: `lateNight`
 */
export function resolveWelcomeTimeBand(hour: number): WelcomeTimeBand {
  const h = normalizeHour(hour);
  if (h >= 5 && h <= 8) return "earlyMorning";
  if (h >= 9 && h <= 11) return "morning";
  if (h >= 12 && h <= 13) return "midday";
  if (h >= 14 && h <= 17) return "afternoon";
  if (h >= 18 && h <= 22) return "evening";
  return "lateNight";
}

/**
 * Resolves the hidden easter-egg trigger chance by local hour:
 * - `00:00–04:59`: `12%` (`0.12`)
 * - `05:00–23:59`: `6%` (`0.06`)
 */
export function resolveWelcomeEasterEggChance(hour: number): number {
  const h = normalizeHour(hour);
  return h >= 0 && h <= 4
    ? WELCOME_EASTER_EGG_CHANCE_LATE_NIGHT
    : WELCOME_EASTER_EGG_CHANCE_REGULAR;
}

function pickFromPool<T>(pool: readonly T[], roll: number): T {
  const clamped = Number.isFinite(roll) ? Math.max(0, Math.min(0.9999999, roll)) : 0;
  const idx = Math.floor(clamped * pool.length);
  return pool[idx] ?? pool[0]!;
}

export interface WelcomeGreetingRolls {
  readonly hour: number;
  readonly easterRoll: number;
  readonly greetingRoll: number;
  readonly promptRoll: number;
}

export interface ResolvedWelcomeGreeting {
  readonly text: string;
  readonly isEasterEgg: boolean;
  readonly timeBand: WelcomeTimeBand;
  readonly language: WelcomeLanguage;
  readonly resolvedUserName: string;
}

export function createWelcomeGreetingRolls(
  date: Date = new Date(),
  rng: () => number = Math.random,
): WelcomeGreetingRolls {
  return {
    hour: date.getHours(),
    easterRoll: rng(),
    greetingRoll: rng(),
    promptRoll: rng(),
  };
}

export function formatWelcomeHeadlineLine(input: {
  readonly language: WelcomeLanguage;
  readonly greeting: string;
  readonly userName: string | null | undefined;
  readonly prompt: string;
}): string {
  const resolvedUser = input.userName?.trim() || DEFAULT_WELCOME_USER_FALLBACK;
  if (input.language === "zh") {
    return `${input.greeting}，${resolvedUser}。${input.prompt}`;
  }
  return `${input.greeting}, ${resolvedUser}. ${input.prompt}`;
}

export function resolveWelcomeGreetingFromRolls(input: {
  readonly rolls: WelcomeGreetingRolls;
  readonly language: WelcomeLanguage;
  readonly userName?: string | null | undefined;
  readonly forceEasterEgg?: boolean | undefined;
}): ResolvedWelcomeGreeting {
  const timeBand = resolveWelcomeTimeBand(input.rolls.hour);
  const resolvedUserName = input.userName?.trim() || DEFAULT_WELCOME_USER_FALLBACK;
  const chance = resolveWelcomeEasterEggChance(input.rolls.hour);
  const isEasterEgg = Boolean(input.forceEasterEgg) || input.rolls.easterRoll < chance;

  if (isEasterEgg) {
    return {
      text: WELCOME_EASTER_EGG_TEXT,
      isEasterEgg: true,
      timeBand,
      language: input.language,
      resolvedUserName,
    };
  }

  const greetingPool = WELCOME_GREETING_POOLS[timeBand][input.language];
  const promptPool = WELCOME_CLOSING_PROMPTS[input.language];
  const greeting = pickFromPool(greetingPool, input.rolls.greetingRoll);
  const prompt = pickFromPool(promptPool, input.rolls.promptRoll);

  return {
    text: formatWelcomeHeadlineLine({
      language: input.language,
      greeting,
      userName: resolvedUserName,
      prompt,
    }),
    isEasterEgg: false,
    timeBand,
    language: input.language,
    resolvedUserName,
  };
}

export function pickWelcomeGreeting(input: {
  readonly hour: number;
  readonly language: WelcomeLanguage;
  readonly userName?: string | null | undefined;
  readonly rng?: (() => number) | undefined;
  readonly forceEasterEgg?: boolean | undefined;
}): ResolvedWelcomeGreeting {
  const rng = input.rng ?? Math.random;
  return resolveWelcomeGreetingFromRolls({
    rolls: {
      hour: input.hour,
      easterRoll: rng(),
      greetingRoll: rng(),
      promptRoll: rng(),
    },
    language: input.language,
    userName: input.userName,
    forceEasterEgg: input.forceEasterEgg,
  });
}

/**
 * Legacy helper kept for backward compatibility; defaults missing username to `"User"`.
 */
export function formatAgyWelcomeHeadline(
  userName: string | null | undefined,
  language: WelcomeLanguage = "zh",
): string {
  return formatWelcomeHeadlineLine({
    language,
    greeting: language === "zh" ? "欢迎回来" : "Welcome back",
    userName,
    prompt: language === "zh" ? "我们从哪里继续？" : "Where should we pick up?",
  });
}

/**
 * Resolves which watermark logo to render above the welcome greeting.
 * Inspects provider hints (`driverKind`, `instanceId`, `displayName`) in priority order,
 * falling back to `"prismux"` when no specific Agent is active.
 */
export function resolveWelcomeWatermarkBrand(
  providerHints: ReadonlyArray<string | null | undefined>,
): WelcomeWatermarkBrandId {
  let sawAcp = false;
  for (const hint of providerHints) {
    if (typeof hint !== "string" || hint.trim().length === 0) continue;
    const brand = resolveAgentBrandId(hint);
    if (brand !== "custom" && brand !== "acp") {
      return brand;
    }
    if (brand === "acp") {
      sawAcp = true;
    }
  }
  return sawAcp ? "acp" : "prismux";
}

export interface WatermarkTapResult {
  readonly timestamps: readonly number[];
  readonly triggered: boolean;
}

/**
 * Pure rolling-window tap counter for the secret 5-tap easter egg summoner.
 */
export function recordWatermarkTap(
  previousTimestamps: readonly number[],
  nowMs: number,
  threshold: number = WELCOME_LOGO_EASTER_TAP_THRESHOLD,
  windowMs: number = WELCOME_LOGO_EASTER_TAP_WINDOW_MS,
): WatermarkTapResult {
  const cutoff = nowMs - windowMs;
  const active = previousTimestamps.filter((ts) => ts >= cutoff && ts <= nowMs);
  active.push(nowMs);
  if (active.length >= threshold) {
    return { timestamps: [], triggered: true };
  }
  return { timestamps: active, triggered: false };
}

export interface AgyWelcomeSuggestionItem {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly action?: () => void;
}

export const DEFAULT_AGY_WELCOME_SUGGESTIONS: readonly AgyWelcomeSuggestionItem[] = [
  {
    id: "review-recent-changes",
    label: "梳理当前工作区最近的代码改动与潜在风险",
    prompt: "请帮我梳理当前工作区最近的代码改动，指出潜在风险与缺失的测试点。",
  },
  {
    id: "diagnose-and-fix",
    label: "排查最新报错并给出最小可行修复方案",
    prompt: "请协助我定位当前项目的最新报错根因，并给出最小入侵的修复与验证步骤。",
  },
  {
    id: "plan-next-milestone",
    label: "制定下一阶段的模块化重构与回归验证计划",
    prompt: "请基于当前仓库结构，为下一阶段核心目标制定清晰的模块化实施与验收计划。",
  },
];

export const DEFAULT_AGY_WELCOME_SUGGESTIONS_EN: readonly AgyWelcomeSuggestionItem[] = [
  {
    id: "review-recent-changes",
    label: "Summarize recent workspace changes and highlight risks",
    prompt:
      "Summarize the latest changes in this workspace and highlight any potential risks or missing test coverage.",
  },
  {
    id: "diagnose-and-fix",
    label: "Diagnose the latest error and propose a minimal fix",
    prompt:
      "Help diagnose the root cause of the latest error in this project and propose a minimal fix with verification steps.",
  },
  {
    id: "plan-next-milestone",
    label: "Draft a modular refactor and verification plan",
    prompt:
      "Review the current repository structure and draft a clear modular implementation and regression test plan.",
  },
];

const WELCOME_HERO_STYLE_ID = "pmx-welcome-hero-styles";

const WELCOME_HERO_ANIMATION_CSS = `
@keyframes pmx-welcome-watermark-in {
  0% {
    opacity: 0;
    transform: scale(0.92);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes pmx-welcome-easter-pop {
  0% {
    opacity: 0.45;
    transform: translateY(4px) scale(0.97);
  }
  65% {
    opacity: 1;
    transform: translateY(-2px) scale(1.018);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.pmx-welcome-watermark-enter {
  animation: pmx-welcome-watermark-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.pmx-welcome-easter-enter {
  animation: pmx-welcome-easter-pop 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  .pmx-welcome-watermark-enter,
  .pmx-welcome-easter-enter {
    animation: none !important;
    transition: none !important;
  }
}
`;

function ensureWelcomeHeroStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(WELCOME_HERO_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = WELCOME_HERO_STYLE_ID;
  style.textContent = WELCOME_HERO_ANIMATION_CSS;
  document.head.appendChild(style);
}

function PrismuxPrismWatermarkSvg({ size }: { readonly size: number }) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradId = `pmx-prism-wm-${rawId}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className="block shrink-0"
    >
      <defs>
        <linearGradient id={gradId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.65" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <path
        d="M32 6L54 19V45L32 58L10 45V19L32 6Z"
        stroke={`url(#${gradId})`}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M32 6V32M32 32L54 19M32 32L10 19M32 32V58"
        stroke={`url(#${gradId})`}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.72"
      />
      <polygon
        points="32,16 44,23 32,30 20,23"
        fill="currentColor"
        opacity="0.22"
      />
    </svg>
  );
}

export interface AgyWelcomeGreetingProps {
  readonly userName: string | null | undefined;
  /** Active provider driver / brand ID (e.g. `codex`, `claudeAgent`, `antigravity`, `omp`, `gemini`). */
  readonly provider?: string | null | undefined;
  /** Optional provider instance ID for ACP entries (e.g. `oh-my-pi`, `gemini-cli`). */
  readonly providerInstanceId?: string | null | undefined;
  /** Optional provider display name fallback for brand resolution. */
  readonly providerDisplayName?: string | null | undefined;
  /** Optional explicit locale override (`zh` / `en`); defaults to active GT UI locale. */
  readonly locale?: string | null | undefined;
  /** Optional fixed date/hour or RNG injection (primarily for deterministic tests). */
  readonly initialDate?: Date | undefined;
  readonly rng?: (() => number) | undefined;
  readonly forceEasterEgg?: boolean | undefined;
  readonly subtitle?: ReactNode;
  readonly className?: string;
}

export function useWelcomeLanguage(localeOverride?: string | null | undefined): WelcomeLanguage {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot, getI18nSnapshot);
  return resolveWelcomeLanguage(localeOverride ?? locale);
}

/**
 * Open, wallpaper-friendly center-stage AGY 2.0 welcome hero:
 * - Dynamic translucent Agent watermark logo (`68px`, `opacity ~0.28`, subtle frosted aura; falls back to Prismux prism)
 * - Secret 5-tap watermark summoner (within 1.8s) forces the hidden easter egg with gentle spring motion
 * - 6 time-of-day bilingual greeting pools locked once per mount (zero flicker while typing)
 */
export const AgyWelcomeGreeting = memo(function AgyWelcomeGreeting({
  userName,
  provider,
  providerInstanceId,
  providerDisplayName,
  locale: localeOverride,
  initialDate,
  rng,
  forceEasterEgg: forceEasterEggProp = false,
  subtitle,
  className,
}: AgyWelcomeGreetingProps) {
  const language = useWelcomeLanguage(localeOverride);

  // Lock rolls once on mount so typing never jitters or re-rolls the greeting.
  const [rolls] = useState<WelcomeGreetingRolls>(() =>
    createWelcomeGreetingRolls(initialDate ?? new Date(), rng ?? Math.random),
  );
  const [manualEasterEgg, setManualEasterEgg] = useState<boolean>(false);
  const [easterPulseSeq, setEasterPulseSeq] = useState<number>(0);
  const tapTimestampsRef = useRef<readonly number[]>([]);

  useEffect(() => {
    ensureWelcomeHeroStyles();
  }, []);

  const watermarkBrand = useMemo(
    () => resolveWelcomeWatermarkBrand([provider, providerInstanceId, providerDisplayName]),
    [provider, providerInstanceId, providerDisplayName],
  );

  const resolvedGreeting = useMemo(
    () =>
      resolveWelcomeGreetingFromRolls({
        rolls,
        language,
        userName,
        forceEasterEgg: forceEasterEggProp || manualEasterEgg,
      }),
    [forceEasterEggProp, language, manualEasterEgg, rolls, userName],
  );

  const handleWatermarkClick = useCallback(() => {
    const result = recordWatermarkTap(tapTimestampsRef.current, Date.now());
    tapTimestampsRef.current = result.timestamps;
    if (result.triggered) {
      setManualEasterEgg(true);
      setEasterPulseSeq((seq) => seq + 1);
    }
  }, []);

  const watermarkLabel =
    watermarkBrand === "prismux" ? "Prismux" : watermarkBrand;

  return (
    <div
      data-pmx-welcome-hero="1"
      data-pmx-welcome-lang={resolvedGreeting.language}
      data-pmx-welcome-band={resolvedGreeting.timeBand}
      data-pmx-welcome-easter-egg={resolvedGreeting.isEasterEgg ? "1" : "0"}
      className={cn(
        "pointer-events-none mx-auto flex w-full max-w-4xl flex-col items-center justify-center px-5 text-center select-none",
        className,
      )}
    >
      {/* Dynamic translucent Agent / Prismux watermark logo (stealth 5-tap easter egg summoner) */}
      <button
        type="button"
        data-pmx-welcome-watermark="1"
        data-pmx-welcome-watermark-brand={watermarkBrand}
        data-pmx-welcome-watermark-trigger="1"
        aria-label={watermarkLabel}
        onClick={handleWatermarkClick}
        className={cn(
          "pointer-events-auto relative mb-4 inline-flex size-[72px] cursor-default appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-foreground/90 opacity-[0.28] transition-[opacity,transform,filter] duration-200",
          "hover:opacity-[0.38] active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40",
          "drop-shadow-[0_4px_20px_rgba(255,255,255,0.14)] dark:drop-shadow-[0_6px_24px_rgba(0,0,0,0.45)]",
          "[[data-pmx-glass='1']_&]:drop-shadow-[0_4px_22px_rgba(255,255,255,0.2)]",
        )}
      >
        <span
          key={watermarkBrand}
          className="pmx-welcome-watermark-enter inline-flex items-center justify-center"
        >
          {watermarkBrand === "prismux" ? (
            <PrismuxPrismWatermarkSvg size={68} />
          ) : (
            <AgentBrandLogo
              provider={watermarkBrand}
              online
              breathing={false}
              size={68}
              className="opacity-100"
            />
          )}
        </span>
      </button>

      <h1
        key={resolvedGreeting.isEasterEgg ? `easter-${easterPulseSeq}` : "normal"}
        data-pmx-welcome-headline="1"
        className={cn(
          "font-medium text-[clamp(1.05rem,1.55vw,1.375rem)] leading-snug tracking-[-0.015em] text-foreground",
          resolvedGreeting.isEasterEgg && "pmx-welcome-easter-enter",
          "[[data-pmx-glass='1']_&]:drop-shadow-[0_2px_14px_rgba(0,0,0,0.45)] [[data-pmx-wallpaper='1']_&]:drop-shadow-[0_2px_14px_rgba(0,0,0,0.38)]",
          "[[data-pmx-theme='light'][data-pmx-glass='1']_&]:drop-shadow-[0_1px_10px_rgba(255,255,255,0.65)]",
        )}
      >
        {resolvedGreeting.text}
      </h1>
      {subtitle ? (
        <div className="pointer-events-auto mt-2.5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
});

export interface AgyWelcomeSuggestionsProps {
  readonly suggestions?: readonly AgyWelcomeSuggestionItem[];
  readonly locale?: string | null | undefined;
  readonly onSelectPrompt?: (prompt: string, item: AgyWelcomeSuggestionItem) => void;
  readonly className?: string;
}

/**
 * Bottom-left lightweight prompt suggestions resting gracefully above the elongated AGY composer.
 */
export const AgyWelcomeSuggestions = memo(function AgyWelcomeSuggestions({
  suggestions,
  locale: localeOverride,
  onSelectPrompt,
  className,
}: AgyWelcomeSuggestionsProps) {
  const language = useWelcomeLanguage(localeOverride);
  const resolvedSuggestions =
    suggestions ??
    (language === "zh" ? DEFAULT_AGY_WELCOME_SUGGESTIONS : DEFAULT_AGY_WELCOME_SUGGESTIONS_EN);
  const visible = resolvedSuggestions.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <div
      data-pmx-welcome-suggestions="1"
      role="list"
      aria-label={language === "zh" ? "快捷提问建议" : "Quick prompt suggestions"}
      className={cn(
        "pointer-events-auto mb-3 flex flex-col items-start gap-1.5 px-1",
        className,
      )}
    >
      {visible.map((item) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          data-pmx-welcome-suggestion={item.id}
          onClick={() => {
            if (item.action) {
              item.action();
              return;
            }
            onSelectPrompt?.(item.prompt, item);
          }}
          className={cn(
            "group inline-flex max-w-full cursor-pointer items-center gap-2 rounded-full border border-transparent px-2.5 py-1 text-left text-[12.5px] leading-snug text-foreground/80 transition-all duration-150",
            "hover:border-border/70 hover:bg-muted/55 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "[[data-pmx-glass='1']_&]:bg-background/25 [[data-pmx-glass='1']_&]:backdrop-blur-md [[data-pmx-glass='1']_&]:hover:bg-background/45",
          )}
        >
          <SparklesIcon
            aria-hidden="true"
            className="size-3 shrink-0 text-primary/75 transition-transform duration-150 group-hover:scale-110 group-hover:text-primary"
          />
          <span className="truncate">{item.label}</span>
          <ArrowUpRightIcon
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          />
        </button>
      ))}
    </div>
  );
});
