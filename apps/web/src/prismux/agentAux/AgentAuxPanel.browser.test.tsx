import type { ThreadId } from "@prismux/core-contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../../test/render";
import "~/index.css";
import { buildAgentAuxViewModel } from "./agentAux.logic";
import { AgentAuxPanel } from "./AgentAuxPanel";

const FORBIDDEN_EN_IN_ZH = [
  "GOAL",
  "Running",
  "tasks done",
  "Threads",
  "The team",
  "Moving",
  "In review",
  "Hive",
  "Mentions",
  "Tasks done",
  "Message just sent",
  "Waiting on",
  "Coordinator",
  "posts over",
];

function useThemeGuard(): Disposable {
  const prevDark = document.documentElement.classList.contains("dark");
  const prevGlass = document.documentElement.dataset.pmxGlass;
  const prevAccent = document.documentElement.style.getPropertyValue("--pmx-accent");
  const prevMargin = document.body.style.margin;
  return {
    [Symbol.dispose]() {
      document.documentElement.classList.toggle("dark", prevDark);
      if (prevGlass === undefined) delete document.documentElement.dataset.pmxGlass;
      else document.documentElement.dataset.pmxGlass = prevGlass;
      if (prevAccent) document.documentElement.style.setProperty("--pmx-accent", prevAccent);
      else document.documentElement.style.removeProperty("--pmx-accent");
      document.body.style.margin = prevMargin;
    },
  };
}

function buildHybridDemoModel() {
  const baseTs = 1_760_000_000_000;
  return buildAgentAuxViewModel({
    provider: "antigravity",
    threadId: "thread-demo-hybrid" as ThreadId,
    locale: "zh",
    daemonSnapshot: {
      ok: true,
      active: true,
      hasLiveWork: true,
      kind: "agy-swarm",
      title: "Prismux v0.1.3 协同蜂群",
      activationKey: "agy-swarm:demo-root",
      updatedAt: baseTs + 3_960_000,
      swarm: {
        id: "demo-root",
        title: "Prismux v0.1.3 协同蜂群",
        selfMember: "coordinator",
        head: 5,
        channels: ["ui-review"],
        members: [
          {
            name: "coordinator",
            role: "coordinator",
            model: "claude-opus-4-6-high",
            conversationId: "demo-root",
            status: "working",
            waitSince: 0,
            killed: false,
            roleWorker: false,
            narrator: false,
            steps: 38,
            posts: 2,
            unread: 2,
            lastReadSeq: 3,
            lastPostSeq: 3,
            lastPostTime: "10:42",
            lastPostTs: baseTs + 2_520_000,
            transcriptMtime: baseTs + 2_520_000,
            activity: "汇总各路工人与外部 ACP 子代理交付结果",
            activityKind: "thinking",
            wakeMode: "mentions",
            replied: false,
            replyAsk: "",
            failure: null,
          },
          {
            name: "w2-swarm-panel",
            role: "worker",
            model: "claude-sonnet-4-5",
            conversationId: "demo-w1",
            status: "working",
            waitSince: 0,
            killed: false,
            roleWorker: false,
            narrator: false,
            steps: 24,
            posts: 1,
            unread: 0,
            lastReadSeq: 5,
            lastPostSeq: 2,
            lastPostTime: "10:28",
            lastPostTs: baseTs + 1_680_000,
            transcriptMtime: baseTs + 1_680_000,
            activity: "绘制六边形蜂巢与时间轴回放",
            activityKind: "tool",
            wakeMode: "mentions",
            replied: false,
            replyAsk: "",
            failure: null,
            workspaceMode: "share",
            workspace: "C:\\Users\\Fish\\.gemini\\antigravity\\worktrees\\swarm-w2-panel",
          },
          {
            name: "w2-compliance",
            role: "worker",
            model: "gemini-2.5-pro",
            conversationId: "demo-w2",
            status: "waiting",
            waitSince: baseTs + 2_600_000,
            killed: false,
            roleWorker: false,
            narrator: false,
            steps: 14,
            posts: 1,
            unread: 0,
            lastReadSeq: 5,
            lastPostSeq: 4,
            lastPostTime: "10:51",
            lastPostTs: baseTs + 3_060_000,
            transcriptMtime: baseTs + 3_060_000,
            activity: "",
            activityKind: "",
            wakeMode: "mentions",
            replied: false,
            replyAsk: "等待 @coordinator 确认免责倒计时文案？",
            failure: null,
            workspaceMode: "branch",
            workspace: "C:\\Users\\Fish\\.gemini\\antigravity\\worktrees\\w2-compliance",
          },
          {
            name: "qa-verifier-w1",
            role: "verifier",
            model: "claude-sonnet-4-5",
            conversationId: "demo-w3",
            status: "killed",
            waitSince: 0,
            killed: true,
            roleWorker: false,
            narrator: false,
            steps: 11,
            posts: 1,
            unread: 0,
            lastReadSeq: 5,
            lastPostSeq: 5,
            lastPostTime: "11:06",
            lastPostTs: baseTs + 3_960_000,
            transcriptMtime: baseTs + 3_960_000,
            activity: "",
            activityKind: "",
            wakeMode: "mentions",
            replied: false,
            replyAsk: "",
            failure: null,
          },
        ],
        messages: [
          {
            seq: 1,
            agent: "coordinator",
            text: "@w2-swarm-panel 请完成 1:1 蜂群四标签右侧边栏与实时 SSE 推送",
            time: "10:00",
            ts: baseTs,
            mentions: ["w2-swarm-panel"],
            all: false,
          },
          {
            seq: 2,
            agent: "w2-swarm-panel",
            text: "@coordinator 已完成实时目录监听、三主题动态配色及 100% 中文汉化。\n- 浅色 / 深色 / 液态玻璃三主题零嵌套模糊\n- 支持时间轴历史状态回放与倍速控制\n- 修复 `agy acp` `/swarm` 实时流式监听\n- 覆盖混合模式下外部 ACP 子代理无缝吸收\n- 单测与真实浏览器测试已就绪，请审阅 #1",
            time: "10:28",
            ts: baseTs + 1_680_000,
            mentions: ["coordinator"],
            all: false,
            channel: "ui-review",
          },
          {
            seq: 3,
            agent: "coordinator",
            text: "@all 请各工作组同步执行类型检查与中文门禁",
            time: "10:42",
            ts: baseTs + 2_520_000,
            mentions: [],
            all: true,
          },
          {
            seq: 4,
            agent: "w2-compliance",
            text: "@coordinator 请确认免责声明弹窗是否保留自然文本选中？",
            time: "10:51",
            ts: baseTs + 3_060_000,
            mentions: ["coordinator"],
            all: false,
          },
          {
            seq: 5,
            agent: "qa-verifier-w1",
            text: "@coordinator [done] 守护进程探针与 SSE 回归验证全部通过 #2",
            time: "11:06",
            ts: baseTs + 3_960_000,
            mentions: ["coordinator"],
            all: false,
          },
        ],
        edges: [
          { from: "coordinator", to: "w2-swarm-panel", count: 2, direct: 1, viaAll: 1 },
          { from: "w2-swarm-panel", to: "coordinator", count: 1, direct: 1, viaAll: 0 },
          { from: "w2-compliance", to: "coordinator", count: 1, direct: 1, viaAll: 0 },
          { from: "qa-verifier-w1", to: "coordinator", count: 1, direct: 1, viaAll: 0 },
        ],
        plan: {
          goal: {
            title: "交付 1:1 AGY 蜂群与 ACP 统一四标签协同侧边栏",
            line: "支持实时流式检测、混合吸收、全中英双语与三主题液态玻璃",
          },
          tasks: {
            "w2-swarm-panel": "构建四标签协同面板与蜂巢关系图",
            "w2-compliance": "护栏与安全门禁审查",
          },
          threads: [],
        },
        view: {
          goal: {
            title: "交付 1:1 AGY 蜂群与 ACP 统一四标签协同侧边栏",
            line: "支持实时流式检测、混合吸收、全中英双语与三主题液态玻璃",
          },
          headline: "四标签模块与混合吸收联调中",
          phase: { label: "第 2 波次", index: 2, total: 2 },
          workstreams: [
            {
              id: "ws-ui",
              title: "四标签 UI 与蜂巢关系图",
              state: "review",
              owners: ["w2-swarm-panel"],
              note: "像素蜂与时间轴回放已就绪",
              progress: { done: 4, total: 5, label: "4/5" },
              refs: [{ seq: 2 }],
            },
            {
              id: "ws-comp",
              title: "订阅风控免责门禁校验",
              state: "blocked",
              owners: ["w2-compliance"],
              note: "等待协调者确认文案",
              blocked_on: "coordinator",
              refs: [{ seq: 4 }],
            },
            {
              id: "ws-daemon",
              title: "守护进程 SSE 与目录发现",
              state: "done",
              owners: ["qa-verifier-w1"],
              note: "8/8 单测通过",
              refs: [{ seq: 5 }],
            },
          ],
          threads: [
            {
              id: "t-panel",
              title: "协同侧边栏 UI",
              goal: "1:1 复刻蜂群四标签与三主题",
              now: "正在审阅像素蜂与时间轴回放",
              workstreams: ["ws-ui", "ws-daemon"],
            },
            {
              id: "t-comp",
              title: "合规门禁与审计",
              goal: "确保纯本地零遥测",
              now: "等待协调者答复",
              workstreams: ["ws-comp"],
            },
          ],
          attention: [],
        },
        systemAttention: [],
      },
    },
    projection: {
      subagents: [
        {
          id: "sub-dsh-perf",
          runId: "run-hybrid-1",
          title: "DSH 性能审计",
          status: "running",
          driver: "dsh",
          model: "deepseek-reasoner",
          childThreadId: "thread-child-dsh" as ThreadId,
          prompt: "检查长消息看板分页与蜂巢 SVG 渲染性能",
          progress: "正在采集 60fps 帧耗时",
          startedAt: baseTs + 2_900_000,
        },
      ],
    },
  });
}

describe("AgentAuxPanel real-Chrome browser verification", () => {
  it("interacts cleanly across all 4 tabs, enforces zero nested backdrop-filter in Liquid Glass, and has 0 leftover English in zh", async () => {
    using _theme = useThemeGuard();
    const model = buildHybridDemoModel();
    const openChildSpy = vi.fn();

    document.documentElement.classList.add("dark");
    document.documentElement.dataset.pmxGlass = "1";
    document.documentElement.style.setProperty("--pmx-accent", "#10b981");

    const container = document.createElement("div");
    container.style.width = "390px";
    container.style.height = "780px";
    container.style.margin = "12px";

    await using screen = await render(
      <AgentAuxPanel
        model={model}
        initialTab="overview"
        locale="zh"
        onRefresh={vi.fn()}
        onOpenChildThread={openChildSpy}
      />,
      { container, router: false },
    );

    const pane = screen.container.querySelector<HTMLElement>(".pmx-aux-pane");
    const header = screen.container.querySelector<HTMLElement>(".pmx-aux-header");
    expect(pane).toBeTruthy();
    expect(header).toBeTruthy();

    expect(getComputedStyle(pane!).backdropFilter).toBe("none");
    expect(getComputedStyle(header!).backdropFilter).toBe("none");

    const overviewText = pane!.innerText;
    expect(overviewText).toContain("目标");
    expect(overviewText).toContain("进行中");
    expect(overviewText).toContain("工作组");
    expect(overviewText).toContain("ACP 外部委派");
    expect(overviewText).toContain("协同团队");
    for (const forbidden of FORBIDDEN_EN_IN_ZH) {
      expect(overviewText).not.toContain(forbidden);
    }

    const wgBtn = screen.container.querySelector<HTMLButtonElement>(
      '[data-aux-thread-id="t-panel"] .pmx-aux-th-head',
    );
    expect(wgBtn).toBeTruthy();
    await act(() => {
      wgBtn!.click();
    });
    expect(wgBtn!.getAttribute("aria-expanded")).toBe("true");

    const boardTab = screen.container.querySelector<HTMLButtonElement>('[data-aux-tab="board"]');
    await act(() => {
      boardTab!.click();
    });
    const toolbar = screen.container.querySelector<HTMLElement>(".pmx-aux-toolbar");
    expect(toolbar).toBeTruthy();
    expect(getComputedStyle(toolbar!).backdropFilter).toBe("none");
    expect(pane!.innerText).toContain("新消息");
    for (const forbidden of FORBIDDEN_EN_IN_ZH) {
      expect(pane!.innerText).not.toContain(forbidden);
    }

    const membersTab = screen.container.querySelector<HTMLButtonElement>(
      '[data-aux-tab="members"]',
    );
    await act(() => {
      membersTab!.click();
    });
    expect(pane!.innerText).toContain("@协调者");
    expect(pane!.innerText).not.toContain("@coordinator");
    expect(pane!.innerText).toContain("共享副本");
    expect(pane!.innerText).toContain("已退出成员");
    expect(pane!.innerText).toContain("打开会话");
    for (const forbidden of FORBIDDEN_EN_IN_ZH) {
      expect(pane!.innerText).not.toContain(forbidden);
    }

    const retiredToggle =
      screen.container.querySelector<HTMLButtonElement>(".pmx-aux-retired-toggle");
    await act(() => {
      retiredToggle!.click();
    });
    expect(pane!.innerText).toContain("@qa-verifier-w1");

    const graphTab = screen.container.querySelector<HTMLButtonElement>('[data-aux-tab="graph"]');
    await act(() => {
      graphTab!.click();
    });
    expect(screen.container.querySelector('[data-hive-stage="1"]')).toBeTruthy();
    expect(screen.container.querySelector('[data-hive-cell="t-acp-delegations"]')).toBeTruthy();
    expect(pane!.innerText).toContain("蜂巢视图");
    expect(pane!.innerText).toContain("提及关系");
    expect(pane!.innerText).toContain("任务完成");
    expect(pane!.innerText).toContain("等待回复");
    for (const forbidden of FORBIDDEN_EN_IN_ZH) {
      expect(pane!.innerText).not.toContain(forbidden);
    }

    const startBtn = screen.container.querySelector<HTMLButtonElement>(
      'button[aria-label="跳到开头"]',
    );
    await act(() => {
      startBtn!.click();
    });
    expect(screen.container.querySelector('[data-testid="aux-replay-caption"]')).toBeTruthy();

    const mentionsBtn = Array.from(
      screen.container.querySelectorAll<HTMLButtonElement>(".pmx-aux-segmented button"),
    ).find((b) => b.textContent?.includes("提及关系"));
    expect(mentionsBtn).toBeTruthy();
    await act(() => {
      mentionsBtn!.click();
    });
    expect(screen.container.querySelector('[data-mentions-stage="1"]')).toBeTruthy();

    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.pmxGlass;
    expect(getComputedStyle(pane!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    document.documentElement.classList.add("dark");
    expect(getComputedStyle(pane!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("captures a clean 4-tab visual parity PNG screenshot across Light, Dark, and Liquid Glass themes", async () => {
    using _theme = useThemeGuard();
    const model = buildHybridDemoModel();
    await page.viewport(1580, 860);

    document.documentElement.classList.add("dark");
    document.documentElement.dataset.pmxGlass = "1";
    document.documentElement.style.setProperty("--pmx-accent", "#38bdf8");
    document.body.style.margin = "0";

    const container = document.createElement("div");
    container.style.cssText =
      "display:grid;grid-template-columns:repeat(4,376px);gap:14px;padding:18px;background:radial-gradient(120% 100% at 20% 0%, #162238 0%, #0b0f19 55%, #121521 100%);min-height:824px;box-sizing:border-box;";

    const tabs = ["overview", "board", "members", "graph"] as const;
    await using screen = await render(
      <>
        {tabs.map((tab) => (
          <div
            key={tab}
            style={{
              height: "820px",
              borderRadius: "14px",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(20, 22, 30, 0.72)",
              boxShadow: "0 18px 48px rgba(0, 0, 0, 0.36)",
            }}
          >
            <AgentAuxPanel
              model={model}
              initialTab={tab}
              locale="zh"
              onRefresh={() => undefined}
              onOpenChildThread={() => undefined}
            />
          </div>
        ))}
      </>,
      { container, router: false },
    );

    await expect.poll(() => screen.container.querySelectorAll("canvas").length).toBeGreaterThan(0);

    const screenshotPath = await page.screenshot({
      path: "../../../../../.work/w2-swarm-panel-verification.png",
    });

    expect(screenshotPath).toContain("w2-swarm-panel-verification.png");
    expect(screen.container.querySelectorAll(".pmx-aux-pane")).toHaveLength(4);
  });

  it("renders shell-less transparent ACP Captain & worker logos with 0px Hive centering and aligned Members/Board/Mentions across Light, Dark, and Liquid Glass", async () => {
    using _theme = useThemeGuard();
    const baseTs = 1_760_000_000_000;
    const dshEntry = {
      instanceId: "acpRegistry:dsh",
      driverKind: "acpRegistry",
      displayName: "DeepSeek Harness",
      acpRegistryAgentId: "dsh",
    };
    const glmEntry = {
      instanceId: "acpRegistry:glm",
      driverKind: "acpRegistry",
      displayName: "GLM Agent",
      acpRegistryAgentId: "glm-acp-agent",
    };
    const qwenEntry = {
      instanceId: "acpRegistry:qwen",
      driverKind: "acpRegistry",
      displayName: "Qwen Code",
      acpRegistryAgentId: "qwen-code",
    };
    const kimiEntry = {
      instanceId: "acpRegistry:kimi",
      driverKind: "acpRegistry",
      displayName: "Kimi Code",
      acpRegistryAgentId: "kimi-code",
    };
    const entryMap = new Map([
      [dshEntry.instanceId, dshEntry],
      [glmEntry.instanceId, glmEntry],
      [qwenEntry.instanceId, qwenEntry],
      [kimiEntry.instanceId, kimiEntry],
    ]);

    const acpModel = buildAgentAuxViewModel({
      provider: "acpRegistry",
      providerEntry: dshEntry,
      model: "DeepSeek-V4.1",
      providerEntryByInstanceId: entryMap,
      threadId: "thread-acp-browser" as ThreadId,
      threadShell: {
        id: "thread-acp-browser" as ThreadId,
        title: "DSH 统筹多模型透明图标重构",
        activityRunStatus: "running",
        modelSelection: { instanceId: dshEntry.instanceId, model: "DeepSeek-V4.1" },
        lineage: {},
      },
      projection: {
        runs: [{ id: "run-acp-1", status: "running" }],
        subagents: [
          {
            id: "sub-glm",
            runId: "run-acp-1",
            title: "GLM 样式对齐审计",
            status: "running",
            driver: "acpRegistry",
            providerInstanceId: glmEntry.instanceId,
            model: "glm-5",
            childThreadId: "child-glm" as ThreadId,
            prompt: "审查蜂巢坐标居中与无壳透明图标对比度",
            progress: "正在校验浅色/深色/液态玻璃三主题",
            startedAt: baseTs + 5_000,
          },
          {
            id: "sub-qwen",
            runId: "run-acp-1",
            title: "Qwen 单测补齐",
            status: "completed",
            driver: "acpRegistry",
            providerInstanceId: qwenEntry.instanceId,
            model: "qwen3-coder",
            childThreadId: "child-qwen" as ThreadId,
            prompt: "覆盖多信号品牌解析与迁移兼容性",
            result: "全部 16 项断言通过",
            startedAt: baseTs + 10_000,
            completedAt: baseTs + 45_000,
          },
          {
            id: "sub-kimi",
            runId: "run-acp-1",
            title: "Kimi 交互验收",
            status: "completed",
            driver: "acpRegistry",
            providerInstanceId: kimiEntry.instanceId,
            model: "kimi-k2",
            childThreadId: "child-kimi" as ThreadId,
            prompt: "核对提及关系图真实品牌图标渲染",
            result: "节点图标居中且无残留圆点",
            startedAt: baseTs + 15_000,
            completedAt: baseTs + 55_000,
          },
        ],
      },
      daemonSnapshot: null,
      locale: "zh",
    });

    await page.viewport(1580, 860);
    document.body.style.margin = "0";

    const assertThemeGeometry = async (mode: "light" | "dark" | "glass") => {
      document.documentElement.classList.toggle("dark", mode !== "light");
      if (mode === "glass") {
        document.documentElement.dataset.pmxGlass = "1";
      } else {
        delete document.documentElement.dataset.pmxGlass;
      }
      document.documentElement.style.setProperty("--pmx-accent", "#38bdf8");

      const container = document.createElement("div");
      container.style.cssText =
        mode === "light"
          ? "display:grid;grid-template-columns:repeat(4,376px);gap:14px;padding:18px;background:#eef2f7;min-height:824px;box-sizing:border-box;"
          : mode === "dark"
            ? "display:grid;grid-template-columns:repeat(4,376px);gap:14px;padding:18px;background:#0f1117;min-height:824px;box-sizing:border-box;"
            : "display:grid;grid-template-columns:repeat(4,376px);gap:14px;padding:18px;background:radial-gradient(120% 100% at 20% 0%, #162238 0%, #0b0f19 55%, #121521 100%);min-height:824px;box-sizing:border-box;";

      const tabs = ["overview", "board", "members", "graph"] as const;
      await using screen = await render(
        <>
          {tabs.map((tab) => (
            <div
              key={tab}
              style={{
                height: "820px",
                borderRadius: "14px",
                overflow: "hidden",
                border:
                  mode === "light"
                    ? "1px solid rgba(15,23,42,0.12)"
                    : "1px solid rgba(255,255,255,0.12)",
                background:
                  mode === "light"
                    ? "#ffffff"
                    : mode === "dark"
                      ? "#141518"
                      : "rgba(20, 22, 30, 0.72)",
              }}
            >
              <AgentAuxPanel
                model={acpModel}
                initialTab={tab}
                locale="zh"
                onRefresh={() => undefined}
                onOpenChildThread={() => undefined}
              />
            </div>
          ))}
        </>,
        { container, router: false },
      );

      // 1. ZERO [AC] monogram badges anywhere across all 4 tabs
      expect(screen.container.querySelector('[data-agent-brand-monogram="AC"]')).toBeNull();
      // Captain DSH logo present in header, hero, board, members, and hive hub
      expect(
        screen.container.querySelectorAll('[data-agent-brand="dsh"]').length,
      ).toBeGreaterThanOrEqual(5);

      // 2. EVERY bare ACP avatar has strictly transparent background, zero border, and 1:1 square bounding box
      const bareAvatars = screen.container.querySelectorAll<HTMLElement>(
        '[data-agent-avatar-bare="1"]',
      );
      expect(bareAvatars.length).toBeGreaterThan(0);
      for (const el of bareAvatars) {
        const cs = getComputedStyle(el);
        expect(cs.backgroundColor).toBe("rgba(0, 0, 0, 0)");
        expect(cs.borderTopWidth).toBe("0px");
        const rect = el.getBoundingClientRect();
        expect(Math.abs(rect.width - rect.height)).toBeLessThan(0.5);
      }

      // 3. Hive Graph bare icons have zero box shell and center on exact (bee.x, bee.y) with < 1px error!
      const hiveCanvas = screen.container.querySelector<HTMLElement>(".pmx-aux-hv-canvas");
      expect(hiveCanvas).toBeTruthy();
      const canvasRect = hiveCanvas!.getBoundingClientRect();
      const hiveButtons = screen.container.querySelectorAll<HTMLButtonElement>("[data-hive-bee]");
      expect(hiveButtons.length).toBeGreaterThanOrEqual(4);
      for (const btn of hiveButtons) {
        const expectedX = Number.parseFloat(btn.dataset.hiveX ?? "0");
        const expectedY = Number.parseFloat(btn.dataset.hiveY ?? "0");
        const r = btn.getBoundingClientRect();
        const actualCenterX = r.left - canvasRect.left + r.width / 2;
        const actualCenterY = r.top - canvasRect.top + r.height / 2;
        expect(Math.abs(actualCenterX - expectedX)).toBeLessThan(1.0);
        expect(Math.abs(actualCenterY - expectedY)).toBeLessThan(1.0);
      }
      const hiveBareIcons = screen.container.querySelectorAll<HTMLElement>('[data-hive-bare="1"]');
      expect(hiveBareIcons.length).toBeGreaterThanOrEqual(4);
      for (const icon of hiveBareIcons) {
        const cs = getComputedStyle(icon);
        expect(cs.backgroundColor).toBe("rgba(0, 0, 0, 0)");
        expect(cs.borderTopWidth).toBe("0px");
      }

      // 4. Board bare avatars align optically with message author & meta row centerline
      const boardMsgs = screen.container.querySelectorAll<HTMLElement>(".pmx-aux-msg--bare");
      expect(boardMsgs.length).toBeGreaterThan(0);
      for (const msg of boardMsgs) {
        const av = msg.querySelector<HTMLElement>(".pmx-aux-msg-avatar");
        const author = msg.querySelector<HTMLElement>(".pmx-aux-msg-author");
        const meta = msg.querySelector<HTMLElement>(".pmx-aux-msg-meta");
        expect(av).toBeTruthy();
        expect(author).toBeTruthy();
        expect(meta).toBeTruthy();
        const avRect = av!.getBoundingClientRect();
        const authorRect = author!.getBoundingClientRect();
        const metaRect = meta!.getBoundingClientRect();
        const avCenterY = avRect.top + avRect.height / 2;
        const authorCenterY = authorRect.top + authorRect.height / 2;
        const metaCenterY = metaRect.top + metaRect.height / 2;
        expect(Math.abs(avCenterY - authorCenterY)).toBeLessThan(1.5);
        expect(Math.abs(avCenterY - metaCenterY)).toBeLessThan(1.5);
      }

      // 4b. Members bare avatars center optically against member main content row
      const memberRows = screen.container.querySelectorAll<HTMLElement>(
        ".pmx-aux-member-row--bare",
      );
      expect(memberRows.length).toBeGreaterThanOrEqual(4);
      for (const row of memberRows) {
        const av = row.querySelector<HTMLElement>(".pmx-aux-member-avatar");
        const main = row.querySelector<HTMLElement>(".pmx-aux-member-main");
        expect(av).toBeTruthy();
        expect(main).toBeTruthy();
        const avRect = av!.getBoundingClientRect();
        const mainRect = main!.getBoundingClientRect();
        const avCenterY = avRect.top + avRect.height / 2;
        const mainCenterY = mainRect.top + mainRect.height / 2;
        expect(Math.abs(avCenterY - mainCenterY)).toBeLessThan(1.5);
      }

      // Capture Hive 4-tab visual screenshot for each theme (Light / Dark / Liquid Glass)
      await page.screenshot({
        path: `../../../../../.work/acp-logos-align-${mode}.png`,
      });

      // 5. Switch Graph pane to Mentions mode and verify real transparent brand SVGs replace colored circles
      const mentionsBtn = Array.from(
        screen.container.querySelectorAll<HTMLButtonElement>(".pmx-aux-segmented button"),
      ).find((b) => b.textContent?.includes("提及关系"));
      expect(mentionsBtn).toBeTruthy();
      await act(() => {
        mentionsBtn!.click();
      });
      const mentionsStage = screen.container.querySelector<SVGSVGElement>(
        '[data-mentions-stage="1"]',
      );
      expect(mentionsStage).toBeTruthy();
      expect(mentionsStage!.querySelectorAll("[data-mention-brand]").length).toBeGreaterThanOrEqual(
        4,
      );
      expect(mentionsStage!.querySelector('[data-mention-brand="dsh"]')).toBeTruthy();
      expect(mentionsStage!.querySelector('[data-mention-brand="glm"]')).toBeTruthy();
      expect(mentionsStage!.querySelector('circle[cx="14"]')).toBeNull();

      if (mode === "glass") {
        await page.screenshot({
          path: "../../../../../.work/acp-logos-align-mentions-glass.png",
        });
      }
    };

    await assertThemeGeometry("light");
    await assertThemeGeometry("dark");
    await assertThemeGeometry("glass");
  });

  it("retires 90s live Hive beams, settles one-shot fill='freeze' dots, halts motion on finished Swarm & ACP graphs, and auto-stops Replay cleanly", async () => {
    using _theme = useThemeGuard();
    using _timers = fakeTimers();
    const baseTs = 1_760_000_000_000;
    const latestMsgTs = baseTs + 3_960_000;
    vi.setSystemTime(latestMsgTs + 5_000);

    // 1. Active Swarm: fresh beam flies ONCE (repeatCount="1" fill="freeze"), settles statically, then retires at 90s
    const activeModel = buildHybridDemoModel();
    const activeContainer = document.createElement("div");
    activeContainer.style.width = "390px";
    activeContainer.style.height = "780px";

    await using activeScreen = await render(
      <AgentAuxPanel model={activeModel} initialTab="graph" locale="zh" />,
      { container: activeContainer, router: false },
    );

    const activeRoot = activeScreen.container.querySelector<HTMLElement>(".pmx-aux-graph-root");
    expect(activeRoot?.dataset.graphMotion).toBe("active");
    expect(activeScreen.container.querySelector('[data-live-state="live"]')).toBeTruthy();

    const flyingMotions = activeScreen.container.querySelectorAll("animateMotion");
    expect(flyingMotions.length).toBeGreaterThan(0);
    for (const anim of flyingMotions) {
      expect(anim.getAttribute("repeatCount")).toBe("1");
      expect(anim.getAttribute("fill")).toBe("freeze");
    }

    // After single 700ms flight settles: zero <animateMotion>, static settled dot remains until 90s expiry
    await act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(activeScreen.container.querySelectorAll("animateMotion")).toHaveLength(0);
    expect(
      activeScreen.container.querySelectorAll('[data-motion-dot="settled"]').length,
    ).toBeGreaterThan(0);

    // At 90s boundary: single-shot deadline expires the live message beam completely
    await act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(activeScreen.container.querySelectorAll(".pmx-aux-hv-beam-g")).toHaveLength(0);
    expect(activeScreen.container.querySelectorAll("[data-motion-dot]")).toHaveLength(0);

    // Switch to Mentions while active: live mode has ZERO permanent current/hot highlights or animateMotion
    const activeMentionsBtn = Array.from(
      activeScreen.container.querySelectorAll<HTMLButtonElement>(".pmx-aux-segmented button"),
    ).find((b) => b.textContent?.includes("提及关系"));
    expect(activeMentionsBtn).toBeTruthy();
    await act(() => {
      activeMentionsBtn!.click();
    });
    expect(activeScreen.container.querySelectorAll(".pmx-aux-graph-edge--cur")).toHaveLength(0);
    expect(activeScreen.container.querySelectorAll(".pmx-aux-graph-node--hot")).toHaveLength(0);
    expect(activeScreen.container.querySelectorAll("animateMotion")).toHaveLength(0);

    // 2. Finished Swarm: zero motion in Hive & Mentions, and Replay plays one-shot dots then auto-stops to settled static state
    vi.setSystemTime(baseTs + 305_000);
    const finishedSwarmModel = buildAgentAuxViewModel({
      provider: "antigravity",
      threadId: "thread-finished-swarm-browser" as ThreadId,
      locale: "zh",
      daemonSnapshot: {
        ok: true,
        active: true,
        hasLiveWork: false,
        kind: "agy-swarm",
        title: "已完成的蜂群",
        activationKey: "agy-swarm:done-root",
        updatedAt: baseTs + 300_000,
        swarm: {
          id: "done-root",
          title: "已完成的蜂群",
          selfMember: "coordinator",
          head: 3,
          members: [
            {
              name: "coordinator",
              role: "coordinator",
              model: "claude-opus-4-6",
              conversationId: "done-root",
              status: "waiting",
              waitSince: 0,
              killed: false,
              roleWorker: false,
              narrator: false,
              steps: 10,
              posts: 2,
              unread: 0,
              lastReadSeq: 3,
              lastPostSeq: 3,
              lastPostTime: "10:05",
              lastPostTs: baseTs + 300_000,
              transcriptMtime: baseTs + 300_000,
              activity: "",
              activityKind: "",
              wakeMode: "mentions",
              replied: true,
              replyAsk: "",
              failure: null,
            },
            {
              name: "worker-alpha",
              role: "worker",
              model: "claude-sonnet-4-5",
              conversationId: "done-w1",
              status: "waiting",
              waitSince: 0,
              killed: false,
              roleWorker: false,
              narrator: false,
              steps: 8,
              posts: 1,
              unread: 0,
              lastReadSeq: 3,
              lastPostSeq: 2,
              lastPostTime: "10:02",
              lastPostTs: baseTs + 120_000,
              transcriptMtime: baseTs + 120_000,
              activity: "",
              activityKind: "",
              wakeMode: "mentions",
              replied: false,
              replyAsk: "",
              failure: null,
            },
          ],
          messages: [
            {
              seq: 1,
              agent: "coordinator",
              text: "@worker-alpha 请完成校验",
              time: "10:00",
              ts: baseTs,
              mentions: ["worker-alpha"],
              all: false,
            },
            {
              seq: 2,
              agent: "worker-alpha",
              text: "@coordinator 请确认结果？",
              time: "10:02",
              ts: baseTs + 120_000,
              mentions: ["coordinator"],
              all: false,
            },
            {
              seq: 3,
              agent: "coordinator",
              text: "@worker-alpha [done] 全部完成",
              time: "10:05",
              ts: baseTs + 300_000,
              mentions: ["worker-alpha"],
              all: false,
            },
          ],
          edges: [
            { from: "coordinator", to: "worker-alpha", count: 2, direct: 2, viaAll: 0 },
            { from: "worker-alpha", to: "coordinator", count: 1, direct: 1, viaAll: 0 },
          ],
          plan: null,
          view: null,
          systemAttention: [],
        },
      },
    });

    const finishedContainer = document.createElement("div");
    finishedContainer.style.width = "390px";
    finishedContainer.style.height = "780px";

    await using finishedScreen = await render(
      <AgentAuxPanel model={finishedSwarmModel} initialTab="graph" locale="zh" />,
      { container: finishedContainer, router: false },
    );

    const finishedRoot = finishedScreen.container.querySelector<HTMLElement>(".pmx-aux-graph-root");
    expect(finishedRoot?.dataset.graphMotion).toBe("paused");
    expect(finishedRoot?.dataset.sessionSettled).toBe("1");
    expect(finishedScreen.container.querySelector('[data-live-state="settled"]')).toBeTruthy();
    expect(finishedScreen.container.querySelectorAll(".pmx-aux-hv-beam-g")).toHaveLength(0);
    expect(finishedScreen.container.querySelectorAll(".pmx-aux-hv-wait-g")).toHaveLength(0);
    expect(finishedScreen.container.querySelectorAll(".pmx-aux-hv-bee--working")).toHaveLength(0);
    expect(finishedScreen.container.querySelectorAll("animateMotion")).toHaveLength(0);

    // Step to historical seq #2 (paused): wait arrow exists visually, CSS march animation is paused
    const playBtn = finishedScreen.container.querySelector<HTMLButtonElement>(".pmx-aux-play-btn");
    expect(playBtn).toBeTruthy();
    await act(() => {
      playBtn!.click();
    });
    expect(playBtn!.getAttribute("aria-label")).toBe("暂停回放");
    expect(finishedRoot?.dataset.graphMotion).toBe("active");
    expect(finishedScreen.container.querySelectorAll("animateMotion").length).toBeGreaterThan(0);

    // Advance 1 step to seq #2, then pause and verify wait-arrow CSS animation is paused
    await act(() => {
      vi.advanceTimersByTime(1_400);
    });
    await act(() => {
      playBtn!.click();
    });
    expect(playBtn!.getAttribute("aria-label")).toBe("播放回放");
    expect(finishedRoot?.dataset.graphMotion).toBe("paused");
    const pausedWaitPath =
      finishedScreen.container.querySelector<SVGPathElement>(".pmx-aux-hv-wait");
    expect(pausedWaitPath).toBeTruthy();
    expect(getComputedStyle(pausedWaitPath!).animationName).toBe("none");

    // Resume playback until final message completes -> auto-stops and returns to settled static state
    await act(() => {
      playBtn!.click();
    });
    await act(() => {
      vi.advanceTimersByTime(1_400);
    });
    await act(() => {
      vi.advanceTimersByTime(1_400);
    });
    expect(playBtn!.getAttribute("aria-label")).toBe("播放回放");
    expect(finishedRoot?.dataset.graphMotion).toBe("paused");
    expect(finishedScreen.container.querySelector('[data-live-state="settled"]')).toBeTruthy();
    expect(finishedScreen.container.querySelectorAll(".pmx-aux-hv-beam-g")).toHaveLength(0);
    expect(finishedScreen.container.querySelectorAll(".pmx-aux-hv-wait-g")).toHaveLength(0);
    expect(finishedScreen.container.querySelectorAll("animateMotion")).toHaveLength(0);

    // Switch to Mentions & replay to end: one-shot dot during replay, then auto-stop to clean static graph
    const mentionsBtn = Array.from(
      finishedScreen.container.querySelectorAll<HTMLButtonElement>(".pmx-aux-segmented button"),
    ).find((b) => b.textContent?.includes("提及关系"));
    await act(() => {
      mentionsBtn!.click();
    });
    expect(finishedScreen.container.querySelectorAll(".pmx-aux-graph-edge--cur")).toHaveLength(0);
    expect(finishedScreen.container.querySelectorAll("animateMotion")).toHaveLength(0);

    await act(() => {
      playBtn!.click();
    });
    const mentionAnims = finishedScreen.container.querySelectorAll("animateMotion");
    expect(mentionAnims.length).toBeGreaterThan(0);
    for (const anim of mentionAnims) {
      expect(anim.getAttribute("repeatCount")).toBe("1");
      expect(anim.getAttribute("fill")).toBe("freeze");
    }
    await act(() => {
      vi.advanceTimersByTime(1_400);
    });
    await act(() => {
      vi.advanceTimersByTime(1_400);
    });
    await act(() => {
      vi.advanceTimersByTime(1_400);
    });
    expect(playBtn!.getAttribute("aria-label")).toBe("播放回放");
    expect(finishedScreen.container.querySelectorAll(".pmx-aux-graph-edge--cur")).toHaveLength(0);
    expect(finishedScreen.container.querySelectorAll("animateMotion")).toHaveLength(0);

    // 3. Finished ACP multi-agent session: zero breathing logos, zero beams, zero motion in both views
    const finishedAcpModel = buildAgentAuxViewModel({
      provider: "codex",
      threadId: "thread-acp-settled-browser" as ThreadId,
      threadShell: {
        id: "thread-acp-settled-browser" as ThreadId,
        title: "Codex -> DSH 已完成",
        status: "idle",
        activityRunStatus: "completed",
        activeRunId: null,
        lineage: {},
      },
      projection: {
        runs: [{ id: "r1", status: "completed" }],
        subagents: [
          {
            id: "sub-dsh",
            title: "DSH 审计",
            status: "completed",
            driver: "dsh",
            model: "deepseek-reasoner",
            childThreadId: "child-dsh-browser" as ThreadId,
            prompt: "审计",
            result: "完成",
            startedAt: baseTs + 290_000,
            completedAt: baseTs + 300_000,
          },
        ],
      },
      daemonSnapshot: null,
      locale: "zh",
    });

    const acpContainer = document.createElement("div");
    acpContainer.style.width = "390px";
    acpContainer.style.height = "780px";

    await using acpScreen = await render(
      <AgentAuxPanel model={finishedAcpModel} initialTab="graph" locale="zh" />,
      { container: acpContainer, router: false },
    );
    expect(
      acpScreen.container.querySelector<HTMLElement>(".pmx-aux-graph-root")?.dataset.graphMotion,
    ).toBe("paused");
    expect(acpScreen.container.querySelectorAll('[data-breathing="true"]')).toHaveLength(0);
    expect(acpScreen.container.querySelectorAll(".pmx-aux-hv-beam-g")).toHaveLength(0);
    expect(acpScreen.container.querySelectorAll("animateMotion")).toHaveLength(0);
  });
});
