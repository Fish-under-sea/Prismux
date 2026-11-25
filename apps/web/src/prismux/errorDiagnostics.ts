export type ModelErrorCategory =
  | "auth"
  | "quota"
  | "rate_limit"
  | "policy_guard"
  | "model_not_found"
  | "context_limit"
  | "upstream_5xx"
  | "network"
  | "cli_process"
  | "bad_request"
  | "cancelled"
  | "unknown";

export interface DiagnosedModelError {
  readonly category: ModelErrorCategory;
  readonly titleZh: string;
  readonly diagnosisZh: string;
  readonly suggestionsZh: readonly string[];
  readonly statusBadge?: string | undefined;
  readonly rawError: string;
  readonly formattedRawError: string;
}

export interface DiagnoseModelErrorOptions {
  readonly errorClass?: string | null | undefined;
  readonly errorCode?: string | null | undefined;
  readonly providerName?: string | null | undefined;
}

interface ParsedErrorSignals {
  readonly messages: readonly string[];
  readonly codes: readonly string[];
  readonly httpStatus: number | null;
  readonly formattedRawError: string;
}

const KNOWN_HTTP_STATUSES = new Set([
  400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504, 529,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (
    trimmed.length < 2 ||
    ((!trimmed.startsWith("{") || !trimmed.endsWith("}")) &&
      (!trimmed.startsWith("[") || !trimmed.endsWith("]")))
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function extractEmbeddedJson(text: string): {
  readonly prefix: string;
  readonly suffix: string;
  readonly parsed: unknown;
} | null {
  const direct = tryParseJson(text);
  if (direct !== undefined) {
    return { prefix: "", suffix: "", parsed: direct };
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  const candidate = text.slice(firstBrace, lastBrace + 1);
  const parsed = tryParseJson(candidate);
  if (parsed === undefined) {
    return null;
  }
  return {
    prefix: text.slice(0, firstBrace).trim(),
    suffix: text.slice(lastBrace + 1).trim(),
    parsed,
  };
}

function normalizeHttpStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && KNOWN_HTTP_STATUSES.has(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{3}$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (KNOWN_HTTP_STATUSES.has(numeric)) {
        return numeric;
      }
    }
  }
  return null;
}

function extractHttpStatusFromText(text: string): number | null {
  const patterns: readonly RegExp[] = [
    /\bHTTP(?:\/[\d.]+)?\s*(400|401|402|403|404|408|409|413|422|429|500|502|503|504|529)\b/i,
    /\bstatus(?:\s*code)?\s*[:=]\s*(400|401|402|403|404|408|409|413|422|429|500|502|503|504|529)\b/i,
    /(?:^|[\s:(])(?:api\s+error|request\s+failed|failed\s+with\s+status(?:\s+code)?|error)\s*[:(\s]+(400|401|402|403|404|408|409|413|422|429|500|502|503|504|529)\b/i,
    /^\s*(400|401|402|403|404|408|409|413|422|429|500|502|503|504|529)(?:\s+[\p{L}{[]|\s*:)/u,
    /\b(400)\s+bad\s+request\b/i,
    /\b(401)\s+unauthori[sz]ed\b/i,
    /\b(402)\s+payment\s+required\b/i,
    /\b(403)\s+forbidden\b/i,
    /\b(404)\s+not\s+found\b/i,
    /\b(408)\s+request\s+timeout\b/i,
    /\b(413)\s+(?:payload|request\s+entity)\s+too\s+large\b/i,
    /\b(422)\s+unprocessable\b/i,
    /\b(429)\s+too\s+many\s+requests\b/i,
    /\b(500)\s+internal\s+server\s+error\b/i,
    /\b(502)\s+bad\s+gateway\b/i,
    /\b(503)\s+service\s+unavailable\b/i,
    /\b(504)\s+gateway\s+time-?out\b/i,
    /\b(529)\s+(?:overloaded|site\s+is\s+overloaded)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const status = Number(match[1]);
      if (KNOWN_HTTP_STATUSES.has(status)) {
        return status;
      }
    }
  }
  return null;
}

function collectPayloadSignals(
  value: unknown,
  messages: string[],
  codes: string[],
  state: { httpStatus: number | null },
  depth: number,
): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (state.httpStatus === null) {
      state.httpStatus = extractHttpStatusFromText(trimmed);
    }
    const embedded = extractEmbeddedJson(trimmed);
    if (embedded) {
      if (embedded.prefix) {
        messages.push(embedded.prefix);
        if (state.httpStatus === null) {
          state.httpStatus = extractHttpStatusFromText(embedded.prefix);
        }
      }
      collectPayloadSignals(embedded.parsed, messages, codes, state, depth + 1);
      return;
    }
    messages.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPayloadSignals(item, messages, codes, state, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const statusKey of ["status", "statusCode", "status_code", "httpStatus", "http_status", "code"]) {
    if (statusKey in value) {
      const candidate = value[statusKey];
      const numeric = normalizeHttpStatus(candidate);
      if (numeric !== null && state.httpStatus === null) {
        state.httpStatus = numeric;
      }
      if (typeof candidate === "string" && candidate.trim()) {
        codes.push(candidate.trim());
      } else if (typeof candidate === "number" && Number.isFinite(candidate)) {
        codes.push(String(candidate));
      }
    }
  }

  for (const codeKey of ["type", "error_code", "errorCode", "reason", "error_type", "errorType"]) {
    const candidate = value[codeKey];
    if (typeof candidate === "string" && candidate.trim()) {
      codes.push(candidate.trim());
    }
  }

  for (const msgKey of ["message", "detail", "details", "error_description", "errorMessage", "msg"]) {
    const candidate = value[msgKey];
    if (typeof candidate === "string" && candidate.trim()) {
      collectPayloadSignals(candidate, messages, codes, state, depth + 1);
    } else if (isRecord(candidate) || Array.isArray(candidate)) {
      collectPayloadSignals(candidate, messages, codes, state, depth + 1);
    }
  }

  for (const nestedKey of ["error", "data", "cause", "metadata", "response", "body"]) {
    if (nestedKey in value && value[nestedKey] != null) {
      collectPayloadSignals(value[nestedKey], messages, codes, state, depth + 1);
    }
  }
}

export function formatRawErrorForDisplay(rawError: string): string {
  const embedded = extractEmbeddedJson(rawError);
  if (!embedded) {
    return rawError;
  }
  let prettyJson: string;
  try {
    prettyJson = JSON.stringify(embedded.parsed, null, 2);
  } catch {
    return rawError;
  }
  const parts: string[] = [];
  if (embedded.prefix) parts.push(embedded.prefix);
  parts.push(prettyJson);
  if (embedded.suffix) parts.push(embedded.suffix);
  return parts.join("\n");
}

function parseErrorSignals(
  rawError: string,
  options?: DiagnoseModelErrorOptions,
): ParsedErrorSignals {
  const messages: string[] = [];
  const codes: string[] = [];
  const state: { httpStatus: number | null } = { httpStatus: null };

  if (options?.errorCode?.trim()) {
    codes.push(options.errorCode.trim());
    const fromOptionCode = normalizeHttpStatus(options.errorCode.trim());
    if (fromOptionCode !== null) {
      state.httpStatus = fromOptionCode;
    }
  }
  if (options?.errorClass?.trim()) {
    codes.push(options.errorClass.trim());
  }

  collectPayloadSignals(rawError, messages, codes, state, 0);

  if (state.httpStatus === null) {
    state.httpStatus = extractHttpStatusFromText(rawError);
  }

  return {
    messages,
    codes,
    httpStatus: state.httpStatus,
    formattedRawError: formatRawErrorForDisplay(rawError),
  };
}

function formatProviderSubject(providerName?: string | null): string {
  const trimmed = providerName?.trim();
  return trimmed ? `「${trimmed}」` : "当前模型服务";
}

function hasCjkCharacters(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

function extractConciseChineseDetail(messages: readonly string[]): string | null {
  for (const message of messages) {
    const singleLine = message.replace(/\s+/g, " ").trim();
    if (
      singleLine.length >= 4 &&
      singleLine.length <= 120 &&
      hasCjkCharacters(singleLine) &&
      !singleLine.startsWith("{")
    ) {
      return singleLine;
    }
  }
  return null;
}

export function diagnoseModelError(
  rawError: string,
  options?: DiagnoseModelErrorOptions,
): DiagnosedModelError {
  const normalizedRaw = typeof rawError === "string" ? rawError : String(rawError ?? "");
  const signals = parseErrorSignals(normalizedRaw, options);
  const subject = formatProviderSubject(options?.providerName);
  const errorClass = options?.errorClass?.trim().toLowerCase() ?? "";
  const errorCode = options?.errorCode?.trim() ?? "";

  const combinedLower = [
    normalizedRaw,
    ...signals.messages,
    ...signals.codes,
    errorClass,
    errorCode,
  ]
    .join("\n")
    .toLowerCase();

  const build = (
    category: ModelErrorCategory,
    titleZh: string,
    diagnosisZh: string,
    suggestionsZh: readonly string[],
    statusBadge?: string,
  ): DiagnosedModelError => ({
    category,
    titleZh,
    diagnosisZh,
    suggestionsZh,
    ...(statusBadge ? { statusBadge } : {}),
    rawError: normalizedRaw,
    formattedRawError: signals.formattedRawError,
  });

  // 1. Policy guard / compliance block / HTTP 403
  const isSubscriptionGuard =
    /err_subscription_orchestration_blocked|agy_unattended_forbidden|subscription_orchestration|unattended_forbidden/i.test(
      combinedLower,
    );
  const isPermissionOrForbidden =
    signals.httpStatus === 403 ||
    /\b(?:permission_denied|forbidden|access_denied|policy_violation|content_policy|organization_not_authorized|not authorized to access)\b/i.test(
      combinedLower,
    );

  if (isSubscriptionGuard) {
    const isUnattended = /agy_unattended_forbidden|unattended_forbidden/i.test(combinedLower);
    return build(
      "policy_guard",
      "访问被拒绝或触发合规风控拦截（403）",
      isUnattended
        ? "已触发 Prismux 合规硬拦截：个人 Antigravity 订阅账号禁止用于定时任务或夜间无人值守工场。"
        : `已触发 Prismux 订阅编排风控护栏，${subject} 的跨代理/自动化编排调用已被拦截。`,
      isUnattended
        ? [
            "请为无人值守任务改用 API Key 或自定义兼容端点模型。",
            "如需交互式使用个人 Antigravity，请在主对话窗口中手动触发。",
          ]
        : [
            "请前往「设置 → 代理与模型 → 订阅风控免责」核对并签署免责声明，或切换为 API Key 端点。",
          ],
      "风控拦截",
    );
  }

  if (isPermissionOrForbidden) {
    return build(
      "policy_guard",
      "访问被拒绝或触发合规风控拦截（403）",
      `${subject} 拒绝了本次请求，可能是当前账号无该模型权限、地区/组织策略受限或触发了安全风控。`,
      [
        "核对当前账号或 API Key 是否具备目标模型及接口的访问权限。",
        "若使用代理或企业网关，请确认出口地区与组织访问策略未被拦截。",
      ],
      signals.httpStatus === 403 ? "HTTP 403" : "风控拦截",
    );
  }

  // 2. Authentication / invalid credentials (HTTP 401)
  const isAuthError =
    errorClass === "auth" ||
    signals.httpStatus === 401 ||
    /\b(?:invalid_api_key|invalid_auth|authentication_error|authentication_failed|unauthenticated|unauthorized|expired_token|invalid_token|invalid x-api-key|incorrect api key|api key not valid|invalid api key|missing api key|auth_error|login required|not logged in)\b/i.test(
      combinedLower,
    );

  if (isAuthError) {
    return build(
      "auth",
      "API 密钥或登录凭证无效（401）",
      `${subject} 身份验证未通过，API 密钥可能填错、已失效，或本地登录会话已过期。`,
      [
        "打开「设置 → 代理与模型」检查对应提供方的 API Key、Base URL 或环境变量配置。",
        "若是本地 CLI / OAuth 账号（如 agy / claude / codex），请在终端重新登录后重试。",
      ],
      "HTTP 401",
    );
  }

  // 3. Quota / billing / insufficient balance (HTTP 402 or explicit quota/billing errors)
  const isQuotaError =
    signals.httpStatus === 402 ||
    /\b(?:insufficient_quota|insufficient_balance|insufficient_funds|payment_required|out of credits|billing_hard_limit|quota exceeded|exceeded your current quota)\b/i.test(
      combinedLower,
    ) ||
    (/\b(?:billing|credit|credits|balance)\b/i.test(combinedLower) &&
      /\b(?:insufficient|exhausted|exceeded|empty|zero|depleted|limit|required|top up|recharge|not enough)\b/i.test(
        combinedLower,
      ));

  if (isQuotaError) {
    return build(
      "quota",
      "账户余额或可用额度不足",
      `${subject} 返回余额或配额不足，当前账单周期或预付额度已用尽。`,
      [
        "前往对应服务商控制台检查账户余额、账单限额或套餐额度状态。",
        "也可在输入框左下角临时切换至其他可用提供方或模型继续对话。",
      ],
      signals.httpStatus === 402 ? "HTTP 402" : "额度不足",
    );
  }

  // 4. Rate limit / overloaded / usage limit (HTTP 429 / 529)
  const isRateLimit =
    errorClass === "usage_limit" ||
    signals.httpStatus === 429 ||
    signals.httpStatus === 529 ||
    /\b(?:rate_limit|rate_limit_exceeded|rate limit|too many requests|usage_limit|usage limit|overloaded|overloaded_error|resource_exhausted|throttl(?:ed|ing)|concurrency limit|server is busy|capacity)\b/i.test(
      combinedLower,
    );

  if (isRateLimit) {
    const isOverloaded =
      signals.httpStatus === 529 || /\b(?:overloaded|server is busy|capacity)\b/i.test(combinedLower);
    return build(
      "rate_limit",
      "请求频率受限或模型服务繁忙（429）",
      isOverloaded
        ? `${subject} 当前负载过高或并发已满，服务端暂时无法处理新请求。`
        : `${subject} 触发了速率限制或套餐周期用量上限，请稍后再试。`,
      [
        "等待片刻后重试，或减少并发子任务与频繁重试。",
        "可在左下角切换至其他备用模型或服务商继续当前工作。",
      ],
      signals.httpStatus === 529 ? "HTTP 529" : "HTTP 429",
    );
  }

  // 5. Context length / token limit exceeded (checked before generic 400!)
  const isContextLimit =
    signals.httpStatus === 413 ||
    /\b(?:context_length_exceeded|context_window_exceeded|maximum context length|maximum context|prompt is too long|prompt too long|input is too long|token limit|too many tokens|exceeds the maximum number of tokens|request too large|payload too large|context length)\b/i.test(
      combinedLower,
    );

  if (isContextLimit) {
    return build(
      "context_limit",
      "上下文长度超出模型上限",
      `当前会话历史、附带文件或工具输出总 Token 数已超过 ${subject} 的最大上下文窗口限制。`,
      [
        "输入 `/compact` 压缩当前对话上下文后再继续发送。",
        "或新开一个会话，并减少单次粘贴的大文件与长终端日志。",
      ],
      "上下文超限",
    );
  }

  // 6. Model not found or unsupported (HTTP 404 or model errors)
  const isModelNotFound =
    signals.httpStatus === 404 ||
    /\b(?:model_not_found|unsupported_model|unknown model|invalid model|not_found_error|no endpoints found)\b/i.test(
      combinedLower,
    ) ||
    (/\bmodel\b/i.test(combinedLower) &&
      /\b(?:does not exist|not found|not supported|unavailable|deprecated|is not valid)\b/i.test(
        combinedLower,
      )) ||
    /\b(?:does not exist|is not supported with)\b/i.test(combinedLower);

  if (isModelNotFound) {
    return build(
      "model_not_found",
      "所选模型不存在或当前端点不支持（404）",
      `${subject} 无法识别当前所选模型名称，或该中转/自定义端点尚未开放此模型。`,
      [
        "在输入框左下角切换为该提供方支持的其他模型后重新发送。",
        "如使用自定义端点或中转站，请在「设置 → 代理与模型」中核对模型 ID（Slug）拼写与路由地址。",
      ],
      signals.httpStatus === 404 ? "HTTP 404" : "模型不可用",
    );
  }

  // 7. Upstream 5xx server failures
  const isUpstream5xx =
    (signals.httpStatus !== null && signals.httpStatus >= 500 && signals.httpStatus < 600) ||
    /\b(?:bad gateway|service unavailable|internal server error|gateway timeout|upstream error|upstream_error|server_error|502 bad gateway|503 service unavailable|504 gateway)\b/i.test(
      combinedLower,
    );

  if (isUpstream5xx) {
    const badge = signals.httpStatus !== null ? `HTTP ${signals.httpStatus}` : "HTTP 5xx";
    return build(
      "upstream_5xx",
      "上游模型服务临时异常（5xx）",
      `${subject} 上游服务器发生临时故障或网关超时，通常属于服务端波动而非本地问题。`,
      [
        "稍等数秒后直接重试当前消息。",
        "若持续报错，请确认服务商状态页或临时切换至其他模型提供方。",
      ],
      badge,
    );
  }

  // 8. Local CLI / ACP subprocess failures
  const isCliProcessError =
    /\b(?:enoent|exited with code|exit code|process exited|failed to spawn|spawn\s+\S+|child process|sigterm|sigkill|sigabrt|epipe|command not found|binary not found|executable not found)\b/i.test(
      combinedLower,
    ) ||
    (/\b(?:acp|cli)\b/i.test(combinedLower) &&
      /\b(?:exited|crashed|crash|terminated|closed unexpectedly|spawn|not found|failed to start|disconnect(?:ed)?|process|stdio|json-?rpc)\b/i.test(
        combinedLower,
      ));

  if (isCliProcessError) {
    const isAcp = /\bacp\b/i.test(combinedLower);
    return build(
      "cli_process",
      "本地智能体 CLI / ACP 进程异常退出",
      `本地运行的 ${isAcp ? "ACP" : "CLI"} 智能体进程未能正常启动或中途意外退出，可能是可执行文件缺失、PATH 未配置或内部崩溃。`,
      [
        "前往「设置 → 代理与模型」检查该智能体 CLI 是否已正确安装且路径有效。",
        "可在系统终端手动执行对应 CLI 命令验证环境与版本，再展开下方原始报错核对退出码。",
      ],
      isAcp ? "ACP" : "CLI 进程",
    );
  }

  // 9. Network / TLS / proxy / timeout
  const isNetworkError =
    signals.httpStatus === 408 ||
    /\b(?:econnrefused|econnreset|enotfound|etimedout|eai_again|ehostunreach|enetunreach|err_network|fetch failed|network error|timed out|timeout|socket hang up|socket|tls|ssl|cert_|unable_to_verify_leaf_signature|proxy|connection refused|connection reset|not connected|disconnected|network_error)\b/i.test(
      combinedLower,
    );

  if (isNetworkError) {
    return build(
      "network",
      "网络连接中断或端点/代理不可达",
      `无法与 ${subject} 建立稳定连接，可能是网络抖动、代理/TUN 配置冲突、证书校验失败或服务端连接超时。`,
      [
        "检查当前网络连接与系统代理/VPN 设置（若开启 TUN 模式，请确认未残留冲突的 HTTP_PROXY）。",
        "若连接本地或自建端点，请确认目标服务已启动且地址端口填写正确。",
      ],
      "网络异常",
    );
  }

  // 10. Aborted / cancelled / interrupted
  const isCancelled =
    /\b(?:aborted|abort_error|aborterror|cancelled|canceled|interrupted|user cancelled|turn aborted|request was aborted)\b/i.test(
      combinedLower,
    );

  if (isCancelled) {
    return build(
      "cancelled",
      "本次请求已中断或被取消",
      "该轮对话生成在完成前被中断或主动取消，未产生完整结果。",
      ["如需继续，可直接重新发送消息或恢复上一轮输入。"],
      "已取消",
    );
  }

  // 11. Bad request / schema / JSON / HTTP 400 / 422
  const isBadRequest =
    signals.httpStatus === 400 ||
    signals.httpStatus === 422 ||
    /\b(?:invalid_request_error|bad request|invalid_argument|unprocessable|schema|validation error|malformed|invalid json|unexpected token)\b/i.test(
      combinedLower,
    );

  if (isBadRequest) {
    const badge = signals.httpStatus === 422 ? "HTTP 422" : "HTTP 400";
    return build(
      "bad_request",
      "请求参数或协议格式异常（400）",
      `${subject} 无法解析本次请求的参数或消息结构，可能是不支持某些思考强度、工具协议或附件格式。`,
      [
        "尝试调整思考强度/模型参数，或移除当前消息中的特殊附件后重试。",
        "如使用第三方兼容中转端点，请展开原始报错核对具体不支持的字段。",
      ],
      badge,
    );
  }

  // 12. Fallback unknown
  const conciseZh = extractConciseChineseDetail(signals.messages);
  const fallbackBadge =
    signals.httpStatus !== null
      ? `HTTP ${signals.httpStatus}`
      : errorCode.length > 0 && errorCode.length <= 24
        ? errorCode
        : undefined;

  return build(
    "unknown",
    "模型调用失败",
    conciseZh
      ? `${subject} 返回异常：${conciseZh}`
      : `${subject} 执行过程中返回了未归类异常，请展开下方原始报错核对详细上下文。`,
    [
      "可尝试重新发送消息，或切换其他可用模型验证是否为单端点问题。",
      "点击「查看原始报错」并复制完整信息，便于进一步定位根因。",
    ],
    fallbackBadge,
  );
}
