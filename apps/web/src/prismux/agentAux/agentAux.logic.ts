import type {
  OrchestrationV2NativeChildStep,
  OrchestrationV2NativeChildWork,
  ThreadId,
} from "@prismux/core-contracts";
import { formatSubagentDisplayTitle } from "@prismux/client-runtime/state/subagent-display";

import { formatAgentBrandName, resolveAgentBrandId, type AgentBrandId } from "../agentBrand";
import type {
  DaemonAgentAuxInspectResponse,
  DaemonAgentAuxNativeStepDto,
} from "../daemonClient";

export type AgentAuxViewKind =
  | "agy-swarm"
  | "agy-subagents"
  | "claude-team"
  | "claude-subagents"
  | "codex-collab"
  | "provider-subagents";

export type AgentAuxTabId = "overview" | "board" | "members" | "graph" | "tasks";

export type AgentAuxMemberVisualStatus =
  | "working"
  | "waiting_on"
  | "needs_you"
  | "parked"
  | "done"
  | "killed"
  | "error";

export interface AgentAuxTabDescriptor {
  readonly id: AgentAuxTabId;
  readonly label: string;
  readonly count?: number;
  readonly badge?: number;
}

export interface AgentAuxGoal {
  readonly title: string;
  readonly line: string;
}

export interface AgentAuxPhase {
  readonly label: string;
  readonly index: number;
  readonly total: number;
}

export interface AgentAuxWorkstreamProgress {
  readonly done: number;
  readonly total: number;
  readonly label: string;
}

export interface AgentAuxWorkstream {
  readonly id: string;
  readonly title: string;
  readonly state: "running" | "blocked" | "review" | "queued" | "done";
  readonly owners: readonly string[];
  readonly note: string;
  readonly progress: AgentAuxWorkstreamProgress | null;
  readonly blockedOn: string | null;
  readonly seq: number;
}

export interface AgentAuxThreadGroup {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly now: string;
  readonly workstreams: readonly string[];
}

export interface AgentAuxAttentionItem {
  readonly id: string;
  readonly kind: "decision" | "failure" | "review" | "stuck" | "quota" | "error" | "fyi";
  readonly severity: "high" | "med" | "low";
  readonly title: string;
  readonly why: string;
  readonly from: string;
  readonly seq: number | null;
  readonly wait: "you" | "coordinator" | "issue" | null;
}

export interface AgentAuxStepItem {
  readonly index: number;
  readonly type: string;
  readonly status: string | null;
  readonly text: string | null;
  readonly toolCalls: ReadonlyArray<{ readonly name: string; readonly summary: string }>;
}

export interface AgentAuxMember {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly role: string;
  readonly roleLabel: string;
  readonly title: string;
  readonly model: string;
  readonly status: AgentAuxMemberVisualStatus;
  readonly statusLabel: string;
  readonly waitingOn: string | null;
  readonly wakeMode: string;
  readonly steps: number;
  readonly posts: number;
  readonly unread: number;
  readonly activity: string;
  readonly activityKind: "tool" | "thinking" | "";
  readonly nowLine: string;
  readonly lastSeq: number;
  readonly lastTime: string;
  readonly killed: boolean;
  readonly isCoordinator: boolean;
  readonly isSystem: boolean;
  readonly isYou: boolean;
  readonly childThreadId: ThreadId | null;
  readonly conversationId: string | null;
  readonly color: string | null;
  readonly backendType: string | null;
  readonly workspace: string | null;
  readonly workspaceMode: string | null;
  readonly failureText: string | null;
  readonly nativeSteps?: readonly AgentAuxStepItem[];
}

export interface AgentAuxBoardMessage {
  readonly seq: number;
  readonly agent: string;
  readonly recipient?: string;
  readonly text: string;
  readonly summary?: string;
  readonly time: string;
  readonly ts: number | null;
  readonly mentions: readonly string[];
  readonly all: boolean;
  readonly channel?: string;
  readonly isControl: boolean;
  readonly isDirectToYou: boolean;
  readonly isUnread: boolean;
  readonly color?: string;
}

export interface AgentAuxEdge {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly direct: number;
  readonly viaAll: number;
}

export interface AgentAuxTask {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly status: "pending" | "in_progress" | "completed" | "blocked";
  readonly owner: string;
  readonly blockedBy: readonly string[];
  readonly progressLabel?: string;
  readonly source: "claude-tasks" | "codex-goals" | "thread-plan";
}

export interface AgentAuxViewModel {
  readonly active: boolean;
  readonly hasLiveActivity: boolean;
  readonly kind: AgentAuxViewKind | null;
  readonly provider: string | null;
  readonly providerBrand: AgentBrandId;
  readonly title: string;
  readonly badgeLabel: string;
  readonly entryLabel: string;
  readonly activationKey: string | null;
  readonly selfMember: string | null;
  readonly headSeq: number;
  readonly unreadSeqBoundary: number | null;
  readonly tabs: readonly AgentAuxTabDescriptor[];
  readonly defaultTab: AgentAuxTabId;
  readonly statusLine: string;
  readonly activeCount: number;
  readonly waitingCount: number;
  readonly retiredCount: number;
  readonly messageCount: number;
  readonly goal: AgentAuxGoal | null;
  readonly headline: string;
  readonly phase: AgentAuxPhase | null;
  readonly workstreams: readonly AgentAuxWorkstream[];
  readonly threadGroups: readonly AgentAuxThreadGroup[];
  readonly attention: readonly AgentAuxAttentionItem[];
  readonly members: readonly AgentAuxMember[];
  readonly messages: readonly AgentAuxBoardMessage[];
  readonly edges: readonly AgentAuxEdge[];
  readonly tasks: readonly AgentAuxTask[];
  readonly finished: boolean;
  readonly updatedAt: number;
}

// ---------------------------------------------------------------------------
// 1:1 AGY Pixel Bee Color Ramp (mirrors hive.js lines 19-32)
// ---------------------------------------------------------------------------

const BEE_HUE_FIXED: Readonly<Record<string, number>> = { coordinator: 46 };
const BEE_HUE_PALETTE = [12, 150, 262, 330, 196, 228, 96, 28, 290, 175, 350, 60] as const;

export interface BeeColorRamp {
  readonly spec: string;
  readonly hi: string;
  readonly mid: string;
  readonly sh: string;
  readonly ol: string;
  readonly skh: string;
  readonly sk: string;
  readonly skd: string;
}

export function hashBeeName(name: string): number {
  let acc = 7;
  for (const ch of name) {
    acc = (acc * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return acc;
}

export function computeBeeHue(name: string): number {
  const fixed = BEE_HUE_FIXED[name];
  if (fixed !== undefined) return fixed;
  const idx = hashBeeName(String(name)) % BEE_HUE_PALETTE.length;
  return BEE_HUE_PALETTE[idx] ?? 196;
}

export function hsl2hex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (
    "#" +
    [f(0), f(8), f(4)]
      .map((x) => Math.round(x * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function shiftHue(h: number, target: number, amt: number): number {
  const d = ((target - h + 540) % 360) - 180;
  return h + d * amt;
}

export function computeBeeColor(name: string): string {
  return hsl2hex(computeBeeHue(name), 78, 60);
}

export function computeBeeRamp(name: string): BeeColorRamp {
  const h = computeBeeHue(name);
  return {
    spec: hsl2hex(shiftHue(h, 55, 0.28), 96, 90),
    hi: hsl2hex(shiftHue(h, 55, 0.18), 90, 74),
    mid: hsl2hex(h, 78, 60),
    sh: hsl2hex(shiftHue(h, 265, 0.22), 58, 44),
    ol: hsl2hex(shiftHue(h, 265, 0.35), 42, 19),
    skh: hsl2hex(shiftHue(h, 265, 0.15), 20, 30),
    sk: hsl2hex(shiftHue(h, 265, 0.3), 24, 18),
    skd: hsl2hex(shiftHue(h, 265, 0.45), 32, 10),
  };
}

const HEX_PATTERN_URI = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='24.25' viewBox='0 0 28 24.25'><path d='M14 0l12.12 7v14l-12.12 7L1.88 21V7z' fill='none' stroke='rgba(255,255,255,0.08)' stroke-width='1.2'/></svg>",
).replace(/'/g, "%27");

export function buildBeeTileBackground(name: string): string {
  if (name === "coordinator") {
    return `#1C1B22 url('data:image/svg+xml,${HEX_PATTERN_URI}')`;
  }
  return `color-mix(in srgb, ${computeBeeColor(name)} 22%, var(--pmx-aux-card, var(--card, #ffffff)))`;
}

// ---------------------------------------------------------------------------
// Mention Parser & Board Text Tokenizer (mirrors AGY channels.mjs + app.js)
// ---------------------------------------------------------------------------

const NAME_RUNE_RE = /[\p{L}\p{Nd}_-]/u;

function hasNamedToken(lowerText: string, lowerName: string): boolean {
  if (!lowerName) return false;
  for (let i = lowerText.indexOf("@"); i >= 0; i = lowerText.indexOf("@", i + 1)) {
    if (i > 0) {
      const before = [...lowerText.slice(Math.max(0, i - 2), i)].pop();
      if (before && NAME_RUNE_RE.test(before)) continue;
    }
    if (!lowerText.startsWith(lowerName, i + 1)) continue;
    const j = i + 1 + lowerName.length;
    if (j >= lowerText.length) return true;
    const cp = lowerText.codePointAt(j);
    if (cp === undefined || !NAME_RUNE_RE.test(String.fromCodePoint(cp))) {
      return true;
    }
  }
  return false;
}

export function parseBoardMentions(
  text: string,
  names: readonly string[],
): { readonly mentions: readonly string[]; readonly all: boolean } {
  const lower = String(text || "").toLowerCase();
  const mentions = names.filter((n) => {
    const ln = String(n).toLowerCase();
    if (hasNamedToken(lower, ln)) return true;
    const m = /^(.+)-\d+$/.exec(ln);
    return Boolean(m?.[1] && hasNamedToken(lower, m[1]));
  });
  return { mentions, all: hasNamedToken(lower, "all") };
}

export type BoardBodyToken =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "mention"; readonly value: string; readonly name: string; readonly isAll: boolean }
  | { readonly kind: "seq"; readonly value: string; readonly seq: number }
  | { readonly kind: "code"; readonly value: string };

const BOARD_TOKEN_RE =
  /(`[^`\n]+`)|((?<![\p{L}\p{Nd}_-])@[A-Za-z0-9][A-Za-z0-9_-]{0,31})|((?<![\p{L}\p{Nd}_/-])#(\d{1,6})\b)/gu;

export function tokenizeBoardText(
  text: string,
  knownNames: ReadonlySet<string>,
  maxSeq = Number.MAX_SAFE_INTEGER,
): readonly BoardBodyToken[] {
  const tokens: BoardBodyToken[] = [];
  const lowerKnown = new Set([...knownNames].map((n) => n.toLowerCase()));
  let cursor = 0;

  for (const match of text.matchAll(BOARD_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      tokens.push({ kind: "text", value: text.slice(cursor, start) });
    }
    const raw = match[0];
    if (match[1]) {
      tokens.push({ kind: "code", value: raw.slice(1, -1) });
    } else if (match[2]) {
      const name = raw.slice(1);
      const lower = name.toLowerCase();
      if (lower === "all" || lowerKnown.size === 0 || lowerKnown.has(lower)) {
        tokens.push({ kind: "mention", value: raw, name, isAll: lower === "all" });
      } else {
        tokens.push({ kind: "text", value: raw });
      }
    } else if (match[3] && match[4]) {
      const seq = Number.parseInt(match[4], 10);
      if (Number.isFinite(seq) && seq >= 1 && seq <= maxSeq) {
        tokens.push({ kind: "seq", value: `#${seq}`, seq });
      } else {
        tokens.push({ kind: "text", value: raw });
      }
    }
    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    tokens.push({ kind: "text", value: text.slice(cursor) });
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Chinese Localization Helpers
// ---------------------------------------------------------------------------

export function formatAuxRoleLabel(role: string, isCoordinator = false): string {
  if (isCoordinator) return "协调者";
  const lower = role.trim().toLowerCase();
  switch (lower) {
    case "coordinator":
    case "team-lead":
    case "lead":
      return "协调者";
    case "worker":
    case "teammate":
      return "工人";
    case "narrator":
      return "播报员";
    case "monitor":
      return "监控";
    case "reviewer":
    case "verifier":
      return "审查员";
    case "subagent":
    case "":
      return "子代理";
    default:
      return role;
  }
}

export function formatAuxStatusLabel(
  status: AgentAuxMemberVisualStatus,
  waitingOn?: string | null,
): string {
  switch (status) {
    case "working":
      return "运行中";
    case "waiting_on":
      return waitingOn ? `等待 @${waitingOn}` : "等待中";
    case "needs_you":
      return "需你介入";
    case "parked":
      return "等待中";
    case "done":
      return "已完成";
    case "killed":
      return "已结束";
    case "error":
      return "异常";
  }
}

export function formatAuxTaskStatusLabel(status: AgentAuxTask["status"]): string {
  switch (status) {
    case "in_progress":
      return "进行中";
    case "completed":
      return "已完成";
    case "blocked":
      return "已阻塞";
    case "pending":
      return "待开始";
  }
}

export function formatAuxClockTime(ts: number | null, fallback = ""): string {
  if (ts === null || !Number.isFinite(ts)) {
    return fallback.length > 16 ? fallback.slice(11, 16) : fallback;
  }
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return fallback;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  const mon = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${mon}-${day} ${hh}:${mm}`;
}

export function parseSidecarSwarmLink(href: string): { readonly swarmPath: string } | null {
  const trimmed = href.trim();
  if (!/^sidecar:\/\/swarm(?:\/|$|\?)/i.test(trimmed)) return null;
  return { swarmPath: trimmed.slice("sidecar://swarm".length) };
}

// ---------------------------------------------------------------------------
// Honeycomb Hive & Mention Graph Layout (mirrors AGY hive.js + app.js)
// ---------------------------------------------------------------------------

const HV_RING: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
];

const HV_FEW: Readonly<Record<number, readonly number[]>> = {
  1: [0],
  2: [5, 1],
  3: [0, 2, 4],
  4: [5, 1, 4, 2],
  5: [5, 0, 1, 4, 2],
};

export function computeHiveHexSlots(count: number): ReadonlyArray<readonly [number, number]> {
  if (count < 1) return [];
  const preset = HV_FEW[count];
  if (preset) {
    return preset.map((k) => HV_RING[k] ?? ([0, -1] as const));
  }
  const out: Array<readonly [number, number]> = [];
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, -1],
  ];
  for (let ring = 1; out.length < count; ring += 1) {
    let q = 0;
    let r = -ring;
    for (const [dq, dr] of dirs) {
      for (let j = 0; j < ring; j += 1) {
        out.push([q, r]);
        q += dq;
        r += dr;
      }
    }
  }
  return out.slice(0, count);
}

export function buildHexPolygonPath(cx: number, cy: number, radius: number, startAngleDeg = 0): string {
  let d = "";
  for (let k = 0; k < 6; k += 1) {
    const rad = ((startAngleDeg + 60 * k) * Math.PI) / 180;
    const x = (cx + radius * Math.cos(rad)).toFixed(1);
    const y = (cy + radius * Math.sin(rad)).toFixed(1);
    d += `${k === 0 ? "M" : "L"}${x} ${y}`;
  }
  return `${d}Z`;
}

export interface HiveCellNode {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly progressFraction: number;
  readonly done: number;
  readonly total: number;
  readonly isHub: boolean;
  readonly members: readonly string[];
  readonly pathD: string;
  readonly progPathD: string;
}

export interface HiveBeePlacement {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly size: "xs" | "sm" | "lg";
  readonly state: AgentAuxMemberVisualStatus;
  readonly isQueen: boolean;
  readonly killed: boolean;
}

export interface HiveBeamEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly pathD: string;
  readonly x2: number;
  readonly y2: number;
  readonly kind: "beam" | "wait";
}

export interface HiveLayoutResult {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly mode: "full" | "mid" | "tiny";
  readonly cells: readonly HiveCellNode[];
  readonly bees: readonly HiveBeePlacement[];
  readonly beams: readonly HiveBeamEdge[];
}

export function computeHiveLayout(input: {
  readonly model: AgentAuxViewModel;
  readonly containerWidth: number;
  readonly replaySeq: number | null;
  readonly hideInactive: boolean;
}): HiveLayoutResult {
  const { model, replaySeq, hideInactive } = input;
  const W = Math.max(280, Math.floor(input.containerWidth || 360));
  const nonSystem = model.members.filter((m) => !m.isSystem);

  const visibleMessages =
    replaySeq === null
      ? model.messages.filter((m) => !m.isControl)
      : model.messages.filter((m) => !m.isControl && m.seq <= replaySeq);

  const activeNames = new Set<string>();
  for (const m of visibleMessages) {
    activeNames.add(m.agent);
    for (const t of m.mentions) activeNames.add(t);
  }

  const members = nonSystem.filter((m) => {
    if (!hideInactive) return true;
    if (m.isCoordinator) return true;
    if (m.killed) return false;
    return m.status === "working" || activeNames.has(m.name);
  });

  const coordinator = members.find((m) => m.isCoordinator) ?? members[0] ?? null;
  const workers = members.filter((m) => m.name !== coordinator?.name);

  // Build cells around the coordinator hub
  const rawCells: Array<{
    id: string;
    title: string;
    goal: string;
    members: string[];
    done: number;
    total: number;
  }> = [];

  if (model.threadGroups.length > 0) {
    const wsById = new Map(model.workstreams.map((w) => [w.id, w]));
    const homed = new Set<string>();
    for (const tg of model.threadGroups) {
      const wsList = tg.workstreams
        .map((id) => wsById.get(id))
        .filter((w): w is AgentAuxWorkstream => Boolean(w));
      const cellMembers = workers
        .filter((w) => wsList.some((ws) => ws.owners.includes(w.name)))
        .map((w) => w.name);
      for (const n of cellMembers) homed.add(n);
      rawCells.push({
        id: tg.id,
        title: tg.title,
        goal: tg.goal,
        members: cellMembers,
        done: wsList.filter((w) => w.state === "done").length,
        total: Math.max(wsList.length, cellMembers.length),
      });
    }
    const rest = workers.filter((w) => !homed.has(w.name));
    if (rest.length > 0) {
      rawCells.push({
        id: "_other",
        title: "其他协同",
        goal: "",
        members: rest.map((w) => w.name),
        done: rest.filter((w) => w.status === "done" || w.killed).length,
        total: rest.length,
      });
    }
  } else {
    const groups: Array<{
      id: string;
      title: string;
      pick: (m: AgentAuxMember) => boolean;
      doneGroup?: boolean;
    }> = [
      { id: "_working", title: "运行中", pick: (m) => m.status === "working" },
      {
        id: "_waiting",
        title: "等待 / 阻塞",
        pick: (m) => m.status === "waiting_on" || m.status === "needs_you" || m.status === "error",
      },
      { id: "_resting", title: "待命", pick: (m) => m.status === "parked" },
      { id: "_done", title: "已完成", pick: (m) => m.status === "done" || m.killed, doneGroup: true },
    ];
    for (const g of groups) {
      const picked = workers.filter(g.pick);
      if (picked.length > 0) {
        rawCells.push({
          id: g.id,
          title: g.title,
          goal: "",
          members: picked.map((m) => m.name),
          done: g.doneGroup ? picked.length : 0,
          total: picked.length,
        });
      }
    }
  }

  const K = Math.sqrt(3) / 2;
  const slots = computeHiveHexSlots(rawCells.length);
  const ux = (q: number) => 1.5 * q;
  const uy = (q: number, r: number) => 2 * K * (r + q / 2);

  const xs = [0, ...slots.map(([q]) => ux(q))];
  const ys = [0, ...slots.map(([q, r]) => uy(q, r))];
  const spanX = Math.max(...xs) - Math.min(...xs) + 2;
  const spanY = Math.max(...ys) - Math.min(...ys) + 2 * K;
  const fit = (W - 12) / spanX;
  const gap = fit < 44 ? 4 : 8;
  const R = Math.max(36, Math.min(96, fit - gap / 2));
  const G = R + gap / 2;
  const mode: "full" | "mid" | "tiny" = R >= 72 ? "full" : R >= 46 ? "mid" : "tiny";
  const CW = Math.max(W, Math.ceil(spanX * G + 12));
  const ox = CW / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * G;
  const oy = 8 + K * R - Math.min(...ys) * G;
  const H = Math.max(210, Math.ceil(spanY * G + 16));

  const memberByName = new Map(members.map((m) => [m.name, m]));
  const totalDone = model.workstreams.filter((w) => w.state === "done").length;
  const totalWs = Math.max(1, model.workstreams.length);

  const cells: HiveCellNode[] = [];
  const bees: HiveBeePlacement[] = [];
  const posByName = new Map<string, { x: number; y: number }>();

  // Center hub cell for coordinator
  const hubTitle = coordinator ? (coordinator.isCoordinator ? "协调者" : coordinator.displayName) : "协调中枢";
  cells.push({
    id: "_hub",
    title: hubTitle,
    goal: model.goal?.title ?? "",
    cx: ox,
    cy: oy,
    radius: R,
    progressFraction: totalDone / totalWs,
    done: totalDone,
    total: model.workstreams.length,
    isHub: true,
    members: coordinator ? [coordinator.name] : [],
    pathD: buildHexPolygonPath(ox, oy, R, 0),
    progPathD: buildHexPolygonPath(ox, oy, R - 2.5, -120),
  });

  if (coordinator) {
    const cx = ox;
    const cy = mode === "full" ? oy - R * 0.14 : oy - 6;
    posByName.set(coordinator.name, { x: cx, y: cy });
    bees.push({
      name: coordinator.name,
      x: cx,
      y: cy,
      size: mode === "full" ? "lg" : "sm",
      state: coordinator.status,
      isQueen: coordinator.isCoordinator,
      killed: coordinator.killed,
    });
  }

  rawCells.forEach((cell, idx) => {
    const slot = slots[idx] ?? ([0, -1] as const);
    const cx = ox + ux(slot[0]) * G;
    const cy = oy + uy(slot[0], slot[1]) * G;
    const frac = cell.total > 0 ? cell.done / cell.total : 0;
    cells.push({
      id: cell.id,
      title: cell.title,
      goal: cell.goal,
      cx,
      cy,
      radius: R,
      progressFraction: frac,
      done: cell.done,
      total: cell.total,
      isHub: false,
      members: cell.members,
      pathD: buildHexPolygonPath(cx, cy, R, 0),
      progPathD: buildHexPolygonPath(cx, cy, R - 2.5, -120),
    });

    const visibleBees = cell.members.slice(0, mode === "full" ? 4 : 3);
    const beeSize: "xs" | "sm" = mode === "full" ? "sm" : "xs";
    const stepX = mode === "full" ? 46 : 26;
    const by = cy + R * 0.22;
    visibleBees.forEach((name, j) => {
      const m = memberByName.get(name);
      if (!m) return;
      const bx = cx + (j - (visibleBees.length - 1) / 2) * stepX;
      posByName.set(name, { x: bx, y: by });
      bees.push({
        name,
        x: bx,
        y: by,
        size: beeSize,
        state: m.status,
        isQueen: m.isCoordinator,
        killed: m.killed,
      });
    });
  });

  // Compute beam for the latest/replayed message
  const beams: HiveBeamEdge[] = [];
  const activeMsg = visibleMessages.at(-1) ?? null;
  if (activeMsg) {
    const srcPos = posByName.get(activeMsg.agent);
    if (srcPos) {
      const targets = activeMsg.all
        ? members.filter((m) => m.name !== activeMsg.agent).map((m) => m.name)
        : [...activeMsg.mentions];
      for (const target of targets) {
        const dstPos = posByName.get(target);
        if (!dstPos) continue;
        const dx = dstPos.x - srcPos.x;
        const dy = dstPos.y - srcPos.y;
        const len = Math.hypot(dx, dy);
        if (len < 24) continue;
        const mx = (srcPos.x + dstPos.x) / 2 - (dy / len) * 18;
        const my = (srcPos.y + dstPos.y) / 2 + (dx / len) * 18;
        beams.push({
          id: `beam:${activeMsg.seq}:${activeMsg.agent}->${target}`,
          from: activeMsg.agent,
          to: target,
          pathD: `M${srcPos.x.toFixed(1)} ${srcPos.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${dstPos.x.toFixed(1)} ${dstPos.y.toFixed(1)}`,
          x2: dstPos.x,
          y2: dstPos.y,
          kind: "beam",
        });
      }
    }
  }

  return { width: CW, height: H, radius: R, mode, cells, bees, beams };
}

export interface MentionGraphNode {
  readonly name: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly status: AgentAuxMemberVisualStatus;
  readonly killed: boolean;
  readonly isCoordinator: boolean;
  readonly isHot: boolean;
  readonly broadcastCount: number;
}

export interface MentionGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly viaAllOnly: boolean;
  readonly isCurrent: boolean;
  readonly pathD: string;
  readonly labelX: number;
  readonly labelY: number;
  readonly endX: number;
  readonly endY: number;
}

export interface MentionGraphLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly MentionGraphNode[];
  readonly edges: readonly MentionGraphEdge[];
  readonly currentMessage: AgentAuxBoardMessage | null;
}

export function computeMentionGraphLayout(input: {
  readonly model: AgentAuxViewModel;
  readonly width: number;
  readonly replaySeq: number | null;
  readonly hideInactive: boolean;
  readonly expandAll: boolean;
}): MentionGraphLayout {
  const { model, replaySeq, hideInactive, expandAll } = input;
  const W = Math.max(300, Math.floor(input.width || 360));
  const nonSystem = model.members.filter((m) => !m.isSystem);

  const msgs = (
    replaySeq === null
      ? model.messages
      : model.messages.filter((m) => m.seq <= replaySeq)
  ).filter((m) => !m.isControl);

  const currentMessage = msgs.at(-1) ?? null;

  const participantSet = new Set<string>();
  const broadcastCounts = new Map<string, number>();
  for (const m of msgs) {
    participantSet.add(m.agent);
    for (const t of m.mentions) participantSet.add(t);
    if (m.all) {
      broadcastCounts.set(m.agent, (broadcastCounts.get(m.agent) ?? 0) + 1);
    }
  }

  const visibleMembers = nonSystem.filter((m) => {
    if (!hideInactive) return true;
    if (m.isCoordinator) return true;
    if (currentMessage && (currentMessage.agent === m.name || currentMessage.mentions.includes(m.name))) {
      return true;
    }
    if (m.killed) return false;
    return m.status === "working" || participantSet.has(m.name);
  });

  const visibleNameSet = new Set(visibleMembers.map((m) => m.name));
  const H = Math.max(240, Math.min(380, 170 + visibleMembers.length * 16));
  const cx = W / 2;
  const cy = H / 2;
  const rx = Math.max(76, W / 2 - 72);
  const ry = Math.max(66, H / 2 - 44);

  const coordinator = visibleMembers.find((m) => m.isCoordinator);
  const others = visibleMembers.filter((m) => m.name !== coordinator?.name);

  const nodes: MentionGraphNode[] = [];
  const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();

  const makeNode = (m: AgentAuxMember, x: number, y: number): MentionGraphNode => {
    const w = Math.min(136, Math.max(76, m.displayName.length * 7.5 + 34));
    const h = 28;
    posMap.set(m.name, { x, y, w, h });
    const isHot = Boolean(
      currentMessage &&
        (currentMessage.agent === m.name ||
          currentMessage.mentions.includes(m.name) ||
          (expandAll && currentMessage.all && currentMessage.agent !== m.name)),
    );
    return {
      name: m.name,
      displayName: m.displayName,
      x,
      y,
      width: w,
      height: h,
      status: m.status,
      killed: m.killed,
      isCoordinator: m.isCoordinator,
      isHot,
      broadcastCount: expandAll ? 0 : (broadcastCounts.get(m.name) ?? 0),
    };
  };

  if (coordinator && others.length >= 2) {
    nodes.push(makeNode(coordinator, cx, cy));
    others.forEach((m, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / others.length;
      nodes.push(makeNode(m, cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)));
    });
  } else {
    const all = visibleMembers;
    all.forEach((m, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, all.length);
      const scale = all.length === 1 ? 0 : 1;
      nodes.push(
        makeNode(m, cx + rx * scale * Math.cos(angle), cy + ry * scale * Math.sin(angle)),
      );
    });
  }

  // Aggregate directed edges from msgs up to replaySeq
  const edgeAcc = new Map<
    string,
    { from: string; to: string; direct: number; viaAll: number }
  >();
  for (const m of msgs) {
    if (!visibleNameSet.has(m.agent)) continue;
    const directTargets = new Set(m.mentions.filter((t) => t !== m.agent && visibleNameSet.has(t)));
    const allTargets = new Set<string>(directTargets);
    if (expandAll && m.all) {
      for (const name of visibleNameSet) {
        if (name !== m.agent) allTargets.add(name);
      }
    }
    for (const to of allTargets) {
      const key = `${m.agent}\0${to}`;
      const cur = edgeAcc.get(key) ?? { from: m.agent, to, direct: 0, viaAll: 0 };
      if (directTargets.has(to)) cur.direct += 1;
      else cur.viaAll += 1;
      edgeAcc.set(key, cur);
    }
  }

  const edges: MentionGraphEdge[] = [];
  for (const e of edgeAcc.values()) {
    const a = posMap.get(e.from);
    const b = posMap.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const padA = Math.min(a.w / 2, 34);
    const padB = Math.min(b.w / 2, 36);
    const x1 = a.x + ux * padA;
    const y1 = a.y + uy * padA;
    const x2 = b.x - ux * padB;
    const y2 = b.y - uy * padB;
    const hasReverse = edgeAcc.has(`${e.to}\0${e.from}`);
    const bend = hasReverse ? 22 : 12;
    const mx = (x1 + x2) / 2 - uy * bend;
    const my = (y1 + y2) / 2 + ux * bend;
    const isCurrent = Boolean(
      currentMessage &&
        currentMessage.agent === e.from &&
        (currentMessage.mentions.includes(e.to) || (expandAll && currentMessage.all)),
    );
    edges.push({
      id: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      count: e.direct + e.viaAll,
      viaAllOnly: e.direct === 0 && e.viaAll > 0,
      isCurrent,
      pathD: `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
      labelX: (x1 + 2 * mx + x2) / 4,
      labelY: (y1 + 2 * my + y2) / 4,
      endX: x2,
      endY: y2,
    });
  }

  return { width: W, height: H, nodes, edges, currentMessage };
}

// ---------------------------------------------------------------------------
// Strict Activation-Only Auto-Popup Guard
// ---------------------------------------------------------------------------

export function shouldAutoOpenAgentAux(input: {
  readonly isServerThread: boolean;
  readonly embedded?: boolean;
  readonly threadKey: string | null;
  readonly model: AgentAuxViewModel;
  readonly autoOpenedKeys: ReadonlySet<string>;
}): string | null {
  if (!input.isServerThread || input.embedded || !input.threadKey) return null;
  if (!input.model.active || !input.model.hasLiveActivity || !input.model.activationKey) {
    return null;
  }
  const compositeKey = `${input.threadKey}::${input.model.activationKey}`;
  if (input.autoOpenedKeys.has(compositeKey)) return null;
  return compositeKey;
}

// ---------------------------------------------------------------------------
// Unified Multi-Agent ViewModel Builder
// ---------------------------------------------------------------------------

const ACTIVE_SUBAGENT_STATUS_SET = new Set([
  "running",
  "pending",
  "starting",
  "queued",
  "waiting_input",
  "in_progress",
  "working",
]);

function normalizeSubagentStatus(raw: string): AgentAuxMemberVisualStatus {
  const lower = raw.trim().toLowerCase();
  if (lower === "running" || lower === "starting" || lower === "in_progress" || lower === "working") {
    return "working";
  }
  if (lower === "waiting_input" || lower === "waiting") return "needs_you";
  if (lower === "pending" || lower === "queued") return "parked";
  if (lower === "failed" || lower === "error") return "error";
  if (lower === "cancelled" || lower === "killed" || lower === "stopped") return "killed";
  return "done";
}

function normalizeWorkstreamState(
  raw: string | undefined,
): AgentAuxWorkstream["state"] {
  switch ((raw ?? "").toLowerCase()) {
    case "done":
    case "completed":
      return "done";
    case "blocked":
    case "failed":
      return "blocked";
    case "review":
      return "review";
    case "queued":
    case "pending":
      return "queued";
    default:
      return "running";
  }
}

function mapNativeSteps(
  steps: readonly (DaemonAgentAuxNativeStepDto | OrchestrationV2NativeChildStep)[] | null | undefined,
): readonly AgentAuxStepItem[] {
  if (!steps || steps.length === 0) return [];
  return steps.map((s) => ({
    index: s.index,
    type: s.type,
    status: s.status,
    text: s.text,
    toolCalls: s.toolCalls.map((tc) => ({
      name: tc.name,
      summary: "summary" in tc ? tc.summary : tc.input,
    })),
  }));
}

export interface AgentAuxThreadShellLike {
  readonly id: ThreadId;
  readonly title?: string | null | undefined;
  readonly status?: string | null | undefined;
  readonly activityRunStatus?: string | null | undefined;
  readonly lineage: {
    readonly parentThreadId?: ThreadId | null | undefined;
    readonly sideChat?: boolean | undefined;
  };
}

export interface AgentAuxSubagentLike {
  readonly id: string;
  readonly title?: string | null | undefined;
  readonly status: string;
  readonly driver?: string | null | undefined;
  readonly childThreadId: ThreadId | null;
  readonly prompt: string;
  readonly remoteChild?: { readonly label: string } | null | undefined;
}

export interface AgentAuxPlanLike {
  readonly kind?: string | undefined;
  readonly steps?: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly status: string;
  }> | null | undefined;
}

export interface AgentAuxProjectionLike {
  readonly subagents?: ReadonlyArray<AgentAuxSubagentLike> | undefined;
  readonly turnItems?: ReadonlyArray<Record<string, unknown> & { readonly type: string }> | undefined;
  readonly plans?: ReadonlyArray<AgentAuxPlanLike> | undefined;
  readonly providerThreads?: ReadonlyArray<unknown> | undefined;
  readonly thread?: unknown;
}

function extractPlanTasks(projection: AgentAuxProjectionLike | null | undefined): AgentAuxTask[] {
  if (!projection?.plans) return [];
  const tasks: AgentAuxTask[] = [];
  for (const plan of projection.plans) {
    if (plan.kind !== "todo_list" || !Array.isArray(plan.steps)) continue;
    for (const step of plan.steps) {
      const status: AgentAuxTask["status"] =
        step.status === "completed"
          ? "completed"
          : step.status === "running" || step.status === "in_progress"
            ? "in_progress"
            : "pending";
      tasks.push({
        id: step.id,
        subject: step.text,
        description: "",
        status,
        owner: "",
        blockedBy: [],
        source: "thread-plan",
      });
    }
  }
  return tasks;
}

export interface BuildAgentAuxViewModelInput {
  readonly provider: string | null | undefined;
  readonly threadId: ThreadId | null;
  readonly daemonSnapshot: DaemonAgentAuxInspectResponse | null;
  readonly projection?: AgentAuxProjectionLike | null | undefined;
  readonly relationshipShells?: ReadonlyArray<AgentAuxThreadShellLike> | undefined;
  readonly nativeChildWork?: ReadonlyArray<OrchestrationV2NativeChildWork> | undefined;
}

export function buildAgentAuxViewModel(input: BuildAgentAuxViewModelInput): AgentAuxViewModel {
  const provider = input.provider ?? null;
  const brand = resolveAgentBrandId(provider);
  const brandDisplayName = formatAgentBrandName(provider);
  const snap = input.daemonSnapshot;
  const updatedAt = snap?.updatedAt ?? Date.now();

  // 1. AGY Native Swarm (highest priority, 1:1 AGY experience)
  if (snap?.active && snap.kind === "agy-swarm" && snap.swarm) {
    const sw = snap.swarm;
    const members: AgentAuxMember[] = sw.members.map((m) => {
      const isCoordinator = m.role === "coordinator" || m.name === "coordinator";
      const isSystem = m.roleWorker || m.narrator;
      const visualStatus: AgentAuxMemberVisualStatus = m.killed
        ? "killed"
        : m.failure
          ? "error"
          : m.status === "working"
            ? "working"
            : isCoordinator && m.replied && m.replyAsk
              ? "needs_you"
              : "parked";
      const planTaskTitle = sw.plan?.tasks?.[m.name] ?? "";
      return {
        id: m.conversationId || m.name,
        name: m.name,
        displayName: isCoordinator ? "coordinator" : m.name,
        role: m.role,
        roleLabel: formatAuxRoleLabel(m.role, isCoordinator),
        title: isCoordinator ? "协调者" : planTaskTitle,
        model: m.model.replace(/-(?:dropdown|high|medium)$/i, ""),
        status: visualStatus,
        statusLabel: formatAuxStatusLabel(visualStatus),
        waitingOn: null,
        wakeMode: m.wakeMode,
        steps: m.steps,
        posts: m.posts,
        unread: m.unread,
        activity: m.activity,
        activityKind: m.activityKind,
        nowLine: m.activity || (m.lastPostSeq > 0 ? `最近发言 #${m.lastPostSeq}` : "尚无动态"),
        lastSeq: m.lastPostSeq,
        lastTime: m.lastPostTime,
        killed: m.killed,
        isCoordinator,
        isSystem,
        isYou: sw.selfMember === m.name,
        childThreadId: null,
        conversationId: m.conversationId || null,
        color: computeBeeColor(m.name),
        backendType: null,
        workspace: m.workspace ?? null,
        workspaceMode: m.workspaceMode ?? null,
        failureText: m.failure?.text ?? null,
      };
    });

    const selfMemberObj = members.find((m) => m.isYou) ?? null;
    const unreadSeqBoundary =
      selfMemberObj && selfMemberObj.lastSeq < sw.head
        ? (sw.members.find((m) => m.name === selfMemberObj.name)?.lastReadSeq ?? null)
        : null;

    const messages: AgentAuxBoardMessage[] = sw.messages.map((msg) => ({
      seq: msg.seq,
      agent: msg.agent,
      text: msg.text,
      time: msg.time,
      ts: msg.ts,
      mentions: msg.mentions,
      all: msg.all,
      ...(msg.channel ? { channel: msg.channel } : {}),
      isControl: Boolean(msg.control),
      isDirectToYou: Boolean(sw.selfMember && msg.mentions.includes(sw.selfMember) && !msg.all),
      isUnread: Boolean(
        unreadSeqBoundary !== null &&
          msg.seq > unreadSeqBoundary &&
          msg.agent !== sw.selfMember &&
          !msg.control,
      ),
    }));

    const team = members.filter((m) => !m.isSystem);
    const activeCount = team.filter((m) => !m.killed && m.status === "working").length;
    const waitingCount = team.filter(
      (m) => !m.killed && (m.status === "parked" || m.status === "waiting_on" || m.status === "needs_you"),
    ).length;
    const retiredCount = team.filter((m) => m.killed).length;

    const attention: AgentAuxAttentionItem[] = [];
    for (const a of sw.view?.attention ?? []) {
      if (!a.title) continue;
      const seqRef = a.refs?.find((r) => typeof r.seq === "number")?.seq ?? null;
      const memRef = a.refs?.find((r) => typeof r.member === "string")?.member ?? "coordinator";
      const kind =
        a.kind === "decision" ||
        a.kind === "failure" ||
        a.kind === "review" ||
        a.kind === "stuck" ||
        a.kind === "quota" ||
        a.kind === "error"
          ? a.kind
          : "fyi";
      const severity =
        a.severity === "high" || a.severity === "med" ? a.severity : "low";
      attention.push({
        id: a.id || `att-${attention.length}`,
        kind,
        severity,
        title: a.title,
        why: a.why ?? "",
        from: memRef,
        seq: seqRef,
        wait:
          kind === "fyi"
            ? null
            : kind === "failure" || kind === "stuck" || kind === "error"
              ? "issue"
              : memRef === "coordinator"
                ? "you"
                : "coordinator",
      });
    }
    for (const sys of sw.systemAttention) {
      attention.push({
        id: sys.id,
        kind: sys.kind,
        severity: "high",
        title: sys.text,
        why: sys.detail,
        from: sys.member,
        seq: null,
        wait: sys.member === "coordinator" ? "you" : "issue",
      });
    }

    let workstreams: AgentAuxWorkstream[] = (sw.view?.workstreams ?? [])
      .filter((w) => Boolean(w.title))
      .map((w, idx) => {
        let progress: AgentAuxWorkstreamProgress | null = null;
        if (typeof w.progress === "number") {
          progress = { done: Math.round(w.progress), total: 100, label: `${Math.round(w.progress)}%` };
        } else if (w.progress && typeof w.progress.total === "number" && w.progress.total > 0) {
          const dn = w.progress.done ?? 0;
          progress = {
            done: dn,
            total: w.progress.total,
            label: w.progress.label || `${dn}/${w.progress.total}`,
          };
        }
        return {
          id: w.id || `ws-${idx}`,
          title: w.title ?? "任务",
          state: normalizeWorkstreamState(w.state),
          owners: w.owners && w.owners.length > 0 ? w.owners : ["coordinator"],
          note: w.note ?? "",
          progress,
          blockedOn: w.blocked_on ?? null,
          seq: w.refs?.find((r) => typeof r.seq === "number")?.seq ?? sw.head,
        };
      });

    if (workstreams.length === 0) {
      workstreams = team
        .filter((m) => !m.isCoordinator)
        .map((m) => ({
          id: m.name,
          title: m.title || `@${m.name}`,
          state: m.killed
            ? "done"
            : m.status === "error"
              ? "blocked"
              : m.status === "working"
                ? "running"
                : m.posts > 0
                  ? "done"
                  : "queued",
          owners: [m.name],
          note: m.nowLine,
          progress: null,
          blockedOn: m.waitingOn,
          seq: m.lastSeq || sw.head,
        }));
    }

    const threadGroups: AgentAuxThreadGroup[] = [];
    if (sw.view?.threads && sw.view.threads.length > 0) {
      for (const [idx, t] of sw.view.threads.entries()) {
        if (!t.title) continue;
        threadGroups.push({
          id: t.id || `vt-${idx}`,
          title: t.title,
          goal: t.goal ?? "",
          now: t.now ?? "",
          workstreams: t.workstreams ?? [],
        });
      }
    } else if (sw.plan?.threads && sw.plan.threads.length > 0) {
      for (const [idx, t] of sw.plan.threads.entries()) {
        if (!t.title) continue;
        threadGroups.push({
          id: t.id || `pt-${idx}`,
          title: t.title,
          goal: t.goal ?? "",
          now: "",
          workstreams: t.tasks,
        });
      }
    }

    const goalSource = sw.view?.goal ?? sw.plan?.goal ?? null;
    const goal: AgentAuxGoal | null =
      goalSource?.title
        ? { title: goalSource.title, line: goalSource.line ?? "" }
        : sw.view?.headline
          ? { title: sw.view.headline, line: sw.view.running_summary ?? "" }
          : null;

    const phase: AgentAuxPhase | null = sw.view?.phase?.label
      ? {
          label: sw.view.phase.label,
          index: sw.view.phase.index ?? 1,
          total: sw.view.phase.total ?? 1,
        }
      : null;

    const hasOverview = Boolean(goal || workstreams.length > 0 || attention.length > 0);
    const tabs: AgentAuxTabDescriptor[] = [
      ...(hasOverview
        ? [
            {
              id: "overview" as const,
              label: "总览",
              ...(attention.length > 0 ? { badge: attention.length } : {}),
            },
          ]
        : []),
      { id: "board", label: "消息板", count: messages.length },
      { id: "members", label: "成员", count: team.length },
      { id: "graph", label: "图谱" },
    ];

    const statusParts: string[] = [];
    if (activeCount > 0) statusParts.push(`${activeCount} 运行中`);
    if (waitingCount > 0) statusParts.push(`${waitingCount} 等待中`);
    if (retiredCount > 0) statusParts.push(`${retiredCount} 已结束`);
    statusParts.push(`${messages.length} 条消息`);

    return {
      active: true,
      hasLiveActivity: snap.hasLiveWork || activeCount > 0 || attention.length > 0,
      kind: "agy-swarm",
      provider: provider ?? "antigravity",
      providerBrand: "antigravity",
      title: sw.title || "蜂群协作",
      badgeLabel: "🐝 蜂群协作",
      entryLabel: "蜂群侧边栏",
      activationKey: snap.activationKey ?? `agy-swarm:${sw.id}`,
      selfMember: sw.selfMember,
      headSeq: sw.head,
      unreadSeqBoundary,
      tabs,
      defaultTab: hasOverview ? "overview" : "board",
      statusLine: statusParts.join(" · "),
      activeCount,
      waitingCount,
      retiredCount,
      messageCount: messages.length,
      goal,
      headline: sw.view?.headline ?? "",
      phase,
      workstreams,
      threadGroups,
      attention,
      members,
      messages,
      edges: sw.edges,
      tasks: [],
      finished: activeCount === 0 && attention.length === 0 && messages.length > 0,
      updatedAt,
    };
  }

  // 2. Claude Code Native Agent Team
  if (snap?.active && snap.kind === "claude-team" && snap.claudeTeam) {
    const team = snap.claudeTeam;
    const members: AgentAuxMember[] = team.members.map((m) => {
      const status: AgentAuxMemberVisualStatus =
        m.status === "working" ? "working" : m.status === "done" ? "done" : "parked";
      return {
        id: m.agentId,
        name: m.name,
        displayName: m.name,
        role: m.agentType,
        roleLabel: formatAuxRoleLabel(m.agentType, m.isLead),
        title: m.agentType,
        model: m.model,
        status,
        statusLabel: formatAuxStatusLabel(status),
        waitingOn: null,
        wakeMode: "",
        steps: 0,
        posts: team.messages.filter((msg) => msg.agent === m.name).length,
        unread: team.messages.filter((msg) => msg.recipient === m.name && !msg.read).length,
        activity: m.status === "working" ? "团队协作执行中…" : "",
        activityKind: m.status === "working" ? "tool" : "",
        nowLine: m.backendType ? `运行后端：${m.backendType}` : "团队成员",
        lastSeq: 0,
        lastTime: "",
        killed: false,
        isCoordinator: m.isLead,
        isSystem: false,
        isYou: m.isLead,
        childThreadId: null,
        conversationId: null,
        color: m.color || computeBeeColor(m.name),
        backendType: m.backendType || null,
        workspace: m.cwd || null,
        workspaceMode: null,
        failureText: null,
      };
    });

    const messages: AgentAuxBoardMessage[] = team.messages.map((msg) => ({
      seq: msg.seq,
      agent: msg.agent,
      recipient: msg.recipient,
      text: msg.text,
      summary: msg.summary,
      time: msg.time,
      ts: msg.ts,
      mentions: msg.mentions,
      all: msg.all,
      isControl: false,
      isDirectToYou: msg.recipient === "team-lead",
      isUnread: !msg.read,
      ...(msg.color ? { color: msg.color } : {}),
    }));

    const tasks: AgentAuxTask[] = (snap.tasks ?? []).map((t) => ({
      id: t.id,
      subject: t.subject,
      description: t.description,
      status: t.status,
      owner: t.owner,
      blockedBy: t.blockedBy,
      ...(t.progressLabel ? { progressLabel: t.progressLabel } : {}),
      source: t.source,
    }));

    const workstreams: AgentAuxWorkstream[] = tasks.map((t, idx) => ({
      id: t.id,
      title: t.subject,
      state:
        t.status === "completed"
          ? "done"
          : t.status === "in_progress"
            ? "running"
            : t.status === "blocked"
              ? "blocked"
              : "queued",
      owners: t.owner ? [t.owner] : [],
      note: t.description,
      progress: null,
      blockedOn: t.blockedBy[0] ? `#${t.blockedBy[0]}` : null,
      seq: idx + 1,
    }));

    const activeCount = members.filter((m) => m.status === "working").length;
    const waitingCount = members.filter((m) => m.status === "parked").length;
    const tabs: AgentAuxTabDescriptor[] = [
      { id: "overview", label: "总览" },
      { id: "board", label: "消息板", count: messages.length },
      { id: "members", label: "成员", count: members.length },
      { id: "tasks", label: "任务清单", count: tasks.length },
    ];

    return {
      active: true,
      hasLiveActivity: snap.hasLiveWork || activeCount > 0 || tasks.some((t) => t.status === "in_progress"),
      kind: "claude-team",
      provider: provider ?? "claudeAgent",
      providerBrand: "claude-code",
      title: team.teamName || "Claude 智能体团队",
      badgeLabel: "Claude 智能体团队",
      entryLabel: "Claude 团队面板",
      activationKey: snap.activationKey ?? `claude-team:${team.teamName}`,
      selfMember: "team-lead",
      headSeq: messages.length,
      unreadSeqBoundary: null,
      tabs,
      defaultTab: "overview",
      statusLine: `${activeCount} 运行中 · ${waitingCount} 等待中 · ${tasks.length} 项任务`,
      activeCount,
      waitingCount,
      retiredCount: 0,
      messageCount: messages.length,
      goal: team.description ? { title: team.teamName, line: team.description } : { title: team.teamName, line: "" },
      headline: team.description,
      phase: null,
      workstreams,
      threadGroups: [],
      attention: [],
      members,
      messages,
      edges: team.edges,
      tasks,
      finished: activeCount === 0 && tasks.length > 0 && tasks.every((t) => t.status === "completed"),
      updatedAt,
    };
  }

  // 3. Merge T3 live subagents + relationshipShells + AGY detached subagents + Codex spawned threads
  const mergedMembers: AgentAuxMember[] = [];
  const seenMemberIds = new Set<string>();
  const shellById = new Map((input.relationshipShells ?? []).map((s) => [s.id, s] as const));

  for (const agent of input.projection?.subagents ?? []) {
    const key = agent.childThreadId ?? agent.id;
    if (seenMemberIds.has(key)) continue;
    seenMemberIds.add(key);
    const childShell = agent.childThreadId ? shellById.get(agent.childThreadId) : undefined;
    const rawStatus = childShell?.activityRunStatus ?? agent.status;
    const status = normalizeSubagentStatus(rawStatus);
    const rawTitle =
      agent.title?.trim() ||
      childShell?.title?.trim() ||
      agent.prompt.split(/\r?\n/, 1)[0]?.slice(0, 48) ||
      "子智能体";
    const displayName = formatSubagentDisplayTitle(rawTitle);
    mergedMembers.push({
      id: agent.id,
      name: displayName,
      displayName,
      role: "subagent",
      roleLabel: "子代理",
      title: displayName,
      model: agent.driver ?? "",
      status,
      statusLabel: formatAuxStatusLabel(status),
      waitingOn: null,
      wakeMode: "",
      steps: 0,
      posts: 0,
      unread: 0,
      activity: status === "working" ? agent.prompt.trim().slice(0, 96) : "",
      activityKind: status === "working" ? "tool" : "",
      nowLine: agent.prompt.trim().slice(0, 140) || "子代理会话",
      lastSeq: 0,
      lastTime: "",
      killed: status === "killed",
      isCoordinator: false,
      isSystem: false,
      isYou: false,
      childThreadId: agent.childThreadId,
      conversationId: null,
      color: computeBeeColor(displayName),
      backendType: agent.remoteChild?.label ?? null,
      workspace: null,
      workspaceMode: null,
      failureText: status === "error" ? "子代理执行失败" : null,
    });
  }

  for (const rawItem of input.projection?.turnItems ?? []) {
    if (rawItem.type !== "subagent") continue;
    const subagentId = typeof rawItem.subagentId === "string" ? rawItem.subagentId : "";
    const childThreadId =
      typeof rawItem.childThreadId === "string" ? (rawItem.childThreadId as ThreadId) : null;
    const itemStatus = typeof rawItem.status === "string" ? rawItem.status : "running";
    const itemPrompt = typeof rawItem.prompt === "string" ? rawItem.prompt : "";
    const itemDriver = typeof rawItem.driver === "string" ? rawItem.driver : "";
    const remoteChild =
      rawItem.remoteChild && typeof rawItem.remoteChild === "object"
        ? (rawItem.remoteChild as { readonly label?: unknown })
        : null;
    const remoteLabel = typeof remoteChild?.label === "string" ? remoteChild.label : null;
    const key = childThreadId ?? subagentId;
    if (!key || seenMemberIds.has(key)) continue;
    seenMemberIds.add(key);
    const childShell = childThreadId ? shellById.get(childThreadId) : undefined;
    const rawStatus = childShell?.activityRunStatus ?? itemStatus;
    const status = normalizeSubagentStatus(rawStatus);
    const rawTitle =
      childShell?.title?.trim() ||
      itemPrompt.split(/\r?\n/, 1)[0]?.trim().slice(0, 48) ||
      "子智能体";
    const displayName = formatSubagentDisplayTitle(rawTitle);
    mergedMembers.push({
      id: subagentId || key,
      name: displayName,
      displayName,
      role: "subagent",
      roleLabel: "子代理",
      title: displayName,
      model: itemDriver,
      status,
      statusLabel: formatAuxStatusLabel(status),
      waitingOn: null,
      wakeMode: "",
      steps: 0,
      posts: 0,
      unread: 0,
      activity: status === "working" ? itemPrompt.trim().slice(0, 96) : "",
      activityKind: status === "working" ? "tool" : "",
      nowLine: itemPrompt.trim().slice(0, 140) || "子代理会话",
      lastSeq: 0,
      lastTime: "",
      killed: status === "killed",
      isCoordinator: false,
      isSystem: false,
      isYou: false,
      childThreadId,
      conversationId: null,
      color: computeBeeColor(displayName),
      backendType: remoteLabel,
      workspace: null,
      workspaceMode: null,
      failureText: status === "error" ? "子代理执行失败" : null,
    });
  }

  for (const shell of input.relationshipShells ?? []) {
    if (shell.id === input.threadId) continue;
    if (shell.lineage.parentThreadId !== input.threadId) continue;
    if (shell.lineage.sideChat === true) continue;
    if (seenMemberIds.has(shell.id)) continue;
    seenMemberIds.add(shell.id);
    const rawStatus = shell.activityRunStatus ?? shell.status ?? "idle";
    const status = normalizeSubagentStatus(rawStatus);
    const displayName = formatSubagentDisplayTitle(shell.title?.trim() || "子智能体");
    mergedMembers.push({
      id: shell.id,
      name: displayName,
      displayName,
      role: "subagent",
      roleLabel: "子代理",
      title: displayName,
      model: "",
      status,
      statusLabel: formatAuxStatusLabel(status),
      waitingOn: null,
      wakeMode: "",
      steps: 0,
      posts: 0,
      unread: 0,
      activity: status === "working" ? "执行中…" : "",
      activityKind: status === "working" ? "tool" : "",
      nowLine: displayName,
      lastSeq: 0,
      lastTime: "",
      killed: status === "killed",
      isCoordinator: false,
      isSystem: false,
      isYou: false,
      childThreadId: shell.id,
      conversationId: null,
      color: computeBeeColor(displayName),
      backendType: null,
      workspace: null,
      workspaceMode: null,
      failureText: null,
    });
  }

  // AGY detached subagents from daemon
  for (const sub of snap?.agySubagents ?? []) {
    if (seenMemberIds.has(sub.conversationId)) continue;
    seenMemberIds.add(sub.conversationId);
    const status: AgentAuxMemberVisualStatus =
      sub.status === "working"
        ? "working"
        : sub.status === "killed"
          ? "killed"
          : sub.status === "done"
            ? "done"
            : "parked";
    mergedMembers.push({
      id: sub.conversationId,
      name: sub.role,
      displayName: sub.role,
      role: sub.role,
      roleLabel: formatAuxRoleLabel(sub.role),
      title: sub.role,
      model: "Antigravity",
      status,
      statusLabel: formatAuxStatusLabel(status),
      waitingOn: null,
      wakeMode: "",
      steps: sub.stepsCount,
      posts: 0,
      unread: 0,
      activity: sub.activity,
      activityKind: sub.activityKind,
      nowLine: sub.activity || `状态：${sub.state}`,
      lastSeq: 0,
      lastTime: "",
      killed: sub.status === "killed",
      isCoordinator: false,
      isSystem: false,
      isYou: false,
      childThreadId: null,
      conversationId: sub.conversationId,
      color: computeBeeColor(sub.role),
      backendType: "AGY Native",
      workspace: null,
      workspaceMode: null,
      failureText: null,
      nativeSteps: mapNativeSteps(sub.steps),
    });
  }

  // T3 nativeChildWork (AGY native subagent batch)
  for (const child of input.nativeChildWork ?? []) {
    if (seenMemberIds.has(child.conversationId)) continue;
    seenMemberIds.add(child.conversationId);
    const steps = mapNativeSteps(child.steps);
    const lastStep = steps.at(-1);
    const working = lastStep?.status === "RUNNING" || lastStep?.status === "PENDING";
    const status: AgentAuxMemberVisualStatus = working ? "working" : "done";
    mergedMembers.push({
      id: child.conversationId,
      name: child.role || child.conversationId,
      displayName: child.role || "原生子智能体",
      role: child.role || "subagent",
      roleLabel: formatAuxRoleLabel(child.role || "subagent"),
      title: child.role || "原生子智能体",
      model: "Antigravity",
      status,
      statusLabel: formatAuxStatusLabel(status),
      waitingOn: null,
      wakeMode: "",
      steps: steps.length,
      posts: 0,
      unread: 0,
      activity: working ? (lastStep?.toolCalls.at(-1)?.summary ?? "执行中…") : "",
      activityKind: working ? "tool" : "",
      nowLine: child.prompt.trim().slice(0, 140),
      lastSeq: 0,
      lastTime: "",
      killed: false,
      isCoordinator: false,
      isSystem: false,
      isYou: false,
      childThreadId: null,
      conversationId: child.conversationId,
      color: computeBeeColor(child.role || child.conversationId),
      backendType: "AGY Native",
      workspace: null,
      workspaceMode: null,
      failureText: null,
      nativeSteps: steps,
    });
  }

  // Codex spawned threads from daemon state_5.sqlite
  for (const sp of snap?.codex?.spawnedThreads ?? []) {
    if (seenMemberIds.has(sp.threadId)) continue;
    seenMemberIds.add(sp.threadId);
    const status = normalizeSubagentStatus(sp.status);
    const displayName = sp.nickname || sp.title || sp.threadId.slice(0, 12);
    mergedMembers.push({
      id: sp.threadId,
      name: displayName,
      displayName,
      role: sp.role || "subagent",
      roleLabel: formatAuxRoleLabel(sp.role || "subagent"),
      title: sp.title || displayName,
      model: sp.model || "Codex",
      status,
      statusLabel: formatAuxStatusLabel(status),
      waitingOn: null,
      wakeMode: "",
      steps: 0,
      posts: 0,
      unread: 0,
      activity: status === "working" ? sp.title : "",
      activityKind: status === "working" ? "tool" : "",
      nowLine: sp.title || "Codex 协同会话",
      lastSeq: 0,
      lastTime: "",
      killed: status === "killed",
      isCoordinator: false,
      isSystem: false,
      isYou: false,
      childThreadId: null,
      conversationId: sp.threadId,
      color: computeBeeColor(displayName),
      backendType: sp.reasoningEffort ? `推理档位：${sp.reasoningEffort}` : null,
      workspace: sp.cwd || null,
      workspaceMode: null,
      failureText: null,
    });
  }

  const daemonTasks: AgentAuxTask[] = (snap?.tasks ?? []).map((t) => ({
    id: t.id,
    subject: t.subject,
    description: t.description,
    status: t.status,
    owner: t.owner,
    blockedBy: t.blockedBy,
    ...(t.progressLabel ? { progressLabel: t.progressLabel } : {}),
    source: t.source,
  }));
  const planTasks = extractPlanTasks(input.projection);
  const allTasks = daemonTasks.length > 0 ? daemonTasks : planTasks;

  const hasCodexGoals = (snap?.codex?.goals.length ?? 0) > 0;
  const hasAnySubagentOrCollab = mergedMembers.length > 0 || hasCodexGoals;

  if (!hasAnySubagentOrCollab) {
    return {
      active: false,
      hasLiveActivity: false,
      kind: null,
      provider,
      providerBrand: brand,
      title: "",
      badgeLabel: "",
      entryLabel: "",
      activationKey: null,
      selfMember: null,
      headSeq: 0,
      unreadSeqBoundary: null,
      tabs: [],
      defaultTab: "overview",
      statusLine: "",
      activeCount: 0,
      waitingCount: 0,
      retiredCount: 0,
      messageCount: 0,
      goal: null,
      headline: "",
      phase: null,
      workstreams: [],
      threadGroups: [],
      attention: [],
      members: [],
      messages: [],
      edges: [],
      tasks: [],
      finished: false,
      updatedAt,
    };
  }

  let kind: AgentAuxViewKind;
  let badgeLabel: string;
  let entryLabel: string;
  let title: string;

  if (brand === "antigravity" || snap?.kind === "agy-subagents") {
    kind = "agy-subagents";
    badgeLabel = "Antigravity 子智能体";
    entryLabel = "子智能体面板";
    title = "Antigravity 子智能体";
  } else if (brand === "claude-code") {
    kind = "claude-subagents";
    badgeLabel = "Claude 子代理协作";
    entryLabel = "Claude 协同面板";
    title = "Claude 子代理协作";
  } else if (brand === "codex" || snap?.kind === "codex-collab") {
    kind = "codex-collab";
    badgeLabel = "Codex 协同子代理";
    entryLabel = "Codex 协同面板";
    title = "Codex 协同子代理";
  } else {
    kind = "provider-subagents";
    badgeLabel = `${brandDisplayName} 协同侧边栏`;
    entryLabel = `${brandDisplayName} 协同面板`;
    title = `${brandDisplayName} 协同侧边栏`;
  }

  const activeCount = mergedMembers.filter((m) => m.status === "working" || m.status === "needs_you").length;
  const waitingCount = mergedMembers.filter((m) => m.status === "parked" || m.status === "waiting_on").length;
  const retiredCount = mergedMembers.filter((m) => m.killed || m.status === "done").length;

  const hasLiveActivity =
    activeCount > 0 ||
    Boolean(snap?.hasLiveWork) ||
    mergedMembers.some((m) => ACTIVE_SUBAGENT_STATUS_SET.has(m.status));

  const workstreams: AgentAuxWorkstream[] = mergedMembers.map((m, idx) => ({
    id: m.id,
    title: m.displayName,
    state:
      m.status === "working"
        ? "running"
        : m.status === "error" || m.status === "needs_you"
          ? "blocked"
          : m.status === "done" || m.killed
            ? "done"
            : "queued",
    owners: [m.name],
    note: m.nowLine,
    progress: null,
    blockedOn: null,
    seq: idx + 1,
  }));

  const tabs: AgentAuxTabDescriptor[] = [
    { id: "overview", label: "总览" },
    { id: "members", label: "成员", count: mergedMembers.length },
    ...(allTasks.length > 0 ? [{ id: "tasks" as const, label: "任务清单", count: allTasks.length }] : []),
  ];

  const statusParts: string[] = [];
  if (activeCount > 0) statusParts.push(`${activeCount} 运行中`);
  if (waitingCount > 0) statusParts.push(`${waitingCount} 等待中`);
  if (retiredCount > 0) statusParts.push(`${retiredCount} 已完成`);
  if (allTasks.length > 0) statusParts.push(`${allTasks.length} 项任务`);

  const firstId = mergedMembers[0]?.id ?? allTasks[0]?.id ?? "session";
  const activationKey = snap?.activationKey ?? `${kind}:${input.threadId ?? "thread"}:${firstId}`;

  return {
    active: true,
    hasLiveActivity,
    kind,
    provider,
    providerBrand: brand,
    title,
    badgeLabel,
    entryLabel,
    activationKey,
    selfMember: null,
    headSeq: 0,
    unreadSeqBoundary: null,
    tabs,
    defaultTab: "overview",
    statusLine: statusParts.join(" · ") || `${mergedMembers.length} 个协同代理`,
    activeCount,
    waitingCount,
    retiredCount,
    messageCount: 0,
    goal:
      snap?.codex?.goals[0]
        ? { title: snap.codex.goals[0].objective, line: `状态：${snap.codex.goals[0].status}` }
        : null,
    headline: "",
    phase: null,
    workstreams,
    threadGroups: [],
    attention: [],
    members: mergedMembers,
    messages: [],
    edges: [],
    tasks: allTasks,
    finished: !hasLiveActivity && mergedMembers.length > 0,
    updatedAt,
  };
}
