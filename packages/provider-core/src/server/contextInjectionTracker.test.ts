// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
  OrchestrationV2TurnItem,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  buildContextInjectionTurnItem,
  createTurnContextInjectionTracker,
} from "./contextInjectionTracker.ts";

const encodeTurnItem = Schema.encodeSync(OrchestrationV2TurnItem);
const decodeTurnItem = Schema.decodeSync(OrchestrationV2TurnItem);
const tempDirs: Array<string> = [];

function createTempDir(prefix: string): string {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

describe("TurnContextInjectionTracker", () => {
  it("emits on first turn, skips when unchanged, emits update on edit, and emits remove on delete", () => {
    const root = createTempDir("prismux-ctx-tracker-");
    const homeDir = NodePath.join(root, "home");
    const workspaceDir = NodePath.join(root, "repo");
    const subDir = NodePath.join(workspaceDir, "packages", "app");
    NodeFS.mkdirSync(NodePath.join(homeDir, ".codex"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(workspaceDir, ".git"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/feat/ctx\n");
    NodeFS.mkdirSync(subDir, { recursive: true });

    const globalAgents = NodePath.join(homeDir, ".codex", "AGENTS.md");
    const repoAgents = NodePath.join(workspaceDir, "AGENTS.md");
    NodeFS.writeFileSync(globalAgents, "# Global Codex rules\nAlways stay concise.\n", "utf8");
    NodeFS.writeFileSync(repoAgents, "# Repo rules\nFollow strict TypeScript.\n", "utf8");

    const tracker = createTurnContextInjectionTracker();

    // Turn 1: emits agent-instructions + runtime-context (no skills exist -> no skill-catalog)
    const turn1 = tracker.observeTurn({
      providerThreadId: "pt-codex-1",
      agent: "codex",
      cwd: workspaceDir,
      homeDir,
      env: {},
      runtimeMode: "full-access",
      interactionMode: "default",
      model: "gpt-5.4",
    });
    expect(turn1.map((item) => item.sourceKind)).toEqual(["agent-instructions", "runtime-context"]);

    const instructions1 = turn1.find((item) => item.sourceKind === "agent-instructions")!;
    expect(instructions1.form).toBe("instructions");
    expect(instructions1.statusLabel).toBe("已载入");
    expect(instructions1.baseline).toBe(true);
    expect(instructions1.files?.map((f) => ({ action: f.action, path: f.path }))).toEqual([
      { action: "set", path: "~/.codex/AGENTS.md" },
      { action: "set", path: "AGENTS.md" },
    ]);
    expect(instructions1.content).toContain("Global Codex rules");
    expect(instructions1.content).toContain("Repo rules");

    const runtime1 = turn1.find((item) => item.sourceKind === "runtime-context")!;
    expect(runtime1.form).toBe("snapshot");
    expect(runtime1.statusLabel).toBe("已载入");
    expect(runtime1.sections?.find((s) => s.name === "git-branch")?.text).toBe("feat/ctx");

    // Turn 2: unchanged -> emits NOTHING
    const turn2 = tracker.observeTurn({
      providerThreadId: "pt-codex-1",
      agent: "codex",
      cwd: workspaceDir,
      homeDir,
      env: {},
      runtimeMode: "full-access",
      interactionMode: "default",
      model: "gpt-5.4",
    });
    expect(turn2).toEqual([]);

    // Turn 3: repo AGENTS.md edited -> emits ONLY agent-instructions update
    NodeFS.writeFileSync(repoAgents, "# Repo rules\nUpdated strict rules.\n", "utf8");
    const turn3 = tracker.observeTurn({
      providerThreadId: "pt-codex-1",
      agent: "codex",
      cwd: workspaceDir,
      homeDir,
      env: {},
      runtimeMode: "full-access",
      interactionMode: "default",
      model: "gpt-5.4",
    });
    expect(turn3).toHaveLength(1);
    expect(turn3[0]?.sourceKind).toBe("agent-instructions");
    expect(turn3[0]?.statusLabel).toBe("已更新");
    expect(turn3[0]?.supersedesPrevious).toBe(true);
    expect(turn3[0]?.files?.map((f) => ({ action: f.action, path: f.path }))).toEqual([
      { action: "replace", path: "AGENTS.md" },
    ]);
    expect(turn3[0]?.content).toContain("Updated strict rules.");

    // Turn 4: repo AGENTS.md deleted -> emits removal
    NodeFS.rmSync(repoAgents);
    const turn4 = tracker.observeTurn({
      providerThreadId: "pt-codex-1",
      agent: "codex",
      cwd: workspaceDir,
      homeDir,
      env: {},
      runtimeMode: "full-access",
      interactionMode: "default",
      model: "gpt-5.4",
    });
    expect(turn4).toHaveLength(1);
    expect(turn4[0]?.statusLabel).toBe("已移除");
    expect(turn4[0]?.files?.map((f) => ({ action: f.action, path: f.path }))).toEqual([
      { action: "remove", path: "AGENTS.md" },
    ]);
  });

  it("never fabricates missing files for non-existent workspaces or empty homes", () => {
    const root = createTempDir("prismux-ctx-empty-");
    const emptyHome = NodePath.join(root, "empty-home");
    NodeFS.mkdirSync(emptyHome, { recursive: true });
    const missingCwd = NodePath.join(root, "does-not-exist");

    const tracker = createTurnContextInjectionTracker();
    const emitted = tracker.observeTurn({
      providerThreadId: "pt-missing",
      agent: "claude",
      cwd: missingCwd,
      homeDir: emptyHome,
      env: {},
    });
    expect(emitted).toEqual([]);
  });

  it("discovers Antigravity standard local files and official discoveredSkills without touching state.vscdb", () => {
    const root = createTempDir("prismux-ctx-agy-");
    const homeDir = NodePath.join(root, "home");
    const workspaceDir = NodePath.join(root, "workspace");
    NodeFS.mkdirSync(NodePath.join(homeDir, ".gemini", "config"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(workspaceDir, ".agent", "rules"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(workspaceDir, ".agent", "skills", "tdd"), { recursive: true });

    NodeFS.writeFileSync(
      NodePath.join(homeDir, ".gemini", "config", "GEMINI.md"),
      "Global Gemini rules",
      "utf8",
    );
    NodeFS.writeFileSync(
      NodePath.join(workspaceDir, ".agent", "rules", "01-style.md"),
      "Rule 1",
      "utf8",
    );
    NodeFS.writeFileSync(
      NodePath.join(workspaceDir, ".agent", "skills", "tdd", "SKILL.md"),
      "---\nname: tdd\ndescription: Red-Green-Refactor workflow\n---\n# TDD\n",
      "utf8",
    );

    const tracker = createTurnContextInjectionTracker();
    const emitted = tracker.observeTurn({
      providerThreadId: "pt-agy-1",
      agent: "antigravity",
      cwd: workspaceDir,
      homeDir,
      env: {},
      discoveredSkills: [{ name: "brainstorming", description: "Explore requirements first" }],
    });

    const instructions = emitted.find((item) => item.sourceKind === "agent-instructions");
    expect(instructions?.files?.map((file) => file.path)).toEqual([
      "~/.gemini/config/GEMINI.md",
      ".agent/rules/01-style.md",
    ]);

    const catalog = emitted.find((item) => item.sourceKind === "skill-catalog");
    expect(catalog?.form).toBe("catalog");
    expect(catalog?.entries).toEqual([
      { name: "brainstorming", description: "Explore requirements first" },
      { name: "tdd", description: "Red-Green-Refactor workflow" },
    ]);
  });

  it("tracks OpenCode opencode.json instructions, Pi global AGENTS.md, and optional time-context", () => {
    const root = createTempDir("prismux-ctx-oc-pi-");
    const homeDir = NodePath.join(root, "home");
    const workspaceDir = NodePath.join(root, "ws");
    NodeFS.mkdirSync(NodePath.join(homeDir, ".pi", "agent"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(workspaceDir, "docs"), { recursive: true });

    NodeFS.writeFileSync(NodePath.join(workspaceDir, "docs", "custom.md"), "Custom guide", "utf8");
    NodeFS.writeFileSync(
      NodePath.join(workspaceDir, "opencode.json"),
      JSON.stringify({ instructions: ["docs/custom.md", "https://example.com/ignored.md"] }),
      "utf8",
    );
    NodeFS.writeFileSync(NodePath.join(homeDir, ".pi", "agent", "AGENTS.md"), "Pi global", "utf8");

    const tracker = createTurnContextInjectionTracker();
    const openCodeItems = tracker.observeTurn({
      providerThreadId: "pt-oc-1",
      agent: "opencode",
      cwd: workspaceDir,
      homeDir,
      env: {},
      includeTimeContext: true,
      now: new Date("2026-11-26T10:00:00Z"),
      timeZone: "Asia/Shanghai",
    });
    expect(
      openCodeItems.find((i) => i.sourceKind === "agent-instructions")?.files?.map((f) => f.path),
    ).toEqual(["docs/custom.md"]);
    expect(
      openCodeItems.find((i) => i.sourceKind === "time-context")?.sections?.[0]?.text,
    ).toContain("Asia/Shanghai");

    const piItems = tracker.observeTurn({
      providerThreadId: "pt-pi-1",
      agent: "pi",
      cwd: workspaceDir,
      homeDir,
      env: {},
    });
    expect(
      piItems.find((i) => i.sourceKind === "agent-instructions")?.files?.map((f) => f.path),
    ).toEqual(["~/.pi/agent/AGENTS.md"]);

    // Validate built TurnItem passes OrchestrationV2TurnItem Effect Schema decode/encode
    const turnItem = buildContextInjectionTurnItem({
      id: TurnItemId.make("ti-ctx-1"),
      threadId: ThreadId.make("thread-ctx-1"),
      runId: RunId.make("run-ctx-1"),
      nodeId: NodeId.make("node-ctx-1"),
      providerThreadId: ProviderThreadId.make("pt-pi-1"),
      providerTurnId: ProviderTurnId.make("pturn-1"),
      nativeItemRef: null,
      ordinal: 1,
      occurredAt: DateTime.makeUnsafe("2026-11-26T10:00:00Z"),
      payload: piItems[0]!,
    });
    const encoded = encodeTurnItem(turnItem);
    const decoded = decodeTurnItem(encoded);
    expect(decoded.type).toBe("context_injection");
    if (decoded.type === "context_injection") {
      expect(decoded.label).toBe("~/.pi/agent/AGENTS.md");
      expect(decoded.statusLabel).toBe("已载入");
    }
  });
});
