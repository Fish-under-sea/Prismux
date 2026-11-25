import {
  isAntigravityProvider,
  type DispatchCallerKind,
  type DispatchReasoningEffort,
  type DispatchTaskCategory,
  type DispatchThreadRequest
} from "@prismux/protocol";

export interface RoutedDispatchTarget {
  provider: string;
  modelId: string;
  reasoningEffort: DispatchReasoningEffort;
  taskCategory: DispatchTaskCategory;
  explicitAntigravityRequested: boolean;
  routeReason: string;
}

export interface TaskDispatchRouterOptions {
  /**
   * Default automated worker provider used when remote / unattended callers submit
   * `frontend` or `planning` tasks without explicitly requesting personal AGY.
   * Defaults to `"codex"`.
   */
  defaultRemoteAutomatedProvider?: "codex" | "claudeAgent" | "opencode";
  /**
   * Default model used when `human_desktop` commands Antigravity for `frontend` / `planning`.
   */
  antigravityCommanderModelId?: string;
}

const EXPLICIT_AGY_PATTERNS: readonly RegExp[] = [
  /(?:用|使用|调用|唤醒|交给|让|派给|指定)\s*(?:个人版\s*)?(?:antigravity|agy)\b/i,
  /\b(?:use|call|invoke|ask|dispatch\s+to|assign\s+to)\s+(?:personal\s+)?(?:antigravity|agy)\b/i,
  /\bprovider\s*[:=]\s*(?:antigravity|agy)\b/i,
  /#(?:antigravity|agy)\b/i
];

const BACKEND_HARD_RE =
  /(?:并发|死锁|竞态|架构重构|底层重构|性能优化|内存泄漏|安全审计|分布式|数据库迁移|事务一致|race\s+condition|deadlock|concurrency|architecture\s+refactor|deep\s+debug|security\s+audit|migration|profiling|hard\s+bug)/i;

const PLANNING_RE =
  /(?:方案设计|架构设计|技术方案|拆解任务|需求评审|立项|规划|roadmap|rfc|spec\s+design|plan\s+this|system\s+design|implementation\s+plan)/i;

const FRONTEND_RE =
  /(?:前端|界面|页面|样式|动画|布局|组件|液态玻璃|壁纸|按钮|弹窗|配色|css|tailwind|react|tsx|jsx|ui\/ux|frontend|visual|glassmorphism)/i;

/**
 * Detects whether a free-form prompt explicitly requests personal Antigravity (AGY).
 */
export function detectExplicitAntigravityPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return EXPLICIT_AGY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function canonicalizeProviderId(raw: string): string {
  const trimmed = raw.trim();
  if (isAntigravityProvider(trimmed)) {
    return "antigravity";
  }
  const lower = trimmed.toLowerCase();
  if (lower === "codex" || lower === "openai-codex" || lower === "openai_codex") {
    return "codex";
  }
  if (
    lower === "claudeagent" ||
    lower === "claude-agent" ||
    lower === "claude_agent" ||
    lower === "claude-code" ||
    lower === "claudecode" ||
    lower === "claude"
  ) {
    return "claudeAgent";
  }
  if (lower === "opencode" || lower === "open-code" || lower === "open_code") {
    return "opencode";
  }
  if (lower === "dsh" || lower === "dsh-next") {
    return "dsh";
  }
  if (lower === "gemini" || lower === "gemini-api" || lower === "gemini_api") {
    return "gemini";
  }
  return trimmed;
}

function defaultModelForProvider(
  provider: string,
  taskCategory: DispatchTaskCategory,
  agyModelId: string
): { modelId: string; reasoningEffort: DispatchReasoningEffort } {
  if (provider === "antigravity") {
    return {
      modelId: agyModelId,
      reasoningEffort: "high"
    };
  }
  if (provider === "codex") {
    if (taskCategory === "backend_hard") {
      return { modelId: "gpt-6.2-astra", reasoningEffort: "high" };
    }
    return { modelId: "gpt-6.2-sol", reasoningEffort: "medium" };
  }
  if (provider === "claudeAgent") {
    return {
      modelId:
        taskCategory === "backend_hard" || taskCategory === "planning"
          ? "claude-opus-4-6"
          : "claude-sonnet-4-6",
      reasoningEffort: taskCategory === "backend_hard" ? "high" : "medium"
    };
  }
  if (provider === "opencode") {
    return {
      modelId: "opencode-default",
      reasoningEffort: taskCategory === "backend_hard" ? "high" : "medium"
    };
  }
  if (provider === "dsh") {
    return {
      modelId: "dsh-default",
      reasoningEffort: taskCategory === "backend_hard" ? "high" : "medium"
    };
  }
  if (provider === "gemini") {
    return {
      modelId: "gemini-2.5-pro",
      reasoningEffort: "medium"
    };
  }
  return {
    modelId: "default",
    reasoningEffort: "medium"
  };
}

/**
 * Parameter Backdoor & Difficulty Router:
 * Emits structured `{ provider, modelId, reasoningEffort }` bypassing GUI dropdown manipulation.
 */
export class TaskDispatchRouter {
  private readonly defaultRemoteAutomatedProvider:
    | "codex"
    | "claudeAgent"
    | "opencode";
  private readonly antigravityCommanderModelId: string;

  constructor(options: TaskDispatchRouterOptions = {}) {
    this.defaultRemoteAutomatedProvider =
      options.defaultRemoteAutomatedProvider ?? "codex";
    this.antigravityCommanderModelId =
      options.antigravityCommanderModelId ?? "antigravity-commander";
  }

  inferCategory(prompt: string): DispatchTaskCategory {
    if (BACKEND_HARD_RE.test(prompt)) {
      return "backend_hard";
    }
    if (PLANNING_RE.test(prompt)) {
      return "planning";
    }
    if (FRONTEND_RE.test(prompt)) {
      return "frontend";
    }
    return "backend_standard";
  }

  route(request: Pick<
    DispatchThreadRequest,
    | "prompt"
    | "callerKind"
    | "taskCategory"
    | "provider"
    | "modelId"
    | "reasoningEffort"
    | "explicitAntigravityRequested"
  >): RoutedDispatchTarget {
    const taskCategory: DispatchTaskCategory =
      request.taskCategory && request.taskCategory !== "general"
        ? request.taskCategory
        : this.inferCategory(request.prompt);

    const explicitProviderRaw =
      typeof request.provider === "string" && request.provider.trim().length > 0
        ? canonicalizeProviderId(request.provider)
        : undefined;

    const explicitAntigravityRequested =
      request.explicitAntigravityRequested === true ||
      (explicitProviderRaw !== undefined &&
        isAntigravityProvider(explicitProviderRaw)) ||
      (explicitProviderRaw === undefined &&
        detectExplicitAntigravityPrompt(request.prompt));

    let provider: string;
    let modelId: string;
    let reasoningEffort: DispatchReasoningEffort;
    let routeReason: string;

    if (explicitProviderRaw !== undefined) {
      provider = explicitProviderRaw;
      const defaults = defaultModelForProvider(
        provider,
        taskCategory,
        this.antigravityCommanderModelId
      );
      modelId =
        request.modelId?.trim() || defaults.modelId;
      reasoningEffort = request.reasoningEffort ?? defaults.reasoningEffort;
      routeReason = `Explicit provider override (${provider}/${modelId}, effort=${reasoningEffort}).`;
    } else if (explicitAntigravityRequested) {
      provider = "antigravity";
      const defaults = defaultModelForProvider(
        provider,
        taskCategory,
        this.antigravityCommanderModelId
      );
      modelId = request.modelId?.trim() || defaults.modelId;
      reasoningEffort = request.reasoningEffort ?? defaults.reasoningEffort;
      routeReason = `Caller explicitly requested personal Antigravity (${modelId}); forwarded to AntigravityPolicyGuard.`;
    } else if (taskCategory === "backend_hard") {
      provider = "codex";
      modelId = request.modelId?.trim() || "gpt-6.2-astra";
      reasoningEffort = request.reasoningEffort ?? "high";
      routeReason = "Difficulty router: backend_hard -> codex / gpt-6.2-astra / high.";
    } else if (taskCategory === "backend_standard") {
      provider = "codex";
      modelId = request.modelId?.trim() || "gpt-6.2-sol";
      reasoningEffort = request.reasoningEffort ?? "medium";
      routeReason =
        "Difficulty router: backend_standard -> codex / gpt-6.2-sol / medium.";
    } else {
      // `frontend` or `planning`
      const isHumanDesktop = request.callerKind === "human_desktop";
      if (isHumanDesktop) {
        provider = "antigravity";
        const defaults = defaultModelForProvider(
          provider,
          taskCategory,
          this.antigravityCommanderModelId
        );
        modelId = request.modelId?.trim() || defaults.modelId;
        reasoningEffort = request.reasoningEffort ?? defaults.reasoningEffort;
        routeReason = `Difficulty router: ${taskCategory} from human_desktop -> antigravity commander.`;
      } else {
        provider = this.resolveAutomatedFallbackProvider(request.callerKind);
        const defaults = defaultModelForProvider(
          provider,
          taskCategory,
          this.antigravityCommanderModelId
        );
        modelId = request.modelId?.trim() || defaults.modelId;
        reasoningEffort = request.reasoningEffort ?? defaults.reasoningEffort;
        routeReason = `Difficulty router: ${taskCategory} from non-desktop caller "${request.callerKind}" routed cleanly to automated worker ${provider}/${modelId} without touching personal AGY.`;
      }
    }

    return {
      provider,
      modelId,
      reasoningEffort,
      taskCategory,
      explicitAntigravityRequested,
      routeReason
    };
  }

  private resolveAutomatedFallbackProvider(
    _callerKind: DispatchCallerKind
  ): "codex" | "claudeAgent" | "opencode" {
    return this.defaultRemoteAutomatedProvider;
  }
}
