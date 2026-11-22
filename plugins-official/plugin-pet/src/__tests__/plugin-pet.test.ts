import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  HookInvocationContext,
  LifecycleHookEvent,
  PluginContext,
  PluginCredentialsHandle,
  PluginDisposable,
  PluginRealm
} from "@prismux/protocol";
import {
  apply,
  applyWithOptions,
  getPetController,
  isLeaseValid,
  manifest,
  PET_ACTION_NAMESPACE,
  PetBridgeController,
  PetNamespaceViolationError,
  PetUnknownInstanceError,
  type PetPlaybackProgress
} from "../index.js";

function createTestPluginHarness(realm: PluginRealm): {
  ctx: PluginContext;
  routes: Map<string, unknown>;
  hooks: Array<{
    event: LifecycleHookEvent;
    handler: (ctx: HookInvocationContext) => unknown;
  }>;
  panels: Map<string, { title: string; component?: unknown }>;
  dispose: () => Promise<void>;
} {
  const disposables: PluginDisposable[] = [];
  const routes = new Map<string, unknown>();
  const hooks: Array<{
    event: LifecycleHookEvent;
    handler: (ctx: HookInvocationContext) => unknown;
  }> = [];
  const panels = new Map<string, { title: string; component?: unknown }>();
  const credStore = new Map<string, string>();

  const credentials: PluginCredentialsHandle = {
    async get(key: string): Promise<string | null> {
      return credStore.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      credStore.set(key, value);
    },
    async delete(key: string): Promise<void> {
      credStore.delete(key);
    }
  };

  const ctx: PluginContext = {
    manifest,
    realm,
    distribution: "managed",
    effect(disposable: PluginDisposable): void {
      disposables.push(disposable);
    },
    credentials,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    onHook(event, handler): void {
      const entry = { event, handler };
      hooks.push(entry);
      disposables.push(() => {
        const idx = hooks.indexOf(entry);
        if (idx >= 0) {
          hooks.splice(idx, 1);
        }
      });
    },
    registerRoute(method, path, handler): void {
      const key = `${method} ${path}`;
      routes.set(key, handler);
      disposables.push(() => {
        routes.delete(key);
      });
    },
    registerPanel(panelId, definition): void {
      panels.set(panelId, definition);
      disposables.push(() => {
        panels.delete(panelId);
      });
    }
  };

  return {
    ctx,
    routes,
    hooks,
    panels,
    async dispose(): Promise<void> {
      while (disposables.length > 0) {
        const fn = disposables.pop();
        if (fn) {
          await fn();
        }
      }
    }
  };
}

describe("@prismux/plugin-pet (dsh-pet Issue #122)", () => {
  test("routes commands strictly to bound target instance without driving sibling instances", () => {
    const controller = new PetBridgeController();
    controller.registerInstance("desktop-main", {
      kind: "desktop",
      windowLabel: "main"
    });
    controller.registerInstance("web-tab-2", {
      kind: "web",
      title: "Preview Tab"
    });

    const lease = controller.acquireLease("desktop-main", { ttlMs: 10_000 });
    const res = controller.executeAction("desktop-main", lease, {
      motion: "wave",
      playbackId: "pb-wave-1",
      bubbleText: "有新邮件",
      bubbleKind: "email"
    });

    assert.equal(res.accepted, true);
    assert.equal(res.instanceId, "desktop-main");
    assert.equal(res.motionOwner, "plugin");
    assert.equal(res.bubbleOwner, "plugin");

    const desktopState = controller.getInstance("desktop-main");
    const webState = controller.getInstance("web-tab-2");
    assert.equal(desktopState?.activeMotion?.motionName, "wave");
    assert.equal(desktopState?.activeBubble?.text, "有新邮件");

    // Sibling web instance remains 100% native and untouched.
    assert.equal(webState?.motionOwner, "native");
    assert.equal(webState?.bubbleOwner, "native");
    assert.equal(webState?.activeMotion, null);
    assert.equal(webState?.activeBubble, null);

    // Unknown instance rejected cleanly.
    const unknownRes = controller.executeAction("ghost-window", lease.leaseId, {
      motion: "jump"
    });
    assert.equal(unknownRes.accepted, false);
    assert.equal(unknownRes.reason, "unknown_instance");
    assert.throws(
      () => controller.acquireLease("ghost-window"),
      PetUnknownInstanceError
    );

    controller.dispose();
  });

  test("enforces monotonic lease generations and rejects stale or expired leases", () => {
    let clock = 1_000_000;
    const controller = new PetBridgeController({
      defaultLeaseTtlMs: 5_000,
      nowFn: () => clock
    });
    controller.registerInstance("win-1", { kind: "desktop" });

    const lease1 = controller.acquireLease("win-1");
    assert.equal(lease1.generation, 1);
    assert.equal(isLeaseValid(lease1, clock), true);

    // Acquire superseding lease2 -> generation advances monotonically 1 -> 2.
    const lease2 = controller.acquireLease("win-1");
    assert.equal(lease2.generation, 2);
    assert.notEqual(lease2.leaseId, lease1.leaseId);

    // Late requests arriving with stale lease1 must be rejected and must NOT affect lease2.
    const staleAction = controller.executeAction("win-1", lease1, {
      motion: "dance"
    });
    assert.equal(staleAction.accepted, false);
    assert.equal(staleAction.reason, "stale_lease");

    const staleRenew = controller.renewLease("win-1", lease1);
    assert.equal(staleRenew.accepted, false);
    assert.equal(staleRenew.reason, "stale_lease");

    const staleRelease = controller.releaseLease("win-1", lease1);
    assert.equal(staleRelease.released, false);
    assert.equal(staleRelease.reason, "stale_lease");

    // Current lease2 still works and renews cleanly before expiry.
    const renewed = controller.renewLease("win-1", lease2, 3_000);
    assert.equal(renewed.accepted, true);
    assert.equal(renewed.lease?.expiresAt, clock + 3_000);

    const activeAction = controller.executeAction("win-1", lease2.leaseId, {
      motion: "nod"
    });
    assert.equal(activeAction.accepted, true);
    assert.equal(activeAction.generation, 2);

    // Advance clock past expiry -> rejected with expired_lease.
    clock += 3_001;
    assert.equal(isLeaseValid(renewed.lease!, clock), false);

    const expiredAction = controller.executeAction("win-1", lease2, {
      motion: "sleep"
    });
    assert.equal(expiredAction.accepted, false);
    assert.equal(expiredAction.reason, "expired_lease");

    const expiredHandover = controller.handoverMotion("win-1", lease2.leaseId);
    assert.equal(expiredHandover.accepted, false);
    assert.equal(expiredHandover.reason, "expired_lease");

    // Releasing a valid lease invalidates subsequent usage as stale_lease.
    const lease3 = controller.acquireLease("win-1");
    assert.equal(lease3.generation, 3);
    const released = controller.releaseLease("win-1", lease3);
    assert.equal(released.released, true);
    const afterRelease = controller.executeAction("win-1", lease3, {
      motion: "walk"
    });
    assert.equal(afterRelease.accepted, false);
    assert.equal(afterRelease.reason, "stale_lease");

    controller.dispose();
  });

  test("delivers Object.freeze immutable playback progress snapshots and cleans up subscriptions", () => {
    const controller = new PetBridgeController();
    controller.registerInstance("win-a");
    controller.registerInstance("win-b");

    const seenA: PetPlaybackProgress[] = [];
    const seenAll: Array<{ snap: Readonly<PetPlaybackProgress>; instanceId?: string }> = [];

    const unsubA = controller.subscribePlaybackProgress(
      (snapshot) => {
        assert.equal(Object.isFrozen(snapshot), true);
        // Attempted mutation in strict mode must throw TypeError and never corrupt data.
        assert.throws(() => {
          (snapshot as { currentTime: number }).currentTime = 999;
        }, TypeError);
        seenA.push(snapshot);
      },
      { instanceId: "win-a" }
    );

    const unsubAll = controller.subscribePlaybackProgress((snapshot, meta) => {
      assert.equal(Object.isFrozen(snapshot), true);
      seenAll.push({ snap: snapshot, instanceId: meta.instanceId });
    });

    assert.equal(controller.getSubscriberCount(), 2);

    const emitted1 = controller.emitPlaybackProgress(
      {
        playbackId: "pb-101",
        currentTime: 1.25,
        duration: 4.5,
        buffering: false
      },
      "win-a"
    );
    assert.equal(Object.isFrozen(emitted1), true);
    assert.equal(seenA.length, 1);
    assert.equal(seenAll.length, 1);
    assert.equal(seenA[0]?.currentTime, 1.25);

    // Emitting for win-b only notifies global subscriber, not win-a filtered subscriber.
    controller.emitPlaybackProgress(
      {
        playbackId: "pb-202",
        currentTime: 0.5,
        duration: 2.0,
        buffering: true
      },
      "win-b"
    );
    assert.equal(seenA.length, 1);
    assert.equal(seenAll.length, 2);
    assert.equal(seenAll[1]?.instanceId, "win-b");
    assert.equal(controller.getLastPlaybackProgress("win-a")?.playbackId, "pb-101");

    unsubA();
    unsubAll();
    assert.equal(controller.getSubscriberCount(), 0);
    controller.dispose();
  });

  test("performs staged independent handover: handoverMotion resumes native motion while preserving bubble until handoverBubble", async () => {
    const controller = new PetBridgeController();
    controller.registerInstance("win-stage", { kind: "desktop" });
    const lease = controller.acquireLease("win-stage", { ttlMs: 15_000 });

    const started = controller.executeAction("win-stage", lease, {
      motion: "factory_celebrate",
      playbackId: "pb-factory-88",
      bubbleText: "夜间工场已完工",
      bubbleKind: "factory_complete",
      deepLink: "prismux://review/thread-88"
    });
    assert.equal(started.accepted, true);
    assert.equal(started.motionOwner, "plugin");
    assert.equal(started.bubbleOwner, "plugin");

    // Stage 1: Hand over motion ONLY -> native motion resumes, bubble remains visible!
    const stage1 = controller.handoverMotion("win-stage", lease.leaseId);
    assert.equal(stage1.accepted, true);
    assert.equal(stage1.motionOwner, "native");
    assert.equal(stage1.bubbleOwner, "plugin");
    assert.equal(stage1.bubblePreserved, true);
    assert.equal(stage1.activeBubble?.text, "夜间工场已完工");
    assert.equal(stage1.activeBubble?.deepLink, "prismux://review/thread-88");

    const midSnapshot = controller.getInstance("win-stage");
    assert.equal(midSnapshot?.motionOwner, "native");
    assert.equal(midSnapshot?.activeMotion, null);
    assert.equal(midSnapshot?.bubbleOwner, "plugin");
    assert.equal(midSnapshot?.activeBubble?.text, "夜间工场已完工");

    // Stage 2: Hand over bubble independently -> bubble released back to native.
    const stage2 = controller.handoverBubble("win-stage", lease.leaseId);
    assert.equal(stage2.accepted, true);
    assert.equal(stage2.motionOwner, "native");
    assert.equal(stage2.bubbleOwner, "native");
    assert.equal(stage2.bubblePreserved, false);
    assert.equal(stage2.activeBubble, null);

    // Also verify timed bubble handover and clean timer cancellation on dispose.
    controller.executeAction("win-stage", lease, {
      bubbleText: "有新邮件"
    });
    controller.scheduleBubbleHandoverTimeout("win-stage", lease.leaseId, 50);
    assert.equal(controller.getActiveTimerCount(), 1);
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    assert.equal(controller.getInstance("win-stage")?.activeBubble, null);
    assert.equal(controller.getInstance("win-stage")?.bubbleOwner, "native");
    assert.equal(controller.getActiveTimerCount(), 0);

    controller.dispose();
  });

  test("isolates prismux.pet.* actions, protects globalConfig immutability, and unloads cleanly via ctx.effect", async () => {
    const userGlobalConfig = {
      theme: "dark",
      roamEnabled: true,
      bubbleSettings: { maxWidth: 260, sound: false }
    };
    const originalSnapshot = structuredClone(userGlobalConfig);

    const daemonHarness = createTestPluginHarness("daemon");
    const uiHarness = createTestPluginHarness("ui");

    const controller = applyWithOptions(daemonHarness.ctx, {
      globalConfig: userGlobalConfig
    });
    apply(uiHarness.ctx);

    assert.ok(getPetController(daemonHarness.ctx) === controller);
    assert.equal(daemonHarness.routes.has("GET /plugins/pet/instances"), true);
    assert.equal(daemonHarness.routes.has("POST /plugins/pet/lease"), true);
    assert.equal(daemonHarness.routes.has("POST /plugins/pet/action"), true);
    assert.equal(daemonHarness.routes.has("POST /plugins/pet/handover"), true);
    assert.equal(uiHarness.panels.has("pet.mascot"), true);

    // Every registered action belongs strictly to prismux.pet.* namespace.
    const registeredActions = controller.getRegisteredActions();
    assert.ok(registeredActions.length >= 8);
    for (const actionName of registeredActions) {
      assert.equal(actionName.startsWith(`${PET_ACTION_NAMESPACE}.`), true);
    }

    assert.throws(
      () =>
        controller.registerNamespaceAction("global.setTheme", () => "hacked"),
      PetNamespaceViolationError
    );

    controller.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.ping`,
      (msg: string) => `pong:${msg}`
    );
    assert.equal(
      controller.invokeNamespaceAction(`${PET_ACTION_NAMESPACE}.ping`, "ok"),
      "pong:ok"
    );

    // Read-only globalConfig cannot be mutated and user's object remains untouched.
    const roConfig = controller.getGlobalConfig() as {
      theme: string;
      bubbleSettings: { maxWidth: number };
    };
    assert.throws(() => {
      roConfig.theme = "light";
    }, TypeError);
    assert.throws(() => {
      roConfig.bubbleSettings.maxWidth = 999;
    }, TypeError);
    assert.deepEqual(userGlobalConfig, originalSnapshot);

    // Register instance, lease, subscriber, and pending timer before uninstalling.
    controller.registerInstance("desktop-1");
    const lease = controller.acquireLease("desktop-1");
    controller.executeAction("desktop-1", lease, {
      motion: "idle",
      bubbleText: "准备卸载"
    });
    controller.scheduleBubbleHandoverTimeout("desktop-1", lease, 5_000);
    controller.subscribePlaybackProgress(() => undefined);
    assert.equal(controller.getSubscriberCount(), 1);
    assert.equal(controller.getActiveTimerCount(), 1);

    // Unmount both realms via ctx.effect -> zero actions, leases, subscribers, timers, or routes remain!
    await daemonHarness.dispose();
    await uiHarness.dispose();

    assert.equal(controller.isDisposed(), true);
    assert.equal(getPetController(daemonHarness.ctx), undefined);
    assert.deepEqual(controller.getRegisteredActions(), []);
    assert.equal(controller.getSubscriberCount(), 0);
    assert.equal(controller.getActiveTimerCount(), 0);
    assert.deepEqual(controller.listInstances(), []);
    assert.equal(daemonHarness.routes.size, 0);
    assert.equal(daemonHarness.hooks.length, 0);
    assert.equal(uiHarness.panels.size, 0);
    assert.deepEqual(userGlobalConfig, originalSnapshot);
  });
});
