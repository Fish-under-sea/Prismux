import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangleIcon, HistoryIcon, XIcon } from "lucide-react";

import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import type { PluginCenterItem } from "./pluginCenterModel";

export interface PluginRollbackDialogProps {
  readonly plugin: PluginCenterItem | null;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: (plugin: PluginCenterItem) => void | Promise<void>;
}

/**
 * Dedicated rollback confirmation dialog (aligned with stablyai/orca `PluginRollbackDialog.tsx`).
 * Cancel holds initial focus so an accidental Enter keystroke never triggers rollback.
 */
export function PluginRollbackDialog({
  plugin,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: PluginRollbackDialogProps) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setPortalHost(document.body);
    }
  }, []);

  useEffect(() => {
    if (!plugin) return;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, onCancel, plugin, portalHost]);

  if (!plugin || !plugin.previousVersion) {
    return null;
  }

  const dialogContent = (
    <div
      className="fixed top-0 right-0 bottom-6 left-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs [-webkit-app-region:no-drag]"
      data-slot="plugin-rollback-backdrop"
      data-portal-layer="plugin-rollback-dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-testid="plugin-rollback-dialog"
        className="pmx-plugin-overlay-surface relative flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border text-popover-foreground shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="flex items-start gap-2.5">
            <HistoryIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
            <div className="space-y-1">
              <h3 id={titleId} className="text-base font-semibold text-foreground">
                确认回滚 {plugin.title}？
              </h3>
              <p id={descId} className="text-xs leading-relaxed text-muted-foreground">
                将把插件从当前版本原子切换回上一版本快照，已保存的独立凭据与持久化配置不会丢失。
              </p>
            </div>
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="关闭回滚确认弹窗"
            disabled={busy}
            onClick={onCancel}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="space-y-3 px-5 py-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-muted/30 px-3.5 py-2.5">
            <span className="font-mono text-muted-foreground">{plugin.packageName}</span>
            <Badge variant="warning" className="font-mono tabular-nums">
              v{plugin.installedVersion ?? plugin.version} → v{plugin.previousVersion}
            </Badge>
          </div>

          {error ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertTriangleIcon className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 break-all">{error}</span>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/25 px-5 py-3">
          <Button ref={cancelRef} size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              void onConfirm(plugin);
            }}
          >
            {busy ? "正在回滚…" : `确认回滚至 v${plugin.previousVersion}`}
          </Button>
        </div>
      </div>
    </div>
  );

  return portalHost ? createPortal(dialogContent, portalHost) : dialogContent;
}
