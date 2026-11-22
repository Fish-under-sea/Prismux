export type PurgeAction = "redact" | "block" | "rollback";

export interface PurgeRule {
  id: string;
  pattern: string;
  action: PurgeAction;
  flags?: string;
  replacement?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
}

export interface CompiledPurgeRule {
  readonly rule: Readonly<PurgeRule>;
  readonly testRegex: RegExp;
  readonly replaceRegex: RegExp;
  readonly replacement: string;
}

export class PurgeRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeRuleValidationError";
  }
}

export const DEFAULT_BUILTIN_PURGE_RULES: readonly PurgeRule[] = Object.freeze([
  {
    id: "builtin-redact-private-key",
    pattern:
      "-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\\s\\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----",
    action: "redact",
    flags: "m",
    replacement: "[REDACTED:PRIVATE_KEY]",
    description: "脱敏 PEM/OpenSSH 私钥块",
    enabled: true,
    priority: 10
  },
  {
    id: "builtin-redact-api-key",
    pattern:
      "(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16})",
    action: "redact",
    flags: "",
    replacement: "[REDACTED:API_KEY]",
    description: "脱敏常见云服务与大模型 API Key",
    enabled: true,
    priority: 20
  },
  {
    id: "builtin-redact-bearer-token",
    pattern: "\\bBearer\\s+(?!\\[REDACTED:)[A-Za-z0-9\\-._~+/]+=*",
    action: "redact",
    flags: "i",
    replacement: "Bearer [REDACTED:TOKEN]",
    description: "脱敏 HTTP Authorization Bearer Token",
    enabled: true,
    priority: 30
  },
  {
    id: "builtin-redact-secret-assignment",
    pattern:
      "((?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|passwd)\\s*[:=]\\s*[\"']?)(?!\\[REDACTED:)[^\\s\"'`]{8,}([\"']?)",
    action: "redact",
    flags: "i",
    replacement: "$1[REDACTED:SECRET]$2",
    description: "脱敏显式密钥或口令键值赋值",
    enabled: true,
    priority: 40
  },
  {
    id: "builtin-block-instruction-override",
    pattern:
      "(?:\\b(?:ignore|disregard|override)\\s+(?:all\\s+)?(?:previous|prior|above)\\s+(?:instructions?|prompts?|rules?)\\b|(?:忽略|无视|覆盖)(?:以上|之前|先前|所有|全部|的){1,3}(?:指令|提示词|规则))",
    action: "block",
    flags: "i",
    description: "拦截指令覆盖类提示词注入",
    enabled: true,
    priority: 5
  },
  {
    id: "builtin-block-system-exfil",
    pattern:
      "(?:\\b(?:reveal|dump|print|leak|output|show)\\s+(?:your\\s+)?(?:system\\s+prompt|hidden\\s+instructions?|developer\\s+message)\\b|(?:输出|打印|泄露|暴露|显示)(?:你的|完整|隐藏){0,2}(?:系统提示词|系统指令|开发者消息))",
    action: "block",
    flags: "i",
    description: "拦截系统提示词套取与越权探测",
    enabled: true,
    priority: 6
  },
  {
    id: "builtin-block-jailbreak",
    pattern:
      "(?:\\b(?:DAN\\s+mode|do\\s+anything\\s+now|jailbreak|bypass\\s+(?:all\\s+)?safety\\s+filters?)\\b|越狱模式|绕过(?:所有|全部)?安全(?:限制|规则|护栏))",
    action: "block",
    flags: "i",
    description: "拦截越狱与绕过安全护栏模式",
    enabled: true,
    priority: 7
  },
  {
    id: "builtin-rollback-poison-delimiter",
    pattern: "(?:<\\|\\s*(?:im_start|im_end|system|endoftext)\\s*\\|>|__PRISMUX_FORCE_ROLLBACK__)",
    action: "rollback",
    flags: "i",
    description: "检测到特殊对话分隔符毒化或强回滚标记，触发红队版本回退",
    enabled: true,
    priority: 1
  }
]);

const VALID_ACTIONS = new Set<PurgeAction>(["redact", "block", "rollback"]);
const ALLOWED_REGEX_FLAGS = new Set(["i", "m", "s", "u"]);

function normalizeRegexFlags(rawFlags?: string): string {
  if (rawFlags === undefined || rawFlags.length === 0) {
    return "";
  }
  const unique = new Set<string>();
  for (const ch of rawFlags) {
    if (ch === "g" || ch === "y") {
      continue;
    }
    if (!ALLOWED_REGEX_FLAGS.has(ch)) {
      throw new PurgeRuleValidationError(
        `Unsupported regex flag "${ch}" in PurgeRule.`
      );
    }
    unique.add(ch);
  }
  return Array.from(unique).sort().join("");
}

export function compilePurgeRule(rule: PurgeRule): CompiledPurgeRule {
  if (typeof rule.id !== "string" || rule.id.trim().length === 0) {
    throw new PurgeRuleValidationError("PurgeRule.id must be a non-empty string.");
  }
  if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
    throw new PurgeRuleValidationError(
      `PurgeRule "${rule.id}" must have a non-empty pattern.`
    );
  }
  if (!VALID_ACTIONS.has(rule.action)) {
    throw new PurgeRuleValidationError(
      `Unsupported PurgeRule action "${String(rule.action)}" on rule "${rule.id}".`
    );
  }

  const baseFlags = normalizeRegexFlags(rule.flags);
  let testRegex: RegExp;
  let replaceRegex: RegExp;
  try {
    testRegex = new RegExp(rule.pattern, baseFlags);
    replaceRegex = new RegExp(rule.pattern, `${baseFlags}g`);
  } catch (error) {
    throw new PurgeRuleValidationError(
      `Invalid regex pattern in PurgeRule "${rule.id}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const frozenRule = Object.freeze({
    id: rule.id.trim(),
    pattern: rule.pattern,
    action: rule.action,
    ...(baseFlags.length > 0 ? { flags: baseFlags } : {}),
    ...(rule.replacement !== undefined ? { replacement: rule.replacement } : {}),
    ...(rule.description !== undefined ? { description: rule.description } : {}),
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 100
  });

  return {
    rule: frozenRule,
    testRegex,
    replaceRegex,
    replacement: rule.replacement ?? "[REDACTED]"
  };
}
