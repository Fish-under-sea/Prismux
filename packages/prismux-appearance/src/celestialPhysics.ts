import type { ThemeMode } from './types.js';
import { clampNumber } from './colorUtils.js';

export const CELESTIAL_STOPS: Readonly<Record<ThemeMode, number>> = {
  light: 0,
  dark: 0.5,
  glass: 1,
};

export const CELESTIAL_LED_ANGLES: Readonly<Record<ThemeMode, number>> = {
  light: 58,
  dark: 180,
  glass: 302,
};

/** Exact FISH-Dock spring parameters (underdamped orb, critically damped LED arc). */
export const CELESTIAL_SPRING = {
  kOrb: 135,
  zetaOrb: 0.62,
  cOrb: 2 * 0.62 * Math.sqrt(135),
  kLed: 75,
  cLed: 2 * Math.sqrt(75),
  substeps: 4,
  maxDt: 0.05,
  rubberBandDamping: 0.22,
  momentumHorizonSec: 0.14,
  releaseVelocityScale: 0.72,
  maxDragVelocity: 5.5,
  settlePosEps: 0.0005,
  settleVelEps: 0.0005,
  settleLedDegEps: 0.1,
  settleLedVelEps: 0.1,
  settleAuxEps: 0.004,
} as const;

export interface CelestialPhysicsState {
  targetMode: ThemeMode;
  p: number;
  v: number;
  ledDeg: number;
  ledV: number;
  hover: number;
  press: number;
  kick: number;
  hovered: boolean;
  pressed: boolean;
  dragging: boolean;
  dragV: number;
}

export interface CelestialPaintVars {
  p: number;
  wLight: number;
  wDark: number;
  wGlass: number;
  ledDeg: number;
  ledColor: string;
  sx: number;
  sy: number;
  lift: number;
  boost: number;
  spinSunDeg: number;
  spinMoonDeg: number;
  spinGlassDeg: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function themeModePosition(mode: ThemeMode): number {
  return CELESTIAL_STOPS[mode];
}

export function themeModeLedAngle(mode: ThemeMode): number {
  return CELESTIAL_LED_ANGLES[mode];
}

export function ledTargetAngleForPosition(p: number): number {
  return lerp(CELESTIAL_LED_ANGLES.light, CELESTIAL_LED_ANGLES.glass, clampNumber(p, 0, 1));
}

export function nearestThemeMode(p: number): ThemeMode {
  if (p < 0.25) return 'light';
  if (p < 0.75) return 'dark';
  return 'glass';
}

/**
 * Exact 3-stop RGB interpolation for the orbiting incandescent LED strip & track wash.
 * light (#ffae2e) -> dark (#6f86ff) -> glass (#5cd4ff)
 */
export function ledColorForPosition(p: number): string {
  const c0: readonly [number, number, number] = [255, 174, 46];
  const c1: readonly [number, number, number] = [111, 134, 255];
  const c2: readonly [number, number, number] = [92, 212, 255];
  const t = clampNumber(p, 0, 1);
  const [a, b, f] = t <= 0.5 ? [c0, c1, t * 2] : [c1, c2, (t - 0.5) * 2];
  return `rgb(${Math.round(lerp(a[0], b[0], f))}, ${Math.round(lerp(a[1], b[1], f))}, ${Math.round(lerp(a[2], b[2], f))})`;
}

/** Rubber-band overscroll damping outside [0, 1] (0.22 factor). */
export function applyRubberBand(rawP: number): number {
  if (rawP < 0) return rawP * CELESTIAL_SPRING.rubberBandDamping;
  if (rawP > 1) return 1 + (rawP - 1) * CELESTIAL_SPRING.rubberBandDamping;
  return rawP;
}

/** Projects dragged position forward by velocity * 0.14s to choose inertial landing stop. */
export function projectReleaseMode(p: number, dragV: number): ThemeMode {
  const projected = p + dragV * CELESTIAL_SPRING.momentumHorizonSec;
  return nearestThemeMode(projected);
}

export function createCelestialPhysicsState(mode: ThemeMode): CelestialPhysicsState {
  return {
    targetMode: mode,
    p: themeModePosition(mode),
    v: 0,
    ledDeg: themeModeLedAngle(mode),
    ledV: 0,
    hover: 0,
    press: 0,
    kick: 0,
    hovered: false,
    pressed: false,
    dragging: false,
    dragV: 0,
  };
}

export function snapCelestialPhysicsState(state: CelestialPhysicsState, mode: ThemeMode): void {
  state.targetMode = mode;
  state.p = themeModePosition(mode);
  state.v = 0;
  state.ledDeg = themeModeLedAngle(mode);
  state.ledV = 0;
  state.press = 0;
  state.kick = 0;
  state.hover = state.hovered ? 1 : 0;
  state.dragging = false;
  state.pressed = false;
  state.dragV = 0;
}

/**
 * Advances the 4-substep 2nd-order spring physics by `dtSeconds`.
 * Returns `true` when the system has completely settled (so rAF stops at 0% CPU).
 */
export function stepCelestialPhysics(
  state: CelestialPhysicsState,
  dtSeconds: number,
  reducedMotion = false,
): boolean {
  if (reducedMotion && !state.dragging) {
    snapCelestialPhysicsState(state, state.targetMode);
    return true;
  }

  const dt = clampNumber(dtSeconds, 0.001, CELESTIAL_SPRING.maxDt);
  const targetP = themeModePosition(state.targetMode);
  const targetLed = state.dragging
    ? ledTargetAngleForPosition(state.p)
    : themeModeLedAngle(state.targetMode);

  const sub = CELESTIAL_SPRING.substeps;
  const sdt = dt / sub;
  const { kOrb, cOrb, kLed, cLed } = CELESTIAL_SPRING;

  for (let i = 0; i < sub; i++) {
    if (!state.dragging) {
      const a = -kOrb * (state.p - targetP) - cOrb * state.v;
      state.v += a * sdt;
      state.p += state.v * sdt;
    } else {
      state.v += (state.dragV - state.v) * Math.min(1, sdt * 24);
    }
    const aLed = -kLed * (state.ledDeg - targetLed) - cLed * state.ledV;
    state.ledV += aLed * sdt;
    state.ledDeg += state.ledV * sdt;
  }

  const rate = Math.min(1, dt * 16);
  const hoverTarget = state.hovered ? 1 : 0;
  const pressTarget = state.pressed ? 1 : 0;
  state.hover += (hoverTarget - state.hover) * rate;
  state.press += (pressTarget - state.press) * rate;
  state.kick *= Math.pow(0.04, dt);

  const settled =
    !state.dragging &&
    !state.pressed &&
    Math.abs(state.p - targetP) < CELESTIAL_SPRING.settlePosEps &&
    Math.abs(state.v) < CELESTIAL_SPRING.settleVelEps &&
    Math.abs(state.ledDeg - targetLed) < CELESTIAL_SPRING.settleLedDegEps &&
    Math.abs(state.ledV) < CELESTIAL_SPRING.settleLedVelEps &&
    Math.abs(state.hover - hoverTarget) < CELESTIAL_SPRING.settleAuxEps &&
    state.press < CELESTIAL_SPRING.settleAuxEps &&
    state.kick < CELESTIAL_SPRING.settleAuxEps;

  if (settled) {
    state.p = targetP;
    state.v = 0;
    state.ledDeg = targetLed;
    state.ledV = 0;
    state.press = 0;
    state.kick = 0;
    state.hover = hoverTarget;
  }

  return settled;
}

/** Computes exact CSS custom property values for the 11 optical capsule layers. */
export function computeCelestialPaintVars(state: CelestialPhysicsState): CelestialPaintVars {
  const cp = clampNumber(state.p, -0.06, 1.06);
  const wLight = clampNumber(1 - cp * 2, 0, 1);
  const wDark = clampNumber(1 - Math.abs(cp - 0.5) * 2, 0, 1);
  const wGlass = clampNumber((cp - 0.5) * 2, 0, 1);
  const over = state.p < 0 ? -state.p : state.p > 1 ? state.p - 1 : 0;
  const stretch = Math.min(Math.abs(state.v) * 0.085, 0.16);
  const pScale = 1 - 0.035 * state.press;
  const sx = (1 + stretch - over * 0.55) * pScale;
  const sy = (1 - stretch * 0.44 + over * 0.28) * pScale;
  const lift = state.hover * (1 - state.press);
  const boost = clampNumber(
    1 + state.hover * 0.08 + Math.min(Math.abs(state.v) * 0.14, 0.16) + state.kick,
    1,
    1.42,
  );

  return {
    p: cp,
    wLight,
    wDark,
    wGlass,
    ledDeg: state.ledDeg,
    ledColor: ledColorForPosition(cp),
    sx,
    sy,
    lift,
    boost,
    spinSunDeg: (1 - wLight) * -105,
    spinMoonDeg: (0.5 - cp) * 210,
    spinGlassDeg: (1 - wGlass) * 105,
  };
}

export function applyCelestialPaintVarsToElement(
  el: { style: { setProperty(name: string, value: string): void } },
  vars: CelestialPaintVars,
): void {
  const s = el.style;
  s.setProperty('--dtp-p', vars.p.toFixed(4));
  s.setProperty('--dtp-w-light', vars.wLight.toFixed(4));
  s.setProperty('--dtp-w-dark', vars.wDark.toFixed(4));
  s.setProperty('--dtp-w-glass', vars.wGlass.toFixed(4));
  s.setProperty('--dtp-led-deg', `${vars.ledDeg.toFixed(2)}deg`);
  s.setProperty('--dtp-led-color', vars.ledColor);
  s.setProperty('--dtp-sx', vars.sx.toFixed(4));
  s.setProperty('--dtp-sy', vars.sy.toFixed(4));
  s.setProperty('--dtp-lift', vars.lift.toFixed(4));
  s.setProperty('--dtp-boost', vars.boost.toFixed(4));
  s.setProperty('--dtp-spin-sun', `${vars.spinSunDeg.toFixed(2)}deg`);
  s.setProperty('--dtp-spin-moon', `${vars.spinMoonDeg.toFixed(2)}deg`);
  s.setProperty('--dtp-spin-glass', `${vars.spinGlassDeg.toFixed(2)}deg`);
}
