import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_BUILTIN_PURGE_RULES,
  compilePurgeRule,
  type CompiledPurgeRule,
  type PurgeAction,
  type PurgeRule
} from "./rules.js";

export class PurgeSnapshotNotFoundError extends Error {
  readonly snapshotId: string;

  constructor(snapshotId: string) {
    super(`Prompt snapshot "${snapshotId}" does not exist.`);
    this.name = "PurgeSnapshotNotFoundError";
    this.snapshotId = snapshotId;
  }
}

export class PurgeSnapshotIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurgeSnapshotIntegrityError";
  }
}

export interface PromptSnapshotMetadata {
  scopeId?: string;
  label?: string;
  source?: string;
  createdAt?: number;
}

export interface PromptSnapshot {
  readonly snapshotId: string;
  readonly version: number;
  readonly scopeId: string;
  readonly prompt: string;
  readonly contentHash: string;
  readonly label?: string;
  readonly source?: string;
  readonly createdAt: number;
}

export interface PurgeMatchInfo {
  ruleId: string;
  action: PurgeAction;
  description?: string;
  matchCount: number;
}

export interface PurgePromptOptions {
  scopeId?: string;
  snapshotId?: string;
  captureSnapshot?: boolean;
  rollbackTargetSnapshotId?: string;
  source?: string;
  label?: string;
}

export interface PurgeResult {
  decision: "allow" | PurgeAction;
  blocked: boolean;
  rollbackTriggered: boolean;
  snapshotId: string | null;
  restoredSnapshotId?: string;
  restoredPrompt?: string;
  originalHash: string;
  sanitizedPrompt: string | null;
  matchedRules: PurgeMatchInfo[];
  redactionCount: number;
  feedback?: string;
}

export interface RollbackResult {
  snapshotId: string;
  version: number;
  scopeId: string;
  prompt: string;
  contentHash: string;
  rolledBackAt: number;
  snapshot: PromptSnapshot;
}

export interface PurgeAuditEntry {
  readonly id: string;
  readonly eventType: "snapshot" | "purge" | "rollback";
  readonly scopeId: string;
  readonly snapshotId: string;
  readonly decision?: "allow" | PurgeAction;
  readonly matchedRuleIds: readonly string[];
  readonly redactionCount: number;
  readonly restoredFromSnapshotId?: string;
  readonly reason?: string;
  readonly timestamp: number;
}

export interface PromptPurgeEngineOptions {
  builtinRules?: boolean;
  customRules?: PurgeRule[];
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function cloneFrozenSnapshot(snapshot: PromptSnapshot): PromptSnapshot {
  return Object.freeze({ ...snapshot });
}

function cloneFrozenAuditEntry(entry: PurgeAuditEntry): PurgeAuditEntry {
  return Object.freeze({
    ...entry,
    matchedRuleIds: Object.freeze([...entry.matchedRuleIds])
  });
}

function countMatches(regex: RegExp, input: string): number {
  const fresh = new RegExp(regex.source, regex.flags);
  const matches = input.match(fresh);
  return matches === null ? 0 : matches.length;
}

/**
 * Prompt sanitization engine with built-in/custom `redact | block | rollback` rules,
 * immutable versioned snapshots, and a red-team rollback audit stack.
 */
export class PromptPurgeEngine {
  private readonly rules = new Map<string, CompiledPurgeRule>();
  private readonly snapshots = new Map<string, PromptSnapshot>();
  private readonly scopeVersions = new Map<string, number>();
  private readonly scopeSnapshotIds = new Map<string, string[]>();
  private readonly cleanBaselineByScope = new Map<string, string[]>();
  private readonly auditHistory: PurgeAuditEntry[] = [];
  private readonly rollbackStack: PurgeAuditEntry[] = [];
  private snapshotSeq = 0;
  private auditSeq = 0;
  private disposed = false;

  constructor(options: PromptPurgeEngineOptions = {}) {
    if (options.builtinRules !== false) {
      for (const rule of DEFAULT_BUILTIN_PURGE_RULES) {
        this.addRule(rule);
      }
    }
    if (options.customRules !== undefined) {
      for (const rule of options.customRules) {
        this.addRule(rule);
      }
    }
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  addRule(rule: PurgeRule): void {
    const compiled = compilePurgeRule(rule);
    this.rules.set(compiled.rule.id, compiled);
  }

  removeRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  listRules(): PurgeRule[] {
    return this.getOrderedCompiledRules().map((entry) => ({ ...entry.rule }));
  }

  /**
   * Captures an immutable, SHA-256-sealed snapshot of the original prompt.
   */
  createSnapshot(
    prompt: string,
    metadata: PromptSnapshotMetadata = {}
  ): PromptSnapshot {
    return this.createSnapshotInternal(prompt, metadata, true);
  }

  getSnapshot(snapshotId: string): PromptSnapshot | undefined {
    const existing = this.snapshots.get(snapshotId);
    return existing === undefined ? undefined : cloneFrozenSnapshot(existing);
  }

  listSnapshots(scopeId?: string): PromptSnapshot[] {
    if (scopeId !== undefined) {
      const ids = this.scopeSnapshotIds.get(scopeId) ?? [];
      return ids
        .map((id) => this.snapshots.get(id))
        .filter((item): item is PromptSnapshot => item !== undefined)
        .map((item) => cloneFrozenSnapshot(item));
    }
    return Array.from(this.snapshots.values()).map((item) =>
      cloneFrozenSnapshot(item)
    );
  }

  /**
   * Evaluates `rollback`, `block`, and `redact` rules against `prompt` while preserving
   * an immutable pre-purge snapshot and recording full audit history.
   */
  purgePrompt(
    prompt: string,
    options: PurgePromptOptions = {}
  ): PurgeResult {
    if (typeof prompt !== "string") {
      throw new TypeError("Prompt input must be a string.");
    }

    const scopeId = options.scopeId ?? "default";
    const originalHash = sha256Hex(prompt);

    let activeSnapshotId: string | null = null;
    if (options.snapshotId !== undefined) {
      const existing = this.snapshots.get(options.snapshotId);
      if (existing === undefined) {
        throw new PurgeSnapshotNotFoundError(options.snapshotId);
      }
      activeSnapshotId = existing.snapshotId;
    } else if (options.captureSnapshot !== false) {
      // Do not mark auto-captured pre-purge prompt as a clean baseline until rules verify it.
      const captured = this.createSnapshotInternal(
        prompt,
        {
          scopeId,
          ...(options.label !== undefined ? { label: options.label } : {}),
          ...(options.source !== undefined ? { source: options.source } : {})
        },
        false
      );
      activeSnapshotId = captured.snapshotId;
    }

    const orderedRules = this.getOrderedCompiledRules().filter(
      (entry) => entry.rule.enabled !== false
    );

    const rollbackMatches: PurgeMatchInfo[] = [];
    const blockMatches: PurgeMatchInfo[] = [];
    const redactMatches: PurgeMatchInfo[] = [];

    let workingPrompt = prompt;
    let redactionCount = 0;

    for (const entry of orderedRules) {
      if (entry.rule.action === "rollback") {
        if (entry.testRegex.test(prompt)) {
          rollbackMatches.push({
            ruleId: entry.rule.id,
            action: "rollback",
            ...(entry.rule.description !== undefined
              ? { description: entry.rule.description }
              : {}),
            matchCount: countMatches(entry.replaceRegex, prompt)
          });
        }
        continue;
      }

      if (entry.rule.action === "block") {
        if (entry.testRegex.test(prompt)) {
          blockMatches.push({
            ruleId: entry.rule.id,
            action: "block",
            ...(entry.rule.description !== undefined
              ? { description: entry.rule.description }
              : {}),
            matchCount: countMatches(entry.replaceRegex, prompt)
          });
        }
        continue;
      }

      // `redact`
      const hits = countMatches(entry.replaceRegex, workingPrompt);
      if (hits > 0) {
        const freshReplace = new RegExp(
          entry.replaceRegex.source,
          entry.replaceRegex.flags
        );
        workingPrompt = workingPrompt.replace(freshReplace, entry.replacement);
        redactionCount += hits;
        redactMatches.push({
          ruleId: entry.rule.id,
          action: "redact",
          ...(entry.rule.description !== undefined
            ? { description: entry.rule.description }
            : {}),
          matchCount: hits
        });
      }
    }

    const allMatched = [...rollbackMatches, ...blockMatches, ...redactMatches];

    if (rollbackMatches.length > 0) {
      const targetSnapshotId = this.resolveRollbackTargetSnapshotId(
        scopeId,
        options.rollbackTargetSnapshotId,
        activeSnapshotId
      );

      let restoredPrompt: string | undefined;
      let resolvedTargetId: string | undefined;
      if (targetSnapshotId !== undefined) {
        const rollbackResult = this.rollbackToSnapshot(
          targetSnapshotId,
          `Triggered by rule(s): ${rollbackMatches.map((m) => m.ruleId).join(", ")}`
        );
        resolvedTargetId = rollbackResult.snapshotId;
        restoredPrompt = rollbackResult.prompt;
      }

      this.appendAuditEntry({
        eventType: "purge",
        scopeId,
        snapshotId: activeSnapshotId ?? resolvedTargetId ?? "none",
        decision: "rollback",
        matchedRuleIds: allMatched.map((m) => m.ruleId),
        redactionCount,
        ...(resolvedTargetId !== undefined
          ? { restoredFromSnapshotId: resolvedTargetId }
          : {}),
        reason: rollbackMatches
          .map((m) => m.description ?? m.ruleId)
          .join("; ")
      });

      return {
        decision: "rollback",
        blocked: true,
        rollbackTriggered: true,
        snapshotId: activeSnapshotId,
        ...(resolvedTargetId !== undefined
          ? { restoredSnapshotId: resolvedTargetId }
          : {}),
        ...(restoredPrompt !== undefined ? { restoredPrompt } : {}),
        originalHash,
        sanitizedPrompt: null,
        matchedRules: allMatched,
        redactionCount,
        feedback: `检测到红队毒化或回滚触发模式（${rollbackMatches.map((m) => m.ruleId).join(", ")}），已阻断并触发版本回退`
      };
    }

    if (blockMatches.length > 0) {
      this.appendAuditEntry({
        eventType: "purge",
        scopeId,
        snapshotId: activeSnapshotId ?? "none",
        decision: "block",
        matchedRuleIds: allMatched.map((m) => m.ruleId),
        redactionCount,
        reason: blockMatches.map((m) => m.description ?? m.ruleId).join("; ")
      });

      return {
        decision: "block",
        blocked: true,
        rollbackTriggered: false,
        snapshotId: activeSnapshotId,
        originalHash,
        sanitizedPrompt: null,
        matchedRules: allMatched,
        redactionCount,
        feedback: `拦截到危险提示词注入或越狱模式（${blockMatches.map((m) => m.ruleId).join(", ")}）`
      };
    }

    if (redactionCount > 0) {
      this.appendAuditEntry({
        eventType: "purge",
        scopeId,
        snapshotId: activeSnapshotId ?? "none",
        decision: "redact",
        matchedRuleIds: redactMatches.map((m) => m.ruleId),
        redactionCount,
        reason: `脱敏 ${redactionCount} 处敏感凭据或私钥内容`
      });

      return {
        decision: "redact",
        blocked: false,
        rollbackTriggered: false,
        snapshotId: activeSnapshotId,
        originalHash,
        sanitizedPrompt: workingPrompt,
        matchedRules: redactMatches,
        redactionCount,
        feedback: `已完成 ${redactionCount} 处敏感信息正则脱敏`
      };
    }

    // Clean prompt can safely serve as a baseline target for future rollbacks.
    if (activeSnapshotId !== null) {
      this.markCleanBaseline(scopeId, activeSnapshotId);
    }

    this.appendAuditEntry({
      eventType: "purge",
      scopeId,
      snapshotId: activeSnapshotId ?? "none",
      decision: "allow",
      matchedRuleIds: [],
      redactionCount: 0
    });

    return {
      decision: "allow",
      blocked: false,
      rollbackTriggered: false,
      snapshotId: activeSnapshotId,
      originalHash,
      sanitizedPrompt: prompt,
      matchedRules: [],
      redactionCount: 0
    };
  }

  /**
   * Restores the exact original un-tampered prompt from an immutable snapshot
   * and pushes a record onto the red-team rollback stack & audit history.
   */
  rollbackToSnapshot(snapshotId: string, reason?: string): RollbackResult {
    const snapshot = this.snapshots.get(snapshotId);
    if (snapshot === undefined) {
      throw new PurgeSnapshotNotFoundError(snapshotId);
    }

    const actualHash = sha256Hex(snapshot.prompt);
    if (actualHash !== snapshot.contentHash) {
      throw new PurgeSnapshotIntegrityError(
        `Snapshot "${snapshotId}" integrity check failed.`
      );
    }

    const auditEntry = this.appendAuditEntry({
      eventType: "rollback",
      scopeId: snapshot.scopeId,
      snapshotId: snapshot.snapshotId,
      decision: "rollback",
      matchedRuleIds: [],
      redactionCount: 0,
      restoredFromSnapshotId: snapshot.snapshotId,
      ...(reason !== undefined && reason.trim().length > 0
        ? { reason: reason.trim() }
        : { reason: `回滚至版本快照 v${snapshot.version} (${snapshot.snapshotId})` })
    });
    this.rollbackStack.push(auditEntry);

    return {
      snapshotId: snapshot.snapshotId,
      version: snapshot.version,
      scopeId: snapshot.scopeId,
      prompt: snapshot.prompt,
      contentHash: snapshot.contentHash,
      rolledBackAt: auditEntry.timestamp,
      snapshot: cloneFrozenSnapshot(snapshot)
    };
  }

  getRollbackStack(scopeId?: string): PurgeAuditEntry[] {
    const filtered =
      scopeId === undefined
        ? this.rollbackStack
        : this.rollbackStack.filter((entry) => entry.scopeId === scopeId);
    return filtered.map((entry) => cloneFrozenAuditEntry(entry));
  }

  getAuditHistory(limit?: number): PurgeAuditEntry[] {
    const source =
      limit !== undefined && limit >= 0
        ? this.auditHistory.slice(-limit)
        : this.auditHistory;
    return source.map((entry) => cloneFrozenAuditEntry(entry));
  }

  dispose(): void {
    this.disposed = true;
  }

  private createSnapshotInternal(
    prompt: string,
    metadata: PromptSnapshotMetadata,
    markBaseline: boolean
  ): PromptSnapshot {
    if (typeof prompt !== "string") {
      throw new TypeError("Snapshot prompt must be a string.");
    }
    const scopeId = metadata.scopeId ?? "default";
    const nextVersion = (this.scopeVersions.get(scopeId) ?? 0) + 1;
    this.scopeVersions.set(scopeId, nextVersion);

    this.snapshotSeq += 1;
    const snapshotId = `snap-${nextVersion}-${this.snapshotSeq}-${randomUUID().slice(0, 8)}`;
    const snapshot: PromptSnapshot = Object.freeze({
      snapshotId,
      version: nextVersion,
      scopeId,
      prompt,
      contentHash: sha256Hex(prompt),
      ...(metadata.label !== undefined ? { label: metadata.label } : {}),
      ...(metadata.source !== undefined ? { source: metadata.source } : {}),
      createdAt: metadata.createdAt ?? Date.now()
    });

    this.snapshots.set(snapshotId, snapshot);
    const ids = this.scopeSnapshotIds.get(scopeId) ?? [];
    ids.push(snapshotId);
    this.scopeSnapshotIds.set(scopeId, ids);

    if (markBaseline) {
      this.markCleanBaseline(scopeId, snapshotId);
    }

    this.appendAuditEntry({
      eventType: "snapshot",
      scopeId,
      snapshotId,
      matchedRuleIds: [],
      redactionCount: 0,
      ...(metadata.label !== undefined ? { reason: metadata.label } : {})
    });

    return cloneFrozenSnapshot(snapshot);
  }

  private markCleanBaseline(scopeId: string, snapshotId: string): void {
    const list = this.cleanBaselineByScope.get(scopeId) ?? [];
    if (!list.includes(snapshotId)) {
      list.push(snapshotId);
      this.cleanBaselineByScope.set(scopeId, list);
    }
  }

  private resolveRollbackTargetSnapshotId(
    scopeId: string,
    explicitTargetId: string | undefined,
    excludeSnapshotId: string | null
  ): string | undefined {
    if (explicitTargetId !== undefined) {
      if (!this.snapshots.has(explicitTargetId)) {
        throw new PurgeSnapshotNotFoundError(explicitTargetId);
      }
      return explicitTargetId;
    }

    const cleanBaselines = this.cleanBaselineByScope.get(scopeId) ?? [];
    for (let i = cleanBaselines.length - 1; i >= 0; i -= 1) {
      const candidate = cleanBaselines[i];
      if (candidate !== undefined && candidate !== excludeSnapshotId) {
        return candidate;
      }
    }

    const allScopeIds = this.scopeSnapshotIds.get(scopeId) ?? [];
    for (let i = allScopeIds.length - 1; i >= 0; i -= 1) {
      const candidate = allScopeIds[i];
      if (candidate !== undefined && candidate !== excludeSnapshotId) {
        return candidate;
      }
    }

    return excludeSnapshotId ?? undefined;
  }

  private appendAuditEntry(
    input: Omit<PurgeAuditEntry, "id" | "timestamp">
  ): PurgeAuditEntry {
    this.auditSeq += 1;
    const entry: PurgeAuditEntry = Object.freeze({
      id: `audit-${this.auditSeq}-${randomUUID().slice(0, 6)}`,
      timestamp: Date.now(),
      ...input,
      matchedRuleIds: Object.freeze([...input.matchedRuleIds])
    });
    this.auditHistory.push(entry);
    return entry;
  }

  private getOrderedCompiledRules(): CompiledPurgeRule[] {
    return Array.from(this.rules.values()).sort(
      (a, b) => (a.rule.priority ?? 100) - (b.rule.priority ?? 100)
    );
  }
}
