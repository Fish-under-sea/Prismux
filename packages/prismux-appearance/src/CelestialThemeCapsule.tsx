import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ThemeMode } from './types.js';
import {
  CELESTIAL_SPRING,
  applyCelestialPaintVarsToElement,
  applyRubberBand,
  computeCelestialPaintVars,
  createCelestialPhysicsState,
  projectReleaseMode,
  snapCelestialPhysicsState,
  stepCelestialPhysics,
  type CelestialPhysicsState,
} from './celestialPhysics.js';
import { clampNumber } from './colorUtils.js';

export interface CelestialThemeCapsuleProps {
  /** Active theme mode: 'light' | 'dark' | 'glass'. */
  mode: ThemeMode;
  /** Fired when user drags, clicks, or keyboard-selects a mode. */
  onChange: (nextMode: ThemeMode) => void;
  /** 'default' (34px FISH-Dock full-width) or 'compact' (28px sidebar-friendly). */
  size?: 'default' | 'compact';
  /** Shorthand compact sidebar toggle (takes precedence over `size` when explicitly provided). */
  compact?: boolean;
  /** Disables interaction and shows inline disabledReason when provided. */
  disabled?: boolean;
  /** Explicit human-readable explanation rendered when disabled. */
  disabledReason?: string;
  /** Accessible radiogroup label. */
  ariaLabel?: string;
  /** Optional custom labels for the 3 stops. */
  labels?: Partial<Record<ThemeMode, string>>;
  /** Whether to render the 3 aligned text buttons + blue spring bar beneath the track. */
  showLabels?: boolean;
  className?: string;
}

const MODES: readonly ThemeMode[] = ['light', 'dark', 'glass'] as const;

const DEFAULT_LABELS: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  glass: '玻璃',
};

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CelestialThemeCapsule({
  mode,
  onChange,
  size = 'default',
  compact,
  disabled = false,
  disabledReason,
  ariaLabel = '外观模式切换',
  labels,
  showLabels = true,
  className,
}: CelestialThemeCapsuleProps) {
  const effectiveSize: 'default' | 'compact' =
    compact !== undefined ? (compact ? 'compact' : 'default') : size;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const hitRefs = useRef<Array<HTMLButtonElement | null>>([null, null, null]);
  const physRef = useRef<CelestialPhysicsState>(createCelestialPhysicsState(mode));
  const rafRef = useRef<number>(0);
  const prevTsRef = useRef<number>(0);
  const reducedMotionRef = useRef<boolean>(readPrefersReducedMotion());

  const dragMetaRef = useRef({
    moved: false,
    startX: 0,
    dragOffset: 0,
    lastT: 0,
    suppressClickUntil: 0,
  });

  const [isDraggingUI, setIsDraggingUI] = useState(false);

  const resolvedLabels = useMemo<Record<ThemeMode, string>>(
    () => ({
      light: labels?.light ?? DEFAULT_LABELS.light,
      dark: labels?.dark ?? DEFAULT_LABELS.dark,
      glass: labels?.glass ?? DEFAULT_LABELS.glass,
    }),
    [labels?.dark, labels?.glass, labels?.light],
  );

  const trackHeightPx = effectiveSize === 'compact' ? 28 : 34;
  const halfTrackPx = trackHeightPx / 2;

  const paintNow = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const vars = computeCelestialPaintVars(physRef.current);
    applyCelestialPaintVarsToElement(track, vars);
  }, []);

  const stepFrame = useCallback(
    (ts: number) => {
      rafRef.current = 0;
      const track = trackRef.current;
      if (!track || !track.isConnected) return;

      const dt = prevTsRef.current
        ? Math.min(CELESTIAL_SPRING.maxDt, (ts - prevTsRef.current) / 1000)
        : 0.016;
      prevTsRef.current = ts;

      const settled = stepCelestialPhysics(physRef.current, dt, reducedMotionRef.current);
      paintNow();

      if (settled) {
        track.classList.remove('is-physics');
        prevTsRef.current = 0;
      } else {
        rafRef.current = window.requestAnimationFrame(stepFrame);
      }
    },
    [paintNow],
  );

  const wakePhysics = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    if (reducedMotionRef.current && !physRef.current.dragging) {
      snapCelestialPhysicsState(physRef.current, physRef.current.targetMode);
      paintNow();
      track.classList.remove('is-physics');
      return;
    }
    track.classList.add('is-physics');
    if (!rafRef.current && typeof window !== 'undefined') {
      prevTsRef.current = 0;
      rafRef.current = window.requestAnimationFrame(stepFrame);
    }
  }, [paintNow, stepFrame]);

  // Listen for OS prefers-reduced-motion changes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const handleChange = (ev: MediaQueryListEvent) => {
      reducedMotionRef.current = ev.matches;
      if (ev.matches && !physRef.current.dragging) {
        if (rafRef.current) {
          window.cancelAnimationFrame(rafRef.current);
          rafRef.current = 0;
        }
        snapCelestialPhysicsState(physRef.current, physRef.current.targetMode);
        paintNow();
        trackRef.current?.classList.remove('is-physics');
      }
    };
    mq.addEventListener?.('change', handleChange);
    return () => {
      mq.removeEventListener?.('change', handleChange);
    };
  }, [paintNow]);

  // Initial paint & cleanup on unmount.
  useEffect(() => {
    paintNow();
    return () => {
      if (rafRef.current && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [paintNow]);

  // Synchronize external `mode` prop changes into the physics engine.
  useEffect(() => {
    const st = physRef.current;
    if (st.targetMode !== mode) {
      st.targetMode = mode;
      if (reducedMotionRef.current) {
        snapCelestialPhysicsState(st, mode);
        paintNow();
      } else {
        st.kick = Math.max(st.kick, 0.22);
        wakePhysics();
      }
    } else if (!rafRef.current && !st.dragging) {
      snapCelestialPhysicsState(st, mode);
      paintNow();
    }
  }, [mode, paintNow, wakePhysics]);

  const commitMode = useCallback(
    (nextMode: ThemeMode) => {
      if (disabled) return;
      const st = physRef.current;
      st.targetMode = nextMode;
      if (reducedMotionRef.current) {
        snapCelestialPhysicsState(st, nextMode);
        paintNow();
      } else {
        st.kick = Math.max(st.kick, 0.22);
        wakePhysics();
      }
      if (nextMode !== mode) {
        onChange(nextMode);
      }
    },
    [disabled, mode, onChange, paintNow, wakePhysics],
  );

  const handlePointerEnter = useCallback(() => {
    if (disabled) return;
    physRef.current.hovered = true;
    wakePhysics();
  }, [disabled, wakePhysics]);

  const handlePointerLeave = useCallback(() => {
    physRef.current.hovered = false;
    wakePhysics();
  }, [wakePhysics]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || e.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;
      e.preventDefault();

      const rect = track.getBoundingClientRect();
      const span = Math.max(1, track.clientWidth - trackHeightPx);
      const rel = (e.clientX - rect.left - halfTrackPx) / span;
      const st = physRef.current;

      st.pressed = true;
      st.dragging = true;
      st.dragV = 0;
      st.kick = Math.max(st.kick, 0.18);

      const orbDist = Math.abs(rel - st.p);
      dragMetaRef.current = {
        moved: false,
        startX: e.clientX,
        dragOffset: orbDist < 0.18 ? rel - st.p : 0,
        lastT: performance.now(),
        suppressClickUntil: dragMetaRef.current.suppressClickUntil,
      };

      setIsDraggingUI(true);
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        /* ignore synthetic pointer capture failure */
      }
      wakePhysics();
    },
    [disabled, halfTrackPx, trackHeightPx, wakePhysics],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const st = physRef.current;
      const track = trackRef.current;
      if (!st.dragging || !track) return;

      const meta = dragMetaRef.current;
      const dx = e.clientX - meta.startX;
      if (!meta.moved && Math.abs(dx) > 4) {
        meta.moved = true;
      }
      if (!meta.moved) return;

      const rect = track.getBoundingClientRect();
      const span = Math.max(1, track.clientWidth - trackHeightPx);
      const raw = (e.clientX - rect.left - halfTrackPx) / span - meta.dragOffset;
      const now = performance.now();
      const dt = Math.max(0.004, (now - meta.lastT) / 1000);
      const prevP = st.p;

      st.p = applyRubberBand(raw);
      st.dragV = clampNumber(
        (st.p - prevP) / dt,
        -CELESTIAL_SPRING.maxDragVelocity,
        CELESTIAL_SPRING.maxDragVelocity,
      );
      meta.lastT = now;
      wakePhysics();
    },
    [halfTrackPx, trackHeightPx, wakePhysics],
  );

  const finishDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const st = physRef.current;
      const track = trackRef.current;
      if (!st.dragging || !track) return;

      st.dragging = false;
      st.pressed = false;
      setIsDraggingUI(false);

      try {
        if (track.hasPointerCapture?.(e.pointerId)) {
          track.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* ignore */
      }

      const meta = dragMetaRef.current;
      meta.suppressClickUntil = Date.now() + 80;

      let chosen: ThemeMode;
      if (meta.moved) {
        chosen = projectReleaseMode(st.p, st.dragV);
        st.v = st.dragV * CELESTIAL_SPRING.releaseVelocityScale;
      } else {
        const rect = track.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / (rect.width || 1);
        chosen = ratio < 1 / 3 ? 'light' : ratio < 2 / 3 ? 'dark' : 'glass';
      }
      commitMode(chosen);
    },
    [commitMode],
  );

  const handleHitClick = useCallback(
    (targetMode: ThemeMode) => {
      if (disabled) return;
      if (Date.now() < dragMetaRef.current.suppressClickUntil) return;
      commitMode(targetMode);
    },
    [commitMode, disabled],
  );

  const handleRadioKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (disabled) return;
      let nextIdx: number | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIdx = (index + 1) % MODES.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIdx = (index - 1 + MODES.length) % MODES.length;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = MODES.length - 1;
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const selected = MODES[index];
        if (selected) commitMode(selected);
        return;
      }

      if (nextIdx !== null) {
        e.preventDefault();
        const nextMode = MODES[nextIdx];
        if (nextMode) {
          commitMode(nextMode);
          hitRefs.current[nextIdx]?.focus();
        }
      }
    },
    [commitMode, disabled],
  );

  const rootClassName = [
    'pmx-theme-pill',
    'dock-theme-pill',
    effectiveSize === 'compact' ? 'is-compact' : '',
    disabled ? 'is-disabled' : '',
    isDraggingUI ? 'is-dragging' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClassName}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-size={effectiveSize}
    >
      <div
        ref={trackRef}
        className="dtp-track"
        data-mode={mode}
        data-size={effectiveSize}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        {/* Layer 1: Three continuous cross-fading celestial skies */}
        <span className="dtp-sky dtp-sky-light" aria-hidden="true" />
        <span className="dtp-sky dtp-sky-dark" aria-hidden="true" />
        <span className="dtp-sky dtp-sky-glass" aria-hidden="true" />

        {/* Layer 2: 4 concentric stepped atmospheric halos tracking orb */}
        <span className="dtp-rings" aria-hidden="true">
          <i />
        </span>

        {/* Layer 3: Dual-layer drifting clouds (Light mode) */}
        <span className="dtp-clouds" aria-hidden="true">
          <i className="dtp-cloud-back" />
          <i className="dtp-cloud-front" />
        </span>

        {/* Layer 4: Full-width starfield + twinkling 4-point sparkles (Dark mode) */}
        <span className="dtp-stars" aria-hidden="true">
          <i className="dtp-star-a" />
          <i className="dtp-star-b" />
          <i className="dtp-star-c" />
          <i className="dtp-star-d" />
        </span>

        {/* Layer 5: Prism glass ribbon + 6 floating 3D liquid droplets (Glass mode) */}
        <span className="dtp-glass-fx" aria-hidden="true">
          <i className="dtp-glass-ribbon" />
          <i className="dtp-gb b1" />
          <i className="dtp-gb b2" />
          <i className="dtp-gb b3" />
          <i className="dtp-gb b4" />
          <i className="dtp-gb b5" />
          <i className="dtp-gb b6" />
        </span>

        {/* Layer 6: Recessed track ambient light wash */}
        <span className="dtp-wash" aria-hidden="true">
          <i />
        </span>

        {/* Layer 7: Orbiting incandescent LED strip arc (halo + core) */}
        <span className="dtp-led-wrap" aria-hidden="true">
          <i className="dtp-led-halo" />
          <i className="dtp-led-core" />
        </span>

        {/* Layer 8-10: 3D physical orb (Sun / 3-Crater Moon / Crystal Glass + TIR + 0.8px Specular Rim) */}
        <span className="dtp-orb" data-dtp-orb="" aria-hidden="true">
          <i className="dtp-face dtp-face-sun" />
          <i className="dtp-face dtp-face-moon">
            <b className="dtp-crater c1" />
            <b className="dtp-crater c2" />
            <b className="dtp-crater c3" />
          </i>
          <i className="dtp-face dtp-face-glass">
            <b className="dtp-glass-glint" />
            <b className="dtp-glass-caustic" />
          </i>
          <i className="dtp-orb-tir" />
          <i className="dtp-orb-rim" />
        </span>

        {/* Layer 11a: Top optical recessed inner bevel & reflected bottom lip */}
        <span className="dtp-bevel" aria-hidden="true" />

        {/* Layer 11b: Three accessible hit segments */}
        <div className="dtp-hits">
          {MODES.map((m, idx) => {
            const checked = mode === m;
            return (
              <button
                key={m}
                ref={(el) => {
                  hitRefs.current[idx] = el;
                }}
                type="button"
                role="radio"
                className="dtp-hit"
                data-dock-theme={m}
                aria-label={resolvedLabels[m]}
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                disabled={disabled}
                title={resolvedLabels[m]}
                onClick={() => handleHitClick(m)}
                onKeyDown={(ev) => handleRadioKeyDown(ev, idx)}
              />
            );
          })}
        </div>
      </div>

      {/* Layer 11c: Aligned 3-mode labels with blue spring underline indicator */}
      {showLabels ? (
        <div className="dtp-labels">
          {MODES.map((m) => {
            const on = mode === m;
            return (
              <button
                key={m}
                type="button"
                className={`dtp-label-btn${on ? ' on' : ''}`}
                data-dock-theme={m}
                data-dtp-stop={m}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => commitMode(m)}
              >
                <span>{resolvedLabels[m]}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {disabled && disabledReason ? (
        <span className="dtp-disabled-note" role="note">
          {disabledReason}
        </span>
      ) : null}
    </div>
  );
}
