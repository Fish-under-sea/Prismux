import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties } from "react";
import type { WallpaperStore } from "./store.js";
import {
  findWallpaperById,
  isAdvancedWallpaperType,
  isWallpaperGatedByEngine,
  normalizeWallpaperFadeOpacity,
  normalizeWallpaperScrim,
  useWallpaperStore,
} from "./store.js";
import type {
  BuiltinScenePresetId,
  ObjectFitMode,
  ThemeMode,
  UserPropDef,
  WallpaperItem,
  WallpaperSettingsState,
} from "./types.js";
import { applyUserPropOverrides, weColorToHex } from "./userProps.js";
import { consumePrewarmedVideo } from "./videoPrewarm.js";

export interface WallpaperStageProps {
  store: WallpaperStore;
  /** External occlusion signal (window minimized / occluded / screen locked). Forces 0 FPS and pauses video immediately. */
  occluded?: boolean;
  /** Optional real-time audio energy scalar (0..1) or frequency bands array (0..1[]). */
  audioEnergy?: number | number[];
  /** Optional explicit web/scene runtime iframe URL resolver for Steam workshop items. */
  resolveLiveRuntimeUrl?: (
    wallpaper: WallpaperItem,
    settings: WallpaperSettingsState,
  ) => string | null;
  /** Optional recovery hook invoked when video/image media stalls or errors (e.g. daemon restart or token rotation). */
  onRequestMediaRefresh?: (
    wallpaper: WallpaperItem,
    reason: string,
  ) => Promise<string | null | void> | string | null | void;
  /** Optional host occlusion sync hook invoked when a visible/focused window still sees a stale external occluded=true flag. */
  onRequestOcclusionSync?: () => Promise<boolean | void> | boolean | void;
  className?: string;
}

// ── 4 Built-in High-Aesthetic WebWallGL Shaders (WebGL2 + Canvas 2D Fallback) ──

const VERTEX_SHADER_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec3 u_audio;
uniform float u_theme;
uniform float u_scene;
uniform float u_speed;
uniform float u_intensity;
uniform vec3 u_tint;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    value += amp * noise(p);
    p = rot * p * 2.04 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return value;
}

void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 uv = (v_uv - 0.5) * aspect;
  vec2 parallax = (u_mouse - 0.5) * 0.14;
  vec2 p = uv + parallax;

  float t = u_time * (0.14 * max(0.1, u_speed) + u_audio.x * 0.08);
  float q = fbm(p * 1.85 + vec2(t * 0.34, -t * 0.21));
  float r = fbm(p * 2.55 + vec2(q * 1.4 - t * 0.19, q * 0.92 + t * 0.29));
  float ribbon = smoothstep(0.24, 0.84, fbm(p * 1.45 + vec2(r, q) + u_scene * 0.77));

  float waveBand = exp(-abs(p.y + 0.13 * sin(p.x * 3.1 + t + u_scene * 1.3) + (r - 0.5) * 0.38) * (4.6 - u_audio.y * 1.4));
  float caustic = pow(max(0.0, 1.0 - abs(sin((p.x + r * 0.65) * 5.2 - t * 1.15))), 4.0);

  vec3 col;

  if (u_scene < 0.5) {
    // Scene 0: Aurora Prism (极光棱镜)
    vec3 base = u_theme < 0.5 ? vec3(0.91, 0.95, 0.99) : vec3(0.052, 0.095, 0.195);
    vec3 mid = u_theme < 0.5 ? vec3(0.75, 0.86, 0.99) : vec3(0.115, 0.265, 0.495);
    vec3 glow = mix(vec3(0.36, 0.78, 1.0), u_tint, 0.35);
    col = mix(base, mid, ribbon * 0.88);
    col += glow * waveBand * (0.62 + u_audio.x * 0.32) * u_intensity;
    col += vec3(0.72, 0.90, 1.0) * caustic * (0.22 + u_audio.z * 0.20) * u_intensity;
  } else if (u_scene < 1.5) {
    // Scene 1: Midnight Abyss (午夜深海)
    vec3 base = u_theme < 0.5 ? vec3(0.88, 0.96, 0.97) : vec3(0.025, 0.098, 0.155);
    vec3 mid = u_theme < 0.5 ? vec3(0.64, 0.87, 0.90) : vec3(0.065, 0.265, 0.385);
    vec3 bio = mix(vec3(0.18, 0.92, 0.82), u_tint, 0.30);
    float rays = exp(-abs(p.x * 0.7 + p.y * 0.45 + (q - 0.5) * 0.6) * 3.2);
    col = mix(base, mid, ribbon * 0.90);
    col += bio * (waveBand * 0.52 + rays * 0.34 + u_audio.y * 0.18) * u_intensity;
    col += vec3(0.48, 0.96, 0.90) * caustic * (0.24 + u_audio.z * 0.22) * u_intensity;
  } else if (u_scene < 2.5) {
    // Scene 2: Liquid Silk (液态绸光)
    vec3 base = u_theme < 0.5 ? vec3(0.93, 0.93, 0.99) : vec3(0.092, 0.098, 0.225);
    vec3 mid = u_theme < 0.5 ? vec3(0.81, 0.82, 0.98) : vec3(0.225, 0.245, 0.525);
    vec3 pearl = mix(vec3(0.78, 0.75, 1.0), u_tint, 0.32);
    float fold = pow(max(0.0, sin((p.x * 2.4 + p.y * 1.9 + r * 1.8) * 2.2 - t * 0.9)), 3.0);
    col = mix(base, mid, ribbon * 0.85);
    col += pearl * (fold * 0.52 + waveBand * 0.36) * u_intensity;
    col += vec3(0.60, 0.85, 1.0) * caustic * 0.20 * u_intensity;
  } else {
    // Scene 3: Cyber Twilight (赛博暮光)
    vec3 base = u_theme < 0.5 ? vec3(0.97, 0.92, 0.96) : vec3(0.115, 0.062, 0.205);
    vec3 mid = u_theme < 0.5 ? vec3(0.93, 0.78, 0.88) : vec3(0.325, 0.135, 0.445);
    vec3 horizon = mix(vec3(1.0, 0.56, 0.40), u_tint, 0.28);
    vec3 magenta = vec3(0.96, 0.36, 0.70);
    float dusk = exp(-abs(p.y + 0.18 - (q - 0.5) * 0.25) * 3.8);
    col = mix(base, mid, ribbon * 0.88);
    col += horizon * dusk * (0.64 + u_audio.x * 0.28) * u_intensity;
    col += magenta * waveBand * (0.42 + u_audio.y * 0.24) * u_intensity;
    col += vec3(1.0, 0.84, 0.68) * caustic * 0.16 * u_intensity;
  }

  // Subtle star shimmer on dark/glass themes
  if (u_theme >= 0.5) {
    vec2 starGrid = floor((v_uv + parallax * 0.42) * vec2(128.0, 76.0));
    float seed = hash21(starGrid);
    if (seed > 0.989) {
      float twinkle = 0.5 + 0.5 * sin(u_time * 1.8 + seed * 42.0);
      col += vec3(0.75, 0.88, 1.0) * twinkle * 0.45 * u_intensity;
    }
  }

  float dither = (hash21(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;
  outColor = vec4(clamp(col + dither, 0.0, 1.0), 1.0);
}
`;

function presetToSceneIndex(preset: BuiltinScenePresetId | undefined, seedId: string): number {
  const key = (preset ?? seedId).toLowerCase();
  if (key.includes("aurora")) return 0;
  if (key.includes("midnight") || key.includes("abyss") || key.includes("tide")) return 1;
  if (key.includes("silk") || key.includes("liquid")) return 2;
  if (key.includes("twilight") || key.includes("dusk") || key.includes("cyber")) return 3;
  let hash = 0;
  for (let i = 0; i < seedId.length; i++) {
    hash = (hash * 31 + seedId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 4;
}

function hexToRgbFloat(hex: string): [number, number, number] {
  const clean = weColorToHex(hex, "#38bdf8").slice(1);
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

function normalizeAudioTriple(
  audioReactive: boolean,
  energy: number | number[],
): [number, number, number] {
  if (!audioReactive) return [0, 0, 0];
  if (typeof energy === "number") {
    const v = Math.max(0, Math.min(1, Number.isFinite(energy) ? energy : 0));
    return [v, v * 0.85, v * 0.7];
  }
  if (!Array.isArray(energy) || energy.length === 0) return [0, 0, 0];
  const low = Math.max(0, Math.min(1, energy[0] ?? 0));
  const mid = Math.max(0, Math.min(1, energy[Math.floor(energy.length / 2)] ?? low));
  const high = Math.max(0, Math.min(1, energy[energy.length - 1] ?? mid));
  return [low, mid, high];
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface WebWallGLStageProps {
  sceneIndex: number;
  themeMode: ThemeMode;
  paused: boolean;
  fpsLimit: number;
  audioReactive: boolean;
  audioEnergy: number | number[];
  speed: number;
  intensity: number;
  tintHex: string;
  parallaxEnabled: boolean;
}

function WebWallGLStageCanvas({
  sceneIndex,
  themeMode,
  paused,
  fpsLimit,
  audioReactive,
  audioEnergy,
  speed,
  intensity,
  tintHex,
  parallaxEnabled,
}: WebWallGLStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef({
    sceneIndex,
    themeMode,
    paused,
    fpsLimit,
    audioReactive,
    audioEnergy,
    speed,
    intensity,
    tintHex,
    parallaxEnabled,
    mouseX: 0.5,
    mouseY: 0.5,
    targetMouseX: 0.5,
    targetMouseY: 0.5,
  });

  const controllerRef = useRef<{
    start: () => void;
    stop: () => void;
    paintCurrent: () => void;
  } | null>(null);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to window pointermove for WebGL2/Canvas2D shader parallax
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (liveRef.current.paused || !liveRef.current.parallaxEnabled) return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      liveRef.current.targetMouseX = Math.max(0, Math.min(1, e.clientX / w));
      liveRef.current.targetMouseY = Math.max(0, Math.min(1, 1 - e.clientY / h));
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  // Mount-only WebGL2 / Canvas2D initialization: shader program & u_time survive pause/occlusion cycles cleanly.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- owns imperative WebGL2/Canvas2D context, ResizeObserver, and rAF loop until unmount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId: number | null = null;
    let disposed = false;
    let contextLost = false;
    let lastFrameTs = 0;
    let elapsedSec = 0;

    let gl: WebGL2RenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let posBuffer: WebGLBuffer | null = null;
    let uResolution: WebGLUniformLocation | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let uMouse: WebGLUniformLocation | null = null;
    let uAudio: WebGLUniformLocation | null = null;
    let uTheme: WebGLUniformLocation | null = null;
    let uScene: WebGLUniformLocation | null = null;
    let uSpeed: WebGLUniformLocation | null = null;
    let uIntensity: WebGLUniformLocation | null = null;
    let uTint: WebGLUniformLocation | null = null;

    const initWebGLResources = (): boolean => {
      if (!gl) {
        try {
          gl = canvas.getContext("webgl2", {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: "low-power",
          });
        } catch {
          gl = null;
        }
      }
      program = null;
      posBuffer = null;
      if (!gl || (typeof gl.isContextLost === "function" && gl.isContextLost())) {
        return false;
      }
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
      if (vs && fs) {
        const prog = gl.createProgram();
        if (prog) {
          gl.attachShader(prog, vs);
          gl.attachShader(prog, fs);
          gl.linkProgram(prog);
          if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            program = prog;
            posBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
              gl.STATIC_DRAW,
            );
            const aPos = gl.getAttribLocation(prog, "a_pos");
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

            uResolution = gl.getUniformLocation(prog, "u_resolution");
            uTime = gl.getUniformLocation(prog, "u_time");
            uMouse = gl.getUniformLocation(prog, "u_mouse");
            uAudio = gl.getUniformLocation(prog, "u_audio");
            uTheme = gl.getUniformLocation(prog, "u_theme");
            uScene = gl.getUniformLocation(prog, "u_scene");
            uSpeed = gl.getUniformLocation(prog, "u_speed");
            uIntensity = gl.getUniformLocation(prog, "u_intensity");
            uTint = gl.getUniformLocation(prog, "u_tint");
            canvas.dataset.pmxWebwallglBackend = "webgl2";
          } else {
            gl.deleteProgram(prog);
          }
        }
      }
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return program !== null;
    };

    initWebGLResources();

    const ctx2d = !program ? canvas.getContext("2d") : null;
    if (!program) {
      canvas.dataset.pmxWebwallglBackend = "canvas2d";
    }

    const syncSize = (measuredW?: number, measuredH?: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let cssW = measuredW ?? 0;
      let cssH = measuredH ?? 0;
      if (cssW <= 0 || cssH <= 0) {
        const rect = canvas.getBoundingClientRect();
        cssW = rect.width || window.innerWidth || 1280;
        cssH = rect.height || window.innerHeight || 720;
      }
      const targetW = Math.max(1, Math.floor(cssW * dpr));
      const targetH = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    const draw2d = (t: number) => {
      if (!ctx2d) return;
      const snap = liveRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const [bass, mid] = normalizeAudioTriple(snap.audioReactive, snap.audioEnergy);

      const palettes: Array<[string, string, string]> = [
        ["#071124", "#13356b", "#38bdf8"],
        ["#04131e", "#0b2f44", "#2dd4bf"],
        ["#12142b", "#2a2e68", "#a5b4fc"],
        ["#150c26", "#3d1854", "#fb923c"],
      ];
      const lightPalettes: Array<[string, string, string]> = [
        ["#ebf4ff", "#d4e7fe", "#60a5fa"],
        ["#e7f7f7", "#c7ebee", "#2dd4bf"],
        ["#f1effe", "#dde1ff", "#818cf8"],
        ["#fdf2f7", "#f6d9e8", "#f472b6"],
      ];
      const set = snap.themeMode === "light" ? lightPalettes : palettes;
      const pal = set[snap.sceneIndex % set.length]!;

      const grad = ctx2d.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, pal[0]);
      grad.addColorStop(0.55, pal[1]);
      grad.addColorStop(1, pal[0]);
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, 0, w, h);

      const cx = w * (0.48 + (snap.mouseX - 0.5) * 0.14 + Math.sin(t * 0.28 * snap.speed) * 0.08);
      const cy = h * (0.44 + (0.5 - snap.mouseY) * 0.12 + Math.cos(t * 0.24 * snap.speed) * 0.06);
      const radius = Math.max(w, h) * (0.42 + bass * 0.08 + mid * 0.04);
      const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, radius);
      glow.addColorStop(0, pal[2]);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx2d.globalAlpha = Math.min(0.85, 0.34 * snap.intensity);
      ctx2d.fillStyle = glow;
      ctx2d.fillRect(0, 0, w, h);
      ctx2d.globalAlpha = 1;
    };

    const paintOnce = (t: number) => {
      const snap = liveRef.current;
      if (
        !contextLost &&
        gl &&
        program &&
        (typeof gl.isContextLost !== "function" || !gl.isContextLost())
      ) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        const activateProgram = gl.useProgram.bind(gl);
        activateProgram(program);
        gl.uniform2f(uResolution, canvas.width, canvas.height);
        gl.uniform1f(uTime, t);
        gl.uniform2f(uMouse, snap.mouseX, snap.mouseY);
        const [bass, mid, high] = normalizeAudioTriple(snap.audioReactive, snap.audioEnergy);
        gl.uniform3f(uAudio, bass, mid, high);
        gl.uniform1f(uTheme, snap.themeMode === "light" ? 0 : snap.themeMode === "dark" ? 1 : 2);
        gl.uniform1f(uScene, snap.sceneIndex);
        gl.uniform1f(uSpeed, snap.speed);
        gl.uniform1f(uIntensity, snap.intensity);
        const [tr, tg, tb] = hexToRgbFloat(snap.tintHex);
        gl.uniform3f(uTint, tr, tg, tb);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (!contextLost) {
        draw2d(t);
      }
    };

    const tick = (ts: number) => {
      if (disposed || contextLost || liveRef.current.paused) {
        rafId = null;
        return;
      }
      const snap = liveRef.current;
      const minInterval = 1000 / Math.max(1, snap.fpsLimit || 30);
      if (lastFrameTs === 0 || ts - lastFrameTs >= minInterval) {
        const dt = lastFrameTs === 0 ? 0.016 : Math.min(0.1, (ts - lastFrameTs) / 1000);
        lastFrameTs = ts;
        elapsedSec += dt;
        snap.mouseX += (snap.targetMouseX - snap.mouseX) * 0.08;
        snap.mouseY += (snap.targetMouseY - snap.mouseY) * 0.08;
        paintOnce(elapsedSec);
      }
      rafId = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      // Reset timestamp reference so resuming after pause has zero dt jump while preserving elapsedSec
      lastFrameTs = 0;
    };

    const start = () => {
      if (disposed || contextLost || liveRef.current.paused || rafId !== null) return;
      lastFrameTs = 0;
      rafId = requestAnimationFrame(tick);
    };

    const paintCurrent = () => {
      if (!disposed) paintOnce(elapsedSec);
    };

    controllerRef.current = { start, stop, paintCurrent };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      stop();
    };
    const handleContextRestored = () => {
      if (disposed) return;
      contextLost = false;
      initWebGLResources();
      syncSize();
      paintOnce(elapsedSec);
      if (!liveRef.current.paused) {
        start();
      }
    };
    const handleWakeRepaint = () => {
      if (disposed || (typeof document !== "undefined" && document.hidden)) return;
      syncSize();
      paintOnce(elapsedSec);
      if (!liveRef.current.paused) {
        start();
      }
    };

    canvas.addEventListener("webglcontextlost", handleContextLost);
    canvas.addEventListener("webglcontextrestored", handleContextRestored);
    document.addEventListener("visibilitychange", handleWakeRepaint);
    window.addEventListener("focus", handleWakeRepaint);
    window.addEventListener("pageshow", handleWakeRepaint);

    // Always size once at mount and paint initial frame even if starting paused so stage is never blank
    syncSize();
    paintOnce(elapsedSec);
    if (!liveRef.current.paused) {
      start();
    }

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            syncSize(rect?.width, rect?.height);
            paintOnce(elapsedSec);
          })
        : null;
    ro?.observe(canvas);
    const onFallbackResize = () => {
      syncSize();
      paintOnce(elapsedSec);
    };
    if (!ro) {
      window.addEventListener("resize", onFallbackResize, { passive: true });
    }

    return () => {
      disposed = true;
      stop();
      controllerRef.current = null;
      canvas.removeEventListener("webglcontextlost", handleContextLost);
      canvas.removeEventListener("webglcontextrestored", handleContextRestored);
      document.removeEventListener("visibilitychange", handleWakeRepaint);
      window.removeEventListener("focus", handleWakeRepaint);
      window.removeEventListener("pageshow", handleWakeRepaint);
      ro?.disconnect();
      if (!ro) {
        window.removeEventListener("resize", onFallbackResize);
      }
      disposeWebWallGLCanvas(canvas, gl, posBuffer, program);
    };
  }, []);

  // Sync live uniform inputs into the mounted WebGL2/Canvas2D loop and handle pause/resume cleanly.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- pushes live uniform params and pause state into mounted WebGL2/Canvas2D rAF controller
  useEffect(() => {
    liveRef.current.sceneIndex = sceneIndex;
    liveRef.current.themeMode = themeMode;
    liveRef.current.paused = paused;
    liveRef.current.fpsLimit = fpsLimit;
    liveRef.current.audioReactive = audioReactive;
    liveRef.current.audioEnergy = audioEnergy;
    liveRef.current.speed = speed;
    liveRef.current.intensity = intensity;
    liveRef.current.tintHex = tintHex;
    liveRef.current.parallaxEnabled = parallaxEnabled;

    const ctrl = controllerRef.current;
    if (!ctrl) return;
    if (paused) {
      ctrl.stop();
      ctrl.paintCurrent();
    } else {
      ctrl.start();
    }
  }, [
    sceneIndex,
    themeMode,
    paused,
    fpsLimit,
    audioReactive,
    audioEnergy,
    speed,
    intensity,
    tintHex,
    parallaxEnabled,
  ]);

  return (
    <canvas
      ref={canvasRef}
      data-pmx-webwallgl-backend="webgl2"
      data-pmx-webwallgl-paused={paused ? "1" : "0"}
      className="pmx-wp-stage__media"
    />
  );
}

export interface WebWallGLDisposableContextLike {
  deleteBuffer(buffer: WebGLBuffer | null): void;
  deleteProgram(program: WebGLProgram | null): void;
  getExtension(name: "WEBGL_lose_context"): { loseContext(): void } | null;
}

export function disposeWebWallGLCanvas(
  canvas: Pick<HTMLCanvasElement, "width" | "height"> | null | undefined,
  gl: WebWallGLDisposableContextLike | null | undefined,
  posBuffer: WebGLBuffer | null,
  program: WebGLProgram | null,
): void {
  if (gl) {
    try {
      if (posBuffer) gl.deleteBuffer(posBuffer);
      if (program) gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // Ignore context-loss cleanup errors on torn-down canvases
    }
  }
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function AmbientBackdrop({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      decoding="async"
      className="pmx-wp-stage__ambient"
      style={{ filter: "blur(28px) saturate(1.18) brightness(0.72)" }}
    />
  );
}

export interface ImageCrossfadeStageProps {
  src: string;
  slides?: string[];
  slideIntervalMs?: number | null;
  paused: boolean;
  showAmbient: boolean;
  mediaStyle: CSSProperties;
  transitionMs: number;
  recoveryNonce?: number;
  onRequestMediaRefresh?: (reason: string) => Promise<string | null | void> | string | null | void;
}

export function ImageCrossfadeStage({
  src,
  slides,
  slideIntervalMs,
  paused,
  showAmbient,
  mediaStyle,
  transitionMs,
  recoveryNonce = 0,
  onRequestMediaRefresh,
}: ImageCrossfadeStageProps) {
  const [slideIdx, setSlideIdx] = useState(0);
  const effectiveSrc =
    slides && slides.length > 1 ? (slides[slideIdx % slides.length] ?? src) : src;
  const currentImgRef = useRef<HTMLImageElement | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshCbRef = useRef(onRequestMediaRefresh);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- keeps media refresh callback current for retry timers
  useEffect(() => {
    refreshCbRef.current = onRequestMediaRefresh;
  }, [onRequestMediaRefresh]);

  const [slots, setSlots] = useState<{ current: string; previous: string | null; ready: boolean }>({
    current: effectiveSrc,
    previous: null,
    ready: false,
  });
  const [retryState, setRetryState] = useState<{
    baseSrc: string;
    attempt: number;
    overrideSrc: string | null;
    errored: boolean;
  }>({
    baseSrc: effectiveSrc,
    attempt: 0,
    overrideSrc: null,
    errored: false,
  });

  const activeRetry =
    retryState.baseSrc === slots.current
      ? retryState
      : { baseSrc: slots.current, attempt: 0, overrideSrc: null, errored: false };
  const resolvedCurrentSrc = activeRetry.overrideSrc ?? slots.current;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages slideshow interval timer for multi-slide image wallpapers
  useEffect(() => {
    if (!slides || slides.length <= 1 || paused) return;
    const ms = Math.max(5_000, slideIntervalMs ?? 60_000);
    const id = setInterval(() => {
      setSlideIdx((i) => (i + 1) % slides.length);
    }, ms);
    return () => clearInterval(id);
  }, [slides, slideIntervalMs, paused]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- advances crossfade image slot transition when effectiveSrc changes
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSlots((prev) => {
        if (prev.current === effectiveSrc) return prev;
        return {
          current: effectiveSrc,
          previous: prev.current,
          ready: false,
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveSrc]);

  // Immediately reveal cached images whose `complete` flag is already true without waiting for a new `load` event.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- inspects mounted HTMLImageElement.complete to prevent cached images from stalling at opacity 0
  useEffect(() => {
    const img = currentImgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && !slots.ready) {
      queueMicrotask(() => {
        setSlots((prev) =>
          prev.current === slots.current && !prev.ready ? { ...prev, ready: true } : prev,
        );
      });
    }
  }, [slots.current, slots.ready]);

  // Clean up pending error-retry timer on src switch or unmount.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- cleans up bounded image error-retry timer and allows wake/manual recovery
  useEffect(() => {
    const triggerManualRetry = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      setRetryState((prev) => {
        if (prev.baseSrc !== slots.current || !prev.errored) return prev;
        return {
          baseSrc: slots.current,
          attempt: prev.attempt + 1,
          overrideSrc: prev.overrideSrc,
          errored: false,
        };
      });
    };
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        triggerManualRetry();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", triggerManualRetry);
      window.addEventListener("online", triggerManualRetry);
    }
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", triggerManualRetry);
        window.removeEventListener("online", triggerManualRetry);
      }
    };
  }, [slots.current]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- retries errored image wallpaper when user explicitly re-selects it
  useEffect(() => {
    if (recoveryNonce <= 0) return;
    queueMicrotask(() => {
      setRetryState((prev) =>
        prev.baseSrc === slots.current && prev.errored
          ? { baseSrc: slots.current, attempt: prev.attempt + 1, overrideSrc: null, errored: false }
          : prev,
      );
    });
  }, [recoveryNonce, slots.current]);

  // Release the faded-out previous 4K/8K bitmap once crossfade completes (fallback when transitionend does not fire).
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- schedules a timer to drop the faded-out previous wallpaper bitmap if transitionend never fires
  useEffect(() => {
    const previousSrc = slots.previous;
    if (!previousSrc || !slots.ready) return;
    const delayMs = transitionMs > 0 ? transitionMs + 50 : 0;
    const timer = setTimeout(() => {
      setSlots((prev) =>
        prev.previous === previousSrc && prev.ready ? { ...prev, previous: null } : prev,
      );
    }, delayMs);
    return () => clearTimeout(timer);
  }, [slots.previous, slots.ready, transitionMs]);

  const handleCurrentImageError = () => {
    const currentBase = slots.current;
    const currentAttempt = activeRetry.attempt;
    setRetryState({
      baseSrc: currentBase,
      attempt: currentAttempt,
      overrideSrc: activeRetry.overrideSrc,
      errored: true,
    });
    if (currentAttempt >= WATCHDOG_BACKOFF_MS.length || retryTimerRef.current !== null) {
      return;
    }
    const delayMs = WATCHDOG_BACKOFF_MS[currentAttempt]!;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void Promise.resolve(refreshCbRef.current?.("image-error"))
        .then((freshUrl) => {
          setRetryState((prev) => {
            if (prev.baseSrc !== currentBase) return prev;
            const nextOverride =
              typeof freshUrl === "string" && freshUrl.trim().length > 0
                ? freshUrl.trim()
                : prev.overrideSrc;
            return {
              baseSrc: currentBase,
              attempt: prev.attempt + 1,
              overrideSrc: nextOverride,
              errored: false,
            };
          });
        })
        .catch(() => {
          setRetryState((prev) =>
            prev.baseSrc === currentBase
              ? { ...prev, attempt: prev.attempt + 1, errored: false }
              : prev,
          );
        });
    }, delayMs);
  };

  return (
    <>
      {showAmbient ? <AmbientBackdrop src={resolvedCurrentSrc} /> : null}
      {slots.previous && (
        <img
          key={`prev:${slots.previous}`}
          src={slots.previous}
          alt=""
          data-pmx-wp-slot="previous"
          className="pmx-wp-stage__media"
          onTransitionEnd={(event) => {
            if (event.propertyName === "opacity" && slots.ready && slots.previous) {
              const finishedPrevious = slots.previous;
              setSlots((prev) =>
                prev.previous === finishedPrevious && prev.ready
                  ? { ...prev, previous: null }
                  : prev,
              );
            }
          }}
          style={{
            ...mediaStyle,
            opacity: slots.ready ? 0 : 1,
            transition: transitionMs > 0 ? `opacity ${transitionMs}ms ease` : "none",
          }}
        />
      )}
      <img
        ref={currentImgRef}
        key={`curr:${slots.current}:${activeRetry.attempt}:${resolvedCurrentSrc}`}
        src={resolvedCurrentSrc}
        alt=""
        data-pmx-wp-slot="current"
        className="pmx-wp-stage__media"
        onLoad={() => {
          if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          setRetryState((prev) =>
            prev.baseSrc === slots.current && prev.errored ? { ...prev, errored: false } : prev,
          );
          setSlots((prev) => (prev.ready ? prev : { ...prev, ready: true }));
        }}
        onError={handleCurrentImageError}
        style={{
          ...mediaStyle,
          opacity: slots.ready || !slots.previous ? 1 : 0,
          transition: transitionMs > 0 ? `opacity ${transitionMs}ms ease` : "none",
        }}
      />
    </>
  );
}

export interface VideoStageProps {
  src: string;
  poster?: string | null;
  paused: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  loop: boolean;
  showAmbient: boolean;
  mediaStyle: CSSProperties;
  recoveryNonce?: number;
  onRequestMediaRefresh?: (reason: string) => Promise<string | null | void> | string | null | void;
  onEnded: () => void;
  onError: (msg: string | null) => void;
}

export interface VideoPlaybackHealthLike {
  readonly readyState: number;
  readonly networkState: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly error: MediaError | null;
}

export type VideoRecoveryAction = "none" | "play" | "restart-loop" | "reload-and-play";

/**
 * Pure decision helper classifying how an unpaused `<video>` element should recover
 * after occlusion, visibility change, system sleep/wake, decoder reclamation, or transient error.
 */
export function resolveVideoRecoveryAction(
  video: VideoPlaybackHealthLike,
  options: { readonly paused: boolean; readonly loop: boolean; readonly failed?: boolean },
): VideoRecoveryAction {
  if (options.paused) return "none";
  if (
    options.failed ||
    video.error !== null ||
    video.readyState === 0 ||
    video.networkState === 0 ||
    video.networkState === 3
  ) {
    return "reload-and-play";
  }
  if (video.ended && options.loop) {
    return "restart-loop";
  }
  if (video.paused) {
    return "play";
  }
  return "none";
}

export function applyVideoAudio(
  video: Pick<
    HTMLVideoElement,
    "defaultMuted" | "muted" | "volume" | "setAttribute" | "removeAttribute"
  >,
  muted: boolean,
  volume: number,
): void {
  const clampedVol = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  const effectiveMuted = muted || clampedVol <= 0;
  video.defaultMuted = effectiveMuted;
  video.muted = effectiveMuted;
  video.volume = effectiveMuted ? 0 : clampedVol;
  if (effectiveMuted) {
    video.setAttribute("muted", "");
  } else {
    video.removeAttribute("muted");
  }
}

export function disposeVideoElement(
  video: Pick<
    HTMLVideoElement,
    "defaultMuted" | "muted" | "volume" | "setAttribute" | "removeAttribute" | "pause" | "load"
  >,
  container?: Pick<HTMLElement, "replaceChildren"> | null,
): void {
  try {
    applyVideoAudio(video, true, 0);
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    // Ignore cleanup errors
  }
  if (container) {
    try {
      container.replaceChildren();
    } catch {
      // Ignore DOM cleanup errors
    }
  }
}

function tryPlayVideoElement(
  video: HTMLVideoElement,
  isDisposed?: () => boolean,
  onAutoplayMutedFallback?: () => void,
  onPlayRejected?: (reason: "abort" | "failed") => void,
): void {
  if (isDisposed?.()) return;
  let playPromise: Promise<void> | undefined;
  try {
    playPromise = video.play();
  } catch {
    onPlayRejected?.("failed");
    return;
  }
  if (playPromise && typeof playPromise.then === "function") {
    playPromise.then(
      () => {
        if (isDisposed?.()) {
          try {
            applyVideoAudio(video, true, 0);
            video.pause();
          } catch {
            // Ignore post-dispose pause errors
          }
        }
      },
      (err: unknown) => {
        if (isDisposed?.()) return;
        const errName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name?: unknown }).name ?? "")
            : "";
        if (errName === "AbortError") {
          onPlayRejected?.("abort");
          return;
        }
        // Unconditionally fall back to muted autoplay when Chromium autoplay policy blocks unmuted start
        onAutoplayMutedFallback?.();
        applyVideoAudio(video, true, 0);
        try {
          const retry = video.play();
          if (retry && typeof retry.catch === "function") {
            retry.catch(() => {
              if (!isDisposed?.()) {
                onPlayRejected?.("failed");
              }
            });
          }
        } catch {
          onPlayRejected?.("failed");
        }
      },
    );
  }
}

function formatVideoMediaError(err: MediaError | null): string {
  if (!err) return "视频壁纸解码失败，已自动回退静态预览";
  const detail = err.message ? `（${err.message}）` : "";
  switch (err.code) {
    case 1:
      return `视频加载被中断${detail}`;
    case 2:
      return `视频媒体流读取失败（网络或鉴权异常）${detail}`;
    case 3:
      return `视频解码失败，已回退静态预览${detail}`;
    case 4:
      return `当前媒体格式或编码不受支持，已回退静态预览${detail}`;
    default:
      return `视频壁纸播放失败（code=${err.code}）${detail}`;
  }
}

function applyVideoMediaStyle(video: HTMLVideoElement, style: CSSProperties): void {
  video.style.width = typeof style.width === "string" ? style.width : "100%";
  video.style.height = typeof style.height === "string" ? style.height : "100%";
  video.style.objectFit = typeof style.objectFit === "string" ? style.objectFit : "";
  video.style.objectPosition = typeof style.objectPosition === "string" ? style.objectPosition : "";
  video.style.transform = typeof style.transform === "string" ? style.transform : "none";
  video.style.filter = "";
}

/** Exponential backoff delays (ms) for VideoStage stall recovery when local daemon or network is momentarily busy. */
export const WATCHDOG_BACKOFF_MS: readonly number[] = [1800, 3500, 7000];
const VIDEO_FREEZE_PROBE_DELAY_MS = 1200;
const VIDEO_EXTERNAL_PAUSE_RECOVERY_DELAY_MS = 250;
const MAX_VIDEO_FREEZE_RECOVERIES_PER_WAKE = 2;
const MAX_VIDEO_EXTERNAL_PAUSE_RECOVERIES = 3;

export function VideoStage({
  src,
  poster,
  paused,
  muted,
  volume,
  playbackRate,
  loop,
  showAmbient,
  mediaStyle,
  recoveryNonce = 0,
  onRequestMediaRefresh,
  onEnded,
  onError,
}: VideoStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const autoplayMutedFallbackRef = useRef(false);
  const lastSyncedParamsRef = useRef<{
    src: string;
    paused: boolean;
    muted: boolean;
    volume: number;
    playbackRate: number;
    loop: boolean;
  } | null>(null);
  const playbackControllerRef = useRef<{
    ensurePlayback: (reason: "mount" | "unpause" | "wake" | "retry") => void;
    syncParams: (pausedChanged: boolean) => void;
  } | null>(null);
  const [readySrc, setReadySrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const videoReady = readySrc === src;
  const videoFailed = failedSrc === src;
  const failedSrcRef = useRef<string | null>(null);
  const stateRef = useRef({
    paused,
    muted,
    volume,
    playbackRate,
    loop,
    poster,
    mediaStyle,
    onRequestMediaRefresh,
    onEnded,
    onError,
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- keeps imperative HTMLVideoElement event handlers in step with latest props
  useEffect(() => {
    failedSrcRef.current = failedSrc;
    stateRef.current = {
      paused,
      muted,
      volume,
      playbackRate,
      loop,
      poster,
      mediaStyle,
      onRequestMediaRefresh,
      onEnded,
      onError,
    };
  }, [
    failedSrc,
    paused,
    muted,
    volume,
    playbackRate,
    loop,
    poster,
    mediaStyle,
    onRequestMediaRefresh,
    onEnded,
    onError,
  ]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- mounts imperative HTMLVideoElement and binds media lifecycle + wake recovery events
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    let disposed = false;
    let reloadingInternally = false;
    let activeUrl = src;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let errorRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let freezeProbeTimer: ReturnType<typeof setTimeout> | null = null;
    let externalPauseTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogAttempt = 0;
    let errorRetryAttempt = 0;
    let freezeRecoveryCount = 0;
    let externalPauseRecoveries = 0;
    let pendingSeekTime: number | null = null;
    autoplayMutedFallbackRef.current = false;

    const isDisposed = () => disposed;
    const onAutoplayMutedFallback = () => {
      autoplayMutedFallbackRef.current = true;
    };

    const clearWatchdog = () => {
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const clearErrorRetry = () => {
      if (errorRetryTimer !== null) {
        clearTimeout(errorRetryTimer);
        errorRetryTimer = null;
      }
    };
    const clearFreezeProbe = () => {
      if (freezeProbeTimer !== null) {
        clearTimeout(freezeProbeTimer);
        freezeProbeTimer = null;
      }
    };
    const clearExternalPauseTimer = () => {
      if (externalPauseTimer !== null) {
        clearTimeout(externalPauseTimer);
        externalPauseTimer = null;
      }
    };
    const clearAllTimers = () => {
      clearWatchdog();
      clearErrorRetry();
      clearFreezeProbe();
      clearExternalPauseTimer();
    };

    const latest = stateRef.current;
    // Adopt prewarmed metadata element only if healthy and detached (discard any errored/dead/live element)
    const rawAdopted = consumePrewarmedVideo(src);
    const adopted =
      rawAdopted &&
      !rawAdopted.isConnected &&
      rawAdopted.error === null &&
      !(rawAdopted.readyState === 0 && rawAdopted.networkState === 3)
        ? rawAdopted
        : null;
    if (rawAdopted && !adopted && !rawAdopted.isConnected) {
      try {
        applyVideoAudio(rawAdopted, true, 0);
        rawAdopted.pause();
        rawAdopted.removeAttribute("src");
      } catch {
        // Ignore cleanup errors
      }
    }

    const video = adopted ?? document.createElement("video");
    videoRef.current = video;

    const enforceVideoAudio = () => {
      const clampedVol = Math.max(
        0,
        Math.min(1, Number.isFinite(stateRef.current.volume) ? stateRef.current.volume : 0),
      );
      const desiredMuted = stateRef.current.muted || clampedVol <= 0;
      if (desiredMuted) {
        applyVideoAudio(video, true, 0);
      } else if (!autoplayMutedFallbackRef.current) {
        applyVideoAudio(video, false, clampedVol);
      }
    };

    const syncPlaybackRate = () => {
      try {
        video.defaultPlaybackRate = stateRef.current.playbackRate;
        video.playbackRate = stateRef.current.playbackRate;
      } catch {
        // Ignore unsupported rate
      }
    };

    video.className = "pmx-wp-stage__media";
    video.removeAttribute("width");
    video.removeAttribute("height");
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.autoplay = !latest.paused;
    video.preload = "auto";
    video.loop = latest.loop;
    // 1) Apply strict audio policy immediately upon element creation/adoption
    applyVideoAudio(video, latest.muted, latest.volume);
    syncPlaybackRate();
    if (latest.poster) {
      video.poster = latest.poster;
    } else {
      video.removeAttribute("poster");
    }
    applyVideoMediaStyle(video, latest.mediaStyle);

    const adoptedMatchesSrc =
      adopted !== null && (adopted.getAttribute("src") === src || adopted.src === src);
    if (!adoptedMatchesSrc) {
      video.src = src;
    }

    const onPlayRejected = () => {
      if (disposed || stateRef.current.paused) return;
      scheduleWatchdog();
    };

    const reloadVideoWithUrl = (targetUrl: string, preserveTime: boolean) => {
      if (disposed || stateRef.current.paused) return;
      if (preserveTime && Number.isFinite(video.currentTime) && video.currentTime > 0.1) {
        pendingSeekTime = video.currentTime;
      }
      reloadingInternally = true;
      try {
        activeUrl = targetUrl;
        video.preload = "auto";
        video.loop = stateRef.current.loop;
        // 3) Re-assert audio policy across watchdog/error reload
        enforceVideoAudio();
        const currentAttr = video.getAttribute("src");
        if (currentAttr !== targetUrl && video.src !== targetUrl) {
          video.src = targetUrl;
        }
        video.load();
        enforceVideoAudio();
        syncPlaybackRate();
      } catch {
        // Ignore reload failure
      } finally {
        reloadingInternally = false;
      }
      tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
      scheduleWatchdog();
    };

    const requestFreshReload = (reason: string, preserveTime: boolean) => {
      if (disposed || stateRef.current.paused) return;
      const refreshCb = stateRef.current.onRequestMediaRefresh;
      if (!refreshCb) {
        reloadVideoWithUrl(activeUrl, preserveTime);
        return;
      }
      void Promise.resolve(refreshCb(reason))
        .then((freshUrl) => {
          if (disposed || stateRef.current.paused) return;
          const nextUrl =
            typeof freshUrl === "string" && freshUrl.trim().length > 0
              ? freshUrl.trim()
              : activeUrl;
          reloadVideoWithUrl(nextUrl, preserveTime);
        })
        .catch(() => {
          if (disposed || stateRef.current.paused) return;
          reloadVideoWithUrl(activeUrl, preserveTime);
        });
    };

    const scheduleWatchdog = () => {
      if (
        disposed ||
        watchdogTimer !== null ||
        watchdogAttempt >= WATCHDOG_BACKOFF_MS.length ||
        video.readyState >= 3 ||
        video.error !== null ||
        stateRef.current.paused
      ) {
        return;
      }
      const delayMs = WATCHDOG_BACKOFF_MS[watchdogAttempt]!;
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (disposed || video.readyState >= 3 || video.error !== null || stateRef.current.paused) {
          return;
        }
        watchdogAttempt += 1;
        requestFreshReload("video-watchdog", video.readyState >= 2);
      }, delayMs);
    };

    const scheduleFreezeProbe = () => {
      clearFreezeProbe();
      if (
        disposed ||
        stateRef.current.paused ||
        freezeRecoveryCount >= MAX_VIDEO_FREEZE_RECOVERIES_PER_WAKE ||
        video.readyState < 2 ||
        video.paused ||
        video.error !== null
      ) {
        return;
      }
      const startTime = video.currentTime;
      freezeProbeTimer = setTimeout(() => {
        freezeProbeTimer = null;
        if (
          disposed ||
          stateRef.current.paused ||
          (typeof document !== "undefined" && document.hidden) ||
          video.paused ||
          video.ended ||
          video.error !== null
        ) {
          return;
        }
        const duration = video.duration;
        if (
          Number.isFinite(duration) &&
          duration > 0.25 &&
          Math.abs(video.currentTime - startTime) < 0.001
        ) {
          freezeRecoveryCount += 1;
          reloadVideoWithUrl(activeUrl, true);
        }
      }, VIDEO_FREEZE_PROBE_DELAY_MS);
    };

    const ensurePlayback = (reason: "mount" | "unpause" | "wake" | "retry") => {
      if (disposed) return;
      video.loop = stateRef.current.loop;
      enforceVideoAudio();
      syncPlaybackRate();

      if (stateRef.current.paused) {
        clearAllTimers();
        video.pause();
        if (video.readyState >= 2 && video.error === null) {
          setFailedSrc((prev) => (prev === src ? null : prev));
          setReadySrc((prev) => (prev === src ? prev : src));
        }
        return;
      }

      if (reason === "wake" || reason === "retry" || reason === "unpause") {
        externalPauseRecoveries = 0;
      }
      if (reason === "wake" || reason === "retry") {
        watchdogAttempt = 0;
        errorRetryAttempt = 0;
        freezeRecoveryCount = 0;
        clearErrorRetry();
      }

      if (video.readyState >= 2 && video.error === null) {
        setFailedSrc((prev) => (prev === src ? null : prev));
        setReadySrc((prev) => (prev === src ? prev : src));
        stateRef.current.onError(null);
      }

      const action = resolveVideoRecoveryAction(video, {
        paused: false,
        loop: stateRef.current.loop,
        failed: failedSrcRef.current === src,
      });

      if (action === "reload-and-play") {
        clearWatchdog();
        setFailedSrc((prev) => (prev === src ? null : prev));
        if (reason === "mount") {
          tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
          scheduleWatchdog();
        } else {
          requestFreshReload(`video-${reason}`, false);
        }
        return;
      }

      if (action === "restart-loop") {
        try {
          video.currentTime = 0;
        } catch {
          // Ignore seek errors on unseekable streams
        }
        tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
        scheduleWatchdog();
        return;
      }

      if (action === "play") {
        tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
        if (video.readyState < 3) {
          scheduleWatchdog();
        } else if (reason === "wake" || reason === "unpause") {
          scheduleFreezeProbe();
        }
        return;
      }

      if (video.readyState < 3) {
        scheduleWatchdog();
      } else if (reason === "wake") {
        scheduleFreezeProbe();
      }
    };

    const handleContextMenu = (e: Event) => e.preventDefault();
    const handleEnded = () => {
      if (disposed) return;
      if (stateRef.current.loop && !stateRef.current.paused) {
        try {
          video.currentTime = 0;
        } catch {
          // Ignore seek errors
        }
        tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
        return;
      }
      stateRef.current.onEnded();
    };
    const handleError = () => {
      if (disposed || reloadingInternally) return;
      clearWatchdog();
      clearFreezeProbe();
      clearExternalPauseTimer();
      setFailedSrc(src);
      setReadySrc((prev) => (prev === src ? null : prev));
      stateRef.current.onError(formatVideoMediaError(video.error));
      if (
        !stateRef.current.paused &&
        errorRetryTimer === null &&
        errorRetryAttempt < WATCHDOG_BACKOFF_MS.length
      ) {
        const delayMs = WATCHDOG_BACKOFF_MS[errorRetryAttempt]!;
        errorRetryTimer = setTimeout(() => {
          errorRetryTimer = null;
          if (disposed || stateRef.current.paused) return;
          errorRetryAttempt += 1;
          requestFreshReload("video-error", false);
        }, delayMs);
      }
    };
    const handleLoadedMetadata = () => {
      if (disposed) return;
      // 2a) Re-assert audio policy after metadata load
      enforceVideoAudio();
      if (pendingSeekTime !== null && Number.isFinite(video.duration) && video.duration > 0.2) {
        const targetTime = Math.min(pendingSeekTime, Math.max(0, video.duration - 0.1));
        pendingSeekTime = null;
        try {
          video.currentTime = targetTime;
        } catch {
          // Ignore seek errors
        }
      }
    };
    const handleReadyToPlay = () => {
      if (disposed) return;
      watchdogAttempt = 0;
      errorRetryAttempt = 0;
      clearWatchdog();
      clearErrorRetry();
      // 2b) Re-assert audio policy on loadeddata / canplay / canplaythrough
      enforceVideoAudio();
      setFailedSrc((prev) => (prev === src ? null : prev));
      setReadySrc(src);
      stateRef.current.onError(null);
      syncPlaybackRate();
      if (!stateRef.current.paused && video.paused) {
        tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
      }
    };
    const handlePlaying = () => {
      if (disposed) return;
      watchdogAttempt = 0;
      errorRetryAttempt = 0;
      clearWatchdog();
      clearErrorRetry();
      clearExternalPauseTimer();
      // 2c) Re-assert audio policy once playback actually begins
      enforceVideoAudio();
      setFailedSrc((prev) => (prev === src ? null : prev));
      setReadySrc(src);
      stateRef.current.onError(null);
      syncPlaybackRate();
    };
    const handleTimeUpdate = () => {
      if (disposed || video.error !== null || video.readyState < 2) return;
      setFailedSrc((prev) => (prev === src ? null : prev));
      setReadySrc((prev) => (prev === src ? prev : src));
    };
    const handleStalled = () => {
      if (disposed || stateRef.current.paused || video.readyState >= 3 || video.error !== null) {
        return;
      }
      scheduleWatchdog();
    };
    const handleEmptiedOrAbort = () => {
      if (disposed || reloadingInternally || stateRef.current.paused) return;
      setReadySrc((prev) => (prev === src ? null : prev));
      scheduleWatchdog();
    };
    const handleUnexpectedPause = () => {
      if (
        disposed ||
        reloadingInternally ||
        stateRef.current.paused ||
        video.ended ||
        video.error !== null ||
        externalPauseRecoveries >= MAX_VIDEO_EXTERNAL_PAUSE_RECOVERIES ||
        (typeof document !== "undefined" && document.hidden)
      ) {
        return;
      }
      clearExternalPauseTimer();
      externalPauseTimer = setTimeout(() => {
        externalPauseTimer = null;
        if (
          disposed ||
          reloadingInternally ||
          stateRef.current.paused ||
          !video.paused ||
          video.ended ||
          video.error !== null ||
          (typeof document !== "undefined" && document.hidden)
        ) {
          return;
        }
        externalPauseRecoveries += 1;
        ensurePlayback("wake");
      }, VIDEO_EXTERNAL_PAUSE_RECOVERY_DELAY_MS);
    };
    const handleVolumeChange = () => {
      if (disposed) return;
      // 5) Guard against Chromium media pipeline resetting muted/volume; correct only on drift
      const clampedVol = Math.max(
        0,
        Math.min(1, Number.isFinite(stateRef.current.volume) ? stateRef.current.volume : 0),
      );
      const expectedMuted = stateRef.current.muted || clampedVol <= 0;
      if (!expectedMuted && autoplayMutedFallbackRef.current) {
        return;
      }
      const expectedVol = expectedMuted ? 0 : clampedVol;
      const mutedAttrDrifted =
        typeof video.hasAttribute === "function"
          ? video.hasAttribute("muted") !== expectedMuted
          : false;
      const drifted =
        video.muted !== expectedMuted ||
        video.defaultMuted !== expectedMuted ||
        mutedAttrDrifted ||
        Math.abs(video.volume - expectedVol) > 0.001;
      if (drifted) {
        applyVideoAudio(video, stateRef.current.muted, stateRef.current.volume);
      }
    };
    const handleVisibilityWake = () => {
      if (disposed || typeof document === "undefined" || document.hidden) return;
      if (!stateRef.current.paused) {
        ensurePlayback("wake");
      }
    };
    const handleWindowWake = () => {
      if (disposed || (typeof document !== "undefined" && document.hidden)) return;
      if (!stateRef.current.paused) {
        ensurePlayback("wake");
      }
    };

    video.addEventListener("contextmenu", handleContextMenu);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("loadeddata", handleReadyToPlay);
    video.addEventListener("canplay", handleReadyToPlay);
    video.addEventListener("canplaythrough", handleReadyToPlay);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("waiting", handleStalled);
    video.addEventListener("emptied", handleEmptiedOrAbort);
    video.addEventListener("abort", handleEmptiedOrAbort);
    video.addEventListener("pause", handleUnexpectedPause);
    video.addEventListener("volumechange", handleVolumeChange);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityWake);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", handleWindowWake);
      window.addEventListener("pageshow", handleWindowWake);
      window.addEventListener("online", handleWindowWake);
    }

    playbackControllerRef.current = {
      ensurePlayback,
      syncParams: (pausedChanged: boolean) => {
        if (disposed) return;
        autoplayMutedFallbackRef.current = false;
        video.loop = stateRef.current.loop;
        // 4) Reactive prop sync
        applyVideoAudio(video, stateRef.current.muted, stateRef.current.volume);
        syncPlaybackRate();
        if (pausedChanged || stateRef.current.paused) {
          ensurePlayback("unpause");
        } else if (video.readyState >= 2 && video.paused && video.error === null) {
          tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
        }
      },
    };
    lastSyncedParamsRef.current = {
      src,
      paused: latest.paused,
      muted: latest.muted,
      volume: latest.volume,
      playbackRate: latest.playbackRate,
      loop: latest.loop,
    };

    container.replaceChildren(video);

    if (video.readyState >= 2 && video.error === null) {
      queueMicrotask(() => {
        if (!disposed) {
          setReadySrc(src);
        }
      });
      stateRef.current.onError(null);
      if (!latest.paused) {
        tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
      } else {
        video.pause();
      }
    } else if (!latest.paused) {
      tryPlayVideoElement(video, isDisposed, onAutoplayMutedFallback, onPlayRejected);
      // Watchdog: when preload transitions metadata -> auto on an adopted element (or huge EOF-moov MP4)
      // or when the local network is briefly busy, retry with exponential backoff if readyState stalls at < 3.
      scheduleWatchdog();
    } else {
      video.pause();
    }

    return () => {
      disposed = true;
      clearAllTimers();
      if (playbackControllerRef.current) {
        playbackControllerRef.current = null;
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityWake);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", handleWindowWake);
        window.removeEventListener("pageshow", handleWindowWake);
        window.removeEventListener("online", handleWindowWake);
      }
      video.removeEventListener("contextmenu", handleContextMenu);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("loadeddata", handleReadyToPlay);
      video.removeEventListener("canplay", handleReadyToPlay);
      video.removeEventListener("canplaythrough", handleReadyToPlay);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("waiting", handleStalled);
      video.removeEventListener("emptied", handleEmptiedOrAbort);
      video.removeEventListener("abort", handleEmptiedOrAbort);
      video.removeEventListener("pause", handleUnexpectedPause);
      video.removeEventListener("volumechange", handleVolumeChange);
      disposeVideoElement(video, container);
      if (videoRef.current === video) videoRef.current = null;
    };
  }, [src]);

  // Sync live playback parameters & immediate occlusion pause/recovery without rebuilding <video>
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- applies live muted, volume, playbackRate, loop, and pause state to imperative HTMLVideoElement
  useEffect(() => {
    const controller = playbackControllerRef.current;
    if (!controller) return;
    const prev = lastSyncedParamsRef.current;
    if (
      prev &&
      prev.src === src &&
      prev.paused === paused &&
      prev.muted === muted &&
      prev.volume === volume &&
      prev.playbackRate === playbackRate &&
      prev.loop === loop
    ) {
      return;
    }
    const pausedChanged = !prev || prev.src !== src || prev.paused !== paused;
    lastSyncedParamsRef.current = { src, paused, muted, volume, playbackRate, loop };
    controller.syncParams(pausedChanged);
  }, [src, paused, muted, volume, playbackRate, loop]);

  // Allow manual recovery when user re-selects the active wallpaper or hits play after an error
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- triggers imperative video recovery on explicit user retry signal
  useEffect(() => {
    if (recoveryNonce <= 0) return;
    playbackControllerRef.current?.ensurePlayback("retry");
  }, [recoveryNonce]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- updates imperative HTMLVideoElement CSS framing styles in place
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    applyVideoMediaStyle(video, mediaStyle);
  }, [mediaStyle]);

  return (
    <div className="pmx-wp-stage__slot">
      {/* Underlying poster + ambient backdrop prevents solid black flashes during load or decode error */}
      {poster ? (
        <>
          {showAmbient || videoFailed ? <AmbientBackdrop src={poster} /> : null}
          <img
            src={poster}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="pmx-wp-stage__media pmx-wp-stage__poster"
            style={{
              ...mediaStyle,
              objectFit:
                videoFailed && mediaStyle.objectFit === "cover" ? "contain" : mediaStyle.objectFit,
              opacity: videoReady && !videoFailed ? 0 : 1,
              transition: "opacity 240ms ease",
            }}
          />
        </>
      ) : null}
      <div
        ref={hostRef}
        className="pmx-wp-stage__slot pmx-wp-stage__video-layer"
        style={{
          opacity: videoReady && !videoFailed ? 1 : 0,
          transition: "opacity 240ms ease",
        }}
      />
    </div>
  );
}

export interface WebWallpaperStageProps {
  src: string;
  poster?: string | null;
  userProps: UserPropDef[];
  paused: boolean;
  fpsLimit: number;
  muted: boolean;
  volume: number;
  objectFit?: ObjectFitMode;
  mediaStyle: CSSProperties;
}

export function buildWebWallpaperAudioPayload(
  muted: boolean,
  volume: number,
): { type: "prismuxWallpaperAudio"; muted: boolean; volume: number } {
  const clampedVol = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
  const effectiveMuted = muted || clampedVol <= 0;
  return {
    type: "prismuxWallpaperAudio",
    muted: effectiveMuted,
    volume: effectiveMuted ? 0 : clampedVol,
  };
}

export function buildWebWallpaperListenerPayload(input: {
  userProps: UserPropDef[];
  fpsLimit: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  objectFit: ObjectFitMode;
}): {
  type: "wallpaperPropertyListener";
  applyUserProperties: Record<string, { value: unknown }>;
  applyGeneralProperties: { fps: number; paused: boolean };
  audio: { muted: boolean; volume: number };
  objectFit: ObjectFitMode;
} {
  const properties: Record<string, { value: unknown }> = {};
  for (const p of input.userProps) {
    properties[p.name] = { value: p.value };
  }
  const audioPayload = buildWebWallpaperAudioPayload(input.muted, input.volume);
  return {
    type: "wallpaperPropertyListener",
    applyUserProperties: properties,
    applyGeneralProperties: { fps: input.fpsLimit, paused: input.paused },
    audio: { muted: audioPayload.muted, volume: audioPayload.volume },
    objectFit: input.objectFit,
  };
}

export interface PostMessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export function dispatchWebWallpaperRuntimeState(
  win: PostMessageTarget | null | undefined,
  input: {
    userProps: UserPropDef[];
    fpsLimit: number;
    paused: boolean;
    muted: boolean;
    volume: number;
    objectFit: ObjectFitMode;
  },
): void {
  if (!win) return;
  const audioMsg = buildWebWallpaperAudioPayload(input.muted, input.volume);
  const listenerMsg = buildWebWallpaperListenerPayload(input);
  try {
    win.postMessage(audioMsg, "*");
    win.postMessage(listenerMsg, "*");
  } catch {
    // Sandboxed iframe origin
  }
}

export function silenceAndBlankIframe(
  iframe:
    | {
        contentWindow?: PostMessageTarget | null;
        src: string;
      }
    | null
    | undefined,
): void {
  if (!iframe) return;
  try {
    iframe.contentWindow?.postMessage(
      { type: "prismuxWallpaperAudio", muted: true, volume: 0 },
      "*",
    );
  } catch {
    // Ignore sandboxed / detached iframe postMessage errors
  }
  try {
    iframe.src = "about:blank";
  } catch {
    // Ignore detached iframe cleanup errors
  }
}

export function WebWallpaperStage({
  src,
  poster,
  userProps,
  paused,
  fpsLimit,
  muted,
  volume,
  objectFit = "cover",
  mediaStyle,
}: WebWallpaperStageProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [renderReadySrc, setRenderReadySrc] = useState<string | null>(null);
  const iframeLoaded = loadedSrc === src;
  const iframeRenderReady = renderReadySrc === src;
  const iframeVisible = !poster || iframeRenderReady;

  const postRuntimeState = useCallback(() => {
    dispatchWebWallpaperRuntimeState(iframeRef.current?.contentWindow, {
      userProps,
      fpsLimit,
      paused,
      muted,
      volume,
      objectFit,
    });
  }, [userProps, paused, fpsLimit, muted, volume, objectFit]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- forwards audio, user properties, objectFit, and playback state to sandboxed iframe via postMessage
  useEffect(() => {
    postRuntimeState();
  }, [postRuntimeState]);

  // Re-dispatch runtime state when window wakes from sleep/occlusion/background throttling so live Web/Scene iframes resume immediately.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to visibilitychange, focus, and pageshow to re-sync sandboxed iframe runtime state
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onWake = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      postRuntimeState();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [postRuntimeState]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to iframe bridge ready and first-frame ready messages
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMessage = (e: MessageEvent) => {
      const frameWin = iframeRef.current?.contentWindow;
      if (!frameWin || e.source !== frameWin) return;
      const data = e.data as { type?: unknown } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "prismuxWeBridgeReady") {
        postRuntimeState();
      } else if (data.type === "prismuxWebReady") {
        setRenderReadySrc(src);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [src, postRuntimeState]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- bounds poster hold to 2500ms after iframe load when prismuxWebReady is absent
  useEffect(() => {
    if (!poster || !iframeLoaded || iframeRenderReady) return;
    const timer = setTimeout(() => {
      setRenderReadySrc(src);
    }, 2500);
    return () => clearTimeout(timer);
  }, [src, poster, iframeLoaded, iframeRenderReady]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- mutes and blanks the outgoing iframe synchronously before DOM detachment on src switch or unmount
  useLayoutEffect(() => {
    if (!src) return;
    const iframe = iframeRef.current;
    return () => {
      silenceAndBlankIframe(iframe);
    };
  }, [src]);

  const isLoopbackHttp = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(src);

  return (
    <div className="pmx-wp-stage__slot">
      {poster ? (
        <img
          src={poster}
          alt=""
          aria-hidden="true"
          decoding="async"
          className="pmx-wp-stage__media pmx-wp-stage__poster"
          style={{
            ...mediaStyle,
            objectFit: objectFit === "center" ? "none" : objectFit,
            opacity: iframeVisible ? 0 : 1,
            transition: "opacity 260ms ease",
            pointerEvents: "none",
          }}
        />
      ) : null}
      <iframe
        key={src}
        ref={iframeRef}
        src={src}
        title="Prismux Web Wallpaper"
        sandbox={isLoopbackHttp ? "allow-scripts allow-same-origin" : "allow-scripts"}
        className="pmx-wp-stage__media pmx-wp-stage__iframe"
        style={{
          ...mediaStyle,
          opacity: iframeVisible ? 1 : 0,
          transition: "opacity 260ms ease",
        }}
        onLoad={() => {
          setLoadedSrc(src);
          postRuntimeState();
        }}
      />
    </div>
  );
}

function subscribeViewportResize(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", cb, { passive: true });
  return () => window.removeEventListener("resize", cb);
}

function getViewportRatioSnapshot(): number {
  return typeof window !== "undefined" && window.innerHeight > 0
    ? window.innerWidth / window.innerHeight
    : 16 / 9;
}

function getServerViewportRatio(): number {
  return 16 / 9;
}

interface SteamSceneFallbackProps {
  wallpaper: WallpaperItem;
  themeMode: ThemeMode;
  paused: boolean;
  fpsLimit: number;
  audioReactive: boolean;
  audioEnergy: number | number[];
  objectFit: ObjectFitMode;
  layerPositionX: number;
  layerPositionY: number;
  showAmbient: boolean;
  mediaStyle: CSSProperties;
  recoveryNonce?: number;
  onRequestMediaRefresh?: (reason: string) => Promise<string | null | void> | string | null | void;
}

function formatSceneTransform(
  cfg: { baseTransform: string; extraScale: number; needsAmbient: boolean },
  x: number,
  y: number,
): string {
  if (cfg.needsAmbient) {
    return (
      cfg.baseTransform ||
      (cfg.extraScale > 1.0001 ? `scale(${cfg.extraScale.toFixed(3)})` : "none")
    );
  }
  return `${cfg.baseTransform} translate3d(${(-x).toFixed(2)}px, ${(-y).toFixed(2)}px, 0) scale(${cfg.extraScale.toFixed(3)})`.trim();
}

/**
 * Steam Scene fallback: renders preview image / animated preview.gif with ambient backdrop
 * when aspect ratio mismatches (>1.35x) or contain/center fit, else falls back to WebWallGL.
 */
function SteamSceneFallback({
  wallpaper,
  themeMode,
  paused,
  fpsLimit,
  audioReactive,
  audioEnergy,
  objectFit,
  layerPositionX,
  layerPositionY,
  showAmbient,
  mediaStyle,
  recoveryNonce = 0,
  onRequestMediaRefresh,
}: SteamSceneFallbackProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [loadedDims, setLoadedDims] = useState<{ url: string; w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const refreshCbRef = useRef(onRequestMediaRefresh);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- keeps preview refresh callback current for wake recovery listeners
  useEffect(() => {
    refreshCbRef.current = onRequestMediaRefresh;
  }, [onRequestMediaRefresh]);
  const viewportRatio = useSyncExternalStore(
    subscribeViewportResize,
    getViewportRatioSnapshot,
    getServerViewportRatio,
  );

  const previewUrl = wallpaper.previewUrl ?? null;
  const previewFailed = previewUrl !== null && failedUrl === previewUrl;

  // Recover transiently failed Steam Scene preview images on visibility/focus/online wake or explicit reselect
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to wake events to retry transiently failed scene preview images
  useEffect(() => {
    if (!previewFailed || !previewUrl || typeof window === "undefined") return;
    const retryPreview = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void Promise.resolve(refreshCbRef.current?.("scene-preview-error")).finally(() => {
        setFailedUrl(null);
        setPreviewAttempt((n) => n + 1);
      });
    };
    document.addEventListener("visibilitychange", retryPreview);
    window.addEventListener("focus", retryPreview);
    window.addEventListener("online", retryPreview);
    return () => {
      document.removeEventListener("visibilitychange", retryPreview);
      window.removeEventListener("focus", retryPreview);
      window.removeEventListener("online", retryPreview);
    };
  }, [previewFailed, previewUrl]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- resets transient preview error when user explicitly re-selects the wallpaper
  useEffect(() => {
    if (recoveryNonce <= 0 || !previewFailed) return;
    queueMicrotask(() => {
      setFailedUrl(null);
      setPreviewAttempt((n) => n + 1);
    });
  }, [recoveryNonce, previewFailed]);
  const naturalDims =
    previewUrl !== null && loadedDims !== null && loadedDims.url === previewUrl
      ? { w: loadedDims.w, h: loadedDims.h }
      : wallpaper.width && wallpaper.height
        ? { w: wallpaper.width, h: wallpaper.height }
        : null;

  const imgRatio = naturalDims && naturalDims.h > 0 ? naturalDims.w / naturalDims.h : 0;
  const ratioMismatch =
    imgRatio > 0 &&
    viewportRatio > 0 &&
    Math.max(viewportRatio / imgRatio, imgRatio / viewportRatio) > 1.35;

  const needsAmbient =
    showAmbient ||
    objectFit === "contain" ||
    objectFit === "center" ||
    (objectFit === "cover" && ratioMismatch);
  const parallaxEnabled = !paused && !previewFailed && Boolean(previewUrl) && !needsAmbient;

  const [bass] = normalizeAudioTriple(audioReactive, audioEnergy);
  const baseTransform =
    typeof mediaStyle.transform === "string" && mediaStyle.transform !== "none"
      ? mediaStyle.transform
      : "";
  const extraScale = needsAmbient ? 1 + bass * 0.015 : 1.04 + bass * 0.02;
  const staticTransform = needsAmbient
    ? baseTransform || (bass > 0.01 ? `scale(${extraScale.toFixed(3)})` : "none")
    : `${baseTransform} translate3d(0.00px, 0.00px, 0) scale(${extraScale.toFixed(3)})`.trim();

  const parallaxPosRef = useRef({ x: 0, y: 0 });
  const parallaxConfigRef = useRef({
    baseTransform,
    extraScale,
    needsAmbient,
    fpsLimit,
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- keeps imperative DOM transform synced with audioEnergy/mediaStyle while preserving current parallax offset
  useEffect(() => {
    parallaxConfigRef.current = { baseTransform, extraScale, needsAmbient, fpsLimit };
    const img = imgRef.current;
    if (img) {
      const pos = parallaxEnabled ? parallaxPosRef.current : { x: 0, y: 0 };
      img.style.transform = formatSceneTransform(parallaxConfigRef.current, pos.x, pos.y);
    }
  }, [baseTransform, extraScale, needsAmbient, fpsLimit, parallaxEnabled]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- drives imperative DOM transform parallax directly via ref without React state re-renders
  useEffect(() => {
    if (!parallaxEnabled) {
      parallaxPosRef.current = { x: 0, y: 0 };
      if (imgRef.current) {
        imgRef.current.style.transform = formatSceneTransform(parallaxConfigRef.current, 0, 0);
      }
      return;
    }
    let rafId: number | null = null;
    let targetX = parallaxPosRef.current.x;
    let targetY = parallaxPosRef.current.y;
    let lastFrameTs = 0;

    const onMove = (e: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      targetX = (e.clientX / w - 0.5) * 14;
      targetY = (e.clientY / h - 0.5) * 10;
      if (rafId === null) {
        rafId = requestAnimationFrame(step);
      }
    };

    const step = (ts: number) => {
      const cfg = parallaxConfigRef.current;
      const pos = parallaxPosRef.current;
      const minInterval = 1000 / Math.max(1, cfg.fpsLimit || 30);
      if (lastFrameTs === 0 || ts - lastFrameTs >= minInterval - 0.5) {
        lastFrameTs = ts;
        pos.x += (targetX - pos.x) * 0.12;
        pos.y += (targetY - pos.y) * 0.12;
        const img = imgRef.current;
        if (img) {
          img.style.transform = formatSceneTransform(cfg, pos.x, pos.y);
        }
      }
      if (Math.abs(targetX - pos.x) > 0.08 || Math.abs(targetY - pos.y) > 0.08) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null;
        lastFrameTs = 0;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [parallaxEnabled]);

  if (previewUrl && !previewFailed) {
    const smartPosY =
      objectFit === "cover" &&
      !ratioMismatch &&
      layerPositionY === 50 &&
      imgRatio > 0 &&
      imgRatio < viewportRatio
        ? 25
        : layerPositionY;

    const effectiveObjectFit: CSSProperties["objectFit"] =
      objectFit === "cover" && ratioMismatch ? "contain" : mediaStyle.objectFit;
    const { transform: _baseTransform, ...mediaStyleWithoutTransform } = mediaStyle;

    return (
      <div className="pmx-wp-stage__slot">
        {needsAmbient ? <AmbientBackdrop src={previewUrl} /> : null}
        <img
          key={`${previewUrl}:${previewAttempt}`}
          ref={imgRef}
          src={previewUrl}
          alt=""
          decoding="async"
          className="pmx-wp-stage__media"
          onLoad={(e) => {
            const nw = e.currentTarget.naturalWidth;
            const nh = e.currentTarget.naturalHeight;
            if (nw > 0 && nh > 0) {
              setLoadedDims({ url: previewUrl, w: nw, h: nh });
            }
          }}
          onError={() => setFailedUrl(previewUrl)}
          style={{
            ...mediaStyleWithoutTransform,
            objectFit: effectiveObjectFit,
            objectPosition: `${layerPositionX}% ${smartPosY}%`,
            ...(parallaxEnabled ? {} : { transform: staticTransform }),
          }}
        />
      </div>
    );
  }

  return (
    <WebWallGLStageCanvas
      sceneIndex={presetToSceneIndex(wallpaper.builtinSceneId, wallpaper.id)}
      themeMode={themeMode}
      paused={paused}
      fpsLimit={fpsLimit}
      audioReactive={audioReactive}
      audioEnergy={audioEnergy}
      speed={1}
      intensity={1}
      tintHex={wallpaper.schemeColor || "#38bdf8"}
      parallaxEnabled={true}
    />
  );
}

export interface WallpaperStageStyleInput {
  objectFit: ObjectFitMode;
  layerScale: number;
  flipX: boolean;
  flipY: boolean;
  layerPositionX: number;
  layerPositionY: number;
  wallpaperBlur: number;
  backgroundBrightness: number;
  backgroundContrast: number;
  backgroundSaturate: number;
}

function readDocumentIsLight(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  return !root.classList.contains("dark") && root.getAttribute("data-pmx-theme") !== "dark";
}

function subscribeDocumentIsLight(cb: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-pmx-theme"],
  });
  return () => observer.disconnect();
}

function getServerFalse(): boolean {
  return false;
}

function readDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

function subscribeDocumentVisibility(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

let trackedWindowBlurred = false;

function readWindowBlurred(): boolean {
  return trackedWindowBlurred;
}

function subscribeWindowBlur(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  // Sync initial focus state on mount so an unmount while blurred never leaves trackedWindowBlurred stuck true.
  trackedWindowBlurred =
    typeof document !== "undefined" && typeof document.hasFocus === "function"
      ? !document.hasFocus()
      : false;
  const onBlur = () => {
    trackedWindowBlurred = true;
    cb();
  };
  const onFocus = () => {
    if (!trackedWindowBlurred) return;
    trackedWindowBlurred = false;
    cb();
  };
  const onVisibleOrInteract = () => {
    if (!trackedWindowBlurred) return;
    if (
      typeof document !== "undefined" &&
      !document.hidden &&
      (typeof document.hasFocus !== "function" || document.hasFocus())
    ) {
      trackedWindowBlurred = false;
      cb();
    }
  };
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pointerdown", onFocus, { passive: true });
  window.addEventListener("keydown", onFocus, { passive: true });
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibleOrInteract);
  }
  return () => {
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pointerdown", onFocus);
    window.removeEventListener("keydown", onFocus);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibleOrInteract);
    }
  };
}

/** Computes the effective live frame cap by intersecting `sceneLiveFps` with global `fpsCap` (0 = uncapped). */
export function resolveEffectiveLiveFps(sceneLiveFps: number, fpsCap: number): number {
  const base = Number.isFinite(sceneLiveFps) && sceneLiveFps > 0 ? sceneLiveFps : 30;
  if (Number.isFinite(fpsCap) && fpsCap > 0) {
    return Math.max(1, Math.min(base, fpsCap));
  }
  return Math.max(1, base);
}

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>;
};

function useBatteryDischarging(enabled: boolean): boolean {
  const [discharging, setDischarging] = useState(false);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to Battery Status API chargingchange events when pauseOnBattery is enabled
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") {
      return;
    }
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== "function") {
      return;
    }
    let disposed = false;
    let batteryRef: BatteryManagerLike | null = null;
    const onChargingChange = () => {
      if (!disposed && batteryRef) {
        setDischarging(!batteryRef.charging);
      }
    };
    nav
      .getBattery()
      .then((battery) => {
        if (disposed) return;
        batteryRef = battery;
        setDischarging(!battery.charging);
        battery.addEventListener("chargingchange", onChargingChange);
      })
      .catch(() => {
        if (!disposed) setDischarging(false);
      });
    return () => {
      disposed = true;
      batteryRef?.removeEventListener("chargingchange", onChargingChange);
    };
  }, [enabled]);

  return enabled ? discharging : false;
}

let cachedWebglSoftwareRenderer: boolean | null = null;

function probeWebglSoftwareRenderer(): boolean {
  if (cachedWebglSoftwareRenderer !== null) return cachedWebglSoftwareRenderer;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) {
      cachedWebglSoftwareRenderer = true;
      return true;
    }
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo
      ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "")
      : String(gl.getParameter(gl.RENDERER) ?? "");
    const loseExt = gl.getExtension("WEBGL_lose_context");
    loseExt?.loseContext();
    cachedWebglSoftwareRenderer =
      /swiftshader|llvmpipe|softpipe|microsoft basic render driver|software rasterizer|mesa offscreen/i.test(
        renderer,
      );
  } catch {
    cachedWebglSoftwareRenderer = false;
  }
  return cachedWebglSoftwareRenderer;
}

function readSoftwareRenderer(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  const gpuAttr = root.getAttribute("data-pmx-gpu") ?? root.getAttribute("data-prismux-gpu");
  if (gpuAttr === "0") return true;
  if (gpuAttr === "1") return false;
  return probeWebglSoftwareRenderer();
}

function subscribeGpuFlag(cb: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-pmx-gpu", "data-prismux-gpu"],
  });
  return () => observer.disconnect();
}

function useDeferredLiveBoot(active: boolean, delaySeconds: number, resetKey: string): boolean {
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const immediate =
    typeof window === "undefined" || !active || !Number.isFinite(delaySeconds) || delaySeconds <= 0;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- schedules deferred boot delay timer for heavy Web/Scene live runtimes
  useEffect(() => {
    if (immediate) return;
    const ms = Math.max(0, Math.round(delaySeconds * 1000));
    const timer = setTimeout(() => {
      setReadyKey(resetKey);
    }, ms);
    return () => clearTimeout(timer);
  }, [immediate, delaySeconds, resetKey]);

  return immediate || readyKey === resetKey;
}

function computePanPercent(position: number, scaleFactor: number): number {
  if (position === 50) return 0;
  const basePan = (position - 50) * 0.45;
  if (scaleFactor <= 1) return basePan;
  const zoomShiftBound = ((scaleFactor - 1) / (2 * scaleFactor)) * 100;
  const zoomPan = ((position - 50) / 50) * zoomShiftBound;
  const blend = Math.min(1, Math.max(0, (scaleFactor - 1) / 0.15));
  return basePan + (zoomPan - basePan) * blend;
}

export function computeWallpaperStageStyles(settings: WallpaperStageStyleInput): {
  viewportStyle: CSSProperties;
  mediaStyle: CSSProperties;
  frameMediaStyle: CSSProperties;
  showAmbientBackdrop: boolean;
} {
  const objectFit: CSSProperties["objectFit"] =
    settings.objectFit === "center" ? "none" : settings.objectFit;
  const scaleFactor = settings.layerScale / 100;
  const sx = (settings.flipX ? -1 : 1) * scaleFactor;
  const sy = (settings.flipY ? -1 : 1) * scaleFactor;

  const mediaTx = computePanPercent(settings.layerPositionX, scaleFactor);
  const mediaTy = computePanPercent(settings.layerPositionY, scaleFactor);

  const transformParts: string[] = [];
  if (Math.abs(mediaTx) > 0.001 || Math.abs(mediaTy) > 0.001) {
    transformParts.push(`translate3d(${mediaTx.toFixed(2)}%, ${mediaTy.toFixed(2)}%, 0)`);
  }
  if (sx !== 1 || sy !== 1) {
    transformParts.push(`scale(${sx}, ${sy})`);
  }
  const transformStr = transformParts.length > 0 ? transformParts.join(" ") : "none";

  const filterParts: string[] = [];
  if (settings.wallpaperBlur > 0) filterParts.push(`blur(${settings.wallpaperBlur}px)`);
  if (settings.backgroundBrightness !== 100) {
    filterParts.push(`brightness(${settings.backgroundBrightness}%)`);
  }
  if (settings.backgroundContrast !== 100) {
    filterParts.push(`contrast(${settings.backgroundContrast}%)`);
  }
  if (settings.backgroundSaturate !== 100) {
    filterParts.push(`saturate(${settings.backgroundSaturate}%)`);
  }

  const blurBleedScale =
    settings.wallpaperBlur > 0 ? (1 + settings.wallpaperBlur * 0.004).toFixed(3) : null;

  const viewportStyle: CSSProperties = {
    filter: filterParts.length > 0 ? filterParts.join(" ") : "none",
    ...(blurBleedScale ? { transform: `scale(${blurBleedScale})` } : {}),
  };

  const showAmbientBackdrop =
    settings.objectFit === "contain" ||
    settings.objectFit === "center" ||
    settings.layerScale < 100 ||
    settings.layerPositionX !== 50 ||
    settings.layerPositionY !== 50;

  return {
    viewportStyle,
    mediaStyle: {
      width: "100%",
      height: "100%",
      objectFit,
      objectPosition: `${settings.layerPositionX}% ${settings.layerPositionY}%`,
      transform: transformStr,
    },
    frameMediaStyle: {
      width: "100%",
      height: "100%",
      transform: transformStr,
    },
    showAmbientBackdrop,
  };
}

/**
 * Z-0 Fullscreen Wallpaper Stage (strictly zero-token visual host layer).
 */
export function WallpaperStage({
  store,
  occluded: occludedProp,
  audioEnergy: audioEnergyProp,
  resolveLiveRuntimeUrl,
  onRequestMediaRefresh,
  onRequestOcclusionSync,
  className,
}: WallpaperStageProps) {
  const snap = useWallpaperStore(store);
  const { settings, wallpapers } = snap;
  const docHidden = useSyncExternalStore(
    subscribeDocumentVisibility,
    readDocumentHidden,
    getServerFalse,
  );
  const winBlurred = useSyncExternalStore(subscribeWindowBlur, readWindowBlurred, getServerFalse);
  const docIsLight = useSyncExternalStore(
    subscribeDocumentIsLight,
    readDocumentIsLight,
    getServerFalse,
  );
  const isSoftwareRenderer = useSyncExternalStore(
    subscribeGpuFlag,
    readSoftwareRenderer,
    getServerFalse,
  );
  const batteryDischarging = useBatteryDischarging(settings.pauseOnBattery);

  // Fall back to the store's retained active wallpaper so transient inventory refreshes / daemon
  // reconnects never unmount the live VideoStage/ImageStage into a black void.
  const directWallpaper = useMemo(
    () => findWallpaperById(wallpapers, settings.selectedId),
    [wallpapers, settings.selectedId],
  );
  const currentWallpaper = directWallpaper ?? snap.retainedWallpaper ?? null;

  const engineGated = isWallpaperGatedByEngine(currentWallpaper, settings);
  const needsLiveBootDelay =
    Boolean(currentWallpaper) &&
    !engineGated &&
    settings.advancedEngineEnabled &&
    isAdvancedWallpaperType(currentWallpaper?.type);
  const liveBootReady = useDeferredLiveBoot(
    needsLiveBootDelay,
    settings.liveBootDelay,
    currentWallpaper?.id ?? "",
  );

  // Self-heal stale external `occluded: true` flags when a subsequent live visibility/focus/input wake
  // proves the window is actively visible, while honoring explicit initial occlusion and real minimization.
  const rawExternalOccluded = occludedProp === true || snap.occluded === true;
  const [healedExternalOcclusion, setHealedExternalOcclusion] = useState(false);
  const occlusionSyncRef = useRef(onRequestOcclusionSync);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- keeps occlusion sync callback current for wake recovery listeners
  useEffect(() => {
    occlusionSyncRef.current = onRequestOcclusionSync;
  }, [onRequestOcclusionSync]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- self-heals stale external occlusion signals on subsequent visible focus/input wake events
  useEffect(() => {
    if (!rawExternalOccluded) {
      queueMicrotask(() => {
        setHealedExternalOcclusion((prev) => (prev ? false : prev));
      });
      return;
    }
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    let disposed = false;
    const handleLiveWake = () => {
      if (disposed || document.hidden || document.visibilityState !== "visible") {
        return;
      }
      const syncHook = occlusionSyncRef.current;
      if (syncHook) {
        void Promise.resolve(syncHook())
          .then((stillOccluded) => {
            if (disposed) return;
            if (stillOccluded === false) {
              setHealedExternalOcclusion(true);
              if (store.getSnapshot().occluded) {
                store.setOccluded(false);
              }
            }
          })
          .catch(() => {});
        return;
      }
      setHealedExternalOcclusion(true);
      if (store.getSnapshot().occluded) {
        store.setOccluded(false);
      }
    };

    document.addEventListener("visibilitychange", handleLiveWake);
    window.addEventListener("focus", handleLiveWake);
    window.addEventListener("pageshow", handleLiveWake);
    window.addEventListener("pointerdown", handleLiveWake, { passive: true });
    window.addEventListener("keydown", handleLiveWake, { passive: true });
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleLiveWake);
      window.removeEventListener("focus", handleLiveWake);
      window.removeEventListener("pageshow", handleLiveWake);
      window.removeEventListener("pointerdown", handleLiveWake);
      window.removeEventListener("keydown", handleLiveWake);
    };
  }, [rawExternalOccluded, store]);

  const effectiveExternalOccluded = rawExternalOccluded && !healedExternalOcclusion;
  const occluded =
    effectiveExternalOccluded ||
    (settings.pauseOnHidden && docHidden) ||
    (settings.pauseOnBlur && winBlurred);

  const batteryPaused = settings.pauseOnBattery && batteryDischarging;
  const softRenderPaused = settings.sceneSoftRenderPause && isSoftwareRenderer;
  const effectivePaused = occluded || !settings.playing || batteryPaused;
  const effectiveLiveFps = resolveEffectiveLiveFps(settings.sceneLiveFps, settings.fpsCap);
  const effectiveAudioEnergy = audioEnergyProp ?? snap.audioEnergy;

  const resolvedProps = useMemo(() => {
    if (!currentWallpaper) return [];
    const base = snap.propsMap[currentWallpaper.id] ?? currentWallpaper.userProperties ?? [];
    const overrides = settings.userPropOverrides[currentWallpaper.id];
    return applyUserPropOverrides(base, overrides);
  }, [currentWallpaper, settings.userPropOverrides, snap.propsMap]);

  const { viewportStyle, mediaStyle, frameMediaStyle, showAmbientBackdrop } = useMemo(
    () =>
      computeWallpaperStageStyles({
        objectFit: settings.objectFit,
        layerScale: settings.layerScale,
        flipX: settings.flipX,
        flipY: settings.flipY,
        layerPositionX: settings.layerPositionX,
        layerPositionY: settings.layerPositionY,
        wallpaperBlur: settings.wallpaperBlur,
        backgroundBrightness: settings.backgroundBrightness,
        backgroundContrast: settings.backgroundContrast,
        backgroundSaturate: settings.backgroundSaturate,
      }),
    [
      settings.objectFit,
      settings.layerScale,
      settings.flipX,
      settings.flipY,
      settings.layerPositionX,
      settings.layerPositionY,
      settings.wallpaperBlur,
      settings.backgroundBrightness,
      settings.backgroundContrast,
      settings.backgroundSaturate,
    ],
  );

  // Hard gate: never mount any Web or Steam Scene live runtime (or WebWallGL canvas) when advancedEngineEnabled is false.
  if (!currentWallpaper || engineGated) {
    return null;
  }

  const activeGroup = settings.rotationGroups.find((g) => g.id === settings.rotationGroupId);
  const videoLoop = !(settings.rotationEnabled && activeGroup?.trigger === "videoEnd");
  const transitionMs = settings.switchTransition === "cut" ? 0 : 420;
  const nativeFadeOpacity = normalizeWallpaperFadeOpacity(settings.wallpaperOpacity, 0) / 100;
  const scrimOpacity = normalizeWallpaperScrim(settings.scrim, 0.15);
  const isLightSurface =
    settings.themeMode === "light" || (settings.themeMode === "glass" && docIsLight);
  const nativeFadeColor = isLightSurface ? "#ffffff" : "#000000";

  // Extract shader user properties if present
  const propMap = new Map(resolvedProps.map((p) => [p.name, p.value]));
  const shaderSpeed = Number(propMap.get("speed") ?? 1) || 1;
  const shaderIntensity = Number(propMap.get("intensity") ?? 1) || 1;
  const shaderTint =
    typeof propMap.get("tint") === "string"
      ? weColorToHex(propMap.get("tint"), currentWallpaper.schemeColor || "#38bdf8")
      : currentWallpaper.schemeColor || "#38bdf8";
  const shaderParallax = propMap.get("parallax") !== false;

  const resolvedLiveUrl =
    settings.advancedEngineEnabled && resolveLiveRuntimeUrl
      ? resolveLiveRuntimeUrl(currentWallpaper, settings)
      : null;
  const liveRuntimeUrl =
    settings.advancedEngineEnabled && settings.sceneLive ? resolvedLiveUrl : null;
  const webRuntimeUrl = settings.advancedEngineEnabled
    ? resolvedLiveUrl || currentWallpaper.mediaUrl
    : null;
  const liveRuntimePaused = effectivePaused || softRenderPaused;

  const requestCurrentMediaRefresh = onRequestMediaRefresh
    ? (reason: string) => onRequestMediaRefresh(currentWallpaper, reason)
    : undefined;

  return (
    <div
      aria-hidden="true"
      data-pmx-wallpaper-stage="1"
      data-pmx-wallpaper-id={currentWallpaper.id}
      data-pmx-wallpaper-type={currentWallpaper.type}
      data-pmx-wallpaper-paused={effectivePaused ? "1" : "0"}
      data-pmx-wallpaper-occluded={occluded ? "1" : "0"}
      data-pmx-fps-cap={String(effectiveLiveFps)}
      data-pmx-battery-paused={batteryPaused ? "1" : "0"}
      data-pmx-soft-render-paused={softRenderPaused ? "1" : "0"}
      className={className ? `pmx-wp-stage ${className}` : "pmx-wp-stage"}
    >
      <div className="pmx-wp-stage__viewport" style={viewportStyle}>
        {currentWallpaper.type === "image" && currentWallpaper.mediaUrl && (
          <ImageCrossfadeStage
            src={currentWallpaper.mediaUrl}
            slides={currentWallpaper.slides}
            slideIntervalMs={currentWallpaper.slideIntervalMs}
            paused={effectivePaused}
            showAmbient={showAmbientBackdrop}
            mediaStyle={mediaStyle}
            transitionMs={transitionMs}
            recoveryNonce={snap.mediaRecoveryNonce}
            {...(requestCurrentMediaRefresh
              ? { onRequestMediaRefresh: requestCurrentMediaRefresh }
              : {})}
          />
        )}

        {currentWallpaper.type === "video" && currentWallpaper.mediaUrl && (
          <VideoStage
            src={currentWallpaper.mediaUrl}
            poster={currentWallpaper.previewUrl}
            paused={effectivePaused}
            muted={!settings.videoAudioEnabled}
            volume={settings.videoVolume}
            playbackRate={settings.playbackRate}
            loop={videoLoop}
            showAmbient={showAmbientBackdrop}
            mediaStyle={mediaStyle}
            recoveryNonce={snap.mediaRecoveryNonce}
            {...(requestCurrentMediaRefresh
              ? { onRequestMediaRefresh: requestCurrentMediaRefresh }
              : {})}
            onEnded={() => store.handleVideoEnded()}
            onError={(msg) => store.setVideoError(msg)}
          />
        )}

        {currentWallpaper.type === "web" &&
          settings.advancedEngineEnabled &&
          webRuntimeUrl &&
          (liveBootReady ? (
            <WebWallpaperStage
              src={webRuntimeUrl}
              poster={currentWallpaper.previewUrl}
              userProps={resolvedProps}
              paused={liveRuntimePaused || !settings.sceneLive}
              fpsLimit={effectiveLiveFps}
              muted={!settings.videoAudioEnabled}
              volume={settings.videoVolume}
              objectFit={settings.objectFit}
              mediaStyle={frameMediaStyle}
            />
          ) : currentWallpaper.previewUrl ? (
            <div className="pmx-wp-stage__slot" data-pmx-live-boot-deferred="1">
              <img
                src={currentWallpaper.previewUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="pmx-wp-stage__media pmx-wp-stage__poster"
                style={mediaStyle}
              />
            </div>
          ) : null)}

        {currentWallpaper.type === "scene" &&
          settings.advancedEngineEnabled &&
          (!liveBootReady ? (
            currentWallpaper.previewUrl ? (
              <div className="pmx-wp-stage__slot" data-pmx-live-boot-deferred="1">
                <img
                  src={currentWallpaper.previewUrl}
                  alt=""
                  aria-hidden="true"
                  decoding="async"
                  className="pmx-wp-stage__media pmx-wp-stage__poster"
                  style={mediaStyle}
                />
              </div>
            ) : null
          ) : currentWallpaper.source === "builtin" ? (
            <div className="pmx-wp-stage__slot" style={frameMediaStyle}>
              <WebWallGLStageCanvas
                sceneIndex={presetToSceneIndex(
                  currentWallpaper.builtinSceneId,
                  currentWallpaper.id,
                )}
                themeMode={settings.themeMode}
                paused={liveRuntimePaused || !settings.sceneLive}
                fpsLimit={effectiveLiveFps}
                audioReactive={settings.audioReactive}
                audioEnergy={effectiveAudioEnergy}
                speed={shaderSpeed}
                intensity={shaderIntensity}
                tintHex={shaderTint}
                parallaxEnabled={shaderParallax}
              />
            </div>
          ) : liveRuntimeUrl ? (
            <WebWallpaperStage
              src={liveRuntimeUrl}
              poster={currentWallpaper.previewUrl}
              userProps={resolvedProps}
              paused={liveRuntimePaused}
              fpsLimit={effectiveLiveFps}
              muted={!settings.videoAudioEnabled}
              volume={settings.videoVolume}
              objectFit={settings.objectFit}
              mediaStyle={frameMediaStyle}
            />
          ) : (
            <SteamSceneFallback
              wallpaper={currentWallpaper}
              themeMode={settings.themeMode}
              paused={liveRuntimePaused || !settings.sceneLive}
              fpsLimit={effectiveLiveFps}
              audioReactive={settings.audioReactive}
              audioEnergy={effectiveAudioEnergy}
              objectFit={settings.objectFit}
              layerPositionX={settings.layerPositionX}
              layerPositionY={settings.layerPositionY}
              showAmbient={showAmbientBackdrop}
              mediaStyle={mediaStyle}
              recoveryNonce={snap.mediaRecoveryNonce}
              {...(requestCurrentMediaRefresh
                ? { onRequestMediaRefresh: requestCurrentMediaRefresh }
                : {})}
            />
          ))}
      </div>

      {nativeFadeOpacity > 0 && (
        <div
          className="pmx-wp-stage__fade"
          style={{ backgroundColor: nativeFadeColor, opacity: nativeFadeOpacity }}
        />
      )}

      {scrimOpacity > 0 && (
        <div className="pmx-wp-stage__scrim" style={{ opacity: scrimOpacity }} />
      )}
    </div>
  );
}
