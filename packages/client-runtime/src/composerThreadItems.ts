import {
  isListedThreadLineage,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ScopedThreadRef,
  type ThreadId,
} from "@prismux/core-contracts";
import { foldSearchQuery, rankSearchItems, scoreThreadSearch } from "@prismux/core-shared/paletteSearch";

import type { EnvironmentThreadShell } from "./state/models.ts";
import { threadSearchSubject, type ThreadSearchShell } from "./state/threadSearch.ts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

const COMPOSER_THREAD_RESULT_LIMIT = 5;
const COMPOSER_RECENT_THREAD_LIMIT = 4;

const CHINESE_THREAD_MENTION_KEYWORDS = new Set(["对话", "会话", "聊天", "对", "会", "聊"]);
const ENGLISH_THREAD_MENTION_KEYWORDS = new Set(["thread", "threads", "chat", "chats"]);

function threadRecencyMs(shell: ComposerThreadCandidate): number {
  const updatedMs = Date.parse(shell.updatedAt);
  const latestMessageMs = shell.latestUserMessageAt
    ? Date.parse(shell.latestUserMessageAt)
    : Number.NaN;
  const createdMs = Date.parse(shell.createdAt);
  return Math.max(
    Number.isFinite(updatedMs) ? updatedMs : 0,
    Number.isFinite(latestMessageMs) ? latestMessageMs : 0,
    Number.isFinite(createdMs) ? createdMs : 0,
  );
}

function compareThreadsByRecency(
  left: ComposerThreadCandidate,
  right: ComposerThreadCandidate,
): number {
  const delta = threadRecencyMs(right) - threadRecencyMs(left);
  if (delta !== 0) return delta;
  return left.id.localeCompare(right.id);
}

export type ComposerThreadCandidate = ThreadSearchShell &
  Pick<EnvironmentThreadShell, "archivedAt" | "lineage">;

export interface ComposerThreadItem {
  readonly id: string;
  readonly type: "thread";
  readonly thread: ScopedThreadRef;
  readonly label: string;
  readonly description: string;
}

/**
 * Threads to reference from the composer, matched and ranked like the command
 * palette, without subagent threads or other threads' side chats. The agent reads threads
 * on its own server and on the machines it links to, so candidates stay within those, and a
 * linked machine's threads say which machine they are on.
 */
export function matchComposerThreadItems(
  input: {
    shells: ReadonlyArray<ComposerThreadCandidate>;
    environmentId: EnvironmentId;
    /** The machines the composer's environment links to, by name. */
    linkedEnvironments: ReadonlyMap<EnvironmentId, string>;
    excludeThreadId: ThreadId | null;
    query: string;
    /** Recency is measured against this time. */
    now: number;
    /** When true, bare `@` surfaces up to 4 most recent threads for quick `@对话` picking. */
    readonly includeRecentOnEmptyQuery?: boolean;
  },
  resolve: MFunctionType = mFallback,
): ComposerThreadItem[] {
  const query = foldSearchQuery(input.query);
  const includeRecentOnEmptyQuery = input.includeRecentOnEmptyQuery === true;
  if (query.length === 0 && !includeRecentOnEmptyQuery) return [];
  // Closing an unused side chat deletes it, so only one with a message is offered.
  const isOwnSideChat = (shell: ComposerThreadCandidate) =>
    shell.lineage.sideChat === true &&
    shell.environmentId === input.environmentId &&
    shell.lineage.parentThreadId === input.excludeThreadId &&
    shell.latestUserMessageAt !== null;
  const candidates = input.shells.filter(
    (shell) =>
      (shell.environmentId === input.environmentId ||
        input.linkedEnvironments.has(shell.environmentId)) &&
      shell.id !== input.excludeThreadId &&
      shell.archivedAt === null &&
      (isListedThreadLineage(shell.lineage) || isOwnSideChat(shell)),
  );
  const toThreadItem = (
    shell: ComposerThreadCandidate,
    useChineseRecentLabels: boolean,
  ): ComposerThreadItem => {
    const machine =
      shell.environmentId === input.environmentId
        ? undefined
        : input.linkedEnvironments.get(shell.environmentId);
    const description = useChineseRecentLabels
      ? isOwnSideChat(shell)
        ? "旁路对话"
        : machine === undefined
          ? "当前工作区对话"
          : `${machine} 上的对话`
      : isOwnSideChat(shell)
        ? resolve(msg("Side chat"))
        : machine === undefined
          ? resolve(msg("Thread", { $context: "noun, search result type" }))
          : resolve(msg("Thread on {machine}", { machine }));
    return {
      id: `thread:${shell.environmentId}:${shell.id}`,
      type: "thread",
      thread: { environmentId: shell.environmentId, threadId: shell.id },
      label: shell.title,
      description,
    };
  };

  if (query.length === 0) {
    return [...candidates]
      .sort(compareThreadsByRecency)
      .slice(0, COMPOSER_RECENT_THREAD_LIMIT)
      .map((shell) => toThreadItem(shell, true));
  }

  const isChineseKeyword = CHINESE_THREAD_MENTION_KEYWORDS.has(query);
  const isEnglishKeyword = ENGLISH_THREAD_MENTION_KEYWORDS.has(query);
  const rankedMatches = rankSearchItems(candidates, (shell, options) =>
    scoreThreadSearch(query, threadSearchSubject(shell, null), input.now, {
      ...options,
      picks: false,
    }),
  ).map(({ item }) => item);

  if (isChineseKeyword || isEnglishKeyword) {
    const seen = new Set<string>();
    const combined: ComposerThreadCandidate[] = [];
    for (const shell of [...rankedMatches, ...[...candidates].sort(compareThreadsByRecency)]) {
      const key = `${shell.environmentId}:${shell.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(shell);
      if (combined.length >= COMPOSER_THREAD_RESULT_LIMIT) break;
    }
    return combined.map((shell) => toThreadItem(shell, isChineseKeyword || includeRecentOnEmptyQuery));
  }

  return rankedMatches
    .slice(0, COMPOSER_THREAD_RESULT_LIMIT)
    .map((shell) => toThreadItem(shell, false));
}

export interface ComposerEnvironmentCandidate {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
}

export interface ComposerEnvironmentItem {
  readonly id: string;
  readonly type: "environment";
  readonly environmentId: EnvironmentId;
  readonly machine: EnvironmentMachineKind;
  readonly label: string;
  readonly description: string;
}

/**
 * The machines the `@` picker offers, so the agent can link or work there: the client's paired
 * machines and those the composer's environment links to. The composer's own environment is
 * left out. Like threads, they need a query: bare `@` stays a file picker.
 */
export function matchComposerEnvironmentItems(
  input: {
    environments: ReadonlyArray<ComposerEnvironmentCandidate>;
    /** The machines the composer's environment links to, by name. */
    linkedEnvironments: ReadonlyMap<EnvironmentId, string>;
    environmentId: EnvironmentId;
    query: string;
  },
  resolve: MFunctionType = mFallback,
): ComposerEnvironmentItem[] {
  const query = input.query.trim().toLowerCase();
  if (query.length === 0) return [];
  const paired = new Set(input.environments.map((environment) => environment.environmentId));
  const linkedOnly = Array.from(input.linkedEnvironments, ([environmentId, label]) => ({
    environmentId,
    label,
    machine: "server" as const,
  })).filter((environment) => !paired.has(environment.environmentId));
  return [...input.environments, ...linkedOnly]
    .filter(
      (environment) =>
        environment.environmentId !== input.environmentId &&
        environment.label.toLowerCase().includes(query),
    )
    .map((environment) => ({
      id: `environment:${environment.environmentId}`,
      type: "environment",
      environmentId: environment.environmentId,
      machine: environment.machine,
      label: environment.label,
      description: resolve(msg("Machine", { $context: "noun, search result type" })),
    }));
}
