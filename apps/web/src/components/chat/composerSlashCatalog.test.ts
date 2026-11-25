import {
  matchComposerThreadItems,
  type ComposerThreadCandidate,
} from "@prismux/client-runtime/composerThreadItems";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
  type ServerProviderSkill,
} from "@prismux/core-contracts";
import { ClockIcon, TerminalIcon, UserRoundIcon, UsersIcon, FolderIcon, BlocksIcon, SettingsIcon } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { matchComposerModelItems } from "./composerModelMentions";
import {
  BUILTIN_SKILL_ZH_DESCRIPTIONS,
  SLASH_COMMAND_CATALOG,
  classifyComposerSkillCategory,
  classifyProviderSlashCommandAsSkill,
  isEgoBrowserIdentifier,
  isHiddenSlashCommand,
  resolveBundledSkillCommandPresentation,
  resolveSkillPresentation,
  resolveSlashCommandPresentation,
} from "./composerSlashCatalog";
import {
  buildComposerSlashMenuItems,
  orderSlashCommandItems,
  searchSlashCommandItems,
  type SlashSearchItem,
} from "./composerSlashCommandSearch";
import {
  buildComposerSkillTriggerItems,
  buildComposerSlashTriggerItems,
} from "./useComposerMenuItems";
import type { ModelEsque } from "./providerIconUtils";

function makeSkill(
  name: string,
  overrides: Partial<ServerProviderSkill> = {},
): ServerProviderSkill {
  return {
    name,
    path: `/skills/${name}/SKILL.md`,
    enabled: true,
    scope: "user",
    description: `${name} original english description`,
    ...overrides,
  };
}

function makeProviderSlashItem(
  name: string,
  description = `Run ${name}`,
  provider: ProviderDriverKind = ProviderDriverKind.make("codex"),
): Extract<SlashSearchItem, { type: "provider-slash-command" }> {
  return {
    id: `provider-slash-command:${provider}:${name}`,
    type: "provider-slash-command",
    provider,
    command: {
      name,
      description,
    },
    label: `/${name}`,
    description,
  };
}

function makeSkillItem(
  skill: ServerProviderSkill,
  provider: ProviderDriverKind = ProviderDriverKind.make("codex"),
): Extract<SlashSearchItem, { type: "skill" }> {
  return {
    id: `skill:${provider}:${skill.name}`,
    type: "skill",
    provider,
    skill,
    label: `/skill:${skill.name}`,
    description: skill.shortDescription ?? skill.description ?? "",
  };
}

function makeThreadShell(
  id: string,
  title: string,
  overrides: Partial<ComposerThreadCandidate> = {},
): ComposerThreadCandidate {
  const threadId = ThreadId.make(id);
  return {
    environmentId: EnvironmentId.make("env-local"),
    id: threadId,
    title,
    branch: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    latestUserMessageAt: null,
    opens: null,
    archivedAt: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    ...overrides,
  };
}

function makeProviderEntry(
  instanceId: string,
  driverKind: string,
  displayName: string,
  overrides: Partial<ProviderInstanceEntry> = {},
): ProviderInstanceEntry {
  const id = ProviderInstanceId.make(instanceId);
  const driver = ProviderDriverKind.make(driverKind);
  const snapshot: ServerProvider = {
    instanceId: id,
    driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-24T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
  return {
    instanceId: id,
    driverKind: driver,
    displayName,
    enabled: true,
    installed: true,
    status: "ready",
    isDefault: true,
    isAvailable: true,
    snapshot,
    models: [],
    ...overrides,
  };
}

describe("composerSlashCatalog — native slash commands", () => {
  it("resolves icons, Chinese titles, smaller native English names, and Chinese descriptions for all required commands", () => {
    const requiredCommands = [
      "model",
      "side",
      "btw",
      "clear",
      "goal",
      "swarm",
      "teamwork",
      "schedule",
      "compact",
      "plan",
      "review",
      "feedback",
      "usage-limits",
      "usage",
      "browser",
      "grill-me",
      "learn",
      "boost",
      "handoff",
      "plugin",
      "plugins",
      "automation",
      "init",
      "status",
      "cost",
      "doctor",
      "mcp",
      "memory",
      "permissions",
      "diff",
      "undo",
      "rewind",
      "resume",
      "help",
    ];

    for (const command of requiredCommands) {
      expect(SLASH_COMMAND_CATALOG[command]).toBeDefined();
      const resolved = resolveSlashCommandPresentation(command, "English fallback");
      expect(resolved.isLocalized).toBe(true);
      expect(resolved.zhTitle).toBeTruthy();
      expect(resolved.nativeName).toBe(command);
      expect(resolved.description).toMatch(/[\u4e00-\u9fff]/u);
    }

    const swarm = resolveSlashCommandPresentation("swarm");
    expect(swarm.icon).toEqual({ kind: "swarm-bee" });
    expect(swarm.zhTitle).toBe("蜂群");
    expect(swarm.nativeName).toBe("swarm");
    expect(swarm.description).toContain("多智能体蜂群协作");

    // teamwork must NOT use bee icon
    const teamwork = resolveSlashCommandPresentation("teamwork");
    expect(teamwork.icon).toEqual({ kind: "lucide", icon: UsersIcon });
    expect(teamwork.zhTitle).toBe("团队协作");

    const schedule = resolveSlashCommandPresentation("schedule");
    expect(schedule.icon).toEqual({ kind: "lucide", icon: ClockIcon });
    expect(schedule.zhTitle).toBe("定时任务");
    expect(schedule.nativeName).toBe("schedule");

    // Usage limits, AGY doc/meta commands & Claude internal/junk commands are hidden across ALL agents
    const hiddenCommands = [
      "usage-limits",
      "usage_limits",
      "usage",
      "limits",
      "rate-limits",
      "rate_limits",
      "agy-customizations",
      "antigravity-guide",
      "run-workflow",
      "run_workflow",
      "__remote-workflow",
      "workflow-launch-exec",
      "agents",
      "heapdump",
      "color",
      "focus",
      "design-consent",
      "design-revoke",
    ];
    for (const hiddenCmd of hiddenCommands) {
      expect(isHiddenSlashCommand(hiddenCmd)).toBe(true);
      expect(isHiddenSlashCommand(`/${hiddenCmd}`)).toBe(true);
    }
    expect(isHiddenSlashCommand("btw")).toBe(false);
    expect(isHiddenSlashCommand("compact")).toBe(false);
    expect(isHiddenSlashCommand("browser")).toBe(false);
    expect(isHiddenSlashCommand("swarm")).toBe(false);
    expect(isHiddenSlashCommand("teamwork")).toBe(false);

    // ego-browser promotion identifier
    expect(isEgoBrowserIdentifier("ego-browser")).toBe(true);
    expect(isEgoBrowserIdentifier("/ego_browser")).toBe(true);
    expect(isEgoBrowserIdentifier("browser")).toBe(false);

    // Claude Code bundled skills emitted as slashCommands fold into 自带技能 with Chinese descriptions
    const claudeBundledSkills = [
      "deep-research",
      "design",
      "design-sync",
      "dataviz",
      "update-config",
      "verify",
      "simplify",
      "batch",
      "fewer-permission-prompts",
      "claude-api",
      "workflow-authoring",
      "run",
      "run-skill-generator",
      "plugin-authoring",
      "auto-mode-setup",
      "team-onboarding",
      "insights",
    ];
    for (const skillCmd of claudeBundledSkills) {
      expect(classifyProviderSlashCommandAsSkill(skillCmd, "Original EN")).toBe("builtin");
      const pres = resolveBundledSkillCommandPresentation(skillCmd, "Original EN", "builtin");
      expect(pres.isLocalized).toBe(true);
      expect(pres.description).toMatch(/[\u4e00-\u9fff]/u);
    }

    // Dynamic fallback catches future Claude/AGY skills with "Use this skill..." descriptions
    expect(
      classifyProviderSlashCommandAsSkill(
        "future-new-skill",
        "Use this skill whenever you need future behavior",
      ),
    ).toBe("builtin");
    // Personal skills leaked into slashCommands stay untranslated under 个人技能
    expect(
      classifyProviderSlashCommandAsSkill("brainstorming", "My note (user)"),
    ).toBe("personal");
    expect(
      classifyProviderSlashCommandAsSkill("brainstorming", "My note", new Set(["brainstorming"])),
    ).toBe("personal");
    const personalLeaked = resolveBundledSkillCommandPresentation(
      "brainstorming",
      "Custom prompt (user)",
      "personal",
    );
    expect(personalLeaked.description).toBe("Custom prompt");
    expect(personalLeaked.isLocalized).toBe(false);

    // Claude native commands & Codex system skills are localized
    for (const nativeCmd of [
      "loop",
      "debug",
      "advisor",
      "autocompact",
      "output-style",
      "reload-plugins",
      "reload-skills",
      "recap",
      "list-agents",
    ]) {
      const pres = resolveSlashCommandPresentation(nativeCmd);
      expect(pres.isLocalized).toBe(true);
      expect(pres.zhTitle).toBeTruthy();
      expect(pres.description).toMatch(/[\u4e00-\u9fff]/u);
    }
    expect(BUILTIN_SKILL_ZH_DESCRIPTIONS["create-statusline"]).toMatch(/[\u4e00-\u9fff]/u);
    expect(BUILTIN_SKILL_ZH_DESCRIPTIONS["review-agent"]).toMatch(/[\u4e00-\u9fff]/u);
  });

  it("respects explicit descriptionOverride (e.g. sideChatDisabledReason) and falls back cleanly for unknown commands", () => {
    const disabledSide = resolveSlashCommandPresentation(
      "side",
      "Ask a side question",
      "仅主线程支持旁路提问",
    );
    expect(disabledSide.zhTitle).toBe("旁路提问");
    expect(disabledSide.description).toBe("仅主线程支持旁路提问");

    const custom = resolveSlashCommandPresentation("my-custom-cmd", "Custom provider action");
    expect(custom.isLocalized).toBe(false);
    expect(custom.zhTitle).toBeNull();
    expect(custom.nativeName).toBe("/my-custom-cmd");
    expect(custom.description).toBe("Custom provider action");
    expect(custom.icon).toEqual({ kind: "lucide", icon: TerminalIcon });
  });
});

describe("composerSlashCatalog — personal vs built-in skill localization rule", () => {
  it("NEVER translates personal, repo, or project skill names or descriptions even if names collide with built-in skills", () => {
    const personalEgo = resolveSkillPresentation(
      makeSkill("ego-browser", {
        scope: "user",
        shortDescription: "Automate logged-in web tasks",
      }),
    );
    expect(personalEgo.category).toBe("personal");
    expect(personalEgo.icon).toBe(UserRoundIcon);
    expect(personalEgo.sourceBadgeLabel).toBe("个人");
    expect(personalEgo.nativeName).toBe("ego-browser");
    expect(personalEgo.description).toBe("Automate logged-in web tasks");
    expect(personalEgo.isLocalized).toBe(false);

    // Even when a personal/repo skill is named "pdf" or "plugin", NEVER localize it.
    const repoPdf = resolveSkillPresentation(
      makeSkill("pdf", {
        scope: "repo",
        description: "My custom internal PDF script",
      }),
    );
    expect(repoPdf.category).toBe("personal");
    expect(repoPdf.icon).toBe(FolderIcon);
    expect(repoPdf.sourceBadgeLabel).toBe("仓库");
    expect(repoPdf.description).toBe("My custom internal PDF script");
    expect(repoPdf.isLocalized).toBe(false);

    const projectPlugin = resolveSkillPresentation(
      makeSkill("plugin", {
        scope: "project",
        description: "Workspace local plugin helper",
      }),
    );
    expect(projectPlugin.category).toBe("personal");
    expect(projectPlugin.sourceBadgeLabel).toBe("项目");
    expect(projectPlugin.description).toBe("Workspace local plugin helper");
    expect(projectPlugin.isLocalized).toBe(false);
  });

  it("localizes built-in/system/app/other skills into Chinese while preserving native skill names", () => {
    const systemAgy = resolveSkillPresentation(
      makeSkill("agy-customizations", {
        scope: "system",
        description: "Comprehensive guide for Antigravity Customization System",
      }),
    );
    expect(systemAgy.category).toBe("builtin");
    expect(systemAgy.icon).toBe(SettingsIcon);
    expect(systemAgy.sourceBadgeLabel).toBe("系统");
    expect(systemAgy.nativeName).toBe("agy-customizations");
    expect(systemAgy.isLocalized).toBe(true);
    expect(systemAgy.description).toBe(BUILTIN_SKILL_ZH_DESCRIPTIONS["agy-customizations"]);

    const appPdf = resolveSkillPresentation(
      makeSkill("pdf", {
        path: "/home/u/.codex/plugins/doc/skills/pdf/SKILL.md",
        scope: "user",
        description: "Work with PDFs",
      }),
    );
    expect(appPdf.category).toBe("builtin");
    expect(appPdf.icon).toBe(BlocksIcon);
    expect(appPdf.sourceBadgeLabel).toBe("自带");
    expect(appPdf.isLocalized).toBe(true);
    expect(appPdf.description).toContain("PDF");

    // Verify all core built-in skills listed in spec have Chinese descriptions.
    const requiredBuiltinSkills = [
      "agy-customizations",
      "antigravity-guide",
      "generative_ui",
      "run-workflow",
      "mcp-app-development",
      "migrate-agent-settings",
      "migrate-workflows",
      "plugin",
      "automation",
      "swarm_monitor",
      "swarm_pane",
      "ui-plugin-navigation",
      "skill-creator",
      "skill-installer",
      "pdf",
      "docx",
      "xlsx",
      "pptx",
      "frontend-design",
      "webapp-testing",
      "mcp-builder",
    ];
    for (const skillName of requiredBuiltinSkills) {
      const pres = resolveSkillPresentation(
        makeSkill(skillName, { scope: "system", description: "Original EN" }),
      );
      expect(pres.isLocalized).toBe(true);
      expect(pres.description).toMatch(/[\u4e00-\u9fff]/u);
    }

    expect(classifyComposerSkillCategory("personal")).toBe("personal");
    expect(classifyComposerSkillCategory("repo")).toBe("personal");
    expect(classifyComposerSkillCategory("project")).toBe("personal");
    expect(classifyComposerSkillCategory("system")).toBe("builtin");
    expect(classifyComposerSkillCategory("app")).toBe("builtin");
    expect(classifyComposerSkillCategory("other")).toBe("builtin");
  });
});

describe("composerSlashCommandSearch — ordering, collapsible skills folder & bilingual search", () => {
  const sampleItems: SlashSearchItem[] = [
    // Deliberately scrambled input order to prove strict tier sorting
    makeSkillItem(makeSkill("agy-customizations", { scope: "system" })),
    makeProviderSlashItem("swarm", "Coordinate multi-agent swarm"),
    makeSkillItem(
      makeSkill("ego-browser", {
        scope: "user",
        shortDescription: "Automate logged-in web tasks",
      }),
    ),
    {
      id: "slash:model",
      type: "slash-command",
      command: "model",
      label: "/model",
      description: "Switch response model",
    },
    makeSkillItem(makeSkill("pdf", { path: "/u/.codex/plugins/pdf/SKILL.md", scope: "system" })),
    makeProviderSlashItem("goal", "Set a goal Codex keeps working toward until it is done"),
    makeProviderSlashItem("usage-limits", "Show this provider's usage limits"),
    makeProviderSlashItem("feedback", "Send this thread and logs"),
    makeSkillItem(
      makeSkill("brainstorming", {
        scope: "repo",
        shortDescription: "【需求探索】头脑风暴与设计关卡",
      }),
    ),
  ];

  it("orders bare `/` as native commands first, hides usage-limits/noise, and collapses personal + built-in skills into a single folder toggle", () => {
    const collapsed = buildComposerSlashMenuItems({
      items: [
        ...sampleItems,
        makeProviderSlashItem("agy-customizations", "AGY customization guide"),
        makeProviderSlashItem("antigravity-guide", "AGY usage guide"),
        makeProviderSlashItem("run-workflow", "Run workflow script"),
        {
          ...makeProviderSlashItem("deep-research", "Deep research harness"),
          skillCategory: "builtin" as const,
        },
      ],
      query: "",
      skillsExpanded: false,
    });

    expect(collapsed.map((item) => item.id)).toEqual([
      "slash:model",
      "provider-slash-command:codex:swarm",
      "provider-slash-command:codex:goal",
      "provider-slash-command:codex:feedback",
      "slash:skills-folder",
    ]);

    const folder = collapsed.at(-1);
    expect(folder).toMatchObject({
      id: "slash:skills-folder",
      type: "skill-group-toggle",
      expanded: false,
      personalCount: 2,
      builtinCount: 3,
      totalCount: 5,
      label: "技能",
      description: "个人 2 · 自带 3",
    });
  });

  it("expands bare `/` into toggle row -> personal skills -> built-in skills (including folded bundled slash commands)", () => {
    const expanded = buildComposerSlashMenuItems({
      items: [
        ...sampleItems,
        {
          ...makeProviderSlashItem("deep-research", "Deep research harness"),
          skillCategory: "builtin" as const,
        },
      ],
      query: "",
      skillsExpanded: true,
    });

    expect(expanded.map((item) => item.id)).toEqual([
      "slash:model",
      "provider-slash-command:codex:swarm",
      "provider-slash-command:codex:goal",
      "provider-slash-command:codex:feedback",
      "slash:skills-folder",
      "skill:codex:ego-browser",
      "skill:codex:brainstorming",
      "skill:codex:agy-customizations",
      "skill:codex:pdf",
      "provider-slash-command:codex:deep-research",
    ]);
    const folder = expanded.find(
      (item): item is Extract<ComposerCommandItem, { type: "skill-group-toggle" }> =>
        item.type === "skill-group-toggle",
    );
    expect(folder?.expanded).toBe(true);
    expect(folder?.label).toBe("收起技能");
  });

  it("auto-expands and matches bilingual English & Chinese queries across commands and skills while hiding usage-limits", () => {
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "蜂群", skillsExpanded: false })[0]
        ?.id,
    ).toBe("provider-slash-command:codex:swarm");
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "sw", skillsExpanded: false })[0]
        ?.id,
    ).toBe("provider-slash-command:codex:swarm");
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "目标", skillsExpanded: false })[0]
        ?.id,
    ).toBe("provider-slash-command:codex:goal");
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "模型", skillsExpanded: false })[0]
        ?.id,
    ).toBe("slash:model");
    // usage-limits is hidden across all agents
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "限额", skillsExpanded: false }),
    ).toEqual([]);
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "反馈", skillsExpanded: false })[0]
        ?.id,
    ).toBe("provider-slash-command:codex:feedback");
    // Auto-expands skills even when skillsExpanded is false
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "ego", skillsExpanded: false }).map(
        (item) => item.id,
      ),
    ).toEqual(["skill:codex:ego-browser"]);
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "pdf", skillsExpanded: false }).map(
        (item) => item.id,
      ),
    ).toEqual(["skill:codex:pdf"]);
    expect(
      searchSlashCommandItems(sampleItems, "技能").map((item) => item.id),
    ).toEqual([
      "skill:codex:brainstorming",
      "skill:codex:ego-browser",
      "skill:codex:agy-customizations",
      "skill:codex:pdf",
    ]);
    expect(orderSlashCommandItems(sampleItems).map((item) => item.id)).toEqual([
      "slash:model",
      "provider-slash-command:codex:swarm",
      "provider-slash-command:codex:goal",
      "provider-slash-command:codex:feedback",
      "skill:codex:ego-browser",
      "skill:codex:brainstorming",
      "skill:codex:agy-customizations",
      "skill:codex:pdf",
    ]);
  });
});

describe("@ mention enhancements — @对话 and @工作Agent", () => {
  const localEnv = EnvironmentId.make("env-local");
  const vpsEnv = EnvironmentId.make("env-vps");

  it("surfaces up to 4 most recent threads on bare `@` when includeRecentOnEmptyQuery is true and on `@对话`", () => {
    const shells: ComposerThreadCandidate[] = [
      makeThreadShell("t1", "Old thread", { updatedAt: "2026-10-01T00:00:00.000Z" }),
      makeThreadShell("t2", "Newest local thread", { updatedAt: "2026-10-10T00:00:00.000Z" }),
      makeThreadShell("t3", "Remote deploy thread", {
        environmentId: vpsEnv,
        updatedAt: "2026-10-09T00:00:00.000Z",
      }),
      makeThreadShell("t4", "Mid thread", { updatedAt: "2026-10-08T00:00:00.000Z" }),
      makeThreadShell("t5", "Fifth thread", { updatedAt: "2026-10-07T00:00:00.000Z" }),
      makeThreadShell("active", "Active thread", { updatedAt: "2026-10-12T00:00:00.000Z" }),
      makeThreadShell("archived", "Archived thread", {
        updatedAt: "2026-10-11T00:00:00.000Z",
        archivedAt: "2026-10-11T01:00:00.000Z",
      }),
    ];

    // Default remains backward-compatible: empty query returns []
    expect(
      matchComposerThreadItems({
        shells,
        environmentId: localEnv,
        linkedEnvironments: new Map([[vpsEnv, "Prod VPS"]]),
        excludeThreadId: ThreadId.make("active"),
        query: "",
        now: Date.parse("2026-10-15T00:00:00.000Z"),
      }),
    ).toEqual([]);

    // Opt-in empty query returns up to 4 recent threads with Chinese labels
    const recent = matchComposerThreadItems({
      shells,
      environmentId: localEnv,
      linkedEnvironments: new Map([[vpsEnv, "Prod VPS"]]),
      excludeThreadId: ThreadId.make("active"),
      query: "",
      now: Date.parse("2026-10-15T00:00:00.000Z"),
      includeRecentOnEmptyQuery: true,
    });
    expect(recent.map((item) => item.thread.threadId)).toEqual(["t2", "t3", "t4", "t5"]);
    expect(recent[0]?.description).toBe("当前工作区对话");
    expect(recent[1]?.description).toBe("Prod VPS 上的对话");

    // Chinese keyword `@对话` surfaces conversations immediately
    const byKeyword = matchComposerThreadItems({
      shells,
      environmentId: localEnv,
      linkedEnvironments: new Map([[vpsEnv, "Prod VPS"]]),
      excludeThreadId: ThreadId.make("active"),
      query: "对话",
      now: Date.parse("2026-10-15T00:00:00.000Z"),
      includeRecentOnEmptyQuery: true,
    });
    expect(byKeyword.length).toBe(5);
    expect(byKeyword[0]?.thread.threadId).toBe("t2");
  });

  it("surfaces ready working Agents on bare `@` and `@agent` / `@代理` while preserving backward compatibility", () => {
    const entries: ProviderInstanceEntry[] = [
      makeProviderEntry("codex", "codex", "Codex"),
      makeProviderEntry("claude", "claudeAgent", "Claude Code"),
      makeProviderEntry("antigravity", "antigravity", "Antigravity"),
      makeProviderEntry("disabled", "opencode", "OpenCode", { enabled: false }),
    ];
    const modelOptionsByInstance = new Map<ProviderInstanceId, ReadonlyArray<ModelEsque>>([
      [
        ProviderInstanceId.make("codex"),
        [
          { slug: "gpt-legacy", name: "GPT Legacy", isLegacy: true },
          { slug: "gpt-5.4-codex", name: "GPT-5.4 Codex", isDefault: true },
        ],
      ],
      [
        ProviderInstanceId.make("claude"),
        [{ slug: "claude-opus-4-6", name: "Claude Opus 4.6", isDefault: true }],
      ],
      [
        ProviderInstanceId.make("antigravity"),
        [{ slug: "gemini-3-pro", name: "Gemini 3 Pro", isDefault: true }],
      ],
      [
        ProviderInstanceId.make("disabled"),
        [{ slug: "opencode-default", name: "OpenCode Default", isDefault: true }],
      ],
    ]);

    // Default stays empty on bare query
    expect(
      matchComposerModelItems({
        instanceEntries: entries,
        modelOptionsByInstance,
        query: "",
      }),
    ).toEqual([]);

    // Opt-in surfaces ready Agents with primary models
    const bareAgents = matchComposerModelItems({
      instanceEntries: entries,
      modelOptionsByInstance,
      query: "",
      includeReadyAgentsOnEmptyQuery: true,
    });
    expect(bareAgents.map((item) => ({ label: item.label, model: item.model, desc: item.description }))).toEqual([
      { label: "Codex", model: "gpt-5.4-codex", desc: "工作 Agent · GPT-5.4 Codex" },
      { label: "Claude Code", model: "claude-opus-4-6", desc: "工作 Agent · Claude Opus 4.6" },
      { label: "Antigravity", model: "gemini-3-pro", desc: "工作 Agent · Gemini 3 Pro" },
    ]);

    // `@agent` and `@代理` surface all ready working Agents
    const byAgent = matchComposerModelItems({
      instanceEntries: entries,
      modelOptionsByInstance,
      query: "agent",
      includeReadyAgentsOnEmptyQuery: true,
    });
    expect(byAgent.slice(0, 3).map((item) => item.label)).toEqual([
      "Codex",
      "Claude Code",
      "Antigravity",
    ]);

    const byZhAgent = matchComposerModelItems({
      instanceEntries: entries,
      modelOptionsByInstance,
      query: "代理",
      includeReadyAgentsOnEmptyQuery: true,
    });
    expect(byZhAgent.map((item) => item.label)).toEqual(["Codex", "Claude Code", "Antigravity"]);
  });
});

describe("useComposerMenuItems — universal /btw, /compact, cross-provider /browser & Claude layout", () => {
  const defaultSlashLabels = {
    switchModel: "Switch response model for this thread",
    askSideQuestion: "Ask a side question in a new side chat",
    compactConversation: "Summarize the conversation and reduce context usage",
    invokeBrowser: "Invoke a browser agent for web tasks.",
    freshSession: "Start a fresh session; earlier messages stay visible",
    runProviderCommand: "Run provider command",
    formatScopedSkill: (scope: string) => `${scope} skill`,
  };
  const defaultSkillLabels = {
    runProviderSkill: "Run provider skill",
    formatScopedSkill: (scope: string) => `${scope} skill`,
  };

  it("promotes /browser universally whenever ego-browser is equipped on ANY local provider and hides ego-browser from 技能 & $ lists", () => {
    const claude = ProviderDriverKind.make("claudeAgent");
    const codex = ProviderDriverKind.make("codex");
    const agy = ProviderDriverKind.make("antigravity");

    const egoSkill = makeSkill("ego-browser", {
      scope: "user",
      shortDescription: "Operate logged-in Chromium browser",
    });
    const personalSkill = makeSkill("brainstorming", {
      scope: "user",
      shortDescription: "【需求探索】头脑风暴",
    });

    // Only Antigravity has ego-browser equipped in instanceEntries; active provider is Claude Code with NO ego-browser or native /browser
    const agyBase = makeProviderEntry("antigravity", "antigravity", "Antigravity");
    const agyWithEgo = makeProviderEntry("antigravity", "antigravity", "Antigravity", {
      snapshot: { ...agyBase.snapshot, skills: [egoSkill, personalSkill] },
    });
    const claudeEntry = makeProviderEntry("claude", "claudeAgent", "Claude Code");

    const claudeItems = buildComposerSlashTriggerItems({
      query: "",
      isAtPromptStart: true,
      sideChatAvailable: true,
      sideChatOffered: true,
      sideChatDisabledReason: null,
      freshSessionAvailable: true,
      compactSlashCommandAvailable: true,
      selectedProvider: claude,
      selectedProviderSkills: [],
      selectedProviderSlashCommands: [
        { name: "btw", description: "Native btw" },
        { name: "compact", description: "Native compact" },
        { name: "usage-limits", description: "Usage limits" },
        { name: "usage", description: "Usage" },
        { name: "limits", description: "Limits" },
        { name: "rate-limits", description: "Rate limits" },
        { name: "__remote-workflow", description: "Internal" },
        { name: "workflow-launch-exec", description: "Internal" },
        { name: "agents", description: "Agents" },
        { name: "heapdump", description: "Heapdump" },
        { name: "color", description: "Color" },
        { name: "focus", description: "Focus" },
        { name: "design-consent", description: "Consent" },
        { name: "design-revoke", description: "Revoke" },
        { name: "deep-research", description: "Deep research" },
        { name: "design", description: "Claude Design" },
        { name: "design-sync", description: "Sync design" },
        { name: "dataviz", description: "Data viz" },
        { name: "update-config", description: "Update config" },
        { name: "verify", description: "Verify changes" },
        { name: "simplify", description: "Simplify code" },
        { name: "batch", description: "Batch refactor" },
        { name: "fewer-permission-prompts", description: "Fewer prompts" },
        { name: "claude-api", description: "Claude API" },
        { name: "workflow-authoring", description: "Workflow authoring" },
        { name: "run", description: "Run app" },
        { name: "run-skill-generator", description: "Generate run skill" },
        { name: "plugin-authoring", description: "Plugin authoring" },
        { name: "auto-mode-setup", description: "Auto mode setup" },
        { name: "team-onboarding", description: "Team onboarding" },
        { name: "insights", description: "Insights" },
        { name: "future-dynamic-skill", description: "Use this skill when doing future things" },
        { name: "design", description: "My custom personal design note (user)" },
      ],
      showSkillsInSlashMenu: true,
      slashSkillsExpanded: true,
      instanceEntries: [claudeEntry, agyWithEgo],
      labels: defaultSlashLabels,
    });

    const ids = claudeItems.map((item) => item.id);
    // Universal commands present & deduplicated
    expect(ids.filter((id) => id === "slash:btw")).toHaveLength(1);
    expect(ids.filter((id) => id === "slash:compact")).toHaveLength(1);
    expect(ids.filter((id) => id === "slash:browser")).toHaveLength(1);
    expect(
      ids.some(
        (id) =>
          id.startsWith("provider-slash-command:") &&
          (id.endsWith(":btw") || id.endsWith(":compact")),
      ),
    ).toBe(false);

    // Cross-provider ego-browser promotion
    const browserItem = claudeItems.find((item) => item.id === "slash:browser");
    expect(browserItem).toMatchObject({
      type: "slash-command",
      command: "browser",
      browserDispatchMode: "ego-skill",
      egoBrowserSkillName: "ego-browser",
    });
    expect(browserItem?.description).toContain("ego-browser");

    // All hidden/junk commands excluded
    for (const hidden of [
      "usage-limits",
      "usage",
      "limits",
      "rate-limits",
      "__remote-workflow",
      "workflow-launch-exec",
      "agents",
      "heapdump",
      "color",
      "focus",
      "design-consent",
      "design-revoke",
    ]) {
      expect(ids.some((id) => id.endsWith(`:${hidden}`))).toBe(false);
    }

    // Skills folder holds personal `(user)` skill (untranslated) + all 17 bundled skills + dynamic fallback
    const folder = claudeItems.find((item) => item.type === "skill-group-toggle");
    expect(folder).toMatchObject({
      personalCount: 1,
      builtinCount: 18,
      totalCount: 19,
    });
    const personalItem = claudeItems.find(
      (item) => item.type === "provider-slash-command" && item.skillCategory === "personal",
    );
    expect(personalItem).toMatchObject({
      label: "/design",
      description: "My custom personal design note",
    });
    const foldedBuiltins = claudeItems.filter(
      (item) => item.type === "provider-slash-command" && item.skillCategory === "builtin",
    );
    expect(foldedBuiltins).toHaveLength(18);
    expect(
      foldedBuiltins.every((item) => item.type === "provider-slash-command" && item.label.startsWith("/")),
    ).toBe(true);

    // On Codex where ego-browser IS equipped directly, it is promoted to /browser and NEVER appears in 技能 or $
    const codexItems = buildComposerSlashTriggerItems({
      query: "",
      isAtPromptStart: true,
      sideChatAvailable: true,
      sideChatOffered: true,
      sideChatDisabledReason: null,
      freshSessionAvailable: false,
      compactSlashCommandAvailable: false,
      selectedProvider: codex,
      selectedProviderSkills: [egoSkill, personalSkill],
      selectedProviderSlashCommands: [{ name: "ego-browser", description: "Browser skill" }],
      showSkillsInSlashMenu: true,
      slashSkillsExpanded: true,
      instanceEntries: [],
      labels: defaultSlashLabels,
    });
    expect(codexItems.find((item) => item.id === "slash:browser")).toMatchObject({
      browserDispatchMode: "ego-skill",
      egoBrowserSkillName: "ego-browser",
    });
    expect(codexItems.some((item) => item.id.includes("ego-browser"))).toBe(false);
    expect(codexItems.find((item) => item.type === "skill-group-toggle")).toMatchObject({
      personalCount: 1,
      builtinCount: 0,
      totalCount: 1,
    });

    // `$` skill trigger NEVER shows ego-browser
    const dollarSkills = buildComposerSkillTriggerItems({
      query: "",
      selectedProvider: codex,
      selectedProviderSkills: [egoSkill, personalSkill],
      labels: defaultSkillLabels,
    });
    expect(dollarSkills.map((item) => item.id)).toEqual(["skill:codex:brainstorming"]);

    // Native `/browser` works when no provider has ego-browser, and hides AGY doc/meta commands
    const agyNativeBrowser = buildComposerSlashTriggerItems({
      query: "",
      isAtPromptStart: true,
      sideChatAvailable: true,
      sideChatOffered: true,
      sideChatDisabledReason: null,
      freshSessionAvailable: false,
      compactSlashCommandAvailable: true,
      selectedProvider: agy,
      selectedProviderSkills: [],
      selectedProviderSlashCommands: [
        { name: "browser", description: "Native browser" },
        { name: "agy-customizations", description: "Docs" },
        { name: "antigravity-guide", description: "Docs" },
        { name: "run-workflow", description: "Docs" },
      ],
      showSkillsInSlashMenu: true,
      slashSkillsExpanded: false,
      instanceEntries: [],
      labels: defaultSlashLabels,
    });
    expect(agyNativeBrowser.find((item) => item.id === "slash:browser")).toMatchObject({
      browserDispatchMode: "native-command",
    });
    expect(agyNativeBrowser.some((item) => item.id.includes("provider-slash-command"))).toBe(false);

    // No ego-browser on any provider & no native /browser => no /browser command
    const noBrowserItems = buildComposerSlashTriggerItems({
      query: "",
      isAtPromptStart: true,
      sideChatAvailable: true,
      sideChatOffered: true,
      sideChatDisabledReason: null,
      freshSessionAvailable: false,
      compactSlashCommandAvailable: true,
      selectedProvider: codex,
      selectedProviderSkills: [],
      selectedProviderSlashCommands: [],
      showSkillsInSlashMenu: true,
      slashSkillsExpanded: false,
      instanceEntries: [claudeEntry],
      labels: defaultSlashLabels,
    });
    expect(noBrowserItems.some((item) => item.id === "slash:browser")).toBe(false);
    expect(noBrowserItems.some((item) => item.id === "slash:btw")).toBe(true);
    expect(noBrowserItems.some((item) => item.id === "slash:compact")).toBe(true);
  });

  it("supports bilingual search on folded bundled skill commands and untranslated personal slash-command skills", () => {
    const claude = ProviderDriverKind.make("claudeAgent");
    const items: SlashSearchItem[] = [
      {
        ...makeProviderSlashItem("deep-research", "Run multi-agent web research", claude),
        skillCategory: "builtin",
      },
      {
        ...makeProviderSlashItem("custom-note", "Custom obsidian workflow (user)", claude),
        skillCategory: "personal",
      },
    ];
    expect(searchSlashCommandItems(items, "联网检索").map((item) => item.id)).toEqual([
      "provider-slash-command:claudeAgent:deep-research",
    ]);
    expect(searchSlashCommandItems(items, "multi-agent").map((item) => item.id)).toEqual([
      "provider-slash-command:claudeAgent:deep-research",
    ]);
    expect(searchSlashCommandItems(items, "obsidian").map((item) => item.id)).toEqual([
      "provider-slash-command:claudeAgent:custom-note",
    ]);
  });
});
