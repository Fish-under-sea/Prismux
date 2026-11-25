// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@prismux/core-contracts";
import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ComposerCommandMenu,
  composerSuggestionOptionId,
  groupComposerCommandMenuItems,
  type ComposerCommandItem,
} from "./ComposerCommandMenu";

function renderMenu(props: {
  items: ComposerCommandItem[];
  triggerKind: "slash-command" | "skill" | "path" | "pull-request" | null;
}): string {
  initializeGT({ defaultLocale: "zh", locales: ["en", "zh"] });
  return renderToStaticMarkup(
    createElement(
      GTProvider,
      { locale: "zh", translations: {} },
      createElement(ComposerCommandMenu, {
        listId: "suggestions",
        items: props.items,
        resolvedTheme: "dark",
        isLoading: false,
        triggerKind: props.triggerKind,
        activeItemId: props.items[0]?.id ?? null,
        onHighlightedItemChange: () => undefined,
        onSelect: () => undefined,
      }),
    ),
  );
}

describe("composerSuggestionOptionId", () => {
  it("keeps whitespace, escape-like paths, and malformed UTF-16 distinct", () => {
    const paths = [
      "docs/my file.md",
      "docs/my_file.md",
      "docs/my%20file.md",
      "docs/my\tfile.md",
      "docs/\ud800.md",
      "docs/\ud801.md",
      "docs/\udc00.md",
      "docs/\ufffd.md",
      "docs/\\ud800.md",
      "docs/\ud83d\ude80.md",
    ];
    const ids = paths.map((path) => composerSuggestionOptionId("suggestions", `path:file:${path}`));

    expect(new Set(ids).size).toBe(paths.length);
    for (const id of ids) expect(id).not.toMatch(/\s|[\ud800-\udfff]/u);
    expect(composerSuggestionOptionId("other-composer", paths[0]!)).not.toBe(
      composerSuggestionOptionId("suggestions", paths[0]!),
    );
  });
});

describe("ComposerCommandMenu rendering & grouping", () => {
  const codex = ProviderDriverKind.make("codex");
  const agy = ProviderDriverKind.make("antigravity");

  it("renders leading icons, Chinese titles, smaller English command names, Chinese descriptions, and collapsed skills folder on bare /", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "slash:model",
        type: "slash-command",
        command: "model",
        label: "/model",
        description: "Switch response model for this thread",
      },
      {
        id: "provider-slash-command:codex:swarm",
        type: "provider-slash-command",
        provider: codex,
        command: { name: "swarm", description: "Launch swarm" },
        label: "/swarm",
        description: "Launch swarm",
      },
      {
        id: "provider-slash-command:codex:teamwork",
        type: "provider-slash-command",
        provider: codex,
        command: { name: "teamwork", description: "Coordinate team" },
        label: "/teamwork",
        description: "Coordinate team",
      },
      {
        id: "provider-slash-command:codex:schedule",
        type: "provider-slash-command",
        provider: codex,
        command: { name: "schedule", description: "Schedule command" },
        label: "/schedule",
        description: "Schedule command",
      },
      {
        id: "provider-slash-command:codex:custom-ping",
        type: "provider-slash-command",
        provider: codex,
        command: { name: "custom-ping", description: "Ping backend" },
        label: "/custom-ping",
        description: "Ping backend",
      },
      {
        id: "slash:skills-folder",
        type: "skill-group-toggle",
        expanded: false,
        personalCount: 2,
        builtinCount: 3,
        totalCount: 5,
        label: "技能",
        description: "个人 2 · 自带 3",
      },
    ];

    const html = renderMenu({ items, triggerKind: "slash-command" });
    // Exactly one bee icon (exclusively for `/swarm`, NEVER for `/teamwork`)
    expect(html.match(/data-slash-icon="swarm-bee"/g)).toHaveLength(1);
    expect(html).toContain("蜂群");
    expect(html).toContain("swarm");
    expect(html).toContain("启动多智能体蜂群协作");
    expect(html).toContain("团队协作");
    expect(html).toContain("teamwork");
    expect(html).toContain("定时任务");
    expect(html).toContain("schedule");
    expect(html).toContain("切换模型");
    expect(html).toContain("/custom-ping");
    expect(html).toContain("Ping backend");
    expect(html).toContain('data-composer-skills-toggle="1"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("个人 2 · 自带 3");
  });

  it("renders expanded skills grouped into 个人技能 (untranslated) then 自带技能 (localized)", () => {
    const items: ComposerCommandItem[] = [
      {
        id: "slash:model",
        type: "slash-command",
        command: "model",
        label: "/model",
        description: "Switch response model",
      },
      {
        id: "slash:skills-folder",
        type: "skill-group-toggle",
        expanded: true,
        personalCount: 1,
        builtinCount: 1,
        totalCount: 2,
        label: "收起技能",
        description: "个人 1 · 自带 1",
      },
      {
        id: "skill:codex:ego-browser",
        type: "skill",
        provider: codex,
        skill: {
          name: "ego-browser",
          path: "/u/.gemini/config/skills/ego-browser/SKILL.md",
          enabled: true,
          scope: "user",
          shortDescription: "Automate logged-in web tasks",
        },
        label: "/skill:ego-browser",
        description: "Automate logged-in web tasks",
      },
      {
        id: "skill:antigravity:agy-customizations",
        type: "skill",
        provider: agy,
        skill: {
          name: "agy-customizations",
          path: "/builtin/skills/agy-customizations/SKILL.md",
          enabled: true,
          scope: "system",
          description: "Comprehensive guide for Antigravity",
        },
        label: "/skill:agy-customizations",
        description: "Comprehensive guide for Antigravity",
      },
    ];

    const groups = groupComposerCommandMenuItems(items, "slash-command");
    expect(groups.map((group) => group.label)).toEqual([null, "个人技能", "自带技能"]);

    const html = renderMenu({ items, triggerKind: "slash-command" });
    expect(html).toContain('data-composer-section-label="个人技能"');
    expect(html).toContain('data-composer-section-label="自带技能"');
    expect(html.indexOf('data-composer-section-label="个人技能"')).toBeLessThan(
      html.indexOf('data-composer-section-label="自带技能"'),
    );
    // Personal skill preserves original name and English description untouched
    expect(html).toContain("ego-browser");
    expect(html).toContain("Automate logged-in web tasks");
    expect(html).toContain("个人");
    // Built-in skill renders native name + localized Chinese description
    expect(html).toContain("agy-customizations");
    expect(html).toContain("Antigravity 自定义体系指南");
    expect(html).toContain("系统");
  });

  it("renders sectioned `@` menu headers and badges for 对话, 工作 Agent, 已连接主机, and 工作区文件", () => {
    const envId = EnvironmentId.make("env-local");
    const items: ComposerCommandItem[] = [
      {
        id: "thread:env-local:t1",
        type: "thread",
        thread: { environmentId: envId, threadId: ThreadId.make("t1") },
        label: "重构斜杠命令菜单",
        description: "当前工作区对话",
      },
      {
        id: "model:codex:gpt-5.4-codex",
        type: "model",
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4-codex",
        driverKind: codex,
        providerDisplayName: "Codex",
        acpRegistryAgentId: undefined,
        acpRegistryIconUrl: undefined,
        label: "Codex",
        description: "工作 Agent · GPT-5.4 Codex",
      },
      {
        id: "environment:env-vps",
        type: "environment",
        environmentId: EnvironmentId.make("env-vps"),
        machine: "cloud",
        label: "Hetzner VPS",
        description: "已连接主机",
      },
      {
        id: "path:file:src/index.ts",
        type: "path",
        path: "src/index.ts",
        pathKind: "file",
        searchTarget: { environmentId: envId, cwd: "/repo", query: "" },
        label: "index.ts",
        description: "src",
      },
    ];

    const groups = groupComposerCommandMenuItems(items, "path");
    expect(groups.map((group) => group.label)).toEqual([
      "对话",
      "工作 Agent",
      "已连接主机",
      "工作区文件",
    ]);

    const html = renderMenu({ items, triggerKind: "path" });
    expect(html).toContain('data-composer-section-label="对话"');
    expect(html).toContain('data-composer-section-label="工作 Agent"');
    expect(html).toContain('data-composer-section-label="已连接主机"');
    expect(html).toContain('data-composer-section-label="工作区文件"');
    expect(html).toContain("重构斜杠命令菜单");
    expect(html).toContain("工作 Agent · GPT-5.4 Codex");
    expect(html).toContain("Hetzner VPS");
    expect(html).toContain("主机");
  });

  it("folds Claude Code bundled-skill slash commands into 自带技能 with localized Chinese descriptions", () => {
    const claude = ProviderDriverKind.make("claudeAgent");
    const items: ComposerCommandItem[] = [
      {
        id: "slash:model",
        type: "slash-command",
        command: "model",
        label: "/model",
        description: "切换模型",
      },
      {
        id: "slash:btw",
        type: "slash-command",
        command: "btw",
        label: "/btw",
        description: "在不打断主线程的前提下发起旁路支线提问",
      },
      {
        id: "slash:compact",
        type: "slash-command",
        command: "compact",
        label: "/compact",
        description: "总结并压缩当前对话历史，释放上下文窗口",
      },
      {
        id: "slash:browser",
        type: "slash-command",
        command: "browser",
        label: "/browser",
        description: "调用 ego-browser 操控真实浏览器，打开网页、填写表单、截屏与交互测试",
        browserDispatchMode: "ego-skill",
        egoBrowserSkillName: "ego-browser",
      },
      {
        id: "slash:skills-folder",
        type: "skill-group-toggle",
        expanded: true,
        personalCount: 0,
        builtinCount: 2,
        totalCount: 2,
        label: "收起技能",
        description: "个人 0 · 自带 2",
      },
      {
        id: "provider-slash-command:claudeAgent:deep-research",
        type: "provider-slash-command",
        provider: claude,
        command: { name: "deep-research", description: "Deep research harness" },
        label: "/deep-research",
        description: "Deep research harness",
        skillCategory: "builtin",
      },
      {
        id: "provider-slash-command:claudeAgent:simplify",
        type: "provider-slash-command",
        provider: claude,
        command: { name: "simplify", description: "Review the changed code" },
        label: "/simplify",
        description: "Review the changed code",
        skillCategory: "builtin",
      },
    ];

    const groups = groupComposerCommandMenuItems(items, "slash-command");
    expect(groups.map((group) => group.label)).toEqual([null, "自带技能"]);
    const html = renderMenu({ items, triggerKind: "slash-command" });
    expect(html).toContain("旁路提问");
    expect(html).toContain("上下文压缩");
    expect(html).toContain("浏览器操控");
    expect(html).toContain("deep-research");
    expect(html).toContain("多路并行联网检索");
    expect(html).toContain("simplify");
    expect(html).toContain("审查近期代码改动并精简冗余逻辑");
  });

  it("wires slashSkillsExpanded toggle and logo-only ModelPicker agent switcher cleanly", () => {
    const chatDir = NodePath.dirname(
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    );
    const source = NodeFS.readFileSync(NodePath.join(chatDir, "ChatComposer.tsx"), "utf8");
    expect(source).toContain("const [slashSkillsExpanded, setSlashSkillsExpanded] = useState(false)");
    expect(source).toContain('composerTriggerKind !== "slash-command" && slashSkillsExpanded');
    expect(source).toContain("slashSkillsExpanded,");
    expect(source).toContain('if (item.type === "skill-group-toggle")');

    const pickerSource = NodeFS.readFileSync(
      NodePath.join(chatDir, "ModelPickerContent.tsx"),
      "utf8",
    );
    expect(pickerSource).toContain('data-model-picker-agent-switcher-list="true"');
    expect(pickerSource).not.toContain("切换代理");
    expect(pickerSource).not.toContain("data-model-picker-switch-agent-toggle");
    // Verify switcher chips are logo-only (no visible text span next to AgentBrandLogo)
    const switcherBlockMatch = pickerSource.match(
      /data-model-picker-agent-switcher-list="true"[\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(switcherBlockMatch?.[0]).toContain("<AgentBrandLogo");
    expect(switcherBlockMatch?.[0]).not.toContain("{brandLabel}</span>");
    expect(switcherBlockMatch?.[0]).toContain("aria-label={brandLabel}");
  });
});
