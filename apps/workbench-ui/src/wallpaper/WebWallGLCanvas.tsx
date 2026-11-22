import { useEffect, useRef, useState } from "react";
import type { AppearanceThemeMode } from "@prismux/protocol";

export interface WebWallGLCanvasProps {
  sceneId?: string;
  themeMode: AppearanceThemeMode;
  paused: boolean;
  fpsLimit: number;
  audioReactive: boolean;
  audioBands: number[];
}

const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec3 u_audio;
uniform float u_theme;
uniform float u_scene;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
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

  float t = u_time * (0.14 + u_audio.x * 0.08);
  float q = fbm(p * 1.9 + vec2(t * 0.35, -t * 0.22));
  float r = fbm(p * 2.6 + vec2(q * 1.4 - t * 0.2, q * 0.9 + t * 0.3));
  float ribbon = smoothstep(0.28, 0.82, fbm(p * 1.5 + vec2(r, q) + u_scene * 0.8));

  float waveBand = exp(-abs(p.y + 0.12 * sin(p.x * 3.1 + t + u_scene) + (r - 0.5) * 0.38) * (4.8 - u_audio.y * 1.5));
  float caustic = pow(max(0.0, 1.0 - abs(sin((p.x + r * 0.6) * 5.0 - t * 1.1))), 4.0);

  vec3 col;
  if (u_theme < 0.5) {
    // Light theme: serene daylight sky + cobalt prism silk
    vec3 skyBase = vec3(0.925, 0.953, 0.988);
    vec3 skyMid = vec3(0.796, 0.882, 0.988);
    vec3 skyGlow = vec3(0.576, 0.773, 0.992);
    col = mix(skyBase, skyMid, ribbon * 0.72);
    col = mix(col, skyGlow, waveBand * (0.42 + u_audio.z * 0.22));
    col += vec3(0.18, 0.32, 0.56) * caustic * 0.12;
  } else if (u_theme < 1.5) {
    // Dark theme: deep indigo night + silver-blue aurora + starfield
    vec3 nightBase = vec3(0.039, 0.063, 0.114);
    vec3 indigoMid = vec3(0.075, 0.137, 0.267);
    vec3 auroraBlue = vec3(0.247, 0.529, 0.961);
    vec3 starHighlight = vec3(0.424, 0.714, 1.0);
    col = mix(nightBase, indigoMid, ribbon * 0.85);
    col += auroraBlue * waveBand * (0.45 + u_audio.x * 0.35);
    col += starHighlight * caustic * 0.16;

    vec2 starGrid = floor((v_uv + parallax * 0.45) * vec2(120.0, 72.0));
    float starSeed = hash21(starGrid);
    if (starSeed > 0.988) {
      float twinkle = 0.5 + 0.5 * sin(u_time * 1.9 + starSeed * 42.0);
      col += starHighlight * twinkle * 0.55;
    }
  } else {
    // Liquid Glass theme: crisp sapphire / ice-cyan optical caustics
    vec3 abyssBase = vec3(0.047, 0.078, 0.149);
    vec3 sapphireMid = vec3(0.082, 0.196, 0.376);
    vec3 iceCyan = vec3(0.424, 0.714, 1.0);
    vec3 prismSpark = vec3(0.729, 0.878, 1.0);
    col = mix(abyssBase, sapphireMid, ribbon * 0.9);
    col += iceCyan * waveBand * (0.58 + u_audio.x * 0.35);
    col += prismSpark * caustic * (0.24 + u_audio.z * 0.25);
  }

  // Micro-dither eliminates 8-bit gradient banding
  float dither = (hash21(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;
  outColor = vec4(clamp(col + dither, 0.0, 1.0), 1.0);
}
`;

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function getThemeFloat(mode: AppearanceThemeMode): number {
  if (mode === "light") {
    return 0.0;
  }
  if (mode === "dark") {
    return 1.0;
  }
  return 2.0;
}

function getSceneFloat(sceneId?: string): number {
  if (sceneId === "starlight-fluid") {
    return 1.0;
  }
  if (sceneId === "prism-mesh") {
    return 2.0;
  }
  return 0.0;
}

function extractAudioTriple(
  audioReactive: boolean,
  audioBands: number[]
): [number, number, number] {
  if (!audioReactive || audioBands.length === 0) {
    return [0, 0, 0];
  }
  const low = Math.min(1, Math.max(0, audioBands[0] ?? 0));
  const midIdx = Math.floor(audioBands.length / 2);
  const mid = Math.min(1, Math.max(0, audioBands[midIdx] ?? low));
  const high = Math.min(
    1,
    Math.max(0, audioBands[audioBands.length - 1] ?? mid)
  );
  return [low, mid, high];
}

export function WebWallGLCanvas({
  sceneId = "aurora-prism",
  themeMode,
  paused,
  fpsLimit,
  audioReactive,
  audioBands
}: WebWallGLCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [backend, setBackend] = useState<"webgl2" | "canvas2d">("webgl2");
  const stateRef = useRef({
    sceneId,
    themeMode,
    paused,
    fpsLimit,
    audioReactive,
    audioBands,
    targetMouseX: 0.5,
    targetMouseY: 0.5,
    mouseX: 0.5,
    mouseY: 0.5
  });

  stateRef.current.sceneId = sceneId;
  stateRef.current.themeMode = themeMode;
  stateRef.current.paused = paused;
  stateRef.current.fpsLimit = fpsLimit;
  stateRef.current.audioReactive = audioReactive;
  stateRef.current.audioBands = audioBands;

  useEffect(() => {
    const onPointerMove = (e: PointerEvent): void => {
      if (stateRef.current.paused) {
        return;
      }
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      stateRef.current.targetMouseX = Math.min(1, Math.max(0, e.clientX / w));
      stateRef.current.targetMouseY = Math.min(1, Math.max(0, 1 - e.clientY / h));
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

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
        powerPreference: "low-power"
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

    if (gl) {
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
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
              gl.STATIC_DRAW
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
    if (!program) {
      setBackend("canvas2d");
    }

    const syncCanvasSize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.max(1, Math.floor((rect.width || window.innerWidth || 1280) * dpr));
      const targetH = Math.max(1, Math.floor((rect.height || window.innerHeight || 720) * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    const draw2dFallback = (t: number): void => {
      if (!ctx2d) {
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      const snap = stateRef.current;
      const [bass, mid] = extractAudioTriple(snap.audioReactive, snap.audioBands);

      const grad = ctx2d.createLinearGradient(0, 0, w, h);
      if (snap.themeMode === "light") {
        grad.addColorStop(0, "#ebf3fe");
        grad.addColorStop(0.5, "#dbeafe");
        grad.addColorStop(1, "#f4f7fc");
      } else if (snap.themeMode === "dark") {
        grad.addColorStop(0, "#09101d");
        grad.addColorStop(0.5, "#112242");
        grad.addColorStop(1, "#0b1324");
      } else {
        grad.addColorStop(0, "#0b172c");
        grad.addColorStop(0.5, "#14315c");
        grad.addColorStop(1, "#0d213f");
      }
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, 0, w, h);

      const cx = w * (0.45 + (snap.mouseX - 0.5) * 0.14 + Math.sin(t * 0.3) * 0.08);
      const cy = h * (0.42 + (0.5 - snap.mouseY) * 0.12 + Math.cos(t * 0.25) * 0.06);
      const radius = Math.max(w, h) * (0.42 + bass * 0.08 + mid * 0.04);
      const glow = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, radius);
      if (snap.themeMode === "light") {
        glow.addColorStop(0, "rgba(108, 182, 255, 0.38)");
        glow.addColorStop(1, "rgba(255, 255, 255, 0)");
      } else {
        glow.addColorStop(0, "rgba(108, 182, 255, 0.34)");
        glow.addColorStop(0.5, "rgba(59, 130, 246, 0.14)");
        glow.addColorStop(1, "rgba(12, 17, 27, 0)");
      }
      ctx2d.fillStyle = glow;
      ctx2d.fillRect(0, 0, w, h);
    };

    const drawFrame = (ts: number): void => {
      if (disposed || stateRef.current.paused) {
        rafId = null;
        return;
      }

      const snap = stateRef.current;
      const minInterval = 1000 / Math.max(1, snap.fpsLimit || 60);
      if (lastFrameTs === 0 || ts - lastFrameTs >= minInterval) {
        const dt = lastFrameTs === 0 ? 0.016 : Math.min(0.1, (ts - lastFrameTs) / 1000);
        lastFrameTs = ts;
        elapsedSec += dt;

        snap.mouseX += (snap.targetMouseX - snap.mouseX) * 0.08;
        snap.mouseY += (snap.targetMouseY - snap.mouseY) * 0.08;

        syncCanvasSize();

        if (gl && program) {
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.useProgram(program);
          gl.uniform2f(uResolution, canvas.width, canvas.height);
          gl.uniform1f(uTime, elapsedSec);
          gl.uniform2f(uMouse, snap.mouseX, snap.mouseY);
          const [bass, mid, high] = extractAudioTriple(
            snap.audioReactive,
            snap.audioBands
          );
          gl.uniform3f(uAudio, bass, mid, high);
          gl.uniform1f(uTheme, getThemeFloat(snap.themeMode));
          gl.uniform1f(uScene, getSceneFloat(snap.sceneId));
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } else {
          draw2dFallback(elapsedSec);
        }
      }

      rafId = requestAnimationFrame(drawFrame);
    };

    syncCanvasSize();
    if (!paused) {
      // Paint initial frame immediately so first paint is never blank
      if (gl && program) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.uniform2f(uResolution, canvas.width, canvas.height);
        gl.uniform1f(uTime, 0);
        gl.uniform2f(uMouse, 0.5, 0.5);
        gl.uniform3f(uAudio, 0, 0, 0);
        gl.uniform1f(uTheme, getThemeFloat(themeMode));
        gl.uniform1f(uScene, getSceneFloat(sceneId));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        draw2dFallback(0);
      }
      rafId = requestAnimationFrame(drawFrame);
    }

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!stateRef.current.paused) {
              syncCanvasSize();
            }
          })
        : null;
    resizeObserver?.observe(canvas);

    return () => {
      disposed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      resizeObserver?.disconnect();
      if (gl) {
        if (posBuffer) gl.deleteBuffer(posBuffer);
        if (program) gl.deleteProgram(program);
      }
    };
  }, [paused, themeMode, sceneId, fpsLimit]);

  return (
    <canvas
      ref={canvasRef}
      data-webwallgl-backend={backend}
      data-webwallgl-paused={paused ? "1" : "0"}
      style={{
        width: "100%",
        height: "100%",
        display: "block"
      }}
    />
  );
}
