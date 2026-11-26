import { assert, beforeEach, it } from "@effect/vitest";
import * as NodeEvents from "node:events";
import { vi } from "vite-plus/test";

const workerConstructorMock = vi.hoisted(() => vi.fn());

vi.mock("node:worker_threads", () => ({
  parentPort: null,
  Worker: function Worker(...args: ReadonlyArray<unknown>) {
    return workerConstructorMock(...args);
  },
}));

import { startWindowsForegroundFocusThread } from "./WindowsForegroundFocusThread.ts";
import {
  createFocusElementCache,
  MAX_CACHED_FOCUS_ELEMENTS,
} from "./WindowsForegroundFocusWorker.ts";

const makeWorker = () =>
  Object.assign(new NodeEvents.EventEmitter(), {
    postMessage: vi.fn(),
    terminate: vi.fn(async () => 0),
    unref: vi.fn(),
  });

let worker = makeWorker();
const target = {
  windowId: 7,
  processId: 42,
  title: "Prismux (Dev)",
  bounds: { x: 100, y: 50, width: 1_200, height: 800 },
  contentBounds: { x: 108, y: 50, width: 1_184, height: 792 },
};

beforeEach(() => {
  worker = makeWorker();
  workerConstructorMock.mockReset().mockReturnValue(worker);
});

it("queues focus until the helper is ready", async () => {
  const thread = startWindowsForegroundFocusThread("focus.cjs");
  const focused = thread.focus(target);

  assert.lengthOf(worker.postMessage.mock.calls, 0);
  worker.emit("message", "ready");
  assert.deepEqual(worker.postMessage.mock.calls[0]?.[0], {
    type: "focus",
    requestId: 1,
    target,
  });
  worker.emit("message", { type: "result", requestId: 1, focused: true });

  assert.isTrue(await focused);
  assert.deepEqual(workerConstructorMock.mock.calls, [["focus.cjs"]]);
  thread.close();
});

it("fails pending focus when the helper exits", async () => {
  const replacement = makeWorker();
  workerConstructorMock.mockReturnValueOnce(worker).mockReturnValueOnce(replacement);
  const thread = startWindowsForegroundFocusThread("focus.cjs");
  const focused = thread.focus(target);

  worker.emit("exit", 1);

  assert.isFalse(await focused);
  assert.lengthOf(workerConstructorMock.mock.calls, 1);
  const prepared = thread.prepare(target);
  replacement.emit("message", "ready");
  replacement.emit("message", { type: "result", requestId: 2, focused: true });
  assert.isTrue(await prepared);
  assert.lengthOf(workerConstructorMock.mock.calls, 2);
  thread.close();
});

it("forwards evict messages to the worker immediately when ready or queues them until ready", () => {
  const thread = startWindowsForegroundFocusThread("focus.cjs");
  thread.evict(11);
  assert.lengthOf(worker.postMessage.mock.calls, 0);

  worker.emit("message", "ready");
  assert.deepEqual(worker.postMessage.mock.calls[0]?.[0], {
    type: "evict",
    windowId: 11,
  });

  thread.evict(12);
  assert.deepEqual(worker.postMessage.mock.calls[1]?.[0], {
    type: "evict",
    windowId: 12,
  });
  thread.close();
});

it("bounds cached focus elements with LRU eviction and supports explicit delete", () => {
  assert.equal(MAX_CACHED_FOCUS_ELEMENTS, 16);
  const cache = createFocusElementCache<string>(3);
  cache.set(1, "el-1");
  cache.set(2, "el-2");
  cache.set(3, "el-3");
  assert.equal(cache.size, 3);

  // Touch window 1 so window 2 becomes the LRU entry.
  assert.equal(cache.get(1), "el-1");
  cache.set(4, "el-4");
  assert.equal(cache.size, 3);
  assert.isUndefined(cache.get(2));
  assert.equal(cache.get(1), "el-1");
  assert.equal(cache.get(3), "el-3");
  assert.equal(cache.get(4), "el-4");

  assert.isTrue(cache.delete(3));
  assert.equal(cache.size, 2);
  assert.isUndefined(cache.get(3));
});
