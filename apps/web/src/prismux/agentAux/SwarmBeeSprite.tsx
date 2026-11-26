import { memo, useEffect, useRef, type CSSProperties } from "react";

import { AgentBrandLogo, type AgentBrandId } from "../agentBrand";
import {
  buildBeeTileBackground,
  computeBeeColor,
  computeBeeRamp,
  type AgentAuxMemberVisualStatus,
} from "./agentAux.logic";

export type PixelBeeRenderState = "working" | "waiting_on" | "needs_you" | "parked" | "landed";

export function toPixelBeeState(status: AgentAuxMemberVisualStatus): PixelBeeRenderState {
  switch (status) {
    case "working":
      return "working";
    case "needs_you":
      return "needs_you";
    case "waiting_on":
      return "waiting_on";
    case "parked":
      return "parked";
    case "done":
    case "killed":
    case "error":
      return "landed";
  }
}

/**
 * 1:1 faithful port of Antigravity swarm_board `hive.js` `drawBee(cv, name, state, frame)`
 * (22x18 integer-scaled pixel art bee with queen crown for coordinator, 2-frame wing flap,
 * directional shading, specular glint, blush cheeks, stinger, and sleeping Z).
 */
export function drawBeeToCanvas(
  canvas: HTMLCanvasElement,
  name: string,
  state: PixelBeeRenderState,
  frame: 0 | 1,
): void {
  const W = 22;
  const H = 18;
  canvas.width = W;
  canvas.height = H;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return;
  }
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);

  const R = computeBeeRamp(name);
  const queen = name === "coordinator";
  const landed = state === "parked" || state === "landed";
  const asleep = state === "parked";

  const put = (x: number, y: number, col: string) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  };

  const cx = 11;
  const cy = 10.5;
  const rx = 7.3;
  const ry = 4.8;
  const inside = (x: number, y: number) => {
    const nx = (x + 0.5 - cx) / rx;
    const ny = (y + 0.5 - cy) / ry;
    return nx * nx + ny * ny <= 1;
  };

  const rawL: readonly [number, number, number] = [-0.42, -0.62, 0.66];
  const lNorm = Math.hypot(rawL[0], rawL[1], rawL[2]);
  const L: readonly [number, number, number] = [rawL[0] / lNorm, rawL[1] / lNorm, rawL[2] / lNorm];

  const N4: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const rows = (
    spec: ReadonlyArray<readonly [number, number, number]>,
  ): Array<[number, number]> => {
    const pts: Array<[number, number]> = [];
    for (const [y, x0, x1] of spec) {
      for (let x = x0; x <= x1; x += 1) pts.push([x, y]);
    }
    return pts;
  };

  const drawWing = (pts: ReadonlyArray<readonly [number, number]>, glint: boolean) => {
    const set = new Set(pts.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of pts) {
      const edge = N4.some(([dx, dy]) => !set.has(`${x + dx},${y + dy}`));
      put(x, y, edge ? "rgba(140,160,192,0.9)" : "rgba(255,255,255,0.72)");
    }
    if (glint) {
      const inner = pts
        .filter(([x, y]) => !N4.some(([dx, dy]) => !set.has(`${x + dx},${y + dy}`)))
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const tl = inner[0];
      if (tl) put(tl[0], tl[1], "#FFFFFF");
    }
  };

  let back: Array<[number, number]> | null = null;
  let front: Array<[number, number]>;
  if (landed) {
    front = rows([
      [5, 14, 17],
      [6, 13, 18],
    ]);
  } else if (frame === 0) {
    back = rows([
      [1, 16, 17],
      [2, 16, 18],
      [3, 15, 18],
      [4, 15, 17],
      [5, 15, 16],
    ]);
    front = rows([
      [0, 13, 14],
      [1, 12, 15],
      [2, 11, 15],
      [3, 11, 14],
      [4, 11, 13],
      [5, 11, 12],
    ]);
  } else {
    back = rows([
      [3, 16, 18],
      [4, 15, 19],
      [5, 16, 18],
    ]);
    front = rows([
      [3, 13, 16],
      [4, 12, 17],
      [5, 12, 17],
      [6, 13, 15],
    ]);
  }

  if (back) drawWing(back, false);

  const stripe = (x: number, y: number) => {
    const ny = (y + 0.5 - cy) / ry;
    const u = x + 0.5 + 1.15 * ny * ny;
    return (u > 10.6 && u < 12.5) || (u > 14.3 && u < 16.1) || u > 17.9;
  };

  // Body shading
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (!inside(x, y)) continue;
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const rr = Math.min(1, nx * nx + ny * ny);
      const nz = Math.sqrt(1 - rr);
      const I = nx * L[0] + ny * L[1] + nz * L[2];
      put(
        x,
        y,
        stripe(x, y)
          ? I > 0.8
            ? R.skh
            : I > 0.3
              ? R.sk
              : R.skd
          : I > 0.965
            ? R.spec
            : I > 0.78
              ? R.hi
              : I > 0.26
                ? R.mid
                : R.sh,
      );
    }
  }

  // Outline
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (inside(x, y)) continue;
      const nbs = N4.filter(([dx, dy]) => inside(x + dx, y + dy));
      if (nbs.length === 0) continue;
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const n = Math.hypot(nx, ny);
      const d = (nx / n) * L[0] + (ny / n) * L[1];
      const nextToStripe = nbs.some(([dx, dy]) => stripe(x + dx, y + dy));
      put(x, y, d > 0.5 && !nextToStripe ? R.sh : R.ol);
    }
  }

  // Stinger
  put(19, 10, R.ol);
  put(20, 10, R.ol);

  // Face
  if (asleep) {
    put(6, 10, R.ol);
    put(7, 10, R.ol);
  } else {
    put(6, 9, "#FFFFFF");
    put(7, 9, R.skd);
    put(6, 10, R.skd);
    put(7, 10, R.skd);
  }
  put(5, 11, "rgba(255,128,150,0.55)");
  put(4, 11, "rgba(255,128,150,0.35)");

  // Queen crown or worker antennae
  if (queen) {
    const g1 = "#F7CE5B";
    const g2 = "#FFE9A6";
    const g3 = "#C98A2B";
    for (const [x, y] of [
      [5, 5],
      [6, 5],
      [7, 5],
      [8, 5],
      [9, 5],
    ] as const) {
      put(x, y, g1);
    }
    put(5, 4, g2);
    put(7, 4, g2);
    put(9, 4, g2);
    put(7, 3, g2);
    put(5, 5, g3);
    put(9, 5, g3);
    put(7, 5, "#E4566A");
  } else {
    for (const [x, y] of [
      [7, 5],
      [6, 4],
      [5, 3],
    ] as const) {
      put(x, y, R.ol);
    }
    put(4, 3, R.sk);
    for (const [x, y] of [
      [9, 5],
      [9, 4],
      [9, 3],
    ] as const) {
      put(x, y, R.ol);
    }
    put(8, 2, R.sk);
  }

  drawWing(front, true);

  if (asleep) {
    const z = "#8C90A6";
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [2, 1],
      [1, 2],
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ] as const) {
      put(x, y, z);
    }
  }
}

// Bounded offscreen canvas & data-URL LRU cache (max 256 entries) for SVG <image> rendering.
const MAX_BEE_DATA_URL_CACHE = 256;
const beeDataUrlCache = new Map<string, string>();
let sharedOffscreenCanvas: HTMLCanvasElement | null = null;

export function getBeeSpriteDataUrl(
  name: string,
  state: PixelBeeRenderState = "landed",
  frame: 0 | 1 = 0,
): string {
  const key = `${name}\0${state}\0${frame}`;
  const cached = beeDataUrlCache.get(key);
  if (cached !== undefined) {
    // Refresh LRU order
    beeDataUrlCache.delete(key);
    beeDataUrlCache.set(key, cached);
    return cached;
  }
  if (typeof document === "undefined") {
    return "";
  }
  try {
    if (!sharedOffscreenCanvas) {
      sharedOffscreenCanvas = document.createElement("canvas");
      sharedOffscreenCanvas.width = 22;
      sharedOffscreenCanvas.height = 18;
    }
    drawBeeToCanvas(sharedOffscreenCanvas, name, state, frame);
    const dataUrl = sharedOffscreenCanvas.toDataURL("image/png");
    if (beeDataUrlCache.size >= MAX_BEE_DATA_URL_CACHE) {
      const oldest = beeDataUrlCache.keys().next().value;
      if (oldest !== undefined) beeDataUrlCache.delete(oldest);
    }
    beeDataUrlCache.set(key, dataUrl);
    return dataUrl;
  } catch {
    return "";
  }
}

export function clearBeeSpriteCacheForTest(): void {
  beeDataUrlCache.clear();
}

export interface SwarmBeeSpriteProps {
  readonly name: string;
  readonly state: PixelBeeRenderState;
  /** Integer pixel scale: 1 = 22x18, 2 = 44x36, 3 = 66x54 */
  readonly scale?: 1 | 2 | 3;
  readonly showShadow?: boolean;
  readonly className?: string;
}

export const SwarmBeeSprite = memo(function SwarmBeeSprite({
  name,
  state,
  scale = 2,
  showShadow = false,
  className,
}: SwarmBeeSpriteProps) {
  const frame0Ref = useRef<HTMLCanvasElement | null>(null);
  const frame1Ref = useRef<HTMLCanvasElement | null>(null);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- imperative 2D canvas pixel-art bee repaint on prop change
  useEffect(() => {
    if (frame0Ref.current) drawBeeToCanvas(frame0Ref.current, name, state, 0);
    if (frame1Ref.current) drawBeeToCanvas(frame1Ref.current, name, state, 1);
  }, [name, state]);

  const style = {
    "--pmx-cell": `${scale}px`,
    width: `${22 * scale}px`,
    height: `${18 * scale}px`,
  } as CSSProperties;

  return (
    <span
      className={className ? `pmx-beebox ${className}` : "pmx-beebox"}
      data-bee={name}
      data-state={state}
      style={style}
      aria-hidden="true"
    >
      <span className="pmx-beewrap">
        <canvas ref={frame0Ref} width={22} height={18} />
        <canvas ref={frame1Ref} width={22} height={18} />
      </span>
      {showShadow ? <i className="pmx-gsh" /> : null}
    </span>
  );
});

/**
 * Crisp inline 16x14 pixel-styled queen bee emblem for Overview entry buttons & tab chrome
 * (replaces OS-dependent emoji 🐝 cleanly across Windows/macOS/Linux).
 */
export const SwarmMiniBeeGlyph = memo(function SwarmMiniBeeGlyph({
  size = 15,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}) {
  const height = Math.round((size * 18) / 22);
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 22 18"
      fill="none"
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      style={{ shapeRendering: "crispEdges" }}
      aria-hidden="true"
    >
      {/* Wings */}
      <rect x="12" y="1" width="4" height="3" fill="rgba(255,255,255,0.82)" />
      <rect x="11" y="2" width="4" height="3" fill="rgba(220,234,255,0.85)" />
      {/* Crown */}
      <rect x="5" y="4" width="1" height="1" fill="#FFE9A6" />
      <rect x="7" y="3" width="1" height="2" fill="#FFE9A6" />
      <rect x="9" y="4" width="1" height="1" fill="#FFE9A6" />
      <rect x="5" y="5" width="5" height="1" fill="#F7CE5B" />
      <rect x="7" y="5" width="1" height="1" fill="#E4566A" />
      {/* Body */}
      <rect x="5" y="6" width="12" height="9" rx="3" fill="#F2B830" />
      <rect x="6" y="7" width="4" height="2" fill="#FFE285" />
      {/* Stripes */}
      <rect x="11" y="6" width="2" height="9" fill="#3B2B1A" />
      <rect x="15" y="7" width="2" height="7" fill="#3B2B1A" />
      {/* Eye & blush */}
      <rect x="6" y="9" width="2" height="2" fill="#2A1D12" />
      <rect x="6" y="9" width="1" height="1" fill="#FFFFFF" />
      <rect x="5" y="11" width="1" height="1" fill="#FF8096" />
      {/* Stinger */}
      <rect x="18" y="10" width="2" height="1" fill="#3B2B1A" />
    </svg>
  );
});

export type SwarmTileSize = "xs" | "sm" | "md" | "lg";

export interface SwarmBeeTileProps {
  readonly name: string;
  readonly status: AgentAuxMemberVisualStatus;
  readonly size?: SwarmTileSize;
  readonly showStatusDot?: boolean;
  readonly className?: string;
}

export const SwarmBeeTile = memo(function SwarmBeeTile({
  name,
  status,
  size = "md",
  showStatusDot = false,
  className,
}: SwarmBeeTileProps) {
  const scale: 1 | 2 | 3 = size === "lg" ? 3 : size === "xs" ? 1 : 2;
  const beeState = toPixelBeeState(status);
  const isCoord = name === "coordinator";
  const showDot =
    showStatusDot &&
    (status === "working" ||
      status === "needs_you" ||
      status === "waiting_on" ||
      status === "error");

  return (
    <span
      className={`pmx-bee-tile pmx-bee-tile--${size}${isCoord ? " pmx-bee-tile--coord" : ""}${className ? ` ${className}` : ""}`}
      style={isCoord ? undefined : { background: buildBeeTileBackground(name) }}
      data-bee-tile={name}
    >
      <SwarmBeeSprite name={name} state={beeState} scale={scale} />
      {showDot ? <i className={`pmx-bee-dot pmx-bee-dot--${status}`} /> : null}
    </span>
  );
});

export const SwarmMiniCluster = memo(function SwarmMiniCluster({
  names,
}: {
  readonly names: readonly string[];
}) {
  const picks = [names[0] ?? "coordinator", names[1] ?? "worker-1", names[2] ?? "worker-2"];
  return (
    <span className="pmx-bee-tile pmx-bee-tile--sm pmx-bee-tile--all" aria-hidden="true">
      <span className="pmx-bee-cluster">
        {picks.map((n, idx) => (
          <span
            key={`cluster-slot-${idx === 0 ? "a" : idx === 1 ? "b" : "c"}-${n}`}
            className={`pmx-bee-cluster-slot pmx-bee-cluster-slot--${idx}`}
          >
            <SwarmBeeSprite name={n} state="landed" scale={1} />
          </span>
        ))}
      </span>
    </span>
  );
});

export interface AgentMemberAvatarProps {
  readonly useBees: boolean;
  readonly providerBrand: AgentBrandId;
  readonly name: string;
  readonly displayName: string;
  readonly status: AgentAuxMemberVisualStatus;
  readonly color?: string | null | undefined;
  readonly size?: SwarmTileSize;
  readonly showStatusDot?: boolean;
  readonly isCoordinator?: boolean;
}

export const AgentMemberAvatar = memo(function AgentMemberAvatar({
  useBees,
  providerBrand,
  name,
  displayName,
  status,
  color,
  size = "md",
  showStatusDot = true,
  isCoordinator = false,
}: AgentMemberAvatarProps) {
  if (useBees) {
    return <SwarmBeeTile name={name} status={status} size={size} showStatusDot={showStatusDot} />;
  }

  const accent = color || computeBeeColor(name || displayName || "agent");
  const isCoord = isCoordinator || name === "coordinator";
  const showDot =
    showStatusDot &&
    (status === "working" ||
      status === "needs_you" ||
      status === "waiting_on" ||
      status === "error");
  const iconSize = size === "lg" ? 26 : size === "md" ? 20 : size === "sm" ? 18 : 14;

  return (
    <span
      className={`pmx-agent-avatar pmx-agent-avatar--${size}${isCoord ? " pmx-agent-avatar--coord" : ""}${status === "working" ? " pmx-agent-avatar--working" : ""}${status === "parked" ? " pmx-agent-avatar--parked" : ""}`}
      style={{
        background: `color-mix(in srgb, ${accent} 16%, var(--pmx-aux-card))`,
        borderColor: `color-mix(in srgb, ${accent} 38%, var(--pmx-aux-border))`,
      }}
      data-agent-avatar-brand={providerBrand}
      aria-hidden="true"
    >
      <AgentBrandLogo
        provider={providerBrand}
        size={iconSize}
        online={status === "working"}
        breathing={status === "working"}
      />
      {status === "parked" ? (
        <span className="pmx-agent-avatar-zzz" aria-hidden="true">
          z
        </span>
      ) : null}
      {showDot ? <i className={`pmx-bee-dot pmx-bee-dot--${status}`} /> : null}
    </span>
  );
});
