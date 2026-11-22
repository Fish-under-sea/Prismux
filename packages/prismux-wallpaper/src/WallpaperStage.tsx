import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { WallpaperStore } from "./store.js";
import { useWallpaperStore } from "./store.js";
import type {
  BuiltinScenePresetId,
  ThemeMode,
  UserPropDef,
  WallpaperItem,
  WallpaperSettingsState,
} from "./types.js";
import { weColorToHex } from "./userProps.js";
import { consumePrewarmedVideo } from "./videoPrewarm.js";

export interface WallpaperStageProps {
  store: WallpaperStore;
  /** External occlusion signal (window minimized / occluded / screen locked). Forces 0 FPS and pauses video immediately. */
  occluded?: boolean;
  /** Optional real-time audio energy scalar (0..1) or frequency bands array (0..1[]). */
  audioEnergy?: number | number[];
  /** Optional explicit web/scene runtime iframe URL resolver for Steam workshop items. */
  resolveLiveRuntimeUrl?: (wallpaper: WallpaperItem, settings: WallpaperSettingsState) => string | null;
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
    vec3 base = u_theme < 0.5 ? vec3(0.91, 0.95, 0.99) : vec3(0.035, 0.062, 0.125);
    vec3 mid = u_theme < 0.5 ? vec3(0.75, 0.86, 0.99) : vec3(0.075, 0.175, 0.345);
    vec3 glow = mix(vec3(0.32, 0.72, 1.0), u_tint, 0.35);
    col = mix(base, mid, ribbon * 0.85);
    col += glow * waveBand * (0.52 + u_audio.x * 0.32) * u_intensity;
    col += vec3(0.68, 0.88, 1.0) * caustic * (0.18 + u_audio.z * 0.20) * u_intensity;
  } else if (u_scene < 1.5) {
    // Scene 1: Midnight Abyss (午夜深海)
    vec3 base = u_theme < 0.5 ? vec3(0.88, 0.96, 0.97) : vec3(0.015, 0.068, 0.105);
    vec3 mid = u_theme < 0.5 ? vec3(0.64, 0.87, 0.90) : vec3(0.038, 0.185, 0.265);
    vec3 bio = mix(vec3(0.14, 0.86, 0.76), u_tint, 0.30);
    float rays = exp(-abs(p.x * 0.7 + p.y * 0.45 + (q - 0.5) * 0.6) * 3.2);
    col = mix(base, mid, ribbon * 0.90);
    col += bio * (waveBand * 0.44 + rays * 0.28 + u_audio.y * 0.18) * u_intensity;
    col += vec3(0.45, 0.94, 0.88) * caustic * (0.20 + u_audio.z * 0.22) * u_intensity;
  } else if (u_scene < 2.5) {
    // Scene 2: Liquid Silk (液态绸光)
    vec3 base = u_theme < 0.5 ? vec3(0.93, 0.93, 0.99) : vec3(0.062, 0.068, 0.152);
    vec3 mid = u_theme < 0.5 ? vec3(0.81, 0.82, 0.98) : vec3(0.155, 0.172, 0.385);
    vec3 pearl = mix(vec3(0.75, 0.72, 1.0), u_tint, 0.32);
    float fold = pow(max(0.0, sin((p.x * 2.4 + p.y * 1.9 + r * 1.8) * 2.2 - t * 0.9)), 3.0);
    col = mix(base, mid, ribbon * 0.82);
    col += pearl * (fold * 0.45 + waveBand * 0.30) * u_intensity;
    col += vec3(0.56, 0.82, 1.0) * caustic * 0.16 * u_intensity;
  } else {
    // Scene 3: Cyber Twilight (赛博暮光)
    vec3 base = u_theme < 0.5 ? vec3(0.97, 0.92, 0.96) : vec3(0.075, 0.042, 0.135);
    vec3 mid = u_theme < 0.5 ? vec3(0.93, 0.78, 0.88) : vec3(0.245, 0.095, 0.335);
    vec3 horizon = mix(vec3(0.98, 0.52, 0.36), u_tint, 0.28);
    vec3 magenta = vec3(0.92, 0.32, 0.66);
    float dusk = exp(-abs(p.y + 0.18 - (q - 0.5) * 0.25) * 3.8);
    col = mix(base, mid, ribbon * 0.85);
    col += horizon * dusk * (0.56 + u_audio.x * 0.28) * u_intensity;
    col += magenta * waveBand * (0.34 + u_audio.y * 0.24) * u_intensity;
    col += vec3(1.0, 0.82, 0.65) * caustic * 0.12 * u_intensity;
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
  const [backend, setBackend] = useState<"webgl2" | "canvas2d">("webgl2");
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

  const controllerRef = useRef<{
    start: () => void;
    stop: () => void;
    paintCurrent: () => void;
  } | null>(null);

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
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId: number | null = null;
    let disposed = false;
    let lastFrameTs = 0;
    let elapsedSec = 0;

    let gl: WebGL2RenderingContext | null = null;
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

    if (gl) {
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
            setBackend("webgl2");
          } else {
            gl.deleteProgram(prog);
          }
        }
      }
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    }

    const ctx2d = !program ? canvas.getContext("2d") : null;
    if (!program) setBackend("canvas2d");

    const syncSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.max(1, Math.floor((rect.width || window.innerWidth || 1280) * dpr));
      const targetH = Math.max(1, Math.floor((rect.height || window.innerHeight || 720) * dpr));
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
      syncSize();
      if (gl && program) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
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
      } else {
        draw2d(t);
      }
    };

    const tick = (ts: number) => {
      if (disposed || liveRef.current.paused) {
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
      if (disposed || liveRef.current.paused || rafId !== null) return;
      lastFrameTs = 0;
      rafId = requestAnimationFrame(tick);
    };

    const paintCurrent = () => {
      if (!disposed) paintOnce(elapsedSec);
    };

    controllerRef.current = { start, stop, paintCurrent };

    // Always paint initial frame even if starting paused so stage is never blank
    paintOnce(elapsedSec);
    if (!liveRef.current.paused) {
      start();
    }

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!liveRef.current.paused) paintOnce(elapsedSec);
          })
        : null;
    ro?.observe(canvas);

    return () => {
      disposed = true;
      stop();
      controllerRef.current = null;
      ro?.disconnect();
      if (gl) {
        if (posBuffer) gl.deleteBuffer(posBuffer);
        if (program) gl.deleteProgram(program);
      }
    };
  }, []);

  // Lightweight pause/resume effect: strict 0 rAF when paused, seamless u_time continuation on resume.
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    if (paused) {
      ctrl.stop();
    } else {
      ctrl.start();
    }
  }, [paused]);

  // Repaint a single static frame if visual uniforms change while paused (still 0 ongoing rAF).
  useEffect(() => {
    if (paused) {
      controllerRef.current?.paintCurrent();
    }
  }, [paused, themeMode, sceneIndex, tintHex, intensity, speed]);

  return (
    <canvas
      ref={canvasRef}
      data-pmx-webwallgl-backend={backend}
      data-pmx-webwallgl-paused={paused ? "1" : "0"}
      className="pmx-wp-stage__media"
    />
  );
}

interface ImageCrossfadeStageProps {
  src: string;
  slides?: string[];
  slideIntervalMs?: number | null;
  paused: boolean;
  mediaStyle: CSSProperties;
  transitionMs: number;
}

function ImageCrossfadeStage({
  src,
  slides,
  slideIntervalMs,
  paused,
  mediaStyle,
  transitionMs,
}: ImageCrossfadeStageProps) {
  const [slideIdx, setSlideIdx] = useState(0);
  const effectiveSrc = slides && slides.length > 1 ? (slides[slideIdx % slides.length] ?? src) : src;

  const [slots, setSlots] = useState<{ current: string; previous: string | null; ready: boolean }>({
    current: effectiveSrc,
    previous: null,
    ready: false,
  });

  useEffect(() => {
    if (!slides || slides.length <= 1 || paused) return;
    const ms = Math.max(5_000, slideIntervalMs ?? 60_000);
    const id = setInterval(() => {
      setSlideIdx((i) => (i + 1) % slides.length);
    }, ms);
    return () => clearInterval(id);
  }, [slides, slideIntervalMs, paused]);

  useEffect(() => {
    setSlots((prev) => {
      if (prev.current === effectiveSrc) return prev;
      return {
        current: effectiveSrc,
        previous: prev.current,
        ready: false,
      };
    });
  }, [effectiveSrc]);

  return (
    <>
      {slots.previous && (
        <img
          key={`prev:${slots.previous}`}
          src={slots.previous}
          alt=""
          className="pmx-wp-stage__media"
          style={{
            ...mediaStyle,
            opacity: slots.ready ? 0 : 1,
            transition: transitionMs > 0 ? `opacity ${transitionMs}ms ease` : "none",
          }}
        />
      )}
      <img
        key={`curr:${slots.current}`}
        src={slots.current}
        alt=""
        className="pmx-wp-stage__media"
        onLoad={() => setSlots((prev) => ({ ...prev, ready: true }))}
        style={{
          ...mediaStyle,
          opacity: slots.ready || !slots.previous ? 1 : 0,
          transition: transitionMs > 0 ? `opacity ${transitionMs}ms ease` : "none",
        }}
      />
    </>
  );
}

interface VideoStageProps {
  src: string;
  poster?: string | null;
  paused: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  loop: boolean;
  mediaStyle: CSSProperties;
  onEnded: () => void;
  onError: (msg: string | null) => void;
}

function VideoStage({
  src,
  poster,
  paused,
  muted,
  volume,
  playbackRate,
  loop,
  mediaStyle,
  onEnded,
  onError,
}: VideoStageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    // Adopt prewarmed metadata element when available (instant start without double decode)
    const adopted = consumePrewarmedVideo(src);
    const video = adopted ?? document.createElement("video");
    videoRef.current = video;

    video.className = "pmx-wp-stage__media";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "auto";
    video.loop = loop;
    video.muted = muted || volume <= 0;
    video.volume = Math.max(0, Math.min(1, volume));
    try {
      video.playbackRate = playbackRate;
    } catch {
      // Ignore unsupported rate
    }
    if (poster) {
      video.poster = poster;
    }
    if (!adopted || video.src !== src) {
      video.src = src;
    }

    const handleContextMenu = (e: Event) => e.preventDefault();
    const handleEnded = () => onEnded();
    const handleError = () => onError("视频壁纸解码失败，请检查文件编码或格式");
    const handleCanPlay = () => onError(null);

    video.addEventListener("contextmenu", handleContextMenu);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("error", handleError);
    video.addEventListener("canplay", handleCanPlay);

    container.replaceChildren(video);

    if (!paused) {
      video.play().catch(() => {
        // Fallback muted autoplay if browser blocks unmuted playback
        video.muted = true;
        video.play().catch(() => {});
      });
    } else {
      video.pause();
    }

    return () => {
      video.removeEventListener("contextmenu", handleContextMenu);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("error", handleError);
      video.removeEventListener("canplay", handleCanPlay);
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {
        // Ignore cleanup errors
      }
      if (videoRef.current === video) videoRef.current = null;
    };
  }, [src]);

  // Sync live playback parameters & immediate occlusion pause without rebuilding <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.loop = loop;
    video.muted = muted || volume <= 0;
    video.volume = Math.max(0, Math.min(1, volume));
    try {
      video.playbackRate = playbackRate;
    } catch {
      // Ignore
    }
    if (paused) {
      video.pause();
    } else {
      video.play().catch(() => {});
    }
  }, [paused, muted, volume, playbackRate, loop]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    Object.assign(video.style, mediaStyle);
  }, [mediaStyle]);

  return <div ref={hostRef} className="pmx-wp-stage__slot" />;
}

interface WebWallpaperStageProps {
  src: string;
  userProps: UserPropDef[];
  paused: boolean;
  fpsLimit: number;
  mediaStyle: CSSProperties;
}

function WebWallpaperStage({
  src,
  userProps,
  paused,
  fpsLimit,
  mediaStyle,
}: WebWallpaperStageProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const postProps = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const properties: Record<string, { value: unknown }> = {};
    for (const p of userProps) {
      properties[p.name] = { value: p.value };
    }
    try {
      win.postMessage(
        {
          type: "wallpaperPropertyListener",
          applyUserProperties: properties,
          applyGeneralProperties: { fps: fpsLimit, paused },
        },
        "*",
      );
    } catch {
      // Sandboxed iframe origin
    }
  };

  useEffect(() => {
    postProps();
  }, [userProps, paused, fpsLimit]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title="Prismux Web Wallpaper"
      sandbox="allow-scripts"
      className="pmx-wp-stage__media pmx-wp-stage__iframe"
      style={mediaStyle}
      onLoad={postProps}
    />
  );
}

interface SteamSceneFallbackProps {
  wallpaper: WallpaperItem;
  themeMode: ThemeMode;
  paused: boolean;
  fpsLimit: number;
  audioReactive: boolean;
  audioEnergy: number | number[];
  mediaStyle: CSSProperties;
}

/**
 * Intelligent Steam Scene fallback chain (never black screen):
 * 1. If previewUrl exists and loads -> animated parallax preview image (halted immediately when paused/occluded).
 * 2. If previewUrl fails or is missing -> deterministic WebWallGL shader tinted by schemeColor.
 */
function SteamSceneFallback({
  wallpaper,
  themeMode,
  paused,
  fpsLimit,
  audioReactive,
  audioEnergy,
  mediaStyle,
}: SteamSceneFallbackProps) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setPreviewFailed(false);
  }, [wallpaper.id, wallpaper.previewUrl]);

  useEffect(() => {
    if (paused || previewFailed || !wallpaper.previewUrl) return;
    let rafId: number | null = null;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;

    const onMove = (e: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      targetX = (e.clientX / w - 0.5) * 14;
      targetY = (e.clientY / h - 0.5) * 10;
      if (rafId === null) {
        rafId = requestAnimationFrame(step);
      }
    };

    const step = () => {
      curX += (targetX - curX) * 0.12;
      curY += (targetY - curY) * 0.12;
      setParallax({ x: curX, y: curY });
      if (Math.abs(targetX - curX) > 0.08 || Math.abs(targetY - curY) > 0.08) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null;
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [paused, previewFailed, wallpaper.previewUrl]);

  if (wallpaper.previewUrl && !previewFailed) {
    const [bass] = normalizeAudioTriple(audioReactive, audioEnergy);
    const baseTransform = typeof mediaStyle.transform === "string" ? mediaStyle.transform : "";
    const extraScale = 1.04 + bass * 0.02;
    return (
      <img
        src={wallpaper.previewUrl}
        alt=""
        className="pmx-wp-stage__media"
        onError={() => setPreviewFailed(true)}
        style={{
          ...mediaStyle,
          transform: `${baseTransform} translate3d(${(-parallax.x).toFixed(2)}px, ${(-parallax.y).toFixed(2)}px, 0) scale(${extraScale.toFixed(3)})`.trim(),
        }}
      />
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

/**
 * Z-0 Fullscreen Wallpaper Stage (strictly zero-token visual host layer).
 */
export function WallpaperStage({
  store,
  occluded: occludedProp,
  audioEnergy: audioEnergyProp,
  resolveLiveRuntimeUrl,
  className,
}: WallpaperStageProps) {
  const snap = useWallpaperStore(store);
  const { settings, wallpapers } = snap;
  const [docHidden, setDocHidden] = useState(false);
  const [winBlurred, setWinBlurred] = useState(false);

  // Respect page visibility & optional blur-pause power settings
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setDocHidden(document.hidden);
    const onBlur = () => setWinBlurred(true);
    const onFocus = () => setWinBlurred(false);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const currentWallpaper = useMemo(
    () => wallpapers.find((w) => w.id === settings.selectedId) ?? null,
    [wallpapers, settings.selectedId],
  );

  const occluded =
    occludedProp === true ||
    snap.occluded === true ||
    (settings.pauseOnHidden && docHidden) ||
    (settings.pauseOnBlur && winBlurred);

  const effectivePaused = occluded || !settings.playing;
  const effectiveAudioEnergy = audioEnergyProp ?? snap.audioEnergy;

  const resolvedProps = useMemo(
    () => (currentWallpaper ? store.getResolvedUserProps(currentWallpaper.id) : []),
    [currentWallpaper, settings.userPropOverrides, snap.propsMap, store],
  );

  const mediaStyle = useMemo<CSSProperties>(() => {
    const objectFit: CSSProperties["objectFit"] =
      settings.objectFit === "center" ? "none" : settings.objectFit;
    const scaleFactor = settings.layerScale / 100;
    const sx = (settings.flipX ? -1 : 1) * scaleFactor;
    const sy = (settings.flipY ? -1 : 1) * scaleFactor;
    const tx = (settings.layerPositionX - 50) * 0.5;
    const ty = (settings.layerPositionY - 50) * 0.5;

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

    return {
      objectFit,
      objectPosition: `${settings.layerPositionX}% ${settings.layerPositionY}%`,
      transform: `translate3d(${tx}%, ${ty}%, 0) scale(${sx}, ${sy})`,
      filter: filterParts.length > 0 ? filterParts.join(" ") : undefined,
    };
  }, [
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
  ]);

  if (!currentWallpaper) {
    return null;
  }

  const activeGroup = settings.rotationGroups.find((g) => g.id === settings.rotationGroupId);
  const videoLoop = !(settings.rotationEnabled && activeGroup?.trigger === "videoEnd");
  const transitionMs = settings.switchTransition === "cut" ? 0 : 420;
  const nativeFadeOpacity = Math.max(0, Math.min(0.9, settings.wallpaperOpacity / 100));
  const nativeFadeColor = settings.themeMode === "light" ? "#ffffff" : "#0b0f19";

  // Extract shader user properties if present
  const propMap = new Map(resolvedProps.map((p) => [p.name, p.value]));
  const shaderSpeed = Number(propMap.get("speed") ?? 1) || 1;
  const shaderIntensity = Number(propMap.get("intensity") ?? 1) || 1;
  const shaderTint =
    typeof propMap.get("tint") === "string"
      ? weColorToHex(propMap.get("tint"), currentWallpaper.schemeColor || "#38bdf8")
      : currentWallpaper.schemeColor || "#38bdf8";
  const shaderParallax = propMap.get("parallax") !== false;

  const liveRuntimeUrl =
    resolveLiveRuntimeUrl && settings.sceneLive
      ? resolveLiveRuntimeUrl(currentWallpaper, settings)
      : null;

  return (
    <div
      aria-hidden="true"
      data-pmx-wallpaper-stage="1"
      data-pmx-wallpaper-id={currentWallpaper.id}
      data-pmx-wallpaper-type={currentWallpaper.type}
      data-pmx-wallpaper-paused={effectivePaused ? "1" : "0"}
      data-pmx-wallpaper-occluded={occluded ? "1" : "0"}
      className={className ? `pmx-wp-stage ${className}` : "pmx-wp-stage"}
    >
      <div className="pmx-wp-stage__viewport">
        {currentWallpaper.type === "image" && currentWallpaper.mediaUrl && (
          <ImageCrossfadeStage
            src={currentWallpaper.mediaUrl}
            slides={currentWallpaper.slides}
            slideIntervalMs={currentWallpaper.slideIntervalMs}
            paused={effectivePaused}
            mediaStyle={mediaStyle}
            transitionMs={transitionMs}
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
            mediaStyle={mediaStyle}
            onEnded={() => store.handleVideoEnded()}
            onError={(msg) => store.setVideoError(msg)}
          />
        )}

        {currentWallpaper.type === "web" && (liveRuntimeUrl || currentWallpaper.mediaUrl) && (
          <WebWallpaperStage
            src={liveRuntimeUrl || currentWallpaper.mediaUrl!}
            userProps={resolvedProps}
            paused={effectivePaused}
            fpsLimit={settings.sceneLiveFps}
            mediaStyle={mediaStyle}
          />
        )}

        {currentWallpaper.type === "scene" &&
          (currentWallpaper.source === "builtin" ? (
            <div className="pmx-wp-stage__slot" style={mediaStyle}>
              <WebWallGLStageCanvas
                sceneIndex={presetToSceneIndex(
                  currentWallpaper.builtinSceneId,
                  currentWallpaper.id,
                )}
                themeMode={settings.themeMode}
                paused={effectivePaused || !settings.sceneLive}
                fpsLimit={settings.sceneLiveFps}
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
              userProps={resolvedProps}
              paused={effectivePaused}
              fpsLimit={settings.sceneLiveFps}
              mediaStyle={mediaStyle}
            />
          ) : (
            <SteamSceneFallback
              wallpaper={currentWallpaper}
              themeMode={settings.themeMode}
              paused={effectivePaused || !settings.sceneLive}
              fpsLimit={settings.sceneLiveFps}
              audioReactive={settings.audioReactive}
              audioEnergy={effectiveAudioEnergy}
              mediaStyle={mediaStyle}
            />
          ))}
      </div>

      {nativeFadeOpacity > 0 && (
        <div
          className="pmx-wp-stage__fade"
          style={{ backgroundColor: nativeFadeColor, opacity: nativeFadeOpacity }}
        />
      )}

      {settings.scrim > 0 && (
        <div
          className="pmx-wp-stage__scrim"
          style={{ opacity: Math.max(0, Math.min(0.9, settings.scrim)) }}
        />
      )}
    </div>
  );
}
