export interface VisibilitySignalPayload {
  occluded?: boolean;
  minimized?: boolean;
  powerSaver?: boolean;
  power_saver?: boolean;
  targetFps?: number;
  target_fps?: number;
  reason?: string;
}

/**
 * Determines whether the wallpaper viewport must enter 0 FPS occluded sleep.
 */
export function resolveVisibilityOcclusion(params: {
  documentHidden: boolean;
  pauseWhenOccluded: boolean;
  signal?: VisibilitySignalPayload | null;
}): boolean {
  if (!params.pauseWhenOccluded) {
    return false;
  }
  if (params.documentHidden) {
    return true;
  }
  const sig = params.signal;
  if (!sig) {
    return false;
  }
  if (
    sig.occluded === true ||
    sig.minimized === true ||
    sig.powerSaver === true ||
    sig.power_saver === true ||
    sig.targetFps === 0 ||
    sig.target_fps === 0
  ) {
    return true;
  }
  return false;
}

export function extractVisibilityPayload(
  raw: unknown
): VisibilitySignalPayload | null {
  if (typeof raw === "boolean") {
    return { occluded: raw };
  }
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const payload: VisibilitySignalPayload = {};
  if (typeof record.occluded === "boolean") {
    payload.occluded = record.occluded;
  }
  if (typeof record.minimized === "boolean") {
    payload.minimized = record.minimized;
  }
  if (typeof record.powerSaver === "boolean") {
    payload.powerSaver = record.powerSaver;
  }
  if (typeof record.power_saver === "boolean") {
    payload.power_saver = record.power_saver;
  }
  if (typeof record.targetFps === "number") {
    payload.targetFps = record.targetFps;
  }
  if (typeof record.target_fps === "number") {
    payload.target_fps = record.target_fps;
  }
  if (typeof record.reason === "string") {
    payload.reason = record.reason;
  }
  return payload;
}

interface TauriRuntimeLike {
  core?: {
    invoke?: <T = unknown>(
      cmd: string,
      args?: Record<string, unknown>
    ) => Promise<T>;
  };
  event?: {
    listen?: <T = unknown>(
      event: string,
      handler: (ev: { payload: T }) => void
    ) => Promise<() => void>;
  };
}

export function getTauriRuntime(): TauriRuntimeLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  const win = window as unknown as { __TAURI__?: TauriRuntimeLike };
  return win.__TAURI__ ?? null;
}

export async function invokeTauriCommandSafe<T = unknown>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  const tauri = getTauriRuntime();
  const invoke = tauri?.core?.invoke;
  if (typeof invoke !== "function") {
    return null;
  }
  try {
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}
