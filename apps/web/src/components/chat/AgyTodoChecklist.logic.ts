import type {
  OrchestrationV2PlanArtifact,
  OrchestrationV2PlanStep,
} from "@prismux/core-contracts";
import type { WorkLogEntry } from "../../session-logic";

export type AgyTodoStepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export interface AgyTodoStep {
  readonly id: string;
  readonly title: string;
  readonly status: AgyTodoStepStatus;
}

/** Structural turn-item slice accepted by `extractActiveTodoChecklist` (supports both full `OrchestrationV2TurnItem` and lightweight `ThreadStructureTurnItem`). */
export type AgyTodoTurnItemLike =
  | {
      readonly id: string;
      readonly type: "todo_list";
      readonly planId: string;
      readonly steps: ReadonlyArray<OrchestrationV2PlanStep>;
      readonly explanation?: string | undefined;
    }
  | {
      readonly id: string;
      readonly type: "dynamic_tool";
      readonly title?: string | null | undefined;
      readonly toolName?: string | null | undefined;
      readonly input?: unknown;
      readonly output?: unknown;
    }
  | {
      readonly id: string;
      readonly type: string;
    };

export interface AgyTodoChecklistInput {
  readonly plans?: ReadonlyArray<OrchestrationV2PlanArtifact> | null | undefined;
  readonly turnItems?: ReadonlyArray<AgyTodoTurnItemLike> | null | undefined;
  readonly workEntries?: ReadonlyArray<WorkLogEntry> | null | undefined;
  readonly turnStartedAtMs?: number | null | undefined;
  readonly nowMs?: number | undefined;
  readonly isTurnWorking?: boolean | undefined;
}

export interface AgyTodoChecklistSnapshot {
  readonly source: "plan" | "turn_item" | "dynamic_tool";
  readonly planId?: string | undefined;
  readonly explanation?: string | undefined;
  readonly steps: ReadonlyArray<AgyTodoStep>;
  readonly completedCount: number;
  readonly inProgressCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly pendingCount: number;
  readonly totalCount: number;
  readonly progressRatio: number;
  readonly allCompleted: boolean;
  readonly hasActiveWork: boolean;
  readonly elapsedLabelZh: string;
  readonly stepCountLabelZh: string;
  readonly summaryPillZh: string;
}

export const AGY_TODO_COPY_ZH = {
  regionName: "任务进度清单",
} as const;

const TODO_DYNAMIC_TOOL_NAMES = new Set([
  "todo",
  "todos",
  "todowrite",
  "todo_write",
  "update_plan",
  "updateplan",
  "update_steps",
  "updatesteps",
  "write_todos",
  "writetodos",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeAgyTodoToolName(raw: string): string {
  const stripped = raw
    .trim()
    .replace(/^run(?:ning)?\s+/iu, "")
    .replace(/\?+$/u, "")
    .trim();
  const tail = stripped.split(/(?:__|[./:])/u).at(-1) ?? stripped;
  return tail
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, "_");
}

export function isTodoDynamicToolName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return TODO_DYNAMIC_TOOL_NAMES.has(normalizeAgyTodoToolName(raw));
}

export function normalizeAgyTodoStepStatus(raw: unknown): AgyTodoStepStatus {
  if (typeof raw !== "string") return "pending";
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  switch (normalized) {
    case "completed":
    case "complete":
    case "done":
    case "finished":
    case "success":
    case "succeeded":
      return "completed";
    case "in_progress":
    case "inprogress":
    case "running":
    case "active":
    case "working":
    case "started":
      return "in_progress";
    case "failed":
    case "error":
    case "errored":
      return "failed";
    case "skipped":
    case "cancelled":
    case "canceled":
    case "omitted":
      return "skipped";
    default:
      return "pending";
  }
}

export function formatAgyElapsedZh(elapsedMs: number): string {
  const clampedMs = Math.max(0, Math.floor(elapsedMs));
  const totalSeconds = Math.floor(clampedMs / 1000);
  if (totalSeconds < 60) {
    return `已进行 ${Math.max(1, totalSeconds)}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `已进行 ${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `已进行 ${hours}h ${minutes}m` : `已进行 ${hours}h`;
}

function mapPlanSteps(steps: ReadonlyArray<OrchestrationV2PlanStep>): AgyTodoStep[] {
  const mapped: AgyTodoStep[] = [];
  for (const [index, step] of steps.entries()) {
    const title = step.text.trim();
    if (!title) continue;
    mapped.push({
      id: step.id.trim() || `step-${index + 1}`,
      title,
      status: normalizeAgyTodoStepStatus(step.status),
    });
  }
  return mapped;
}

function parseDynamicTodoStep(entry: unknown, index: number): AgyTodoStep | null {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    const checkbox = /^(?:[-*+]\s+)?\[([ xX~!/-])\]\s+(.+)$/u.exec(trimmed);
    if (checkbox) {
      const marker = checkbox[1]?.toLowerCase() ?? " ";
      const title = checkbox[2]?.trim() ?? "";
      if (!title) return null;
      const status: AgyTodoStepStatus =
        marker === "x"
          ? "completed"
          : marker === "/" || marker === "~"
            ? "in_progress"
            : marker === "!"
              ? "failed"
              : marker === "-"
                ? "skipped"
                : "pending";
      return { id: `todo-step-${index + 1}`, title, status };
    }
    return { id: `todo-step-${index + 1}`, title: trimmed, status: "pending" };
  }
  if (!isRecord(entry)) return null;
  const title =
    asNonEmptyString(entry.title) ??
    asNonEmptyString(entry.content) ??
    asNonEmptyString(entry.step) ??
    asNonEmptyString(entry.text) ??
    asNonEmptyString(entry.task) ??
    asNonEmptyString(entry.description) ??
    asNonEmptyString(entry.subject) ??
    asNonEmptyString(entry.label) ??
    asNonEmptyString(entry.activeForm);
  if (!title) return null;
  const rawStatus =
    asNonEmptyString(entry.status) ??
    asNonEmptyString(entry.state) ??
    (entry.failed === true
      ? "failed"
      : entry.skipped === true || entry.cancelled === true || entry.canceled === true
        ? "skipped"
        : entry.completed === true || entry.done === true
          ? "completed"
          : entry.inProgress === true || entry.in_progress === true
            ? "in_progress"
            : "pending");
  const id = asNonEmptyString(entry.id) ?? `todo-step-${index + 1}`;
  return {
    id,
    title,
    status: normalizeAgyTodoStepStatus(rawStatus),
  };
}

function extractDynamicTodoPayload(container: unknown): {
  readonly steps: AgyTodoStep[];
  readonly explanation?: string;
} | null {
  if (Array.isArray(container)) {
    const steps = container
      .map((entry, index) => parseDynamicTodoStep(entry, index))
      .filter((step): step is AgyTodoStep => step !== null);
    return steps.length > 0 ? { steps } : null;
  }
  if (typeof container === "string") {
    const trimmed = container.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return extractDynamicTodoPayload(JSON.parse(trimmed));
      } catch {
        return null;
      }
    }
    return null;
  }
  if (!isRecord(container)) return null;
  const explanation =
    asNonEmptyString(container.explanation) ??
    asNonEmptyString(container.summary) ??
    asNonEmptyString(container.note);
  for (const key of ["todos", "steps", "plan", "items", "tasks", "entries"] as const) {
    const candidate = container[key];
    if (candidate === undefined) continue;
    const parsed = extractDynamicTodoPayload(candidate);
    if (parsed && parsed.steps.length > 0) {
      return explanation && !parsed.explanation ? { ...parsed, explanation } : parsed;
    }
  }
  // Check nested structuredContent / input / output envelopes
  for (const wrapperKey of ["structuredContent", "input", "args", "output", "result"] as const) {
    const wrapped = container[wrapperKey];
    if (wrapped !== undefined) {
      const parsed = extractDynamicTodoPayload(wrapped);
      if (parsed && parsed.steps.length > 0) {
        return explanation && !parsed.explanation ? { ...parsed, explanation } : parsed;
      }
    }
  }
  return null;
}

function buildSnapshot(input: {
  readonly source: AgyTodoChecklistSnapshot["source"];
  readonly planId?: string | undefined;
  readonly explanation?: string | undefined;
  readonly steps: ReadonlyArray<AgyTodoStep>;
  readonly turnStartedAtMs?: number | null | undefined;
  readonly nowMs?: number | undefined;
  readonly isTurnWorking?: boolean | undefined;
}): AgyTodoChecklistSnapshot | null {
  if (input.steps.length === 0) return null;
  let completedCount = 0;
  let inProgressCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let pendingCount = 0;
  for (const step of input.steps) {
    switch (step.status) {
      case "completed":
        completedCount += 1;
        break;
      case "in_progress":
        inProgressCount += 1;
        break;
      case "failed":
        failedCount += 1;
        break;
      case "skipped":
        skippedCount += 1;
        break;
      case "pending":
        pendingCount += 1;
        break;
    }
  }
  const totalCount = input.steps.length;
  const progressRatio = Math.max(0, Math.min(1, completedCount / totalCount));
  const allCompleted =
    totalCount > 0 &&
    inProgressCount === 0 &&
    pendingCount === 0 &&
    failedCount === 0 &&
    completedCount + skippedCount === totalCount &&
    completedCount > 0;
  const hasActiveWork = inProgressCount > 0 || (input.isTurnWorking === true && !allCompleted);

  let elapsedLabelZh: string;
  if (hasActiveWork) {
    if (
      typeof input.turnStartedAtMs === "number" &&
      Number.isFinite(input.turnStartedAtMs)
    ) {
      const nowMs = input.nowMs ?? Date.now();
      elapsedLabelZh = formatAgyElapsedZh(Math.max(0, nowMs - input.turnStartedAtMs));
    } else {
      elapsedLabelZh = "进行中";
    }
  } else if (allCompleted) {
    elapsedLabelZh = "已完成";
  } else if (failedCount > 0) {
    elapsedLabelZh = "部分失败";
  } else {
    elapsedLabelZh = "任务清单";
  }

  const stepCountLabelZh = `${completedCount}/${totalCount} 步`;
  const summaryPillZh = `${elapsedLabelZh} · ${stepCountLabelZh}`;

  return {
    source: input.source,
    ...(input.planId === undefined ? {} : { planId: input.planId }),
    ...(input.explanation === undefined ? {} : { explanation: input.explanation }),
    steps: input.steps,
    completedCount,
    inProgressCount,
    failedCount,
    skippedCount,
    pendingCount,
    totalCount,
    progressRatio,
    allCompleted,
    hasActiveWork,
    elapsedLabelZh,
    stepCountLabelZh,
    summaryPillZh,
  };
}

export function extractTodoChecklistFromTurnItem(
  item: AgyTodoTurnItemLike,
  options?: {
    readonly turnStartedAtMs?: number | null | undefined;
    readonly nowMs?: number | undefined;
    readonly isTurnWorking?: boolean | undefined;
  },
): AgyTodoChecklistSnapshot | null {
  if (item.type === "todo_list" && "steps" in item && Array.isArray(item.steps)) {
    return buildSnapshot({
      source: "turn_item",
      planId: String(item.planId),
      explanation: item.explanation,
      steps: mapPlanSteps(item.steps),
      ...options,
    });
  }
  if (item.type === "dynamic_tool") {
    const dynamicItem = item as Extract<AgyTodoTurnItemLike, { readonly type: "dynamic_tool" }>;
    const toolMatch =
      isTodoDynamicToolName(dynamicItem.toolName) || isTodoDynamicToolName(dynamicItem.title);
    if (!toolMatch) return null;
    const parsed =
      extractDynamicTodoPayload(dynamicItem.input) ?? extractDynamicTodoPayload(dynamicItem.output);
    if (!parsed) return null;
    return buildSnapshot({
      source: "dynamic_tool",
      planId: String(dynamicItem.id),
      explanation: parsed.explanation,
      steps: parsed.steps,
      ...options,
    });
  }
  return null;
}

export function extractTodoChecklistFromWorkEntry(
  entry: WorkLogEntry,
  options?: {
    readonly turnStartedAtMs?: number | null | undefined;
    readonly nowMs?: number | undefined;
    readonly isTurnWorking?: boolean | undefined;
  },
): AgyTodoChecklistSnapshot | null {
  if (entry.structuredPayload) {
    const fromPayload = extractTodoChecklistFromTurnItem(entry.structuredPayload, options);
    if (fromPayload) return fromPayload;
  }
  if (entry.projectedItem?.item) {
    const fromProjected = extractTodoChecklistFromTurnItem(entry.projectedItem.item, options);
    if (fromProjected) return fromProjected;
  }
  const toolMatch =
    entry.itemType === "todo_list" ||
    isTodoDynamicToolName(entry.toolTitle) ||
    isTodoDynamicToolName(entry.label);
  if (!toolMatch) return null;
  const parsed = extractDynamicTodoPayload(entry.toolData);
  if (!parsed) return null;
  return buildSnapshot({
    source: "dynamic_tool",
    planId: entry.id,
    explanation: parsed.explanation,
    steps: parsed.steps,
    ...options,
  });
}

/**
 * Extracts the active AGY-style todo checklist snapshot with strict priority:
 * 1. Latest non-superseded `todo_list` plan in `projection.plans`
 * 2. Latest `todo_list` turn item in `projection.turnItems`
 * 3. Fallback structured `dynamic_tool` payload (`TodoWrite` / `todowrite` / `todo_write` / `todo` / `update_plan` / `update_steps` / `write_todos`)
 */
export function extractActiveTodoChecklist(
  input: AgyTodoChecklistInput,
): AgyTodoChecklistSnapshot | null {
  const timing = {
    turnStartedAtMs: input.turnStartedAtMs,
    nowMs: input.nowMs,
    isTurnWorking: input.isTurnWorking,
  };

  // Priority 1: Latest non-superseded todo_list plan
  const plans = input.plans ?? [];
  for (let index = plans.length - 1; index >= 0; index -= 1) {
    const plan = plans[index];
    if (plan && plan.kind === "todo_list" && plan.status !== "superseded" && plan.steps.length > 0) {
      const snapshot = buildSnapshot({
        source: "plan",
        planId: String(plan.id),
        explanation: plan.explanation,
        steps: mapPlanSteps(plan.steps),
        ...timing,
      });
      if (snapshot) return snapshot;
    }
  }

  // Priority 2: Latest todo_list turn item
  const turnItems = input.turnItems ?? [];
  for (let index = turnItems.length - 1; index >= 0; index -= 1) {
    const item = turnItems[index];
    if (item && item.type === "todo_list" && "steps" in item && item.steps.length > 0) {
      const snapshot = extractTodoChecklistFromTurnItem(item, timing);
      if (snapshot) return snapshot;
    }
  }

  // Priority 3: Fallback structured dynamic_tool payloads in turnItems & workEntries
  for (let index = turnItems.length - 1; index >= 0; index -= 1) {
    const item = turnItems[index];
    if (item && item.type === "dynamic_tool") {
      const snapshot = extractTodoChecklistFromTurnItem(item, timing);
      if (snapshot) return snapshot;
    }
  }

  const workEntries = input.workEntries ?? [];
  for (let index = workEntries.length - 1; index >= 0; index -= 1) {
    const entry = workEntries[index];
    if (!entry) continue;
    const snapshot = extractTodoChecklistFromWorkEntry(entry, timing);
    if (snapshot) return snapshot;
  }

  return null;
}
