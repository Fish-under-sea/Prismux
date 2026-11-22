import type {
  IslandHookEvent,
  PluginContext,
  PluginManifest
} from "@prismux/protocol";

export const manifest: PluginManifest = {
  id: "fishdock-hook",
  version: "0.1.0",
  realms: ["daemon"],
  permissions: ["network:outbound", "hooks:subscribe", "notifications:push"],
  modelVisible: false,
  behaviors: {
    autostart: true
  }
};

export interface FishDockBridgeConfig {
  endpointUrl: string;
}

export function createApprovalIslandCard(options: {
  cardId: string;
  title: string;
  deepLink?: string;
}): IslandHookEvent {
  return {
    cardId: options.cardId,
    kind: "approval",
    title: options.title,
    deepLink: options.deepLink,
    actions: ["approve", "reject", "open_workbench"],
    createdAt: Date.now()
  };
}

export function apply(ctx: PluginContext): void {
  ctx.logger.info("Initialized @prismux/plugin-fishdock-hook scaffold", {
    realm: ctx.realm
  });

  ctx.effect(() => {
    ctx.logger.info("Disposed @prismux/plugin-fishdock-hook scaffold");
  });
}
