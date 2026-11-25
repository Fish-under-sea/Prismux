import type { PrismuxKeepAwakeState } from "@prismux/core-contracts";
import * as Electron from "electron";

export type KeepAwakeBlockerType = "prevent-app-suspension" | "prevent-display-sleep";

export interface PowerSaveBlockerApi {
  readonly start: (type: KeepAwakeBlockerType) => number;
  readonly stop: (id: number) => void;
  readonly isStarted: (id: number) => boolean;
}

export interface KeepAwakeQuitHookTarget {
  readonly once?: (event: "before-quit" | "will-quit", listener: () => void) => unknown;
}

export class PrismuxKeepAwakeController {
  private readonly api: PowerSaveBlockerApi;
  private readonly blockerType: KeepAwakeBlockerType;
  private blockerId: number | null = null;

  constructor(
    api: PowerSaveBlockerApi,
    blockerType: KeepAwakeBlockerType = "prevent-app-suspension",
  ) {
    this.api = api;
    this.blockerType = blockerType;
  }

  private safeIsStarted(id: number): boolean {
    try {
      return Boolean(this.api.isStarted(id));
    } catch {
      return false;
    }
  }

  getState(): PrismuxKeepAwakeState {
    if (this.blockerId === null) {
      return { enabled: false, blockerId: null, active: false };
    }
    if (!this.safeIsStarted(this.blockerId)) {
      this.blockerId = null;
      return { enabled: false, blockerId: null, active: false };
    }
    return {
      enabled: true,
      blockerId: this.blockerId,
      active: true,
    };
  }

  setEnabled(enabled: boolean): PrismuxKeepAwakeState {
    if (enabled) {
      if (this.blockerId !== null && this.safeIsStarted(this.blockerId)) {
        return {
          enabled: true,
          blockerId: this.blockerId,
          active: true,
        };
      }
      this.blockerId = null;
      const nextId = this.api.start(this.blockerType);
      const started = this.safeIsStarted(nextId);
      if (!started) {
        this.blockerId = null;
        return {
          enabled: false,
          blockerId: null,
          active: false,
        };
      }
      this.blockerId = nextId;
      return {
        enabled: true,
        blockerId: nextId,
        active: true,
      };
    }

    return this.release();
  }

  release(): PrismuxKeepAwakeState {
    const id = this.blockerId;
    this.blockerId = null;
    if (id !== null && this.safeIsStarted(id)) {
      try {
        this.api.stop(id);
      } catch {
        // Ignore shutdown-time stop errors if Electron already released the blocker.
      }
    }
    return {
      enabled: false,
      blockerId: null,
      active: false,
    };
  }
}

export function createElectronKeepAwakeController(options?: {
  readonly blocker?: PowerSaveBlockerApi;
  readonly app?: KeepAwakeQuitHookTarget | null;
  readonly blockerType?: KeepAwakeBlockerType;
}): PrismuxKeepAwakeController {
  const blocker: PowerSaveBlockerApi = options?.blocker ?? {
    start: (type) => Electron.powerSaveBlocker.start(type),
    stop: (id) => {
      Electron.powerSaveBlocker.stop(id);
    },
    isStarted: (id) => Electron.powerSaveBlocker.isStarted(id),
  };

  const controller = new PrismuxKeepAwakeController(
    blocker,
    options?.blockerType ?? "prevent-app-suspension",
  );

  const appTarget: KeepAwakeQuitHookTarget | null =
    options?.app !== undefined
      ? options.app
      : (Electron.app as unknown as KeepAwakeQuitHookTarget | undefined) ?? null;

  if (appTarget && typeof appTarget.once === "function") {
    const releaseOnQuit = () => {
      controller.release();
    };
    appTarget.once("before-quit", releaseOnQuit);
    appTarget.once("will-quit", releaseOnQuit);
  }

  return controller;
}
