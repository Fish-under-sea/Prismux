import type { PluginContext, PluginManifest } from "@prismux/protocol";

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

export interface PetLeaseToken {
  leaseId: string;
  instanceId: string;
  expiresAt: number;
}

export interface PetPlaybackProgress {
  playbackId: string;
  currentTime: number;
  duration: number;
  buffering: boolean;
}

export function isLeaseValid(lease: PetLeaseToken, now = Date.now()): boolean {
  return lease.expiresAt > now;
}

export function apply(ctx: PluginContext): void {
  ctx.logger.info("Initialized @prismux/plugin-pet scaffold", {
    realm: ctx.realm
  });

  ctx.effect(() => {
    ctx.logger.info("Disposed @prismux/plugin-pet namespace actions and leases");
  });
}
