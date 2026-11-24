import {
  resolveProviderSkillSourceKind,
  type ProviderSkillSourceKind,
} from "@t3tools/client-runtime/providerSkills";
import type { ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import {
  ActivityIcon,
  ArrowRightLeftIcon,
  AtSignIcon,
  BlocksIcon,
  BookOpenIcon,
  BrainIcon,
  BugIcon,
  CalendarClockIcon,
  ClipboardListIcon,
  ClockIcon,
  CoinsIcon,
  FileDiffIcon,
  FileTextIcon,
  FlameIcon,
  FolderIcon,
  FolderPlusIcon,
  GaugeIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  HelpCircleIcon,
  KeyboardIcon,
  LayersIcon,
  ListTodoIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  MessageSquareWarningIcon,
  Minimize2Icon,
  PackageIcon,
  PencilIcon,
  PlayCircleIcon,
  PlugIcon,
  PuzzleIcon,
  RotateCcwIcon,
  SettingsIcon,
  ShieldCheckIcon,
  // oxlint-disable-next-line t3code/no-sparkles-icon -- design spec explicitly maps /model to SparklesIcon
  SparklesIcon,
  StethoscopeIcon,
  TargetIcon,
  TerminalIcon,
  Undo2Icon,
  UserRoundIcon,
  UsersIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

export type SlashCommandIconSpec =
  | { readonly kind: "emoji"; readonly emoji: string }
  | { readonly kind: "lucide"; readonly icon: LucideIcon };

export interface SlashCommandCatalogEntry {
  readonly icon: SlashCommandIconSpec;
  readonly zhTitle: string;
  readonly description: string;
  readonly aliases?: ReadonlyArray<string>;
}

export interface SlashCommandPresentation {
  readonly icon: SlashCommandIconSpec;
  readonly zhTitle: string | null;
  readonly nativeName: string;
  readonly description: string;
  readonly isLocalized: boolean;
  readonly searchAliases: ReadonlyArray<string>;
}

export type ComposerSkillCategory = "personal" | "builtin";

export interface SkillPresentation {
  readonly icon: LucideIcon;
  readonly category: ComposerSkillCategory;
  readonly sourceKind: ProviderSkillSourceKind;
  readonly sourceBadgeLabel: string;
  readonly nativeName: string;
  readonly description: string;
  readonly isLocalized: boolean;
}

const lucide = (icon: LucideIcon): SlashCommandIconSpec => ({ kind: "lucide", icon });
const emoji = (value: string): SlashCommandIconSpec => ({ kind: "emoji", emoji: value });

const USAGE_LIMITS_ENTRY: SlashCommandCatalogEntry = {
  icon: lucide(GaugeIcon),
  zhTitle: "用量限额",
  description: "查看当前服务商的配额余额与速率使用上限",
  aliases: ["usage", "usage-limits", "quota", "limit", "配额", "额度", "限流", "上限"],
};

const PLUGIN_ENTRY: SlashCommandCatalogEntry = {
  icon: lucide(PuzzleIcon),
  zhTitle: "插件管理",
  description: "安装、启用、停用或打包管理功能插件",
  aliases: ["plugin", "plugins", "扩展", "商城"],
};

const UNDO_ENTRY: SlashCommandCatalogEntry = {
  icon: lucide(Undo2Icon),
  zhTitle: "撤销回退",
  description: "回退上一轮对话或工作区代码修改",
  aliases: ["undo", "rewind", "回滚", "还原"],
};

export const SLASH_COMMAND_CATALOG: Readonly<Record<string, SlashCommandCatalogEntry>> = {
  model: {
    icon: lucide(SparklesIcon),
    zhTitle: "切换模型",
    description: "切换当前会话使用的回复模型",
    aliases: ["llm", "模型", "换模型"],
  },
  side: {
    icon: lucide(MessageSquarePlusIcon),
    zhTitle: "旁路提问",
    description: "在不打断主线程的前提下发起旁路支线提问",
    aliases: ["侧聊", "支线", "旁路"],
  },
  btw: {
    icon: lucide(MessageSquarePlusIcon),
    zhTitle: "顺便一问",
    description: "同 /side，快速发起不干扰主线的旁路提问",
    aliases: ["side", "顺便", "侧聊"],
  },
  clear: {
    icon: lucide(RotateCcwIcon),
    zhTitle: "新起会话",
    description: "开启全新上下文会话，保留上方历史记录可见",
    aliases: ["reset", "清空", "新会话", "重置"],
  },
  goal: {
    icon: lucide(TargetIcon),
    zhTitle: "长程目标",
    description: "设定持续推进目标，让 Agent 自主执行直到完全达成",
    aliases: ["目标", "自动推进", "通宵"],
  },
  swarm: {
    icon: emoji("🐝"),
    zhTitle: "蜂群",
    description: "启动多智能体蜂群协作，并行分工推进复杂任务",
    aliases: ["蜂群", "多智能体", "并行", "协作", "蜜蜂"],
  },
  teamwork: {
    icon: emoji("🐝"),
    zhTitle: "团队协作",
    description: "组建多智能体自治协作团队共同完成复杂项目",
    aliases: ["team", "团队", "蜂群", "协作"],
  },
  schedule: {
    icon: lucide(ClockIcon),
    zhTitle: "定时任务",
    description: "按周期计划或一次性倒计时自动触发指令",
    aliases: ["cron", "timer", "定时", "倒计时", "计划任务"],
  },
  compact: {
    icon: lucide(Minimize2Icon),
    zhTitle: "压缩上下文",
    description: "总结并压缩当前对话历史，释放上下文窗口",
    aliases: ["summarize", "压缩", "精简", "上下文"],
  },
  plan: {
    icon: lucide(ClipboardListIcon),
    zhTitle: "制定计划",
    description: "在动手前先拆解步骤并形成可审阅的执行方案",
    aliases: ["规划", "方案", "计划"],
  },
  review: {
    icon: lucide(GitCompareArrowsIcon),
    zhTitle: "代码审查",
    description: "审查当前代码改动，排查风险与潜在回归缺陷",
    aliases: ["cr", "审查", "评审", "检视"],
  },
  feedback: {
    icon: lucide(MessageSquareWarningIcon),
    zhTitle: "发送反馈",
    description: "将当前会话与运行日志发送给官方以便排查问题",
    aliases: ["日志", "反馈", "报告"],
  },
  "usage-limits": USAGE_LIMITS_ENTRY,
  usage: USAGE_LIMITS_ENTRY,
  browser: {
    icon: lucide(GlobeIcon),
    zhTitle: "浏览器操控",
    description: "打开并交互操作网页，用于搜索、测试与排查",
    aliases: ["web", "浏览器", "网页"],
  },
  "grill-me": {
    icon: lucide(FlameIcon),
    zhTitle: "深度追问",
    description: "通过交互式追问对齐方案细节与需求边界",
    aliases: ["interview", "追问", "访谈", "拷问"],
  },
  learn: {
    icon: lucide(BookOpenIcon),
    zhTitle: "经验沉淀",
    description: "将本次纠偏或复杂配置经验持久化供后续复用",
    aliases: ["学习", "沉淀", "记住"],
  },
  boost: {
    icon: lucide(ZapIcon),
    zhTitle: "深度强化",
    description: "开启多视角深度思考、严谨规划与全面验证模式",
    aliases: ["强化", "增强", "深度"],
  },
  handoff: {
    icon: lucide(ArrowRightLeftIcon),
    zhTitle: "会话交接",
    description: "提炼目标、决策与修改清单并无损交接至新线程",
    aliases: ["交接", "转交", "续跑"],
  },
  plugin: PLUGIN_ENTRY,
  plugins: PLUGIN_ENTRY,
  automation: {
    icon: lucide(CalendarClockIcon),
    zhTitle: "自动作业",
    description: "交互式设计并创建后台定时自动化任务",
    aliases: ["自动化", "后台任务", "定时"],
  },
  init: {
    icon: lucide(FolderPlusIcon),
    zhTitle: "初始化项目",
    description: "扫描仓库并生成项目规范与上下文指引",
    aliases: ["初始化", "引导"],
  },
  status: {
    icon: lucide(ActivityIcon),
    zhTitle: "运行状态",
    description: "查看当前会话、工作目录与代理连接状态",
    aliases: ["状态", "连接"],
  },
  cost: {
    icon: lucide(CoinsIcon),
    zhTitle: "用量费用",
    description: "查看当前会话的 Token 消耗与费用统计",
    aliases: ["token", "费用", "消耗", "账单"],
  },
  doctor: {
    icon: lucide(StethoscopeIcon),
    zhTitle: "环境体检",
    description: "诊断当前运行环境、依赖与服务健康状态",
    aliases: ["诊断", "体检", "排查"],
  },
  mcp: {
    icon: lucide(PlugIcon),
    zhTitle: "MCP 工具",
    description: "查看与管理当前会话接入的 MCP 服务与工具",
    aliases: ["工具", "服务"],
  },
  memory: {
    icon: lucide(BrainIcon),
    zhTitle: "记忆管理",
    description: "检索、查看或维护长期记忆与项目上下文",
    aliases: ["记忆", "上下文"],
  },
  permissions: {
    icon: lucide(ShieldCheckIcon),
    zhTitle: "权限策略",
    description: "查看或调整命令执行与文件写入授权策略",
    aliases: ["权限", "审批", "安全"],
  },
  diff: {
    icon: lucide(FileDiffIcon),
    zhTitle: "查看差异",
    description: "展示当前工作区的未提交代码变更",
    aliases: ["差异", "变更", "改动"],
  },
  undo: UNDO_ENTRY,
  rewind: UNDO_ENTRY,
  resume: {
    icon: lucide(PlayCircleIcon),
    zhTitle: "恢复会话",
    description: "恢复先前的历史会话并继续执行",
    aliases: ["恢复", "继续"],
  },
  help: {
    icon: lucide(HelpCircleIcon),
    zhTitle: "命令帮助",
    description: "查看所有可用斜杠命令与快捷方式说明",
    aliases: ["帮助", "说明", "文档"],
  },
  // Additional common provider slash commands across Codex / Claude Code / Gemini / OpenCode / Copilot
  new: {
    icon: lucide(RotateCcwIcon),
    zhTitle: "新建会话",
    description: "清空当前上下文并开启全新对话线程",
    aliases: ["新会话", "新建"],
  },
  reset: {
    icon: lucide(RotateCcwIcon),
    zhTitle: "重置会话",
    description: "重置当前会话上下文状态",
    aliases: ["重置", "清空"],
  },
  config: {
    icon: lucide(SettingsIcon),
    zhTitle: "配置设置",
    description: "查看或修改当前 Agent 的运行配置项",
    aliases: ["settings", "设置", "配置"],
  },
  settings: {
    icon: lucide(SettingsIcon),
    zhTitle: "配置设置",
    description: "查看或修改当前 Agent 的运行配置项",
    aliases: ["config", "设置", "配置"],
  },
  context: {
    icon: lucide(LayersIcon),
    zhTitle: "上下文详情",
    description: "查看当前会话上下文窗口占用与构成",
    aliases: ["上下文", "窗口"],
  },
  export: {
    icon: lucide(FileTextIcon),
    zhTitle: "导出会话",
    description: "将当前对话记录导出为文本或文件",
    aliases: ["导出"],
  },
  fork: {
    icon: lucide(GitBranchIcon),
    zhTitle: "分支对话",
    description: "从当前节点派生一条新的分支对话",
    aliases: ["分支", "派生"],
  },
  rename: {
    icon: lucide(PencilIcon),
    zhTitle: "重命名会话",
    description: "修改当前对话线程的显示标题",
    aliases: ["重命名", "改名"],
  },
  agents: {
    icon: lucide(UsersIcon),
    zhTitle: "子代理管理",
    description: "查看与配置当前会话可用的子智能体",
    aliases: ["子代理", "智能体"],
  },
  hooks: {
    icon: lucide(ZapIcon),
    zhTitle: "生命周期钩子",
    description: "查看与管理当前工作区的自动化钩子",
    aliases: ["钩子"],
  },
  tasks: {
    icon: lucide(ListTodoIcon),
    zhTitle: "后台任务",
    description: "查看与管理当前运行中的后台任务",
    aliases: ["任务"],
  },
  vim: {
    icon: lucide(KeyboardIcon),
    zhTitle: "Vim 模式",
    description: "切换输入编辑器的 Vim 键位模式",
    aliases: ["键位", "编辑器"],
  },
  bug: {
    icon: lucide(BugIcon),
    zhTitle: "上报缺陷",
    description: "提交缺陷报告并附带诊断信息",
    aliases: ["缺陷", "报错"],
  },
  "release-notes": {
    icon: lucide(FileTextIcon),
    zhTitle: "版本日志",
    description: "查看近期版本更新说明与功能变化",
    aliases: ["更新日志", "版本"],
  },
  "security-review": {
    icon: lucide(ShieldCheckIcon),
    zhTitle: "安全审查",
    description: "针对当前代码改动执行专项安全风险检查",
    aliases: ["安全", "审计"],
  },
  "pr-comments": {
    icon: lucide(MessageSquareIcon),
    zhTitle: "PR 评论",
    description: "拉取并查看关联 Pull Request 的审查评论",
    aliases: ["评论", "拉取请求"],
  },
  "add-dir": {
    icon: lucide(FolderPlusIcon),
    zhTitle: "添加目录",
    description: "将额外工作目录纳入当前会话访问范围",
    aliases: ["目录", "工作区"],
  },
  mention: {
    icon: lucide(AtSignIcon),
    zhTitle: "引用提及",
    description: "在消息中引用文件、对话或工作 Agent",
    aliases: ["提及", "引用"],
  },
  thinking: {
    icon: lucide(BrainIcon),
    zhTitle: "思考强度",
    description: "调整当前模型的推理深度与思考预算",
    aliases: ["effort", "推理", "思考"],
  },
  effort: {
    icon: lucide(BrainIcon),
    zhTitle: "思考强度",
    description: "调整当前模型的推理深度与思考预算",
    aliases: ["thinking", "推理", "思考"],
  },
  fast: {
    icon: lucide(ZapIcon),
    zhTitle: "极速模式",
    description: "切换更低延迟的快速响应模式",
    aliases: ["快速", "极速"],
  },
  stats: {
    icon: lucide(ActivityIcon),
    zhTitle: "统计概览",
    description: "查看当前账号与会话的使用统计信息",
    aliases: ["统计"],
  },
};

/**
 * Localized Chinese descriptions ONLY for built-in / system / app / provider-bundled skills.
 * Personal / repo / project skills are NEVER translated through this table.
 */
export const BUILTIN_SKILL_ZH_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "agy-customizations":
    "Antigravity 自定义体系指南：说明技能、规则、插件、钩子与 MCP 的加载优先级与创建方式",
  "antigravity-guide":
    "Google Antigravity 全面使用指南，涵盖 CLI、IDE、斜杠命令、快捷键与自定义扩展",
  generative_ui: "在对话中内联或作为独立产物渲染交互式 HTML 图表、可视化控件与演示界面",
  "run-workflow": "编写并执行 Python 动态工作流脚本，通过并行或流水线编排多个智能体协同完成任务",
  "mcp-app-development": "构建、打包与调试 Antigravity MCP 应用，为 MCP 工具提供交互式侧边栏或内联界面",
  "migrate-agent-settings":
    "将 Claude Code、Codex、Cursor 或 Gemini CLI 的 MCP、技能与配置迁移为 Antigravity 插件",
  "migrate-workflows": "自动扫描并把旧版工作流配置迁移为现代技能目录（SKILL.md）并安全归档旧文件",
  plugin: "管理或创建功能插件包，统一封装技能、代理、规则、MCP 服务与钩子",
  automation: "交互式设计并创建按周期执行的后台自动化任务",
  swarm_monitor: "蜂群停滞巡检专员：定时巡查成员进度并在全体阻塞时唤醒关键节点",
  swarm_pane: "蜂群协作看板控制与多代理并行状态视图管理",
  "ui-plugin-navigation": "发现与当前任务相关的 UI 插件面板，并在对话中提供一键展开侧边面板入口",
  "skill-creator": "按规范创建、组织并校验新的技能包（SKILL.md、脚本与参考资料）",
  "skill-installer": "从官方精选库或指定仓库发现并安装新的外部技能包",
  pdf: "读取、提取、合并、拆分与生成 PDF 文档及页面文本与表格内容",
  docx: "创建、解析与编辑 Word（.docx）文档，支持排版样式、批注与修订",
  xlsx: "读取、分析、生成与格式化 Excel（.xlsx）工作簿、公式与数据表",
  pptx: "创建、解析与美化 PowerPoint（.pptx）演示文稿与幻灯片版式",
  "frontend-design": "以高审美标准设计与实现富有视觉层次和交互质感的前端页面与组件",
  "webapp-testing": "使用浏览器自动化脚本对本地 Web 应用进行端到端交互测试与截图验收",
  "mcp-builder": "高质量设计与实现 MCP 服务器，定义清晰的工具契约并完成联调测试",
  doc: "创建、审阅与格式化结构化文档及图文报告",
  spreadsheet: "处理电子表格数据建模、公式计算与报表导出",
  slides: "设计并生成结构清晰的多页演示幻灯片",
  imagegen: "根据文本提示生成或编辑高质量图片素材",
  playwright: "通过 Playwright 驱动真实浏览器完成页面交互、表单验证与回归测试",
  figma: "读取 Figma 设计稿节点与样式规范并高保真还原为前端代码",
  "figma-implement-design": "读取 Figma 设计稿节点与样式规范并高保真还原为前端代码",
  "gh-address-comments": "读取 GitHub Pull Request 审查评论并逐项定位修复代码问题",
  "gh-fix-ci": "检查 GitHub Actions 失败日志并自动定位修复 CI 构建与测试报错",
  linear: "查询、创建与更新 Linear 议题与项目迭代进度",
  notion: "检索、阅读与更新 Notion 知识库页面与数据库记录",
  sentry: "查询 Sentry 线上报错堆栈与性能追踪记录以辅助定位根因",
  "vercel-deploy": "检查并触发 Vercel 项目构建、预览与生产部署",
  "cloudflare-deploy": "配置并部署 Cloudflare Workers、Pages 与边缘存储服务",
  "jupyter-notebook": "创建、运行与整理 Jupyter Notebook 数据分析与实验代码",
  "openai-docs": "查阅 OpenAI 官方最新接口文档、模型参数与 SDK 最佳实践",
  "security-best-practices": "按语言与框架基线审查代码安全性并提供漏洞加固建议",
  "security-threat-model": "梳理系统信任边界与攻击面并输出结构化威胁建模报告",
  "develop-web-game": "设计与迭代开发 HTML5 / Canvas 网页游戏并执行自动化试玩验证",
  screenshot: "捕获桌面窗口或指定区域屏幕截图用于视觉核验",
  yeet: "一键完成暂存、提交、推送并创建 GitHub Pull Request",
  simplify: "审查近期代码改动并精简冗余逻辑，提升复用性与执行效率",
  batch: "跨目录或跨文件大规模并行批量重构代码变更",
  "claude-api": "构建调用 Claude / Anthropic SDK 与 Agent API 的应用代码",
};

export const SKILL_SOURCE_ICON_BY_KIND: Readonly<Record<ProviderSkillSourceKind, LucideIcon>> = {
  app: BlocksIcon,
  repo: FolderIcon,
  project: FolderIcon,
  personal: UserRoundIcon,
  system: SettingsIcon,
  other: PackageIcon,
};

const SKILL_SOURCE_BADGE_LABEL_BY_KIND: Readonly<Record<ProviderSkillSourceKind, string>> = {
  personal: "个人",
  repo: "仓库",
  project: "项目",
  app: "自带",
  system: "系统",
  other: "内置",
};

export function normalizeSlashCommandKey(rawName: string): string {
  return rawName.trim().replace(/^\/+/, "").toLowerCase();
}

export function resolveSlashCommandPresentation(
  rawName: string,
  fallbackDescription = "",
  overrideDescription?: string | null,
): SlashCommandPresentation {
  const trimmedName = rawName.trim().replace(/^\/+/, "");
  const key = trimmedName.toLowerCase();
  const entry = SLASH_COMMAND_CATALOG[key];
  const explicitOverride = overrideDescription?.trim();

  if (entry) {
    return {
      icon: entry.icon,
      zhTitle: entry.zhTitle,
      nativeName: trimmedName || key,
      description: explicitOverride || entry.description,
      isLocalized: true,
      searchAliases: entry.aliases ?? [],
    };
  }

  return {
    icon: lucide(TerminalIcon),
    zhTitle: null,
    nativeName: `/${trimmedName || key}`,
    description: explicitOverride || fallbackDescription,
    isLocalized: false,
    searchAliases: [],
  };
}

export function classifyComposerSkillCategory(
  sourceKind: ProviderSkillSourceKind,
): ComposerSkillCategory {
  if (sourceKind === "personal" || sourceKind === "repo" || sourceKind === "project") {
    return "personal";
  }
  return "builtin";
}

export function resolveSkillSourceIcon(sourceKind: ProviderSkillSourceKind): LucideIcon {
  return SKILL_SOURCE_ICON_BY_KIND[sourceKind];
}

export function resolveSkillSourceBadgeLabel(sourceKind: ProviderSkillSourceKind): string {
  return SKILL_SOURCE_BADGE_LABEL_BY_KIND[sourceKind];
}

function lookupBuiltinSkillZhDescription(skillName: string): string | undefined {
  const normalized = skillName.trim().toLowerCase();
  if (!normalized) return undefined;
  const direct = BUILTIN_SKILL_ZH_DESCRIPTIONS[normalized];
  if (direct) return direct;
  const hyphenated = normalized.replaceAll("_", "-");
  if (BUILTIN_SKILL_ZH_DESCRIPTIONS[hyphenated]) {
    return BUILTIN_SKILL_ZH_DESCRIPTIONS[hyphenated];
  }
  const underscored = normalized.replaceAll("-", "_");
  return BUILTIN_SKILL_ZH_DESCRIPTIONS[underscored];
}

export function resolveSkillPresentation(
  skill: Pick<
    ServerProviderSkill,
    "name" | "displayName" | "path" | "scope" | "shortDescription" | "description"
  >,
  fallbackDescription = "",
): SkillPresentation {
  const sourceKind = resolveProviderSkillSourceKind(skill);
  const category = classifyComposerSkillCategory(sourceKind);
  const nativeName = formatProviderSkillDisplayName(skill);
  const originalDescription =
    skill.shortDescription?.trim() || skill.description?.trim() || fallbackDescription.trim();

  if (category === "personal") {
    return {
      icon: resolveSkillSourceIcon(sourceKind),
      category,
      sourceKind,
      sourceBadgeLabel: resolveSkillSourceBadgeLabel(sourceKind),
      nativeName,
      description: originalDescription,
      isLocalized: false,
    };
  }

  const localizedDescription = lookupBuiltinSkillZhDescription(skill.name);
  return {
    icon: resolveSkillSourceIcon(sourceKind),
    category,
    sourceKind,
    sourceBadgeLabel: resolveSkillSourceBadgeLabel(sourceKind),
    nativeName,
    description: localizedDescription ?? originalDescription,
    isLocalized: localizedDescription !== undefined,
  };
}
