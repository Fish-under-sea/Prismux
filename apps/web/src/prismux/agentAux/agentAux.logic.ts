import type {
  OrchestrationV2NativeChildStep,
  OrchestrationV2NativeChildWork,
  ThreadId,
} from "@prismux/core-contracts";
import { formatSubagentDisplayTitle } from "@prismux/client-runtime/state/subagent-display";

import {
  resolveConfiguredProviderLabel,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import {
  CANONICAL_PROVIDER_DISPLAY_NAMES,
  acpBrandKeyToAgentBrandId,
  formatAgentBrandName,
  inferAgentBrandFromModel,
  resolveAcpAgentBrandKey,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
  type AgentBrandId,
} from "../agentBrand";
import type { DaemonAgentAuxInspectResponse, DaemonAgentAuxNativeStepDto } from "../daemonClient";
import {
  formatAuxCoordinatorSummary,
  formatAuxDelegationWave,
  formatAuxMemberDisplayName,
  formatAuxModelDisplayLabel,
  formatAuxTasksDone,
  formatAuxWaitingOn,
  getAuxStrings,
  type AgentAuxLocale,
} from "./agentAux.i18n";

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

export type AgentAuxMemberSourceKind =
  | "swarm"
  | "acp-delegated"
  | "claude-team"
  | "codex"
  | "native-subagent";

export type AgentAuxWorkstreamRawState =
  | "queued"
  | "active"
  | "review"
  | "blocked"
  | "failed"
  | "done";

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
  readonly rawState: AgentAuxWorkstreamRawState;
  readonly owners: readonly string[];
  readonly note: string;
  readonly progress: AgentAuxWorkstreamProgress | null;
  readonly blockedOn: string | null;
  readonly waitingOn: string | null;
  readonly seq: number;
  readonly sourceKind?: "swarm" | "acp-delegated";
}

export interface AgentAuxThreadGroup {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly now: string;
  readonly workstreams: readonly string[];
  readonly attention?: readonly string[];
  readonly sourceKind?: "swarm" | "acp-delegated";
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

export interface AgentAuxStallAlert {
  readonly seq: number;
  readonly agent: string;
  readonly text: string;
}

export interface AgentAuxStepItem {
  readonly index: number;
  readonly type: string;
  readonly status: string | null;
  readonly text: string | null;
  readonly toolCalls: ReadonlyArray<{ readonly name: string; readonly summary: string }>;
}

export interface AgentAuxMemberMetrics {
  readonly toolCalls?: number;
  readonly totalTokens?: number;
  readonly durationMs?: number;
}

export interface AgentAuxMember {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly role: string;
  readonly roleLabel: string;
  readonly title: string;
  readonly brief: string;
  readonly model: string;
  readonly providerBrand: AgentBrandId;
  readonly sourceKind: AgentAuxMemberSourceKind;
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
  readonly lastPostSnippet: string;
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
  readonly forkedFrom?: string | null;
  readonly spawnedAt?: number | null;
  readonly killedAt?: number | null;
  readonly channels?: readonly string[];
  readonly metrics?: AgentAuxMemberMetrics;
  readonly failureText: string | null;
  readonly nativeSteps?: readonly AgentAuxStepItem[];
}

export interface AgentAuxScreenshotRef {
  readonly path: string;
  readonly caption: string;
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
  readonly kind?: string;
  readonly channel?: string;
  readonly viaChannel?: readonly string[];
  readonly sourceKind?: "swarm" | "acp-delegated" | "claude-team";
  readonly providerBrand?: AgentBrandId;
  readonly screenshots?: readonly AgentAuxScreenshotRef[];
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
  readonly locale: AgentAuxLocale;
  readonly useBees: boolean;
  readonly hasAbsorbedAcpAgents: boolean;
  readonly provider: string | null;
  readonly providerBrand: AgentBrandId;
  readonly title: string;
  readonly badgeLabel: string;
  readonly entryLabel: string;
  readonly activationKey: string | null;
  readonly selfMember: string | null;
  readonly headSeq: number;
  readonly unreadSeqBoundary: number | null;
  readonly channels: readonly string[];
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
  readonly stall: AgentAuxStallAlert | null;
  readonly starting: boolean;
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
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, "0"),
      )
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

/**
 * Tri-theme safe tile background (zero hardcoded `#1C1B22` hex — coordinator honeycomb
 * uses CSS theme token `--pmx-aux-coord-bg` across Light / Dark / Liquid Glass).
 */
export function buildBeeTileBackground(name: string): string {
  if (name === "coordinator") {
    return "var(--pmx-aux-coord-bg)";
  }
  return `color-mix(in srgb, ${computeBeeColor(name)} 22%, var(--pmx-aux-card, var(--card, #ffffff)))`;
}

// ---------------------------------------------------------------------------
// Workspace Path Shortening, Screenshot & Text Helpers (1:1 hive.js + app.js)
// ---------------------------------------------------------------------------

export function shortenWorkspacePath(raw: string | null | undefined): string {
  const list = String(raw ?? "")
    .split(/,\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (list.length === 0) return "";
  const formatOne = (p: string): string => {
    const norm = p.replace(/\\/g, "/");
    const segs = norm.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segs.length === 0) return norm.startsWith("/") ? "/" : p;
    const out =
      segs.length > 2
        ? `…/${segs.slice(-2).join("/")}`
        : `${norm.startsWith("/") ? "/" : ""}${segs.join("/")}`;
    return out.length > 42 ? `…${out.slice(-41)}` : out;
  };
  const first = formatOne(list[0] ?? "");
  return list.length > 1 ? `${first} +${list.length - 1}` : first;
}

const SCREENSHOT_LINE_RE = /^\s*Screenshot:\s*(.+?)(?:\s*\|\s*(.+))?\s*$/gim;

export function extractScreenshotsFromText(text: string): readonly AgentAuxScreenshotRef[] {
  const out: AgentAuxScreenshotRef[] = [];
  for (const match of text.matchAll(SCREENSHOT_LINE_RE)) {
    const path = (match[1] ?? "").trim();
    const caption = (match[2] ?? "").trim() || path.split(/[\\/]/).pop() || path;
    if (path) {
      out.push({ path, caption });
    }
  }
  return out;
}

/**
 * Strips leading `@recipient` tokens already displayed in the `@sender → @recipient` header
 * (1:1 parity with AGY `app.js` board body display).
 */
export function stripLeadingMentionTokens(
  text: string,
  mentions: readonly string[],
  all: boolean,
): string {
  if (!text) return "";
  const allowed = new Set(mentions.map((m) => m.toLowerCase()));
  if (all) allowed.add("all");
  if (allowed.size === 0) return text;

  let rest = text;
  for (;;) {
    const m = /^\s*@([\p{L}\p{Nd}][\p{L}\p{Nd}_-]{0,63})(?:[\s,:–—-]+|$)/u.exec(rest);
    if (!m?.[1]) break;
    const tok = m[1].toLowerCase();
    const matchesTarget = allowed.has(tok) || [...allowed].some((n) => n.startsWith(`${tok}-`));
    if (!matchesTarget) break;
    rest = rest.slice(m[0].length);
  }
  return rest.trimStart() || text;
}

// ---------------------------------------------------------------------------
// Mention Parser & Board Text Tokenizer (mirrors AGY channels.mjs + app.js)
// ---------------------------------------------------------------------------

const NAME_RUNE_RE = /[\p{L}\p{Nd}_-]/u;

function hasNamedToken(lowerText: string, lowerName: string): boolean {
  if (!lowerName) return false;
  for (let i = lowerText.indexOf("@"); i >= 0; i = lowerText.indexOf("@", i + 1)) {
    if (i > 0) {
      const before = Array.from(lowerText.slice(Math.max(0, i - 2), i)).at(-1);
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
  | {
      readonly kind: "mention";
      readonly value: string;
      readonly name: string;
      readonly isAll: boolean;
    }
  | { readonly kind: "seq"; readonly value: string; readonly seq: number }
  | { readonly kind: "code"; readonly value: string };

const BOARD_TOKEN_RE =
  /(`[^`\n]+`)|((?<![\p{L}\p{Nd}_-])@[\p{L}\p{Nd}][\p{L}\p{Nd}_-]{0,63})|((?<![\p{L}\p{Nd}_/-])#(\d{1,6})\b)/gu;

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
// Localized Role, Status & Time Helpers (100% zh / en parity)
// ---------------------------------------------------------------------------

export function formatAuxRoleLabel(
  role: string,
  isCoordinator = false,
  locale: AgentAuxLocale = "zh",
): string {
  const s = getAuxStrings(locale);
  if (isCoordinator) return s.roleCoordinator;
  const lower = role.trim().toLowerCase();
  switch (lower) {
    case "coordinator":
    case "team-lead":
    case "lead":
      return s.roleCoordinator;
    case "worker":
    case "teammate":
      return s.roleWorker;
    case "narrator":
      return s.roleNarrator;
    case "monitor":
      return s.roleMonitor;
    case "reviewer":
    case "verifier":
      return s.roleVerifier;
    case "acp-delegated":
      return s.roleAcpDelegated;
    case "subagent":
    case "":
      return s.roleSubagent;
    default:
      return role;
  }
}

export function formatAuxStatusLabel(
  status: AgentAuxMemberVisualStatus,
  waitingOn?: string | null,
  locale: AgentAuxLocale = "zh",
): string {
  const s = getAuxStrings(locale);
  switch (status) {
    case "working":
      return s.stateWorking;
    case "waiting_on":
      return waitingOn ? formatAuxWaitingOn(waitingOn, locale) : s.stateWaitingGeneric;
    case "needs_you":
      return s.stateNeedsYou;
    case "parked":
      return s.stateParked;
    case "done":
      return s.stateDone;
    case "killed":
      return s.stateKilled;
    case "error":
      return s.stateError;
  }
}

export function formatAuxTaskStatusLabel(
  status: AgentAuxTask["status"],
  locale: AgentAuxLocale = "zh",
): string {
  const s = getAuxStrings(locale);
  switch (status) {
    case "in_progress":
      return s.overviewRunning;
    case "completed":
      return s.stateDone;
    case "blocked":
      return s.stateBlocked;
    case "pending":
      return s.stateQueued;
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
// 1:1 AGY Replay Engine (`computeHiveStateAtSeq` + `computeReplayDelayMs`)
// ---------------------------------------------------------------------------

const DONE_POST_RE = /^(@[A-Za-z0-9_-]+[\s,:–—-]*)*(?:\*\*|\*|`|_)?\[done\]/i;
const WAITING_ASK_RE = /[?？]|等待|请确认|could you|can you|please|ping me|waiting on|blocker/i;
const HV_BUSY_MS = 45 * 60 * 1000;
const HV_ASK_MS = 6 * 3600 * 1000;
/** Exact 1:1 AGY `hive.js:1134` freshness window (90s) for live message beams. */
export const HIVE_LIVE_BEAM_FRESH_MS = 90 * 1000;

export type HiveReplayMemberState =
  | "working"
  | "wait"
  | "needs"
  | "issue"
  | "done"
  | "idle"
  | "retired"
  | "unborn";

export interface HiveMemberSnapshotAtSeq {
  readonly st: HiveReplayMemberState;
  readonly who: string | null;
}

export interface HiveStateAtSeqResult {
  readonly states: Readonly<Record<string, HiveMemberSnapshotAtSeq>>;
  readonly isDoneAtSeq: ((memberName: string) => boolean) | null;
  readonly beam: AgentAuxBoardMessage | null;
  readonly trailBeams: readonly AgentAuxBoardMessage[];
}

export type ReplayPacingMode = "even" | "real";

/**
 * Exact 1:1 port of AGY `app.js:1743–1750` `replayDelay(all, idx)`.
 * - `even`: fixed `1400ms / speed`
 * - `real`: `1 min wall time = 1s at 1x`, clamped to `[250ms, 4000ms]`
 */
export function computeReplayDelayMs(
  messages: readonly AgentAuxBoardMessage[],
  nextIndex: number,
  pacing: ReplayPacingMode,
  speed: number,
): number {
  const safeSpeed = Math.max(0.25, speed || 1);
  if (pacing === "even" || nextIndex <= 0 || nextIndex >= messages.length) {
    return Math.round(1400 / safeSpeed);
  }
  const prevTs = messages[nextIndex - 1]?.ts;
  const curTs = messages[nextIndex]?.ts;
  if (prevTs === null || prevTs === undefined || curTs === null || curTs === undefined) {
    return Math.round(1400 / safeSpeed);
  }
  const gap = Math.max(0, curTs - prevTs);
  return Math.round(Math.min(4000, Math.max(250, gap / 60 / safeSpeed)));
}

/**
 * Exact 1:1 port of AGY `hive.js:1120–1151` `hiveStates(sc, seq)`.
 * Computes each member's historical visual state (`unborn`, `working`, `wait`, `needs`,
 * `issue`, `done`, `idle`, `retired`), waiting target, completion predicate, and active beams
 * at any historical `replaySeq` (or live state when `replaySeq === null`).
 */
export function computeHiveStateAtSeq(
  model: AgentAuxViewModel,
  replaySeq: number | null,
  nowMs: number = Date.now(),
): HiveStateAtSeqResult {
  const nonSystem = model.members.filter((m) => !m.isSystem);
  const memberMap = new Map(nonSystem.map((m) => [m.name, m]));
  const P = model.messages.filter((m) => !m.isControl);
  const states: Record<string, HiveMemberSnapshotAtSeq> = {};

  if (replaySeq === null) {
    const nonCoordMembers = nonSystem.filter((m) => !m.isCoordinator);
    const anyNonSystemBusy = nonSystem.some(
      (m) =>
        !m.killed &&
        (m.status === "working" || m.status === "waiting_on" || m.status === "needs_you"),
    );
    const allNonCoordSettled =
      nonCoordMembers.length > 0 &&
      nonCoordMembers.every(
        (m) => m.killed || m.status === "done" || m.status === "parked" || m.status === "error",
      );
    const isSettledLive =
      model.finished || !model.hasLiveActivity || (allNonCoordSettled && !anyNonSystemBusy);

    for (const m of nonSystem) {
      const owned = model.workstreams.filter((w) => w.owners.includes(m.name));
      let st: HiveReplayMemberState = "idle";
      let who: string | null = null;
      if (m.killed) {
        st = "retired";
      } else if (model.finished) {
        st = m.isCoordinator ? "idle" : "done";
      } else if (isSettledLive) {
        if (m.status === "error" || m.failureText) {
          st = "issue";
        } else if (
          !m.isCoordinator &&
          (m.status === "done" || (owned.length > 0 && owned.every((w) => w.state === "done")))
        ) {
          st = "done";
        } else {
          st = "idle";
        }
      } else if (m.status === "error" || m.failureText) {
        st = "issue";
      } else if (m.status === "working") {
        st = "working";
      } else if (m.status === "waiting_on") {
        st = "wait";
        who = m.waitingOn;
      } else if (m.status === "needs_you") {
        st = "needs";
      } else if (
        !m.isCoordinator &&
        (m.status === "done" || (owned.length > 0 && owned.every((w) => w.state === "done")))
      ) {
        st = "done";
      }
      states[m.name] = { st, who };
    }
    if (
      !isSettledLive &&
      states.coordinator &&
      states.coordinator.st !== "retired" &&
      model.attention.some((a) => a.wait === "you")
    ) {
      states.coordinator = { st: "needs", who: null };
    }
    if (isSettledLive) {
      return {
        states,
        isDoneAtSeq: null,
        beam: null,
        trailBeams: [],
      };
    }
    const isFreshLiveBeam = (msg: AgentAuxBoardMessage | null | undefined): boolean =>
      Boolean(
        msg &&
        msg.ts !== null &&
        Number.isFinite(msg.ts) &&
        nowMs - msg.ts < HIVE_LIVE_BEAM_FRESH_MS,
      );
    const latest = P.at(-1) ?? null;
    const beam = isFreshLiveBeam(latest) ? latest : null;
    const trailBeams =
      beam && P.length > 1
        ? P.slice(Math.max(0, P.length - 3), P.length - 1).filter(isFreshLiveBeam)
        : [];
    return {
      states,
      isDoneAtSeq: null,
      beam,
      trailBeams,
    };
  }

  // Historical replay: find index `i` of the last post up to replaySeq
  // Note: messages may be chronologically interleaved when hybrid ACP agents are absorbed,
  // so we match by exact seq position if found, else prefix by seq <= replaySeq.
  let i = P.findIndex((p) => p.seq === replaySeq);
  if (i < 0) {
    for (let k = 0; k < P.length; k += 1) {
      if ((P[k]?.seq ?? 0) <= replaySeq) i = k;
    }
  }

  const fin = new Map<string, number>();
  const lastPost = new Map<string, number>();
  const lastIn = new Map<string, number>();
  const born = new Set<string>(["coordinator"]);
  const coordMember = nonSystem.find((m) => m.isCoordinator);
  if (coordMember) born.add(coordMember.name);

  P.forEach((p, k) => {
    fin.set(p.agent, k);
  });

  const directTargetsOf = (p: AgentAuxBoardMessage): readonly string[] => {
    if (p.all) return [];
    const list = p.recipient ? [p.recipient, ...p.mentions] : [...p.mentions];
    return [...new Set(list)].filter((n) => n !== p.agent && memberMap.has(n));
  };

  for (let k = 0; k <= i; k += 1) {
    const p = P[k];
    if (!p) continue;
    born.add(p.agent);
    lastPost.set(p.agent, k);
    for (const target of directTargetsOf(p)) {
      born.add(target);
      lastIn.set(target, k);
    }
  }

  const tsAt = (k: number): number => P[k]?.ts ?? k * 60_000;
  const now = i >= 0 ? tsAt(i) : 0;

  for (const m of nonSystem) {
    const n = m.name;
    const lp = lastPost.get(n) ?? -1;
    const li = lastIn.get(n) ?? -1;
    const finIdx = fin.get(n);
    let st: HiveReplayMemberState = "idle";
    let who: string | null = null;

    if (!born.has(n)) {
      st = "unborn";
    } else if (
      m.killed &&
      (finIdx !== undefined
        ? i >= finIdx && (i > finIdx + 8 || now - tsAt(finIdx) > HV_BUSY_MS)
        : li >= 0 && i > li + 8)
    ) {
      st = "retired";
    } else if (li > lp && now - tsAt(li) < HV_BUSY_MS) {
      st = "working";
      who = P[li]?.agent ?? null;
    } else if (
      lp >= 0 &&
      WAITING_ASK_RE.test(P[lp]?.text ?? "") &&
      directTargetsOf(P[lp]!).length > 0 &&
      now - tsAt(lp) < HV_ASK_MS &&
      (lastPost.get(directTargetsOf(P[lp]!)[0] ?? "") ?? -1) <= lp
    ) {
      st = "wait";
      who = directTargetsOf(P[lp]!)[0] ?? null;
    } else if (
      lp >= 0 &&
      !m.isCoordinator &&
      (DONE_POST_RE.test(P[lp]?.text ?? "") || (finIdx !== undefined && finIdx <= i))
    ) {
      st = "done";
    } else if (lp >= 0 && i - lp < 3 && now - tsAt(lp) < 4 * 60 * 1000) {
      st = "working";
    }
    states[n] = { st, who: who === n ? null : who };
  }

  const isDoneAtSeq = (memberName: string): boolean => {
    const entry = states[memberName];
    if (!entry) return false;
    if (entry.st === "retired" || entry.st === "done") return true;
    const f = fin.get(memberName);
    return f !== undefined && f <= i && DONE_POST_RE.test(P[f]?.text ?? "");
  };

  const beam = i >= 0 ? (P[i] ?? null) : null;
  const trailBeams = i > 0 ? P.slice(Math.max(0, i - 2), i) : [];

  return { states, isDoneAtSeq, beam, trailBeams };
}

// ---------------------------------------------------------------------------
// Honeycomb Hive & Mention Graph Layout (1:1 AGY hive.js + app.js)
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

export function buildHexPolygonPath(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg = 0,
): string {
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
  readonly isAcpDelegated: boolean;
  readonly aggregateState: "" | "busy" | "warn" | "bad";
  readonly members: readonly string[];
  readonly overflowCount: number;
  readonly overflowX: number;
  readonly overflowY: number;
  readonly pathD: string;
  readonly progPathD: string;
  readonly selPathD: string;
}

export interface HiveBeePlacement {
  readonly name: string;
  readonly displayName: string;
  readonly providerBrand: AgentBrandId;
  readonly sourceKind: AgentAuxMemberSourceKind;
  readonly x: number;
  readonly y: number;
  readonly size: "xs" | "sm" | "lg";
  readonly state: AgentAuxMemberVisualStatus;
  readonly replayState: HiveReplayMemberState;
  readonly waitingOn: string | null;
  readonly isQueen: boolean;
  readonly killed: boolean;
  readonly tucked: boolean;
}

export interface HiveBeamEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly pathD: string;
  readonly x2: number;
  readonly y2: number;
  readonly arrowPathD?: string;
  readonly kind: "beam" | "wait";
  readonly isTrail?: boolean;
  readonly seq?: number;
}

export interface HiveLayoutResult {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly fitRadius: number;
  readonly maxZoom: number;
  readonly mode: "full" | "mid" | "tiny";
  readonly showNames: boolean;
  readonly cells: readonly HiveCellNode[];
  readonly bees: readonly HiveBeePlacement[];
  readonly beams: readonly HiveBeamEdge[];
  readonly hubSubtitle: string;
  readonly hubNeedsYou: boolean;
  readonly activeMessage: AgentAuxBoardMessage | null;
}

function hiveStateToVisualStatus(st: HiveReplayMemberState): AgentAuxMemberVisualStatus {
  switch (st) {
    case "working":
      return "working";
    case "wait":
      return "waiting_on";
    case "needs":
      return "needs_you";
    case "issue":
      return "error";
    case "done":
      return "done";
    case "retired":
      return "killed";
    case "idle":
    case "unborn":
      return "parked";
  }
}

function buildArrowheadPath(fx: number, fy: number, x: number, y: number): string {
  const len = Math.hypot(x - fx, y - fy) || 1;
  const tx = (x - fx) / len;
  const ty = (y - fy) / len;
  const bx = x - tx * 10;
  const by = y - ty * 10;
  return `M${x.toFixed(1)} ${y.toFixed(1)}L${(bx - ty * 3.8).toFixed(1)} ${(by + tx * 3.8).toFixed(1)}L${(bx + ty * 3.8).toFixed(1)} ${(by - tx * 3.8).toFixed(1)}Z`;
}

export function computeHiveLayout(input: {
  readonly model: AgentAuxViewModel;
  readonly containerWidth: number;
  readonly replaySeq: number | null;
  readonly hideInactive: boolean;
  readonly zoom?: number;
  readonly selectedCellId?: string | null;
  readonly nowMs?: number;
}): HiveLayoutResult {
  const { model, replaySeq, hideInactive, selectedCellId = null, nowMs } = input;
  const s = getAuxStrings(model.locale);
  const W = Math.max(280, Math.floor(input.containerWidth || 360));
  const nonSystem = model.members.filter((m) => !m.isSystem);
  const hs = computeHiveStateAtSeq(model, replaySeq, nowMs);

  const visibleMessages =
    replaySeq === null
      ? model.messages.filter((m) => !m.isControl)
      : (() => {
          const all = model.messages.filter((m) => !m.isControl);
          const idx = all.findIndex((m) => m.seq === replaySeq);
          return idx >= 0 ? all.slice(0, idx + 1) : all.filter((m) => m.seq <= replaySeq);
        })();

  const activeNames = new Set<string>();
  for (const m of visibleMessages) {
    activeNames.add(m.agent);
    if (m.recipient) activeNames.add(m.recipient);
    for (const t of m.mentions) activeNames.add(t);
  }

  const members = nonSystem.filter((m) => {
    if (!hideInactive) return true;
    if (m.isCoordinator) return true;
    const st = hs.states[m.name]?.st;
    if (st === "retired" || m.killed) return false;
    return st === "working" || st === "wait" || st === "issue" || activeNames.has(m.name);
  });

  const coordinator = members.find((m) => m.isCoordinator) ?? members[0] ?? null;
  const workers = members.filter((m) => m.name !== coordinator?.name);
  const memberByName = new Map(members.map((m) => [m.name, m]));

  const wsDone = (w: AgentAuxWorkstream): boolean => {
    if (hs.isDoneAtSeq) {
      return w.owners.every((o) => o === "coordinator" || hs.isDoneAtSeq!(o));
    }
    return w.state === "done";
  };

  const settledAtSeq = (name: string): boolean => {
    const st = hs.states[name]?.st;
    return st === "done" || st === "retired";
  };

  // Build cells around the coordinator hub
  const rawCells: Array<{
    id: string;
    title: string;
    goal: string;
    members: string[];
    done: number;
    total: number;
    isAcpDelegated: boolean;
  }> = [];

  if (model.threadGroups.length > 0) {
    const wsById = new Map(model.workstreams.map((w) => [w.id, w]));
    const cellWorkstreams: Array<{
      cell: (typeof rawCells)[number];
      wsList: AgentAuxWorkstream[];
    }> = [];

    for (const tg of model.threadGroups) {
      const wsList = tg.workstreams
        .map((id) => wsById.get(id))
        .filter((w): w is AgentAuxWorkstream => Boolean(w));
      const entry = {
        id: tg.id,
        title: tg.title,
        goal: tg.goal,
        members: [] as string[],
        done: wsList.filter(wsDone).length,
        total: wsList.length,
        isAcpDelegated: tg.sourceKind === "acp-delegated",
      };
      rawCells.push(entry);
      cellWorkstreams.push({ cell: entry, wsList });
    }

    const homed = new Set<string>();
    // Each worker sits in the first thread where it still has open work, else its first thread
    for (const w of workers) {
      const mine = cellWorkstreams.filter((cw) =>
        cw.wsList.some((ws) => ws.owners.includes(w.name)),
      );
      if (mine.length === 0) continue;
      const openCell =
        mine.find((cw) => cw.wsList.some((ws) => ws.owners.includes(w.name) && !wsDone(ws))) ??
        mine[0];
      if (openCell) {
        openCell.cell.members.push(w.name);
        homed.add(w.name);
      }
    }

    // Ensure cells with members have total >= members.length if workstreams empty
    for (const entry of rawCells) {
      if (entry.total === 0 && entry.members.length > 0) {
        entry.total = entry.members.length;
        entry.done = entry.members.filter(settledAtSeq).length;
      }
    }

    const rest = workers.filter((w) => !homed.has(w.name));
    if (rest.length > 0) {
      rawCells.push({
        id: "_other",
        title: s.overviewOtherThread,
        goal: "",
        members: rest.map((w) => w.name),
        done: rest.filter((w) => settledAtSeq(w.name)).length,
        total: rest.length,
        isAcpDelegated: false,
      });
    }
  } else {
    const groups: Array<{
      id: string;
      title: string;
      pick: (m: AgentAuxMember) => boolean;
      doneGroup?: boolean;
    }> = [
      { id: "_working", title: s.stateWorking, pick: (m) => hs.states[m.name]?.st === "working" },
      {
        id: "_waiting",
        title: s.stateWaitingGeneric,
        pick: (m) => {
          const st = hs.states[m.name]?.st;
          return st === "wait" || st === "needs" || st === "issue";
        },
      },
      { id: "_resting", title: s.stateParked, pick: (m) => hs.states[m.name]?.st === "idle" },
      { id: "_done", title: s.stateDone, pick: (m) => settledAtSeq(m.name), doneGroup: true },
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
          isAcpDelegated: picked.every((m) => m.sourceKind === "acp-delegated"),
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
  const Rfit = Math.max(28, Math.min(104, fit - gap / 2));
  const maxZoom = Math.max(1, Math.min(2.6, 108 / Rfit));
  const effectiveZoom = Math.max(1, Math.min(maxZoom, input.zoom ?? 1));
  const R = Math.min(108, Rfit * effectiveZoom);
  const G = R + gap / 2;
  const mode: "full" | "mid" | "tiny" = R >= 72 ? "full" : R >= 42 ? "mid" : "tiny";
  const showNames = R >= 84;
  const CW = Math.max(W, Math.ceil(spanX * G + 16));
  const ox = CW / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * G;
  const oy = 10 + K * R - Math.min(...ys) * G;
  const H = Math.max(220, Math.ceil(spanY * G + 20));

  const allDone = hs.isDoneAtSeq
    ? rawCells.reduce((acc, c) => acc + c.done, 0)
    : model.workstreams.filter((w) => w.state === "done").length;
  const allTotal = hs.isDoneAtSeq
    ? rawCells.reduce((acc, c) => acc + c.total, 0)
    : model.workstreams.length;

  const coordState = coordinator ? (hs.states[coordinator.name]?.st ?? "idle") : "idle";
  const hubNeedsYou = coordState === "needs";
  const hubSubtitle = hubNeedsYou
    ? s.stateNeedsYou
    : allTotal > 0
      ? formatAuxTasksDone(allDone, allTotal, model.locale)
      : s.roleCoordinator;

  const cells: HiveCellNode[] = [];
  const bees: HiveBeePlacement[] = [];
  const posByName = new Map<
    string,
    { x: number; y: number; size: "lg" | "sm" | "xs"; cell?: boolean }
  >();

  const hubTitle = coordinator
    ? coordinator.isCoordinator
      ? s.roleCoordinator
      : coordinator.displayName
    : s.roleCoordinator;

  cells.push({
    id: "_hub",
    title: hubTitle,
    goal: model.goal?.title ?? "",
    cx: ox,
    cy: oy,
    radius: R,
    progressFraction: allTotal > 0 ? allDone / allTotal : 0,
    done: allDone,
    total: allTotal,
    isHub: true,
    isAcpDelegated: false,
    aggregateState: "",
    members: coordinator ? [coordinator.name] : [],
    overflowCount: 0,
    overflowX: ox,
    overflowY: oy,
    pathD: buildHexPolygonPath(ox, oy, R, 0),
    progPathD: buildHexPolygonPath(ox, oy, R - 2.2, -120),
    selPathD: buildHexPolygonPath(ox, oy, R + 1.5, 0),
  });

  if (coordinator) {
    const bx = ox;
    const by = mode === "full" ? oy - R * 0.14 : mode === "mid" ? oy - 6 : oy;
    const beeSize: "lg" | "sm" | "xs" =
      mode === "full" ? "lg" : mode === "mid" || R >= 32 ? "sm" : "xs";
    posByName.set(coordinator.name, { x: bx, y: by, size: beeSize });
    bees.push({
      name: coordinator.name,
      displayName: coordinator.displayName,
      providerBrand: coordinator.providerBrand,
      sourceKind: coordinator.sourceKind,
      x: bx,
      y: by,
      size: beeSize,
      state: hiveStateToVisualStatus(coordState),
      replayState: coordState,
      waitingOn: hs.states[coordinator.name]?.who ?? null,
      isQueen: coordinator.isCoordinator,
      killed: coordState === "retired",
      tucked: false,
    });
  }

  const beePriority = (name: string): number => {
    const st = hs.states[name]?.st ?? "idle";
    switch (st) {
      case "issue":
        return 0;
      case "needs":
        return 1;
      case "wait":
        return 2;
      case "working":
        return 3;
      case "idle":
        return 4;
      case "done":
        return 5;
      case "retired":
        return 6;
      case "unborn":
        return 7;
    }
  };

  rawCells.forEach((cell, idx) => {
    const slot = slots[idx] ?? ([0, -1] as const);
    const cx = ox + ux(slot[0]) * G;
    const cy = oy + uy(slot[0], slot[1]) * G;
    const frac = cell.total > 0 ? cell.done / cell.total : 0;

    const stList = cell.members.map((n) => hs.states[n]?.st ?? "idle");
    const agg: "" | "busy" | "warn" | "bad" = stList.includes("issue")
      ? "bad"
      : stList.includes("wait") || stList.includes("needs")
        ? "warn"
        : stList.includes("working")
          ? "busy"
          : "";

    const born = cell.members
      .filter((n) => (hs.states[n]?.st ?? "idle") !== "unborn")
      .sort((a, b) => beePriority(a) - beePriority(b));

    let overflowCount = 0;
    let overflowX = cx;
    let overflowY = cy;

    if (mode === "tiny") {
      const pick =
        R >= 24
          ? (born.find((n) => hs.states[n]?.st === "issue") ??
            born.find((n) => hs.states[n]?.st === "wait") ??
            born.find((n) => hs.states[n]?.st === "working") ??
            null)
          : null;
      for (const n of cell.members) {
        const m = memberByName.get(n);
        if (!m) continue;
        const rState = hs.states[n]?.st ?? "idle";
        posByName.set(n, { x: cx, y: cy, size: "xs", cell: n !== pick });
        bees.push({
          name: n,
          displayName: m.displayName,
          providerBrand: m.providerBrand,
          sourceKind: m.sourceKind,
          x: cx,
          y: cy,
          size: "xs",
          state: hiveStateToVisualStatus(rState),
          replayState: rState,
          waitingOn: hs.states[n]?.who ?? null,
          isQueen: false,
          killed: rState === "retired",
          tucked: n !== pick,
        });
      }
    } else if (mode === "mid") {
      const show = born.length > 3 ? born.slice(0, 2) : born;
      overflowCount = Math.max(0, born.length - show.length);
      const by = cy + R * 0.28;
      const totalSlots = show.length + (overflowCount > 0 ? 1 : 0);
      show.forEach((n, j) => {
        const m = memberByName.get(n);
        if (!m) return;
        const rState = hs.states[n]?.st ?? "idle";
        const bx = cx + (j - (totalSlots - 1) / 2) * 26;
        posByName.set(n, { x: bx, y: by, size: "xs" });
        bees.push({
          name: n,
          displayName: m.displayName,
          providerBrand: m.providerBrand,
          sourceKind: m.sourceKind,
          x: bx,
          y: by,
          size: "xs",
          state: hiveStateToVisualStatus(rState),
          replayState: rState,
          waitingOn: hs.states[n]?.who ?? null,
          isQueen: false,
          killed: rState === "retired",
          tucked: false,
        });
      });
      if (overflowCount > 0) {
        overflowX = cx + ((totalSlots - 1) / 2) * 26;
        overflowY = by;
        for (const n of born.slice(show.length)) {
          const m = memberByName.get(n);
          if (!m) continue;
          const rState = hs.states[n]?.st ?? "idle";
          posByName.set(n, { x: overflowX, y: overflowY, size: "xs" });
          bees.push({
            name: n,
            displayName: m.displayName,
            providerBrand: m.providerBrand,
            sourceKind: m.sourceKind,
            x: overflowX,
            y: overflowY,
            size: "xs",
            state: hiveStateToVisualStatus(rState),
            replayState: rState,
            waitingOn: hs.states[n]?.who ?? null,
            isQueen: false,
            killed: rState === "retired",
            tucked: true,
          });
        }
      }
    } else {
      // Full mode: 2-row grid (up to 3 per row = 6 slots; if > 6, render 5 bees + "+N" in slot 6, 1:1 Fig 3!)
      const perRow = Math.max(2, Math.min(3, Math.floor((1.65 * R) / 46)));
      const cap = perRow * 2;
      const show = born.length > cap ? born.slice(0, cap - 1) : born;
      overflowCount = Math.max(0, born.length - show.length);
      const stepX = Math.min(54, (1.62 * R) / perRow);
      const rows: string[][] =
        show.length > perRow ? [show.slice(0, perRow), show.slice(perRow)] : [show];
      const rowGap = showNames ? 42 : 30;
      const topY = cy - K * R + 48;
      const botY = cy + K * R - (showNames ? 18 : 10);
      const y0 = (topY + botY) / 2 - ((rows.length - 1) * rowGap) / 2 - (showNames ? 4 : 0);

      rows.forEach((rw, ri) => {
        const isLastRow = ri === rows.length - 1;
        const slotsInRow = rw.length + (isLastRow && overflowCount > 0 ? 1 : 0);
        rw.forEach((n, j) => {
          const m = memberByName.get(n);
          if (!m) return;
          const rState = hs.states[n]?.st ?? "idle";
          const bx = cx + (j - (slotsInRow - 1) / 2) * stepX;
          const by = y0 + ri * rowGap;
          posByName.set(n, { x: bx, y: by, size: "sm" });
          bees.push({
            name: n,
            displayName: m.displayName,
            providerBrand: m.providerBrand,
            sourceKind: m.sourceKind,
            x: bx,
            y: by,
            size: "sm",
            state: hiveStateToVisualStatus(rState),
            replayState: rState,
            waitingOn: hs.states[n]?.who ?? null,
            isQueen: false,
            killed: rState === "retired",
            tucked: false,
          });
        });
        if (isLastRow && overflowCount > 0) {
          overflowX = cx + ((slotsInRow - 1) / 2) * stepX;
          overflowY = y0 + ri * rowGap;
          for (const n of born.slice(show.length)) {
            const m = memberByName.get(n);
            if (!m) continue;
            const rState = hs.states[n]?.st ?? "idle";
            posByName.set(n, { x: overflowX, y: overflowY, size: "xs" });
            bees.push({
              name: n,
              displayName: m.displayName,
              providerBrand: m.providerBrand,
              sourceKind: m.sourceKind,
              x: overflowX,
              y: overflowY,
              size: "xs",
              state: hiveStateToVisualStatus(rState),
              replayState: rState,
              waitingOn: hs.states[n]?.who ?? null,
              isQueen: false,
              killed: rState === "retired",
              tucked: true,
            });
          }
        }
      });
    }

    // Place unborn members invisibly at cell center so beams never fail
    for (const n of cell.members) {
      if (posByName.has(n)) continue;
      posByName.set(n, { x: cx, y: cy, size: "xs" });
    }

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
      isAcpDelegated: cell.isAcpDelegated,
      aggregateState: agg,
      members: cell.members,
      overflowCount,
      overflowX,
      overflowY,
      pathD: buildHexPolygonPath(cx, cy, R, 0),
      progPathD: buildHexPolygonPath(cx, cy, R - 2.2, -120),
      selPathD: buildHexPolygonPath(cx, cy, R + 1.5, 0),
    });
  });

  // Compute curved message beams (active + faded trail) AND dashed waiting_on arrows!
  const beams: HiveBeamEdge[] = [];
  const drawnKeys = new Set<string>();
  const padOf = (p: { size: "lg" | "sm" | "xs"; cell?: boolean }): number =>
    p.cell ? R * 0.45 : p.size === "lg" ? 32 : p.size === "sm" ? 20 : 12;

  const pushLink = (
    from: string,
    to: string,
    kind: "beam" | "wait",
    options?: { readonly isTrail?: boolean; readonly seq?: number },
  ) => {
    const a = posByName.get(from);
    const b = posByName.get(to);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const pa = padOf(a);
    const pb = padOf(b);
    if (len < pa + pb + 6) return;
    const key = `${kind}|${options?.isTrail ? "t" : "a"}|${Math.round(a.x)},${Math.round(a.y)}|${Math.round(b.x)},${Math.round(b.y)}`;
    if (drawnKeys.has(key)) return;
    drawnKeys.add(key);

    const vx = dx / len;
    const vy = dy / len;
    const x1 = a.x + vx * pa;
    const y1 = a.y + vy * pa;
    const x2 = b.x - vx * pb;
    const y2 = b.y - vy * pb;
    const bend = Math.min(34, Math.max(16, (len - pa - pb) * 0.22));
    const mx = (x1 + x2) / 2 - vy * bend;
    const my = (y1 + y2) / 2 + vx * bend;
    const isShort = len - pa - pb < 30;
    const cut = kind === "wait" && !isShort ? 9 : 0;
    const hl = Math.hypot(x2 - mx, y2 - my) || 1;
    const ex = x2 - ((x2 - mx) / hl) * cut;
    const ey = y2 - ((y2 - my) / hl) * cut;
    const pathD = `M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    const arrowPathD =
      kind === "wait"
        ? isShort
          ? buildArrowheadPath(a.x, a.y, x2, y2)
          : buildArrowheadPath(mx, my, x2, y2)
        : undefined;

    beams.push({
      id: `${kind}:${options?.seq ?? 0}:${options?.isTrail ? "trail:" : ""}${from}->${to}`,
      from,
      to,
      pathD,
      x2,
      y2,
      ...(arrowPathD ? { arrowPathD } : {}),
      kind,
      ...(options?.isTrail ? { isTrail: true } : {}),
      ...(options?.seq !== undefined ? { seq: options.seq } : {}),
    });
  };

  const selectedCell = cells.find((c) => c.id === selectedCellId) ?? null;

  // Waiting-on dashed marching arrows
  for (const [name, st] of Object.entries(hs.states)) {
    if (st.st !== "wait" || !st.who) continue;
    if (
      selectedCell &&
      !selectedCell.members.includes(name) &&
      !selectedCell.members.includes(st.who)
    ) {
      continue;
    }
    if (!selectedCell && rawCells.length > 18) continue;
    pushLink(name, st.who, "wait");
  }

  // Faded trail beams (previous 1-2 messages)
  for (const trailMsg of hs.trailBeams) {
    const targets = trailMsg.all
      ? members.filter((m) => m.name !== trailMsg.agent).map((m) => m.name)
      : trailMsg.recipient
        ? [trailMsg.recipient, ...trailMsg.mentions]
        : [...trailMsg.mentions];
    for (const target of new Set(targets)) {
      if (target !== trailMsg.agent) {
        pushLink(trailMsg.agent, target, "beam", { isTrail: true, seq: trailMsg.seq });
      }
    }
  }

  // Active message beam
  if (hs.beam) {
    const targets = hs.beam.all
      ? members.filter((m) => m.name !== hs.beam!.agent).map((m) => m.name)
      : hs.beam.recipient
        ? [hs.beam.recipient, ...hs.beam.mentions]
        : [...hs.beam.mentions];
    for (const target of new Set(targets)) {
      if (target !== hs.beam.agent) {
        pushLink(hs.beam.agent, target, "beam", { seq: hs.beam.seq });
      }
    }
  }

  return {
    width: CW,
    height: H,
    radius: R,
    fitRadius: Rfit,
    maxZoom,
    mode,
    showNames,
    cells,
    bees,
    beams,
    hubSubtitle,
    hubNeedsYou,
    activeMessage: hs.beam,
  };
}

export interface MentionGraphNode {
  readonly name: string;
  readonly displayName: string;
  readonly providerBrand: AgentBrandId;
  readonly sourceKind: AgentAuxMemberSourceKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly status: AgentAuxMemberVisualStatus;
  readonly killed: boolean;
  readonly isCoordinator: boolean;
  readonly isHot: boolean;
  readonly isActiveInReplay: boolean;
  readonly broadcastCount: number;
  readonly unaddressedCount: number;
}

export interface MentionGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly direct: number;
  readonly viaAll: number;
  readonly viaAllOnly: boolean;
  readonly isCurrent: boolean;
  readonly isPast: boolean;
  readonly strokeWidth: number;
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
  const replaying = replaySeq !== null;

  const allMsgs = model.messages.filter((m) => !m.isControl);
  const msgs =
    replaySeq === null
      ? allMsgs
      : (() => {
          const idx = allMsgs.findIndex((m) => m.seq === replaySeq);
          return idx >= 0 ? allMsgs.slice(0, idx + 1) : allMsgs.filter((m) => m.seq <= replaySeq);
        })();

  // Exact 1:1 AGY `app.js:1516`: only replay steps designate a `current` message; live mode stays calm.
  const currentMessage = replaying ? (msgs.at(-1) ?? null) : null;

  const participantSet = new Set<string>(["coordinator"]);
  const broadcastCounts = new Map<string, number>();
  const unaddressedCounts = new Map<string, number>();
  for (const m of msgs) {
    participantSet.add(m.agent);
    if (m.recipient) participantSet.add(m.recipient);
    for (const t of m.mentions) participantSet.add(t);
    if (m.all) {
      broadcastCounts.set(m.agent, (broadcastCounts.get(m.agent) ?? 0) + 1);
    } else if (!m.recipient && !m.mentions.some((t) => t !== m.agent)) {
      unaddressedCounts.set(m.agent, (unaddressedCounts.get(m.agent) ?? 0) + 1);
    }
  }

  const visibleMembers = nonSystem.filter((m) => {
    if (!hideInactive) return true;
    if (m.isCoordinator) return true;
    if (
      currentMessage &&
      (currentMessage.agent === m.name ||
        currentMessage.recipient === m.name ||
        currentMessage.mentions.includes(m.name))
    ) {
      return true;
    }
    if (m.killed) return false;
    return m.status === "working" || participantSet.has(m.name);
  });

  const visibleNameSet = new Set(visibleMembers.map((m) => m.name));
  const coordinator = visibleMembers.find((m) => m.isCoordinator) ?? null;
  const others = visibleMembers.filter((m) => m.name !== coordinator?.name);
  const orderedMembers = coordinator ? [coordinator, ...others] : visibleMembers;

  const resolveNodeDisplayName = (m: AgentAuxMember): string =>
    m.displayName.toLowerCase() === m.name.toLowerCase() ||
    /^acp[_-]?registry[-_]+/i.test(m.displayName)
      ? formatAuxMemberDisplayName(m.name, model.locale, m)
      : m.displayName;

  const nodeH = 28;
  const pillWidth = (m: AgentAuxMember, maxW: number): number => {
    const label = resolveNodeDisplayName(m);
    const full = Math.max(78, 48 + Math.ceil(label.length * 7.2));
    return m.isCoordinator ? Math.min(180, full) : Math.min(maxW, full);
  };

  const nodes: MentionGraphNode[] = [];
  const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  let H = 260;

  const makeNode = (m: AgentAuxMember, x: number, y: number, maxW: number): MentionGraphNode => {
    const w = pillWidth(m, maxW);
    posMap.set(m.name, { x, y, w, h: nodeH });
    const isHot = Boolean(
      currentMessage &&
      (currentMessage.agent === m.name ||
        currentMessage.recipient === m.name ||
        currentMessage.mentions.includes(m.name) ||
        (expandAll && currentMessage.all && currentMessage.agent !== m.name)),
    );
    return {
      name: m.name,
      displayName: resolveNodeDisplayName(m),
      providerBrand: m.providerBrand,
      sourceKind: m.sourceKind,
      x,
      y,
      width: w,
      height: nodeH,
      status: m.status,
      killed: m.killed,
      isCoordinator: m.isCoordinator,
      isHot,
      isActiveInReplay: !replaying || participantSet.has(m.name) || m.isCoordinator,
      broadcastCount: expandAll ? 0 : (broadcastCounts.get(m.name) ?? 0),
      unaddressedCount: unaddressedCounts.get(m.name) ?? 0,
    };
  };

  // Up to 16 nodes: clean ellipse with coordinator at top (-90°), exact match to AGY app.js:1396!
  if (orderedMembers.length <= 16) {
    const n = orderedMembers.length;
    const maxW = Math.min(152, Math.max(104, W / Math.max(3, Math.ceil(n / 2) + 1) - 10));
    const rx = Math.max(62, W / 2 - maxW / 2 - 14);
    const ry = n <= 2 ? 58 : Math.min(180, Math.max(92, n * 18));
    const cx = W / 2;
    const cy = ry + nodeH / 2 + 22;
    H = Math.ceil(cy + ry + nodeH / 2 + 22);
    orderedMembers.forEach((m, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, n);
      const scale = n === 1 ? 0 : 1;
      nodes.push(
        makeNode(m, cx + rx * scale * Math.cos(angle), cy + ry * scale * Math.sin(angle), maxW),
      );
    });
  } else {
    // Wrapped staggered rows for > 16 members
    const minNodeW = 110;
    const lineH = 56;
    const perLine = Math.max(1, Math.floor(W / (minNodeW + 12)));
    let y = 32;
    const rowGroups = coordinator ? [[coordinator], others] : [orderedMembers];
    for (const grp of rowGroups) {
      for (let i = 0; i < grp.length; i += perLine) {
        const line = grp.slice(i, i + perLine);
        const gap = W / (line.length + 1);
        const maxW = Math.min(150, Math.max(minNodeW, gap - 10));
        line.forEach((m, j) => {
          nodes.push(
            makeNode(m, gap * (j + 1), y + (line.length > 3 && j % 2 === 1 ? 12 : 0), maxW),
          );
        });
        y += lineH;
      }
      y += 24;
    }
    H = Math.max(240, y);
  }

  // Aggregate directed edges from msgs up to replaySeq
  const edgeAcc = new Map<string, { from: string; to: string; direct: number; viaAll: number }>();
  for (const m of msgs) {
    if (!visibleNameSet.has(m.agent)) continue;
    const directCandidates = m.recipient ? [m.recipient, ...m.mentions] : [...m.mentions];
    const directTargets = new Set(
      directCandidates.filter((t) => t !== m.agent && visibleNameSet.has(t)),
    );
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

  let maxCount = 1;
  for (const e of edgeAcc.values()) {
    const tot = e.direct + e.viaAll;
    if (tot > maxCount) maxCount = tot;
  }

  const trimToBox = (
    p: { x: number; y: number; w: number; h: number },
    q: { x: number; y: number },
  ): { x: number; y: number } => {
    const tx = q.x - p.x;
    const ty = q.y - p.y;
    const l = Math.hypot(tx, ty) || 1;
    const ux = tx / l;
    const uy = ty / l;
    const toBorder = Math.min(
      ux !== 0 ? p.w / 2 / Math.abs(ux) : Number.POSITIVE_INFINITY,
      uy !== 0 ? p.h / 2 / Math.abs(uy) : Number.POSITIVE_INFINITY,
    );
    const t = Math.min(0.45 * l, toBorder + 4);
    return { x: p.x + ux * t, y: p.y + uy * t };
  };

  const edges: MentionGraphEdge[] = [];
  for (const e of edgeAcc.values()) {
    const a = posMap.get(e.from);
    const b = posMap.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const hasReverse = edgeAcc.has(`${e.to}\0${e.from}`);
    const bend = hasReverse ? 24 : 16;
    const mx = (a.x + b.x) / 2 + nx * bend;
    const my = (a.y + b.y) / 2 + ny * bend;
    const s1 = trimToBox(a, { x: mx, y: my });
    const e1 = trimToBox(b, { x: mx, y: my });
    const total = e.direct + e.viaAll;
    const strokeWidth = Number((1.2 + (3.0 * total) / maxCount).toFixed(2));
    const isCurrent = Boolean(
      currentMessage &&
      currentMessage.agent === e.from &&
      (currentMessage.recipient === e.to ||
        currentMessage.mentions.includes(e.to) ||
        (expandAll && currentMessage.all)),
    );
    edges.push({
      id: `${e.from}->${e.to}`,
      from: e.from,
      to: e.to,
      count: total,
      direct: e.direct,
      viaAll: e.viaAll,
      viaAllOnly: e.direct === 0 && e.viaAll > 0,
      isCurrent,
      isPast: replaying && !isCurrent,
      strokeWidth,
      pathD: `M${s1.x.toFixed(1)} ${s1.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${e1.x.toFixed(1)} ${e1.y.toFixed(1)}`,
      labelX: (s1.x + 2 * mx + e1.x) / 4,
      labelY: (s1.y + 2 * my + e1.y) / 4,
      endX: e1.x,
      endY: e1.y,
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
  readonly swarmSignalCount?: number;
}): string | null {
  if (!input.isServerThread || input.embedded || !input.threadKey) return null;
  if (!input.model.active || !input.model.activationKey) {
    return null;
  }
  const hasLiveOrInitializingSwarm =
    input.model.hasLiveActivity ||
    (input.model.kind === "agy-swarm" &&
      (input.swarmSignalCount ?? 0) > 0 &&
      !input.model.finished &&
      input.model.members.length >= 1);
  if (!hasLiveOrInitializingSwarm) {
    return null;
  }
  const compositeKey = `${input.threadKey}::${input.model.activationKey}`;
  if (input.autoOpenedKeys.has(compositeKey)) return null;
  return compositeKey;
}

// ---------------------------------------------------------------------------
// Projection Contracts & Rich Multi-Agent Collector
// ---------------------------------------------------------------------------

const ACTIVE_SUBAGENT_STATUS_SET = new Set([
  "running",
  "pending",
  "starting",
  "queued",
  "waiting_input",
  "in_progress",
  "working",
  "waiting",
]);

function normalizeSubagentStatus(raw: string): AgentAuxMemberVisualStatus {
  const lower = raw.trim().toLowerCase();
  if (
    lower === "running" ||
    lower === "starting" ||
    lower === "in_progress" ||
    lower === "working"
  ) {
    return "working";
  }
  if (lower === "waiting_input" || lower === "waiting") return "waiting_on";
  if (lower === "pending" || lower === "queued") return "parked";
  if (lower === "failed" || lower === "error") return "error";
  if (
    lower === "cancelled" ||
    lower === "killed" ||
    lower === "stopped" ||
    lower === "interrupted"
  ) {
    return "killed";
  }
  return "done";
}

function normalizeWorkstreamState(raw: string | undefined): AgentAuxWorkstream["state"] {
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

function normalizeWorkstreamRawState(raw: string | undefined): AgentAuxWorkstreamRawState {
  switch ((raw ?? "").toLowerCase()) {
    case "done":
    case "completed":
      return "done";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "review":
      return "review";
    case "queued":
    case "pending":
      return "queued";
    default:
      return "active";
  }
}

function mapNativeSteps(
  steps:
    | readonly (DaemonAgentAuxNativeStepDto | OrchestrationV2NativeChildStep)[]
    | null
    | undefined,
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

export interface AgentAuxProviderEntryLike {
  readonly instanceId: string;
  readonly driverKind: string;
  readonly displayName?: string | null | undefined;
  readonly hasCustomDisplayName?: boolean | undefined;
  readonly acpRegistryAgentId?: string | null | undefined;
  readonly acpCommandPath?: string | null | undefined;
  readonly models?:
    | ReadonlyArray<{ readonly slug: string; readonly name?: string | undefined }>
    | undefined;
}

export interface AgentAuxThreadShellLike {
  readonly id: ThreadId;
  readonly title?: string | null | undefined;
  readonly status?: string | null | undefined;
  readonly activityRunStatus?: string | null | undefined;
  readonly activeRunId?: string | null | undefined;
  readonly provider?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly worktreePath?: string | null | undefined;
  readonly branch?: string | null | undefined;
  readonly modelSelection?:
    | {
        readonly instanceId?: string | null | undefined;
        readonly model?: string | null | undefined;
      }
    | null
    | undefined;
  readonly runtime?:
    | {
        readonly status?: string | null | undefined;
        readonly providerInstanceId?: string | null | undefined;
        readonly providerName?: string | null | undefined;
      }
    | null
    | undefined;
  readonly latestRun?: { readonly status?: string | null | undefined } | null | undefined;
  readonly lineage: {
    readonly parentThreadId?: ThreadId | null | undefined;
    readonly sideChat?: boolean | undefined;
  };
}

export interface AgentAuxWorkflowPhaseLike {
  readonly index: number;
  readonly title: string;
}

export interface AgentAuxWorkflowAgentLike {
  readonly index: number;
  readonly label: string;
  readonly agentId?: string | undefined;
  readonly childThreadId?: ThreadId | undefined;
  readonly state: string;
  readonly phaseIndex?: number | undefined;
  readonly phaseTitle?: string | undefined;
  readonly model?: string | undefined;
  readonly totalTokens?: number | undefined;
  readonly toolCalls?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly startedAt?: unknown;
  readonly completedAt?: unknown;
  readonly prompt?: string | undefined;
  readonly result?: string | undefined;
}

export interface AgentAuxSubagentLike {
  readonly id: string;
  readonly runId?: string | null | undefined;
  readonly parentNodeId?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly status: string;
  readonly driver?: string | null | undefined;
  readonly providerInstanceId?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly executedModel?: string | null | undefined;
  readonly childThreadId: ThreadId | null;
  readonly prompt: string;
  readonly progress?: string | null | undefined;
  readonly result?: string | null | undefined;
  readonly startedAt?: unknown;
  readonly completedAt?: unknown;
  readonly updatedAt?: unknown;
  readonly remoteChild?:
    | { readonly label: string; readonly title?: string | undefined }
    | null
    | undefined;
  readonly workflow?:
    | {
        readonly name?: string | undefined;
        readonly phases?: ReadonlyArray<AgentAuxWorkflowPhaseLike> | undefined;
        readonly agents?: ReadonlyArray<AgentAuxWorkflowAgentLike> | undefined;
        readonly durationMs?: number | undefined;
      }
    | null
    | undefined;
}

export interface AgentAuxPlanLike {
  readonly kind?: string | undefined;
  readonly steps?:
    | ReadonlyArray<{
        readonly id: string;
        readonly text: string;
        readonly status: string;
      }>
    | null
    | undefined;
}

export interface AgentAuxProjectionLike {
  readonly runs?: ReadonlyArray<Record<string, unknown>> | undefined;
  readonly attempts?: ReadonlyArray<Record<string, unknown>> | undefined;
  readonly providerTurns?: ReadonlyArray<Record<string, unknown>> | undefined;
  readonly subagents?: ReadonlyArray<AgentAuxSubagentLike> | undefined;
  readonly turnItems?:
    | ReadonlyArray<Record<string, unknown> & { readonly type: string }>
    | undefined;
  readonly plans?: ReadonlyArray<AgentAuxPlanLike> | undefined;
  readonly providerThreads?: ReadonlyArray<unknown> | undefined;
  readonly thread?: unknown;
}

function parseTimestampMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (raw && typeof raw === "object" && "epochMillis" in raw) {
    const em = (raw as { readonly epochMillis?: unknown }).epochMillis;
    if (typeof em === "number" && Number.isFinite(em) && em > 0) return em;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const ms = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function slugifyHandle(raw: string, fallback: string, used: Set<string>): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  const base = cleaned || fallback;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let idx = 2; idx < 200; idx += 1) {
    const candidate = `${base}-${idx}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return `${base}-${used.size + 1}`;
}

export interface ResolveAgentAuxBrandInput {
  readonly provider?: string | null | undefined;
  readonly providerEntry?: AgentAuxProviderEntryLike | null | undefined;
  readonly instanceId?: string | null | undefined;
  readonly runtimeProviderName?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly providerEntryByInstanceId?: ReadonlyMap<string, AgentAuxProviderEntryLike> | undefined;
  readonly fallbackBrand?: AgentBrandId | undefined;
}

/**
 * Multi-signal brand resolver shared by BOTH the Captain (main agent) and every ACP
 * delegated child, matching `DelegatedSubthreadTree`'s proven priority:
 * `acpRegistryAgentId` -> `acpCommandPath` -> `displayName` -> `instanceId` ->
 * `inferAgentBrandFromModel(model)` -> `resolveAgentBrandId(driverKind)`.
 */
export function resolveAgentAuxBrand(input: ResolveAgentAuxBrandInput): AgentBrandId {
  const trimmedProvider = input.provider?.trim() || "";
  const trimmedInstanceId = input.instanceId?.trim() || "";
  const trimmedRuntimeName = input.runtimeProviderName?.trim() || "";
  const trimmedModel = input.model?.trim() || "";

  const entry =
    input.providerEntry ??
    (trimmedInstanceId ? input.providerEntryByInstanceId?.get(trimmedInstanceId) : undefined) ??
    (trimmedProvider ? input.providerEntryByInstanceId?.get(trimmedProvider) : undefined) ??
    null;

  if (entry?.driverKind) {
    const entryDriverBrand = resolveAgentBrandId(entry.driverKind);
    if (entryDriverBrand !== "acp" && entryDriverBrand !== "custom") {
      return entryDriverBrand;
    }
  }

  const authoritativeAcpKey = resolveAcpAgentBrandKey({
    agentId: entry?.acpRegistryAgentId,
    commandPath: entry?.acpCommandPath,
  });
  if (authoritativeAcpKey !== null) {
    return acpBrandKeyToAgentBrandId(authoritativeAcpKey);
  }

  const displayNameAcpKey = resolveAcpAgentBrandKey({
    displayName: entry?.displayName ?? (trimmedRuntimeName || undefined),
  });
  if (displayNameAcpKey !== null) {
    return acpBrandKeyToAgentBrandId(displayNameAcpKey);
  }

  const instanceAcpKey = resolveAcpAgentBrandKey({
    instanceId: entry?.instanceId ?? (trimmedInstanceId || trimmedProvider || undefined),
  });
  if (instanceAcpKey !== null) {
    return acpBrandKeyToAgentBrandId(instanceAcpKey);
  }

  for (const candidate of [trimmedProvider, trimmedInstanceId, trimmedRuntimeName]) {
    if (!candidate) continue;
    const direct = resolveAgentBrandId(candidate);
    if (direct !== "acp" && direct !== "custom") {
      return direct;
    }
  }

  if (trimmedModel) {
    const inferredFromSlug = inferAgentBrandFromModel(trimmedModel);
    if (inferredFromSlug !== null) {
      return inferredFromSlug;
    }
    const catalogModelName = entry?.models?.find((m) => m.slug === trimmedModel)?.name;
    const inferredFromCatalog = inferAgentBrandFromModel(catalogModelName);
    if (inferredFromCatalog !== null) {
      return inferredFromCatalog;
    }
  }

  const driverCandidate = entry?.driverKind || trimmedProvider || trimmedInstanceId;
  if (driverCandidate) {
    const resolved = resolveAgentBrandId(driverCandidate);
    if (resolved !== "custom") return resolved;
  }

  return input.fallbackBrand ?? (driverCandidate ? resolveAgentBrandId(driverCandidate) : "custom");
}

function extractBriefLine(prompt: string, maxLen = 110): string {
  const first =
    prompt
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s#*>-]+/, "").trim())
      .find((line) => line.length > 0) ?? "";
  return first.length > maxLen ? `${first.slice(0, maxLen - 1).trimEnd()}…` : first;
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

function buildMentionEdges(
  messages: readonly AgentAuxBoardMessage[],
  memberNames: ReadonlySet<string>,
): AgentAuxEdge[] {
  const edgeMap = new Map<
    string,
    { from: string; to: string; count: number; direct: number; viaAll: number }
  >();
  for (const msg of messages) {
    if (msg.isControl) continue;
    const directTargets = new Set(
      (msg.recipient ? [msg.recipient, ...msg.mentions] : [...msg.mentions]).filter(
        (n) => n !== msg.agent && memberNames.has(n),
      ),
    );
    const allTargets = new Set<string>(directTargets);
    if (msg.all) {
      for (const n of memberNames) {
        if (n !== msg.agent) allTargets.add(n);
      }
    }
    for (const to of allTargets) {
      const key = `${msg.agent}\0${to}`;
      const existing = edgeMap.get(key) ?? { from: msg.agent, to, count: 0, direct: 0, viaAll: 0 };
      existing.count += 1;
      if (directTargets.has(to)) existing.direct += 1;
      else existing.viaAll += 1;
      edgeMap.set(key, existing);
    }
  }
  return [...edgeMap.values()];
}

interface CollectedDelegatedChild {
  readonly member: AgentAuxMember;
  readonly prompt: string;
  readonly progress: string;
  readonly result: string;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly phaseIndex?: number;
  readonly phaseTitle?: string;
  readonly runId?: string | null;
  readonly driverLabel: string;
  readonly parentName: string;
}

function collectDelegatedChildren(input: {
  readonly parentProvider: string | null;
  readonly parentBrand: AgentBrandId;
  readonly threadId: ThreadId | null;
  readonly projection?: AgentAuxProjectionLike | null | undefined;
  readonly relationshipShells?: ReadonlyArray<AgentAuxThreadShellLike> | undefined;
  readonly nativeChildWork?: ReadonlyArray<OrchestrationV2NativeChildWork> | undefined;
  readonly providerEntryByInstanceId?: ReadonlyMap<string, AgentAuxProviderEntryLike> | undefined;
  readonly daemonSnapshot: DaemonAgentAuxInspectResponse | null;
  readonly locale: AgentAuxLocale;
  readonly reservedHandles?: ReadonlySet<string>;
  readonly asAbsorbedAcp?: boolean;
}): {
  readonly children: readonly CollectedDelegatedChild[];
  readonly workflowPhases: readonly AgentAuxWorkflowPhaseLike[];
} {
  const s = getAuxStrings(input.locale);
  const usedHandles = new Set<string>(["coordinator", ...(input.reservedHandles ?? [])]);
  const seenIds = new Set<string>();
  const shellById = new Map((input.relationshipShells ?? []).map((sh) => [sh.id, sh] as const));
  const children: CollectedDelegatedChild[] = [];
  const workflowPhases: AgentAuxWorkflowPhaseLike[] = [];
  const seenPhaseIdx = new Set<number>();

  const makeHandle = (
    candidate: string,
    driver: string | null | undefined,
    idx: number,
  ): string => {
    const prefix = input.asAbsorbedAcp && usedHandles.has(candidate.toLowerCase()) ? "acp-" : "";
    const fallback = driver ? `${prefix}${driver}-${idx + 1}` : `${prefix}agent-${idx + 1}`;
    return slugifyHandle(`${prefix}${candidate}`, fallback, usedHandles);
  };

  // 1. Rich `projection.subagents` (including nested `workflow.agents` + `workflow.phases`)
  for (const agent of input.projection?.subagents ?? []) {
    const wf = agent.workflow;
    if (wf && Array.isArray(wf.phases)) {
      for (const ph of wf.phases) {
        if (!seenPhaseIdx.has(ph.index)) {
          seenPhaseIdx.add(ph.index);
          workflowPhases.push(ph);
        }
      }
    }

    if (wf && Array.isArray(wf.agents) && wf.agents.length > 0) {
      for (const wfa of wf.agents) {
        const key = wfa.childThreadId ?? `${agent.id}:wf:${wfa.index}`;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        const childShell = wfa.childThreadId ? shellById.get(wfa.childThreadId) : undefined;
        const status = normalizeSubagentStatus(childShell?.activityRunStatus ?? wfa.state);
        const modelStr =
          wfa.model ||
          agent.executedModel ||
          agent.model ||
          childShell?.modelSelection?.model ||
          childShell?.model ||
          "";
        const wfaAgentBrand = wfa.agentId ? resolveAgentBrandId(wfa.agentId) : "custom";
        const wfaProviderHint =
          wfa.agentId &&
          (input.providerEntryByInstanceId?.has(wfa.agentId) ||
            (wfaAgentBrand !== "acp" && wfaAgentBrand !== "custom"))
            ? wfa.agentId
            : (agent.driver ?? childShell?.provider ?? wfa.agentId);
        const childInstanceId =
          childShell?.runtime?.providerInstanceId ??
          childShell?.modelSelection?.instanceId ??
          agent.providerInstanceId ??
          wfa.agentId ??
          null;
        const memberBrand = resolveAgentAuxBrand({
          provider: wfaProviderHint,
          instanceId: childInstanceId,
          runtimeProviderName: childShell?.runtime?.providerName,
          model: modelStr,
          providerEntryByInstanceId: input.providerEntryByInstanceId,
          fallbackBrand: input.parentBrand,
        });
        const displayName = formatSubagentDisplayTitle(wfa.label || agent.title || s.roleSubagent);
        const handle = makeHandle(
          wfa.label || wfa.agentId || displayName,
          agent.driver,
          children.length,
        );
        const prompt = wfa.prompt ?? agent.prompt ?? "";
        const result = wfa.result ?? "";
        const brief = extractBriefLine(prompt) || displayName;
        const snippet =
          result.trim() || (status === "working" ? agent.progress?.trim() || brief : brief);
        const sourceKind: AgentAuxMemberSourceKind = input.asAbsorbedAcp
          ? "acp-delegated"
          : "acp-delegated";
        const workspace = childShell?.worktreePath ?? null;
        const workspaceMode = workspace ? "worktree" : agent.remoteChild ? "remote" : null;
        children.push({
          member: {
            id: key,
            name: handle,
            displayName,
            role: input.asAbsorbedAcp ? "acp-delegated" : "subagent",
            roleLabel: formatAuxRoleLabel(
              input.asAbsorbedAcp ? "acp-delegated" : "subagent",
              false,
              input.locale,
            ),
            title: brief,
            brief,
            model: formatAuxModelDisplayLabel(modelStr) || formatAgentBrandName(memberBrand),
            providerBrand: memberBrand,
            sourceKind,
            status,
            statusLabel: formatAuxStatusLabel(status, null, input.locale),
            waitingOn: null,
            wakeMode: "",
            steps: wfa.toolCalls ?? 0,
            posts: 0,
            unread: 0,
            activity: status === "working" ? agent.progress?.trim() || brief : "",
            activityKind: status === "working" ? "tool" : "",
            nowLine: snippet.slice(0, 360),
            lastPostSnippet: snippet.slice(0, 360),
            lastSeq: 0,
            lastTime: "",
            killed: status === "killed",
            isCoordinator: false,
            isSystem: false,
            isYou: false,
            childThreadId: wfa.childThreadId ?? agent.childThreadId,
            conversationId: null,
            color: computeBeeColor(handle),
            backendType: agent.remoteChild?.label ?? null,
            workspace: workspace ?? agent.remoteChild?.label ?? null,
            workspaceMode,
            metrics: {
              ...(wfa.toolCalls !== undefined ? { toolCalls: wfa.toolCalls } : {}),
              ...(wfa.totalTokens !== undefined ? { totalTokens: wfa.totalTokens } : {}),
              ...(wfa.durationMs !== undefined ? { durationMs: wfa.durationMs } : {}),
            },
            failureText: status === "error" ? result || s.stateError : null,
          },
          prompt,
          progress: agent.progress?.trim() ?? "",
          result,
          startedAt: parseTimestampMs(wfa.startedAt ?? agent.startedAt),
          completedAt: parseTimestampMs(wfa.completedAt ?? agent.completedAt ?? agent.updatedAt),
          ...(wfa.phaseIndex !== undefined ? { phaseIndex: wfa.phaseIndex } : {}),
          ...(wfa.phaseTitle ? { phaseTitle: wfa.phaseTitle } : {}),
          runId: agent.runId ?? null,
          driverLabel: formatAgentBrandName(memberBrand),
          parentName: "coordinator",
        });
      }
      continue;
    }

    const key = agent.childThreadId ?? agent.id;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    const childShell = agent.childThreadId ? shellById.get(agent.childThreadId) : undefined;
    const rawStatus = childShell?.activityRunStatus ?? agent.status;
    const status = normalizeSubagentStatus(rawStatus);
    const modelStr =
      agent.executedModel ??
      agent.model ??
      childShell?.modelSelection?.model ??
      childShell?.model ??
      "";
    const childInstanceId =
      childShell?.runtime?.providerInstanceId ??
      childShell?.modelSelection?.instanceId ??
      agent.providerInstanceId ??
      null;
    const memberBrand = resolveAgentAuxBrand({
      provider: agent.driver ?? childShell?.provider,
      instanceId: childInstanceId,
      runtimeProviderName: childShell?.runtime?.providerName,
      model: modelStr,
      providerEntryByInstanceId: input.providerEntryByInstanceId,
      fallbackBrand: input.parentBrand,
    });
    const rawTitle =
      agent.title?.trim() ||
      childShell?.title?.trim() ||
      extractBriefLine(agent.prompt, 48) ||
      formatAgentBrandName(memberBrand);
    const displayName = formatSubagentDisplayTitle(rawTitle);
    const driverPrefix = agent.driver?.trim() ?? "";
    const handleCandidate =
      driverPrefix && !rawTitle.toLowerCase().startsWith(driverPrefix.toLowerCase())
        ? `${driverPrefix}-${rawTitle}`
        : rawTitle;
    const handle = makeHandle(handleCandidate, agent.driver, children.length);
    const brief = extractBriefLine(agent.prompt) || displayName;
    const progress = agent.progress?.trim() ?? "";
    const result = agent.result?.trim() ?? "";
    const startedAt = parseTimestampMs(agent.startedAt);
    const completedAt = parseTimestampMs(agent.completedAt ?? agent.updatedAt);
    const durationMs =
      startedAt !== null && completedAt !== null && completedAt >= startedAt
        ? completedAt - startedAt
        : undefined;
    const snippet = result || progress || brief;
    const workspace = childShell?.worktreePath ?? agent.remoteChild?.label ?? null;
    const workspaceMode = childShell?.worktreePath
      ? "worktree"
      : agent.remoteChild
        ? "remote"
        : null;

    children.push({
      member: {
        id: agent.id,
        name: handle,
        displayName,
        role: input.asAbsorbedAcp ? "acp-delegated" : "subagent",
        roleLabel: formatAuxRoleLabel(
          input.asAbsorbedAcp ? "acp-delegated" : "subagent",
          false,
          input.locale,
        ),
        title: brief,
        brief,
        model: formatAuxModelDisplayLabel(modelStr) || formatAgentBrandName(memberBrand),
        providerBrand: memberBrand,
        sourceKind: "acp-delegated",
        status,
        statusLabel: formatAuxStatusLabel(status, null, input.locale),
        waitingOn: null,
        wakeMode: "",
        steps: 0,
        posts: 0,
        unread: 0,
        activity: status === "working" ? progress || brief : "",
        activityKind: status === "working" ? "tool" : "",
        nowLine: snippet.slice(0, 360),
        lastPostSnippet: snippet.slice(0, 360),
        lastSeq: 0,
        lastTime: "",
        killed: status === "killed",
        isCoordinator: false,
        isSystem: false,
        isYou: false,
        childThreadId: agent.childThreadId,
        conversationId: null,
        color: computeBeeColor(handle),
        backendType: agent.remoteChild?.label ?? null,
        workspace,
        workspaceMode,
        ...(durationMs !== undefined ? { metrics: { durationMs } } : {}),
        failureText: status === "error" ? result || s.stateError : null,
      },
      prompt: agent.prompt,
      progress,
      result,
      startedAt,
      completedAt,
      runId: agent.runId ?? null,
      driverLabel: formatAgentBrandName(memberBrand),
      parentName: "coordinator",
    });
  }

  // 2. `projection.turnItems` (`type === "subagent"`)
  for (const rawItem of input.projection?.turnItems ?? []) {
    if (rawItem.type !== "subagent") continue;
    const subagentId = typeof rawItem.subagentId === "string" ? rawItem.subagentId : "";
    const childThreadId =
      typeof rawItem.childThreadId === "string" ? (rawItem.childThreadId as ThreadId) : null;
    const key = childThreadId ?? subagentId;
    if (!key || seenIds.has(key)) continue;
    seenIds.add(key);

    const childShell = childThreadId ? shellById.get(childThreadId) : undefined;
    const itemStatus = typeof rawItem.status === "string" ? rawItem.status : "running";
    const status = normalizeSubagentStatus(childShell?.activityRunStatus ?? itemStatus);
    const itemPrompt = typeof rawItem.prompt === "string" ? rawItem.prompt : "";
    const itemProgress = typeof rawItem.progress === "string" ? rawItem.progress : "";
    const itemResult = typeof rawItem.result === "string" ? rawItem.result : "";
    const itemDriver = typeof rawItem.driver === "string" ? rawItem.driver : "";
    const itemProviderInstanceId =
      typeof rawItem.providerInstanceId === "string" ? rawItem.providerInstanceId : null;
    const itemModel =
      typeof rawItem.executedModel === "string"
        ? rawItem.executedModel
        : typeof rawItem.model === "string"
          ? rawItem.model
          : (childShell?.modelSelection?.model ?? childShell?.model ?? "");
    const remoteChild =
      rawItem.remoteChild && typeof rawItem.remoteChild === "object"
        ? (rawItem.remoteChild as { readonly label?: unknown })
        : null;
    const remoteLabel = typeof remoteChild?.label === "string" ? remoteChild.label : null;
    const childInstanceId =
      childShell?.runtime?.providerInstanceId ??
      childShell?.modelSelection?.instanceId ??
      itemProviderInstanceId;
    const memberBrand = resolveAgentAuxBrand({
      provider: itemDriver || childShell?.provider,
      instanceId: childInstanceId,
      runtimeProviderName: childShell?.runtime?.providerName,
      model: itemModel,
      providerEntryByInstanceId: input.providerEntryByInstanceId,
      fallbackBrand: input.parentBrand,
    });
    const rawTitle =
      (typeof rawItem.title === "string" && rawItem.title.trim()) ||
      childShell?.title?.trim() ||
      extractBriefLine(itemPrompt, 48) ||
      formatAgentBrandName(memberBrand);
    const displayName = formatSubagentDisplayTitle(rawTitle);
    const handle = makeHandle(rawTitle, itemDriver, children.length);
    const brief = extractBriefLine(itemPrompt) || displayName;
    const snippet = itemResult.trim() || itemProgress.trim() || brief;

    children.push({
      member: {
        id: subagentId || key,
        name: handle,
        displayName,
        role: input.asAbsorbedAcp ? "acp-delegated" : "subagent",
        roleLabel: formatAuxRoleLabel(
          input.asAbsorbedAcp ? "acp-delegated" : "subagent",
          false,
          input.locale,
        ),
        title: brief,
        brief,
        model: formatAuxModelDisplayLabel(itemModel) || formatAgentBrandName(memberBrand),
        providerBrand: memberBrand,
        sourceKind: "acp-delegated",
        status,
        statusLabel: formatAuxStatusLabel(status, null, input.locale),
        waitingOn: null,
        wakeMode: "",
        steps: 0,
        posts: 0,
        unread: 0,
        activity: status === "working" ? itemProgress || brief : "",
        activityKind: status === "working" ? "tool" : "",
        nowLine: snippet.slice(0, 360),
        lastPostSnippet: snippet.slice(0, 360),
        lastSeq: 0,
        lastTime: "",
        killed: status === "killed",
        isCoordinator: false,
        isSystem: false,
        isYou: false,
        childThreadId,
        conversationId: null,
        color: computeBeeColor(handle),
        backendType: remoteLabel,
        workspace: childShell?.worktreePath ?? remoteLabel ?? null,
        workspaceMode: childShell?.worktreePath ? "worktree" : remoteLabel ? "remote" : null,
        failureText: status === "error" ? itemResult || s.stateError : null,
      },
      prompt: itemPrompt,
      progress: itemProgress,
      result: itemResult,
      startedAt: parseTimestampMs(rawItem.startedAt ?? rawItem.createdAt),
      completedAt: parseTimestampMs(rawItem.completedAt ?? rawItem.updatedAt),
      runId: typeof rawItem.runId === "string" ? rawItem.runId : null,
      driverLabel: formatAgentBrandName(memberBrand),
      parentName: "coordinator",
    });
  }

  // 3. Direct child `relationshipShells` (excluding BTW side chats)
  for (const shell of input.relationshipShells ?? []) {
    if (shell.id === input.threadId) continue;
    if (shell.lineage.parentThreadId !== input.threadId) continue;
    if (shell.lineage.sideChat === true) continue;
    if (seenIds.has(shell.id)) continue;
    seenIds.add(shell.id);
    const rawStatus = shell.activityRunStatus ?? shell.status ?? "idle";
    const status = normalizeSubagentStatus(rawStatus);
    const shellModel = shell.modelSelection?.model ?? shell.model ?? "";
    const shellInstanceId =
      shell.runtime?.providerInstanceId ?? shell.modelSelection?.instanceId ?? null;
    const memberBrand = resolveAgentAuxBrand({
      provider: shell.provider,
      instanceId: shellInstanceId,
      runtimeProviderName: shell.runtime?.providerName,
      model: shellModel,
      providerEntryByInstanceId: input.providerEntryByInstanceId,
      fallbackBrand: input.parentBrand,
    });
    const displayName = formatSubagentDisplayTitle(shell.title?.trim() || s.roleSubagent);
    const handle = makeHandle(displayName, shell.provider, children.length);

    children.push({
      member: {
        id: shell.id,
        name: handle,
        displayName,
        role: input.asAbsorbedAcp ? "acp-delegated" : "subagent",
        roleLabel: formatAuxRoleLabel(
          input.asAbsorbedAcp ? "acp-delegated" : "subagent",
          false,
          input.locale,
        ),
        title: displayName,
        brief: displayName,
        model: formatAuxModelDisplayLabel(shellModel) || formatAgentBrandName(memberBrand),
        providerBrand: memberBrand,
        sourceKind: "acp-delegated",
        status,
        statusLabel: formatAuxStatusLabel(status, null, input.locale),
        waitingOn: null,
        wakeMode: "",
        steps: 0,
        posts: 0,
        unread: 0,
        activity: status === "working" ? displayName : "",
        activityKind: status === "working" ? "tool" : "",
        nowLine: displayName,
        lastPostSnippet: displayName,
        lastSeq: 0,
        lastTime: "",
        killed: status === "killed",
        isCoordinator: false,
        isSystem: false,
        isYou: false,
        childThreadId: shell.id,
        conversationId: null,
        color: computeBeeColor(handle),
        backendType: null,
        workspace: shell.worktreePath ?? null,
        workspaceMode: shell.worktreePath ? "worktree" : null,
        failureText: null,
      },
      prompt: displayName,
      progress: "",
      result: status === "done" ? displayName : "",
      startedAt: null,
      completedAt: null,
      runId: null,
      driverLabel: formatAgentBrandName(memberBrand),
      parentName: "coordinator",
    });
  }

  // 4. AGY detached subagents from daemon (only for non-swarm mode)
  if (!input.asAbsorbedAcp) {
    for (const sub of input.daemonSnapshot?.agySubagents ?? []) {
      if (seenIds.has(sub.conversationId)) continue;
      seenIds.add(sub.conversationId);
      const status: AgentAuxMemberVisualStatus =
        sub.status === "working"
          ? "working"
          : sub.status === "killed"
            ? "killed"
            : sub.status === "done"
              ? "done"
              : "parked";
      const handle = makeHandle(sub.role || sub.conversationId, "antigravity", children.length);
      const steps = mapNativeSteps(sub.steps);
      children.push({
        member: {
          id: sub.conversationId,
          name: handle,
          displayName: sub.role || handle,
          role: sub.role || "subagent",
          roleLabel: formatAuxRoleLabel(sub.role || "subagent", false, input.locale),
          title: sub.role || handle,
          brief: sub.activity || sub.role,
          model: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
          providerBrand: "antigravity",
          sourceKind: "native-subagent",
          status,
          statusLabel: formatAuxStatusLabel(status, null, input.locale),
          waitingOn: null,
          wakeMode: "",
          steps: sub.stepsCount,
          posts: 0,
          unread: 0,
          activity: sub.activity,
          activityKind: sub.activityKind,
          nowLine: sub.activity || sub.state,
          lastPostSnippet: sub.activity || sub.state,
          lastSeq: 0,
          lastTime: "",
          killed: sub.status === "killed",
          isCoordinator: false,
          isSystem: false,
          isYou: false,
          childThreadId: null,
          conversationId: sub.conversationId,
          color: computeBeeColor(handle),
          backendType: "AGY",
          workspace: null,
          workspaceMode: null,
          failureText: null,
          nativeSteps: steps,
        },
        prompt: sub.role,
        progress: sub.activity,
        result: status === "done" ? sub.activity || s.stateDone : "",
        startedAt: sub.transcriptMtime > 0 ? sub.transcriptMtime - 30_000 : null,
        completedAt: sub.transcriptMtime > 0 ? sub.transcriptMtime : null,
        runId: null,
        driverLabel: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
        parentName: "coordinator",
      });
    }
  }

  // 5. Native child work (AGY native subagent batch)
  for (const child of input.nativeChildWork ?? []) {
    if (seenIds.has(child.conversationId)) continue;
    seenIds.add(child.conversationId);
    const steps = mapNativeSteps(child.steps);
    const lastStep = steps.at(-1);
    const working = lastStep?.status === "RUNNING" || lastStep?.status === "PENDING";
    const status: AgentAuxMemberVisualStatus = working ? "working" : "done";
    const displayName = child.role || s.roleSubagent;
    const handle = makeHandle(displayName, "antigravity", children.length);
    const brief = extractBriefLine(child.prompt) || displayName;
    const progress = lastStep?.toolCalls.at(-1)?.summary ?? lastStep?.text ?? "";

    children.push({
      member: {
        id: child.conversationId,
        name: handle,
        displayName,
        role: child.role || "subagent",
        roleLabel: formatAuxRoleLabel(child.role || "subagent", false, input.locale),
        title: brief,
        brief,
        model: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
        providerBrand: "antigravity",
        sourceKind: input.asAbsorbedAcp ? "acp-delegated" : "native-subagent",
        status,
        statusLabel: formatAuxStatusLabel(status, null, input.locale),
        waitingOn: null,
        wakeMode: "",
        steps: steps.length,
        posts: 0,
        unread: 0,
        activity: working ? progress : "",
        activityKind: working ? "tool" : "",
        nowLine: brief,
        lastPostSnippet: progress || brief,
        lastSeq: 0,
        lastTime: "",
        killed: false,
        isCoordinator: false,
        isSystem: false,
        isYou: false,
        childThreadId: null,
        conversationId: child.conversationId,
        color: computeBeeColor(handle),
        backendType: "AGY",
        workspace: null,
        workspaceMode: null,
        failureText: null,
        nativeSteps: steps,
      },
      prompt: child.prompt,
      progress,
      result: status === "done" ? lastStep?.text || s.stateDone : "",
      startedAt: null,
      completedAt: null,
      runId: null,
      driverLabel: CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity,
      parentName: "coordinator",
    });
  }

  // 6. Codex spawned threads from daemon state_5.sqlite
  if (!input.asAbsorbedAcp) {
    for (const sp of input.daemonSnapshot?.codex?.spawnedThreads ?? []) {
      if (seenIds.has(sp.threadId)) continue;
      seenIds.add(sp.threadId);
      const status = normalizeSubagentStatus(sp.status);
      const displayName = sp.nickname || sp.title || sp.threadId.slice(0, 12);
      const handle = makeHandle(displayName, "codex", children.length);
      children.push({
        member: {
          id: sp.threadId,
          name: handle,
          displayName,
          role: sp.role || "subagent",
          roleLabel: formatAuxRoleLabel(sp.role || "subagent", false, input.locale),
          title: sp.title || displayName,
          brief: sp.title || displayName,
          model: formatAuxModelDisplayLabel(sp.model) || CANONICAL_PROVIDER_DISPLAY_NAMES.codex,
          providerBrand: "codex",
          sourceKind: "codex",
          status,
          statusLabel: formatAuxStatusLabel(status, null, input.locale),
          waitingOn: null,
          wakeMode: "",
          steps: 0,
          posts: 0,
          unread: 0,
          activity: status === "working" ? sp.title : "",
          activityKind: status === "working" ? "tool" : "",
          nowLine: sp.title || displayName,
          lastPostSnippet: sp.title || displayName,
          lastSeq: 0,
          lastTime: "",
          killed: status === "killed",
          isCoordinator: false,
          isSystem: false,
          isYou: false,
          childThreadId: null,
          conversationId: sp.threadId,
          color: computeBeeColor(handle),
          backendType: sp.reasoningEffort || null,
          workspace: sp.cwd || null,
          workspaceMode: sp.cwd ? "worktree" : null,
          failureText: null,
        },
        prompt: sp.title || displayName,
        progress: "",
        result: status === "done" ? sp.title || s.stateDone : "",
        startedAt: sp.updatedAtMs > 0 ? sp.updatedAtMs - 15_000 : null,
        completedAt: sp.updatedAtMs > 0 ? sp.updatedAtMs : null,
        runId: null,
        driverLabel: CANONICAL_PROVIDER_DISPLAY_NAMES.codex,
        parentName: "coordinator",
      });
    }
  }

  return { children, workflowPhases };
}

/**
 * Synthesizes chronological Board messages (`prompt` dispatch → progress → completion/failure)
 * from delegated ACP/MCP children so Board, Timeline Replay, Hive arcs & Mentions Graph
 * work identically to native AGY Swarm.
 */
function synthesizeDelegatedMessages(
  children: readonly CollectedDelegatedChild[],
  startSeq: number,
  baseTs: number,
  locale: AgentAuxLocale,
  parentBrand: AgentBrandId,
): readonly AgentAuxBoardMessage[] {
  const s = getAuxStrings(locale);
  const rawEvents: Array<{
    readonly ts: number;
    readonly order: number;
    readonly agent: string;
    readonly recipient: string;
    readonly text: string;
    readonly kind?: string;
    readonly providerBrand: AgentBrandId;
  }> = [];

  children.forEach((child, idx) => {
    const startTs = child.startedAt ?? baseTs + idx * 5_000;
    const endTs = child.completedAt ?? startTs + 15_000;
    const dispatchBody = child.prompt.trim() || child.member.displayName;
    const dispatchText =
      child.member.displayName &&
      !dispatchBody.toLowerCase().includes(child.member.displayName.toLowerCase())
        ? `@${child.member.name} **${child.member.displayName}**\n\n${dispatchBody}`
        : `@${child.member.name} ${dispatchBody}`;

    rawEvents.push({
      ts: startTs,
      order: idx * 10,
      agent: child.parentName,
      recipient: child.member.name,
      text: dispatchText,
      kind: "brief",
      providerBrand: parentBrand,
    });

    // Optional intermediate progress milestone (from progress text or nativeSteps, capped at 2)
    if (child.progress.trim().length > 0 && child.progress.trim() !== child.result.trim()) {
      rawEvents.push({
        ts: Math.round((startTs + endTs) / 2),
        order: idx * 10 + 1,
        agent: child.member.name,
        recipient: child.parentName,
        text: `@${child.parentName} ${child.progress.trim()}`,
        providerBrand: child.member.providerBrand,
      });
    } else if (child.member.nativeSteps && child.member.nativeSteps.length > 0) {
      const milestones = child.member.nativeSteps
        .filter((st) => st.toolCalls.length > 0 || (st.text && st.text.trim().length > 0))
        .slice(-2);
      milestones.forEach((st, mIdx) => {
        const label =
          st.toolCalls
            .map((tc) => `${tc.name}${tc.summary ? ` (${tc.summary})` : ""}`)
            .join(", ") ||
          st.text?.trim() ||
          "";
        if (label) {
          rawEvents.push({
            ts: startTs + (mIdx + 1) * 3_000,
            order: idx * 10 + 2 + mIdx,
            agent: child.member.name,
            recipient: child.parentName,
            text: `@${child.parentName} ${label}`,
            providerBrand: child.member.providerBrand,
          });
        }
      });
    }

    // Completion or error report
    if (
      child.member.status === "done" ||
      child.member.status === "error" ||
      child.member.status === "killed"
    ) {
      const tag = child.member.status === "done" ? "[done]" : "[blocked]";
      const body =
        child.result.trim() ||
        (child.member.status === "done" ? s.stateDone : child.member.failureText || s.stateKilled);
      rawEvents.push({
        ts: Math.max(endTs, startTs + 1000),
        order: idx * 10 + 9,
        agent: child.member.name,
        recipient: child.parentName,
        text: `@${child.parentName} ${tag} ${body}`,
        providerBrand: child.member.providerBrand,
      });
    }
  });

  rawEvents.sort((a, b) => a.ts - b.ts || a.order - b.order);

  return rawEvents.map((ev, idx) => {
    const seq = startSeq + idx;
    const screenshots = extractScreenshotsFromText(ev.text);
    return {
      seq,
      agent: ev.agent,
      recipient: ev.recipient,
      text: ev.text,
      time: formatAuxClockTime(ev.ts),
      ts: ev.ts,
      mentions: [ev.recipient],
      all: false,
      ...(ev.kind ? { kind: ev.kind } : {}),
      sourceKind: "acp-delegated",
      providerBrand: ev.providerBrand,
      ...(screenshots.length > 0 ? { screenshots } : {}),
      isControl: false,
      isDirectToYou: false,
      isUnread: false,
    };
  });
}

/**
 * Unified Hybrid Swarm + ACP/MCP Absorption Merger (Board #129):
 * When a thread has an active AGY Swarm AND simultaneously invokes ACP / Prismux MCP
 * delegated subagents, absorbs those delegated agents directly INTO the active Swarm
 * across Overview (`ACP 外部委派` workgroup), Board (chronologically interleaved messages),
 * Members (vendor brand badges + click-to-open-thread), and Hive / Mentions Graph!
 */
export function mergeSwarmAndDelegatedAgents(input: {
  readonly swarmMembers: readonly AgentAuxMember[];
  readonly swarmMessages: readonly AgentAuxBoardMessage[];
  readonly swarmWorkstreams: readonly AgentAuxWorkstream[];
  readonly swarmThreadGroups: readonly AgentAuxThreadGroup[];
  readonly swarmHeadSeq: number;
  readonly delegatedChildren: readonly CollectedDelegatedChild[];
  readonly locale: AgentAuxLocale;
  readonly parentBrand: AgentBrandId;
}): {
  readonly members: readonly AgentAuxMember[];
  readonly messages: readonly AgentAuxBoardMessage[];
  readonly workstreams: readonly AgentAuxWorkstream[];
  readonly threadGroups: readonly AgentAuxThreadGroup[];
  readonly edges: readonly AgentAuxEdge[];
  readonly headSeq: number;
  readonly hasAbsorbedAcpAgents: boolean;
} {
  if (input.delegatedChildren.length === 0) {
    const memberNames = new Set(input.swarmMembers.filter((m) => !m.isSystem).map((m) => m.name));
    return {
      members: input.swarmMembers,
      messages: input.swarmMessages,
      workstreams: input.swarmWorkstreams,
      threadGroups: input.swarmThreadGroups,
      edges: buildMentionEdges(input.swarmMessages, memberNames),
      headSeq: input.swarmHeadSeq,
      hasAbsorbedAcpAgents: false,
    };
  }

  const s = getAuxStrings(input.locale);
  const latestSwarmTs =
    input.swarmMessages.reduce<number>((max, m) => (m.ts !== null && m.ts > max ? m.ts : max), 0) ||
    Date.now();

  const syntheticMessages = synthesizeDelegatedMessages(
    input.delegatedChildren,
    input.swarmHeadSeq + 1,
    latestSwarmTs + 1_000,
    input.locale,
    input.parentBrand,
  );

  // Compute post stats for absorbed members
  const postStatsByName = new Map<
    string,
    { posts: number; lastSeq: number; lastTime: string; snippet: string }
  >();
  for (const msg of syntheticMessages) {
    const prev = postStatsByName.get(msg.agent) ?? {
      posts: 0,
      lastSeq: 0,
      lastTime: "",
      snippet: "",
    };
    postStatsByName.set(msg.agent, {
      posts: prev.posts + 1,
      lastSeq: msg.seq,
      lastTime: msg.time,
      snippet: msg.text.slice(0, 360),
    });
  }

  const absorbedMembers: AgentAuxMember[] = input.delegatedChildren.map((child) => {
    const stats = postStatsByName.get(child.member.name);
    return {
      ...child.member,
      sourceKind: "acp-delegated",
      posts: stats?.posts ?? 0,
      lastSeq: stats?.lastSeq ?? 0,
      lastTime: stats?.lastTime ?? "",
      lastPostSnippet: stats?.snippet || child.member.lastPostSnippet,
    };
  });

  const mergedMembers = [...input.swarmMembers, ...absorbedMembers];

  // Interleave native board.jsonl messages + absorbed ACP messages chronologically by timestamp
  // while keeping exact native `#seq` intact so every native citation `#106` remains accurate.
  const mergedMessages = [...input.swarmMessages, ...syntheticMessages].sort((a, b) => {
    const ta = a.ts ?? Number.MAX_SAFE_INTEGER;
    const tb = b.ts ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.seq - b.seq;
  });

  const headSeq = Math.max(input.swarmHeadSeq, ...syntheticMessages.map((m) => m.seq));

  const absorbedWorkstreams: AgentAuxWorkstream[] = absorbedMembers.map((m, idx) => {
    const rawState: AgentAuxWorkstreamRawState =
      m.status === "working"
        ? "active"
        : m.status === "error" || m.status === "waiting_on" || m.status === "needs_you"
          ? "blocked"
          : m.status === "done" || m.killed
            ? "done"
            : "queued";
    return {
      id: `acp-ws-${m.id}`,
      title: m.displayName,
      state:
        rawState === "active"
          ? "running"
          : rawState === "blocked"
            ? "blocked"
            : rawState === "done"
              ? "done"
              : "queued",
      rawState,
      owners: [m.name],
      note: m.nowLine,
      progress: null,
      blockedOn: null,
      waitingOn: m.waitingOn,
      seq: m.lastSeq || input.swarmHeadSeq + idx + 1,
      sourceKind: "acp-delegated",
    };
  });

  const acpThreadGroup: AgentAuxThreadGroup = {
    id: "t-acp-delegations",
    title: s.overviewAcpAbsorbedThread,
    goal: s.overviewAcpAbsorbedGoal,
    now: absorbedMembers.find((m) => m.status === "working")?.activity ?? "",
    workstreams: absorbedWorkstreams.map((w) => w.id),
    sourceKind: "acp-delegated",
  };

  const mergedWorkstreams = [...input.swarmWorkstreams, ...absorbedWorkstreams];
  const mergedThreadGroups = [...input.swarmThreadGroups, acpThreadGroup];
  const memberNameSet = new Set(mergedMembers.filter((m) => !m.isSystem).map((m) => m.name));
  const mergedEdges = buildMentionEdges(mergedMessages, memberNameSet);

  return {
    members: mergedMembers,
    messages: mergedMessages,
    workstreams: mergedWorkstreams,
    threadGroups: mergedThreadGroups,
    edges: mergedEdges,
    headSeq,
    hasAbsorbedAcpAgents: true,
  };
}

// ---------------------------------------------------------------------------
// Unified Multi-Agent ViewModel Builder
// ---------------------------------------------------------------------------

function extractParentModelFromProjection(
  projection: AgentAuxProjectionLike | null | undefined,
): string {
  if (!projection || typeof projection !== "object") return "";
  const rec = projection as unknown as Record<string, unknown>;
  const thread =
    rec.thread && typeof rec.thread === "object" ? (rec.thread as Record<string, unknown>) : null;
  const sel =
    thread?.modelSelection && typeof thread.modelSelection === "object"
      ? (thread.modelSelection as Record<string, unknown>)
      : null;
  if (typeof sel?.model === "string" && sel.model.trim()) return sel.model.trim();
  const runs = Array.isArray(rec.runs) ? rec.runs : [];
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const r = runs[i] as Record<string, unknown> | undefined;
    if (typeof r?.model === "string" && r.model.trim()) return r.model.trim();
  }
  return "";
}

const TERMINAL_RUN_STATUS_SET = new Set([
  "completed",
  "done",
  "idle",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "stopped",
  "interrupted",
  "aborted",
]);

function isParentProjectionRunning(
  projection: AgentAuxProjectionLike | null | undefined,
  threadShell: AgentAuxThreadShellLike | null | undefined,
): boolean {
  if (threadShell) {
    if (Boolean(threadShell.activeRunId)) {
      return true;
    }
    const actStatus = (threadShell.activityRunStatus ?? "").trim().toLowerCase();
    if (ACTIVE_SUBAGENT_STATUS_SET.has(actStatus)) {
      return true;
    }
    if (TERMINAL_RUN_STATUS_SET.has(actStatus)) {
      return false;
    }
    const shellStatus = (threadShell.status ?? "").trim().toLowerCase();
    if (ACTIVE_SUBAGENT_STATUS_SET.has(shellStatus)) {
      return true;
    }
    const latestRunStatus = (threadShell.latestRun?.status ?? "").trim().toLowerCase();
    if (ACTIVE_SUBAGENT_STATUS_SET.has(latestRunStatus)) {
      return true;
    }
    if (TERMINAL_RUN_STATUS_SET.has(latestRunStatus)) {
      return false;
    }
  }
  const runs = Array.isArray(projection?.runs) ? projection.runs : [];
  const latestRun = runs.at(-1);
  if (latestRun) {
    const st = typeof latestRun.status === "string" ? latestRun.status.trim().toLowerCase() : "";
    if (ACTIVE_SUBAGENT_STATUS_SET.has(st)) return true;
  }
  return false;
}

function extractWorkerBriefFromMessages(
  messages: readonly AgentAuxBoardMessage[],
  workerName: string,
  coordinatorName: string,
): string {
  const lowerWorker = workerName.toLowerCase();
  const briefMsg =
    messages.find(
      (m) =>
        !m.isControl &&
        m.agent === coordinatorName &&
        m.kind === "brief" &&
        m.mentions.some((t) => t.toLowerCase() === lowerWorker),
    ) ??
    messages.find(
      (m) =>
        !m.isControl &&
        m.agent === coordinatorName &&
        new RegExp(`^@${workerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(
          m.text.trim(),
        ),
    );
  if (!briefMsg) return "";
  let line =
    briefMsg.text
      .replace(/^@\S+[\s,:]*/i, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .split(/(?<=[.!?。！？])\s|\n/)[0] ?? "";
  line = line
    .replace(
      /^(?:you\s+(?:are|own|handle|drive|run|lead|manage)|your\s+(?:role|job|task|assignment|goal|focus)\s+is(?:\s+to)?|assignment\s*:|role\s*:|task\s*:)\s*/i,
      "",
    )
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > 110 ? `${line.slice(0, 109).trimEnd()}…` : line;
}

function extractParentProviderInstanceIdFromProjection(
  projection: AgentAuxProjectionLike | null | undefined,
): string {
  if (!projection || typeof projection !== "object") return "";
  const rec = projection as unknown as Record<string, unknown>;
  const thread =
    rec.thread && typeof rec.thread === "object" ? (rec.thread as Record<string, unknown>) : null;
  const sel =
    thread?.modelSelection && typeof thread.modelSelection === "object"
      ? (thread.modelSelection as Record<string, unknown>)
      : null;
  if (typeof sel?.instanceId === "string" && sel.instanceId.trim()) return sel.instanceId.trim();
  const runs = Array.isArray(rec.runs) ? rec.runs : [];
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const r = runs[i] as Record<string, unknown> | undefined;
    if (typeof r?.providerInstanceId === "string" && r.providerInstanceId.trim()) {
      return r.providerInstanceId.trim();
    }
  }
  return "";
}

export interface BuildAgentAuxViewModelInput {
  readonly provider: string | null | undefined;
  readonly providerEntry?: AgentAuxProviderEntryLike | null | undefined;
  readonly model?: string | null | undefined;
  readonly threadId: ThreadId | null;
  readonly daemonSnapshot: DaemonAgentAuxInspectResponse | null;
  readonly projection?: AgentAuxProjectionLike | null | undefined;
  readonly threadShell?: AgentAuxThreadShellLike | null | undefined;
  readonly relationshipShells?: ReadonlyArray<AgentAuxThreadShellLike> | undefined;
  readonly nativeChildWork?: ReadonlyArray<OrchestrationV2NativeChildWork> | undefined;
  readonly providerEntries?: ReadonlyArray<ProviderInstanceEntry> | undefined;
  readonly providerEntryByInstanceId?: ReadonlyMap<string, AgentAuxProviderEntryLike> | undefined;
  readonly providerDisplayName?: string | null | undefined;
  readonly locale?: AgentAuxLocale;
}

export function buildAgentAuxViewModel(input: BuildAgentAuxViewModelInput): AgentAuxViewModel {
  const locale: AgentAuxLocale = input.locale ?? "zh";
  const s = getAuxStrings(locale);
  const provider = input.provider ?? null;

  const providerEntryByInstanceId = new Map<string, AgentAuxProviderEntryLike>();
  if (input.providerEntries) {
    for (const entry of input.providerEntries) {
      providerEntryByInstanceId.set(entry.instanceId, entry);
    }
  }
  if (input.providerEntryByInstanceId) {
    for (const [id, entry] of input.providerEntryByInstanceId.entries()) {
      providerEntryByInstanceId.set(id, entry);
    }
  }
  if (input.providerEntry) {
    providerEntryByInstanceId.set(input.providerEntry.instanceId, input.providerEntry);
  }

  const captainInstanceId =
    input.providerEntry?.instanceId ??
    input.threadShell?.runtime?.providerInstanceId ??
    input.threadShell?.modelSelection?.instanceId ??
    (extractParentProviderInstanceIdFromProjection(input.projection) || null);
  const captainEntry =
    input.providerEntry ??
    (captainInstanceId ? providerEntryByInstanceId.get(captainInstanceId) : undefined) ??
    null;
  const parentModelRaw =
    input.model?.trim() ||
    input.threadShell?.modelSelection?.model?.trim() ||
    input.threadShell?.model?.trim() ||
    extractParentModelFromProjection(input.projection);
  const brand = resolveAgentAuxBrand({
    provider,
    providerEntry: captainEntry,
    instanceId: captainInstanceId,
    runtimeProviderName: input.threadShell?.runtime?.providerName ?? input.providerDisplayName,
    model: parentModelRaw,
    providerEntryByInstanceId,
  });
  const defaultBrandName =
    brand !== "acp" && brand !== "custom"
      ? formatAgentBrandName(brand)
      : formatAgentBrandName(provider);
  const rawConfiguredLabel = captainEntry
    ? resolveProviderEntryDisplayName(captainEntry)
    : input.providerEntries && input.providerEntries.length > 0
      ? resolveConfiguredProviderLabel(
          captainInstanceId ?? provider,
          input.providerEntries,
          input.providerDisplayName,
        )
      : brand !== "acp" && brand !== "custom"
        ? formatAgentBrandName(brand, input.providerDisplayName)
        : formatAgentBrandName(provider, input.providerDisplayName);
  const brandDisplayName =
    brand !== "acp" && /^(?:acp|acp\s*registry)$/i.test(rawConfiguredLabel.trim())
      ? defaultBrandName
      : rawConfiguredLabel;
  const hasCustomBrandName =
    brandDisplayName.trim().length > 0 &&
    brandDisplayName.trim().toLowerCase() !== defaultBrandName.trim().toLowerCase();
  const snap = input.daemonSnapshot;
  const updatedAt = snap?.updatedAt ?? Date.now();

  // =========================================================================
  // 1. AGY Native Swarm (+ Hybrid ACP/MCP Absorption when both coexist!)
  // =========================================================================
  if (snap?.active && snap.kind === "agy-swarm" && snap.swarm) {
    const sw = snap.swarm;
    const coordRaw = sw.members.find((m) => m.role === "coordinator" || m.name === "coordinator");
    const coordName = coordRaw?.name ?? "coordinator";
    const systemNames = new Set(
      sw.members.filter((m) => m.roleWorker || m.narrator).map((m) => m.name),
    );
    const isMonitorName = (name: string): boolean => {
      const m = sw.members.find((x) => x.name === name);
      return m?.role === "monitor" || /^monitor(?:-\d+)?$/i.test(name);
    };

    const selfMemberRaw = sw.members.find((m) => m.name === sw.selfMember) ?? null;
    const unreadSeqBoundary =
      selfMemberRaw && selfMemberRaw.lastReadSeq > 0 && selfMemberRaw.lastReadSeq < sw.head
        ? selfMemberRaw.lastReadSeq
        : null;

    const nativeMessages: AgentAuxBoardMessage[] = sw.messages.map((msg) => {
      const screenshots = extractScreenshotsFromText(msg.text);
      return {
        seq: msg.seq,
        agent: msg.agent,
        text: msg.text,
        time: msg.time,
        ts: msg.ts,
        mentions: msg.mentions,
        all: msg.all,
        ...(msg.kind ? { kind: msg.kind } : {}),
        ...(msg.channel ? { channel: msg.channel } : {}),
        ...(msg.viaChannel ? { viaChannel: msg.viaChannel } : {}),
        sourceKind: "swarm",
        providerBrand: "antigravity",
        ...(screenshots.length > 0 ? { screenshots } : {}),
        isControl: Boolean(msg.control),
        isDirectToYou: Boolean(sw.selfMember && msg.mentions.includes(sw.selfMember) && !msg.all),
        isUnread: Boolean(
          unreadSeqBoundary !== null &&
          msg.seq > unreadSeqBoundary &&
          msg.agent !== sw.selfMember &&
          !msg.control,
        ),
      };
    });

    // Track last non-control post per team member & max seq per member for waiting_on detection
    const lastPostByMember = new Map<string, AgentAuxBoardMessage>();
    const maxSeqByMember = new Map<string, number>();
    let lastTeamPost: AgentAuxBoardMessage | null = null;
    let lastMonitorStallPost: AgentAuxBoardMessage | null = null;

    for (const msg of nativeMessages) {
      if (msg.isControl) continue;
      if (isMonitorName(msg.agent) && /\[stall\]/i.test(msg.text)) {
        lastMonitorStallPost = msg;
      }
      if (systemNames.has(msg.agent)) continue;
      lastPostByMember.set(msg.agent, msg);
      const prevMax = maxSeqByMember.get(msg.agent) ?? -1;
      if (msg.seq > prevMax) maxSeqByMember.set(msg.agent, msg.seq);
      lastTeamPost = msg;
    }

    const rawTeam = sw.members.filter((m) => !m.roleWorker && !m.narrator);
    const hasSysAttention = sw.systemAttention.length > 0;
    const anyRawWorking = rawTeam.some((m) => !m.killed && m.status === "working");
    const closed =
      !anyRawWorking &&
      !hasSysAttention &&
      Boolean(
        lastTeamPost && lastTeamPost.agent === coordName && DONE_POST_RE.test(lastTeamPost.text),
      );
    const coordHasOpenAsk = Boolean(
      coordRaw && !coordRaw.killed && coordRaw.replied && coordRaw.replyAsk,
    );
    const nonCoordRawTeam = rawTeam.filter(
      (m) => !(m.role === "coordinator" || m.name === "coordinator"),
    );
    const rawViewWorkstreams = (sw.view?.workstreams ?? []).filter((w) => Boolean(w.title));
    const allNativeWorkersSettled =
      !anyRawWorking &&
      !hasSysAttention &&
      !coordHasOpenAsk &&
      ((nonCoordRawTeam.length > 0 &&
        nonCoordRawTeam.every((m) => {
          if (m.killed) return true;
          const lp = lastPostByMember.get(m.name);
          if (lp && DONE_POST_RE.test(lp.text)) return true;
          const ownedWs = rawViewWorkstreams.filter((w) => (w.owners ?? []).includes(m.name));
          return (
            ownedWs.length > 0 &&
            ownedWs.every((w) => normalizeWorkstreamRawState(w.state) === "done")
          );
        })) ||
        (rawViewWorkstreams.length > 0 &&
          rawViewWorkstreams.every((w) => normalizeWorkstreamRawState(w.state) === "done")));
    const nativeClosed = closed || allNativeWorkersSettled;

    const nativeMembers: AgentAuxMember[] = sw.members.map((m) => {
      const isCoordinator = m.role === "coordinator" || m.name === "coordinator";
      const isSystem = m.roleWorker || m.narrator;
      const lp = lastPostByMember.get(m.name) ?? null;

      let visualStatus: AgentAuxMemberVisualStatus = m.killed
        ? "killed"
        : m.failure
          ? "error"
          : m.status === "working"
            ? "working"
            : isCoordinator && !nativeClosed && m.replied && m.replyAsk
              ? "needs_you"
              : "parked";
      let waitingOn: string | null = null;

      // Exact port of AGY hive.js:978 waiting_on inference
      if (
        visualStatus === "parked" &&
        !nativeClosed &&
        !m.killed &&
        !isSystem &&
        lp &&
        !lp.all &&
        lp.mentions.length > 0 &&
        WAITING_ASK_RE.test(lp.text)
      ) {
        const target = lp.mentions.find((t) => t !== m.name && !systemNames.has(t));
        if (target && (maxSeqByMember.get(target) ?? -1) <= lp.seq) {
          visualStatus = "waiting_on";
          waitingOn = target;
        }
      }

      const planTaskTitle = sw.plan?.tasks?.[m.name] ?? "";
      const extractedBrief = isCoordinator
        ? ""
        : planTaskTitle || extractWorkerBriefFromMessages(nativeMessages, m.name, coordName);
      const strippedLastPost = lp
        ? stripLeadingMentionTokens(lp.text, lp.mentions, lp.all)
            .replace(/^(?:\*\*|\*|`|_)*\[(?:done|stall)\](?:\*\*|\*|`|_)*[\s:,–—-]*/i, "")
            .replace(/\*\*|__|`/g, "")
            .replace(/\s+/g, " ")
            .trim()
        : "";
      const nowLine =
        m.activity ||
        strippedLastPost.slice(0, 160) ||
        (m.lastPostSeq > 0 ? `#${m.lastPostSeq}` : s.membersNoPostsYet);

      return {
        id: m.conversationId || m.name,
        name: m.name,
        displayName: isCoordinator ? "coordinator" : m.name,
        role: m.role,
        roleLabel: formatAuxRoleLabel(m.role, isCoordinator, locale),
        title: isCoordinator ? s.roleCoordinator : extractedBrief,
        brief: extractedBrief,
        model: formatAuxModelDisplayLabel(m.model).replace(/-(?:dropdown|high|medium)$/i, ""),
        providerBrand: "antigravity",
        sourceKind: "swarm",
        status: visualStatus,
        statusLabel: formatAuxStatusLabel(visualStatus, waitingOn, locale),
        waitingOn,
        wakeMode: m.wakeMode,
        steps: m.steps,
        posts: m.posts,
        unread: m.unread,
        activity: m.activity,
        activityKind: m.activityKind,
        nowLine,
        lastPostSnippet: strippedLastPost.slice(0, 180),
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
        forkedFrom: m.forkedFrom ?? null,
        spawnedAt: m.spawnedAt ?? null,
        killedAt: m.killedAt ?? null,
        ...(m.channels && m.channels.length > 0 ? { channels: m.channels } : {}),
        failureText: m.failure?.text ?? null,
      };
    });

    const attention: AgentAuxAttentionItem[] = [];
    for (const a of sw.view?.attention ?? []) {
      if (!a.title) continue;
      const seqRef = a.refs?.find((r) => typeof r.seq === "number")?.seq ?? null;
      const memRef = a.refs?.find((r) => typeof r.member === "string")?.member ?? coordName;
      const kind =
        a.kind === "decision" ||
        a.kind === "failure" ||
        a.kind === "review" ||
        a.kind === "stuck" ||
        a.kind === "quota" ||
        a.kind === "error"
          ? a.kind
          : "fyi";
      const severity = a.severity === "high" || a.severity === "med" ? a.severity : "low";
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
              : memRef === coordName
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
        wait: sys.member === coordName ? "you" : "issue",
      });
    }

    // Build native workstreams (with exact [done] vs review vs waiting_on inference!)
    const memberByName = new Map(nativeMembers.map((m) => [m.name, m]));
    let nativeWorkstreams: AgentAuxWorkstream[] = (sw.view?.workstreams ?? [])
      .filter((w) => Boolean(w.title))
      .map((w, idx) => {
        let progress: AgentAuxWorkstreamProgress | null = null;
        if (typeof w.progress === "number") {
          progress = {
            done: Math.round(w.progress),
            total: 100,
            label: `${Math.round(w.progress)}%`,
          };
        } else if (w.progress && typeof w.progress.total === "number" && w.progress.total > 0) {
          const dn = w.progress.done ?? 0;
          progress = {
            done: dn,
            total: w.progress.total,
            label: w.progress.label || `${dn}/${w.progress.total}`,
          };
        }
        const owners = w.owners && w.owners.length > 0 ? w.owners : [coordName];
        const primaryOwner = memberByName.get(owners[0] ?? "");
        const raw0 = normalizeWorkstreamRawState(w.state);
        const rawState: AgentAuxWorkstreamRawState =
          nativeClosed && raw0 !== "failed" ? "done" : raw0;
        const waitingOn =
          rawState !== "done" ? (w.blocked_on ?? primaryOwner?.waitingOn ?? null) : null;
        return {
          id: w.id || `ws-${idx}`,
          title: w.title ?? s.overviewDelegatedThread,
          state: waitingOn ? "blocked" : normalizeWorkstreamState(rawState),
          rawState,
          owners,
          note: w.note ?? "",
          progress,
          blockedOn: w.blocked_on ?? null,
          waitingOn,
          seq: w.refs?.find((r) => typeof r.seq === "number")?.seq ?? sw.head,
          sourceKind: "swarm",
        };
      });

    if (nativeWorkstreams.length === 0) {
      nativeWorkstreams = nativeMembers
        .filter((m) => !m.isSystem && !m.isCoordinator)
        .map((m) => {
          const lp = lastPostByMember.get(m.name) ?? null;
          let rawState: AgentAuxWorkstreamRawState;
          if (m.killed) {
            rawState = "done";
          } else if (m.status === "error") {
            rawState = "failed";
          } else if (m.status === "waiting_on") {
            rawState = "blocked";
          } else if (m.status === "working" || m.status === "needs_you") {
            rawState = "active";
          } else if (lp) {
            rawState = nativeClosed || DONE_POST_RE.test(lp.text) ? "done" : "review";
          } else {
            rawState = "queued";
          }
          return {
            id: m.name,
            title: m.title || m.brief || `@${m.name}`,
            state:
              rawState === "active"
                ? "running"
                : rawState === "review"
                  ? "review"
                  : rawState === "blocked" || rawState === "failed"
                    ? "blocked"
                    : rawState === "done"
                      ? "done"
                      : "queued",
            rawState,
            owners: [m.name],
            note: m.nowLine,
            progress: null,
            blockedOn: m.waitingOn,
            waitingOn: m.waitingOn,
            seq: m.lastSeq || sw.head,
            sourceKind: "swarm",
          };
        });
    }

    const nativeThreadGroups: AgentAuxThreadGroup[] = [];
    if (sw.view?.threads && sw.view.threads.length > 0) {
      for (const [idx, t] of sw.view.threads.entries()) {
        if (!t.title) continue;
        nativeThreadGroups.push({
          id: t.id || `vt-${idx}`,
          title: t.title,
          goal: t.goal ?? "",
          now: t.now ?? "",
          workstreams: t.workstreams ?? [],
          ...(t.attention ? { attention: t.attention } : {}),
          sourceKind: "swarm",
        });
      }
    } else if (sw.plan?.threads && sw.plan.threads.length > 0) {
      for (const [idx, t] of sw.plan.threads.entries()) {
        if (!t.title) continue;
        const firstWorking = t.tasks
          .map((id) => memberByName.get(id))
          .find((m) => m && !m.killed && m.status === "working");
        nativeThreadGroups.push({
          id: t.id || `pt-${idx}`,
          title: t.title,
          goal: t.goal ?? "",
          now: firstWorking?.activity || "",
          workstreams: t.tasks,
          sourceKind: "swarm",
        });
      }
    }

    // HYBRID ABSORPTION (Board #129): check if the thread ALSO has delegated ACP/MCP subagents!
    const reservedHandles = new Set(nativeMembers.map((m) => m.name.toLowerCase()));
    const { children: delegatedChildren } = collectDelegatedChildren({
      parentProvider: provider ?? "antigravity",
      parentBrand: "antigravity",
      threadId: input.threadId,
      projection: input.projection,
      relationshipShells: input.relationshipShells,
      nativeChildWork: input.nativeChildWork,
      providerEntryByInstanceId,
      daemonSnapshot: null,
      locale,
      reservedHandles,
      asAbsorbedAcp: true,
    });

    const merged = mergeSwarmAndDelegatedAgents({
      swarmMembers: nativeMembers,
      swarmMessages: nativeMessages,
      swarmWorkstreams: nativeWorkstreams,
      swarmThreadGroups: nativeThreadGroups,
      swarmHeadSeq: sw.head,
      delegatedChildren,
      locale,
      parentBrand: "antigravity",
    });

    const team = merged.members.filter((m) => !m.isSystem);
    const liveTeamCount = team.filter((m) => !m.killed).length;
    const activeCount = team.filter((m) => !m.killed && m.status === "working").length;
    const waitingCount = team.filter(
      (m) =>
        !m.killed &&
        (m.status === "parked" || m.status === "waiting_on" || m.status === "needs_you"),
    ).length;
    const retiredCount = team.filter((m) => m.killed).length;
    const visibleMsgCount = merged.messages.filter((m) => !m.isControl).length;

    // Stall banner detection (1:1 hive.js:1061-1078)
    const coordHandledStall = Boolean(
      coordRaw &&
      !coordRaw.killed &&
      coordRaw.status === "waiting" &&
      coordRaw.replied &&
      lastMonitorStallPost &&
      coordRaw.lastReadSeq >= lastMonitorStallPost.seq,
    );
    const hasLiveWorkers = team.some((m) => !m.isCoordinator && !m.killed);
    const stall: AgentAuxStallAlert | null =
      !nativeClosed &&
      activeCount === 0 &&
      !attention.some((a) => a.wait === "you") &&
      !coordHandledStall &&
      hasLiveWorkers &&
      lastMonitorStallPost &&
      (!lastTeamPost || lastMonitorStallPost.seq >= lastTeamPost.seq)
        ? {
            seq: lastMonitorStallPost.seq,
            agent: lastMonitorStallPost.agent,
            text: lastMonitorStallPost.text
              .replace(/[*`_]*\[stall\][*`_]*[\s:,–—-]*/gi, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 220),
          }
        : null;

    const goalSource = sw.view?.goal ?? sw.plan?.goal ?? null;
    const goal: AgentAuxGoal | null = goalSource?.title
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

    const starting =
      !nativeClosed &&
      !sw.view &&
      attention.length === 0 &&
      !stall &&
      merged.workstreams.length === 0 &&
      lastPostByMember.size <= 1;

    const channels = [
      ...new Set([
        ...(sw.channels ?? []),
        ...merged.messages
          .map((m) => m.channel)
          .filter((c): c is string => typeof c === "string" && c.length > 0 && c !== "main"),
      ]),
    ];

    const hasLiveAbsorbedAcp = merged.members.some(
      (m) =>
        m.sourceKind === "acp-delegated" &&
        !m.killed &&
        (m.status === "working" || m.status === "waiting_on" || m.status === "needs_you"),
    );
    const finished = nativeClosed && activeCount === 0 && !hasLiveAbsorbedAcp && !hasSysAttention;
    const openAttentionCount = finished ? 0 : attention.filter((a) => a.wait !== null).length;

    // ALWAYS render all 4 core tabs matching AGY Figs 3–6
    const tabs: AgentAuxTabDescriptor[] = [
      {
        id: "overview",
        label: s.tabOverview,
        ...(openAttentionCount > 0 ? { badge: openAttentionCount } : {}),
      },
      { id: "board", label: s.tabBoard, count: visibleMsgCount },
      { id: "members", label: s.tabMembers, count: liveTeamCount },
      { id: "graph", label: s.tabGraph },
    ];

    const statusParts: string[] = [];
    if (activeCount > 0) statusParts.push(`${activeCount} ${s.stateWorking}`);
    if (waitingCount > 0) statusParts.push(`${waitingCount} ${s.stateParked}`);
    if (retiredCount > 0) statusParts.push(`${retiredCount} ${s.stateKilled}`);
    statusParts.push(locale === "zh" ? `${visibleMsgCount} 条消息` : `${visibleMsgCount} posts`);

    const hasLiveActivity =
      !finished &&
      (snap.hasLiveWork || activeCount > 0 || openAttentionCount > 0 || Boolean(stall));

    return {
      active: true,
      hasLiveActivity,
      kind: "agy-swarm",
      locale,
      useBees: true,
      hasAbsorbedAcpAgents: merged.hasAbsorbedAcpAgents,
      provider: provider ?? "antigravity",
      providerBrand: "antigravity",
      title: sw.title || s.panelFallbackSwarm,
      badgeLabel: s.panelFallbackSwarm,
      entryLabel: s.entrySwarm,
      activationKey: snap.activationKey ?? `agy-swarm:${sw.id}`,
      selfMember: sw.selfMember,
      headSeq: merged.headSeq,
      unreadSeqBoundary,
      channels,
      tabs,
      defaultTab: "overview",
      statusLine: statusParts.join(" · "),
      activeCount,
      waitingCount,
      retiredCount,
      messageCount: visibleMsgCount,
      goal,
      headline: sw.view?.headline ?? "",
      phase,
      stall,
      starting,
      workstreams: merged.workstreams,
      threadGroups: merged.threadGroups,
      attention,
      members: merged.members,
      messages: merged.messages,
      edges: merged.edges.length > 0 ? merged.edges : sw.edges,
      tasks: [],
      finished,
      updatedAt,
    };
  }

  // =========================================================================
  // 2. Claude Native Agent Team — Unified 4 Tabs (+ optional Tasks)
  // =========================================================================
  if (snap?.active && snap.kind === "claude-team" && snap.claudeTeam) {
    const team = snap.claudeTeam;
    const members: AgentAuxMember[] = team.members.map((m) => {
      const status: AgentAuxMemberVisualStatus =
        m.status === "working" ? "working" : m.status === "done" ? "done" : "parked";
      const memberMsgs = team.messages.filter((msg) => msg.agent === m.name);
      const lastMsg = memberMsgs.at(-1);
      return {
        id: m.agentId,
        name: m.name,
        displayName: m.name,
        role: m.agentType,
        roleLabel: formatAuxRoleLabel(m.agentType, m.isLead, locale),
        title: m.agentType,
        brief: m.agentType,
        model: formatAuxModelDisplayLabel(m.model),
        providerBrand: "claude-code",
        sourceKind: "claude-team",
        status,
        statusLabel: formatAuxStatusLabel(status, null, locale),
        waitingOn: null,
        wakeMode: "",
        steps: 0,
        posts: memberMsgs.length,
        unread: team.messages.filter((msg) => msg.recipient === m.name && !msg.read).length,
        activity: m.status === "working" ? s.stateWorking : "",
        activityKind: m.status === "working" ? "tool" : "",
        nowLine: lastMsg?.summary || lastMsg?.text.slice(0, 360) || m.backendType || s.roleWorker,
        lastPostSnippet: lastMsg?.text.slice(0, 360) || "",
        lastSeq: lastMsg?.seq ?? 0,
        lastTime: lastMsg?.time ?? "",
        killed: false,
        isCoordinator: m.isLead,
        isSystem: false,
        isYou: m.isLead,
        childThreadId: null,
        conversationId: null,
        color: m.color || computeBeeColor(m.name),
        backendType: m.backendType || null,
        workspace: m.cwd || null,
        workspaceMode: m.cwd ? "worktree" : null,
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
      sourceKind: "claude-team",
      providerBrand: "claude-code",
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

    const workstreams: AgentAuxWorkstream[] = tasks.map((t, idx) => {
      const rawState: AgentAuxWorkstreamRawState =
        t.status === "completed"
          ? "done"
          : t.status === "in_progress"
            ? "active"
            : t.status === "blocked"
              ? "blocked"
              : "queued";
      return {
        id: t.id,
        title: t.subject,
        state:
          rawState === "done"
            ? "done"
            : rawState === "active"
              ? "running"
              : rawState === "blocked"
                ? "blocked"
                : "queued",
        rawState,
        owners: t.owner ? [t.owner] : [],
        note: t.description,
        progress: null,
        blockedOn: t.blockedBy[0] ? `#${t.blockedBy[0]}` : null,
        waitingOn: null,
        seq: idx + 1,
      };
    });

    const threadGroups: AgentAuxThreadGroup[] =
      workstreams.length > 0
        ? [
            {
              id: "t-claude-team",
              title: team.teamName || s.overviewDelegatedThread,
              goal: team.description,
              now: "",
              workstreams: workstreams.map((w) => w.id),
            },
          ]
        : [];

    const activeCount = members.filter((m) => m.status === "working").length;
    const waitingCount = members.filter((m) => m.status === "parked").length;
    const nonLeadMembers = members.filter((m) => !m.isCoordinator);
    const hasInProgressTasks = tasks.some((t) => t.status === "in_progress");
    const finished =
      activeCount === 0 &&
      !hasInProgressTasks &&
      (tasks.length > 0
        ? tasks.every((t) => t.status === "completed")
        : nonLeadMembers.length > 0 && nonLeadMembers.every((m) => m.status === "done"));
    const hasLiveActivity =
      !finished && (snap.hasLiveWork || activeCount > 0 || hasInProgressTasks);
    const tabs: AgentAuxTabDescriptor[] = [
      { id: "overview", label: s.tabOverview },
      { id: "board", label: s.tabBoard, count: messages.length },
      { id: "members", label: s.tabMembers, count: members.length },
      { id: "graph", label: s.tabGraph },
      ...(tasks.length > 0
        ? [{ id: "tasks" as const, label: s.tabTasks, count: tasks.length }]
        : []),
    ];

    const claudeTeamPrefix = hasCustomBrandName
      ? brandDisplayName
      : CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent;

    return {
      active: true,
      hasLiveActivity,
      kind: "claude-team",
      locale,
      useBees: false,
      hasAbsorbedAcpAgents: false,
      provider: provider ?? "claudeAgent",
      providerBrand: "claude-code",
      title:
        team.teamName ||
        (locale === "zh" ? `${claudeTeamPrefix} 智能体团队` : `${claudeTeamPrefix} Agent Team`),
      badgeLabel:
        locale === "zh" ? `${claudeTeamPrefix} 智能体团队` : `${claudeTeamPrefix} Agent Team`,
      entryLabel: s.entryClaudeTeam,
      activationKey: snap.activationKey ?? `claude-team:${team.teamName}`,
      selfMember: "team-lead",
      headSeq: messages.length,
      unreadSeqBoundary: null,
      channels: [],
      tabs,
      defaultTab: "overview",
      statusLine:
        locale === "zh"
          ? `${activeCount} ${s.stateWorking} · ${waitingCount} ${s.stateParked} · ${tasks.length} 项任务`
          : `${activeCount} working · ${waitingCount} standing by · ${tasks.length} tasks`,
      activeCount,
      waitingCount,
      retiredCount: 0,
      messageCount: messages.length,
      goal: { title: team.teamName, line: team.description },
      headline: team.description,
      phase: null,
      stall: null,
      starting: false,
      workstreams,
      threadGroups,
      attention: [],
      members,
      messages,
      edges: team.edges,
      tasks,
      finished,
      updatedAt,
    };
  }

  // =========================================================================
  // 3. ALL Other Multi-Agent Modes (ACP / Prismux MCP `delegate_task` /
  //    Codex -> DSH / Claude -> Codex / Composer 邀请协作 / AGY Subagents)
  //    -> 100% UNIFIED 4-TAB MODEL (Overview / Board / Members / Graph)!
  // =========================================================================
  const { children, workflowPhases } = collectDelegatedChildren({
    parentProvider: provider,
    parentBrand: brand,
    threadId: input.threadId,
    projection: input.projection,
    relationshipShells: input.relationshipShells,
    nativeChildWork: input.nativeChildWork,
    providerEntryByInstanceId,
    daemonSnapshot: snap,
    locale,
  });

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
  const hasAnySubagentOrCollab = children.length > 0 || hasCodexGoals;

  if (!hasAnySubagentOrCollab) {
    return {
      active: false,
      hasLiveActivity: false,
      kind: null,
      locale,
      useBees: false,
      hasAbsorbedAcpAgents: false,
      provider,
      providerBrand: brand,
      title: "",
      badgeLabel: "",
      entryLabel: "",
      activationKey: null,
      selfMember: null,
      headSeq: 0,
      unreadSeqBoundary: null,
      channels: [],
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
      stall: null,
      starting: false,
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
    const labelPrefix = hasCustomBrandName
      ? brandDisplayName
      : CANONICAL_PROVIDER_DISPLAY_NAMES.antigravity;
    kind = "agy-subagents";
    badgeLabel = locale === "zh" ? `${labelPrefix} 子智能体` : `${labelPrefix} Subagents`;
    entryLabel = s.entryAgySubagents;
    title = badgeLabel;
  } else if (brand === "claude-code") {
    const labelPrefix = hasCustomBrandName
      ? brandDisplayName
      : CANONICAL_PROVIDER_DISPLAY_NAMES.claudeAgent;
    kind = "claude-subagents";
    badgeLabel = locale === "zh" ? `${labelPrefix} 协同` : `${labelPrefix} Collaboration`;
    entryLabel = s.entryCollab;
    title = badgeLabel;
  } else if (brand === "codex" || snap?.kind === "codex-collab") {
    const labelPrefix = hasCustomBrandName
      ? brandDisplayName
      : CANONICAL_PROVIDER_DISPLAY_NAMES.codex;
    kind = "codex-collab";
    badgeLabel = locale === "zh" ? `${labelPrefix} 协同` : `${labelPrefix} Collaboration`;
    entryLabel = s.entryCollab;
    title = badgeLabel;
  } else {
    kind = "provider-subagents";
    badgeLabel =
      locale === "zh" ? `${brandDisplayName} 多智能体协同` : `${brandDisplayName} Collaboration`;
    entryLabel = s.entryCollab;
    title = badgeLabel;
  }

  // Synthesize chronological Board messages from all delegated children
  const earliestTs = children.reduce<number>(
    (min, c) => (c.startedAt !== null && c.startedAt < min ? c.startedAt : min),
    Number.POSITIVE_INFINITY,
  );
  const baseTs = Number.isFinite(earliestTs) ? earliestTs : updatedAt - children.length * 10_000;
  const syntheticMessages = synthesizeDelegatedMessages(children, 1, baseTs, locale, brand);

  // Backfill posts/lastSeq/lastTime onto child members from synthetic messages
  const childMsgStats = new Map<
    string,
    { posts: number; lastSeq: number; lastTime: string; snippet: string }
  >();
  for (const msg of syntheticMessages) {
    const prev = childMsgStats.get(msg.agent) ?? {
      posts: 0,
      lastSeq: 0,
      lastTime: "",
      snippet: "",
    };
    childMsgStats.set(msg.agent, {
      posts: prev.posts + 1,
      lastSeq: msg.seq,
      lastTime: msg.time,
      snippet: msg.text.slice(0, 360),
    });
  }

  const enrichedChildren: AgentAuxMember[] = children.map((c) => {
    const stats = childMsgStats.get(c.member.name);
    return {
      ...c.member,
      posts: stats?.posts ?? 0,
      lastSeq: stats?.lastSeq ?? 0,
      lastTime: stats?.lastTime ?? "",
      lastPostSnippet: stats?.snippet || c.member.lastPostSnippet,
    };
  });

  // Synthesize Coordinator (parent thread)
  const parentRunning = isParentProjectionRunning(input.projection, input.threadShell);
  const anyChildActive = enrichedChildren.some(
    (m) => m.status === "working" || m.status === "waiting_on" || m.status === "needs_you",
  );
  const allChildrenSettled =
    enrichedChildren.length > 0 &&
    enrichedChildren.every((m) => m.status === "done" || m.killed || m.status === "error");
  const coordStatus: AgentAuxMemberVisualStatus = parentRunning
    ? "working"
    : allChildrenSettled
      ? "done"
      : anyChildActive
        ? "working"
        : "parked";
  const parentModel = formatAuxModelDisplayLabel(parentModelRaw) || brandDisplayName;
  const coordStats = childMsgStats.get("coordinator");
  const coordDisplayName =
    locale === "zh" ? `主线程 · ${brandDisplayName}` : `Main · ${brandDisplayName}`;

  const coordinatorMember: AgentAuxMember = {
    id: input.threadId ?? "coordinator",
    name: "coordinator",
    displayName: coordDisplayName,
    role: "coordinator",
    roleLabel: s.roleCoordinator,
    title: s.roleCoordinator,
    brief: formatAuxCoordinatorSummary(enrichedChildren.length, locale),
    model: parentModel,
    providerBrand: brand,
    sourceKind: "acp-delegated",
    status: coordStatus,
    statusLabel: formatAuxStatusLabel(coordStatus, null, locale),
    waitingOn: null,
    wakeMode: "",
    steps: 0,
    posts: coordStats?.posts ?? 0,
    unread: 0,
    activity:
      coordStatus === "working" ? formatAuxCoordinatorSummary(enrichedChildren.length, locale) : "",
    activityKind: coordStatus === "working" ? "tool" : "",
    nowLine: formatAuxCoordinatorSummary(enrichedChildren.length, locale),
    lastPostSnippet:
      coordStats?.snippet ?? formatAuxCoordinatorSummary(enrichedChildren.length, locale),
    lastSeq: coordStats?.lastSeq ?? 0,
    lastTime: coordStats?.lastTime ?? "",
    killed: false,
    isCoordinator: true,
    isSystem: false,
    isYou: true,
    childThreadId: null,
    conversationId: null,
    color: computeBeeColor("coordinator"),
    backendType: null,
    workspace: input.threadShell?.worktreePath ?? null,
    workspaceMode: input.threadShell?.worktreePath ? "worktree" : null,
    failureText: null,
  };

  const allMembers: AgentAuxMember[] = [coordinatorMember, ...enrichedChildren];
  const memberNameSet = new Set(allMembers.map((m) => m.name));
  const edges = buildMentionEdges(syntheticMessages, memberNameSet);

  // Build Workstreams from children
  const workstreams: AgentAuxWorkstream[] = enrichedChildren.map((m, idx) => {
    const rawState: AgentAuxWorkstreamRawState =
      m.status === "working"
        ? "active"
        : m.status === "error" || m.status === "needs_you" || m.status === "waiting_on"
          ? "blocked"
          : m.status === "done" || m.killed
            ? "done"
            : "queued";
    return {
      id: m.id,
      title: m.displayName,
      state:
        rawState === "active"
          ? "running"
          : rawState === "blocked"
            ? "blocked"
            : rawState === "done"
              ? "done"
              : "queued",
      rawState,
      owners: [m.name],
      note: m.nowLine,
      progress: null,
      blockedOn: null,
      waitingOn: m.waitingOn,
      seq: m.lastSeq || idx + 1,
      sourceKind: "acp-delegated",
    };
  });

  // Synthesize Workgroups (`threadGroups`):
  // Priority 1: workflow.phases -> Priority 2: multi-driver / multi-run -> Priority 3: primary Delegated Tasks
  const threadGroups: AgentAuxThreadGroup[] = [];
  if (workflowPhases.length > 0) {
    for (const ph of [...workflowPhases].sort((a, b) => a.index - b.index)) {
      const wsIds = children.filter((c) => c.phaseIndex === ph.index).map((c) => c.member.id);
      if (wsIds.length > 0) {
        threadGroups.push({
          id: `t-phase-${ph.index}`,
          title: ph.title,
          goal: "",
          now: "",
          workstreams: wsIds,
          sourceKind: "acp-delegated",
        });
      }
    }
  } else {
    const distinctDrivers = [...new Set(children.map((c) => c.driverLabel))];
    const distinctRuns = [
      ...new Set(children.map((c) => c.runId).filter((r): r is string => Boolean(r))),
    ];
    if (distinctDrivers.length >= 2) {
      for (const drv of distinctDrivers) {
        const wsIds = children.filter((c) => c.driverLabel === drv).map((c) => c.member.id);
        threadGroups.push({
          id: `t-driver-${drv.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          title: `${s.overviewDelegatedThread} · ${drv}`,
          goal: "",
          now: "",
          workstreams: wsIds,
          sourceKind: "acp-delegated",
        });
      }
    } else if (distinctRuns.length >= 2) {
      distinctRuns.forEach((runId, idx) => {
        const wsIds = children.filter((c) => c.runId === runId).map((c) => c.member.id);
        threadGroups.push({
          id: `t-wave-${idx + 1}`,
          title: formatAuxDelegationWave(idx + 1, locale),
          goal: "",
          now: "",
          workstreams: wsIds,
          sourceKind: "acp-delegated",
        });
      });
    } else if (workstreams.length > 0) {
      threadGroups.push({
        id: "t-delegated",
        title: s.overviewDelegatedThread,
        goal: input.threadShell?.title?.trim() || "",
        now: enrichedChildren.find((m) => m.status === "working")?.activity ?? "",
        workstreams: workstreams.map((w) => w.id),
        sourceKind: "acp-delegated",
      });
    }
  }

  const activeCount = enrichedChildren.filter(
    (m) => m.status === "working" || m.status === "needs_you",
  ).length;
  const waitingCount = enrichedChildren.filter(
    (m) => m.status === "parked" || m.status === "waiting_on",
  ).length;
  const retiredCount = enrichedChildren.filter((m) => m.killed).length;
  const liveMemberCount = allMembers.filter((m) => !m.killed).length;

  const hasActiveTask = allTasks.some((t) => t.status === "in_progress");
  const hasLiveActivity =
    activeCount > 0 ||
    anyChildActive ||
    parentRunning ||
    hasActiveTask ||
    Boolean(snap?.hasLiveWork);
  const finished =
    !hasLiveActivity &&
    (enrichedChildren.length > 0
      ? allChildrenSettled
      : allTasks.length > 0 && allTasks.every((t) => t.status === "completed"));

  // ALWAYS render ALL 4 unified tabs (`概览`, `看板 N`, `成员 N`, `关系图`) + optional `任务 N`!
  const tabs: AgentAuxTabDescriptor[] = [
    { id: "overview", label: s.tabOverview },
    { id: "board", label: s.tabBoard, count: syntheticMessages.length },
    { id: "members", label: s.tabMembers, count: liveMemberCount },
    { id: "graph", label: s.tabGraph },
    ...(allTasks.length > 0
      ? [{ id: "tasks" as const, label: s.tabTasks, count: allTasks.length }]
      : []),
  ];

  const statusParts: string[] = [];
  if (activeCount > 0) statusParts.push(`${activeCount} ${s.stateWorking}`);
  if (waitingCount > 0) statusParts.push(`${waitingCount} ${s.stateParked}`);
  const doneCount = enrichedChildren.filter((m) => m.status === "done").length;
  if (doneCount > 0) statusParts.push(`${doneCount} ${s.stateDone}`);
  if (allTasks.length > 0) {
    statusParts.push(locale === "zh" ? `${allTasks.length} 项任务` : `${allTasks.length} tasks`);
  }

  const firstId = enrichedChildren[0]?.id ?? allTasks[0]?.id ?? "session";
  const activationKey = snap?.activationKey ?? `${kind}:${input.threadId ?? "thread"}:${firstId}`;

  const goalTitle =
    snap?.codex?.goals[0]?.objective ||
    input.threadShell?.title?.trim() ||
    enrichedChildren[0]?.brief ||
    title;
  const goalLine = snap?.codex?.goals[0]
    ? `${locale === "zh" ? "状态：" : "Status: "}${snap.codex.goals[0].status}`
    : formatAuxCoordinatorSummary(enrichedChildren.length, locale);

  return {
    active: true,
    hasLiveActivity,
    kind,
    locale,
    useBees: false,
    hasAbsorbedAcpAgents: false,
    provider,
    providerBrand: brand,
    title,
    badgeLabel,
    entryLabel,
    activationKey,
    selfMember: "coordinator",
    headSeq: syntheticMessages.length,
    unreadSeqBoundary: null,
    channels: [],
    tabs,
    defaultTab: "overview",
    statusLine:
      statusParts.join(" · ") || formatAuxCoordinatorSummary(enrichedChildren.length, locale),
    activeCount,
    waitingCount,
    retiredCount,
    messageCount: syntheticMessages.length,
    goal: goalTitle ? { title: goalTitle, line: goalLine } : null,
    headline: "",
    phase: null,
    stall: null,
    starting: false,
    workstreams,
    threadGroups,
    attention: [],
    members: allMembers,
    messages: syntheticMessages,
    edges,
    tasks: allTasks,
    finished,
    updatedAt,
  };
}
