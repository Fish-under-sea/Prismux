// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";

import { EnvironmentId, type ScheduledTask } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSettingsScope } from "../settings/settingsScope";
import {
  filterScheduledTasks,
  formatScheduledTaskExpression,
  formatScheduledTaskWorkspaceStrategy,
  getScheduledTasksPageCopy,
  resolveScheduledTasksEffectiveEnvironments,
  resolveScheduledTasksScopeSearch,
  summarizeScheduledTasks,
} from "./scheduledTasksPage.logic";

type SampleTask = Pick<
  ScheduledTask,
  "title" | "prompt" | "enabled" | "schedule" | "lastRunStatus" | "blockedByPolicy"
>;

const SAMPLE_TASKS: readonly SampleTask[] = [
  {
    title: "Daily Sentry triage",
    prompt: "Check production errors and open summary",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
    lastRunStatus: "succeeded",
  },
  {
    title: "Nightly dependency audit",
    prompt: "Run pnpm audit and report vulnerabilities",
    enabled: false,
    schedule: { type: "interval", everyMs: 3_600_000 },
    lastRunStatus: "failed",
  },
  {
    title: "GitHub release webhook",
    prompt: "Generate release notes when tag pushes",
    enabled: true,
    schedule: { type: "webhook", signature: null },
    lastRunStatus: "never",
  },
  {
    title: "Policy blocked webhook",
    prompt: "Blocked by managed policy",
    enabled: true,
    schedule: { type: "webhook", signature: null },
    lastRunStatus: "never",
    blockedByPolicy: "Disabled by admin",
  },
];

describe("ScheduledTasksPage standalone panel logic & 3-panel workPanels glass / theme contracts", () => {
  it("provides localized Chinese & English copy with 「定时任务」 and Chinese Webhook 回调 naming", () => {
    const zh = getScheduledTasksPageCopy("zh-CN");
    const en = getScheduledTasksPageCopy("en-US");

    expect(zh.isZh).toBe(true);
    expect(zh.pageTitle).toBe("定时任务");
    expect(zh.newTaskAction).toBe("新建定时任务");
    expect(zh.createFirstTaskCta).toBe("立即创建定时任务");
    expect(zh.filterWebhook).toBe("Webhook 回调");
    expect(zh.searchPlaceholder).toBe("搜索定时任务...");
    expect(zh.summaryBadge(2, 4)).toBe("2 / 4 启用");
    expect(zh.quickTemplates).toHaveLength(3);

    expect(en.isZh).toBe(false);
    expect(en.pageTitle).toBe("Scheduled Tasks");
    expect(en.newTaskAction).toBe("New task");
    expect(en.filterWebhook).toBe("Webhook");
    expect(en.summaryBadge(2, 4)).toBe("2 / 4 active");
    expect(en.quickTemplates).toHaveLength(3);
  });

  it("resolves scope search cleanly so local connected environments are never falsely hidden as unavailable", () => {
    const localId = EnvironmentId.make("local-desktop");
    const remoteId = EnvironmentId.make("remote-linux");
    const available = [
      {
        environmentId: localId,
        label: "Local Desktop",
        connection: { phase: "connected" },
        serverConfig: { environment: { capabilities: {} } },
      },
      {
        environmentId: remoteId,
        label: "Remote Linux",
        connection: { phase: "disconnected" },
        serverConfig: null,
      },
    ];

    // Default / "all" produces `{}` so resolveSettingsScope returns kind="all" (never kind="unavailable").
    const defaultSearch = resolveScheduledTasksScopeSearch(undefined);
    expect(defaultSearch).toEqual({});
    expect(resolveScheduledTasksScopeSearch("all")).toEqual({});
    expect(resolveScheduledTasksScopeSearch(localId)).toEqual({ machine: localId });

    const resolvedAll = resolveSettingsScope(defaultSearch, [], available);
    expect(resolvedAll.kind).toBe("all");
    expect(resolvedAll.environmentIds).toEqual([localId, remoteId]);

    // Defensive fallback recovers connected local environments if scoped list is ever empty.
    const fallback = resolveScheduledTasksEffectiveEnvironments({
      scopedEnvironments: [],
      scopedConnectedEnvironments: [],
      availableEnvironments: available,
      primaryEnvironmentId: localId,
    });
    expect(fallback.environments).toHaveLength(2);
    expect(fallback.connectedEnvironments.map((e) => e.environmentId)).toEqual([localId]);
    expect(fallback.defaultEnvironment?.environmentId).toBe(localId);
  });

  it("formats schedule expressions and workspace strategies concisely for full-width task cards", () => {
    expect(
      formatScheduledTaskExpression(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
        true,
      ),
    ).toBe("0 9 * * 1-5");
    expect(formatScheduledTaskExpression({ type: "fixed_time", timeOfDay: "08:30" }, true)).toBe(
      "30 8 * * *",
    );
    expect(formatScheduledTaskExpression({ type: "interval", everyMs: 15 * 60_000 }, true)).toBe(
      "*/15 * * * *",
    );
    expect(formatScheduledTaskExpression({ type: "interval", everyMs: 2 * 3_600_000 }, true)).toBe(
      "0 */2 * * *",
    );
    expect(formatScheduledTaskExpression({ type: "webhook", signature: null }, true)).toBe(
      "POST · Webhook 回调",
    );
    expect(formatScheduledTaskExpression({ type: "once", runAt: "2026-12-01T09:00:00Z" }, true)).toBe(
      "单次计划",
    );

    expect(formatScheduledTaskWorkspaceStrategy({ type: "root" }, true)).toBe("项目主目录");
    expect(
      formatScheduledTaskWorkspaceStrategy({ type: "worktree", baseRef: "main" }, true),
    ).toBe("独立 Worktree (main)");
    expect(
      formatScheduledTaskWorkspaceStrategy(
        { type: "existing_worktree", worktreePath: "/tmp/wt" },
        true,
      ),
    ).toBe("指定检出目录");
  });

  it("summarizes and filters scheduled tasks accurately by status and query", () => {
    const summary = summarizeScheduledTasks(SAMPLE_TASKS);
    expect(summary).toEqual({
      total: 4,
      enabled: 3,
      paused: 1,
      webhook: 2,
      failed: 1,
    });

    expect(
      filterScheduledTasks(SAMPLE_TASKS, { query: "", statusFilter: "all" }).map((t) => t.title),
    ).toHaveLength(4);
    expect(
      filterScheduledTasks(SAMPLE_TASKS, { query: "", statusFilter: "enabled" }).map((t) => t.title),
    ).toEqual(["Daily Sentry triage", "GitHub release webhook"]);
    expect(
      filterScheduledTasks(SAMPLE_TASKS, { query: "", statusFilter: "paused" }).map((t) => t.title),
    ).toEqual(["Nightly dependency audit"]);
    expect(
      filterScheduledTasks(SAMPLE_TASKS, { query: "", statusFilter: "webhook" }).map((t) => t.title),
    ).toEqual(["GitHub release webhook", "Policy blocked webhook"]);
    expect(
      filterScheduledTasks(SAMPLE_TASKS, { query: "sentry", statusFilter: "all" }).map(
        (t) => t.title,
      ),
    ).toEqual(["Daily Sentry triage"]);
    expect(
      filterScheduledTasks(SAMPLE_TASKS, { query: "pnpm audit", statusFilter: "paused" }).map(
        (t) => t.title,
      ),
    ).toEqual(["Nightly dependency audit"]);
  });

  it("mounts Tasks, Workspace Board, and Scheduled Tasks onto unified full-width workPanels glass zone with zero whiteout pills", () => {
    const srcRoot = NodePath.resolve(
      NodePath.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
      "../..",
    );

    const tasksSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/tasks/TasksPage.tsx"),
      "utf8",
    );
    const boardSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/workspaceBoard/WorkspaceBoardPage.tsx"),
      "utf8",
    );
    const boardLogicSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/workspaceBoard/workspaceBoard.logic.ts"),
      "utf8",
    );
    const scheduledSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/scheduledTasks/ScheduledTasksPage.tsx"),
      "utf8",
    );
    const diagnosticsSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "prismux/settings/PrismuxDiagnosticsSection.tsx"),
      "utf8",
    );

    // 1. All 3 standalone work panels mount onto PrismuxStageFrame with glassZone="workPanels"
    for (const [label, source] of [
      ["TasksPage", tasksSrc],
      ["WorkspaceBoardPage", boardSrc],
      ["ScheduledTasksPage", scheduledSrc],
    ] as const) {
      expect(source, `${label} must bind PrismuxStageFrame glassZone="workPanels"`).toMatch(
        /glassZone="workPanels"/,
      );
      expect(
        source,
        `${label} must NEVER use inverted bg-foreground + text-background active pills that turn white-on-white in Glass mode`,
      ).not.toMatch(/bg-foreground(?:\/\d+)?\s+text-background/);
      expect(
        source,
        `${label} must NOT stack redundant inner backdrop-blur-* over single-pass workPanels glass`,
      ).not.toMatch(/backdrop-blur-(?:sm|md|lg)/);
    }

    // 1b. ScheduledTasksPage uses full-width layout matching TasksPage & WorkspaceBoardPage (NO narrow centered max-w-5xl dead-space box!)
    expect(scheduledSrc).not.toContain("max-w-5xl");
    expect(scheduledSrc).not.toContain('{ machine: "all" }');
    expect(scheduledSrc).toContain('data-testid="scheduled-tasks-filter-chrome"');

    // 2. TasksPage & ScheduledTasksPage active chips use crisp theme-accent bg-primary + font-semibold + text-primary-foreground
    expect(tasksSrc).toContain("border-primary bg-primary font-semibold text-primary-foreground");
    expect(scheduledSrc).toContain("border-primary bg-primary font-semibold text-primary-foreground");

    // 2b. Shared ToggleGroup & Toggle segmented controls enforce crisp 3-state (Light/Dark/Glass) active highlighting
    const toggleSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/ui/toggle.tsx"),
      "utf8",
    );
    const toggleGroupSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/ui/toggle-group.tsx"),
      "utf8",
    );
    expect(toggleGroupSrc).toContain("border-border/75 bg-muted/80 p-0.5 dark:border-white/12 dark:bg-black/30");
    expect(toggleSrc).toContain("data-pressed:border-primary/50");
    expect(toggleSrc).toContain("data-pressed:bg-primary/14");
    expect(toggleSrc).toContain("data-pressed:font-semibold");
    expect(toggleSrc).toContain("dark:data-pressed:border-primary/68");
    expect(toggleSrc).toContain("dark:data-pressed:bg-primary/28");
    expect(toggleSrc).toContain("dark:data-pressed:text-white");
    expect(toggleSrc).not.toMatch(/dark:data-pressed:bg-input\/(?:64|72)/);
    expect(toggleSrc).not.toMatch(/\bdata-pressed:bg-input\/64\b/);

    // 3. No washed-out low-alpha bg-background/45..85 surfaces remain in work panels or diagnostics cards
    for (const [label, source] of [
      ["TasksPage", tasksSrc],
      ["WorkspaceBoardPage", boardSrc],
      ["workspaceBoard.logic", boardLogicSrc],
      ["ScheduledTasksPage", scheduledSrc],
      ["PrismuxDiagnosticsSection", diagnosticsSrc],
    ] as const) {
      expect(
        source,
        `${label} must not use translucent bg-background/45..85 that collapses to near-invisible in Glass mode`,
      ).not.toMatch(/\bbg-background\/(?:45|50|55|60|70|75|80|85)\b/);
    }

    // 4. Legacy /settings/scheduled-tasks and /settings/automations routes redirect cleanly to /scheduled-tasks
    const legacyScheduledRoute = NodeFS.readFileSync(
      NodePath.join(srcRoot, "routes/_chat.settings.scheduled-tasks.tsx"),
      "utf8",
    );
    const legacyAutomationsRoute = NodeFS.readFileSync(
      NodePath.join(srcRoot, "routes/_chat.settings.automations.tsx"),
      "utf8",
    );
    const standaloneRoute = NodeFS.readFileSync(
      NodePath.join(srcRoot, "routes/_chat.scheduled-tasks.tsx"),
      "utf8",
    );
    const settingsLayoutRoute = NodeFS.readFileSync(
      NodePath.join(srcRoot, "routes/_chat.settings.tsx"),
      "utf8",
    );

    expect(standaloneRoute).toContain('createFileRoute("/_chat/scheduled-tasks")');
    expect(legacyScheduledRoute).toContain('to: "/scheduled-tasks"');
    expect(legacyAutomationsRoute).toContain('to: "/scheduled-tasks"');
    expect(settingsLayoutRoute).toContain('"/settings/automations"');
    expect(settingsLayoutRoute).toContain('to: "/scheduled-tasks"');
  });
});
