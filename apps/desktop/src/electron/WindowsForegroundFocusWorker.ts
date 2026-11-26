import * as NodeWorkerThreads from "node:worker_threads";

import type { WindowsForegroundFocusTarget } from "./WindowsForegroundFocusThread.ts";
import type { Element } from "@crowecawcaw/xa11y";

type FocusRequest =
  | {
      readonly type: "prepare" | "focus";
      readonly requestId: number;
      readonly target: WindowsForegroundFocusTarget;
    }
  | {
      readonly type: "evict";
      readonly windowId: number;
    };

export const MAX_CACHED_FOCUS_ELEMENTS = 16;

export interface FocusElementCache<T = Element> {
  get(windowId: number): T | undefined;
  set(windowId: number, element: T): void;
  delete(windowId: number): boolean;
  clear(): void;
  readonly size: number;
}

export function createFocusElementCache<T = Element>(
  maxEntries: number = MAX_CACHED_FOCUS_ELEMENTS,
): FocusElementCache<T> {
  const limit = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<number, T>();
  return {
    get(windowId: number): T | undefined {
      const existing = entries.get(windowId);
      if (existing === undefined) return undefined;
      entries.delete(windowId);
      entries.set(windowId, existing);
      return existing;
    },
    set(windowId: number, element: T): void {
      entries.delete(windowId);
      while (entries.size >= limit) {
        const oldestWindowId = entries.keys().next().value;
        if (oldestWindowId === undefined) break;
        entries.delete(oldestWindowId);
      }
      entries.set(windowId, element);
    },
    delete(windowId: number): boolean {
      return entries.delete(windowId);
    },
    clear(): void {
      entries.clear();
    },
    get size(): number {
      return entries.size;
    },
  };
}

function matchesTarget(
  element: {
    readonly name?: string | null;
    readonly bounds: WindowsForegroundFocusTarget["bounds"] | null;
  },
  target: WindowsForegroundFocusTarget,
): boolean {
  if ((element.name ?? "").trim() !== target.title.trim()) return false;
  if (!element.bounds) return false;
  return [target.bounds, target.contentBounds].some((bounds) =>
    (["x", "y", "width", "height"] as const).every(
      (key) => Math.abs(element.bounds![key] - bounds[key]) <= 2,
    ),
  );
}

async function findTarget(
  App: (typeof import("@crowecawcaw/xa11y"))["App"],
  target: WindowsForegroundFocusTarget,
): Promise<Element | undefined> {
  const children = await App.byPid(target.processId, { timeout: 0 })
    .then((app) => app.children())
    .catch(() => []);
  return children.find((candidate) => matchesTarget(candidate, target));
}

const cachedElements = createFocusElementCache<Element>();

async function prepareTarget(
  App: (typeof import("@crowecawcaw/xa11y"))["App"],
  target: WindowsForegroundFocusTarget,
): Promise<boolean> {
  const element = await findTarget(App, target);
  if (!element) {
    cachedElements.delete(target.windowId);
    return false;
  }
  cachedElements.set(target.windowId, element);
  return true;
}

async function focusTarget(
  App: (typeof import("@crowecawcaw/xa11y"))["App"],
  target: WindowsForegroundFocusTarget,
): Promise<boolean> {
  let element = cachedElements.get(target.windowId);
  if (!element) {
    element = await findTarget(App, target);
    if (!element) return false;
    cachedElements.set(target.windowId, element);
  }
  try {
    await element.focus();
    return true;
  } catch {
    cachedElements.delete(target.windowId);
    return false;
  }
}

async function start() {
  const parentPort = NodeWorkerThreads.parentPort;
  if (!parentPort) return;
  const { App } = await import("@crowecawcaw/xa11y");
  let work = Promise.resolve();
  parentPort.on("message", (message: FocusRequest) => {
    if (message.type === "evict") {
      work = work.then(() => {
        cachedElements.delete(message.windowId);
      });
      return;
    }
    if (message.type !== "prepare" && message.type !== "focus") return;
    work = work.then(async () => {
      const focused = await (
        message.type === "prepare"
          ? prepareTarget(App, message.target)
          : focusTarget(App, message.target)
      ).catch(() => false);
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node workers do not accept a target origin.
      parentPort.postMessage({ type: "result", requestId: message.requestId, focused });
    });
  });
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node workers do not accept a target origin.
  parentPort.postMessage("ready");
}

void start();
