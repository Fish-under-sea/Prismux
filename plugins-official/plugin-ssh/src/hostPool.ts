import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PluginCredentialsHandle } from "@prismux/protocol";
import {
  SshSecurityError,
  SshValidationError,
  buildSafeSshArgs,
  validatePrivateKeyPath,
  validateSshHost,
  validateSshHostId,
  validateSshPort,
  validateSshUsername,
  type BuildSafeSshArgsOptions,
  type SshHostProfile
} from "./validation.js";

const FORBIDDEN_INLINE_SECRET_KEYS = [
  "password",
  "passphrase",
  "privateKey",
  "privateKeyPem",
  "secret",
  "token"
] as const;

const CREDENTIAL_SECRET_FIELDS = [
  "password",
  "passphrase",
  "privateKeyPem"
] as const;

export interface SshHostSecretInput {
  password?: string;
  passphrase?: string;
  privateKeyPem?: string;
}

export interface SshHostPoolOptions {
  credentials: PluginCredentialsHandle;
  storagePath?: string;
}

export interface SshSpawnSpec {
  command: "ssh";
  args: string[];
  shell: false;
  profile: SshHostProfile;
}

function buildCredentialKey(
  hostId: string,
  field: (typeof CREDENTIAL_SECRET_FIELDS)[number]
): string {
  return `ssh:host:${hostId}:${field}`;
}

function buildCredentialRef(hostId: string): string {
  return `ssh:host:${hostId}`;
}

/**
 * Ensures plain profile objects or persisted JSON never carry inline passwords, passphrases, or keys.
 */
export function assertNoInlineSecrets(candidate: unknown): void {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return;
  }
  const record = candidate as Record<string, unknown>;
  for (const forbiddenKey of FORBIDDEN_INLINE_SECRET_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(record, forbiddenKey) &&
      record[forbiddenKey] !== undefined
    ) {
      throw new SshSecurityError(
        `Inline secret field "${forbiddenKey}" is forbidden in SshHostProfile; secrets must be written exclusively to ctx.credentials.`
      );
    }
  }
}

function sanitizeProfileRecord(profile: SshHostProfile): SshHostProfile {
  assertNoInlineSecrets(profile);
  const id = validateSshHostId(profile.id);
  const host = validateSshHost(profile.host);
  const port = validateSshPort(profile.port);
  const username = validateSshUsername(profile.username);
  const privateKeyPath =
    profile.privateKeyPath !== undefined && profile.privateKeyPath.trim().length > 0
      ? validatePrivateKeyPath(profile.privateKeyPath)
      : undefined;

  return {
    id,
    host,
    port,
    username,
    ...(profile.label !== undefined ? { label: profile.label } : {}),
    ...(profile.authType !== undefined ? { authType: profile.authType } : {}),
    ...(privateKeyPath !== undefined ? { privateKeyPath } : {}),
    ...(profile.sftpRootDir !== undefined
      ? { sftpRootDir: profile.sftpRootDir }
      : {}),
    ...(profile.knownHostsPolicy !== undefined
      ? { knownHostsPolicy: profile.knownHostsPolicy }
      : {}),
    ...(profile.credentialRef !== undefined
      ? { credentialRef: profile.credentialRef }
      : {}),
    ...(profile.tags !== undefined ? { tags: [...profile.tags] } : {}),
    createdAt: profile.createdAt ?? Date.now(),
    updatedAt: profile.updatedAt ?? Date.now()
  };
}

/**
 * SSH host pool with CRUD operations and strict secret isolation via `ctx.credentials`.
 */
export class SshHostPool {
  private readonly credentials: PluginCredentialsHandle;
  private readonly storagePath: string | undefined;
  private readonly hosts = new Map<string, SshHostProfile>();

  constructor(options: SshHostPoolOptions) {
    this.credentials = options.credentials;
    this.storagePath = options.storagePath;
  }

  getHost(hostId: string): SshHostProfile | undefined {
    const existing = this.hosts.get(hostId);
    if (existing === undefined) {
      return undefined;
    }
    return {
      ...existing,
      ...(existing.tags !== undefined ? { tags: [...existing.tags] } : {})
    };
  }

  listHosts(): SshHostProfile[] {
    return Array.from(this.hosts.values()).map((profile) => ({
      ...profile,
      ...(profile.tags !== undefined ? { tags: [...profile.tags] } : {})
    }));
  }

  async createHost(
    profile: SshHostProfile,
    secrets?: SshHostSecretInput
  ): Promise<SshHostProfile> {
    const id = validateSshHostId(profile.id);
    if (this.hosts.has(id)) {
      throw new SshValidationError(`SSH host profile "${id}" already exists.`);
    }
    return this.upsertHost(profile, secrets);
  }

  async upsertHost(
    profile: SshHostProfile,
    secrets?: SshHostSecretInput
  ): Promise<SshHostProfile> {
    assertNoInlineSecrets(profile);
    const existing = this.hosts.get(profile.id);
    const now = Date.now();

    const sanitized = sanitizeProfileRecord({
      ...profile,
      createdAt: existing?.createdAt ?? profile.createdAt ?? now,
      updatedAt: now
    });

    const hasNewSecrets =
      secrets !== undefined &&
      (secrets.password !== undefined ||
        secrets.passphrase !== undefined ||
        secrets.privateKeyPem !== undefined);

    if (hasNewSecrets && secrets !== undefined) {
      await this.writeHostSecrets(sanitized.id, secrets);
      sanitized.credentialRef = buildCredentialRef(sanitized.id);
    } else if (existing?.credentialRef !== undefined && sanitized.credentialRef === undefined) {
      sanitized.credentialRef = existing.credentialRef;
    }

    this.hosts.set(sanitized.id, sanitized);
    this.persistToDisk();
    return { ...sanitized };
  }

  async updateHost(
    hostId: string,
    patch: Partial<Omit<SshHostProfile, "id">>,
    secrets?: SshHostSecretInput
  ): Promise<SshHostProfile> {
    assertNoInlineSecrets(patch);
    const existing = this.hosts.get(hostId);
    if (existing === undefined) {
      throw new SshValidationError(`SSH host profile "${hostId}" does not exist.`);
    }
    return this.upsertHost(
      {
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Date.now()
      },
      secrets
    );
  }

  async deleteHost(hostId: string): Promise<boolean> {
    const safeId = validateSshHostId(hostId);
    const existed = this.hosts.delete(safeId);
    await this.deleteHostSecrets(safeId);
    if (existed) {
      this.persistToDisk();
    }
    return existed;
  }

  async getHostSecrets(hostId: string): Promise<SshHostSecretInput | null> {
    const safeId = validateSshHostId(hostId);
    const [password, passphrase, privateKeyPem] = await Promise.all([
      this.credentials.get(buildCredentialKey(safeId, "password")),
      this.credentials.get(buildCredentialKey(safeId, "passphrase")),
      this.credentials.get(buildCredentialKey(safeId, "privateKeyPem"))
    ]);

    if (password === null && passphrase === null && privateKeyPem === null) {
      return null;
    }

    return {
      ...(password !== null ? { password } : {}),
      ...(passphrase !== null ? { passphrase } : {}),
      ...(privateKeyPem !== null ? { privateKeyPem } : {})
    };
  }

  buildSpawnSpec(
    hostId: string,
    options?: BuildSafeSshArgsOptions
  ): SshSpawnSpec {
    const profile = this.getHost(hostId);
    if (profile === undefined) {
      throw new SshValidationError(`SSH host profile "${hostId}" does not exist.`);
    }
    return {
      command: "ssh",
      args: buildSafeSshArgs(profile, options),
      shell: false,
      profile
    };
  }

  /**
   * Serializes host profiles without any credentials; rejects if inline secrets were ever injected.
   */
  exportProfilesJson(): string {
    const list = this.listHosts();
    for (const item of list) {
      assertNoInlineSecrets(item);
    }
    return JSON.stringify({ version: 1, hosts: list }, null, 2);
  }

  loadProfilesFromJson(rawJson: string): SshHostProfile[] {
    const parsed = JSON.parse(rawJson) as unknown;
    const items = extractHostArray(parsed);
    const nextHosts = new Map<string, SshHostProfile>();
    for (const item of items) {
      assertNoInlineSecrets(item);
      const sanitized = sanitizeProfileRecord(item as SshHostProfile);
      nextHosts.set(sanitized.id, sanitized);
    }
    this.hosts.clear();
    for (const [id, profile] of nextHosts) {
      this.hosts.set(id, profile);
    }
    return this.listHosts();
  }

  loadFromDisk(): SshHostProfile[] {
    if (this.storagePath === undefined || !existsSync(this.storagePath)) {
      return [];
    }
    const raw = readFileSync(this.storagePath, "utf8");
    return this.loadProfilesFromJson(raw);
  }

  clearMemory(): void {
    this.hosts.clear();
  }

  private async writeHostSecrets(
    hostId: string,
    secrets: SshHostSecretInput
  ): Promise<void> {
    for (const field of CREDENTIAL_SECRET_FIELDS) {
      const value = secrets[field];
      if (value !== undefined) {
        if (value.length === 0) {
          await this.credentials.delete(buildCredentialKey(hostId, field));
        } else {
          await this.credentials.set(buildCredentialKey(hostId, field), value);
        }
      }
    }
  }

  private async deleteHostSecrets(hostId: string): Promise<void> {
    for (const field of CREDENTIAL_SECRET_FIELDS) {
      await this.credentials.delete(buildCredentialKey(hostId, field));
    }
  }

  private persistToDisk(): void {
    if (this.storagePath === undefined) {
      return;
    }
    const dir = dirname(this.storagePath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tempPath = `${this.storagePath}.tmp-${process.pid}-${randomUUID()}`;
    const payload = this.exportProfilesJson();
    writeFileSync(tempPath, payload, { encoding: "utf8", mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, this.storagePath);
    chmodSync(this.storagePath, 0o600);
  }
}

function extractHostArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "hosts" in parsed &&
    Array.isArray((parsed as { hosts?: unknown }).hosts)
  ) {
    return (parsed as { hosts: unknown[] }).hosts;
  }
  throw new SshValidationError("Invalid SSH hosts profile JSON payload.");
}
