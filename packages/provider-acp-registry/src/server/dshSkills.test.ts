// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import type * as AcpSchema from "@prismux/effect-acp/compat";
import { mergeToolCallState, parseSessionUpdateEvent } from "@prismux/provider-acp/server/runtimeModel";

import {
  extractDshProposedPlanMarkdown,
  extractDshSubagentUpdate,
  isDeepSeekHarnessAgentInfo,
  normalizeDshSessionUpdate,
  normalizeDshToolCall,
  rewriteDshUserText,
} from "./dshAcp.ts";
import {
  augmentDshAvailableCommands,
  discoverDshLocalSkills,
  DSH_BUILTIN_SLASH_COMMANDS,
  mergeAcpCommandsAndSkills,
  parseSkillMarkdownFrontmatter,
  resolveDshHomeDirectory,
} from "./dshSkills.ts";
import { normalizeAcpRegistryCommands } from "./probe.ts";

function makeTempDir(prefix: string): string {
  return NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
}

function writeSkill(dir: string, name: string, frontmatter: string, body = "# Instructions\n"): string {
  const skillDir = NodePath.join(dir, name);
  NodeFS.mkdirSync(skillDir, { recursive: true });
  const filePath = NodePath.join(skillDir, "SKILL.md");
  NodeFS.writeFileSync(filePath, `---\n${frontmatter}\n---\n\n${body}`, "utf8");
  return filePath;
}

describe("dshSkills", () => {
  it("parses YAML frontmatter across LF/CRLF, quotes, block scalars, and invocation flags", () => {
    expect(
      parseSkillMarkdownFrontmatter(
        [
          "---",
          "name: tdd",
          'description: "【高频】测试驱动开发——红绿重构循环"',
          "---",
          "# Body",
        ].join("\r\n"),
      ),
    ).toEqual({
      name: "tdd",
      description: "【高频】测试驱动开发——红绿重构循环",
    });

    expect(
      parseSkillMarkdownFrontmatter(
        [
          "---",
          "name: folded-skill",
          "description: >-",
          "  Multi-line folded",
          "  description text.",
          "user-invocable: false",
          "disable-model-invocation: true",
          "---",
        ].join("\n"),
      ),
    ).toEqual({
      name: "folded-skill",
      description: "Multi-line folded description text.",
      userInvocable: false,
      userInvocationOnly: true,
    });

    expect(parseSkillMarkdownFrontmatter("no frontmatter here", "fallback")).toBeUndefined();
    expect(parseSkillMarkdownFrontmatter("---\nname: invalid name\n---\n")).toBeUndefined();
  });

  it("discovers skills in DSH priority order, follows directory symlinks, and dedupes by name", () => {
    const root = makeTempDir("prismux-dsh-skills-");
    try {
      const workspace = NodePath.join(root, "repo");
      const subDir = NodePath.join(workspace, "packages", "app");
      const dshHome = NodePath.join(root, "dsh-home");
      const agentsHome = NodePath.join(root, "agents-home");
      const magpieLib = NodePath.join(root, "magpie-library");
      const bundledDir = NodePath.join(root, "bundled-skills");

      NodeFS.mkdirSync(NodePath.join(workspace, ".git"), { recursive: true });
      NodeFS.mkdirSync(subDir, { recursive: true });
      NodeFS.mkdirSync(NodePath.join(dshHome, "skills"), { recursive: true });
      NodeFS.mkdirSync(NodePath.join(agentsHome, "skills"), { recursive: true });
      NodeFS.mkdirSync(bundledDir, { recursive: true });

      // Workspace .dsh/skills overrides user DSH_HOME/skills with the same name
      writeSkill(
        NodePath.join(workspace, ".dsh", "skills"),
        "shared-skill",
        "name: shared-skill\ndescription: Project DSH override",
      );
      // Workspace .agents/skills
      writeSkill(
        NodePath.join(workspace, ".agents", "skills"),
        "repo-agent-skill",
        "name: repo-agent-skill\ndescription: Workspace agents skill",
      );
      // User DSH_HOME/skills (both direct and symlinked directory like Magpie Library)
      writeSkill(
        NodePath.join(dshHome, "skills"),
        "shared-skill",
        "name: shared-skill\ndescription: User DSH copy (should lose to project)",
      );
      const linkedSource = NodePath.join(magpieLib, "tdd");
      writeSkill(magpieLib, "tdd", "name: tdd\ndescription: Symlinked Magpie TDD skill");
      NodeFS.symlinkSync(
        linkedSource,
        NodePath.join(dshHome, "skills", "tdd"),
        HostProcess.Platform.defaultValue() === "win32" ? "junction" : "dir",
      );
      // Flat .md skill in user DSH_HOME/skills
      NodeFS.writeFileSync(
        NodePath.join(dshHome, "skills", "quick-note.md"),
        "---\nname: quick-note\ndescription: Flat markdown skill\n---\nBody\n",
        "utf8",
      );
      // User AGENTS_HOME/skills
      writeSkill(
        NodePath.join(agentsHome, "skills"),
        "ego-browser",
        "name: ego-browser\ndescription: Browser automation skill",
      );
      // Bundled skill
      writeSkill(
        bundledDir,
        "office-docx",
        "name: office-docx\ndescription: Office DOCX helper",
      );

      const skills = discoverDshLocalSkills({
        cwd: subDir,
        env: {
          DSH_HOME: dshHome,
          AGENTS_HOME: agentsHome,
          DSH_BUNDLED_SKILL_DIR: bundledDir,
        },
      });

      const byName = new Map(skills.map((skill) => [skill.name, skill]));
      expect([...byName.keys()]).toEqual([
        "shared-skill",
        "repo-agent-skill",
        "quick-note",
        "tdd",
        "ego-browser",
        "office-docx",
      ]);
      expect(byName.get("shared-skill")).toMatchObject({
        scope: "project",
        description: "Project DSH override",
      });
      expect(byName.get("tdd")).toMatchObject({
        scope: "user",
        description: "Symlinked Magpie TDD skill",
        enabled: true,
      });
      expect(byName.get("ego-browser")).toMatchObject({
        scope: "user",
        description: "Browser automation skill",
      });
      expect(byName.get("office-docx")).toMatchObject({
        scope: "system",
      });
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves DSH_HOME from desktop-next-last-home.json when DSH_HOME env is unset", () => {
    const root = makeTempDir("prismux-dsh-home-");
    try {
      const appData = NodePath.join(root, "AppData", "Roaming");
      const customHome = NodePath.join(root, "custom-dsh");
      NodeFS.mkdirSync(NodePath.join(appData, "DSH NEXT", "home"), { recursive: true });
      NodeFS.mkdirSync(customHome, { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(appData, "DSH NEXT", "home", "desktop-next-last-home.json"),
        JSON.stringify({ home: customHome }),
        "utf8",
      );

      expect(
        resolveDshHomeDirectory(
          { APPDATA: appData, USERPROFILE: root },
          "win32",
        ),
      ).toBe(customHome);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges ACP-advertised commands with DSH built-ins and prefers disk skills over synthetic acp://skill entries", () => {
    const merged = mergeAcpCommandsAndSkills(
      {
        slashCommands: [
          { name: "plan", description: "Native ACP plan command", input: { hint: "<topic>" } },
          { name: "compact", description: "Native ACP compact" },
        ],
        skills: [
          {
            name: "tdd",
            description: "Synthetic ACP TDD",
            path: "acp://skill/tdd",
            scope: "agent",
            enabled: true,
          },
          {
            name: "remote-only",
            description: "ACP only skill",
            path: "acp://skill/remote-only",
            scope: "agent",
            enabled: true,
          },
        ],
      },
      {
        slashCommands: DSH_BUILTIN_SLASH_COMMANDS,
        skills: [
          {
            name: "tdd",
            description: "Real local TDD skill",
            path: "C:\\Users\\Fish\\.dsh\\skills\\tdd\\SKILL.md",
            scope: "user",
            enabled: true,
          },
        ],
      },
    );

    expect(merged.slashCommands.map((c) => c.name)).toEqual([
      "plan",
      "compact",
      "goal",
      "permission",
      "feedback",
    ]);
    expect(merged.slashCommands[0]).toEqual({
      name: "plan",
      description: "Native ACP plan command",
      input: { hint: "<topic>" },
    });
    expect(merged.skills).toEqual([
      {
        name: "tdd",
        description: "Real local TDD skill",
        path: "C:\\Users\\Fish\\.dsh\\skills\\tdd\\SKILL.md",
        scope: "user",
        enabled: true,
      },
      {
        name: "remote-only",
        description: "ACP only skill",
        path: "acp://skill/remote-only",
        scope: "agent",
        enabled: true,
      },
    ]);
  });

  it("normalizes leading-slash commands, skill: prefixes, and _meta skill markers in normalizeAcpRegistryCommands", () => {
    const normalized = normalizeAcpRegistryCommands([
      { name: "/review", description: "Review patch", input: { type: "text", hint: "[branch]" } },
      { name: "review", description: "Duplicate without slash" },
      { name: "/skill:tdd", description: "TDD skill via slash prefix" },
      { name: "skill:brainstorming", description: "Brainstorming via skill prefix" },
      {
        name: "meta-skill",
        description: "Advertised via _meta",
        _meta: { kind: "skill" },
      },
      { name: "$dollar-skill", description: "Dollar skill" },
    ]);

    expect(normalized.slashCommands).toEqual([
      { name: "review", description: "Review patch", input: { hint: "[branch]" } },
    ]);
    expect(normalized.skills.map((s) => s.name)).toEqual([
      "tdd",
      "brainstorming",
      "meta-skill",
      "dollar-skill",
    ]);
  });

  it("augments empty DSH advertised commands with built-ins and local disk skills", () => {
    const root = makeTempDir("prismux-dsh-augment-");
    try {
      const dshHome = NodePath.join(root, ".dsh");
      writeSkill(
        NodePath.join(dshHome, "skills"),
        "systematic-debugging",
        "name: systematic-debugging\ndescription: Four-phase debugging",
      );

      const augmented = augmentDshAvailableCommands(
        { slashCommands: [], skills: [] },
        { cwd: root, env: { DSH_HOME: dshHome, AGENTS_HOME: NodePath.join(root, ".agents") } },
      );

      expect(augmented.slashCommands.map((c) => c.name)).toEqual([
        "plan",
        "goal",
        "permission",
        "feedback",
      ]);
      expect(augmented.skills.map((s) => s.name)).toEqual(["systematic-debugging"]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("dshAcp", () => {
  it("recognizes deepseek-harness-acp from initialize agentInfo", () => {
    expect(
      isDeepSeekHarnessAgentInfo({
        agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
      }),
    ).toBe(true);
    expect(isDeepSeekHarnessAgentInfo({ agentInfo: { name: "claude-acp", version: "1.0.0" } })).toBe(
      false,
    );
  });

  it("upgrades DSH kind='other' tool calls to semantic ACP kinds and preserves diffs across tool_call_update", () => {
    const pwshStart: AcpSchema.SessionNotification = {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-pwsh",
        title: "pwsh",
        kind: "other",
        status: "in_progress",
        rawInput: { command: "git status -s", description: "Check repository status" },
      },
    };
    const normalizedPwsh = normalizeDshSessionUpdate(pwshStart);
    expect(normalizedPwsh.update).toMatchObject({
      kind: "execute",
      title: "Check repository status",
    });
    const parsedPwsh = parseSessionUpdateEvent(normalizedPwsh).events[0];
    expect(parsedPwsh?._tag).toBe("ToolCallUpdated");
    if (parsedPwsh?._tag === "ToolCallUpdated") {
      expect(parsedPwsh.toolCall.kind).toBe("execute");
      expect(parsedPwsh.toolCall.command).toBe("git status -s");
    }

    const editStart: AcpSchema.SessionNotification = {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-edit",
        title: "edit",
        kind: "other",
        status: "in_progress",
        rawInput: {
          file_path: "src/main.ts",
          old_string: "const v = 1;",
          new_string: "const v = 2;",
        },
      },
    };
    const normalizedEdit = normalizeDshSessionUpdate(editStart);
    expect(normalizedEdit.update).toMatchObject({
      kind: "edit",
      locations: [{ path: "src/main.ts" }],
    });
    const parsedEditStart = parseSessionUpdateEvent(normalizedEdit).events[0];
    expect(parsedEditStart?._tag).toBe("ToolCallUpdated");

    // Subsequent DSH tool_call_update sends text output without diff content
    const editDone: AcpSchema.SessionNotification = {
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-edit",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "Updated src/main.ts" } }],
      },
    };
    const parsedEditDone = parseSessionUpdateEvent(normalizeDshSessionUpdate(editDone)).events[0];
    expect(parsedEditDone?._tag).toBe("ToolCallUpdated");
    if (
      parsedEditStart?._tag === "ToolCallUpdated" &&
      parsedEditDone?._tag === "ToolCallUpdated"
    ) {
      const merged = normalizeDshToolCall(
        mergeToolCallState(parsedEditStart.toolCall, parsedEditDone.toolCall),
      );
      expect(merged.kind).toBe("edit");
      expect(merged.status).toBe("completed");
      expect(merged.data.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "diff",
            path: "src/main.ts",
            oldText: "const v = 1;",
            newText: "const v = 2;",
          }),
        ]),
      );
    }
  });

  it("normalizes DSH read, grep, web_search, web_fetch, skill, exit_plan_mode, and subagent tool calls", () => {
    const webSearch = normalizeDshSessionUpdate({
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-ws",
        title: "web_search",
        kind: "other",
        status: "in_progress",
        rawInput: { queries: ["prismux acp", "deepseek harness"] },
      },
    });
    expect(webSearch.update).toMatchObject({
      kind: "search",
      title: "Web search",
      rawInput: {
        queries: ["prismux acp", "deepseek harness"],
        query: "prismux acp / deepseek harness",
      },
    });

    const skillNotif = normalizeDshSessionUpdate({
      sessionId: "s1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-skill",
        title: "skill",
        kind: "other",
        status: "in_progress",
        rawInput: { name: "tdd" },
      },
    });
    expect(skillNotif.update).toMatchObject({
      kind: "read",
      title: "Skill: tdd",
    });

    const planEvent = parseSessionUpdateEvent(
      normalizeDshSessionUpdate({
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-plan",
          title: "exit_plan_mode",
          kind: "other",
          status: "completed",
          rawInput: { plan: "# Implementation Plan\n\n1. Step one" },
        },
      }),
    ).events[0];
    expect(planEvent?._tag).toBe("ToolCallUpdated");
    if (planEvent?._tag === "ToolCallUpdated") {
      expect(extractDshProposedPlanMarkdown(planEvent.toolCall)).toBe(
        "# Implementation Plan\n\n1. Step one",
      );
    }

    const subagentEvent = parseSessionUpdateEvent(
      normalizeDshSessionUpdate({
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-sub",
          title: "subagent",
          kind: "other",
          status: "in_progress",
          rawInput: { name: "auditor", prompt: "Inspect auth layer", model: "deepseek-v4-pro" },
        },
      }),
    ).events[0];
    expect(subagentEvent?._tag).toBe("ToolCallUpdated");
    if (subagentEvent?._tag === "ToolCallUpdated") {
      expect(extractDshSubagentUpdate(subagentEvent.toolCall)).toEqual({
        nativeTaskId: "call-sub",
        childSessionId: "dsh-subagent:call-sub",
        prompt: "Inspect auth layer",
        title: "auditor",
        model: "deepseek-v4-pro",
        status: "running",
        result: null,
      });
    }
  });

  it("rewrites known $skill and /skill:name mentions to DSH /name gesture without altering $VAR or /command", () => {
    const known = new Map([
      ["tdd", "tdd"],
      ["brainstorming", "brainstorming"],
      ["ego-browser", "ego-browser"],
    ]);

    expect(rewriteDshUserText("$tdd 帮我给模块补单元测试", known)).toBe(
      "/tdd 帮我给模块补单元测试",
    );
    expect(rewriteDshUserText("先用 /skill:brainstorming 再用 $ego-browser 检查", known)).toBe(
      "先用 /brainstorming 再用 /ego-browser 检查",
    );
    expect(rewriteDshUserText("echo $HOME $PATH cost $100 and $unknown", known)).toBe(
      "echo $HOME $PATH cost $100 and $unknown",
    );
    expect(rewriteDshUserText("/plan design auth architecture", known)).toBe(
      "/plan design auth architecture",
    );
    // Respects inlineContextLength (handoff context prefix stays untouched)
    const handoffPrefix = "Earlier context mentioned $tdd\n\n";
    expect(
      rewriteDshUserText(`${handoffPrefix}$brainstorming next step`, known, handoffPrefix.length),
    ).toBe(`${handoffPrefix}/brainstorming next step`);
  });
});
