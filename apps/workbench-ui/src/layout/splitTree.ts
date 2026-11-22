import type { LayoutPresetId } from "@prismux/protocol";

export type WorkbenchPaneId =
  | "worktree-tree"
  | "pty-terminal"
  | "git-diff"
  | "live-preview"
  | "approval-inbox"
  | "chief-chat";

export type SplitDirection = "horizontal" | "vertical";

export type SplitNode =
  | {
      kind: "leaf";
      paneId: WorkbenchPaneId;
      title?: string;
    }
  | {
      kind: "split";
      id: string;
      direction: SplitDirection;
      ratio: number;
      first: SplitNode;
      second: SplitNode;
    };

export const WORKBENCH_PANE_TITLES: Record<WorkbenchPaneId, string> = {
  "worktree-tree": "Worktree 状态树",
  "pty-terminal": "持久 PTY 终端",
  "git-diff": "行级 Git Diff",
  "live-preview": "实时预览",
  "approval-inbox": "待办审批收件箱",
  "chief-chat": "主秘书对话"
};

export const MIN_SPLIT_RATIO = 0.15;
export const MAX_SPLIT_RATIO = 0.85;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return 0.5;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export const PRESET_TREES: Record<LayoutPresetId, SplitNode> = {
  "secretary-standby": {
    kind: "leaf",
    paneId: "chief-chat",
    title: WORKBENCH_PANE_TITLES["chief-chat"]
  },
  "multi-agent-coding": {
    kind: "split",
    id: "split-root",
    direction: "horizontal",
    ratio: 0.2,
    first: {
      kind: "leaf",
      paneId: "worktree-tree",
      title: WORKBENCH_PANE_TITLES["worktree-tree"]
    },
    second: {
      kind: "split",
      id: "split-center-right",
      direction: "horizontal",
      ratio: 0.56,
      first: {
        kind: "split",
        id: "split-center-stack",
        direction: "vertical",
        ratio: 0.52,
        first: {
          kind: "leaf",
          paneId: "pty-terminal",
          title: WORKBENCH_PANE_TITLES["pty-terminal"]
        },
        second: {
          kind: "leaf",
          paneId: "git-diff",
          title: WORKBENCH_PANE_TITLES["git-diff"]
        }
      },
      second: {
        kind: "split",
        id: "split-right-stack",
        direction: "vertical",
        ratio: 0.36,
        first: {
          kind: "leaf",
          paneId: "approval-inbox",
          title: WORKBENCH_PANE_TITLES["approval-inbox"]
        },
        second: {
          kind: "leaf",
          paneId: "live-preview",
          title: WORKBENCH_PANE_TITLES["live-preview"]
        }
      }
    }
  }
};

function collectSplitIds(node: SplitNode, ids: Set<string>): void {
  if (node.kind === "leaf") {
    return;
  }
  ids.add(node.id);
  collectSplitIds(node.first, ids);
  collectSplitIds(node.second, ids);
}

function createUniqueSplitId(
  root: SplitNode,
  targetPaneId: WorkbenchPaneId,
  newPaneId: WorkbenchPaneId
): string {
  const existing = new Set<string>();
  collectSplitIds(root, existing);
  const base = `split-${targetPaneId}-${newPaneId}`;
  if (!existing.has(base)) {
    return base;
  }
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

export function splitPane(
  root: SplitNode,
  targetPaneId: WorkbenchPaneId,
  direction: SplitDirection,
  newPaneId: WorkbenchPaneId
): SplitNode {
  const splitId = createUniqueSplitId(root, targetPaneId, newPaneId);
  let replaced = false;

  function visit(node: SplitNode): SplitNode {
    if (node.kind === "leaf") {
      if (!replaced && node.paneId === targetPaneId) {
        replaced = true;
        return {
          kind: "split",
          id: splitId,
          direction,
          ratio: 0.5,
          first: node,
          second: {
            kind: "leaf",
            paneId: newPaneId,
            title: WORKBENCH_PANE_TITLES[newPaneId]
          }
        };
      }
      return node;
    }

    const nextFirst = visit(node.first);
    if (nextFirst !== node.first) {
      return {
        ...node,
        first: nextFirst
      };
    }

    const nextSecond = visit(node.second);
    if (nextSecond !== node.second) {
      return {
        ...node,
        second: nextSecond
      };
    }

    return node;
  }

  return visit(root);
}

export function resizeSplit(
  root: SplitNode,
  splitId: string,
  ratio: number
): SplitNode {
  const clamped = clampSplitRatio(ratio);

  function visit(node: SplitNode): SplitNode {
    if (node.kind === "leaf") {
      return node;
    }
    if (node.id === splitId) {
      if (node.ratio === clamped) {
        return node;
      }
      return {
        ...node,
        ratio: clamped
      };
    }

    const nextFirst = visit(node.first);
    const nextSecond = visit(node.second);
    if (nextFirst === node.first && nextSecond === node.second) {
      return node;
    }
    return {
      ...node,
      first: nextFirst,
      second: nextSecond
    };
  }

  return visit(root);
}

export function closePane(
  root: SplitNode,
  targetPaneId: WorkbenchPaneId
): SplitNode {
  if (root.kind === "leaf") {
    return root;
  }

  let closed = false;

  function visit(node: SplitNode): SplitNode {
    if (node.kind === "leaf") {
      return node;
    }

    if (!closed && node.first.kind === "leaf" && node.first.paneId === targetPaneId) {
      closed = true;
      return node.second;
    }

    if (!closed && node.second.kind === "leaf" && node.second.paneId === targetPaneId) {
      closed = true;
      return node.first;
    }

    const nextFirst = visit(node.first);
    if (nextFirst !== node.first) {
      return {
        ...node,
        first: nextFirst
      };
    }

    const nextSecond = visit(node.second);
    if (nextSecond !== node.second) {
      return {
        ...node,
        second: nextSecond
      };
    }

    return node;
  }

  return visit(root);
}

export function collectLeafPaneIds(root: SplitNode): WorkbenchPaneId[] {
  const seen = new Set<WorkbenchPaneId>();
  const ordered: WorkbenchPaneId[] = [];

  function walk(node: SplitNode): void {
    if (node.kind === "leaf") {
      if (!seen.has(node.paneId)) {
        seen.add(node.paneId);
        ordered.push(node.paneId);
      }
      return;
    }
    walk(node.first);
    walk(node.second);
  }

  walk(root);
  return ordered;
}
