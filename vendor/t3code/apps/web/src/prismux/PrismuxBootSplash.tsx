/*
 * From Uiverse.io by dexter-st - https://uiverse.io/dexter-st/wicked-elephant-4
 * MIT License, Copyright (c) dexter-st
 * From Uiverse.io by AqFox - https://uiverse.io/AqFox/young-dragon-29
 * MIT License, Copyright (c) AqFox (Aquilix)
 */

import { useState, type CSSProperties } from "react";
import { cn } from "~/lib/utils";
import "./prismux-boot-splash.css";

export const PRISMUX_BOOT_SPLASH_ID = "pmx-boot-splash";
export const PRISMUX_BOOT_SPLASH_TEXT = "Prismux";
export const PRISMUX_BOOT_SPLASH_LETTERS = ["P", "r", "i", "s", "m", "u", "x"] as const;
export const PRISMUX_BOOT_LETTER_DELAYS_SEC = [
  0.1, 0.205, 0.31, 0.415, 0.521, 0.626, 0.731,
] as const;
export const PRISMUX_BOOT_CUBE_FACE_INDICES = [1, 2, 3, 4, 5, 6] as const;
export const PRISMUX_BOOT_SPLASH_MIN_DURATION_MS = 850;
export const PRISMUX_BOOT_SPLASH_FADE_MS = 380;
export const PRISMUX_BOOT_SPLASH_DEFAULT_PREVIEW_MS = 1800;

declare global {
  interface Window {
    __pmxBootSplashStartedAt?: number;
    __prismuxShowBootSplash?: (durationMs?: number) => () => void;
  }
}

export function resolvePrismuxLogoSrc(): string {
  if (typeof window !== "undefined" && window.location?.protocol === "file:") {
    return "./prismux-logo.png";
  }
  return "/prismux-logo.png";
}

function letterDelaySeconds(index: number): string {
  const preset = PRISMUX_BOOT_LETTER_DELAYS_SEC[index];
  if (preset !== undefined) {
    return `${preset}s`;
  }
  return `${Number((0.1 + index * 0.105).toFixed(3))}s`;
}

function PrismuxFallbackLogoSvg({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="pmx-boot-prism-grad" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <polygon
        points="32,7 57,51 7,51"
        fill="rgba(0, 77, 255, 0.18)"
        stroke="url(#pmx-boot-prism-grad)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <polygon points="32,20 45,45 19,45" fill="url(#pmx-boot-prism-grad)" opacity="0.88" />
    </svg>
  );
}

const FALLBACK_SVG_MARKUP =
  '<svg class="pmx-boot-cube-fallback" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" hidden>' +
  '<polygon points="32,7 57,51 7,51" fill="rgba(0, 77, 255, 0.18)" stroke="#60a5fa" stroke-width="4" stroke-linejoin="round" />' +
  '<polygon points="32,20 45,45 19,45" fill="#93c5fd" opacity="0.9" />' +
  "</svg>";

export interface PrismuxPrismLoaderProps {
  readonly text?: string;
  readonly className?: string;
  readonly ariaLabel?: string;
}

/**
 * Center-stage prism grating text scanner adapted from dexter-st/wicked-elephant-4 (MIT).
 * Renders pure split letters illuminated by a vertical optical grating rainbow sweep.
 */
export function PrismuxPrismLoader({
  text = PRISMUX_BOOT_SPLASH_TEXT,
  className,
  ariaLabel,
}: PrismuxPrismLoaderProps) {
  const letters = Array.from(text);
  return (
    <div
      className={cn("pmx-boot-loader-wrapper", className)}
      data-pmx-prism-loader="true"
      role="status"
      aria-label={ariaLabel ?? `${text} loading`}
    >
      {letters.map((letter, index) => (
        <span
          key={`${index}-${letter}`}
          className="pmx-boot-loader-letter"
          data-pmx-loader-letter={letter}
          style={{ animationDelay: letterDelaySeconds(index) }}
          aria-hidden="true"
        >
          {letter === " " ? "\u00A0" : letter}
        </span>
      ))}
      <div className="pmx-boot-loader-beam" data-pmx-loader-beam="true" aria-hidden="true" />
    </div>
  );
}

export interface PrismuxLogoCubeSpinnerProps {
  readonly size?: number;
  readonly logoSrc?: string;
  readonly className?: string;
  readonly ariaLabel?: string;
}

/**
 * 3D rotating translucent blue cube adapted from AqFox/young-dragon-29 (MIT)
 * with the Prismux emblem mapped onto all 6 faces and an inline prism SVG fallback.
 */
export function PrismuxLogoCubeSpinner({
  size = 44,
  logoSrc,
  className,
  ariaLabel = "Prismux loading cube",
}: PrismuxLogoCubeSpinnerProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  const resolvedLogoSrc = logoSrc ?? resolvePrismuxLogoSrc();
  const cubeStyle = {
    "--pmx-cube-size": `${size}px`,
  } as CSSProperties;

  return (
    <div
      className={cn("pmx-boot-cube", className)}
      style={cubeStyle}
      data-pmx-logo-cube="true"
      role="img"
      aria-label={ariaLabel}
    >
      {PRISMUX_BOOT_CUBE_FACE_INDICES.map((faceIndex) => (
        <div
          key={faceIndex}
          className="pmx-boot-cube-face"
          data-pmx-cube-face={String(faceIndex)}
          aria-hidden="true"
        >
          {logoFailed ? (
            <PrismuxFallbackLogoSvg className="pmx-boot-cube-fallback" />
          ) : (
            <img
              className="pmx-boot-cube-logo"
              src={resolvedLogoSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export interface PrismuxBootSplashViewProps {
  readonly text?: string;
  readonly cubeSize?: number;
  readonly logoSrc?: string;
  readonly leaving?: boolean;
  readonly className?: string;
}

/**
 * Fullscreen boot splash composition:
 * - Center stage: pure-text Prismux prism grating scanner
 * - Bottom-right corner: 6-face 3D rotating Prismux logo cube
 */
export function PrismuxBootSplashView({
  text = PRISMUX_BOOT_SPLASH_TEXT,
  cubeSize = 44,
  logoSrc,
  leaving = false,
  className,
}: PrismuxBootSplashViewProps) {
  return (
    <div
      className={cn("pmx-boot-splash-overlay", leaving && "pmx-boot-splash-leaving", className)}
      data-pmx-boot-splash="true"
      data-pmx-boot-splash-state={leaving ? "leaving" : "visible"}
    >
      <PrismuxPrismLoader text={text} />
      <div className="pmx-boot-cube-corner" data-pmx-boot-cube-corner="true">
        <PrismuxLogoCubeSpinner size={cubeSize} {...(logoSrc ? { logoSrc } : {})} />
      </div>
    </div>
  );
}

let activeDelayTimer: ReturnType<typeof setTimeout> | null = null;
let activeRemoveTimer: ReturnType<typeof setTimeout> | null = null;

function clearBootSplashTimers(): void {
  if (activeDelayTimer !== null) {
    clearTimeout(activeDelayTimer);
    activeDelayTimer = null;
  }
  if (activeRemoveTimer !== null) {
    clearTimeout(activeRemoveTimer);
    activeRemoveTimer = null;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export interface DismissBootSplashOptions {
  readonly minDisplayMs?: number;
  readonly fadeDurationMs?: number;
  readonly immediate?: boolean;
}

/**
 * Smoothly dismisses `#pmx-boot-splash` after ensuring at least one crisp beam sweep
 * (`850ms` default unless startup already took longer) and removes it cleanly from the DOM.
 */
export function dismissPrismuxBootSplash(options: DismissBootSplashOptions = {}): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }
  const splash = document.getElementById(PRISMUX_BOOT_SPLASH_ID);
  if (!splash) {
    clearBootSplashTimers();
    return Promise.resolve();
  }

  clearBootSplashTimers();

  const reduced = prefersReducedMotion();
  const minDisplayMs = options.immediate
    ? 0
    : (options.minDisplayMs ?? (reduced ? 180 : PRISMUX_BOOT_SPLASH_MIN_DURATION_MS));
  const fadeDurationMs = options.immediate
    ? 0
    : (options.fadeDurationMs ?? (reduced ? 120 : PRISMUX_BOOT_SPLASH_FADE_MS));

  const startedAt =
    typeof window !== "undefined" &&
    typeof window.__pmxBootSplashStartedAt === "number" &&
    Number.isFinite(window.__pmxBootSplashStartedAt)
      ? window.__pmxBootSplashStartedAt
      : null;
  const elapsed = startedAt !== null ? Math.max(0, nowMs() - startedAt) : minDisplayMs;
  const remainingMs = Math.max(0, Math.round(minDisplayMs - elapsed));

  return new Promise<void>((resolve) => {
    const startFadeOut = () => {
      activeDelayTimer = null;
      const current = document.getElementById(PRISMUX_BOOT_SPLASH_ID);
      if (!current) {
        resolve();
        return;
      }
      if (fadeDurationMs <= 0) {
        current.remove();
        resolve();
        return;
      }
      current.dataset.pmxBootSplashState = "leaving";
      current.classList.add("pmx-boot-splash-leaving");
      activeRemoveTimer = setTimeout(() => {
        activeRemoveTimer = null;
        current.remove();
        resolve();
      }, fadeDurationMs);
    };

    if (remainingMs <= 0) {
      startFadeOut();
    } else {
      activeDelayTimer = setTimeout(startFadeOut, remainingMs);
    }
  });
}

function buildBootSplashElement(logoSrc: string): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = PRISMUX_BOOT_SPLASH_ID;
  overlay.className = "pmx-boot-splash-overlay";
  overlay.dataset.pmxBootSplash = "true";
  overlay.dataset.pmxBootSplashState = "visible";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-label", "Prismux loading");

  const lettersHtml = PRISMUX_BOOT_SPLASH_LETTERS.map(
    (letter, index) =>
      `<span class="pmx-boot-loader-letter" data-pmx-loader-letter="${letter}" style="animation-delay:${letterDelaySeconds(index)}" aria-hidden="true">${letter}</span>`,
  ).join("");

  const escapedSrc = logoSrc.replaceAll('"', "&quot;");
  const facesHtml = PRISMUX_BOOT_CUBE_FACE_INDICES.map(
    (faceIndex) =>
      `<div class="pmx-boot-cube-face" data-pmx-cube-face="${faceIndex}" aria-hidden="true">` +
      `<img class="pmx-boot-cube-logo" src="${escapedSrc}" alt="" aria-hidden="true" draggable="false" />` +
      FALLBACK_SVG_MARKUP +
      `</div>`,
  ).join("");

  overlay.innerHTML =
    `<div class="pmx-boot-loader-wrapper" data-pmx-prism-loader="true">` +
    lettersHtml +
    `<div class="pmx-boot-loader-beam" data-pmx-loader-beam="true" aria-hidden="true"></div>` +
    `</div>` +
    `<div class="pmx-boot-cube-corner" data-pmx-boot-cube-corner="true">` +
    `<div class="pmx-boot-cube" data-pmx-logo-cube="true" role="img" aria-label="Prismux loading cube">` +
    facesHtml +
    `</div>` +
    `</div>`;

  overlay.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) || !target.classList.contains("pmx-boot-cube-logo")) {
        return;
      }
      target.style.display = "none";
      const fallback = target.nextElementSibling;
      if (fallback instanceof Element) {
        fallback.removeAttribute("hidden");
      }
    },
    true,
  );

  return overlay;
}

/**
 * Replays the fullscreen Prismux boot splash for inspection or live verification
 * (`window.__prismuxShowBootSplash(durationMs)`). Pass `0` or `Infinity` to hold until dismissed.
 */
export function showPrismuxBootSplashPreview(
  durationMs: number = PRISMUX_BOOT_SPLASH_DEFAULT_PREVIEW_MS,
): () => void {
  if (typeof document === "undefined" || !document.body) {
    return () => {};
  }
  clearBootSplashTimers();
  document.getElementById(PRISMUX_BOOT_SPLASH_ID)?.remove();

  const overlay = buildBootSplashElement(resolvePrismuxLogoSrc());
  if (typeof window !== "undefined") {
    window.__pmxBootSplashStartedAt = nowMs();
  }
  document.body.appendChild(overlay);

  if (Number.isFinite(durationMs) && durationMs > 0) {
    void dismissPrismuxBootSplash({ minDisplayMs: durationMs });
  }

  return () => {
    void dismissPrismuxBootSplash({ immediate: true });
  };
}

/**
 * Installs the verification preview hook on `window` and schedules smooth dismissal of the
 * cold-start `#pmx-boot-splash` right after React mounts its first frame.
 */
export function installPrismuxBootSplashLifecycle(): void {
  if (typeof window !== "undefined") {
    window.__prismuxShowBootSplash = showPrismuxBootSplashPreview;
  }
  const scheduleDismiss = () => {
    void dismissPrismuxBootSplash();
  };
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      scheduleDismiss();
    });
  } else {
    scheduleDismiss();
  }
}
