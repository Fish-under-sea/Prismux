/**
 * Scoped component styling for Prismux M4 workbench tools, built-in enhancers,
 * market modal, and 5-step quiet-luxury wizard.
 *
 * Rules enforced from docs/specs/ui-ux-design-mandate.md:
 * - Zero `prefers-color-scheme` usage (theme comes strictly from `[data-prismux-theme]` & `--prismux-*`)
 * - 4px spatial grid, `tabular-nums`, 16x16 `.prismux-ico` boxes
 * - Full 8 interactive states (default, hover, active, focus-visible, disabled, loading, error, selected)
 * - No hardcoded opaque #000 or hardcoded `blur(18px)`; glass surfaces follow `--prismux-glass-*`
 * - Reduced motion & GPU=0 / reduced-transparency / forced-colors fallbacks
 */
export const WORKBENCH_COMPONENTS_CSS = `
.pmx-shell {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--prismux-text, var(--fg, #eef2f8));
  font-family: var(--prismux-font-family, "Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-weight: var(--prismux-font-weight, 400);
  font-size: 13px;
  line-height: 1.45;
  background: transparent;
}

.pmx-tabular {
  font-variant-numeric: tabular-nums;
}

.pmx-ico,
.prismux-ico {
  width: 16px;
  height: 16px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 16px;
}

.pmx-glass-sidebar {
  background: color-mix(
    in srgb,
    var(--prismux-glass-tint, var(--prismux-card, #111827)) var(--prismux-glass-sidebar-fill, 100%),
    transparent
  );
  -webkit-backdrop-filter: blur(var(--prismux-glass-sidebar-blur, 0px)) saturate(175%) brightness(1.04);
  backdrop-filter: blur(var(--prismux-glass-sidebar-blur, 0px)) saturate(175%) brightness(1.04);
  border-color: var(--prismux-glass-border, var(--prismux-line, rgba(148, 163, 184, 0.24)));
  box-shadow: inset 0 1px 0 var(--hi, rgba(255, 255, 255, 0.14));
}

.pmx-glass-content {
  background: color-mix(
    in srgb,
    var(--prismux-glass-tint, var(--prismux-card, #111827)) var(--prismux-glass-content-fill, 100%),
    transparent
  );
  -webkit-backdrop-filter: blur(var(--prismux-glass-content-blur, 0px)) saturate(175%) brightness(1.04);
  backdrop-filter: blur(var(--prismux-glass-content-blur, 0px)) saturate(175%) brightness(1.04);
  border: 1px solid var(--prismux-glass-border, var(--prismux-line, rgba(148, 163, 184, 0.24)));
  border-radius: 14px;
  box-shadow: inset 0 1px 0 var(--hi, rgba(255, 255, 255, 0.14));
}

.pmx-glass-overlay {
  background: color-mix(
    in srgb,
    var(--prismux-glass-tint, var(--prismux-card, #111827)) var(--prismux-glass-overlay-fill, 100%),
    transparent
  );
  -webkit-backdrop-filter: blur(var(--prismux-glass-overlay-blur, 0px)) saturate(175%) brightness(1.04);
  backdrop-filter: blur(var(--prismux-glass-overlay-blur, 0px)) saturate(175%) brightness(1.04);
  border: 1px solid var(--prismux-glass-border, var(--prismux-line, rgba(148, 163, 184, 0.28)));
  border-radius: 14px;
  box-shadow:
    inset 0 1px 0 var(--hi, rgba(255, 255, 255, 0.16)),
    0 18px 48px rgba(15, 23, 42, 0.28);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .pmx-glass-sidebar,
  .pmx-glass-content,
  .pmx-glass-overlay {
    background: var(--prismux-card, #111827);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .pmx-glass-sidebar,
  .pmx-glass-content,
  .pmx-glass-overlay {
    background: var(--prismux-card, #111827);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

html[data-prismux-gpu="0"] .pmx-glass-sidebar,
html[data-prismux-gpu="0"] .pmx-glass-content,
html[data-prismux-gpu="0"] .pmx-glass-overlay {
  background: var(--prismux-card, #111827);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

@media (forced-colors: active) {
  .pmx-glass-sidebar,
  .pmx-glass-content,
  .pmx-glass-overlay {
    background: Canvas;
    color: CanvasText;
    border: 1px solid CanvasText;
  }
}

/* 8-state interactive button */
.pmx-btn {
  height: 28px;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--line-control, var(--prismux-line, rgba(148, 163, 184, 0.34)));
  background: color-mix(
    in srgb,
    var(--prismux-control, #1e293b) var(--prismux-glass-control-fill, 100%),
    transparent
  );
  color: var(--ctl-fg, var(--prismux-text, #eef2f8));
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 var(--hi, rgba(255, 255, 255, 0.12));
  transition:
    background-color 110ms cubic-bezier(0.2, 0, 0, 1),
    border-color 110ms cubic-bezier(0.2, 0, 0, 1),
    filter 110ms cubic-bezier(0.2, 0, 0, 1),
    transform 90ms cubic-bezier(0.2, 0, 0, 1);
}

.pmx-btn:hover:not(:disabled):not([aria-disabled="true"]) {
  filter: brightness(1.12);
}

.pmx-btn:active:not(:disabled):not([aria-disabled="true"]) {
  transform: translateY(1px);
}

.pmx-btn:focus-visible {
  outline: 2px solid var(--prismux-accent, #3b82f6);
  outline-offset: 2px;
}

.pmx-btn:disabled,
.pmx-btn[aria-disabled="true"] {
  opacity: 0.5;
  cursor: not-allowed;
}

.pmx-btn[aria-busy="true"] {
  cursor: progress;
  opacity: 0.85;
}

.pmx-btn[aria-pressed="true"],
.pmx-btn[aria-selected="true"],
.pmx-btn-selected {
  background: var(--sel-bg, rgba(59, 130, 246, 0.18));
  border-color: var(--sel-line, var(--prismux-accent, #3b82f6));
  box-shadow:
    inset 0 -2px 0 var(--sel-line, var(--prismux-accent, #3b82f6)),
    inset 0 1px 0 var(--hi, rgba(255, 255, 255, 0.16));
}

.pmx-btn-primary {
  background: var(--prismux-accent, #2563eb);
  border-color: var(--prismux-accent, #3b82f6);
  color: #ffffff;
}

.pmx-btn-danger {
  border-color: var(--c-bad, #dc2626);
  color: var(--c-bad, #f87171);
}

.pmx-btn-pill {
  border-radius: 999px;
}

.pmx-btn-sm {
  height: 24px;
  min-height: 24px;
  padding: 0 8px;
  font-size: 12px;
}

.pmx-input {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--line-control, var(--prismux-line, rgba(148, 163, 184, 0.34)));
  background: color-mix(
    in srgb,
    var(--prismux-control, #1e293b) var(--prismux-glass-control-fill, 100%),
    transparent
  );
  color: var(--prismux-text, var(--fg, #eef2f8));
  font-size: 12.5px;
  line-height: 1.4;
  transition: border-color 110ms cubic-bezier(0.2, 0, 0, 1);
}

.pmx-input:hover:not(:disabled) {
  border-color: var(--prismux-accent, #3b82f6);
}

.pmx-input:focus-visible {
  outline: 2px solid var(--prismux-accent, #3b82f6);
  outline-offset: 2px;
}

.pmx-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pmx-input[aria-invalid="true"] {
  border-color: var(--c-bad, #dc2626);
}

.pmx-muted {
  color: var(--prismux-muted, var(--fg-2, #94a3b8));
  font-size: 12px;
}

.pmx-alert {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--c-bad, #dc2626);
  background: color-mix(in srgb, var(--c-bad, #dc2626) 14%, var(--prismux-card, #111827));
  color: var(--prismux-text, #eef2f8);
  font-size: 12.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pmx-warn-card {
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--c-warn, #d97706);
  background: color-mix(in srgb, var(--c-warn, #d97706) 14%, var(--prismux-card, #111827));
  color: var(--prismux-text, #eef2f8);
}

.pmx-kv-row {
  min-height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  line-height: 26px;
}

.pmx-list-row {
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 8px;
  line-height: 28px;
}

.pmx-list-row[aria-selected="true"] {
  background: var(--sel-bg, rgba(59, 130, 246, 0.16));
  box-shadow: inset 3px 0 0 var(--sel-line, var(--prismux-accent, #3b82f6));
}

.pmx-topbar {
  position: relative;
  z-index: 25;
  min-height: 44px;
  padding: 6px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--prismux-glass-border, var(--prismux-line, rgba(148, 163, 184, 0.2)));
  transition: background-color 240ms cubic-bezier(0.22, 1, 0.36, 1),
    backdrop-filter 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pmx-main-stage {
  position: relative;
  z-index: 10;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 12px;
  transition: opacity 240ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

/* Reserve clear bottom lane in multi-agent-coding so FloatingCapsules never overlaps split panes */
.pmx-shell[data-pane-preset="multi-agent-coding"] .pmx-main-stage {
  padding-bottom: 60px;
}

/* Optimize approval-inbox leaf body so embedded ApprovalGuidePanel keeps max vertical budget */
.prismux-leaf-pane[data-pane-id="approval-inbox"] .prismux-leaf-body {
  padding: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.pmx-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.36);
}

.pmx-drawer {
  width: min(560px, 94vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 14px 0 0 14px;
  overflow: hidden;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pmx-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.48);
}

@media (prefers-reduced-motion: reduce) {
  .pmx-btn,
  .pmx-input,
  .pmx-topbar,
  .pmx-main-stage,
  .pmx-drawer {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
`;
