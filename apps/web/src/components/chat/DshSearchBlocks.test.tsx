import {
  NodeId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@prismux/core-contracts";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { WorkLogEntry } from "../../session-logic";
import {
  computeHeadTailSlice,
  DEFAULT_SEARCH_MAX_LINES,
  normalizeSearchTurnItem,
  normalizeSearchWorkEntry,
  normalizeWebTurnItem,
  normalizeWebWorkEntry,
  sanitizeExternalHttpUrl,
} from "./DshSearchBlocks.logic";
import { DshSearchBlock, DshWebBlock } from "./DshSearchBlocks";

const NOW = DateTime.makeUnsafe("2026-11-26T00:00:00.000Z");

function baseTurnItem(id: string) {
  return {
    id: TurnItemId.make(id),
    threadId: ThreadId.make("thread-1"),
    runId: RunId.make("run-1"),
    nodeId: NodeId.make("node-1"),
    providerThreadId: ProviderThreadId.make("pt-1"),
    providerTurnId: ProviderTurnId.make("turn-1"),
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed" as const,
    title: null,
    startedAt: NOW,
    completedAt: NOW,
    updatedAt: NOW,
  };
}

describe("DshSearchBlocks", () => {
  it("computes 16-line head/tail slices matching DSH NEXT", () => {
    expect(DEFAULT_SEARCH_MAX_LINES).toBe(16);
    expect(computeHeadTailSlice(12)).toEqual({
      collapsed: false,
      headCount: 12,
      tailCount: 0,
      hiddenCount: 0,
    });
    expect(computeHeadTailSlice(26)).toEqual({
      collapsed: true,
      headCount: 8,
      tailCount: 8,
      hiddenCount: 10,
    });
  });

  it("normalizes native file_search and dynamic_tool grep outputs into grouped matches with 16-line cap", () => {
    const lines = Array.from({ length: 24 }, (_, idx) =>
      `D:\\Prismux\\src\\file${(idx % 3) + 1}.ts:${idx + 1}:const hit_${idx + 1} = true;`,
    ).join("\n");

    const acpSearchItem: OrchestrationV2TurnItem = {
      ...baseTurnItem("grep-1"),
      type: "file_search",
      pattern: "hit_",
      results: [{ fileName: "hit_", preview: lines }],
    };

    const normalized = normalizeSearchTurnItem(acpSearchItem, "D:\\Prismux");
    expect(normalized?.kind).toBe("matches");
    if (!normalized || normalized.kind !== "matches") return;
    expect(normalized.shownMatches).toBe(24);
    expect(normalized.shownFiles).toBe(3);
    expect(normalized.summaryZh).toBe("显示 24 条匹配 · 共 3 个文件");

    const html = renderToStaticMarkup(<DshSearchBlock data={normalized} />);
    expect(html).toContain("显示 24 条匹配 · 共 3 个文件");
    expect(html).toContain("复制");
    expect(html).toContain("展开其余 8 行");
    expect(html).toContain('data-dsh-search-block="matches"');
    expect(html).toContain("[[data-pmx-glass=&#x27;1&#x27;]_&amp;]");
    expect(html).not.toContain("bg-black");
    expect(html).not.toContain("bg-white");
  });

  it("normalizes glob / find_by_name paths and preserves truncation totals", () => {
    const globEntry: WorkLogEntry = {
      id: "glob-1",
      createdAt: "2026-11-26T00:00:00.000Z",
      label: "glob",
      tone: "tool",
      toolTitle: "glob",
      structuredPayload: {
        ...baseTurnItem("glob-item-1"),
        type: "dynamic_tool",
        toolName: "find_by_name",
        input: { pattern: "*.tsx", SearchDirectory: "D:\\Prismux\\apps\\web" },
        output: {
          paths: Array.from({ length: 18 }, (_, i) => `D:\\Prismux\\apps\\web\\Comp${i + 1}.tsx`),
          total: 64,
          truncated: true,
        },
      },
    };

    const normalized = normalizeSearchWorkEntry(globEntry, "D:\\Prismux");
    expect(normalized?.kind).toBe("paths");
    if (!normalized || normalized.kind !== "paths") return;
    expect(normalized.shownPaths).toBe(18);
    expect(normalized.totalPaths).toBe(64);
    expect(normalized.truncated).toBe(true);
    expect(normalized.summaryZh).toBe("显示 18 / 共 64 个文件（已截断）");

    const html = renderToStaticMarkup(<DshSearchBlock data={normalized} />);
    expect(html).toContain("显示 18 / 共 64 个文件（已截断）");
    expect(html).toContain("展开其余 2 行");
    expect(html).toContain('data-dsh-search-block="paths"');
  });

  it("strictly rejects non-http(s) URLs in sanitizeExternalHttpUrl and WebBlock sources", () => {
    expect(sanitizeExternalHttpUrl("https://www.example.com/docs").safeHref).toBe(
      "https://www.example.com/docs",
    );
    expect(sanitizeExternalHttpUrl("https://www.example.com/docs").hostname).toBe("example.com");
    expect(sanitizeExternalHttpUrl("javascript:alert(1)").safeHref).toBeNull();
    expect(sanitizeExternalHttpUrl("data:text/html,<h1>x</h1>").safeHref).toBeNull();
    expect(sanitizeExternalHttpUrl("file:///C:/Windows/win.ini").safeHref).toBeNull();

    const webSearchItem: OrchestrationV2TurnItem = {
      ...baseTurnItem("ws-1"),
      type: "dynamic_tool",
      toolName: "web_search",
      input: { query: "Prismux liquid glass" },
      output: {
        answer: "Prismux uses 360° Fresnel liquid glass.",
        truncated: true,
        sources: [
          {
            url: "https://github.com/Fish-under-sea/Prismux",
            title: "Prismux Repository",
            snippet: "Local-first AI workbench with liquid glass.",
            publishedDate: "2026-11-20",
          },
          {
            url: "javascript:alert(1)",
            title: "Malicious Link",
            snippet: "Must never render an anchor href.",
          },
          {
            url: "data:text/html,<script>alert(1)</script>",
            title: "Data URI",
          },
        ],
      },
    };

    const normalized = normalizeWebTurnItem(webSearchItem);
    expect(normalized?.kind).toBe("search");
    if (!normalized || normalized.kind !== "search") return;
    expect(normalized.sources).toHaveLength(3);
    expect(normalized.sources[0]?.safeHref).toBe("https://github.com/Fish-under-sea/Prismux");
    expect(normalized.sources[1]?.safeHref).toBeNull();
    expect(normalized.sources[2]?.safeHref).toBeNull();

    const html = renderToStaticMarkup(<DshWebBlock data={normalized} />);
    expect(html).toContain('href="https://github.com/Fish-under-sea/Prismux"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).toContain("部分来源已截断");
    expect(html).toContain("Prismux uses 360° Fresnel liquid glass.");
    expect(html).toContain("2026-11-20");
  });

  it("renders DshWebBlock kind=fetch with HTTP status pill and truncation badge", () => {
    const fetchEntry: WorkLogEntry = {
      id: "wf-1",
      createdAt: "2026-11-26T00:00:00.000Z",
      label: "Fetch https://docs.example.dev/guide",
      tone: "tool",
      toolTitle: "web_fetch",
      structuredPayload: {
        ...baseTurnItem("wf-item-1"),
        type: "dynamic_tool",
        toolName: "web_fetch",
        input: { url: "https://docs.example.dev/guide" },
        output: {
          url: "https://docs.example.dev/guide",
          statusCode: 200,
          title: "Developer Guide",
          contentType: "text/markdown",
          excerpt: "# Guide\nWelcome to Prismux.",
          truncated: true,
        },
      },
    };

    const normalized = normalizeWebWorkEntry(fetchEntry);
    expect(normalized?.kind).toBe("fetch");
    if (!normalized || normalized.kind !== "fetch") return;
    expect(normalized.httpStatus).toBe(200);
    expect(normalized.truncated).toBe(true);

    const html = renderToStaticMarkup(<DshWebBlock data={normalized} />);
    expect(html).toContain("HTTP 200");
    expect(html).toContain("内容已截断");
    expect(html).toContain('href="https://docs.example.dev/guide"');
    expect(html).toContain("Developer Guide");
    expect(html).toContain("text/markdown");
    expect(html).toContain("text-success-foreground");
  });
});
