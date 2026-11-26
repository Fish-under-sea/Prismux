// @effect-diagnostics globalTimers:off -- The helper timeout runs at a worker callback boundary outside any Effect fiber.
// @effect-diagnostics nodeBuiltinImport:off -- This desktop-only helper owns a Node worker.

import * as NodeWorkerThreads from "node:worker_threads";

import type * as Electron from "electron";

const FOCUS_TIMEOUT_MS = 1_000;

export type WindowsForegroundFocusTarget = {
  readonly windowId: number;
  readonly processId: number;
  readonly title: string;
  readonly bounds: Electron.Rectangle;
  readonly contentBounds: Electron.Rectangle;
};

export type WindowsForegroundFocusThread = {
  readonly prepare: (target: WindowsForegroundFocusTarget) => Promise<boolean>;
  readonly focus: (target: WindowsForegroundFocusTarget) => Promise<boolean>;
  readonly evict: (windowId: number) => void;
  readonly close: () => void;
};

type FocusRequest = {
  readonly type: "prepare" | "focus";
  readonly requestId: number;
  readonly target: WindowsForegroundFocusTarget;
};

type EvictMessage = {
  readonly type: "evict";
  readonly windowId: number;
};

type FocusResult = {
  readonly type: "result";
  readonly requestId: number;
  readonly focused: boolean;
};

const unavailableThread = (): WindowsForegroundFocusThread => ({
  prepare: async () => false,
  focus: async () => false,
  evict: () => undefined,
  close: () => undefined,
});

export function startWindowsForegroundFocusThread(
  workerPath: string,
): WindowsForegroundFocusThread {
  let worker: NodeWorkerThreads.Worker | undefined;
  let ready = false;
  let closed = false;
  let nextRequestId = 1;
  const pending = new Map<
    number,
    {
      readonly request: FocusRequest;
      readonly resolve: (focused: boolean) => void;
      readonly timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingEvictions = new Set<number>();

  const finish = (requestId: number, focused: boolean) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    clearTimeout(request.timeout);
    request.resolve(focused);
  };
  const send = (request: FocusRequest, targetWorker: NodeWorkerThreads.Worker) => {
    if (!ready || closed || worker !== targetWorker) return;
    try {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node workers do not accept a target origin.
      targetWorker.postMessage(request);
    } catch {
      finish(request.requestId, false);
    }
  };
  const sendEvict = (windowId: number, targetWorker: NodeWorkerThreads.Worker) => {
    if (!ready || closed || worker !== targetWorker) return;
    try {
      const message: EvictMessage = { type: "evict", windowId };
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node workers do not accept a target origin.
      targetWorker.postMessage(message);
    } catch {
      // Ignore postMessage failure while worker is shutting down.
    }
  };
  const start = (): boolean => {
    if (closed) return false;
    let nextWorker: NodeWorkerThreads.Worker;
    try {
      nextWorker = new NodeWorkerThreads.Worker(workerPath);
      nextWorker.unref();
    } catch {
      return false;
    }

    worker = nextWorker;
    ready = false;
    const reset = () => {
      if (worker !== nextWorker) return;
      worker = undefined;
      ready = false;
      pendingEvictions.clear();
      for (const requestId of pending.keys()) finish(requestId, false);
    };
    nextWorker.on("message", (rawMessage) => {
      if (worker !== nextWorker) return;
      if (rawMessage === "ready") {
        ready = true;
        for (const request of pending.values()) send(request.request, nextWorker);
        if (pendingEvictions.size > 0) {
          for (const windowId of pendingEvictions) {
            sendEvict(windowId, nextWorker);
          }
          pendingEvictions.clear();
        }
        return;
      }
      const message = rawMessage as FocusResult;
      if (message.type === "result") finish(message.requestId, message.focused);
    });
    nextWorker.once("error", reset);
    nextWorker.once("exit", reset);
    return true;
  };

  if (!start()) return unavailableThread();

  const restart = (timedOutWorker: NodeWorkerThreads.Worker | undefined) => {
    if (!timedOutWorker || worker !== timedOutWorker) return;
    worker = undefined;
    ready = false;
    pendingEvictions.clear();
    for (const requestId of pending.keys()) finish(requestId, false);
    void timedOutWorker.terminate();
    start();
  };
  const request = (type: FocusRequest["type"], target: WindowsForegroundFocusTarget) =>
    new Promise<boolean>((resolve) => {
      if (closed || (!worker && !start())) {
        resolve(false);
        return;
      }
      const requestId = nextRequestId++;
      const focusRequest = { type, requestId, target } satisfies FocusRequest;
      const requestWorker = worker!;
      const timeout = setTimeout(() => {
        finish(requestId, false);
        restart(requestWorker);
      }, FOCUS_TIMEOUT_MS);
      timeout.unref();
      pending.set(requestId, { request: focusRequest, resolve, timeout });
      send(focusRequest, requestWorker);
    });

  return {
    prepare: (target) => request("prepare", target),
    focus: (target) => request("focus", target),
    evict: (windowId) => {
      if (closed || !worker) return;
      if (ready) {
        sendEvict(windowId, worker);
      } else {
        pendingEvictions.add(windowId);
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      const activeWorker = worker;
      worker = undefined;
      ready = false;
      pendingEvictions.clear();
      for (const requestId of pending.keys()) finish(requestId, false);
      if (activeWorker) void activeWorker.terminate();
    },
  };
}
