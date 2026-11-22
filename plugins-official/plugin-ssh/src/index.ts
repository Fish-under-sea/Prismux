import type { PluginContext, PluginManifest } from "@prismux/protocol";

export const manifest: PluginManifest = {
  id: "ssh",
  version: "0.1.0",
  realms: ["daemon", "ui"],
  permissions: [
    "network:outbound",
    "pty:spawn",
    "fs:read",
    "fs:write",
    "ui:panel"
  ],
  modelVisible: false,
  behaviors: {
    autostart: false,
    requiresConfiguration: true
  }
};

export interface SshHostProfile {
  id: string;
  host: string;
  port: number;
  username: string;
}

export function apply(ctx: PluginContext): void {
  ctx.logger.info("Initialized @prismux/plugin-ssh scaffold", {
    realm: ctx.realm
  });

  ctx.effect(() => {
    ctx.logger.info("Disposed @prismux/plugin-ssh host pool and PTY sessions");
  });
}
