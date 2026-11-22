import type {
  HookInvocationContext,
  PluginContext,
  PluginManifest
} from "@prismux/protocol";
import { PetBridgeController } from "./bridge.js";
import type {
  PetActionRequest,
  PetBridgeControllerOptions,
  PetInstanceMeta
} from "./types.js";

export * from "./types.js";
export * from "./bridge.js";

export const manifest: PluginManifest = {
  id: "pet",
  version: "0.1.0",
  realms: ["ui", "daemon"],
  permissions: ["pet:lease", "ui:panel", "hooks:subscribe"],
  modelVisible: false,
  behaviors: {
    autostart: true
  }
};

export interface PetPluginModuleOptions extends PetBridgeControllerOptions {
  onHookNotice?: (
    hookCtx: HookInvocationContext,
    controller: PetBridgeController
  ) => Promise<void> | void;
}

const controllerByContext = new WeakMap<PluginContext, PetBridgeController>();

export function getPetController(
  ctx: PluginContext
): PetBridgeController | undefined {
  return controllerByContext.get(ctx);
}

export function applyWithOptions(
  ctx: PluginContext,
  options?: PetPluginModuleOptions
): PetBridgeController {
  const controller = new PetBridgeController(options);
  controllerByContext.set(ctx, controller);

  if (ctx.realm === "daemon") {
    ctx.registerRoute?.("GET", "/plugins/pet/instances", () =>
      controller.listInstances()
    );
    ctx.registerRoute?.(
      "POST",
      "/plugins/pet/instances",
      (body: { instanceId: string; meta?: PetInstanceMeta }) =>
        controller.registerInstance(body.instanceId, body.meta)
    );
    ctx.registerRoute?.(
      "POST",
      "/plugins/pet/lease",
      (body: { instanceId: string; ttlMs?: number; ownerId?: string }) =>
        controller.acquireLease(body.instanceId, {
          ttlMs: body.ttlMs,
          ownerId: body.ownerId
        })
    );
    ctx.registerRoute?.("POST", "/plugins/pet/action", (body: PetActionRequest) =>
      controller.executeAction(body)
    );
    ctx.registerRoute?.(
      "POST",
      "/plugins/pet/handover",
      (body: { stage: "motion" | "bubble"; instanceId: string; leaseId: string }) =>
        body.stage === "motion"
          ? controller.handoverMotion(body.instanceId, body.leaseId)
          : controller.handoverBubble(body.instanceId, body.leaseId)
    );
  }

  if (ctx.realm === "ui") {
    ctx.registerPanel?.("pet.mascot", {
      title: "桌面宠物联动"
    });
  }

  ctx.onHook?.("Stop", async (hookCtx) => {
    if (!controller.isDisposed()) {
      await options?.onHookNotice?.(hookCtx, controller);
    }
  });

  ctx.onHook?.("Notification", async (hookCtx) => {
    if (!controller.isDisposed()) {
      await options?.onHookNotice?.(hookCtx, controller);
    }
  });

  ctx.logger.info("Initialized @prismux/plugin-pet bridge controller", {
    realm: ctx.realm,
    actions: controller.getRegisteredActions().length
  });

  ctx.effect(() => {
    controller.dispose();
    controllerByContext.delete(ctx);
    ctx.logger.info("Disposed @prismux/plugin-pet namespace actions, leases, and subscribers");
  });

  return controller;
}

export function createPetPluginModule(options?: PetPluginModuleOptions): {
  manifest: PluginManifest;
  apply: (ctx: PluginContext) => void;
  getController: (ctx: PluginContext) => PetBridgeController | undefined;
} {
  return {
    manifest,
    apply(ctx: PluginContext): void {
      applyWithOptions(ctx, options);
    },
    getController(ctx: PluginContext): PetBridgeController | undefined {
      return getPetController(ctx);
    }
  };
}

export function apply(ctx: PluginContext): void {
  applyWithOptions(ctx);
}
