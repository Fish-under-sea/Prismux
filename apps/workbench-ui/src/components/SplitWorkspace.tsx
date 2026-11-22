import { useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  WORKBENCH_PANE_TITLES,
  closePane,
  collectLeafPaneIds,
  resizeSplit,
  splitPane,
  type SplitNode,
  type WorkbenchPaneId
} from "../layout/splitTree.js";

export interface SplitWorkspaceProps {
  root: SplitNode;
  onChangeRoot: (next: SplitNode) => void;
  renderPane: (paneId: WorkbenchPaneId) => ReactNode;
}

const PANE_CYCLE_ORDER: readonly WorkbenchPaneId[] = [
  "chief-chat",
  "pty-terminal",
  "git-diff",
  "worktree-tree",
  "approval-inbox",
  "live-preview"
];

function pickNextPaneId(root: SplitNode, current: WorkbenchPaneId): WorkbenchPaneId {
  const existing = new Set(collectLeafPaneIds(root));
  for (const candidate of PANE_CYCLE_ORDER) {
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  const idx = PANE_CYCLE_ORDER.indexOf(current);
  const nextIdx = idx === -1 ? 0 : (idx + 1) % PANE_CYCLE_ORDER.length;
  return PANE_CYCLE_ORDER[nextIdx] ?? "pty-terminal";
}

interface SplitBranchProps {
  node: SplitNode;
  root: SplitNode;
  leafCount: number;
  onChangeRoot: (next: SplitNode) => void;
  renderPane: (paneId: WorkbenchPaneId) => ReactNode;
}

function SplitBranch({
  node,
  root,
  leafCount,
  onChangeRoot,
  renderPane
}: SplitBranchProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (node.kind === "leaf") {
    const canClose = leafCount > 1;
    const title = node.title ?? WORKBENCH_PANE_TITLES[node.paneId];
    const nextPaneId = pickNextPaneId(root, node.paneId);

    return (
      <section
        className="prismux-leaf-pane prismux-glass-surface prismux-glass-content prismux-motion-layout"
        aria-label={title}
        data-pane-id={node.paneId}
      >
        <header className="prismux-leaf-header">
          <span className="prismux-leaf-title">{title}</span>
          <div className="prismux-leaf-actions">
            <button
              type="button"
              className="prismux-btn prismux-btn-sm"
              title="左右拆分面板"
              aria-label={`将 ${title} 左右拆分为分屏`}
              onClick={() =>
                onChangeRoot(
                  splitPane(root, node.paneId, "horizontal", nextPaneId)
                )
              }
            >
              <span className="prismux-ico" aria-hidden="true">
                ◫
              </span>
            </button>
            <button
              type="button"
              className="prismux-btn prismux-btn-sm"
              title="上下拆分面板"
              aria-label={`将 ${title} 上下拆分为分屏`}
              onClick={() =>
                onChangeRoot(
                  splitPane(root, node.paneId, "vertical", nextPaneId)
                )
              }
            >
              <span className="prismux-ico" aria-hidden="true">
                ⬓
              </span>
            </button>
            <button
              type="button"
              className="prismux-btn prismux-btn-sm"
              disabled={!canClose}
              title={
                canClose
                  ? "关闭当前面板"
                  : "至少保留一个工作区面板，无法继续关闭"
              }
              aria-label={
                canClose
                  ? `关闭 ${title}`
                  : `关闭 ${title}（不可用：至少保留一个工作区面板）`
              }
              onClick={() => {
                if (canClose) {
                  onChangeRoot(closePane(root, node.paneId));
                }
              }}
            >
              <span className="prismux-ico" aria-hidden="true">
                ×
              </span>
            </button>
          </div>
        </header>
        <div className="prismux-leaf-body">{renderPane(node.paneId)}</div>
      </section>
    );
  }

  const isHorizontal = node.direction === "horizontal";

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>
  ): void => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    event.preventDefault();
    const rect = container.getBoundingClientRect();

    const updateRatioFromClient = (clientX: number, clientY: number): void => {
      const span = isHorizontal ? rect.width : rect.height;
      if (span <= 0) {
        return;
      }
      const offset = isHorizontal
        ? clientX - rect.left
        : clientY - rect.top;
      const nextRatio = offset / span;
      onChangeRoot(resizeSplit(root, node.id, nextRatio));
    };

    const onMove = (moveEvent: PointerEvent): void => {
      updateRatioFromClient(moveEvent.clientX, moveEvent.clientY);
    };

    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 0.08 : 0.03;
    if (
      (isHorizontal && event.key === "ArrowLeft") ||
      (!isHorizontal && event.key === "ArrowUp")
    ) {
      event.preventDefault();
      onChangeRoot(resizeSplit(root, node.id, node.ratio - step));
    } else if (
      (isHorizontal && event.key === "ArrowRight") ||
      (!isHorizontal && event.key === "ArrowDown")
    ) {
      event.preventDefault();
      onChangeRoot(resizeSplit(root, node.id, node.ratio + step));
    }
  };

  const firstPct = (node.ratio * 100).toFixed(2);

  return (
    <div
      ref={containerRef}
      className="prismux-split-container"
      style={{
        flexDirection: isHorizontal ? "row" : "column"
      }}
      data-split-id={node.id}
    >
      <div
        className="prismux-split-branch"
        style={{
          flexBasis: `calc(${firstPct}% - 4px)`,
          flexGrow: 0,
          flexShrink: 0
        }}
      >
        <SplitBranch
          node={node.first}
          root={root}
          leafCount={leafCount}
          onChangeRoot={onChangeRoot}
          renderPane={renderPane}
        />
      </div>

      <div
        role="separator"
        tabIndex={0}
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        aria-label={
          isHorizontal ? "拖拽调整左右分屏比例" : "拖拽调整上下分屏比例"
        }
        aria-valuemin={15}
        aria-valuemax={85}
        aria-valuenow={Math.round(node.ratio * 100)}
        className="prismux-split-resizer"
        data-direction={node.direction}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <span className="prismux-split-resizer-pill" aria-hidden="true" />
      </div>

      <div
        className="prismux-split-branch"
        style={{
          flex: 1
        }}
      >
        <SplitBranch
          node={node.second}
          root={root}
          leafCount={leafCount}
          onChangeRoot={onChangeRoot}
          renderPane={renderPane}
        />
      </div>
    </div>
  );
}

export function SplitWorkspace({
  root,
  onChangeRoot,
  renderPane
}: SplitWorkspaceProps) {
  const leafCount = collectLeafPaneIds(root).length;

  return (
    <div className="prismux-split-workspace">
      <SplitBranch
        node={root}
        root={root}
        leafCount={leafCount}
        onChangeRoot={onChangeRoot}
        renderPane={renderPane}
      />
    </div>
  );
}
