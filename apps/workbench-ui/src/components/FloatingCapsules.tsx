import { useRef, useState } from "react";

export interface FloatingCapsulesProps {
  standbyMode: boolean;
  pendingApprovals: number;
  unreadEmails: number;
  onQuickContinue: () => void;
  onOpenApprovals: () => void;
  onOpenSettings: () => void;
  onSwitchPreset: () => void;
}

type DockAnchor = "bottom-center" | "bottom-right" | "bottom-left" | "top-right";

export function FloatingCapsules({
  standbyMode,
  pendingApprovals,
  unreadEmails,
  onQuickContinue,
  onOpenApprovals,
  onOpenSettings,
  onSwitchPreset
}: FloatingCapsulesProps) {
  const capsuleRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<DockAnchor>("bottom-center");
  const [dragDelta, setDragDelta] = useState<{ x: number; y: number } | null>(
    null
  );

  const handleGripPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>
  ): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    setDragDelta({ x: 0, y: 0 });

    const onMove = (moveEvent: PointerEvent): void => {
      setDragDelta({
        x: moveEvent.clientX - startX,
        y: moveEvent.clientY - startY
      });
    };

    const onUp = (upEvent: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 720;
      const relX = upEvent.clientX / vw;
      const relY = upEvent.clientY / vh;

      let nextAnchor: DockAnchor = "bottom-center";
      if (relY < 0.32) {
        nextAnchor = "top-right";
      } else if (relX < 0.3) {
        nextAnchor = "bottom-left";
      } else if (relX > 0.7) {
        nextAnchor = "bottom-right";
      } else {
        nextAnchor = "bottom-center";
      }

      setAnchor(nextAnchor);
      setDragDelta(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const getAnchorStyle = (): React.CSSProperties => {
    const baseTransform = dragDelta
      ? `translate3d(${dragDelta.x}px, ${dragDelta.y}px, 0)`
      : undefined;

    if (!standbyMode && anchor === "bottom-center") {
      return {
        right: "var(--sp-4)",
        bottom: "48px",
        ...(baseTransform ? { transform: baseTransform } : {})
      };
    }

    switch (anchor) {
      case "top-right":
        return {
          top: "64px",
          right: "var(--sp-4)",
          ...(baseTransform ? { transform: baseTransform } : {})
        };
      case "bottom-left":
        return {
          left: "var(--sp-4)",
          bottom: "48px",
          ...(baseTransform ? { transform: baseTransform } : {})
        };
      case "bottom-right":
        return {
          right: "var(--sp-4)",
          bottom: "48px",
          ...(baseTransform ? { transform: baseTransform } : {})
        };
      case "bottom-center":
      default:
        return {
          left: "50%",
          bottom: "52px",
          transform: dragDelta
            ? `translate3d(calc(-50% + ${dragDelta.x}px), ${dragDelta.y}px, 0)`
            : "translate3d(-50%, 0, 0)"
        };
    }
  };

  return (
    <div className="prismux-floating-layer" aria-label="浮动玻璃胶囊">
      <div
        ref={capsuleRef}
        className={`prismux-floating-capsule prismux-glass-surface prismux-glass-overlay ${
          dragDelta ? "" : "prismux-motion-capsule"
        }`}
        data-standby-mode={standbyMode ? "1" : "0"}
        data-dock-anchor={anchor}
        style={getAnchorStyle()}
      >
        <button
          type="button"
          className="prismux-floating-grip"
          title="拖拽吸附到角落，双击复位"
          aria-label="拖拽移动浮动玻璃胶囊，双击复位到底部中央"
          onPointerDown={handleGripPointerDown}
          onDoubleClick={() => {
            setDragDelta(null);
            setAnchor("bottom-center");
          }}
        >
          <span className="prismux-ico" aria-hidden="true">
            ⋮⋮
          </span>
        </button>

        {standbyMode && (
          <button
            type="button"
            className="prismux-btn prismux-btn-sm prismux-btn-primary"
            onClick={onQuickContinue}
          >
            <span className="prismux-ico" aria-hidden="true">
              ✦
            </span>
            <span>主秘书快捷续跑</span>
          </button>
        )}

        <button
          type="button"
          className="prismux-chip prismux-chip-sm"
          onClick={onOpenApprovals}
        >
          <span className="prismux-ico" aria-hidden="true">
            {pendingApprovals > 0 ? "⚡" : "✓"}
          </span>
          <span>待办审批</span>
          <span
            className={`prismux-tabular ${
              pendingApprovals > 0 ? "prismux-status-warn" : "prismux-status-ok"
            }`}
          >
            {pendingApprovals}
          </span>
        </button>

        <span className="prismux-badge" title="夜间工场与未读邮件回执">
          <span className="prismux-ico" aria-hidden="true">
            ✉
          </span>
          <span>未读</span>
          <span className="prismux-tabular">{unreadEmails}</span>
        </span>

        <button
          type="button"
          className="prismux-chip prismux-chip-sm"
          onClick={onOpenSettings}
        >
          <span className="prismux-ico" aria-hidden="true">
            ◐
          </span>
          <span>主题</span>
        </button>

        <button
          type="button"
          className="prismux-chip prismux-chip-sm"
          onClick={onSwitchPreset}
        >
          <span className="prismux-ico" aria-hidden="true">
            ⇄
          </span>
          <span>{standbyMode ? "进入多代理编码" : "切至秘书待机"}</span>
        </button>
      </div>
    </div>
  );
}
