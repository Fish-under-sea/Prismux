import { assert, describe, it } from "@effect/vitest";

import {
  createElectronKeepAwakeController,
  PrismuxKeepAwakeController,
  type KeepAwakeBlockerType,
  type PowerSaveBlockerApi,
} from "./PrismuxKeepAwakeController.ts";

function createFakePowerSaveBlocker() {
  let nextId = 10;
  const activeIds = new Set<number>();
  const startedTypes: KeepAwakeBlockerType[] = [];
  const stoppedIds: number[] = [];

  const api: PowerSaveBlockerApi = {
    start: (type) => {
      const id = nextId++;
      activeIds.add(id);
      startedTypes.push(type);
      return id;
    },
    stop: (id) => {
      activeIds.delete(id);
      stoppedIds.push(id);
    },
    isStarted: (id) => activeIds.has(id),
  };

  return {
    api,
    activeIds,
    startedTypes,
    stoppedIds,
  };
}

describe("PrismuxKeepAwakeController", () => {
  it("starts prevent-app-suspension once and stays idempotent on repeated enable calls", () => {
    const fake = createFakePowerSaveBlocker();
    const controller = new PrismuxKeepAwakeController(fake.api);

    assert.deepEqual(controller.getState(), {
      enabled: false,
      blockerId: null,
      active: false,
    });

    const first = controller.setEnabled(true);
    assert.deepEqual(first, { enabled: true, blockerId: 10, active: true });
    assert.deepEqual(fake.startedTypes, ["prevent-app-suspension"]);
    assert.equal(fake.activeIds.size, 1);

    // Calling setEnabled(true) repeatedly must NOT leak duplicate powerSaveBlocker IDs.
    const second = controller.setEnabled(true);
    const third = controller.setEnabled(true);
    assert.deepEqual(second, { enabled: true, blockerId: 10, active: true });
    assert.deepEqual(third, { enabled: true, blockerId: 10, active: true });
    assert.equal(fake.startedTypes.length, 1);
    assert.equal(fake.activeIds.size, 1);
  });

  it("stops active blocker on disable and stays idempotent on repeated disable calls", () => {
    const fake = createFakePowerSaveBlocker();
    const controller = new PrismuxKeepAwakeController(fake.api);

    controller.setEnabled(true);
    assert.equal(fake.activeIds.size, 1);

    const disabled = controller.setEnabled(false);
    assert.deepEqual(disabled, { enabled: false, blockerId: null, active: false });
    assert.deepEqual(fake.stoppedIds, [10]);
    assert.equal(fake.activeIds.size, 0);

    // Repeated disable must not call stop() again.
    const disabledAgain = controller.setEnabled(false);
    assert.deepEqual(disabledAgain, { enabled: false, blockerId: null, active: false });
    assert.deepEqual(fake.stoppedIds, [10]);
  });

  it("reconciles externally stopped blocker IDs and creates a fresh blocker on re-enable", () => {
    const fake = createFakePowerSaveBlocker();
    const controller = new PrismuxKeepAwakeController(fake.api);

    const started = controller.setEnabled(true);
    assert.equal(started.blockerId, 10);

    // Simulate OS / Electron stopping blocker externally.
    fake.activeIds.delete(10);
    assert.deepEqual(controller.getState(), {
      enabled: false,
      blockerId: null,
      active: false,
    });

    const restarted = controller.setEnabled(true);
    assert.deepEqual(restarted, { enabled: true, blockerId: 11, active: true });
    assert.equal(fake.startedTypes.length, 2);
  });

  it("registers before-quit and will-quit cleanup hooks that release the blocker once", () => {
    const fake = createFakePowerSaveBlocker();
    const listeners: Record<string, Array<() => void>> = {};

    const controller = createElectronKeepAwakeController({
      blocker: fake.api,
      app: {
        once: (event, listener) => {
          listeners[event] ??= [];
          listeners[event].push(listener);
        },
      },
    });

    controller.setEnabled(true);
    assert.equal(fake.activeIds.size, 1);
    assert.equal(listeners["before-quit"]?.length, 1);
    assert.equal(listeners["will-quit"]?.length, 1);

    // Fire before-quit -> stops blocker.
    for (const fn of listeners["before-quit"] ?? []) fn();
    assert.equal(fake.activeIds.size, 0);
    assert.deepEqual(fake.stoppedIds, [10]);
    assert.deepEqual(controller.getState(), {
      enabled: false,
      blockerId: null,
      active: false,
    });

    // Fire will-quit -> idempotent no-op.
    for (const fn of listeners["will-quit"] ?? []) fn();
    assert.deepEqual(fake.stoppedIds, [10]);
  });
});
