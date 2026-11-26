import {
  open as openFileAsync,
  readdir as readdirAsync,
  readFile as readFileAsync,
  realpath as realpathAsync,
  stat as statAsync
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, normalize, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SAFE_SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AGY_CONV_ID_RE = /^[0-9a-f-]{8,}$/i;
const SAFE_DIR_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ROLE_WORKER_RE = /^(?:narrator|monitor)(?:-\d+)?$/;
const NARRATOR_RE = /^narrator(?:-(\d+))?$/;
const QUOTA_RE =
  /RESOURCE_EXHAUSTED|quota|\b429\b|exhausted your capacity|rate.?limit/i;
const NAME_RUNE_RE = /[\p{L}\p{Nd}_-]/u;

const MAX_BOARD_MESSAGES = 400;
const MAX_BOARD_TAIL_BYTES = 1024 * 1024;
const MAX_VIEW_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const MAX_INBOX_BYTES = 512 * 1024;
const MAX_TASK_BYTES = 64 * 1024;
const MAX_DETACHED_SUBAGENTS = 64;
const MAX_SUBAGENT_STEPS = 25;
export const ROSTER_SCAN_TTL_MS = 10_000;
const MAX_AUX_CACHE_ENTRIES = 128;
const STUCK_MS = 10 * 60 * 1000;
const STEP_ERROR_SETTLE_MS = 60 * 1000;

export type AgentAuxKind =
  | "agy-swarm"
  | "agy-subagents"
  | "claude-team"
  | "codex-collab"
  | "provider-subagents";

export interface AgentAuxInspectQuery {
  provider?: string;
  sessionId?: string;
  cwd?: string;
}

export interface AgentAuxSwarmFailure {
  kind: "quota" | "error";
  text: string;
}

export interface AgentAuxSwarmMember {
  name: string;
  conversationId: string;
  model: string;
  role: string;
  wakeMode: string;
  status: "working" | "waiting" | "killed";
  waitSince: number;
  lastReadSeq: number;
  unread: number;
  killed: boolean;
  steps: number;
  activity: string;
  activityKind: "tool" | "thinking" | "";
  replied: boolean;
  replyAsk: string;
  narrator: boolean;
  roleWorker: boolean;
  failure: AgentAuxSwarmFailure | null;
  transcriptMtime: number;
  posts: number;
  lastPostSeq: number;
  lastPostTime: string;
  lastPostTs: number | null;
  workspace?: string;
  workspaceMode?: string;
  channels?: string[];
}

export interface AgentAuxSwarmMessage {
  seq: number;
  agent: string;
  text: string;
  time: string;
  ts: number | null;
  mentions: string[];
  all: boolean;
  channel?: string;
  control?: Record<string, unknown>;
}

export interface AgentAuxEdge {
  from: string;
  to: string;
  count: number;
  direct: number;
  viaAll: number;
}

export interface AgentAuxSystemAttentionItem {
  id: string;
  kind: "quota" | "error" | "stuck";
  member: string;
  conversationId: string;
  text: string;
  detail: string;
  since?: number;
}

export interface AgentAuxSwarmPlan {
  goal?: { title?: string; line?: string } | null;
  tasks?: Record<string, string>;
  threads?: Array<{
    id?: string;
    title: string;
    goal?: string;
    tasks: string[];
  }>;
}

export interface AgentAuxSwarmView {
  as_of_seq?: number;
  updated_at?: string;
  headline?: string;
  running_summary?: string;
  phase?: { label?: string; index?: number; total?: number };
  goal?: { title?: string; line?: string };
  now?: Record<string, string>;
  attention?: Array<{
    id?: string;
    kind?: string;
    severity?: string;
    title?: string;
    why?: string;
    refs?: Array<{ seq?: number; member?: string }>;
    actions?: Array<{ type?: string; target?: string | number; label?: string }>;
  }>;
  workstreams?: Array<{
    id?: string;
    title?: string;
    owners?: string[];
    state?: string;
    note?: string;
    progress?: { done?: number; total?: number; label?: string } | number;
    blocked_on?: string;
    refs?: Array<{ seq?: number; member?: string }>;
  }>;
  threads?: Array<{
    id?: string;
    title?: string;
    goal?: string;
    now?: string;
    state?: string;
    workstreams?: string[];
    attention?: string[];
  }>;
  milestones?: Array<{ id?: string; text?: string }>;
  risks?: Array<{ id?: string; text?: string }>;
}

export interface AgentAuxSwarmSnapshot {
  id: string;
  title: string;
  selfMember: string | null;
  head: number;
  members: AgentAuxSwarmMember[];
  messages: AgentAuxSwarmMessage[];
  edges: AgentAuxEdge[];
  plan: AgentAuxSwarmPlan | null;
  view: AgentAuxSwarmView | null;
  systemAttention: AgentAuxSystemAttentionItem[];
}

export interface AgentAuxNativeStep {
  index: number;
  type: string;
  status: string | null;
  text: string | null;
  toolCalls: Array<{ name: string; summary: string }>;
}

export interface AgentAuxNativeSubagent {
  conversationId: string;
  role: string;
  state: string;
  status: "working" | "waiting" | "done" | "killed";
  stepsCount: number;
  activity: string;
  activityKind: "tool" | "thinking" | "";
  steps: AgentAuxNativeStep[];
  transcriptMtime: number;
}

export interface AgentAuxClaudeTeamMember {
  agentId: string;
  name: string;
  agentType: string;
  model: string;
  color: string;
  cwd: string;
  backendType: string;
  status: "working" | "waiting" | "done";
  isLead: boolean;
  joinedAt?: number;
}

export interface AgentAuxClaudeTeamMessage {
  seq: number;
  agent: string;
  recipient: string;
  text: string;
  summary: string;
  time: string;
  ts: number | null;
  mentions: string[];
  all: boolean;
  read: boolean;
  color?: string;
}

export interface AgentAuxClaudeTeamSnapshot {
  teamName: string;
  description: string;
  leadSessionId: string;
  members: AgentAuxClaudeTeamMember[];
  messages: AgentAuxClaudeTeamMessage[];
  edges: AgentAuxEdge[];
}

export interface AgentAuxCodexGoal {
  threadId: string;
  goalId: string;
  objective: string;
  status:
    | "active"
    | "paused"
    | "blocked"
    | "usage_limited"
    | "budget_limited"
    | "complete";
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AgentAuxCodexSpawnedThread {
  threadId: string;
  parentThreadId: string;
  status: string;
  title: string;
  nickname: string;
  role: string;
  model: string;
  reasoningEffort: string;
  cwd: string;
  updatedAtMs: number;
}

export interface AgentAuxCodexSnapshot {
  goals: AgentAuxCodexGoal[];
  spawnedThreads: AgentAuxCodexSpawnedThread[];
}

export interface AgentAuxTaskItem {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  owner: string;
  blockedBy: string[];
  blocks: string[];
  source: "claude-tasks" | "codex-goals";
  progressLabel?: string;
}

export interface AgentAuxInspectResponse {
  ok: true;
  active: boolean;
  hasLiveWork: boolean;
  kind: AgentAuxKind | null;
  title: string;
  activationKey: string | null;
  swarm?: AgentAuxSwarmSnapshot;
  agySubagents?: AgentAuxNativeSubagent[];
  claudeTeam?: AgentAuxClaudeTeamSnapshot;
  codex?: AgentAuxCodexSnapshot;
  tasks?: AgentAuxTaskItem[];
  updatedAt: number;
}

export class AgentAuxValidationError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AgentAuxValidationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface AgentAuxServiceOptions {
  /** Override Antigravity appData roots (primarily for deterministic tests). */
  agyAppDataDirs?: string[];
  /** Override ~/.claude root (primarily for deterministic tests). */
  claudeHomeDir?: string;
  /** Override ~/.codex root (primarily for deterministic tests). */
  codexHomeDir?: string;
  /** Clock provider for deterministic testing. */
  now?: () => number;
  /** Injectable read-only SQLite opener for deterministic cache hit verification tests. */
  openCodexDb?: (dbPath: string) => DatabaseSync;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V): void {
  if (cache.size >= MAX_AUX_CACHE_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, value);
}

async function safeReaddirAsync(dirPath: string): Promise<string[]> {
  try {
    return await readdirAsync(dirPath);
  } catch {
    return [];
  }
}

interface StatInfo {
  mtime: number;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
}

async function safeStatAsync(filePath: string): Promise<StatInfo | null> {
  try {
    const st = await statAsync(filePath);
    return {
      mtime: st.mtimeMs,
      size: st.size,
      isFile: st.isFile(),
      isDirectory: st.isDirectory()
    };
  } catch {
    return null;
  }
}

async function isContainedInRootAsync(
  targetPath: string,
  rootDir: string
): Promise<boolean> {
  try {
    const [rootReal, targetReal] = await Promise.all([
      realpathAsync(rootDir),
      realpathAsync(targetPath)
    ]);
    const prefix = rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
    if (process.platform === "win32") {
      const lowerTarget = targetReal.toLowerCase();
      const lowerRoot = rootReal.toLowerCase();
      const lowerPrefix = prefix.toLowerCase();
      return lowerTarget === lowerRoot || lowerTarget.startsWith(lowerPrefix);
    }
    return targetReal === rootReal || targetReal.startsWith(prefix);
  } catch {
    return false;
  }
}

async function readSmallTextFileAsync(
  filePath: string,
  rootDir: string,
  maxBytes: number
): Promise<string | null> {
  const st = await safeStatAsync(filePath);
  if (!st || !st.isFile || st.size < 0 || st.size > maxBytes) return null;
  if (!(await isContainedInRootAsync(filePath, rootDir))) return null;
  try {
    return await readFileAsync(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readTailTextFileAsync(
  filePath: string,
  rootDir: string,
  maxBytes: number,
  precomputedStat?: StatInfo | null
): Promise<{ text: string; mtime: number; size: number; truncated: boolean } | null> {
  const st = precomputedStat !== undefined ? precomputedStat : await safeStatAsync(filePath);
  if (!st || !st.isFile || st.size < 0) return null;
  if (!(await isContainedInRootAsync(filePath, rootDir))) return null;
  if (st.size === 0) {
    return { text: "", mtime: st.mtime, size: 0, truncated: false };
  }
  if (st.size <= maxBytes) {
    try {
      return {
        text: await readFileAsync(filePath, "utf8"),
        mtime: st.mtime,
        size: st.size,
        truncated: false
      };
    } catch {
      return null;
    }
  }
  let handle: Awaited<ReturnType<typeof openFileAsync>> | null = null;
  try {
    handle = await openFileAsync(filePath, "r");
    const tailStart = Math.max(0, st.size - maxBytes);
    const readLength = st.size - tailStart;
    const buf = Buffer.allocUnsafe(readLength);
    const { bytesRead } = await handle.read(buf, 0, readLength, tailStart);
    const slice = buf.subarray(0, bytesRead);
    const firstNewline = slice.indexOf(0x0a);
    const text =
      firstNewline >= 0
        ? slice.toString("utf8", firstNewline + 1)
        : slice.toString("utf8");
    return { text, mtime: st.mtime, size: st.size, truncated: true };
  } catch {
    return null;
  } finally {
    if (handle !== null) {
      try {
        await handle.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

async function computeSqliteFileFingerprint(dbPath: string): Promise<string | null> {
  const mainStat = await safeStatAsync(dbPath);
  if (!mainStat || !mainStat.isFile) {
    return null;
  }
  const walStat = await safeStatAsync(`${dbPath}-wal`);
  return `${mainStat.mtime}:${mainStat.size}|${walStat?.mtime ?? 0}:${walStat?.size ?? 0}`;
}

function normalizePathForCompare(raw: string): string {
  const cleaned = normalize(resolve(raw.trim())).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
}

function pathsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  try {
    const na = normalizePathForCompare(a);
    const nb = normalizePathForCompare(b);
    return na.length > 0 && na === nb;
  } catch {
    return false;
  }
}

function normalizeProvider(raw: string | undefined): string {
  const lower = (raw ?? "").trim().toLowerCase();
  if (!lower) return "";
  if (lower.startsWith("antigravity") || lower === "agy" || lower.startsWith("agy-")) {
    return "antigravity";
  }
  if (lower.startsWith("claude")) {
    return "claude";
  }
  if (lower.startsWith("codex") || lower.includes("openai-codex")) {
    return "codex";
  }
  return lower;
}

function validateSessionId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (
    trimmed.includes("..") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed.includes("%") ||
    !SAFE_SESSION_ID_RE.test(trimmed)
  ) {
    throw new AgentAuxValidationError(
      "INVALID_SESSION_ID",
      "Invalid sessionId parameter."
    );
  }
  return trimmed;
}

function validateCwd(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.includes("\0") || trimmed.length > 4096) {
    throw new AgentAuxValidationError("INVALID_CWD", "Invalid cwd parameter.");
  }
  return trimmed;
}

function namedToken(lowerText: string, lowerName: string): boolean {
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

function named(lowerText: string, lowerName: string): boolean {
  if (namedToken(lowerText, lowerName)) return true;
  const m = /^(.+)-\d+$/.exec(lowerName);
  return m?.[1] ? namedToken(lowerText, m[1]) : false;
}

export function extractBoardMentions(
  text: string,
  names: readonly string[]
): { mentions: string[]; all: boolean } {
  const lower = String(text || "").toLowerCase();
  return {
    mentions: names.filter((n) => named(lower, String(n).toLowerCase())),
    all: named(lower, "all")
  };
}

function roleOfMember(name: string, rawMember: Record<string, unknown>): string {
  const r = typeof rawMember.role === "string" ? rawMember.role : "";
  if (r && r !== "worker") return r;
  const match = /^(narrator|monitor)(?:-\d+)?$/.exec(name);
  return match?.[1] ?? (r || "worker");
}

function isRoleWorker(name: string, rawMember: Record<string, unknown>): boolean {
  const r = roleOfMember(name, rawMember);
  return Boolean(
    (r && r !== "worker" && r !== "coordinator") || ROLE_WORKER_RE.test(name)
  );
}

function narratorRank(name: string, rawMember: Record<string, unknown>): number {
  if (roleOfMember(name, rawMember) !== "narrator") return -1;
  const match = NARRATOR_RE.exec(name) ?? /-(\d+)$/.exec(name);
  return match?.[1] ? Number(match[1]) : 1;
}

function unquoteArg(v: unknown): string {
  if (typeof v !== "string") return v == null ? "" : String(v);
  const s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return String(JSON.parse(s));
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function oneLine(s: unknown, maxLen = 96): string {
  const out = String(s ?? "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > maxLen ? `${out.slice(0, maxLen - 1).trimEnd()}…` : out;
}

const BOARD_TOOL_ACTIVITY: Readonly<Record<string, string>> = {
  swarm_wait: "等待消息板新动态",
  read_board: "读取消息板",
  post_message: "发送消息到消息板"
};

function describeToolCall(tc: Record<string, unknown>): string {
  const name = typeof tc.name === "string" ? tc.name : "";
  if (!name) return "";
  const boardLabel = BOARD_TOOL_ACTIVITY[name];
  if (boardLabel) return boardLabel;
  const args = isRecord(tc.args) ? tc.args : {};
  const summary = unquoteArg(args.toolSummary) || unquoteArg(args.toolAction);
  if (summary) return oneLine(summary);
  const targetPath = unquoteArg(
    args.Path ?? args.AbsolutePath ?? args.TargetFile
  );
  if (targetPath) {
    const verbMap: Record<string, string> = {
      read_file: "读取",
      write_file: "写入",
      edit_file: "编辑"
    };
    const verb = verbMap[name];
    if (verb) return `${verb} ${basename(targetPath)}`;
  }
  if (name === "code_search" && args.Query) {
    return oneLine(`搜索 ${unquoteArg(args.Query)}`);
  }
  if (name === "swarm" && args.action) {
    return oneLine(`swarm ${unquoteArg(args.action)} ${unquoteArg(args.name)}`);
  }
  return name;
}

function thinkingHeading(thinking: unknown): string {
  if (typeof thinking !== "string") return "";
  const hs = [
    ...thinking.matchAll(/(?:^|\n)\s*\*\*([^*\n]{3,96})\*\*\s*(?=\n|$)/g)
  ];
  const last = hs.at(-1)?.[1];
  return last ? oneLine(last) : "";
}

function boardTimeMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T"));
  return Number.isFinite(ms) ? ms : null;
}

interface TranscriptSummary {
  steps: number;
  activity: string;
  activityKind: "tool" | "thinking" | "";
  last: { type: string; status: string; error: string } | null;
  idle: boolean;
  replied: boolean;
  replyAsk: string;
  mtime: number;
  recentSteps: AgentAuxNativeStep[];
}

function parseTurnEnded(lines: readonly string[]): boolean {
  const results: Array<Record<string, unknown>> = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    let step: unknown;
    try {
      step = JSON.parse(rawLine);
    } catch {
      return false;
    }
    if (!isRecord(step)) return false;
    if (step.type === "GENERIC") {
      results.unshift(step);
      continue;
    }
    if (step.type !== "PLANNER_RESPONSE") return false;
    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    if (calls.length === 0) return results.length === 0;
    const waitIdx = calls.findIndex(
      (c) => isRecord(c) && c.name === "swarm_wait"
    );
    return (
      waitIdx >= 0 &&
      results.length >= calls.length &&
      results[waitIdx]?.status === "DONE"
    );
  }
  return false;
}

function parseFinalReply(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    let step: unknown;
    try {
      step = JSON.parse(rawLine);
    } catch {
      return null;
    }
    if (!isRecord(step)) return null;
    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    return step.type === "PLANNER_RESPONSE" && calls.length === 0
      ? String(step.content ?? "")
      : null;
  }
  return null;
}

function extractReplyQuestion(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`\n]*)`/g, (_, s: string) => s.replace(/\?/g, ""))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, " ")
    .replace(/\*\*|__/g, "");
  const qs = plain
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((x) => x.replace(/^[\s>*-]+/, "").trim())
    .filter((x) => /[?？]$/.test(x) && x.length > 3);
  const lastQ = qs.at(-1);
  return lastQ ? oneLine(lastQ, 200) : "";
}

async function summarizeTranscriptFileAsync(
  filePath: string,
  rootDir: string,
  collectRecentSteps = false,
  cache?: Map<
    string,
    { mtime: number; size: number; collectRecentSteps: boolean; summary: TranscriptSummary }
  >
): Promise<TranscriptSummary | null> {
  const st = await safeStatAsync(filePath);
  if (!st || !st.isFile || st.size < 0) return null;
  const cacheKey = `${filePath}|${collectRecentSteps ? "1" : "0"}`;
  if (cache) {
    const cached = cache.get(cacheKey);
    if (
      cached &&
      cached.mtime === st.mtime &&
      cached.size === st.size &&
      cached.collectRecentSteps === collectRecentSteps
    ) {
      return cached.summary;
    }
  }
  const tail = await readTailTextFileAsync(
    filePath,
    rootDir,
    MAX_TRANSCRIPT_TAIL_BYTES,
    st
  );
  if (!tail) return null;
  const lines = tail.text.split("\n").filter((line) => line.trim().length > 0);
  let steps = lines.length;
  let activity = "";
  let activityKind: "tool" | "thinking" | "" = "";
  let last: { type: string; status: string; error: string } | null = null;
  const recentSteps: AgentAuxNativeStep[] = [];

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    let step: unknown;
    try {
      step = JSON.parse(rawLine);
    } catch {
      continue;
    }
    if (!isRecord(step)) continue;
    if (
      i === lines.length - 1 &&
      typeof step.step_index === "number" &&
      Number.isFinite(step.step_index)
    ) {
      steps = Math.max(steps, step.step_index + 1);
    }
    if (!last) {
      last = {
        type: String(step.type ?? ""),
        status: String(step.status ?? ""),
        error: typeof step.error === "string" ? oneLine(step.error, 240) : ""
      };
    }
    if (!activity) {
      if (step.type === "USER_INPUT") {
        // boundary for current turn activity
        activity = "";
      } else if (step.type === "PLANNER_RESPONSE") {
        const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
        if (calls.some((tc) => isRecord(tc) && tc.name === "swarm_wait")) {
          // wait boundary
        } else {
          const labeledCalls = calls.filter(
            (tc): tc is Record<string, unknown> =>
              isRecord(tc) && describeToolCall(tc).length > 0
          );
          const lastCall = labeledCalls.at(-1);
          const label = lastCall ? describeToolCall(lastCall) : "";
          const heading = thinkingHeading(step.thinking);
          if (label) {
            activity = label;
            activityKind = "tool";
          } else if (heading) {
            activity = heading;
            activityKind = "thinking";
          }
        }
      }
    }
  }

  if (collectRecentSteps) {
    const tailSlice = lines.slice(-MAX_SUBAGENT_STEPS);
    for (let idx = 0; idx < tailSlice.length; idx += 1) {
      const rawLine = tailSlice[idx];
      if (!rawLine) continue;
      let step: unknown;
      try {
        step = JSON.parse(rawLine);
      } catch {
        continue;
      }
      if (!isRecord(step)) continue;
      const calls = Array.isArray(step.tool_calls)
        ? step.tool_calls
            .filter((tc): tc is Record<string, unknown> => isRecord(tc))
            .map((tc) => ({
              name: typeof tc.name === "string" ? tc.name : "tool",
              summary: describeToolCall(tc)
            }))
        : [];
      const contentText =
        typeof step.content === "string"
          ? step.content.slice(0, 1200)
          : typeof step.error === "string"
            ? step.error.slice(0, 1200)
            : null;
      recentSteps.push({
        index:
          typeof step.step_index === "number" && Number.isFinite(step.step_index)
            ? step.step_index
            : idx,
        type: String(step.type ?? "STEP"),
        status: typeof step.status === "string" ? step.status : null,
        text: contentText,
        toolCalls: calls
      });
    }
  }

  const idle = parseTurnEnded(lines);
  const reply = parseFinalReply(lines);
  const replied = reply !== null;
  const replyAsk = replied ? extractReplyQuestion(reply) : "";

  const summary: TranscriptSummary = {
    steps,
    activity,
    activityKind,
    last,
    idle,
    replied,
    replyAsk,
    mtime: tail.mtime,
    recentSteps
  };
  if (cache) {
    setBoundedCache(cache, cacheKey, {
      mtime: tail.mtime,
      size: tail.size,
      collectRecentSteps,
      summary
    });
  }
  return summary;
}

function stepFailureOf(
  tr: TranscriptSummary | null,
  nowMs: number
): AgentAuxSwarmFailure | null {
  const last = tr?.last;
  if (!last) return null;
  const modelError = last.type === "ERROR_MESSAGE";
  const settledToolError =
    last.status === "ERROR" && nowMs - (tr.mtime || 0) >= STEP_ERROR_SETTLE_MS;
  if (!modelError && !settledToolError) return null;
  const text = last.error || (modelError ? "model error" : "step failed");
  return { kind: QUOTA_RE.test(text) ? "quota" : "error", text };
}

function memberStatusOf(
  rawMember: Record<string, unknown>,
  tr: TranscriptSummary | null
): "working" | "waiting" | "killed" {
  if (rawMember.killed === true) return "killed";
  if (tr !== null) return tr.idle ? "waiting" : "working";
  const wakeMode = typeof rawMember.wake_mode === "string" ? rawMember.wake_mode : "";
  if (wakeMode === "mentions" || wakeMode === "anything") return "waiting";
  return "working";
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class AgentAuxService {
  private readonly agyAppDataDirsOverride: string[] | undefined;
  private readonly claudeHomeDirOverride: string | undefined;
  private readonly codexHomeDirOverride: string | undefined;
  private readonly nowFn: () => number;
  private readonly openCodexDbFn: (dbPath: string) => DatabaseSync;

  private agyAppDataCache: {
    builtAt: number;
    geminiRootMtime: number;
    dirs: string[];
  } = { builtAt: 0, geminiRootMtime: -1, dirs: [] };

  private swarmDirCache: {
    builtAt: number;
    brainMtimes: Map<string, number>;
    entries: Array<{ appData: string; convId: string }>;
  } = { builtAt: 0, brainMtimes: new Map(), entries: [] };

  private readonly transcriptCache = new Map<
    string,
    { mtime: number; size: number; collectRecentSteps: boolean; summary: TranscriptSummary }
  >();

  private readonly dirListingCache = new Map<
    string,
    { mtime: number; entries: string[] }
  >();

  private readonly jsonObjectCache = new Map<
    string,
    { mtime: number; size: number; value: Record<string, unknown> | null }
  >();

  private readonly codexStateCache = new Map<
    string,
    {
      fingerprint: string;
      spawnedThreads: AgentAuxCodexSpawnedThread[];
      relatedThreadIds: string[];
    }
  >();

  private readonly codexGoalsCache = new Map<
    string,
    { fingerprint: string; goals: AgentAuxCodexGoal[] }
  >();

  constructor(options: AgentAuxServiceOptions = {}) {
    this.agyAppDataDirsOverride = options.agyAppDataDirs;
    this.claudeHomeDirOverride = options.claudeHomeDir;
    this.codexHomeDirOverride = options.codexHomeDir;
    this.nowFn = options.now ?? (() => Date.now());
    this.openCodexDbFn =
      options.openCodexDb ??
      ((dbPath) => new DatabaseSync(dbPath, { readOnly: true }));
  }

  private async readDirCached(dirPath: string): Promise<string[]> {
    const st = await safeStatAsync(dirPath);
    if (!st || !st.isDirectory) {
      this.dirListingCache.delete(dirPath);
      return [];
    }
    const cached = this.dirListingCache.get(dirPath);
    if (cached && cached.mtime === st.mtime) {
      return cached.entries;
    }
    const entries = await safeReaddirAsync(dirPath);
    setBoundedCache(this.dirListingCache, dirPath, { mtime: st.mtime, entries });
    return entries;
  }

  private async readCachedJsonObject(
    filePath: string,
    rootDir: string,
    maxBytes: number
  ): Promise<Record<string, unknown> | null> {
    const st = await safeStatAsync(filePath);
    if (!st || !st.isFile || st.size < 0 || st.size > maxBytes) {
      this.jsonObjectCache.delete(filePath);
      return null;
    }
    const cached = this.jsonObjectCache.get(filePath);
    if (cached && cached.mtime === st.mtime && cached.size === st.size) {
      return cached.value;
    }
    const text = await readSmallTextFileAsync(filePath, rootDir, maxBytes);
    const parsed = parseJsonObject(text);
    setBoundedCache(this.jsonObjectCache, filePath, {
      mtime: st.mtime,
      size: st.size,
      value: parsed
    });
    return parsed;
  }

  async inspect(query: AgentAuxInspectQuery): Promise<AgentAuxInspectResponse> {
    const provider = normalizeProvider(query.provider);
    const sessionId = validateSessionId(query.sessionId);
    const cwd = validateCwd(query.cwd);
    const updatedAt = this.nowFn();

    const tryAgy =
      provider === "" || provider === "antigravity" || provider === "acp";
    const tryClaude = provider === "" || provider === "claude";
    const tryCodex = provider === "" || provider === "codex";

    let swarm: AgentAuxSwarmSnapshot | undefined;
    let agySubagents: AgentAuxNativeSubagent[] | undefined;
    if (tryAgy && sessionId && AGY_CONV_ID_RE.test(sessionId)) {
      swarm = (await this.inspectAgySwarm(sessionId, updatedAt)) ?? undefined;
      if (!swarm) {
        const subs = await this.inspectAgyDetachedSubagents(sessionId);
        if (subs.length > 0) {
          agySubagents = subs;
        }
      }
    }

    let claudeTeam: AgentAuxClaudeTeamSnapshot | undefined;
    let claudeTasks: AgentAuxTaskItem[] = [];
    if (tryClaude && (sessionId || cwd)) {
      const cc = await this.inspectClaudeCode(sessionId, cwd);
      if (cc.team) {
        claudeTeam = cc.team;
      }
      claudeTasks = cc.tasks;
    }

    let codex: AgentAuxCodexSnapshot | undefined;
    let codexTasks: AgentAuxTaskItem[] = [];
    if (tryCodex && (sessionId || cwd)) {
      const cx = await this.inspectCodex(sessionId, cwd);
      if (cx && (cx.goals.length > 0 || cx.spawnedThreads.length > 0)) {
        codex = cx;
        codexTasks = cx.goals.map((goal) => ({
          id: goal.goalId || goal.threadId,
          subject: goal.objective,
          description:
            goal.tokenBudget !== null
              ? `Token 用量 ${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()}`
              : `已用 Token ${goal.tokensUsed.toLocaleString()}`,
          status:
            goal.status === "complete"
              ? "completed"
              : goal.status === "active"
                ? "in_progress"
                : goal.status === "blocked" ||
                    goal.status === "usage_limited" ||
                    goal.status === "budget_limited"
                  ? "blocked"
                  : "pending",
          owner: "codex",
          blockedBy: [],
          blocks: [],
          source: "codex-goals",
          ...(goal.tokenBudget !== null && goal.tokenBudget > 0
            ? {
                progressLabel: `${Math.min(
                  100,
                  Math.round((goal.tokensUsed / goal.tokenBudget) * 100)
                )}%`
              }
            : {})
        }));
      }
    }

    const allTasks = [...claudeTasks, ...codexTasks];

    if (swarm) {
      const hasLiveWork = swarm.members.some(
        (m) => !m.killed && !m.roleWorker && !m.narrator && m.status === "working"
      ) || swarm.systemAttention.length > 0;
      return {
        ok: true,
        active: true,
        hasLiveWork,
        kind: "agy-swarm",
        title: swarm.title || "蜂群协作",
        activationKey: `agy-swarm:${swarm.id}`,
        swarm,
        ...(allTasks.length > 0 ? { tasks: allTasks } : {}),
        updatedAt
      };
    }

    if (claudeTeam) {
      const hasLiveWork =
        claudeTeam.members.some((m) => m.status === "working") ||
        allTasks.some((t) => t.status === "in_progress");
      return {
        ok: true,
        active: true,
        hasLiveWork,
        kind: "claude-team",
        title: claudeTeam.teamName || "Claude 智能体团队",
        activationKey: `claude-team:${claudeTeam.teamName}`,
        claudeTeam,
        ...(allTasks.length > 0 ? { tasks: allTasks } : {}),
        updatedAt
      };
    }

    if (agySubagents && agySubagents.length > 0) {
      const hasLiveWork = agySubagents.some((s) => s.status === "working");
      return {
        ok: true,
        active: true,
        hasLiveWork,
        kind: "agy-subagents",
        title: "Antigravity 子智能体",
        activationKey: `agy-subagents:${sessionId ?? "local"}`,
        agySubagents,
        ...(allTasks.length > 0 ? { tasks: allTasks } : {}),
        updatedAt
      };
    }

    if (codex && (codex.spawnedThreads.length > 0 || codex.goals.length > 0)) {
      const hasLiveWork =
        codex.spawnedThreads.some((t) =>
          ["running", "active", "pending", "in_progress", "starting"].includes(
            t.status.toLowerCase()
          )
        ) || codex.goals.some((g) => g.status === "active");
      return {
        ok: true,
        active: true,
        hasLiveWork,
        kind: "codex-collab",
        title: "Codex 协同子代理",
        activationKey: `codex-collab:${sessionId ?? codex.spawnedThreads[0]?.parentThreadId ?? codex.goals[0]?.goalId ?? "session"}`,
        codex,
        ...(allTasks.length > 0 ? { tasks: allTasks } : {}),
        updatedAt
      };
    }

    return {
      ok: true,
      active: false,
      hasLiveWork: false,
      kind: null,
      title: "",
      activationKey: null,
      ...(allTasks.length > 0 ? { tasks: allTasks } : {}),
      updatedAt
    };
  }

  private async resolveAgyAppDataDirs(): Promise<string[]> {
    if (this.agyAppDataDirsOverride) {
      const out: string[] = [];
      for (const dir of this.agyAppDataDirsOverride) {
        const brainStat = await safeStatAsync(join(dir, "brain"));
        if (brainStat?.isDirectory) {
          out.push(dir);
        }
      }
      return out;
    }

    const nowMs = this.nowFn();
    const geminiRoot = join(homedir(), ".gemini");
    if (
      this.agyAppDataCache.builtAt > 0 &&
      nowMs - this.agyAppDataCache.builtAt < ROSTER_SCAN_TTL_MS
    ) {
      return this.agyAppDataCache.dirs;
    }

    const rootStat = await safeStatAsync(geminiRoot);
    if (!rootStat || !rootStat.isDirectory) {
      this.agyAppDataCache = { builtAt: nowMs, geminiRootMtime: -1, dirs: [] };
      return [];
    }
    if (
      this.agyAppDataCache.builtAt > 0 &&
      this.agyAppDataCache.geminiRootMtime === rootStat.mtime
    ) {
      this.agyAppDataCache.builtAt = nowMs;
      return this.agyAppDataCache.dirs;
    }

    const candidates = [
      join(geminiRoot, "antigravity"),
      join(geminiRoot, "antigravity-acp"),
      join(geminiRoot, "antigravity-cli")
    ];
    const children = (await safeReaddirAsync(geminiRoot)).sort();
    for (const child of children) {
      if (!SAFE_DIR_SEGMENT_RE.test(child)) continue;
      candidates.push(join(geminiRoot, child));
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const dir of candidates) {
      const brainStat = await safeStatAsync(join(dir, "brain"));
      if (!brainStat?.isDirectory) continue;
      let real = dir;
      try {
        real = await realpathAsync(dir);
      } catch {
        continue;
      }
      const key = process.platform === "win32" ? real.toLowerCase() : real;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(real);
    }
    this.agyAppDataCache = {
      builtAt: nowMs,
      geminiRootMtime: rootStat.mtime,
      dirs: out
    };
    return out;
  }

  private async listAgySwarmDirs(appDataDirs: readonly string[]): Promise<
    Array<{
      appData: string;
      convId: string;
    }>
  > {
    const nowMs = this.nowFn();
    if (
      !this.agyAppDataDirsOverride &&
      this.swarmDirCache.builtAt > 0 &&
      nowMs - this.swarmDirCache.builtAt < ROSTER_SCAN_TTL_MS
    ) {
      return this.swarmDirCache.entries;
    }

    // Directory mtimeMs short-circuit: if every brainDir's mtimeMs is unchanged, reuse entries.
    if (
      !this.agyAppDataDirsOverride &&
      this.swarmDirCache.builtAt > 0 &&
      this.swarmDirCache.brainMtimes.size === appDataDirs.length
    ) {
      let allUnchanged = true;
      for (const appData of appDataDirs) {
        const brainDir = join(appData, "brain");
        const st = await safeStatAsync(brainDir);
        const prevMtime = this.swarmDirCache.brainMtimes.get(brainDir);
        if (!st || prevMtime === undefined || st.mtime !== prevMtime) {
          allUnchanged = false;
          break;
        }
      }
      if (allUnchanged) {
        this.swarmDirCache.builtAt = nowMs;
        return this.swarmDirCache.entries;
      }
    }

    const entries: Array<{ appData: string; convId: string }> = [];
    const brainMtimes = new Map<string, number>();
    const seen = new Set<string>();
    for (const appData of appDataDirs) {
      const brainDir = join(appData, "brain");
      const brainStat = await safeStatAsync(brainDir);
      if (!brainStat || !brainStat.isDirectory) continue;
      brainMtimes.set(brainDir, brainStat.mtime);
      const convIds = await this.readDirCached(brainDir);
      for (const convId of convIds) {
        if (!AGY_CONV_ID_RE.test(convId) || seen.has(convId)) continue;
        const membersPath = join(
          brainDir,
          convId,
          ".system_generated",
          "swarm",
          "members.json"
        );
        const membersStat = await safeStatAsync(membersPath);
        if (membersStat?.isFile) {
          seen.add(convId);
          entries.push({ appData, convId });
        }
      }
    }
    this.swarmDirCache = { builtAt: nowMs, brainMtimes, entries };
    return entries;
  }

  private async readSwarmRoster(
    appData: string,
    convId: string
  ): Promise<{ title: string; members: Record<string, Record<string, unknown>> } | null> {
    const membersPath = join(
      appData,
      "brain",
      convId,
      ".system_generated",
      "swarm",
      "members.json"
    );
    const parsed = await this.readCachedJsonObject(
      membersPath,
      appData,
      MAX_VIEW_BYTES * 4
    );
    if (!parsed) return null;
    const rawMembers = isRecord(parsed.members) ? parsed.members : {};
    const members: Record<string, Record<string, unknown>> = {};
    for (const [name, value] of Object.entries(rawMembers)) {
      if (isRecord(value)) {
        members[name] = value;
      }
    }
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      members
    };
  }

  private async inspectAgySwarm(
    sessionId: string,
    nowMs: number
  ): Promise<AgentAuxSwarmSnapshot | null> {
    const appDataDirs = await this.resolveAgyAppDataDirs();
    if (appDataDirs.length === 0) return null;

    let matchedAppData: string | null = null;
    let matchedSwarmId: string | null = null;
    let matchedRoster: {
      title: string;
      members: Record<string, Record<string, unknown>>;
    } | null = null;
    let selfMember: string | null = null;

    // 1. Direct coordinator check
    for (const appData of appDataDirs) {
      const roster = await this.readSwarmRoster(appData, sessionId);
      if (roster) {
        matchedAppData = appData;
        matchedSwarmId = sessionId;
        matchedRoster = roster;
        selfMember =
          Object.entries(roster.members).find(
            ([, m]) => m.conversation_id === sessionId
          )?.[0] ?? "coordinator";
        break;
      }
    }

    // 2. Worker reverse lookup
    if (!matchedRoster) {
      const swarmDirs = await this.listAgySwarmDirs(appDataDirs);
      for (const { appData, convId } of swarmDirs) {
        const roster = await this.readSwarmRoster(appData, convId);
        if (!roster) continue;
        const found = Object.entries(roster.members).find(
          ([, m]) => m.conversation_id === sessionId
        );
        if (found) {
          matchedAppData = appData;
          matchedSwarmId = convId;
          matchedRoster = roster;
          selfMember = found[0];
          break;
        }
      }
    }

    if (!matchedAppData || !matchedSwarmId || !matchedRoster) {
      return null;
    }

    const swarmDir = join(
      matchedAppData,
      "brain",
      matchedSwarmId,
      ".system_generated",
      "swarm"
    );
    const names = Object.keys(matchedRoster.members);

    // Parse board.jsonl (last 400 lines)
    const boardTail = await readTailTextFileAsync(
      join(swarmDir, "board.jsonl"),
      matchedAppData,
      MAX_BOARD_TAIL_BYTES
    );
    const rawBoardLines = (boardTail?.text ?? "")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .slice(-MAX_BOARD_MESSAGES);

    const parsedBoard: Array<Record<string, unknown>> = [];
    for (const line of rawBoardLines) {
      try {
        const obj: unknown = JSON.parse(line);
        if (isRecord(obj)) parsedBoard.push(obj);
      } catch {
        // skip torn tail line
      }
    }

    const postsByMember = new Map<
      string,
      { posts: number; lastPostSeq: number; lastPostTime: string; lastPostTs: number | null }
    >();
    const edgeMap = new Map<string, AgentAuxEdge>();
    let head = 0;

    const messages: AgentAuxSwarmMessage[] = parsedBoard.map((raw, idx) => {
      const seq =
        typeof raw.seq === "number" && Number.isFinite(raw.seq)
          ? raw.seq
          : idx + 1;
      if (seq > head) head = seq;
      const agent = typeof raw.agent === "string" ? raw.agent : "";
      const text = typeof raw.text === "string" ? raw.text : "";
      const time = typeof raw.time === "string" ? raw.time : "";
      const ts = boardTimeMs(time);
      const channel =
        typeof raw.channel === "string" && raw.channel && raw.channel !== "main"
          ? raw.channel
          : undefined;
      const control = isRecord(raw.control) ? raw.control : undefined;

      if (control) {
        return {
          seq,
          agent,
          text,
          time,
          ts,
          mentions: [],
          all: false,
          ...(channel ? { channel } : {}),
          control
        };
      }

      const { mentions, all } = extractBoardMentions(text, names);
      const prev = postsByMember.get(agent) ?? {
        posts: 0,
        lastPostSeq: 0,
        lastPostTime: "",
        lastPostTs: null
      };
      postsByMember.set(agent, {
        posts: prev.posts + 1,
        lastPostSeq: seq,
        lastPostTime: time,
        lastPostTs: ts
      });

      const senderRaw = matchedRoster.members[agent];
      if (!senderRaw || !isRoleWorker(agent, senderRaw)) {
        const directSet = new Set(mentions);
        const targets = new Set(all ? names : mentions);
        targets.delete(agent);
        for (const to of targets) {
          const toRaw = matchedRoster.members[to];
          if (toRaw && isRoleWorker(to, toRaw)) continue;
          const key = `${agent}\0${to}`;
          const edge = edgeMap.get(key) ?? {
            from: agent,
            to,
            count: 0,
            direct: 0,
            viaAll: 0
          };
          edge.count += 1;
          if (directSet.has(to)) edge.direct += 1;
          else edge.viaAll += 1;
          edgeMap.set(key, edge);
        }
      }

      return {
        seq,
        agent,
        text,
        time,
        ts,
        mentions,
        all,
        ...(channel ? { channel } : {})
      };
    });

    // Summarize member transcripts & pick narrator
    let narratorName: string | null = null;
    let liveNarratorRank = -1;
    let deadNarratorRank = -1;
    let deadNarratorName: string | null = null;

    for (const [name, raw] of Object.entries(matchedRoster.members)) {
      const rank = narratorRank(name, raw);
      if (rank < 0) continue;
      if (raw.killed === true) {
        if (rank > deadNarratorRank) {
          deadNarratorRank = rank;
          deadNarratorName = name;
        }
      } else if (rank > liveNarratorRank) {
        liveNarratorRank = rank;
        narratorName = name;
      }
    }
    const chosenNarrator = narratorName ?? deadNarratorName;

    const members: AgentAuxSwarmMember[] = await Promise.all(
      names.map(async (name) => {
        const raw = matchedRoster.members[name] ?? {};
        const convId =
          typeof raw.conversation_id === "string" ? raw.conversation_id : "";
        const tr =
          convId && AGY_CONV_ID_RE.test(convId) && raw.killed !== true
            ? await summarizeTranscriptFileAsync(
                join(
                  matchedAppData,
                  "brain",
                  convId,
                  ".system_generated",
                  "logs",
                  "transcript.jsonl"
                ),
                matchedAppData,
                false,
                this.transcriptCache
              )
            : null;
        const lastReadSeq =
          typeof raw.last_read_seq === "number" && Number.isFinite(raw.last_read_seq)
            ? raw.last_read_seq
            : 0;
        const postStats = postsByMember.get(name) ?? {
          posts: 0,
          lastPostSeq: 0,
          lastPostTime: "",
          lastPostTs: null
        };
        const channels = Array.isArray(raw.channels)
          ? raw.channels.filter((c): c is string => typeof c === "string")
          : undefined;
        return {
          name,
          conversationId: convId,
          model: typeof raw.model === "string" ? raw.model : "",
          role: roleOfMember(name, raw),
          wakeMode: typeof raw.wake_mode === "string" ? raw.wake_mode : "",
          status: memberStatusOf(raw, tr),
          waitSince:
            typeof raw.wait_since === "number" && Number.isFinite(raw.wait_since)
              ? raw.wait_since
              : 0,
          lastReadSeq,
          unread: Math.max(0, head - lastReadSeq),
          killed: raw.killed === true,
          steps: tr?.steps ?? 0,
          activity: tr?.activity ?? "",
          activityKind: tr?.activityKind ?? "",
          replied: tr?.replied ?? false,
          replyAsk: tr?.replyAsk ?? "",
          narrator: narratorRank(name, raw) >= 0,
          roleWorker: isRoleWorker(name, raw),
          failure: stepFailureOf(tr, nowMs),
          transcriptMtime: tr?.mtime ?? 0,
          posts: postStats.posts,
          lastPostSeq: postStats.lastPostSeq,
          lastPostTime: postStats.lastPostTime,
          lastPostTs: postStats.lastPostTs,
          ...(typeof raw.workspace === "string" && raw.workspace
            ? { workspace: raw.workspace }
            : {}),
          ...(typeof raw.workspace_mode === "string" && raw.workspace_mode
            ? { workspaceMode: raw.workspace_mode }
            : {}),
          ...(channels && channels.length > 0 ? { channels } : {})
        };
      })
    );

    members.sort(
      (a, b) =>
        (a.role === "coordinator" ? 0 : 1) - (b.role === "coordinator" ? 0 : 1) ||
        a.name.localeCompare(b.name)
    );

    const systemAttention: AgentAuxSystemAttentionItem[] = [];
    for (const m of members) {
      if (m.killed || m.narrator || m.roleWorker) continue;
      if (m.failure) {
        systemAttention.push({
          id: `sys-${m.name}-${m.failure.kind}`,
          kind: m.failure.kind,
          member: m.name,
          conversationId: m.conversationId,
          text:
            m.failure.kind === "quota"
              ? `@${m.name} 配额已耗尽`
              : `@${m.name} 上一步执行失败`,
          detail: m.failure.text
        });
      } else if (
        m.status === "working" &&
        m.transcriptMtime > 0 &&
        nowMs - m.transcriptMtime > STUCK_MS
      ) {
        systemAttention.push({
          id: `sys-${m.name}-stuck`,
          kind: "stuck",
          member: m.name,
          conversationId: m.conversationId,
          text: `@${m.name} 长时间无进展且未进入等待态`,
          detail: "",
          since: m.transcriptMtime
        });
      }
    }

    // Read plan.json (capped 64 KB)
    const planRaw = await this.readCachedJsonObject(
      join(swarmDir, "plan.json"),
      matchedAppData,
      MAX_VIEW_BYTES
    );
    const plan = planRaw ? (planRaw as unknown as AgentAuxSwarmPlan) : null;

    // Read view.json (capped 64 KB, swarm dir or narrator fallback)
    let viewRaw = await this.readCachedJsonObject(
      join(swarmDir, "view.json"),
      matchedAppData,
      MAX_VIEW_BYTES
    );
    if (!viewRaw && chosenNarrator) {
      const narratorConv = matchedRoster.members[chosenNarrator]?.conversation_id;
      if (typeof narratorConv === "string" && AGY_CONV_ID_RE.test(narratorConv)) {
        viewRaw = await this.readCachedJsonObject(
          join(matchedAppData, "brain", narratorConv, "swarm_view", "view.json"),
          matchedAppData,
          MAX_VIEW_BYTES
        );
      }
    }
    const view = viewRaw ? (viewRaw as unknown as AgentAuxSwarmView) : null;

    return {
      id: matchedSwarmId,
      title: matchedRoster.title || "蜂群协作",
      selfMember,
      head,
      members,
      messages,
      edges: [...edgeMap.values()],
      plan,
      view,
      systemAttention
    };
  }

  private async inspectAgyDetachedSubagents(
    sessionId: string
  ): Promise<AgentAuxNativeSubagent[]> {
    const appDataDirs = await this.resolveAgyAppDataDirs();
    const result: AgentAuxNativeSubagent[] = [];
    for (const appData of appDataDirs) {
      const subDir = join(
        appData,
        "brain",
        sessionId,
        ".system_generated",
        "subagents"
      );
      const subDirStat = await safeStatAsync(subDir);
      if (!subDirStat?.isDirectory || !(await isContainedInRootAsync(subDir, appData))) {
        continue;
      }
      const files = (await this.readDirCached(subDir))
        .filter((f) => f.endsWith(".json"))
        .slice(0, MAX_DETACHED_SUBAGENTS);
      for (const file of files) {
        const stem = file.slice(0, -5);
        if (!SAFE_DIR_SEGMENT_RE.test(stem)) continue;
        const parsed = await this.readCachedJsonObject(
          join(subDir, file),
          appData,
          MAX_VIEW_BYTES
        );
        if (!parsed) continue;
        const convId =
          typeof parsed.conversationId === "string" &&
          SAFE_DIR_SEGMENT_RE.test(parsed.conversationId)
            ? parsed.conversationId
            : stem;
        const descriptor = isRecord(parsed.subagentDescriptor)
          ? parsed.subagentDescriptor
          : null;
        const role =
          typeof descriptor?.role === "string" && descriptor.role.trim()
            ? descriptor.role.trim()
            : typeof parsed.role === "string" && parsed.role.trim()
              ? parsed.role.trim()
              : convId;
        const state =
          typeof parsed.state === "string" ? parsed.state : "RUNNING";
        const tr = AGY_CONV_ID_RE.test(convId)
          ? await summarizeTranscriptFileAsync(
              join(
                appData,
                "brain",
                convId,
                ".system_generated",
                "logs",
                "transcript.jsonl"
              ),
              appData,
              true,
              this.transcriptCache
            )
          : null;
        const lowerState = state.toLowerCase();
        const status: AgentAuxNativeSubagent["status"] =
          lowerState.includes("kill") || lowerState.includes("cancel")
            ? "killed"
            : lowerState.includes("done") ||
                lowerState.includes("complete") ||
                lowerState.includes("finish")
              ? "done"
              : tr
                ? tr.idle
                  ? "waiting"
                  : "working"
                : lowerState.includes("wait") || lowerState.includes("idle")
                  ? "waiting"
                  : "working";
        result.push({
          conversationId: convId,
          role,
          state,
          status,
          stepsCount: tr?.steps ?? 0,
          activity: tr?.activity ?? "",
          activityKind: tr?.activityKind ?? "",
          steps: tr?.recentSteps ?? [],
          transcriptMtime: tr?.mtime ?? 0
        });
      }
      if (result.length > 0) break;
    }
    return result;
  }

  private async inspectClaudeCode(
    sessionId: string | undefined,
    cwd: string | undefined
  ): Promise<{
    team: AgentAuxClaudeTeamSnapshot | null;
    tasks: AgentAuxTaskItem[];
  }> {
    const claudeRoot = this.claudeHomeDirOverride ?? join(homedir(), ".claude");
    const claudeRootStat = await safeStatAsync(claudeRoot);
    if (!claudeRootStat?.isDirectory) {
      return { team: null, tasks: [] };
    }

    const teamsDir = join(claudeRoot, "teams");
    let matchedTeam: AgentAuxClaudeTeamSnapshot | null = null;
    let matchedTeamFolder: string | null = null;

    const teamsDirStat = await safeStatAsync(teamsDir);
    if (teamsDirStat?.isDirectory && (await isContainedInRootAsync(teamsDir, claudeRoot))) {
      const teamFolders = [...(await this.readDirCached(teamsDir))].sort();
      for (const teamFolder of teamFolders) {
        if (!SAFE_DIR_SEGMENT_RE.test(teamFolder)) continue;
        const teamDir = join(teamsDir, teamFolder);
        const config = await this.readCachedJsonObject(
          join(teamDir, "config.json"),
          claudeRoot,
          MAX_INBOX_BYTES
        );
        if (!config) continue;

        const teamName =
          typeof config.name === "string" && config.name.trim()
            ? config.name.trim()
            : teamFolder;
        const leadSessionId =
          typeof config.leadSessionId === "string" ? config.leadSessionId.trim() : "";
        const leadAgentId =
          typeof config.leadAgentId === "string" ? config.leadAgentId.trim() : "";
        const configCwd = typeof config.cwd === "string" ? config.cwd.trim() : "";
        const rawMembers = Array.isArray(config.members)
          ? config.members.filter((m): m is Record<string, unknown> => isRecord(m))
          : [];

        const matchesSession = Boolean(
          sessionId &&
            (leadSessionId === sessionId ||
              teamName === sessionId ||
              teamFolder === sessionId ||
              rawMembers.some(
                (m) =>
                  m.agentId === sessionId ||
                  m.sessionId === sessionId ||
                  m.conversationId === sessionId
              ))
        );
        const matchesCwd = Boolean(
          cwd &&
            (pathsMatch(configCwd, cwd) ||
              rawMembers.some(
                (m) => typeof m.cwd === "string" && pathsMatch(m.cwd, cwd)
              ))
        );

        if (!matchesSession && !matchesCwd) continue;

        const members: AgentAuxClaudeTeamMember[] = rawMembers.map((m, idx) => {
          const name =
            typeof m.name === "string" && m.name.trim()
              ? m.name.trim()
              : `teammate-${idx + 1}`;
          const agentId =
            typeof m.agentId === "string" && m.agentId.trim()
              ? m.agentId.trim()
              : `${name}@${teamName}`;
          const rawStatus =
            typeof m.status === "string" ? m.status.toLowerCase() : "";
          const status: AgentAuxClaudeTeamMember["status"] =
            rawStatus === "done" ||
            rawStatus === "completed" ||
            rawStatus === "stopped" ||
            rawStatus === "shutdown"
              ? "done"
              : rawStatus === "idle" || rawStatus === "waiting"
                ? "waiting"
                : "working";
          return {
            agentId,
            name,
            agentType:
              typeof m.agentType === "string" ? m.agentType : "teammate",
            model: typeof m.model === "string" ? m.model : "",
            color: typeof m.color === "string" ? m.color : "",
            cwd: typeof m.cwd === "string" ? m.cwd : configCwd,
            backendType:
              typeof m.backendType === "string" ? m.backendType : "",
            status,
            isLead:
              agentId === leadAgentId ||
              name === "team-lead" ||
              (typeof m.agentType === "string" &&
                m.agentType.toLowerCase().includes("lead")),
            ...(typeof m.joinedAt === "number" ? { joinedAt: m.joinedAt } : {})
          };
        });

        const memberNames = members.map((m) => m.name);
        const inboxesDir = join(teamDir, "inboxes");
        const rawInboxEntries: Array<{
          recipient: string;
          from: string;
          text: string;
          summary: string;
          time: string;
          ts: number | null;
          read: boolean;
          color?: string;
        }> = [];

        const inboxesStat = await safeStatAsync(inboxesDir);
        if (inboxesStat?.isDirectory && (await isContainedInRootAsync(inboxesDir, claudeRoot))) {
          const inboxFiles = [...(await this.readDirCached(inboxesDir))].sort();
          for (const file of inboxFiles) {
            if (!file.endsWith(".json")) continue;
            const recipient = file.slice(0, -5);
            if (!SAFE_DIR_SEGMENT_RE.test(recipient)) continue;
            const text = await readSmallTextFileAsync(
              join(inboxesDir, file),
              claudeRoot,
              MAX_INBOX_BYTES
            );
            if (!text) continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              continue;
            }
            const list = Array.isArray(parsed)
              ? parsed
              : isRecord(parsed) && Array.isArray(parsed.messages)
                ? parsed.messages
                : [];
            for (const entry of list) {
              if (!isRecord(entry)) continue;
              const from =
                typeof entry.from === "string"
                  ? entry.from
                  : typeof entry.sender === "string"
                    ? entry.sender
                    : "teammate";
              const msgText =
                typeof entry.text === "string"
                  ? entry.text
                  : typeof entry.content === "string"
                    ? entry.content
                    : "";
              if (!msgText.trim()) continue;
              const summary =
                typeof entry.summary === "string" ? entry.summary : "";
              const time =
                typeof entry.timestamp === "string"
                  ? entry.timestamp
                  : typeof entry.time === "string"
                    ? entry.time
                    : "";
              rawInboxEntries.push({
                recipient,
                from,
                text: msgText,
                summary,
                time,
                ts: boardTimeMs(time),
                read: entry.read === true,
                ...(typeof entry.color === "string" && entry.color
                  ? { color: entry.color }
                  : {})
              });
            }
          }
        }

        rawInboxEntries.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
        const allNames = [...new Set([...memberNames, ...rawInboxEntries.map((e) => e.recipient)])];
        const edgeMap = new Map<string, AgentAuxEdge>();
        const messages: AgentAuxClaudeTeamMessage[] = rawInboxEntries
          .slice(-MAX_BOARD_MESSAGES)
          .map((entry, idx) => {
            const extracted = extractBoardMentions(entry.text, allNames);
            const mentions = [...new Set([entry.recipient, ...extracted.mentions])].filter(
              (n) => n !== entry.from
            );
            for (const to of mentions) {
              const key = `${entry.from}\0${to}`;
              const edge = edgeMap.get(key) ?? {
                from: entry.from,
                to,
                count: 0,
                direct: 0,
                viaAll: 0
              };
              edge.count += 1;
              edge.direct += 1;
              edgeMap.set(key, edge);
            }
            return {
              seq: idx + 1,
              agent: entry.from,
              recipient: entry.recipient,
              text: entry.text,
              summary: entry.summary,
              time: entry.time,
              ts: entry.ts,
              mentions,
              all: extracted.all,
              read: entry.read,
              ...(entry.color ? { color: entry.color } : {})
            };
          });

        matchedTeam = {
          teamName,
          description:
            typeof config.description === "string" ? config.description : "",
          leadSessionId,
          members,
          messages,
          edges: [...edgeMap.values()]
        };
        matchedTeamFolder = teamFolder;
        break;
      }
    }

    // Read shared tasks under ~/.claude/tasks/<teamOrSession>/*.json
    const taskBuckets = new Set<string>();
    if (matchedTeamFolder) taskBuckets.add(matchedTeamFolder);
    if (matchedTeam && SAFE_DIR_SEGMENT_RE.test(matchedTeam.teamName)) {
      taskBuckets.add(matchedTeam.teamName);
    }
    if (sessionId && SAFE_DIR_SEGMENT_RE.test(sessionId)) {
      taskBuckets.add(sessionId);
    }

    const tasksById = new Map<string, AgentAuxTaskItem>();
    const tasksRoot = join(claudeRoot, "tasks");
    const tasksRootStat = await safeStatAsync(tasksRoot);
    if (tasksRootStat?.isDirectory && (await isContainedInRootAsync(tasksRoot, claudeRoot))) {
      for (const bucket of taskBuckets) {
        const bucketDir = join(tasksRoot, bucket);
        const bucketStat = await safeStatAsync(bucketDir);
        if (!bucketStat?.isDirectory || !(await isContainedInRootAsync(bucketDir, claudeRoot))) {
          continue;
        }
        const taskFiles = [...(await this.readDirCached(bucketDir))].sort();
        for (const file of taskFiles) {
          if (!file.endsWith(".json")) continue;
          const parsed = await this.readCachedJsonObject(
            join(bucketDir, file),
            claudeRoot,
            MAX_TASK_BYTES
          );
          if (!parsed) continue;
          const id =
            typeof parsed.id === "string" || typeof parsed.id === "number"
              ? String(parsed.id)
              : file.slice(0, -5);
          const subject =
            typeof parsed.subject === "string" && parsed.subject.trim()
              ? parsed.subject.trim()
              : typeof parsed.title === "string" && parsed.title.trim()
                ? parsed.title.trim()
                : `任务 #${id}`;
          const rawStatus =
            typeof parsed.status === "string" ? parsed.status.toLowerCase() : "pending";
          const status: AgentAuxTaskItem["status"] =
            rawStatus === "completed" || rawStatus === "done"
              ? "completed"
              : rawStatus === "in_progress" || rawStatus === "running"
                ? "in_progress"
                : rawStatus === "blocked"
                  ? "blocked"
                  : "pending";
          const blockedBy = Array.isArray(parsed.blockedBy)
            ? parsed.blockedBy.map((x) => String(x))
            : [];
          const blocks = Array.isArray(parsed.blocks)
            ? parsed.blocks.map((x) => String(x))
            : [];
          tasksById.set(id, {
            id,
            subject,
            description:
              typeof parsed.description === "string" ? parsed.description : "",
            ...(typeof parsed.activeForm === "string" && parsed.activeForm
              ? { activeForm: parsed.activeForm }
              : {}),
            status:
              status === "pending" && blockedBy.length > 0 ? "blocked" : status,
            owner: typeof parsed.owner === "string" ? parsed.owner : "",
            blockedBy,
            blocks,
            source: "claude-tasks"
          });
        }
      }
    }

    return {
      team: matchedTeam,
      tasks: [...tasksById.values()]
    };
  }

  private async inspectCodex(
    sessionId: string | undefined,
    cwd: string | undefined
  ): Promise<AgentAuxCodexSnapshot | null> {
    const codexRoot = this.codexHomeDirOverride ?? join(homedir(), ".codex");
    const codexRootStat = await safeStatAsync(codexRoot);
    if (!codexRootStat?.isDirectory) return null;

    let spawnedThreads: AgentAuxCodexSpawnedThread[] = [];
    const relatedThreadIds = new Set<string>();
    if (sessionId) relatedThreadIds.add(sessionId);

    // 1. Read-only check state_5.sqlite for thread_spawn_edges + threads
    //    Short-circuits via async mtimeMs/size fingerprint (including -wal) to avoid
    //    reopening DatabaseSync when the SQLite file has not changed.
    const stateDbPath = join(codexRoot, "state_5.sqlite");
    if (sessionId) {
      const stateFingerprint = await computeSqliteFileFingerprint(stateDbPath);
      if (stateFingerprint !== null) {
        const stateCacheKey = `${stateDbPath}|${sessionId}`;
        const cachedState = this.codexStateCache.get(stateCacheKey);
        if (cachedState && cachedState.fingerprint === stateFingerprint) {
          spawnedThreads = cachedState.spawnedThreads;
          for (const tid of cachedState.relatedThreadIds) {
            relatedThreadIds.add(tid);
          }
        } else if (await isContainedInRootAsync(stateDbPath, codexRoot)) {
          let db: DatabaseSync | null = null;
          const queriedThreads: AgentAuxCodexSpawnedThread[] = [];
          const queriedIds = new Set<string>([sessionId]);
          try {
            db = this.openCodexDbFn(stateDbPath);
            let parentId = sessionId;
            const asChild = db
              .prepare(
                "SELECT parent_thread_id FROM thread_spawn_edges WHERE child_thread_id = ? LIMIT 1"
              )
              .get(sessionId) as { parent_thread_id?: string } | undefined;
            if (typeof asChild?.parent_thread_id === "string" && asChild.parent_thread_id) {
              parentId = asChild.parent_thread_id;
              queriedIds.add(parentId);
            }

            const rows = db
              .prepare(
                `SELECT e.parent_thread_id, e.child_thread_id, e.status,
                        t.title, t.agent_nickname, t.agent_role, t.model, t.reasoning_effort, t.cwd, t.updated_at_ms
                   FROM thread_spawn_edges e
                   LEFT JOIN threads t ON t.id = e.child_thread_id
                  WHERE e.parent_thread_id = ?
                  ORDER BY COALESCE(t.updated_at_ms, 0) DESC
                  LIMIT 64`
              )
              .all(parentId) as Array<Record<string, unknown>>;

            for (const row of rows) {
              const childId =
                typeof row.child_thread_id === "string" ? row.child_thread_id : "";
              if (!childId) continue;
              queriedIds.add(childId);
              queriedThreads.push({
                threadId: childId,
                parentThreadId:
                  typeof row.parent_thread_id === "string"
                    ? row.parent_thread_id
                    : parentId,
                status: typeof row.status === "string" ? row.status : "unknown",
                title: typeof row.title === "string" ? row.title : childId,
                nickname:
                  typeof row.agent_nickname === "string" ? row.agent_nickname : "",
                role: typeof row.agent_role === "string" ? row.agent_role : "",
                model: typeof row.model === "string" ? row.model : "",
                reasoningEffort:
                  typeof row.reasoning_effort === "string"
                    ? row.reasoning_effort
                    : "",
                cwd: typeof row.cwd === "string" ? row.cwd : "",
                updatedAtMs:
                  typeof row.updated_at_ms === "number" ? row.updated_at_ms : 0
              });
            }
            setBoundedCache(this.codexStateCache, stateCacheKey, {
              fingerprint: stateFingerprint,
              spawnedThreads: queriedThreads,
              relatedThreadIds: [...queriedIds]
            });
            spawnedThreads = queriedThreads;
            for (const tid of queriedIds) {
              relatedThreadIds.add(tid);
            }
          } catch {
            // Gracefully ignore missing tables or locked sqlite files.
          } finally {
            try {
              db?.close();
            } catch {
              // ignore close errors
            }
          }
        }
      }
    }

    // 2. Read-only check goals_1.sqlite for thread_goals (also mtimeMs/size short-circuited)
    let goals: AgentAuxCodexGoal[] = [];
    const goalsDbPath = join(codexRoot, "goals_1.sqlite");
    if (relatedThreadIds.size > 0) {
      const goalsFingerprint = await computeSqliteFileFingerprint(goalsDbPath);
      if (goalsFingerprint !== null) {
        const sortedIds = [...relatedThreadIds].sort();
        const goalsCacheKey = `${goalsDbPath}|${sortedIds.join(",")}`;
        const cachedGoals = this.codexGoalsCache.get(goalsCacheKey);
        if (cachedGoals && cachedGoals.fingerprint === goalsFingerprint) {
          goals = cachedGoals.goals;
        } else if (await isContainedInRootAsync(goalsDbPath, codexRoot)) {
          let db: DatabaseSync | null = null;
          const queriedGoals: AgentAuxCodexGoal[] = [];
          try {
            db = this.openCodexDbFn(goalsDbPath);
            const placeholders = sortedIds.map(() => "?").join(", ");
            const rows = db
              .prepare(
                `SELECT thread_id, goal_id, objective, status, token_budget, tokens_used,
                        time_used_seconds, created_at_ms, updated_at_ms
                   FROM thread_goals
                  WHERE thread_id IN (${placeholders})
                  ORDER BY updated_at_ms DESC`
              )
              .all(...sortedIds) as Array<Record<string, unknown>>;

            for (const row of rows) {
              const threadId = typeof row.thread_id === "string" ? row.thread_id : "";
              const goalId = typeof row.goal_id === "string" ? row.goal_id : "";
              const objective = typeof row.objective === "string" ? row.objective : "";
              if (!threadId || !objective) continue;
              const rawStatus = typeof row.status === "string" ? row.status : "active";
              const status: AgentAuxCodexGoal["status"] =
                rawStatus === "active" ||
                rawStatus === "paused" ||
                rawStatus === "blocked" ||
                rawStatus === "usage_limited" ||
                rawStatus === "budget_limited" ||
                rawStatus === "complete"
                  ? rawStatus
                  : "active";
              queriedGoals.push({
                threadId,
                goalId,
                objective,
                status,
                tokenBudget:
                  typeof row.token_budget === "number" ? row.token_budget : null,
                tokensUsed: typeof row.tokens_used === "number" ? row.tokens_used : 0,
                timeUsedSeconds:
                  typeof row.time_used_seconds === "number"
                    ? row.time_used_seconds
                    : 0,
                createdAtMs:
                  typeof row.created_at_ms === "number" ? row.created_at_ms : 0,
                updatedAtMs:
                  typeof row.updated_at_ms === "number" ? row.updated_at_ms : 0
              });
            }
            setBoundedCache(this.codexGoalsCache, goalsCacheKey, {
              fingerprint: goalsFingerprint,
              goals: queriedGoals
            });
            goals = queriedGoals;
          } catch {
            // Gracefully ignore missing tables or locked sqlite files.
          } finally {
            try {
              db?.close();
            } catch {
              // ignore close errors
            }
          }
        }
      }
    }

    // If cwd was given without sessionId and no threads found, stay strictly inactive (never leak unrelated sessions).
    void cwd;

    if (goals.length === 0 && spawnedThreads.length === 0) {
      return null;
    }

    return { goals, spawnedThreads };
  }
}
