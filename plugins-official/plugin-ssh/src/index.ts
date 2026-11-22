import type {
  PluginContext,
  PluginManifest,
  PrismuxPluginModule
} from "@prismux/protocol";
import {
  SshHostPool,
  type SshHostSecretInput
} from "./hostPool.js";
import { SshSessionManager } from "./sessions.js";
import {
  resolveSafeSftpPath,
  type BuildSafeSshArgsOptions,
  type SshHostProfile
} from "./validation.js";

export * from "./validation.js";
export * from "./hostPool.js";
export * from "./sessions.js";

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

export interface SshPluginRuntime {
  pool?: SshHostPool;
  sessions?: SshSessionManager;
}

export interface CreateSshPluginOptions {
  storagePath?: string;
  onRuntimeCreated?: (runtime: SshPluginRuntime) => void;
}

export function applyWithOptions(
  ctx: PluginContext,
  options: CreateSshPluginOptions = {}
): SshPluginRuntime {
  ctx.logger.info("Initialized @prismux/plugin-ssh", {
    realm: ctx.realm
  });

  if (ctx.realm === "ui") {
    ctx.registerPanel?.("ssh-workbench", {
      title: "SSH 主机池与 SFTP 运维"
    });
    ctx.effect(() => {
      ctx.logger.info("Disposed @prismux/plugin-ssh UI panel");
    });
    const runtime: SshPluginRuntime = {};
    options.onRuntimeCreated?.(runtime);
    return runtime;
  }

  const pool = new SshHostPool({
    credentials: ctx.credentials,
    ...(options.storagePath !== undefined
      ? { storagePath: options.storagePath }
      : {})
  });
  pool.loadFromDisk();
  const sessions = new SshSessionManager();

  ctx.registerRoute?.("GET", "/plugins/ssh/hosts", () => ({
    hosts: pool.listHosts()
  }));

  ctx.registerRoute?.(
    "POST",
    "/plugins/ssh/hosts",
    async (payload: { profile: SshHostProfile; secrets?: SshHostSecretInput }) => {
      const saved = await pool.upsertHost(payload.profile, payload.secrets);
      return { host: saved };
    }
  );

  ctx.registerRoute?.(
    "DELETE",
    "/plugins/ssh/hosts",
    async (payload: { id: string }) => {
      const deleted = await pool.deleteHost(payload.id);
      return { id: payload.id, deleted };
    }
  );

  ctx.registerRoute?.(
    "POST",
    "/plugins/ssh/sessions/prepare",
    (payload: {
      hostId: string;
      kind?: "pty" | "sftp";
      options?: BuildSafeSshArgsOptions;
      onClose?: () => void | Promise<void>;
    }) => {
      const spec = pool.buildSpawnSpec(payload.hostId, payload.options);
      const session = sessions.openSession({
        hostId: payload.hostId,
        kind: payload.kind ?? "pty",
        command: spec.command,
        args: spec.args,
        ...(payload.onClose !== undefined ? { onClose: payload.onClose } : {})
      });
      return { session, spawn: spec };
    }
  );

  ctx.registerRoute?.(
    "POST",
    "/plugins/ssh/sftp/resolve",
    (payload: { hostId?: string; rootDir?: string; requestedPath: string }) => {
      const host =
        payload.hostId !== undefined ? pool.getHost(payload.hostId) : undefined;
      const rootDir = payload.rootDir ?? host?.sftpRootDir ?? "";
      const resolvedPath = resolveSafeSftpPath(rootDir, payload.requestedPath);
      return { resolvedPath };
    }
  );

  ctx.effect(async () => {
    await sessions.closeAll();
    pool.clearMemory();
    ctx.logger.info("Disposed @prismux/plugin-ssh host pool and PTY/SFTP sessions");
  });

  const runtime: SshPluginRuntime = { pool, sessions };
  options.onRuntimeCreated?.(runtime);
  return runtime;
}

export function createSshPluginModule(
  options: CreateSshPluginOptions = {}
): PrismuxPluginModule {
  return {
    manifest,
    apply(ctx: PluginContext): void {
      applyWithOptions(ctx, options);
    }
  };
}

export function apply(ctx: PluginContext): void {
  applyWithOptions(ctx);
}
