/**
 * Model-first brand theme detection for the Prismux reasoning-effort slider.
 *
 * Adapted from HanaAyane/dsh-reasoning-effort PR #9 & HaoyueQin/dsh-better-reasoning-effort
 * (MIT License). Model ID / display name always takes precedence over provider so
 * multi-model gateways (OpenRouter, Antigravity, Vertex, Bedrock, OMP) match the true
 * underlying model family.
 */

import {
  REASONING_RUNNER_SPRITES,
  type ReasoningRunnerSpriteKey,
} from './runnerSprites.js';

export type ReasoningModelFamily =
  | 'deepseek'
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'kimi'
  | 'glm'
  | 'qwen'
  | 'minimax';

export interface ReasoningModelThemeDefinition {
  readonly id: ReasoningModelFamily;
  readonly displayName: string;
  readonly spriteKey: ReasoningRunnerSpriteKey;
  readonly spriteUrl: string;
  /** Accessible brand accent for light surfaces (WCAG >= 4.5:1 on #ffffff). */
  readonly accentLight: string;
  /** Accessible brand accent for dark & dark-glass surfaces (WCAG >= 4.5:1 on #0d1524). */
  readonly accentDark: string;
}

export const REASONING_MODEL_THEMES: Readonly<
  Record<ReasoningModelFamily, ReasoningModelThemeDefinition>
> = {
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    spriteKey: 'chibi',
    spriteUrl: REASONING_RUNNER_SPRITES.chibi,
    accentLight: '#2855c9',
    accentDark: '#7ec0ff',
  },
  openai: {
    id: 'openai',
    displayName: 'GPT / Codex',
    spriteKey: 'gpt',
    spriteUrl: REASONING_RUNNER_SPRITES.gpt,
    accentLight: '#6d30c4',
    accentDark: '#c89bff',
  },
  claude: {
    id: 'claude',
    displayName: 'Claude',
    spriteKey: 'claude',
    spriteUrl: REASONING_RUNNER_SPRITES.claude,
    accentLight: '#b34406',
    accentDark: '#ff9b59',
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini / Antigravity',
    spriteKey: 'gemini',
    spriteUrl: REASONING_RUNNER_SPRITES.gemini,
    accentLight: '#5e3ec9',
    accentDark: '#b69eff',
  },
  kimi: {
    id: 'kimi',
    displayName: 'Kimi',
    spriteKey: 'kimi',
    spriteUrl: REASONING_RUNNER_SPRITES.kimi,
    accentLight: '#3450b8',
    accentDark: '#92b4ff',
  },
  glm: {
    id: 'glm',
    displayName: 'GLM',
    spriteKey: 'glm',
    spriteUrl: REASONING_RUNNER_SPRITES.glm,
    accentLight: '#046899',
    accentDark: '#59d2ff',
  },
  qwen: {
    id: 'qwen',
    displayName: 'Qwen',
    spriteKey: 'qwen',
    spriteUrl: REASONING_RUNNER_SPRITES.qwen,
    accentLight: '#1d56c4',
    accentDark: '#80bfff',
  },
  minimax: {
    id: 'minimax',
    displayName: 'MiniMax',
    spriteKey: 'minimax',
    spriteUrl: REASONING_RUNNER_SPRITES.minimax,
    accentLight: '#b83210',
    accentDark: '#ff8a6b',
  },
};

/**
 * Detect model family using modelId & modelName first, then provider fallback.
 * Unknown/generic identifiers default to `'deepseek'` (the generic chibi runner).
 */
export function detectReasoningModelFamily(
  modelId?: string | null,
  modelName?: string | null,
  provider?: string | null,
): ReasoningModelFamily {
  const m = `${modelId ?? ''} ${modelName ?? ''}`.toLowerCase();
  const p = (provider ?? '').toLowerCase();

  // 1. Model ID & display name take precedence (aggregators like OpenRouter / Vertex / Bedrock / Antigravity / OMP)
  if (
    m.includes('claude') ||
    m.includes('anthropic') ||
    m.includes('opus') ||
    m.includes('sonnet') ||
    m.includes('haiku')
  ) {
    return 'claude';
  }

  if (m.includes('gemini') || m.includes('gemma') || m.includes('google')) {
    return 'gemini';
  }

  if (
    m.includes('kimi') ||
    m.includes('moonshot') ||
    m.includes('kimi-k1') ||
    m.includes('kimi-chat')
  ) {
    return 'kimi';
  }

  if (
    m.includes('glm') ||
    m.includes('zcode') ||
    m.includes('zhipu') ||
    m.includes('chatglm') ||
    m.includes('codegeex') ||
    m.includes('cogview')
  ) {
    return 'glm';
  }

  if (
    m.includes('qwen') ||
    m.includes('qwq') ||
    m.includes('tongyi') ||
    m.includes('aliyun') ||
    m.includes('alibaba')
  ) {
    return 'qwen';
  }

  if (
    m.includes('minimax') ||
    m.includes('abab') ||
    m.includes('hailuo') ||
    m.includes('mini-max')
  ) {
    return 'minimax';
  }

  if (
    m.includes('gpt') ||
    m.includes('chatgpt') ||
    m.includes('openai') ||
    m.includes('codex') ||
    m.includes('davinci') ||
    /(?:^|[\b\s/_.-])o[1-9](?:[\b\s/_.-]|$)/.test(m)
  ) {
    return 'openai';
  }

  if (
    m.includes('deepseek') ||
    m.includes('deep-seek') ||
    /(?:^|[\b\s/_.-])r1(?:[\b\s/_.-]|$)/.test(m) ||
    /(?:^|[\b\s/_.-])v3(?:[\b\s/_.-]|$)/.test(m) ||
    /(?:^|[\b\s/_.-])v4(?:[\b\s/_.-]|$)/.test(m)
  ) {
    return 'deepseek';
  }

  // 2. Fall back to provider identifier when model ID is generic / opaque
  if (p.includes('claude') || p.includes('anthropic')) {
    return 'claude';
  }

  if (p.includes('gemini') || p.includes('google') || p.includes('antigravity')) {
    return 'gemini';
  }

  if (p.includes('kimi') || p.includes('moonshot')) {
    return 'kimi';
  }

  if (
    p.includes('zhipu') ||
    p.includes('bigmodel') ||
    p.includes('zcode') ||
    p.includes('glm')
  ) {
    return 'glm';
  }

  if (
    p.includes('qwen') ||
    p.includes('aliyun') ||
    p.includes('alibaba') ||
    p.includes('tongyi') ||
    p.includes('dashscope') ||
    p.includes('bailian')
  ) {
    return 'qwen';
  }

  if (p.includes('minimax') || p.includes('hailuo')) {
    return 'minimax';
  }

  if (p.includes('openai') || p.includes('chatgpt') || p.includes('codex')) {
    return 'openai';
  }

  if (p.includes('deepseek') || p.includes('deep-seek')) {
    return 'deepseek';
  }

  return 'deepseek';
}

/**
 * Resolve the full reasoning slider theme definition (family id, sprite URI, accessible
 * light/dark accents) from a model identifier, optional display name, and provider.
 */
export function resolveReasoningModelTheme(
  modelId?: string | null,
  modelName?: string | null,
  provider?: string | null,
): ReasoningModelThemeDefinition {
  const family = detectReasoningModelFamily(modelId, modelName, provider);
  return REASONING_MODEL_THEMES[family];
}
