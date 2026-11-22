import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultNavAndCommandState,
  exportNavAndCommandSyncPayload,
  filterSlashCommands,
  moveCommandHighlightIndex,
  moveSidebarItem,
  moveSlashCommand,
  overrideSidebarItemDisplay,
  overrideSlashCommandDisplay,
  reorderSidebarItem,
  reorderSlashCommand,
  restoreNavAndCommandSyncPayload,
  shouldIgnorePopoverCloseOnEventTarget,
  toggleSidebarItemVisibility,
  toggleSlashCommandVisibility,
  type NavAndCommandSyncPayload,
  type ResolvedSlashCommandItem,
  type SidebarNavItem,
  type SlashCommandItem
} from "../logic/navAndCommandStore.js";

const ICON_PRESETS = ["✦", "⎇", ">_", "±", "◫", "⚑", "◐", "⊞", "◈", "▶", "⇄", "◎", "✓", "⚡"];

export interface SlashCommandPaletteProps {
  open: boolean;
  state: NavAndCommandSyncPayload;
  onClose: () => void;
  onExecuteCommand: (command: SlashCommandItem) => void;
  returnFocusTo?: HTMLElement | null;
}

export const SlashCommandPalette: React.FC<SlashCommandPaletteProps> = ({
  open,
  state,
  onClose,
  onExecuteCommand,
  returnFocusTo
}) => {
  const [query, setQuery] = useState("/");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered: ResolvedSlashCommandItem[] = useMemo(
    () => filterSlashCommands(state, query),
    [state, query]
  );

  useEffect(() => {
    if (open) {
      setQuery("/");
      setHighlightIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (highlightIndex >= filtered.length) {
      setHighlightIndex(filtered.length > 0 ? 0 : -1);
    }
  }, [filtered.length, highlightIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (e: PointerEvent): void => {
      const popover = popoverRef.current;
      if (popover && e.target instanceof Node && popover.contains(e.target)) {
        return;
      }
      if (shouldIgnorePopoverCloseOnEventTarget(popover, e.target)) {
        return;
      }
      onClose();
    };
    const handleWheel = (e: WheelEvent): void => {
      const popover = popoverRef.current;
      if (popover && e.target instanceof Node && popover.contains(e.target)) {
        return;
      }
      onClose();
    };
    const handleResize = (): void => {
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("resize", handleResize);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleCloseAndRestoreFocus = (): void => {
    onClose();
    returnFocusTo?.focus();
  };

  return (
    <div
      ref={popoverRef}
      className="pmx-glass-overlay"
      role="dialog"
      aria-label="斜杠快捷指令面板"
      style={{
        position: "fixed",
        top: "68px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 45,
        width: "min(520px, 92vw)",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span className="prismux-ico" aria-hidden="true">
          /
        </span>
        <input
          ref={inputRef}
          type="text"
          className="pmx-input"
          aria-label="搜索或输入斜杠快捷指令"
          placeholder="输入 / 过滤快捷指令（↑ ↓ 选择，Enter 执行，Esc 关闭）"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlightIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const navKey = e.key;
              setHighlightIndex((prev) =>
                moveCommandHighlightIndex(prev, filtered.length, navKey)
              );
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              const chosen = filtered[highlightIndex] ?? filtered[0];
              if (chosen) {
                onExecuteCommand(chosen);
                onClose();
              }
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              handleCloseAndRestoreFocus();
            }
          }}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="pmx-btn pmx-btn-sm"
          onClick={handleCloseAndRestoreFocus}
        >
          Esc
        </button>
      </div>

      <div
        role="listbox"
        aria-label="斜杠指令候选列表"
        style={{
          maxHeight: "260px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}
      >
        {filtered.length === 0 ? (
          <div className="pmx-muted" style={{ padding: "8px 12px" }}>
            未找到匹配的可见斜杠指令，可在设置页调整隐藏项或名称覆写。
          </div>
        ) : (
          filtered.map((cmd, idx) => {
            const selected = idx === highlightIndex;
            return (
              <button
                key={cmd.id}
                type="button"
                role="option"
                aria-selected={selected}
                className="pmx-list-row pmx-btn"
                onMouseEnter={() => setHighlightIndex(idx)}
                onClick={() => {
                  onExecuteCommand(cmd);
                  onClose();
                }}
                style={{
                  justifyContent: "space-between",
                  width: "100%",
                  border: "1px solid transparent",
                  background: selected
                    ? "var(--sel-bg, rgba(59, 130, 246, 0.16))"
                    : "transparent"
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    minWidth: 0
                  }}
                >
                  <span className="prismux-ico" aria-hidden="true">
                    {cmd.displayIcon}
                  </span>
                  <code style={{ fontWeight: 600 }}>{cmd.command}</code>
                  <span>{cmd.displayTitle}</span>
                </span>
                <span className="pmx-muted" style={{ flexShrink: 0 }}>
                  {cmd.shortcut ?? cmd.category}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export interface NavAndCommandOrderProps {
  state: NavAndCommandSyncPayload;
  onChange: (next: NavAndCommandSyncPayload) => void;
  onExecuteCommand?: (command: SlashCommandItem) => void;
  onNavigateSidebarItem?: (item: SidebarNavItem) => void;
  machineId?: string;
}

export const NavAndCommandOrder: React.FC<NavAndCommandOrderProps> = ({
  state,
  onChange,
  onExecuteCommand,
  onNavigateSidebarItem,
  machineId
}) => {
  const [activeTab, setActiveTab] = useState<"sidebar" | "commands">("sidebar");
  const [draggingSidebarId, setDraggingSidebarId] = useState<string | null>(null);
  const [draggingCommandId, setDraggingCommandId] = useState<string | null>(null);
  const [syncText, setSyncText] = useState("");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const sortedSidebar = useMemo(
    () => [...state.sidebarItems].sort((a, b) => a.order - b.order),
    [state.sidebarItems]
  );
  const sortedCommands = useMemo(
    () => [...state.slashCommands].sort((a, b) => a.order - b.order),
    [state.slashCommands]
  );

  return (
    <section
      aria-label="侧栏重排与命令排序恢复"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px"
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          flexWrap: "wrap"
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
            导航与命令排序
          </h3>
          <div className="pmx-muted">
            拖拽或上下微调顺序，覆写中文标题与 16×16 图标，并支持跨设备同步恢复
          </div>
        </div>
        <button
          type="button"
          className="pmx-btn pmx-btn-sm"
          onClick={() => {
            onChange(createDefaultNavAndCommandState());
            setSyncNotice("已恢复默认侧栏菜单与斜杠命令排序");
            setSyncError(null);
          }}
        >
          恢复默认顺序
        </button>
      </header>

      <div role="tablist" style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sidebar"}
          className={`pmx-btn ${activeTab === "sidebar" ? "pmx-btn-selected" : ""}`}
          onClick={() => setActiveTab("sidebar")}
        >
          侧栏菜单（{sortedSidebar.length}）
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "commands"}
          className={`pmx-btn ${activeTab === "commands" ? "pmx-btn-selected" : ""}`}
          onClick={() => setActiveTab("commands")}
        >
          / 斜杠命令（{sortedCommands.length}）
        </button>
      </div>

      {activeTab === "sidebar" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          {sortedSidebar.map((item, idx) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDraggingSidebarId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggingSidebarId && draggingSidebarId !== item.id) {
                  onChange(reorderSidebarItem(state, draggingSidebarId, idx));
                }
                setDraggingSidebarId(null);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
                background: "var(--prismux-control, rgba(15,23,42,0.28))",
                opacity: item.visible ? 1 : 0.62,
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}
            >
              <div className="pmx-list-row" style={{ padding: 0 }}>
                <span className="prismux-ico" aria-hidden="true">
                  {item.customIcon ?? item.defaultIcon}
                </span>
                <strong style={{ fontSize: "13px", flex: 1 }}>
                  {item.customTitle ?? item.defaultTitle}
                </strong>
                <span className="pmx-muted pmx-tabular">#{idx + 1}</span>

                {onNavigateSidebarItem && (
                  <button
                    type="button"
                    className="pmx-btn pmx-btn-sm"
                    disabled={!item.visible}
                    title={item.visible ? "定位到面板" : "隐藏项不可直接导航"}
                    onClick={() => onNavigateSidebarItem(item)}
                  >
                    定位
                  </button>
                )}

                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  aria-label={`上移 ${item.defaultTitle}`}
                  disabled={idx === 0}
                  title={idx === 0 ? "已在顶部，无法继续上移" : "上移一项"}
                  onClick={() => onChange(moveSidebarItem(state, item.id, "up"))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  aria-label={`下移 ${item.defaultTitle}`}
                  disabled={idx === sortedSidebar.length - 1}
                  title={
                    idx === sortedSidebar.length - 1
                      ? "已在底部，无法继续下移"
                      : "下移一项"
                  }
                  onClick={() => onChange(moveSidebarItem(state, item.id, "down"))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={item.visible}
                  aria-pressed={item.visible}
                  className={`pmx-btn pmx-btn-sm ${item.visible ? "pmx-btn-selected" : ""}`}
                  onClick={() =>
                    onChange(toggleSidebarItemVisibility(state, item.id))
                  }
                >
                  {item.visible ? "显示" : "已隐藏"}
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  className="pmx-input"
                  aria-label={`${item.defaultTitle} 中文标题覆写`}
                  placeholder={`标题覆写（默认：${item.defaultTitle}）`}
                  value={item.customTitle ?? ""}
                  onChange={(e) =>
                    onChange(
                      overrideSidebarItemDisplay(state, item.id, {
                        customTitle: e.target.value
                      })
                    )
                  }
                  style={{ flex: 1, height: "28px", minHeight: "28px" }}
                />
                <select
                  className="pmx-input"
                  aria-label={`${item.defaultTitle} 16x16 图标选择`}
                  value={item.customIcon ?? item.defaultIcon}
                  onChange={(e) =>
                    onChange(
                      overrideSidebarItemDisplay(state, item.id, {
                        customIcon: e.target.value
                      })
                    )
                  }
                  style={{ width: "84px", height: "28px", minHeight: "28px" }}
                >
                  {ICON_PRESETS.map((ico) => (
                    <option key={ico} value={ico}>
                      {ico}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {sortedCommands.map((cmd, idx) => (
            <div
              key={cmd.id}
              draggable
              onDragStart={() => setDraggingCommandId(cmd.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggingCommandId && draggingCommandId !== cmd.id) {
                  onChange(reorderSlashCommand(state, draggingCommandId, idx));
                }
                setDraggingCommandId(null);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
                background: "var(--prismux-control, rgba(15,23,42,0.28))",
                opacity: cmd.visible ? 1 : 0.62,
                display: "flex",
                flexDirection: "column",
                gap: "8px"
              }}
            >
              <div className="pmx-list-row" style={{ padding: 0 }}>
                <span className="prismux-ico" aria-hidden="true">
                  {cmd.customIcon ?? cmd.defaultIcon}
                </span>
                <code style={{ fontWeight: 600 }}>{cmd.command}</code>
                <span style={{ flex: 1, fontSize: "12.5px" }}>
                  {cmd.customTitle ?? cmd.defaultTitle}
                </span>

                {onExecuteCommand && (
                  <button
                    type="button"
                    className="pmx-btn pmx-btn-sm"
                    disabled={!cmd.visible}
                    title={cmd.visible ? "测试执行该指令" : "隐藏命令已禁用"}
                    onClick={() => onExecuteCommand(cmd)}
                  >
                    运行
                  </button>
                )}

                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  disabled={idx === 0}
                  title={idx === 0 ? "已在顶部" : "上移"}
                  onClick={() => onChange(moveSlashCommand(state, cmd.id, "up"))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="pmx-btn pmx-btn-sm"
                  disabled={idx === sortedCommands.length - 1}
                  title={idx === sortedCommands.length - 1 ? "已在底部" : "下移"}
                  onClick={() => onChange(moveSlashCommand(state, cmd.id, "down"))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={cmd.visible}
                  aria-pressed={cmd.visible}
                  className={`pmx-btn pmx-btn-sm ${cmd.visible ? "pmx-btn-selected" : ""}`}
                  onClick={() =>
                    onChange(toggleSlashCommandVisibility(state, cmd.id))
                  }
                >
                  {cmd.visible ? "启用" : "已隐藏"}
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="text"
                  className="pmx-input"
                  aria-label={`${cmd.command} 中文标题覆写`}
                  placeholder={`中文名称覆写（默认：${cmd.defaultTitle}）`}
                  value={cmd.customTitle ?? ""}
                  onChange={(e) =>
                    onChange(
                      overrideSlashCommandDisplay(state, cmd.id, {
                        customTitle: e.target.value
                      })
                    )
                  }
                  style={{ flex: 1, height: "28px", minHeight: "28px" }}
                />
                <select
                  className="pmx-input"
                  aria-label={`${cmd.command} 16x16 图标覆写`}
                  value={cmd.customIcon ?? cmd.defaultIcon}
                  onChange={(e) =>
                    onChange(
                      overrideSlashCommandDisplay(state, cmd.id, {
                        customIcon: e.target.value
                      })
                    )
                  }
                  style={{ width: "84px", height: "28px", minHeight: "28px" }}
                >
                  {ICON_PRESETS.map((ico) => (
                    <option key={ico} value={ico}>
                      {ico}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 跨设备同步快照导出与恢复 */}
      <div
        style={{
          padding: "12px",
          borderRadius: "10px",
          border: "1px solid var(--prismux-line, rgba(148,163,184,0.24))",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px"
          }}
        >
          <strong style={{ fontSize: "12.5px" }}>跨设备同步与配置恢复</strong>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="pmx-btn pmx-btn-sm"
              onClick={() => {
                const payload = exportNavAndCommandSyncPayload(state, machineId);
                setSyncText(payload);
                setSyncError(null);
                setSyncNotice("已生成可跨设备同步的排序与覆写快照");
              }}
            >
              导出同步快照
            </button>
            <button
              type="button"
              className="pmx-btn pmx-btn-sm pmx-btn-primary"
              disabled={syncText.trim().length === 0}
              title={
                syncText.trim().length === 0
                  ? "请先点击导出或在下方粘贴同步 JSON 快照"
                  : undefined
              }
              onClick={() => {
                try {
                  const restored = restoreNavAndCommandSyncPayload(syncText);
                  onChange(restored);
                  setSyncError(null);
                  setSyncNotice("已从同步快照无损恢复侧栏与斜杠命令顺序");
                } catch (err) {
                  setSyncError(
                    err instanceof Error ? err.message : "同步 JSON 解析失败"
                  );
                }
              }}
            >
              恢复导入
            </button>
          </div>
        </div>

        <textarea
          className="pmx-input"
          aria-label="导航与命令同步 JSON 快照"
          placeholder="点击「导出同步快照」生成配置，或在此粘贴其他设备的同步 JSON 点击「恢复导入」..."
          value={syncText}
          onChange={(e) => setSyncText(e.target.value)}
          rows={3}
          style={{
            height: "auto",
            minHeight: "64px",
            padding: "8px 12px",
            fontFamily: "ui-monospace, Consolas, monospace",
            fontSize: "12px",
            resize: "vertical"
          }}
        />

        {syncError && (
          <div className="pmx-alert" role="alert">
            <span>导入失败：{syncError}。请核对 JSON 格式后重试。</span>
          </div>
        )}
        {syncNotice && !syncError && (
          <div className="pmx-muted" role="status">
            {syncNotice}
          </div>
        )}
      </div>
    </section>
  );
};
