import { useId, useRef, type KeyboardEvent } from "react";
import type { AppearanceThemeMode } from "@prismux/protocol";

export interface CelestialThemeCapsuleProps {
  mode: AppearanceThemeMode;
  onChange: (mode: AppearanceThemeMode) => void;
}

const MODE_OPTIONS: ReadonlyArray<{
  value: AppearanceThemeMode;
  label: string;
}> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "liquid-glass", label: "玻璃" }
];

export function CelestialThemeCapsule({
  mode,
  onChange
}: CelestialThemeCapsuleProps) {
  const moonGlowId = useId();
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([null, null, null]);
  const activeIndex = Math.max(
    0,
    MODE_OPTIONS.findIndex((item) => item.value === mode)
  );

  const selectByIndex = (index: number, moveFocus: boolean): void => {
    const safeIndex =
      ((index % MODE_OPTIONS.length) + MODE_OPTIONS.length) %
      MODE_OPTIONS.length;
    const option = MODE_OPTIONS[safeIndex];
    if (!option) {
      return;
    }
    onChange(option.value);
    if (moveFocus) {
      radioRefs.current[safeIndex]?.focus();
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectByIndex(index + 1, true);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectByIndex(index - 1, true);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectByIndex(0, true);
    } else if (event.key === "End") {
      event.preventDefault();
      selectByIndex(MODE_OPTIONS.length - 1, true);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      selectByIndex(index, false);
    }
  };

  return (
    <div
      className="prismux-celestial-wrap"
      role="radiogroup"
      aria-label="外观模式切换（浅色、深色、液态玻璃）"
    >
      {/* Inline SVG Displacement Filter for 360° Fresnel Liquid Glass Rim */}
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      >
        <defs>
          <filter
            id="prismux-fresnel-refract"
            x="-5%"
            y="-5%"
            width="110%"
            height="110%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.018"
              numOctaves="2"
              seed="7"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="4"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* Recessed Full-Width Rounded Track */}
      <div className="prismux-celestial-track" data-mode={mode}>
        {/* Scenery Layer inside Track */}
        <svg
          className="prismux-celestial-scenery"
          viewBox="0 0 360 56"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {mode === "light" && (
            <g className="prismux-cloud-drift">
              <ellipse
                cx="64"
                cy="34"
                rx="38"
                ry="12"
                fill="rgba(255, 255, 255, 0.56)"
              />
              <circle
                cx="50"
                cy="28"
                r="13"
                fill="rgba(255, 255, 255, 0.72)"
              />
              <circle
                cx="72"
                cy="26"
                r="11"
                fill="rgba(255, 255, 255, 0.68)"
              />
              <ellipse
                cx="260"
                cy="38"
                rx="46"
                ry="11"
                fill="rgba(255, 255, 255, 0.42)"
              />
              <circle
                cx="248"
                cy="32"
                r="11"
                fill="rgba(255, 255, 255, 0.48)"
              />
              <circle
                cx="272"
                cy="33"
                r="9"
                fill="rgba(255, 255, 255, 0.44)"
              />
            </g>
          )}

          {mode === "dark" && (
            <g>
              {/* Concentric Atmospheric Halo Rings */}
              <circle
                cx="180"
                cy="28"
                r="26"
                fill="none"
                stroke="rgba(108, 182, 255, 0.24)"
                strokeWidth="1"
              />
              <circle
                cx="180"
                cy="28"
                r="38"
                fill="none"
                stroke="rgba(108, 182, 255, 0.14)"
                strokeWidth="1"
              />
              <circle
                cx="180"
                cy="28"
                r="52"
                fill="none"
                stroke="rgba(108, 182, 255, 0.08)"
                strokeWidth="1"
              />
              {/* Four-Pointed Sparkle Stars (✦) & Pinpoint Stars */}
              <path
                className="prismux-star-twinkle"
                d="M54 11 L55.4 15.6 L60 17 L55.4 18.4 L54 23 L52.6 18.4 L48 17 L52.6 15.6 Z"
                fill="#cfe6ff"
              />
              <path
                className="prismux-star-twinkle"
                d="M116 32 L117.1 35.9 L121 37 L117.1 38.1 L116 42 L114.9 38.1 L111 37 L114.9 35.9 Z"
                fill="#93c5fd"
              />
              <path
                className="prismux-star-twinkle"
                d="M254 12 L255.3 16.2 L259.5 17.5 L255.3 18.8 L254 23 L252.7 18.8 L248.5 17.5 L252.7 16.2 Z"
                fill="#e0f2fe"
              />
              <path
                d="M312 31 L312.9 34.1 L316 35 L312.9 35.9 L312 39 L311.1 35.9 L308 35 L311.1 34.1 Z"
                fill="#6cb6ff"
                opacity="0.85"
              />
              <circle cx="28" cy="36" r="1.2" fill="#e2e8f0" opacity="0.7" />
              <circle cx="88" cy="18" r="1" fill="#93c5fd" opacity="0.8" />
              <circle cx="136" cy="14" r="1.3" fill="#e0f2fe" opacity="0.65" />
              <circle cx="228" cy="38" r="1.2" fill="#93c5fd" opacity="0.7" />
              <circle cx="292" cy="16" r="1.1" fill="#e2e8f0" opacity="0.6" />
              <circle cx="336" cy="22" r="1.4" fill="#bae6fd" opacity="0.75" />
            </g>
          )}

          {mode === "liquid-glass" && (
            <g>
              <ellipse
                cx="95"
                cy="18"
                rx="54"
                ry="16"
                fill="rgba(108, 182, 255, 0.16)"
              />
              <ellipse
                cx="260"
                cy="36"
                rx="62"
                ry="18"
                fill="rgba(56, 189, 248, 0.18)"
              />
              <path
                d="M42 46 Q 120 12 204 34 T 338 14"
                fill="none"
                stroke="rgba(186, 230, 253, 0.28)"
                strokeWidth="1.2"
              />
              <circle cx="62" cy="24" r="2.2" fill="rgba(224, 242, 254, 0.7)" />
              <circle cx="164" cy="18" r="1.6" fill="rgba(147, 197, 253, 0.6)" />
              <circle cx="218" cy="38" r="1.8" fill="rgba(186, 230, 253, 0.65)" />
            </g>
          )}
        </svg>

        {/* Track Thirds Click Zones */}
        <div className="prismux-celestial-hitgrid" aria-hidden="true">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              tabIndex={-1}
              className="prismux-celestial-hit"
              onClick={() => onChange(opt.value)}
            />
          ))}
        </div>

        {/* Physics-Spring Sliding 3D Celestial Sphere */}
        <div
          className="prismux-celestial-thumb-slot"
          style={{
            transform: `translateX(${activeIndex * 100}%)`
          }}
          aria-hidden="true"
        >
          <div className="prismux-celestial-thumb" data-mode={mode}>
            {mode === "light" && (
              <svg width="36" height="36" viewBox="0 0 36 36">
                <circle
                  cx="13"
                  cy="12"
                  r="5"
                  fill="rgba(255, 255, 255, 0.52)"
                />
              </svg>
            )}

            {mode === "dark" && (
              <svg width="44" height="44" viewBox="0 0 44 44">
                <defs>
                  <radialGradient id={moonGlowId} cx="50%" cy="50%" r="50%">
                    <stop offset="68%" stopColor="rgba(108, 182, 255, 0)" />
                    <stop offset="100%" stopColor="rgba(108, 182, 255, 0.42)" />
                  </radialGradient>
                </defs>
                <circle cx="22" cy="22" r="21" fill={`url(#${moonGlowId})`} />
                {/* Sculpted Lunar Craters */}
                <ellipse
                  cx="15"
                  cy="16"
                  rx="4.2"
                  ry="3.6"
                  fill="rgba(82, 102, 136, 0.42)"
                  stroke="rgba(255, 255, 255, 0.35)"
                  strokeWidth="0.6"
                />
                <circle
                  cx="28"
                  cy="24"
                  r="5.2"
                  fill="rgba(72, 92, 126, 0.38)"
                  stroke="rgba(255, 255, 255, 0.25)"
                  strokeWidth="0.6"
                />
                <circle
                  cx="19"
                  cy="30"
                  r="2.6"
                  fill="rgba(78, 98, 132, 0.44)"
                />
                <circle
                  cx="26"
                  cy="12"
                  r="2.1"
                  fill="rgba(90, 112, 148, 0.36)"
                />
              </svg>
            )}

            {mode === "liquid-glass" && (
              <svg
                width="44"
                height="44"
                viewBox="0 0 44 44"
                className="prismux-fresnel-refract-ring"
              >
                {/* 360° Fresnel Edge & Internal Optical Refraction Arc */}
                <circle
                  cx="22"
                  cy="22"
                  r="19.5"
                  fill="none"
                  stroke="rgba(224, 242, 254, 0.72)"
                  strokeWidth="1.2"
                />
                <path
                  d="M11 26 C 14 14, 28 11, 33 17"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.75)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M14 31 C 21 35, 30 31, 33 24"
                  fill="none"
                  stroke="rgba(108, 182, 255, 0.72)"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <circle cx="14" cy="14" r="2.2" fill="rgba(255, 255, 255, 0.85)" />
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* Equal-Thirds Bottom Labels + Centered 2-3px Blue Glow Bar */}
      <div className="prismux-celestial-labels">
        {MODE_OPTIONS.map((opt, idx) => {
          const checked = opt.value === mode;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                radioRefs.current[idx] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="prismux-celestial-radio"
              onClick={() => onChange(opt.value)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
            >
              <span>{opt.label}</span>
              <span className="prismux-celestial-indicator" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
