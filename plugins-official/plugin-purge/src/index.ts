import type { PluginContext, PluginManifest } from "@prismux/protocol";

export const manifest: PluginManifest = {
  id: "purge",
  version: "0.1.0",
  realms: ["daemon", "ui"],
  permissions: ["hooks:intercept", "ui:panel"],
  modelVisible: false,
  behaviors: {
    autostart: false
  }
};

export interface PurgeRule {
  id: string;
  pattern: string;
  action: "redact" | "block" | "rollback";
}

export function apply(ctx: PluginContext): void {
  ctx.logger.info("Initialized @prismux/plugin-purge scaffold", {
    realm: ctx.realm
  });

  ctx.effect(() => {
    ctx.logger.info("Disposed @prismux/plugin-purge interceptors");
  });
}
