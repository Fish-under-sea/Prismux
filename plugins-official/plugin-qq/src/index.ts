import type {
  CallerScope,
  PluginContext,
  PluginManifest
} from "@prismux/protocol";

export const manifest: PluginManifest = {
  id: "qq",
  version: "0.1.0",
  realms: ["daemon", "ui"],
  permissions: [
    "network:outbound",
    "network:inbound",
    "memory:social-qq",
    "hooks:subscribe"
  ],
  modelVisible: false,
  behaviors: {
    autostart: true,
    supportsLoopbackTest: true
  }
};

export interface OneBotConnectionConfig {
  mode: "forward-ws" | "reverse-ws";
  wsUrl: string;
  ownerQqId: string;
  authorizedGroups: string[];
}

export function resolveGroupCallerScope(groupId: string): CallerScope {
  return `qq_group:${groupId}`;
}

export function apply(ctx: PluginContext): void {
  let active = true;
  ctx.logger.info("Initialized @prismux/plugin-qq scaffold", {
    realm: ctx.realm
  });

  ctx.effect(() => {
    active = false;
    ctx.logger.info("Disposed @prismux/plugin-qq scaffold", { active });
  });
}
