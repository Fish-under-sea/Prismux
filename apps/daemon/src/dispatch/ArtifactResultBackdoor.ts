import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import type {
  AntigravityGuardDecision,
  DispatchArtifactDiffStats,
  DispatchTaskArtifact
} from "@prismux/protocol";
import {
  AntigravityGuardDeniedError,
  AntigravityPolicyGuard
} from "../security/AntigravityPolicyGuard.js";
import { sanitizeChildEnv } from "../t3/T3ServerSupervisor.js";

export interface ArtifactExtractionInput {
  taskId: string;
  threadId: string;
  workspacePath: string;
  finalAssistantText?: string;
  modifiedFiles?: readonly string[];
  diffStats?: DispatchArtifactDiffStats;
  provider?: string;
  modelId?: string;
  branchName?: string;
  commitSha?: string;
  testPassed?: boolean;
  baseRef?: string;
  skipGitInspection?: boolean;
}

export interface ArtifactResultBackdoorOptions {
  policyGuard?: AntigravityPolicyGuard;
  now?: () => number;
}

interface GitDiffSnapshot {
  modifiedFiles: string[];
  diffStats: DispatchArtifactDiffStats;
}

function runGitSafe(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      env: sanitizeChildEnv(process.env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch {
    return null;
  }
}

function parseNumstatOutput(raw: string): {
  files: string[];
  insertions: number;
  deletions: number;
} {
  const files: string[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const addRaw = parts[0]!;
    const delRaw = parts[1]!;
    const filePath = parts.slice(2).join("\t").trim();
    if (filePath.length > 0) {
      files.push(filePath);
    }
    if (/^\d+$/.test(addRaw)) {
      insertions += Number.parseInt(addRaw, 10);
    }
    if (/^\d+$/.test(delRaw)) {
      deletions += Number.parseInt(delRaw, 10);
    }
  }
  return { files, insertions, deletions };
}

function parsePorcelainUntracked(raw: string): string[] {
  const files: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    const pathPart = line.slice(3).trim();
    if (status === "??" && pathPart.length > 0) {
      files.push(pathPart);
    }
  }
  return files;
}

function inspectWorkspaceGitDiff(
  workspacePath: string,
  baseRef?: string
): GitDiffSnapshot | null {
  if (!workspacePath || !existsSync(workspacePath)) {
    return null;
  }
  const inside = runGitSafe(workspacePath, [
    "rev-parse",
    "--is-inside-work-tree"
  ]);
  if (inside?.trim() !== "true") {
    return null;
  }

  // 1. Inspect uncommitted working-tree + staged diff against HEAD (or empty index).
  const workingNumstat =
    runGitSafe(workspacePath, ["diff", "--numstat", "HEAD"]) ??
    runGitSafe(workspacePath, ["diff", "--numstat"]) ??
    "";
  const parsedWorking = parseNumstatOutput(workingNumstat);

  const porcelain =
    runGitSafe(workspacePath, [
      "-c",
      "core.quotePath=false",
      "status",
      "--porcelain=v1",
      "-uall"
    ]) ?? "";
  const untracked = parsePorcelainUntracked(porcelain);

  const combinedFiles = Array.from(
    new Set([...parsedWorking.files, ...untracked])
  );
  if (
    combinedFiles.length > 0 ||
    parsedWorking.insertions > 0 ||
    parsedWorking.deletions > 0
  ) {
    return {
      modifiedFiles: combinedFiles,
      diffStats: {
        filesChanged: combinedFiles.length,
        insertions: parsedWorking.insertions,
        deletions: parsedWorking.deletions
      }
    };
  }

  // 2. If working tree is clean, inspect committed changes against baseRef (or HEAD~1).
  const refToDiff = baseRef?.trim() || "HEAD~1";
  const commitNumstat = runGitSafe(workspacePath, [
    "diff",
    "--numstat",
    refToDiff,
    "HEAD"
  ]);
  if (commitNumstat !== null && commitNumstat.trim().length > 0) {
    const parsedCommit = parseNumstatOutput(commitNumstat);
    const commitFiles = Array.from(new Set(parsedCommit.files));
    return {
      modifiedFiles: commitFiles,
      diffStats: {
        filesChanged: commitFiles.length,
        insertions: parsedCommit.insertions,
        deletions: parsedCommit.deletions
      }
    };
  }

  return {
    modifiedFiles: [],
    diffStats: { filesChanged: 0, insertions: 0, deletions: 0 }
  };
}

function condenseAssistantText(rawText: string | undefined): string {
  if (!rawText) {
    return "";
  }
  const withoutCodeFences = rawText.replace(/```[\s\S]*?```/g, " ").trim();
  const lines = withoutCodeFences
    .split(/\r?\n/)
    .map((line) => line.replace(/^[#>*\-\d.\s]+/, "").trim())
    .filter((line) => line.length > 0);
  const firstMeaningful = lines.slice(0, 2).join("；");
  const normalized = firstMeaningful.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

/**
 * Artifact & Result Backdoor:
 * Extracts structured deliverables directly on Stop hook / task completion without triggering
 * a heavy Oracle second-review LLM pass, and enforces that Stop hooks NEVER auto-re-invoke
 * personal Antigravity (AGY) without human confirmation.
 */
export class ArtifactResultBackdoor {
  private readonly policyGuard: AntigravityPolicyGuard;
  private readonly now: () => number;

  constructor(options: ArtifactResultBackdoorOptions = {}) {
    this.policyGuard = options.policyGuard ?? new AntigravityPolicyGuard();
    this.now = options.now ?? (() => Date.now());
  }

  extractArtifact(input: ArtifactExtractionInput): DispatchTaskArtifact {
    const gitSnapshot =
      input.skipGitInspection === true
        ? null
        : inspectWorkspaceGitDiff(input.workspacePath, input.baseRef);

    const explicitFiles =
      input.modifiedFiles !== undefined
        ? Array.from(
            new Set(
              input.modifiedFiles
                .map((file) => file.trim())
                .filter((file) => file.length > 0)
            )
          )
        : undefined;

    const modifiedFiles =
      explicitFiles !== undefined && explicitFiles.length > 0
        ? explicitFiles
        : (gitSnapshot?.modifiedFiles ?? explicitFiles ?? []);

    const diffStats: DispatchArtifactDiffStats =
      input.diffStats !== undefined
        ? {
            filesChanged: Math.max(
              0,
              Math.trunc(input.diffStats.filesChanged)
            ),
            insertions: Math.max(0, Math.trunc(input.diffStats.insertions)),
            deletions: Math.max(0, Math.trunc(input.diffStats.deletions))
          }
        : gitSnapshot !== null
          ? {
              filesChanged: Math.max(
                modifiedFiles.length,
                gitSnapshot.diffStats.filesChanged
              ),
              insertions: gitSnapshot.diffStats.insertions,
              deletions: gitSnapshot.diffStats.deletions
            }
          : {
              filesChanged: modifiedFiles.length,
              insertions: 0,
              deletions: 0
            };

    const finalAssistantText = (input.finalAssistantText ?? "").trim();
    const headline = condenseAssistantText(finalAssistantText);

    const testBadge =
      input.testPassed === true
        ? "，单测已通过"
        : input.testPassed === false
          ? "，单测存在失败项需排查"
          : "";
    const branchBadge = input.branchName ? `（分支 ${input.branchName}）` : "";
    const diffClause =
      diffStats.filesChanged > 0
        ? `共改动 ${diffStats.filesChanged} 个文件（+${diffStats.insertions}/-${diffStats.deletions} 行）`
        : "未产生文件变更";

    const plainLanguageSummary = headline
      ? `已完成交付${branchBadge}：${headline}；${diffClause}${testBadge}。`
      : `任务 ${input.taskId} 已完成交付${branchBadge}：${diffClause}${testBadge}。`;

    return {
      taskId: input.taskId,
      threadId: input.threadId,
      workspacePath: input.workspacePath,
      finalAssistantText,
      modifiedFiles,
      diffStats,
      plainLanguageSummary,
      extractedAt: new Date(this.now()).toISOString(),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      ...(input.branchName !== undefined
        ? { branchName: input.branchName }
        : {}),
      ...(input.commitSha !== undefined ? { commitSha: input.commitSha } : {}),
      ...(input.testPassed !== undefined ? { testPassed: input.testPassed } : {})
    };
  }

  /**
   * Formats a plain-Chinese direct reply ready for QQ / Gmail / Desktop commander UI,
   * skipping any heavy Oracle second-review pass.
   */
  formatDirectReply(
    artifact: DispatchTaskArtifact,
    channel: "qq" | "gmail" | "desktop" = "qq"
  ): string {
    const filePreview =
      artifact.modifiedFiles.length > 0
        ? artifact.modifiedFiles.slice(0, 6).join("、") +
          (artifact.modifiedFiles.length > 6
            ? ` 等共 ${artifact.modifiedFiles.length} 个文件`
            : "")
        : "无文件变更";

    const statsLine = `变更统计：${artifact.diffStats.filesChanged} 个文件（+${artifact.diffStats.insertions} / -${artifact.diffStats.deletions}）`;
    const fileLine = `涉及文件：${filePreview}`;
    const branchLine = artifact.branchName
      ? `交付分支：${artifact.branchName}`
      : undefined;

    if (channel === "qq") {
      return [
        `【任务完工直达回执】${artifact.plainLanguageSummary}`,
        statsLine,
        fileLine,
        ...(branchLine ? [branchLine] : [])
      ].join("\n");
    }

    return [
      artifact.plainLanguageSummary,
      statsLine,
      fileLine,
      ...(branchLine ? [branchLine] : [])
    ].join("\n");
  }

  /**
   * Evaluates whether a Stop-hook completion may trigger an automated follow-up callback.
   * Personal Antigravity (AGY) is NEVER permitted to be auto-re-invoked on Stop hook
   * without explicit human confirmation.
   */
  evaluateStopCallback(
    targetProvider: string,
    options?: { humanConfirmed?: boolean }
  ): AntigravityGuardDecision {
    return this.policyGuard.evaluateStopHookCallback(targetProvider, options);
  }

  assertStopCallbackAllowed(
    targetProvider: string,
    options?: { humanConfirmed?: boolean }
  ): AntigravityGuardDecision {
    const decision = this.evaluateStopCallback(targetProvider, options);
    if (!decision.allowed) {
      throw new AntigravityGuardDeniedError(
        decision.code ?? "AGY_CONTROLLED_AGENT_LOCKED",
        decision.reason,
        decision
      );
    }
    return decision;
  }
}
