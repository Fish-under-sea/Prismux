import { useSyncExternalStore } from "react";

export type ProviderLaunchMode = "chat" | "cli";

export interface ProviderLaunchModeState {
  readonly globalDefaultMode: ProviderLaunchMode;
  readonly perInstanceMode: Readonly<Record<string, ProviderLaunchMode>>;
}

export const PROVIDER_LAUNCH_MODE_STORAGE_KEY = "prismux.providerLaunchMode.v1";

const DEFAULT_STATE: ProviderLaunchModeState = {
  globalDefaultMode: "chat",
  perInstanceMode: {},
};

const listeners = new Set<() => void>();
let cachedState: ProviderLaunchModeState | null = null;

function isValidMode(value: unknown): value is ProviderLaunchMode {
  return value === "chat" || value === "cli";
}

function parseState(raw: string | null): ProviderLaunchModeState {
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return DEFAULT_STATE;
    }
    const rec = parsed as Record<string, unknown>;
    const globalDefaultMode: ProviderLaunchMode = isValidMode(rec.globalDefaultMode)
      ? rec.globalDefaultMode
      : "chat";
    const perInstanceMode: Record<string, ProviderLaunchMode> = {};
    if (
      typeof rec.perInstanceMode === "object" &&
      rec.perInstanceMode !== null &&
      !Array.isArray(rec.perInstanceMode)
    ) {
      for (const [key, val] of Object.entries(rec.perInstanceMode as Record<string, unknown>)) {
        if (key.trim().length > 0 && isValidMode(val)) {
          perInstanceMode[key] = val;
        }
      }
    }
    return {
      globalDefaultMode,
      perInstanceMode,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function readProviderLaunchModeState(): ProviderLaunchModeState {
  if (cachedState !== null) return cachedState;
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    cachedState = parseState(window.localStorage.getItem(PROVIDER_LAUNCH_MODE_STORAGE_KEY));
  } catch {
    cachedState = DEFAULT_STATE;
  }
  return cachedState;
}

function writeProviderLaunchModeState(next: ProviderLaunchModeState): void {
  cachedState = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PROVIDER_LAUNCH_MODE_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota or private mode errors.
    }
  }
  for (const listener of listeners) {
    listener();
  }
}

export function resetProviderLaunchModeCacheForTests(): void {
  cachedState = null;
}

export function setGlobalDefaultLaunchMode(mode: ProviderLaunchMode): ProviderLaunchModeState {
  const current = readProviderLaunchModeState();
  if (current.globalDefaultMode === mode) return current;
  const next: ProviderLaunchModeState = {
    globalDefaultMode: mode,
    perInstanceMode: current.perInstanceMode,
  };
  writeProviderLaunchModeState(next);
  return next;
}

export function setProviderInstanceLaunchMode(
  instanceId: string,
  mode: ProviderLaunchMode | null,
): ProviderLaunchModeState {
  const current = readProviderLaunchModeState();
  const nextPerInstance = { ...current.perInstanceMode };
  if (mode === null) {
    delete nextPerInstance[instanceId];
  } else {
    nextPerInstance[instanceId] = mode;
  }
  const next: ProviderLaunchModeState = {
    globalDefaultMode: current.globalDefaultMode,
    perInstanceMode: nextPerInstance,
  };
  writeProviderLaunchModeState(next);
  return next;
}

export function resolveEffectiveLaunchMode(
  state: ProviderLaunchModeState,
  instanceId: string | null | undefined,
  supportsDualMode: boolean,
): ProviderLaunchMode {
  if (!supportsDualMode) return "chat";
  if (instanceId && state.perInstanceMode[instanceId]) {
    return state.perInstanceMode[instanceId];
  }
  return state.globalDefaultMode;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PROVIDER_LAUNCH_MODE_STORAGE_KEY) {
      cachedState = null;
      listener();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useProviderLaunchModePreferences(): {
  readonly state: ProviderLaunchModeState;
  readonly setGlobalDefaultMode: (mode: ProviderLaunchMode) => void;
  readonly setInstanceMode: (instanceId: string, mode: ProviderLaunchMode | null) => void;
} {
  const state = useSyncExternalStore(
    subscribe,
    readProviderLaunchModeState,
    () => DEFAULT_STATE,
  );
  return {
    state,
    setGlobalDefaultMode: setGlobalDefaultLaunchMode,
    setInstanceMode: setProviderInstanceLaunchMode,
  };
}
