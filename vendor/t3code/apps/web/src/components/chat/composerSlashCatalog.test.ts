import {
  matchComposerThreadItems,
  type ComposerThreadCandidate,
} from "@t3tools/client-runtime/composerThreadItems";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
  type ServerProviderSkill,
} from "@t3tools/contracts";
import { ClockIcon, TerminalIcon, UserRoundIcon, FolderIcon, BlocksIcon, SettingsIcon } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { matchComposerModelItems } from "./composerModelMentions";
import {
  BUILTIN_SKILL_ZH_DESCRIPTIONS,
  SLASH_COMMAND_CATALOG,
  classifyComposerSkillCategory,
  resolveSkillPresentation,
  resolveSlashCommandPresentation,
} from "./composerSlashCatalog";
import {
  buildComposerSlashMenuItems,
  orderSlashCommandItems,
  searchSlashCommandItems,
  type SlashSearchItem,
} from "./composerSlashCommandSearch";
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
    expect(swarm.icon).toEqual({ kind: "emoji", emoji: "🐝" });
    expect(swarm.zhTitle).toBe("蜂群");
    expect(swarm.nativeName).toBe("swarm");
    expect(swarm.description).toContain("多智能体蜂群协作");

    const schedule = resolveSlashCommandPresentation("schedule");
    expect(schedule.icon).toEqual({ kind: "lucide", icon: ClockIcon });
    expect(schedule.zhTitle).toBe("定时任务");
    expect(schedule.nativeName).toBe("schedule");

    const usageLimits = resolveSlashCommandPresentation("/usage-limits");
    expect(usageLimits.zhTitle).toBe("用量限额");
    expect(usageLimits.nativeName).toBe("usage-limits");
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

  it("orders bare `/` as native commands first and collapses personal + built-in skills into a single folder toggle", () => {
    const collapsed = buildComposerSlashMenuItems({
      items: sampleItems,
      query: "",
      skillsExpanded: false,
    });

    expect(collapsed.map((item) => item.id)).toEqual([
      "slash:model",
      "provider-slash-command:codex:swarm",
      "provider-slash-command:codex:goal",
      "provider-slash-command:codex:usage-limits",
      "provider-slash-command:codex:feedback",
      "slash:skills-folder",
    ]);

    const folder = collapsed.at(-1);
    expect(folder).toMatchObject({
      id: "slash:skills-folder",
      type: "skill-group-toggle",
      expanded: false,
      personalCount: 2,
      builtinCount: 2,
      totalCount: 4,
      label: "技能",
      description: "个人 2 · 自带 2",
    });
  });

  it("expands bare `/` into toggle row -> personal skills -> built-in skills", () => {
    const expanded = buildComposerSlashMenuItems({
      items: sampleItems,
      query: "",
      skillsExpanded: true,
    });

    expect(expanded.map((item) => item.id)).toEqual([
      "slash:model",
      "provider-slash-command:codex:swarm",
      "provider-slash-command:codex:goal",
      "provider-slash-command:codex:usage-limits",
      "provider-slash-command:codex:feedback",
      "slash:skills-folder",
      "skill:codex:ego-browser",
      "skill:codex:brainstorming",
      "skill:codex:agy-customizations",
      "skill:codex:pdf",
    ]);
    const folder = expanded.find(
      (item): item is Extract<ComposerCommandItem, { type: "skill-group-toggle" }> =>
        item.type === "skill-group-toggle",
    );
    expect(folder?.expanded).toBe(true);
    expect(folder?.label).toBe("收起技能");
  });

  it("auto-expands and matches bilingual English & Chinese queries across commands and skills", () => {
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
    expect(
      buildComposerSlashMenuItems({ items: sampleItems, query: "限额", skillsExpanded: false })[0]
        ?.id,
    ).toBe("provider-slash-command:codex:usage-limits");
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
      "provider-slash-command:codex:usage-limits",
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
