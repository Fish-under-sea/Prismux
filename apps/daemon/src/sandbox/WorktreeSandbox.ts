import { resolve } from "node:path";
import process from "node:process";

export type SandboxPlatformBackend =
  | "bwrap"
  | "landlock"
  | "sandbox-exec"
  | "windows-restricted-token";

export interface NetworkEgressPolicy {
  enabled: boolean;
  allowedDomains: string[];
  proxyPort?: number;
}

export interface WorktreeSandboxPolicy {
  worktreePath: string;
  writableTempDirs: string[];
  backend: SandboxPlatformBackend;
  egress: NetworkEgressPolicy;
}

export const DEFAULT_ALLOWED_EGRESS_DOMAINS = [
  "github.com",
  "registry.npmjs.org"
] as const;

export function selectPlatformSandboxBackend(
  platform: NodeJS.Platform
): SandboxPlatformBackend {
  if (platform === "linux") {
    return "bwrap";
  }
  if (platform === "darwin") {
    return "sandbox-exec";
  }
  return "windows-restricted-token";
}

/**
 * OS-level filesystem write isolation + local HTTP proxy egress gate for unattended worktrees.
 */
export class WorktreeSandbox {
  createPolicy(options: {
    worktreePath: string;
    writableTempDirs?: string[];
    egressEnabled?: boolean;
    allowedDomains?: string[];
    platform?: NodeJS.Platform;
  }): WorktreeSandboxPolicy {
    return {
      worktreePath: resolve(options.worktreePath),
      writableTempDirs: (options.writableTempDirs ?? []).map((dir) =>
        resolve(dir)
      ),
      backend: selectPlatformSandboxBackend(options.platform ?? process.platform),
      egress: {
        enabled: options.egressEnabled ?? false,
        allowedDomains: options.allowedDomains ?? [
          ...DEFAULT_ALLOWED_EGRESS_DOMAINS
        ]
      }
    };
  }

  isWriteTargetAllowed(
    policy: WorktreeSandboxPolicy,
    targetPath: string
  ): boolean {
    const normalizedTarget = resolve(targetPath);
    const allowedRoots = [policy.worktreePath, ...policy.writableTempDirs];
    return allowedRoots.some(
      (root) =>
        normalizedTarget === root ||
        normalizedTarget.startsWith(`${root}/`) ||
        normalizedTarget.startsWith(`${root}\\`)
    );
  }
}
