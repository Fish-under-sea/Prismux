import { lstatSync, realpathSync, type Stats } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

export class SshValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshValidationError";
  }
}

export class SshSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SshSecurityError";
  }
}

export interface SshHostProfile {
  id: string;
  host: string;
  port: number;
  username: string;
  label?: string;
  authType?: "key" | "password" | "agent";
  privateKeyPath?: string;
  sftpRootDir?: string;
  knownHostsPolicy?: "strict" | "accept-new";
  credentialRef?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface BuildSafeSshArgsOptions {
  batchMode?: boolean;
  connectTimeoutSec?: number;
  allocateTty?: boolean;
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SAFE_USERNAME_PATTERN = /^[a-zA-Z0-9._][a-zA-Z0-9._-]{0,127}$/;
const DNS_HOSTNAME_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SHELL_META_PATTERN = /[\x00-\x1f\x7f\s;&|$`<>(){}[\]\\'"*?~#%!^]/;

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isWithinRoot(realRoot: string, candidate: string): boolean {
  const rel = path.relative(realRoot, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function validateSshHostId(id: string): string {
  if (typeof id !== "string" || !SAFE_ID_PATTERN.test(id)) {
    throw new SshValidationError(
      `Invalid SSH host profile ID "${String(id)}": must match ${SAFE_ID_PATTERN.source}.`
    );
  }
  return id;
}

/**
 * Validates an SSH hostname or IPv4/IPv6 address, blocking `-` option injection and shell metacharacters.
 */
export function validateSshHost(host: string): string {
  if (typeof host !== "string" || host.length === 0 || host.length > 253) {
    throw new SshValidationError("SSH host must be a non-empty string (<= 253 chars).");
  }
  if (host.startsWith("-")) {
    throw new SshSecurityError(
      `Rejected SSH host "${host}": leading "-" is forbidden to prevent option injection.`
    );
  }
  if (
    host.includes("@") ||
    host.includes("/") ||
    CONTROL_OR_SHELL_META_PATTERN.test(host)
  ) {
    throw new SshSecurityError(
      `Rejected SSH host "${host}": contains forbidden whitespace, control chars, or shell metacharacters.`
    );
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 || ipVersion === 6) {
    return host;
  }

  if (!DNS_HOSTNAME_PATTERN.test(host)) {
    throw new SshValidationError(
      `Invalid SSH host "${host}": must be a valid hostname or IPv4/IPv6 address.`
    );
  }
  return host;
}

/**
 * Validates an SSH TCP port strictly within `1..65535`.
 */
export function validateSshPort(port: number): number {
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new SshValidationError(
      `Invalid SSH port "${String(port)}": must be an integer between 1 and 65535.`
    );
  }
  return port;
}

/**
 * Validates an SSH username, rejecting `-` option prefixes, `@`, whitespace, and shell metacharacters.
 */
export function validateSshUsername(username: string): string {
  if (typeof username !== "string" || username.length === 0) {
    throw new SshValidationError("SSH username must be a non-empty string.");
  }
  if (username.startsWith("-")) {
    throw new SshSecurityError(
      `Rejected SSH username "${username}": leading "-" is forbidden to prevent option injection.`
    );
  }
  if (
    username.includes("@") ||
    username.includes("/") ||
    CONTROL_OR_SHELL_META_PATTERN.test(username)
  ) {
    throw new SshSecurityError(
      `Rejected SSH username "${username}": contains forbidden whitespace, control chars, or shell metacharacters.`
    );
  }
  if (!SAFE_USERNAME_PATTERN.test(username)) {
    throw new SshValidationError(
      `Invalid SSH username "${username}": only alphanumeric, ".", "_", and non-leading "-" characters are allowed.`
    );
  }
  return username;
}

export function validatePrivateKeyPath(privateKeyPath: string): string {
  if (typeof privateKeyPath !== "string" || privateKeyPath.trim().length === 0) {
    throw new SshValidationError("SSH privateKeyPath must be a non-empty string.");
  }
  const trimmed = privateKeyPath.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new SshSecurityError(
      "SSH privateKeyPath contains forbidden control characters or NUL bytes."
    );
  }
  if (trimmed.startsWith("-")) {
    throw new SshSecurityError(
      `Rejected SSH privateKeyPath "${trimmed}": leading "-" is forbidden.`
    );
  }
  return trimmed;
}

/**
 * Builds a pure, injection-safe `ssh` argument vector for `spawn("ssh", args, { shell: false })`.
 */
export function buildSafeSshArgs(
  profile: SshHostProfile,
  options: BuildSafeSshArgsOptions = {}
): string[] {
  const host = validateSshHost(profile.host);
  const port = validateSshPort(profile.port);
  const username = validateSshUsername(profile.username);

  const strictMode =
    profile.knownHostsPolicy === "accept-new" ? "accept-new" : "yes";

  const args: string[] = [
    "-p",
    String(port),
    "-o",
    `StrictHostKeyChecking=${strictMode}`
  ];

  if (options.batchMode === true) {
    args.push("-o", "BatchMode=yes");
  }

  if (options.connectTimeoutSec !== undefined) {
    if (
      !Number.isInteger(options.connectTimeoutSec) ||
      options.connectTimeoutSec < 1 ||
      options.connectTimeoutSec > 600
    ) {
      throw new SshValidationError(
        `Invalid connectTimeoutSec "${String(options.connectTimeoutSec)}": expected integer 1..600.`
      );
    }
    args.push("-o", `ConnectTimeout=${options.connectTimeoutSec}`);
  }

  if (options.allocateTty === true) {
    args.push("-tt");
  }

  if (
    profile.privateKeyPath !== undefined &&
    profile.privateKeyPath.trim().length > 0
  ) {
    args.push("-i", validatePrivateKeyPath(profile.privateKeyPath));
  }

  // `--` terminates option parsing even if future OpenSSH versions interpret target prefixes.
  args.push("--", `${username}@${host}`);
  return args;
}

/**
 * Resolves an SFTP path safely within `rootDir`, defending against `..` traversal,
 * absolute path escapes, NUL/control byte injection, Windows drive/UNC prefixes,
 * and filesystem symlink or NTFS junction escapes.
 */
export function resolveSafeSftpPath(
  rootDir: string,
  requestedPath: string
): string {
  if (typeof rootDir !== "string" || rootDir.trim().length === 0) {
    throw new SshValidationError("SFTP rootDir must be a non-empty string.");
  }
  if (rootDir.includes("\0")) {
    throw new SshSecurityError("SFTP rootDir contains a forbidden NUL byte.");
  }
  if (typeof requestedPath !== "string") {
    throw new SshValidationError("SFTP requestedPath must be a string.");
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(requestedPath)) {
    throw new SshSecurityError(
      `Rejected SFTP path "${requestedPath}": contains NUL or control characters.`
    );
  }
  if (
    path.isAbsolute(requestedPath) ||
    requestedPath.startsWith("/") ||
    requestedPath.startsWith("\\") ||
    /^[a-zA-Z]:/.test(requestedPath)
  ) {
    throw new SshSecurityError(
      `Rejected SFTP path "${requestedPath}": absolute, drive-qualified, or UNC paths are forbidden.`
    );
  }

  const rawSegments = requestedPath.split(/[\\/]+/);
  const cleanSegments: string[] = [];
  for (const segment of rawSegments) {
    if (segment === "..") {
      throw new SshSecurityError(
        `Rejected SFTP path "${requestedPath}": parent directory traversal ("..") is forbidden.`
      );
    }
    if (segment.length > 0 && segment !== ".") {
      cleanSegments.push(segment);
    }
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, ...cleanSegments);
  if (!isWithinRoot(resolvedRoot, resolvedTarget)) {
    throw new SshSecurityError(
      `Rejected SFTP path "${requestedPath}": path escaped rootDir.`
    );
  }

  let rootExists = true;
  try {
    lstatSync(resolvedRoot);
  } catch (error) {
    if (isEnoent(error)) {
      rootExists = false;
    } else {
      throw error;
    }
  }

  if (!rootExists) {
    return resolvedTarget;
  }

  const realRoot = realpathSync(resolvedRoot);
  let current = resolvedRoot;
  let lastRealAnchor = realRoot;
  let consumedCount = 0;

  for (let i = 0; i < cleanSegments.length; i += 1) {
    const segment = cleanSegments[i]!;
    current = path.join(current, segment);

    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isEnoent(error)) {
        break;
      }
      throw error;
    }

    let realCurrent: string;
    try {
      realCurrent = realpathSync(current);
    } catch {
      throw new SshSecurityError(
        `Rejected SFTP path "${requestedPath}": unresolvable or broken symlink encountered.`
      );
    }

    if (stat.isSymbolicLink() && !isWithinRoot(realRoot, realCurrent)) {
      throw new SshSecurityError(
        `Rejected SFTP path "${requestedPath}": symlink escape outside SFTP root.`
      );
    }

    if (!isWithinRoot(realRoot, realCurrent)) {
      throw new SshSecurityError(
        `Rejected SFTP path "${requestedPath}": target resolved outside SFTP root.`
      );
    }

    lastRealAnchor = realCurrent;
    consumedCount = i + 1;
  }

  const remainingSegments = cleanSegments.slice(consumedCount);
  const finalResolved = path.resolve(lastRealAnchor, ...remainingSegments);
  if (!isWithinRoot(realRoot, finalResolved)) {
    throw new SshSecurityError(
      `Rejected SFTP path "${requestedPath}": final path escaped SFTP root.`
    );
  }
  return finalResolved;
}
