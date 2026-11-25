import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_QUICK_SWATCHES } from './types.js';
import {
  clampNumber,
  hexToRgb,
  hsvToRgb,
  normalizeHex,
  rgbToHex,
  rgbToHsv,
} from './colorUtils.js';

export interface FloatingColorPopoverProps {
  open: boolean;
  /** Current color hex (#rrggbb) or empty string when inheriting default. */
  value: string;
  /** Preview fallback hex used when `value` is empty. */
  fallbackColor?: string;
  /** Trigger element used for viewport-clamped placement & Escape focus restoration. */
  anchorEl?: HTMLElement | null;
  /** Explicit anchor coordinate fallback when no anchorEl is provided. */
  anchorPoint?: { x: number; y: number } | null;
  title?: string;
  clearLabel?: string;
  allowClear?: boolean;
  swatches?: readonly string[];
  /** Called during live drag (`commit = false`) and on pointerup / swatch / Enter (`commit = true`). */
  onChange: (hex: string, commit: boolean) => void;
  onClear?: () => void;
  onClose: () => void;
  portalContainer?: Element | null;
  className?: string;
}

interface InternalColorState {
  h: number;
  s: number;
  v: number;
  r: number;
  g: number;
  b: number;
  hex: string;
}

function createColorState(hexInput: string): InternalColorState {
  const hex = normalizeHex(hexInput, true) || '#5e9bff';
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  return { ...hsv, ...rgb, hex };
}

export function FloatingColorPopover({
  open,
  value,
  fallbackColor = '#5e9bff',
  anchorEl = null,
  anchorPoint = null,
  title = '选择颜色',
  clearLabel = '清空',
  allowClear = true,
  swatches = DEFAULT_QUICK_SWATCHES,
  onChange,
  onClear,
  onClose,
  portalContainer,
  className,
}: FloatingColorPopoverProps) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const svRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const draggingKindRef = useRef<'sv' | 'hue' | null>(null);

  const effectiveSeed = normalizeHex(value, true) || normalizeHex(fallbackColor, true) || '#5e9bff';
  const [color, setColor] = useState<InternalColorState>(() => createColorState(effectiveSeed));
  const [hexDraft, setHexDraft] = useState<string>(color.hex);
  const [hexFocused, setHexFocused] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 16, top: 16 });

  // Keep local state in sync with incoming value when opened or externally mutated.
  useEffect(() => {
    if (!open || draggingKindRef.current) return;
    const next = createColorState(effectiveSeed);
    setColor((prev) => {
      // Preserve existing hue angle for pure black/white/gray where hue is degenerate.
      const keepHue = next.s === 0 || next.v === 0;
      return keepHue ? { ...next, h: prev.h } : next;
    });
    if (!hexFocused) {
      setHexDraft(next.hex);
    }
  }, [effectiveSeed, hexFocused, open]);

  const updatePosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const pop = popRef.current;
    const popW = pop?.offsetWidth || 244;
    const popH = pop?.offsetHeight || 320;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;

    const host =
      portalContainer && portalContainer !== document.body && portalContainer !== document.documentElement
        ? portalContainer
        : null;
    const hostRect = host ? host.getBoundingClientRect() : null;
    const minLeft = hostRect ? hostRect.left + margin : margin;
    const maxLeft = hostRect
      ? Math.max(minLeft, hostRect.right - popW - margin)
      : Math.max(margin, vw - popW - margin);
    const minTop = hostRect ? hostRect.top + margin : margin;
    const maxTop = hostRect
      ? Math.max(minTop, hostRect.bottom - popH - margin)
      : Math.max(margin, vh - popH - margin);

    let left = minLeft;
    let top = minTop;

    if (anchorEl && anchorEl.isConnected) {
      const rect = anchorEl.getBoundingClientRect();
      left = rect.right - popW;
      left = clampNumber(left, minLeft, maxLeft);
      top = rect.bottom + 8;
      if (top + popH > (hostRect ? hostRect.bottom : vh) - margin) {
        const above = rect.top - popH - 8;
        top = above >= minTop ? above : maxTop;
      }
    } else if (anchorPoint) {
      left = clampNumber(anchorPoint.x - popW / 2, minLeft, maxLeft);
      top = anchorPoint.y + 8;
      if (top + popH > (hostRect ? hostRect.bottom : vh) - margin) {
        top = Math.max(minTop, anchorPoint.y - popH - 8);
      }
    }

    // When portaled inside a modal popup with backdrop-filter/transform, `position: fixed`
    // anchors to that containing block (`pop.offsetParent`) rather than the viewport.
    const containingEl =
      pop?.offsetParent &&
      pop.offsetParent !== document.body &&
      pop.offsetParent !== document.documentElement
        ? pop.offsetParent
        : null;
    const containingRect = containingEl ? containingEl.getBoundingClientRect() : null;
    const localLeft = containingRect ? left - containingRect.left : left;
    const localTop = containingRect ? top - containingRect.top : top;

    setPos({ left: Math.round(localLeft), top: Math.round(localTop) });
  }, [anchorEl, anchorPoint, portalContainer]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  // Outside click, Escape key, resize & external scroll handling (mandate §1.4: never close on inner scroll!).
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    const handlePointerDownOutside = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        anchorEl?.focus?.();
      }
    };

    const handleScrollOrResize = (e: Event) => {
      const target = e.target as Node | null;
      if (target && popRef.current?.contains(target)) return;
      updatePosition();
    };

    window.addEventListener('pointerdown', handlePointerDownOutside, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleScrollOrResize, { passive: true });
    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDownOutside, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [anchorEl, onClose, open, updatePosition]);

  const emitHsv = useCallback(
    (h: number, s: number, v: number, commit: boolean) => {
      const rgb = hsvToRgb(h, s, v);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      setColor({ h, s, v, ...rgb, hex });
      setHexDraft(hex);
      onChange(hex, commit);
    },
    [onChange],
  );

  const handleSvPoint = useCallback(
    (clientX: number, clientY: number, commit: boolean) => {
      const el = svRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const s = clampNumber((clientX - rect.left) / (rect.width || 1), 0, 1);
      const v = clampNumber(1 - (clientY - rect.top) / (rect.height || 1), 0, 1);
      emitHsv(color.h, s, v, commit);
    },
    [color.h, emitHsv],
  );

  const handleHuePoint = useCallback(
    (clientX: number, commit: boolean) => {
      const el = hueRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = clampNumber((clientX - rect.left) / (rect.width || 1), 0, 1);
      const h = Math.min(359.9, ratio * 360);
      emitHsv(h, color.s, color.v, commit);
    },
    [color.s, color.v, emitHsv],
  );

  const onSvPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingKindRef.current = 'sv';
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    handleSvPoint(e.clientX, e.clientY, false);
  };

  const onSvPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingKindRef.current !== 'sv') return;
    e.preventDefault();
    handleSvPoint(e.clientX, e.clientY, false);
  };

  const onSvPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingKindRef.current !== 'sv') return;
    draggingKindRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    handleSvPoint(e.clientX, e.clientY, true);
  };

  const onHuePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingKindRef.current = 'hue';
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    handleHuePoint(e.clientX, false);
  };

  const onHuePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingKindRef.current !== 'hue') return;
    e.preventDefault();
    handleHuePoint(e.clientX, false);
  };

  const onHuePointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingKindRef.current !== 'hue') return;
    draggingKindRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    handleHuePoint(e.clientX, true);
  };

  const handleRgbChange = (channel: 'r' | 'g' | 'b', raw: string, commit: boolean) => {
    const num = clampNumber(Number.parseInt(raw.replace(/[^\d]/g, ''), 10) || 0, 0, 255);
    const nextR = channel === 'r' ? num : color.r;
    const nextG = channel === 'g' ? num : color.g;
    const nextB = channel === 'b' ? num : color.b;
    const hex = rgbToHex(nextR, nextG, nextB);
    const hsv = rgbToHsv(nextR, nextG, nextB);
    const nextH = hsv.s > 0 && hsv.v > 0 ? hsv.h : color.h;
    setColor({ h: nextH, s: hsv.s, v: hsv.v, r: nextR, g: nextG, b: nextB, hex });
    setHexDraft(hex);
    onChange(hex, commit);
  };

  const handleHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setHexDraft(raw);
    const clean = normalizeHex(raw, false);
    if (clean) {
      const rgb = hexToRgb(clean);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const nextH = hsv.s > 0 && hsv.v > 0 ? hsv.h : color.h;
      setColor({ h: nextH, s: hsv.s, v: hsv.v, ...rgb, hex: clean });
      onChange(clean, false);
    }
  };

  const commitHexDraft = () => {
    const clean = normalizeHex(hexDraft, true);
    if (clean) {
      const rgb = hexToRgb(clean);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const nextH = hsv.s > 0 && hsv.v > 0 ? hsv.h : color.h;
      setColor({ h: nextH, s: hsv.s, v: hsv.v, ...rgb, hex: clean });
      setHexDraft(clean);
      onChange(clean, true);
    } else {
      setHexDraft(color.hex);
    }
  };

  const handleHexKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitHexDraft();
    }
  };

  const handleSwatchClick = (swatchHex: string) => {
    const clean = normalizeHex(swatchHex, true);
    if (!clean) return;
    const next = createColorState(clean);
    setColor((prev) => ({
      ...next,
      h: next.s > 0 && next.v > 0 ? next.h : prev.h,
    }));
    setHexDraft(clean);
    onChange(clean, true);
  };

  if (!open) return null;

  const pureHue = hsvToRgb(color.h, 1, 1);
  const pureHueHex = rgbToHex(pureHue.r, pureHue.g, pureHue.b);

  const popoverNode = (
    <div
      ref={popRef}
      role="dialog"
      aria-label={title}
      className={['pmx-cp-popover', 'cp-popover', className ?? ''].filter(Boolean).join(' ')}
      style={{
        left: `${pos.left}px`,
        top: `${pos.top}px`,
      }}
    >
      <div className="cp-head">
        <span className="cp-title">{title}</span>
        <button
          type="button"
          className="cp-close"
          aria-label="关闭调色盘"
          onClick={() => {
            onClose();
            anchorEl?.focus?.();
          }}
        >
          ✕
        </button>
      </div>

      {/* 2D Saturation × Value Canvas */}
      <div
        ref={svRef}
        className="cp-sv"
        style={{ backgroundColor: pureHueHex }}
        onPointerDown={onSvPointerDown}
        onPointerMove={onSvPointerMove}
        onPointerUp={onSvPointerEnd}
        onPointerCancel={onSvPointerEnd}
      >
        <div className="cp-sv-white" />
        <div className="cp-sv-black" />
        <span
          className="cp-sv-thumb"
          style={{
            left: `${(color.s * 100).toFixed(2)}%`,
            top: `${((1 - color.v) * 100).toFixed(2)}%`,
            background: color.hex,
          }}
        />
      </div>

      {/* Rainbow Hue Bar */}
      <div
        ref={hueRef}
        className="cp-hue"
        onPointerDown={onHuePointerDown}
        onPointerMove={onHuePointerMove}
        onPointerUp={onHuePointerEnd}
        onPointerCancel={onHuePointerEnd}
      >
        <span
          className="cp-hue-thumb"
          style={{
            left: `${(((color.h % 360) / 360) * 100).toFixed(2)}%`,
            background: pureHueHex,
          }}
        />
      </div>

      {/* Curated Quick Swatches */}
      {swatches.length > 0 ? (
        <div className="cp-swatches" role="list" aria-label="快捷色卡">
          {swatches.map((sw) => {
            const clean = normalizeHex(sw, true);
            if (!clean) return null;
            const active = clean === color.hex;
            return (
              <button
                key={clean}
                type="button"
                role="listitem"
                className={`cp-swatch${active ? ' on' : ''}`}
                style={{ backgroundColor: clean }}
                title={clean}
                aria-label={`选择颜色 ${clean}`}
                aria-pressed={active}
                onClick={() => handleSwatchClick(clean)}
              />
            );
          })}
        </div>
      ) : null}

      {/* RGB 0-255 Inputs */}
      <div className="cp-rgb-row">
        {(['r', 'g', 'b'] as const).map((ch) => (
          <label key={ch} className="cp-rgb-field">
            <span>{ch.toUpperCase()}</span>
            <input
              type="text"
              className="cp-rgb-in mono"
              inputMode="numeric"
              maxLength={3}
              autoComplete="off"
              aria-label={`${ch.toUpperCase()} 通道`}
              value={String(color[ch])}
              onChange={(e) => handleRgbChange(ch, e.target.value, false)}
              onBlur={(e) => handleRgbChange(ch, e.target.value, true)}
            />
          </label>
        ))}
      </div>

      {/* Footer: Clear + HEX */}
      <div className="cp-foot">
        {allowClear ? (
          <button
            type="button"
            className="cp-clear"
            onClick={() => {
              onClear?.();
              onClose();
            }}
          >
            {clearLabel}
          </button>
        ) : null}
        <div className="cp-hex-wrap">
          <i className="cp-hex-dot" style={{ background: color.hex }} />
          <input
            type="text"
            className="cp-hex-in mono"
            maxLength={7}
            placeholder="#ffffff"
            spellCheck={false}
            autoComplete="off"
            aria-label="十六进制颜色值"
            value={hexDraft}
            onFocus={() => setHexFocused(true)}
            onBlur={() => {
              setHexFocused(false);
              commitHexDraft();
            }}
            onChange={handleHexChange}
            onKeyDown={handleHexKeyDown}
          />
        </div>
      </div>
    </div>
  );

  const target =
    portalContainer ?? (typeof document !== 'undefined' ? document.body : null);
  return target ? createPortal(popoverNode, target) : popoverNode;
}
