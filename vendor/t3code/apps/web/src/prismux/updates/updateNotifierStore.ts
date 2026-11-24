import { useSyncExternalStore } from "react";

import type { DaemonUpdaterEvent } from "../daemonClient";
import {
  applyUpdaterSseEvent,
  type UpdateCheckView,
  type UpdaterStatusView,
} from "../settings/prismuxUpdates.logic";

export const AUTO_CHECK_UPDATES_STORAGE_KEY = "prismux.updater.autoCheck.v1";
export const COLLAPSED_UPDATE_VERSIONS_STORAGE_KEY = "prismux.updater.collapsedVersions.v1";
export const PRISMUX_UPDATE_AVAILABLE_EVENT = "prismux:update-available";

export type UpdatePresentationMode = "hidden" | "toast" | "modal" | "capsule";

export interface RectSnapshot {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface UpdateFlyTransition {
  readonly id: number;
  readonly fromRect: RectSnapshot;
  readonly version: string;
  readonly reducedMotion: boolean;
}

export type ReleaseNotesBlock =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: "list"; readonly items: readonly string[] }
  | { readonly type: "paragraph"; readonly text: string };

export interface UpdateNotifierState {
  readonly autoCheckEnabled: boolean;
  readonly availableUpdate: UpdateCheckView | null;
  readonly updaterStatus: UpdaterStatusView | null;
  readonly presentation: UpdatePresentationMode;
  readonly collapsedVersions: readonly string[];
  readonly flyTransition: UpdateFlyTransition | null;
  readonly checking: boolean;
  readonly downloading: boolean;
  readonly installing: boolean;
  readonly speedBytesPerSec: number | null;
  readonly errorMessage: string | null;
  readonly statusMessage: string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function getDefaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeVersionString(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^v/i, "");
}

export function formatVersionBadge(raw: string | null | undefined): string {
  const normalized = normalizeVersionString(raw);
  return normalized ? `v${normalized}` : "";
}

export function readAutoCheckPreference(storage: StorageLike | null = getDefaultStorage()): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(AUTO_CHECK_UPDATES_STORAGE_KEY);
    if (raw === null) return true;
    if (raw === "false" || raw === "0") return false;
    if (raw === "true" || raw === "1") return true;
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "boolean" ? parsed : true;
  } catch {
    return true;
  }
}

export function writeAutoCheckPreference(
  enabled: boolean,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(AUTO_CHECK_UPDATES_STORAGE_KEY, JSON.stringify(enabled));
  } catch {
    // Ignore storage quota or private mode failures.
  }
}

export function readCollapsedUpdateVersions(
  storage: StorageLike | null = getDefaultStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(COLLAPSED_UPDATE_VERSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => normalizeVersionString(entry))
      .filter((entry) => entry.length > 0)
      .slice(-24);
  } catch {
    return [];
  }
}

export function writeCollapsedUpdateVersions(
  versions: readonly string[],
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      COLLAPSED_UPDATE_VERSIONS_STORAGE_KEY,
      JSON.stringify(Array.from(new Set(versions)).slice(-24)),
    );
  } catch {
    // Ignore storage failures.
  }
}

function stripInlineMarkdown(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const GITHUB_ALERT_TAG_RE = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
const TABLE_SEPARATOR_RE = /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/;

function stripBlockquoteAndAlertPrefix(line: string): string {
  return line
    .replace(/^(?:>\s*)+/, "")
    .trim()
    .replace(GITHUB_ALERT_TAG_RE, "")
    .trim();
}

/**
 * Extracts a concise, clean first-line highlight from Markdown release notes
 * for the bottom-right liquid glass update toast.
 */
export function extractReleaseNotesPreview(
  notes: string | null | undefined,
  maxLength = 104,
): string {
  if (!notes || !notes.trim()) {
    return "包含体验优化、稳定性提升与问题修复，点击查看完整更新公告并一键升级。";
  }

  const lines = notes.split(/\r?\n/);
  let fallbackHeading = "";
  let inCodeFence = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    if (/^[-*_]{3,}$/.test(trimmed)) continue;

    const cleanLine = stripBlockquoteAndAlertPrefix(trimmed);
    if (!cleanLine) continue;
    if (/^[-*_]{3,}$/.test(cleanLine) || TABLE_SEPARATOR_RE.test(cleanLine)) continue;

    const headingMatch = /^#{1,6}\s+(.+)$/.exec(cleanLine);
    if (headingMatch) {
      const cleanedHeading = stripInlineMarkdown(headingMatch[1] ?? "");
      if (!fallbackHeading && cleanedHeading.length > 0) {
        fallbackHeading = cleanedHeading;
      }
      continue;
    }

    const bulletMatch = /^(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(cleanLine);
    const candidate = stripInlineMarkdown(bulletMatch ? (bulletMatch[1] ?? "") : cleanLine);
    if (!candidate) continue;
    return candidate.length > maxLength ? `${candidate.slice(0, maxLength - 1).trimEnd()}…` : candidate;
  }

  if (fallbackHeading) {
    return fallbackHeading.length > maxLength
      ? `${fallbackHeading.slice(0, maxLength - 1).trimEnd()}…`
      : fallbackHeading;
  }

  return "包含体验优化、稳定性提升与问题修复，点击查看完整更新公告并一键升级。";
}

/**
 * Parses Markdown release notes into structured heading / bullet-list / paragraph blocks
 * rendered safely as plain React elements (zero raw HTML injection).
 */
export function parseReleaseNotesBlocks(
  notes: string | null | undefined,
): readonly ReleaseNotesBlock[] {
  if (!notes || !notes.trim()) {
    return [];
  }

  const lines = notes.split(/\r?\n/);
  const blocks: ReleaseNotesBlock[] = [];
  let pendingList: string[] = [];
  let pendingParagraph: string[] = [];
  let inCodeFence = false;

  const flushList = () => {
    if (pendingList.length > 0) {
      blocks.push({ type: "list", items: [...pendingList] });
      pendingList = [];
    }
  };

  const flushParagraph = () => {
    if (pendingParagraph.length > 0) {
      blocks.push({ type: "paragraph", text: pendingParagraph.join(" ") });
      pendingParagraph = [];
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList();
      flushParagraph();
      continue;
    }
    if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      flushList();
      flushParagraph();
      continue;
    }
    if (inCodeFence) continue;
    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushList();
      flushParagraph();
      continue;
    }

    const cleanLine = stripBlockquoteAndAlertPrefix(trimmed);
    if (!cleanLine) {
      continue;
    }
    if (/^[-*_]{3,}$/.test(cleanLine) || TABLE_SEPARATOR_RE.test(cleanLine)) {
      flushList();
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(cleanLine);
    if (headingMatch) {
      flushList();
      flushParagraph();
      const level = Math.min(3, Math.max(1, headingMatch[1]?.length ?? 2)) as 1 | 2 | 3;
      const text = stripInlineMarkdown(headingMatch[2] ?? "");
      if (text) {
        blocks.push({ type: "heading", level, text });
      }
      continue;
    }

    const listMatch = /^(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(cleanLine);
    if (listMatch) {
      flushParagraph();
      const itemText = listMatch[1]?.trim() ?? "";
      if (itemText) {
        pendingList.push(itemText);
      }
      continue;
    }

    flushList();
    pendingParagraph.push(cleanLine);
  }

  flushList();
  flushParagraph();
  return blocks;
}

export function formatUpdateByteSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return "未知大小";
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTransferSpeed(bytesPerSec: number | null | undefined): string | null {
  if (typeof bytesPerSec !== "number" || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return null;
  }
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

export function isUpdateTransferActive(status: UpdaterStatusView | null): boolean {
  if (!status) return false;
  return (
    status.downloading ||
    status.installState === "downloading" ||
    status.installState === "extracting" ||
    status.installState === "verifying" ||
    status.progress?.stage === "downloading" ||
    status.progress?.stage === "extracting" ||
    status.progress?.stage === "verifying"
  );
}

export function hasVerifiedUpdatePackage(status: UpdaterStatusView | null): boolean {
  return Boolean(status?.downloadedFilePath && status?.downloadedSha256);
}

export interface CreateUpdateNotifierStoreOptions {
  readonly storage?: StorageLike | null;
}

export interface UpdateNotifierStore {
  getState(): UpdateNotifierState;
  subscribe(listener: () => void): () => void;
  setAutoCheckEnabled(enabled: boolean, options?: { readonly markLocalDirty?: boolean }): void;
  isLocalAutoCheckDirty(): boolean;
  clearLocalAutoCheckDirty(): void;
  setChecking(checking: boolean): void;
  setDownloading(downloading: boolean): void;
  setInstalling(installing: boolean): void;
  setMessages(messages: { readonly error?: string | null; readonly status?: string | null }): void;
  reportUpdateAvailable(
    check: UpdateCheckView,
    options?: { readonly forceToast?: boolean },
  ): void;
  hydrateFromDaemonStatus(
    status: UpdaterStatusView,
    options?: { readonly syncAutoCheck?: boolean },
  ): void;
  applySseEvent(event: DaemonUpdaterEvent, appVersionFallback?: string): void;
  openReleaseModal(): void;
  collapseToCapsule(fromRect?: RectSnapshot | null, reducedMotion?: boolean): void;
  clearFlyTransition(id: number): void;
  dismissAllForReset(): void;
}

export function createUpdateNotifierStore(
  options: CreateUpdateNotifierStoreOptions = {},
): UpdateNotifierStore {
  const storage = options.storage !== undefined ? options.storage : getDefaultStorage();
  let nextFlyId = 1;
  let localAutoCheckDirty = false;
  let lastBytesSample: { bytes: number; at: number } | null = null;
  const listeners = new Set<() => void>();

  let state: UpdateNotifierState = {
    autoCheckEnabled: readAutoCheckPreference(storage),
    availableUpdate: null,
    updaterStatus: null,
    presentation: "hidden",
    collapsedVersions: readCollapsedUpdateVersions(storage),
    flyTransition: null,
    checking: false,
    downloading: false,
    installing: false,
    speedBytesPerSec: null,
    errorMessage: null,
    statusMessage: null,
  };

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (next: UpdateNotifierState) => {
    state = next;
    emit();
  };

  const computeNextSpeed = (status: UpdaterStatusView | null): number | null => {
    const progress = status?.progress;
    if (!progress || progress.stage !== "downloading") {
      lastBytesSample = null;
      return null;
    }
    const now = progress.updatedAt > 0 ? progress.updatedAt : Date.now();
    const bytes = Math.max(0, progress.bytesDownloaded);
    if (!lastBytesSample || bytes < lastBytesSample.bytes) {
      lastBytesSample = { bytes, at: now };
      return state.speedBytesPerSec;
    }
    const dtMs = now - lastBytesSample.at;
    const dBytes = bytes - lastBytesSample.bytes;
    if (dtMs >= 180 && dBytes > 0) {
      const instant = (dBytes / dtMs) * 1000;
      lastBytesSample = { bytes, at: now };
      return state.speedBytesPerSec !== null
        ? state.speedBytesPerSec * 0.45 + instant * 0.55
        : instant;
    }
    return state.speedBytesPerSec;
  };

  const reportUpdateAvailable = (
    check: UpdateCheckView,
    opts?: { readonly forceToast?: boolean },
  ) => {
    const latestNorm = normalizeVersionString(check.latestVersion);
    if (!check.hasUpdate || !latestNorm) {
      const keepVisible =
        isUpdateTransferActive(state.updaterStatus) ||
        hasVerifiedUpdatePackage(state.updaterStatus);
      setState({
        ...state,
        availableUpdate: keepVisible ? state.availableUpdate : null,
        presentation: keepVisible ? state.presentation : "hidden",
      });
      return;
    }

    const isAlreadyCollapsed = state.collapsedVersions.includes(latestNorm);
    let nextPresentation: UpdatePresentationMode = state.presentation;
    if (state.presentation === "modal") {
      nextPresentation = "modal";
    } else if (opts?.forceToast) {
      nextPresentation = "toast";
    } else if (isAlreadyCollapsed) {
      nextPresentation = "capsule";
    } else {
      nextPresentation = "toast";
    }

    setState({
      ...state,
      availableUpdate: check,
      presentation: nextPresentation,
      flyTransition: nextPresentation === "toast" ? null : state.flyTransition,
      errorMessage: null,
    });
  };

  return {
    getState: () => state,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setAutoCheckEnabled: (enabled, opts) => {
      writeAutoCheckPreference(enabled, storage);
      if (opts?.markLocalDirty !== false) {
        localAutoCheckDirty = true;
      }
      if (state.autoCheckEnabled === enabled && !state.updaterStatus) {
        return;
      }
      setState({
        ...state,
        autoCheckEnabled: enabled,
        updaterStatus: state.updaterStatus
          ? {
              ...state.updaterStatus,
              policy: {
                ...state.updaterStatus.policy,
                autoCheckEnabled: enabled,
              },
            }
          : null,
      });
    },

    isLocalAutoCheckDirty: () => localAutoCheckDirty,

    clearLocalAutoCheckDirty: () => {
      localAutoCheckDirty = false;
    },

    setChecking: (checking) => {
      if (state.checking === checking) return;
      setState({ ...state, checking });
    },

    setDownloading: (downloading) => {
      if (state.downloading === downloading) return;
      if (!downloading) {
        lastBytesSample = null;
      }
      setState({
        ...state,
        downloading,
        speedBytesPerSec: downloading ? state.speedBytesPerSec : null,
      });
    },

    setInstalling: (installing) => {
      if (state.installing === installing) return;
      setState({ ...state, installing });
    },

    setMessages: ({ error, status }) => {
      setState({
        ...state,
        ...(error !== undefined ? { errorMessage: error } : {}),
        ...(status !== undefined ? { statusMessage: status } : {}),
      });
    },

    reportUpdateAvailable,

    hydrateFromDaemonStatus: (status, opts) => {
      const shouldSyncAutoCheck = opts?.syncAutoCheck !== false && !localAutoCheckDirty;
      const nextAutoCheck = shouldSyncAutoCheck
        ? status.policy.autoCheckEnabled
        : state.autoCheckEnabled;
      if (shouldSyncAutoCheck) {
        writeAutoCheckPreference(nextAutoCheck, storage);
      }

      const nextSpeed = computeNextSpeed(status);
      const nextDownloading = isUpdateTransferActive(status);

      let nextAvailable = state.availableUpdate;
      let nextPresentation = state.presentation;

      if (status.lastCheck?.hasUpdate && normalizeVersionString(status.lastCheck.latestVersion)) {
        nextAvailable = status.lastCheck;
        const verKey = normalizeVersionString(status.lastCheck.latestVersion);
        if (nextPresentation === "hidden") {
          nextPresentation = state.collapsedVersions.includes(verKey) ? "capsule" : "toast";
        }
      } else if (
        (nextDownloading || hasVerifiedUpdatePackage(status)) &&
        nextPresentation === "hidden"
      ) {
        nextPresentation = "capsule";
      }

      setState({
        ...state,
        autoCheckEnabled: nextAutoCheck,
        updaterStatus: status,
        availableUpdate: nextAvailable,
        presentation: nextPresentation,
        checking: status.checking,
        downloading: nextDownloading,
        speedBytesPerSec: nextSpeed,
        errorMessage:
          status.progress?.stage === "error" && status.lastError
            ? status.lastError
            : state.errorMessage,
      });
    },

    applySseEvent: (event, appVersionFallback = "") => {
      const nextStatus = applyUpdaterSseEvent(state.updaterStatus, event, appVersionFallback);
      if (!nextStatus) return;

      const nextSpeed = computeNextSpeed(nextStatus);
      const nextDownloading = isUpdateTransferActive(nextStatus);

      let nextAvailable = state.availableUpdate;
      let nextPresentation = state.presentation;

      if (
        nextStatus.lastCheck?.hasUpdate &&
        normalizeVersionString(nextStatus.lastCheck.latestVersion)
      ) {
        nextAvailable = nextStatus.lastCheck;
        const verKey = normalizeVersionString(nextStatus.lastCheck.latestVersion);
        if (nextPresentation === "hidden") {
          nextPresentation = state.collapsedVersions.includes(verKey) ? "capsule" : "toast";
        }
      } else if (
        (nextDownloading || hasVerifiedUpdatePackage(nextStatus)) &&
        nextPresentation === "hidden"
      ) {
        nextPresentation = "capsule";
      }

      setState({
        ...state,
        updaterStatus: nextStatus,
        availableUpdate: nextAvailable,
        presentation: nextPresentation,
        checking: nextStatus.checking,
        downloading: nextDownloading,
        speedBytesPerSec: nextSpeed,
        errorMessage:
          nextStatus.progress?.stage === "error" && nextStatus.lastError
            ? nextStatus.lastError
            : state.errorMessage,
      });
    },

    openReleaseModal: () => {
      if (!state.availableUpdate && !hasVerifiedUpdatePackage(state.updaterStatus)) {
        return;
      }
      setState({
        ...state,
        presentation: "modal",
        flyTransition: null,
        errorMessage: null,
      });
    },

    collapseToCapsule: (fromRect = null, reducedMotion = false) => {
      const verKey = normalizeVersionString(state.availableUpdate?.latestVersion);
      const nextCollapsed =
        verKey && !state.collapsedVersions.includes(verKey)
          ? [...state.collapsedVersions, verKey].slice(-24)
          : state.collapsedVersions;
      if (nextCollapsed !== state.collapsedVersions) {
        writeCollapsedUpdateVersions(nextCollapsed, storage);
      }

      const validFromRect =
        fromRect && fromRect.width > 0 && fromRect.height > 0 ? fromRect : null;
      const flyTransition: UpdateFlyTransition | null =
        validFromRect && !reducedMotion
          ? {
              id: nextFlyId++,
              fromRect: validFromRect,
              version: verKey || "new",
              reducedMotion: false,
            }
          : null;

      setState({
        ...state,
        collapsedVersions: nextCollapsed,
        presentation:
          state.availableUpdate || hasVerifiedUpdatePackage(state.updaterStatus)
            ? "capsule"
            : "hidden",
        flyTransition,
      });
    },

    clearFlyTransition: (id) => {
      if (!state.flyTransition || state.flyTransition.id !== id) return;
      setState({
        ...state,
        flyTransition: null,
      });
    },

    dismissAllForReset: () => {
      localAutoCheckDirty = false;
      lastBytesSample = null;
      writeCollapsedUpdateVersions([], storage);
      setState({
        autoCheckEnabled: readAutoCheckPreference(storage),
        availableUpdate: null,
        updaterStatus: null,
        presentation: "hidden",
        collapsedVersions: [],
        flyTransition: null,
        checking: false,
        downloading: false,
        installing: false,
        speedBytesPerSec: null,
        errorMessage: null,
        statusMessage: null,
      });
    },
  };
}

export const prismuxUpdateNotifierStore = createUpdateNotifierStore();

export function useUpdateNotifierState(): UpdateNotifierState {
  return useSyncExternalStore(
    prismuxUpdateNotifierStore.subscribe,
    prismuxUpdateNotifierStore.getState,
    prismuxUpdateNotifierStore.getState,
  );
}
