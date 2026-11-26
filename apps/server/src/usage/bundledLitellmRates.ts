/**
 * Bundled offline LiteLLM pricing snapshot used by default in UsageService so
 * zero background requests are sent to GitHub on cold start or routine usage reads.
 * Users can explicitly click "Refresh pricing" (`UsageService.refreshRates`) to
 * fetch live updates from LiteLLM.
 */
export const BUNDLED_LITELLM_RATES_DOCUMENT: Readonly<
  Record<
    string,
    {
      readonly input_cost_per_token: number;
      readonly output_cost_per_token: number;
      readonly cache_read_input_token_cost?: number;
      readonly cache_creation_input_token_cost?: number;
    }
  >
> = {
  // Anthropic Claude
  "claude-opus-4-6": {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 75e-6,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 18.75e-6,
  },
  "claude-sonnet-4-6": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  "claude-opus-4-5": {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 75e-6,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 18.75e-6,
  },
  "claude-sonnet-4-5": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  "claude-haiku-4-5": {
    input_cost_per_token: 0.8e-6,
    output_cost_per_token: 4e-6,
    cache_read_input_token_cost: 0.08e-6,
    cache_creation_input_token_cost: 1e-6,
  },
  "claude-opus-4-1": {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 75e-6,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 18.75e-6,
  },
  "claude-opus-4": {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 75e-6,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 18.75e-6,
  },
  "claude-sonnet-4": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  "claude-3-7-sonnet": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  "claude-3-5-sonnet": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.3e-6,
    cache_creation_input_token_cost: 3.75e-6,
  },
  "claude-3-5-haiku": {
    input_cost_per_token: 0.8e-6,
    output_cost_per_token: 4e-6,
    cache_read_input_token_cost: 0.08e-6,
    cache_creation_input_token_cost: 1e-6,
  },

  // OpenAI / Codex
  "gpt-5.4": {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.25e-6,
  },
  "gpt-5.3-codex": {
    input_cost_per_token: 1.75e-6,
    output_cost_per_token: 14e-6,
    cache_read_input_token_cost: 0.175e-6,
  },
  "gpt-5.2-codex": {
    input_cost_per_token: 1.75e-6,
    output_cost_per_token: 14e-6,
    cache_read_input_token_cost: 0.175e-6,
  },
  "gpt-5.1-codex": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 0.125e-6,
  },
  "gpt-5-codex": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 0.125e-6,
  },
  "gpt-5": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 0.125e-6,
  },
  "gpt-5-mini": {
    input_cost_per_token: 0.25e-6,
    output_cost_per_token: 2e-6,
    cache_read_input_token_cost: 0.025e-6,
  },
  "gpt-4.1": {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 8e-6,
    cache_read_input_token_cost: 0.5e-6,
  },
  "gpt-4.1-mini": {
    input_cost_per_token: 0.4e-6,
    output_cost_per_token: 1.6e-6,
    cache_read_input_token_cost: 0.1e-6,
  },
  "gpt-4o": {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 1.25e-6,
  },
  "gpt-4o-mini": {
    input_cost_per_token: 0.15e-6,
    output_cost_per_token: 0.6e-6,
    cache_read_input_token_cost: 0.075e-6,
  },
  "o3": {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 8e-6,
    cache_read_input_token_cost: 0.5e-6,
  },
  "o3-mini": {
    input_cost_per_token: 1.1e-6,
    output_cost_per_token: 4.4e-6,
    cache_read_input_token_cost: 0.55e-6,
  },
  "o4-mini": {
    input_cost_per_token: 1.1e-6,
    output_cost_per_token: 4.4e-6,
    cache_read_input_token_cost: 0.275e-6,
  },

  // Google Gemini
  "gemini-3-pro": {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 12e-6,
    cache_read_input_token_cost: 0.2e-6,
  },
  "gemini-3-flash": {
    input_cost_per_token: 0.5e-6,
    output_cost_per_token: 3e-6,
    cache_read_input_token_cost: 0.05e-6,
  },
  "gemini-2.5-pro": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 0.31e-6,
  },
  "gemini-2.5-flash": {
    input_cost_per_token: 0.3e-6,
    output_cost_per_token: 2.5e-6,
    cache_read_input_token_cost: 0.075e-6,
  },
  "gemini-2.0-flash": {
    input_cost_per_token: 0.1e-6,
    output_cost_per_token: 0.4e-6,
    cache_read_input_token_cost: 0.025e-6,
  },

  // DeepSeek (DSH / API)
  "deepseek-chat": {
    input_cost_per_token: 0.27e-6,
    output_cost_per_token: 1.1e-6,
    cache_read_input_token_cost: 0.07e-6,
  },
  "deepseek-reasoner": {
    input_cost_per_token: 0.55e-6,
    output_cost_per_token: 2.19e-6,
    cache_read_input_token_cost: 0.14e-6,
  },
  "deepseek-v3": {
    input_cost_per_token: 0.27e-6,
    output_cost_per_token: 1.1e-6,
    cache_read_input_token_cost: 0.07e-6,
  },
  "deepseek-r1": {
    input_cost_per_token: 0.55e-6,
    output_cost_per_token: 2.19e-6,
    cache_read_input_token_cost: 0.14e-6,
  },

  // Kimi / Moonshot, Qwen, GLM, MiniMax
  "kimi-k2": {
    input_cost_per_token: 0.6e-6,
    output_cost_per_token: 2.5e-6,
    cache_read_input_token_cost: 0.15e-6,
  },
  "kimi-k2.5": {
    input_cost_per_token: 0.6e-6,
    output_cost_per_token: 2.5e-6,
    cache_read_input_token_cost: 0.15e-6,
  },
  "qwen3-coder-plus": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 5e-6,
    cache_read_input_token_cost: 0.2e-6,
  },
  "glm-4.7": {
    input_cost_per_token: 0.6e-6,
    output_cost_per_token: 2.2e-6,
    cache_read_input_token_cost: 0.15e-6,
  },
  "MiniMax-M2.5": {
    input_cost_per_token: 0.3e-6,
    output_cost_per_token: 1.2e-6,
    cache_read_input_token_cost: 0.03e-6,
  },
};
