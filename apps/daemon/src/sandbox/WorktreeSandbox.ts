import { realpathSync } from "node:fs";
import http from "node:http";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse
} from "node:http";
import net from "node:net";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import process from "node:process";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { sanitizeChildEnv } from "../t3/T3ServerSupervisor.js";

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
  platform?: NodeJS.Platform;
}

export interface CreateWorktreeSandboxPolicyOptions {
  worktreePath: string;
  writableTempDirs?: string[];
  egressEnabled?: boolean;
  allowedDomains?: string[];
  proxyPort?: number;
  platform?: NodeJS.Platform;
  backend?: SandboxPlatformBackend;
}

export interface BuildIsolationSpecOptions {
  baseEnv?: Record<string, string | undefined>;
  proxyUrl?: string;
}

export interface LandlockRulesSpec {
  readOnlyPaths: string[];
  readWritePaths: string[];
  tcpBindPorts: number[];
  tcpConnectPorts: number[];
}

export interface WindowsJobPolicySpec {
  restrictedToken: boolean;
  killOnJobClose: boolean;
  activeProcessLimit: number;
  denyOutOfWorktreeWrites: boolean;
  writableRoots: string[];
  blockDirectOutboundNetwork: boolean;
}

export interface SandboxIsolationSpec {
  backend: SandboxPlatformBackend;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  writablePaths: string[];
  readOnlyRoot: boolean;
  networkIsolated: boolean;
  sbplProfile?: string;
  landlockRules?: LandlockRulesSpec;
  windowsJobPolicy?: WindowsJobPolicySpec;
}

export type ProxyProtocol = "HTTP" | "CONNECT";
export type ProxyDecision = "allow" | "deny";

export interface ProxyAuditEntry {
  timestamp: number;
  protocol: ProxyProtocol;
  targetHost: string;
  targetPort?: number;
  decision: ProxyDecision;
  reason: string;
  method?: string;
  url?: string;
}

export interface SandboxEgressProxyOptions {
  policy: WorktreeSandboxPolicy;
  host?: string;
  port?: number;
  maxAuditEntries?: number;
  requestTimeoutMs?: number;
}

export const DEFAULT_ALLOWED_EGRESS_DOMAINS = [
  "github.com",
  "registry.npmjs.org"
] as const;

export const DEFAULT_PROXY_AUDIT_CAPACITY = 10_000;
export const DEFAULT_PROXY_REQUEST_TIMEOUT_MS = 30_000;

const PROXY_STRIPPED_ENV_KEYS = new Set<string>([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY"
]);

const TEMP_ENV_KEYS = new Set<string>(["TMP", "TEMP", "TMPDIR"]);

const SANDBOX_METADATA_ENV_KEYS = new Set<string>([
  "PRISMUX_SANDBOX_WORKTREE",
  "PRISMUX_SANDBOX_MODE"
]);

const HOP_BY_HOP_HEADERS = new Set<string>([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

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

function inferPlatformFromPolicy(policy: WorktreeSandboxPolicy): NodeJS.Platform {
  if (policy.platform !== undefined) {
    return policy.platform;
  }
  if (policy.backend === "windows-restricted-token") {
    return "win32";
  }
  if (policy.backend === "sandbox-exec") {
    return "darwin";
  }
  return "linux";
}

function isWindowsPathLiteral(targetPath: string): boolean {
  return /^[a-zA-Z]:([\\/]|$)/.test(targetPath) || /^\\\\/.test(targetPath);
}

function getPathToolkit(
  targetPlatform: NodeJS.Platform,
  samplePaths: readonly string[]
): { pathImpl: typeof path.posix | typeof path.win32; caseInsensitive: boolean } {
  const hasWinPath = samplePaths.some((item) => isWindowsPathLiteral(item));
  if (targetPlatform === "win32" || hasWinPath) {
    return { pathImpl: path.win32, caseInsensitive: true };
  }
  return { pathImpl: path.posix, caseInsensitive: false };
}

function resolvePlatformAwarePath(
  targetPath: string,
  targetPlatform: NodeJS.Platform
): string {
  const { pathImpl } = getPathToolkit(targetPlatform, [targetPath]);
  if (pathImpl === path.win32) {
    if (path.win32.isAbsolute(targetPath)) {
      return path.win32.resolve(targetPath);
    }
    if (process.platform === "win32") {
      return path.win32.resolve(targetPath);
    }
    return path.win32.normalize(targetPath);
  }
  if (path.posix.isAbsolute(targetPath)) {
    return path.posix.resolve(targetPath);
  }
  return path.resolve(targetPath);
}

function shouldCheckRealFilesystem(
  pathImpl: typeof path.posix | typeof path.win32
): boolean {
  if (process.platform === "win32") {
    return pathImpl === path.win32;
  }
  return pathImpl === path.posix;
}

function resolveWithRealAncestors(resolvedPath: string): string {
  const pendingSegments: string[] = [];
  let current = resolvedPath;

  while (true) {
    try {
      const realCurrent = realpathSync(current);
      return pendingSegments.length === 0
        ? realCurrent
        : path.resolve(realCurrent, ...pendingSegments.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return resolvedPath;
      }
      pendingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

function isPathInsideRoot(
  rootPath: string,
  candidatePath: string,
  pathImpl: typeof path.posix | typeof path.win32,
  caseInsensitive: boolean
): boolean {
  const compareRoot = caseInsensitive ? rootPath.toLowerCase() : rootPath;
  const compareCandidate = caseInsensitive
    ? candidatePath.toLowerCase()
    : candidatePath;

  const rel = pathImpl.relative(compareRoot, compareCandidate);
  if (rel === "") {
    return true;
  }
  if (rel === ".." || rel.startsWith(`..${pathImpl.sep}`)) {
    return false;
  }
  if (pathImpl.isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * Checks whether `targetPath` falls strictly inside the sandbox's `worktreePath` or `writableTempDirs`.
 * Defends against sibling-prefix spoofing (`wt-evil`), `..` traversal, case mismatch on Windows,
 * and symlinks/junctions pointing outside allowed roots.
 */
export function isWriteTargetAllowed(
  policy: WorktreeSandboxPolicy,
  targetPath: string
): boolean {
  if (targetPath.trim().length === 0 || targetPath.includes("\0")) {
    return false;
  }

  const targetPlatform = inferPlatformFromPolicy(policy);
  const allowedRoots = [policy.worktreePath, ...policy.writableTempDirs];
  const { pathImpl, caseInsensitive } = getPathToolkit(targetPlatform, [
    targetPath,
    ...allowedRoots
  ]);

  const resolvedTarget = resolvePlatformAwarePath(targetPath, targetPlatform);
  const resolvedRoots = allowedRoots.map((root) =>
    resolvePlatformAwarePath(root, targetPlatform)
  );

  const lexicalAllowed = resolvedRoots.some((root) =>
    isPathInsideRoot(root, resolvedTarget, pathImpl, caseInsensitive)
  );
  if (!lexicalAllowed) {
    return false;
  }

  if (!shouldCheckRealFilesystem(pathImpl)) {
    return true;
  }

  const realTarget = resolveWithRealAncestors(resolvedTarget);
  const realRoots = resolvedRoots.map((root) =>
    resolveWithRealAncestors(root)
  );

  return realRoots.some((realRoot) =>
    isPathInsideRoot(realRoot, realTarget, pathImpl, caseInsensitive)
  );
}

/**
 * Throws an explicit security error when `targetPath` is outside the sandbox write policy.
 */
export function assertWriteTargetAllowed(
  policy: WorktreeSandboxPolicy,
  targetPath: string
): void {
  if (!isWriteTargetAllowed(policy, targetPath)) {
    throw new Error(
      `Sandbox write blocked: "${targetPath}" is outside allowed worktree "${policy.worktreePath}" and writableTempDirs [${policy.writableTempDirs.join(", ")}].`
    );
  }
}

function escapeSbplString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function extractProxyPort(
  policy: WorktreeSandboxPolicy,
  proxyUrl?: string
): number | undefined {
  if (proxyUrl !== undefined) {
    try {
      const parsed = new URL(proxyUrl);
      if (parsed.port.length > 0) {
        const numericPort = Number(parsed.port);
        if (Number.isInteger(numericPort) && numericPort > 0 && numericPort <= 65535) {
          return numericPort;
        }
      }
    } catch {
      // Ignore malformed proxyUrl here; policy.egress.proxyPort may still apply.
    }
  }
  if (
    policy.egress.proxyPort !== undefined &&
    Number.isInteger(policy.egress.proxyPort) &&
    policy.egress.proxyPort > 0 &&
    policy.egress.proxyPort <= 65535
  ) {
    return policy.egress.proxyPort;
  }
  return undefined;
}

function buildSbplProfile(
  policy: WorktreeSandboxPolicy,
  proxyPort: number | undefined
): string {
  const writableRoots = [policy.worktreePath, ...policy.writableTempDirs];
  const subpathClauses = writableRoots
    .map((dir) => `  (subpath "${escapeSbplString(dir)}")`)
    .join("\n");

  const lines: string[] = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    subpathClauses,
    ")"
  ];

  if (!policy.egress.enabled) {
    lines.push("(deny network-outbound)");
    if (proxyPort !== undefined) {
      lines.push(`(allow network-outbound (remote ip "127.0.0.1:${proxyPort}"))`);
      lines.push(`(allow network-outbound (remote ip "localhost:${proxyPort}"))`);
    }
  } else if (proxyPort !== undefined) {
    lines.push("(deny network-outbound)");
    lines.push(`(allow network-outbound (remote ip "127.0.0.1:${proxyPort}"))`);
    lines.push(`(allow network-outbound (remote ip "localhost:${proxyPort}"))`);
  }

  return lines.join("\n");
}

function deleteCaseInsensitiveKeys(
  env: Record<string, string>,
  keysToStrip: ReadonlySet<string>
): void {
  for (const key of Object.keys(env)) {
    if (keysToStrip.has(key.toUpperCase())) {
      delete env[key];
    }
  }
}

function buildSandboxedEnv(
  policy: WorktreeSandboxPolicy,
  targetPlatform: NodeJS.Platform,
  options?: BuildIsolationSpecOptions
): { env: Record<string, string>; proxyUrl?: string } {
  const env = sanitizeChildEnv(options?.baseEnv ?? process.env);
  deleteCaseInsensitiveKeys(env, PROXY_STRIPPED_ENV_KEYS);
  deleteCaseInsensitiveKeys(env, SANDBOX_METADATA_ENV_KEYS);

  const effectiveProxyUrl =
    options?.proxyUrl ??
    (policy.egress.proxyPort !== undefined
      ? `http://127.0.0.1:${policy.egress.proxyPort}`
      : undefined);

  env.PRISMUX_SANDBOX_WORKTREE = policy.worktreePath;

  const { pathImpl } = getPathToolkit(targetPlatform, [
    policy.worktreePath,
    ...policy.writableTempDirs
  ]);
  const controlledTempDir =
    policy.writableTempDirs[0] ??
    pathImpl.join(policy.worktreePath, ".prismux-tmp");

  if (policy.backend === "windows-restricted-token") {
    deleteCaseInsensitiveKeys(env, TEMP_ENV_KEYS);
    env.TMP = controlledTempDir;
    env.TEMP = controlledTempDir;
    env.TMPDIR = controlledTempDir;
    env.PRISMUX_SANDBOX_MODE = "restricted-token";
  } else {
    env.PRISMUX_SANDBOX_MODE = policy.backend;
    if (policy.writableTempDirs[0] !== undefined) {
      deleteCaseInsensitiveKeys(env, TEMP_ENV_KEYS);
      env.TMPDIR = policy.writableTempDirs[0];
      env.TMP = policy.writableTempDirs[0];
      env.TEMP = policy.writableTempDirs[0];
    }
  }

  if (policy.egress.enabled && effectiveProxyUrl !== undefined) {
    env.HTTP_PROXY = effectiveProxyUrl;
    env.HTTPS_PROXY = effectiveProxyUrl;
  }

  return {
    env,
    ...(effectiveProxyUrl !== undefined ? { proxyUrl: effectiveProxyUrl } : {})
  };
}

/**
 * Generates an OS-level isolation specification for Linux (`bwrap`/`landlock`),
 * macOS (`sandbox-exec` SBPL), or Windows (`windows-restricted-token`).
 */
export function buildIsolationSpec(
  policy: WorktreeSandboxPolicy,
  command: string,
  args: readonly string[],
  options?: BuildIsolationSpecOptions
): SandboxIsolationSpec {
  const targetPlatform = inferPlatformFromPolicy(policy);
  const { env, proxyUrl } = buildSandboxedEnv(policy, targetPlatform, options);
  const writablePaths = [policy.worktreePath, ...policy.writableTempDirs];
  const proxyPort = extractProxyPort(policy, proxyUrl);

  if (policy.backend === "bwrap" || policy.backend === "landlock") {
    const bwrapArgs: string[] = [
      "--ro-bind",
      "/",
      "/",
      "--bind",
      policy.worktreePath,
      policy.worktreePath
    ];
    for (const tempDir of policy.writableTempDirs) {
      bwrapArgs.push("--bind", tempDir, tempDir);
    }
    if (!policy.egress.enabled) {
      bwrapArgs.push("--unshare-net");
    }
    bwrapArgs.push("--chdir", policy.worktreePath, "--", command, ...args);

    const landlockRules: LandlockRulesSpec = {
      readOnlyPaths: ["/"],
      readWritePaths: [...writablePaths],
      tcpBindPorts: [],
      tcpConnectPorts: policy.egress.enabled
        ? proxyPort !== undefined
          ? [proxyPort]
          : [80, 443]
        : []
    };

    if (policy.backend === "bwrap") {
      return {
        backend: "bwrap",
        command: "bwrap",
        args: bwrapArgs,
        cwd: policy.worktreePath,
        env,
        writablePaths,
        readOnlyRoot: true,
        networkIsolated: !policy.egress.enabled,
        landlockRules
      };
    }

    return {
      backend: "landlock",
      command,
      args: [...args],
      cwd: policy.worktreePath,
      env,
      writablePaths,
      readOnlyRoot: true,
      networkIsolated: !policy.egress.enabled,
      landlockRules
    };
  }

  if (policy.backend === "sandbox-exec") {
    const sbplProfile = buildSbplProfile(policy, proxyPort);
    return {
      backend: "sandbox-exec",
      command: "sandbox-exec",
      args: ["-p", sbplProfile, command, ...args],
      cwd: policy.worktreePath,
      env,
      writablePaths,
      readOnlyRoot: true,
      networkIsolated: !policy.egress.enabled,
      sbplProfile
    };
  }

  const controlledTempDir = env.TMP ?? policy.worktreePath;
  const windowsWritableRoots = policy.writableTempDirs.includes(controlledTempDir)
    ? [...writablePaths]
    : [...writablePaths, controlledTempDir];

  return {
    backend: "windows-restricted-token",
    command,
    args: [...args],
    cwd: policy.worktreePath,
    env,
    writablePaths: windowsWritableRoots,
    readOnlyRoot: true,
    networkIsolated: !policy.egress.enabled,
    windowsJobPolicy: {
      restrictedToken: true,
      killOnJobClose: true,
      activeProcessLimit: 32,
      denyOutOfWorktreeWrites: true,
      writableRoots: windowsWritableRoots,
      blockDirectOutboundNetwork: true
    }
  };
}

/**
 * Normalizes a hostname or host:port / [ipv6]:port string into a canonical lowercase host without port or brackets.
 * Returns empty string if malformed or containing dangerous characters (e.g., `@`, `/`, whitespace).
 */
export function normalizeHostname(rawHost: string): string {
  const trimmed = rawHost.trim().toLowerCase();
  if (trimmed.length === 0) {
    return "";
  }
  if (/[\s/\\@#?]/.test(trimmed)) {
    return "";
  }

  let hostPart = trimmed;
  if (trimmed.startsWith("[")) {
    const closingIdx = trimmed.indexOf("]");
    if (closingIdx <= 1) {
      return "";
    }
    const inner = trimmed.slice(1, closingIdx);
    const remainder = trimmed.slice(closingIdx + 1);
    if (remainder.length > 0) {
      if (!/^:\d{1,5}$/.test(remainder)) {
        return "";
      }
      const portNum = Number(remainder.slice(1));
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return "";
      }
    }
    hostPart = inner;
  } else {
    const firstColon = trimmed.indexOf(":");
    const lastColon = trimmed.lastIndexOf(":");
    if (firstColon !== -1 && firstColon === lastColon) {
      const portPart = trimmed.slice(firstColon + 1);
      if (!/^\d{1,5}$/.test(portPart)) {
        return "";
      }
      const portNum = Number(portPart);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return "";
      }
      hostPart = trimmed.slice(0, firstColon);
    }
  }

  if (hostPart.endsWith(".")) {
    hostPart = hostPart.slice(0, -1);
  }
  if (
    hostPart.length === 0 ||
    hostPart.startsWith(".") ||
    hostPart.includes("..")
  ) {
    return "";
  }
  return hostPart;
}

/**
 * Strict domain allowlist matcher.
 * Only allows exact host match (`d === allowed`) or dot-separated true subdomains (`d.endsWith("." + allowed)`).
 * Rejects suffix/prefix spoofing such as `evil-github.com` or `github.com.attacker.cn`.
 */
export function isDomainAllowed(
  hostname: string,
  allowedDomains: readonly string[]
): boolean {
  const normalizedTarget = normalizeHostname(hostname);
  if (normalizedTarget.length === 0) {
    return false;
  }

  for (const rawAllowed of allowedDomains) {
    const trimmedAllowed = rawAllowed.trim().toLowerCase();
    if (trimmedAllowed.length === 0 || trimmedAllowed === "*") {
      continue;
    }
    const normalizedAllowed = normalizeHostname(trimmedAllowed);
    if (normalizedAllowed.length === 0) {
      continue;
    }
    if (normalizedTarget === normalizedAllowed) {
      return true;
    }
    if (net.isIP(normalizedAllowed) === 0 && net.isIP(normalizedTarget) === 0) {
      if (normalizedTarget.endsWith(`.${normalizedAllowed}`)) {
        return true;
      }
    }
  }

  return false;
}

function parseConnectAuthority(
  authority: string
): { host: string; port: number } | undefined {
  const trimmed = authority.trim();
  if (trimmed.length === 0 || /[\s/\\@#?]/.test(trimmed)) {
    return undefined;
  }

  if (trimmed.startsWith("[")) {
    const closingIdx = trimmed.indexOf("]");
    if (closingIdx <= 1) {
      return undefined;
    }
    const host = normalizeHostname(trimmed.slice(0, closingIdx + 1));
    const remainder = trimmed.slice(closingIdx + 1);
    if (host.length === 0) {
      return undefined;
    }
    if (remainder.length === 0) {
      return { host, port: 443 };
    }
    if (!/^:\d{1,5}$/.test(remainder)) {
      return undefined;
    }
    const port = Number(remainder.slice(1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined;
    }
    return { host, port };
  }

  const colonIdx = trimmed.lastIndexOf(":");
  if (colonIdx === -1) {
    const host = normalizeHostname(trimmed);
    return host.length > 0 ? { host, port: 443 } : undefined;
  }

  const firstColon = trimmed.indexOf(":");
  if (firstColon !== colonIdx) {
    const host = normalizeHostname(trimmed);
    return host.length > 0 ? { host, port: 443 } : undefined;
  }

  const portPart = trimmed.slice(colonIdx + 1);
  if (!/^\d{1,5}$/.test(portPart)) {
    return undefined;
  }
  const port = Number(portPart);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined;
  }
  const host = normalizeHostname(trimmed.slice(0, colonIdx));
  return host.length > 0 ? { host, port } : undefined;
}

function buildForwardedHeaders(
  incomingHeaders: IncomingHttpHeaders,
  upstreamHostHeader: string
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (value === undefined) {
      continue;
    }
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === "host") {
      continue;
    }
    headers[key] = value;
  }
  headers.host = upstreamHostHeader;
  return headers;
}

function isPolicyObject(
  value: WorktreeSandboxPolicy | SandboxEgressProxyOptions
): value is WorktreeSandboxPolicy {
  return "worktreePath" in value && "egress" in value;
}

/**
 * Real local HTTP & HTTPS `CONNECT` egress proxy enforcing `WorktreeSandboxPolicy.egress`.
 * Never resolves DNS or initiates outbound connections for blocked domains.
 */
export class SandboxEgressProxy {
  private policy: WorktreeSandboxPolicy;
  private readonly host: string;
  private readonly configuredPort: number;
  private readonly maxAuditEntries: number;
  private readonly requestTimeoutMs: number;

  private readonly server: http.Server;
  private readonly activeSockets = new Set<Socket>();
  private readonly auditLog: ProxyAuditEntry[] = [];

  private running = false;
  private stopping = false;
  private boundPort: number | undefined;
  private activeStartPromise: Promise<string> | undefined;
  private activeStopPromise: Promise<void> | undefined;

  constructor(policyOrOptions: WorktreeSandboxPolicy | SandboxEgressProxyOptions) {
    if (isPolicyObject(policyOrOptions)) {
      this.policy = policyOrOptions;
      this.host = "127.0.0.1";
      this.configuredPort = policyOrOptions.egress.proxyPort ?? 0;
      this.maxAuditEntries = DEFAULT_PROXY_AUDIT_CAPACITY;
      this.requestTimeoutMs = DEFAULT_PROXY_REQUEST_TIMEOUT_MS;
    } else {
      this.policy = policyOrOptions.policy;
      this.host = policyOrOptions.host ?? "127.0.0.1";
      this.configuredPort =
        policyOrOptions.port ?? policyOrOptions.policy.egress.proxyPort ?? 0;
      this.maxAuditEntries = Math.max(
        1,
        policyOrOptions.maxAuditEntries ?? DEFAULT_PROXY_AUDIT_CAPACITY
      );
      this.requestTimeoutMs = Math.max(
        100,
        policyOrOptions.requestTimeoutMs ?? DEFAULT_PROXY_REQUEST_TIMEOUT_MS
      );
    }

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.server.on("connect", (req, clientSocket, head) => {
      this.handleConnectRequest(req, clientSocket, head);
    });

    this.server.on("connection", (socket: Socket) => {
      this.trackSocket(socket);
    });
  }

  getPolicy(): WorktreeSandboxPolicy {
    return this.policy;
  }

  updatePolicy(nextPolicy: WorktreeSandboxPolicy): void {
    this.policy = nextPolicy;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPort(): number {
    if (!this.running || this.boundPort === undefined) {
      throw new Error("SandboxEgressProxy is not running.");
    }
    return this.boundPort;
  }

  getProxyUrl(): string {
    const port = this.getPort();
    const formattedHost = this.host.includes(":") ? `[${this.host}]` : this.host;
    return `http://${formattedHost}:${port}`;
  }

  getAuditLog(): ProxyAuditEntry[] {
    return this.auditLog.map((entry) => ({ ...entry }));
  }

  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  async start(): Promise<string> {
    if (this.activeStopPromise !== undefined) {
      await this.activeStopPromise;
    }
    if (this.running) {
      return this.getProxyUrl();
    }
    if (this.activeStartPromise !== undefined) {
      return this.activeStartPromise;
    }

    this.stopping = false;
    const startRun = new Promise<string>((resolveStart, rejectStart) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        rejectStart(error);
      };

      const onListening = () => {
        this.server.off("error", onError);
        const addr = this.server.address() as AddressInfo | null;
        if (addr === null || typeof addr === "string") {
          rejectStart(new Error("SandboxEgressProxy failed to resolve bound address."));
          return;
        }
        this.boundPort = addr.port;
        this.running = true;
        resolveStart(this.getProxyUrl());
      };

      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.configuredPort, this.host);
    }).finally(() => {
      this.activeStartPromise = undefined;
    });

    this.activeStartPromise = startRun;
    return startRun;
  }

  async stop(): Promise<void> {
    if (this.activeStopPromise !== undefined) {
      return this.activeStopPromise;
    }
    if (!this.running && this.activeStartPromise === undefined) {
      return;
    }

    const stopRun = this.performStop().finally(() => {
      this.activeStopPromise = undefined;
    });
    this.activeStopPromise = stopRun;
    return stopRun;
  }

  private async performStop(): Promise<void> {
    this.stopping = true;
    if (this.activeStartPromise !== undefined) {
      try {
        await this.activeStartPromise;
      } catch {
        // Ignore startup failure during teardown.
      }
    }

    for (const socket of this.activeSockets) {
      try {
        socket.destroy();
      } catch {
        // Ignore socket destroy errors.
      }
    }
    this.activeSockets.clear();

    if (typeof this.server.closeIdleConnections === "function") {
      this.server.closeIdleConnections();
    }
    if (typeof this.server.closeAllConnections === "function") {
      this.server.closeAllConnections();
    }

    if (this.server.listening) {
      await new Promise<void>((resolveClose) => {
        this.server.close(() => {
          resolveClose();
        });
      });
    }

    this.running = false;
    this.boundPort = undefined;
  }

  private trackSocket(socket: Socket): void {
    this.activeSockets.add(socket);
    socket.once("close", () => {
      this.activeSockets.delete(socket);
    });
    socket.on("error", () => {
      // Prevent unhandled socket errors during abrupt disconnects/teardown.
    });
  }

  private recordAudit(entry: ProxyAuditEntry): void {
    this.auditLog.push(entry);
    while (this.auditLog.length > this.maxAuditEntries) {
      this.auditLog.shift();
    }
  }

  private evaluateHost(rawHost: string): {
    allowed: boolean;
    normalizedHost: string;
    reason: string;
  } {
    const normalizedHost = normalizeHostname(rawHost);
    if (normalizedHost.length === 0) {
      return {
        allowed: false,
        normalizedHost: rawHost,
        reason: "Invalid target hostname"
      };
    }
    if (!this.policy.egress.enabled) {
      return {
        allowed: false,
        normalizedHost,
        reason: "Network egress is disabled by sandbox policy"
      };
    }
    if (!isDomainAllowed(normalizedHost, this.policy.egress.allowedDomains)) {
      return {
        allowed: false,
        normalizedHost,
        reason: `Domain "${normalizedHost}" is not in sandbox egress allowlist`
      };
    }
    return {
      allowed: true,
      normalizedHost,
      reason: "Allowed by sandbox egress domain allowlist"
    };
  }

  private sendJsonError(
    res: ServerResponse,
    statusCode: number,
    payload: Record<string, unknown>
  ): void {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      Connection: "close"
    });
    res.end(body);
  }

  private resolveHttpTargetUrl(req: IncomingMessage): URL | undefined {
    const rawUrl = req.url ?? "";
    if (/^https?:\/\//i.test(rawUrl)) {
      try {
        return new URL(rawUrl);
      } catch {
        return undefined;
      }
    }

    const hostHeader = req.headers.host;
    if (typeof hostHeader === "string" && hostHeader.trim().length > 0) {
      const normalizedFromHeader = normalizeHostname(hostHeader);
      const selfPort = this.boundPort;
      const isSelfProxyLoop =
        (normalizedFromHeader === "127.0.0.1" ||
          normalizedFromHeader === "localhost" ||
          normalizedFromHeader === "::1") &&
        selfPort !== undefined &&
        hostHeader.endsWith(`:${selfPort}`);
      if (isSelfProxyLoop) {
        return undefined;
      }
      try {
        return new URL(rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`, `http://${hostHeader}`);
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    req.on("error", () => {
      if (!res.destroyed) {
        res.destroy();
      }
    });

    const targetUrl = this.resolveHttpTargetUrl(req);
    if (
      targetUrl === undefined ||
      (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:")
    ) {
      const fallbackHost =
        typeof req.headers.host === "string" ? req.headers.host : "unknown";
      this.recordAudit({
        timestamp: Date.now(),
        protocol: "HTTP",
        targetHost: normalizeHostname(fallbackHost) || fallbackHost,
        decision: "deny",
        reason: "Invalid or missing absolute target URL",
        method: req.method,
        url: req.url
      });
      this.sendJsonError(res, 403, {
        error: "EgressBlocked",
        protocol: "HTTP",
        host: fallbackHost,
        reason: "Invalid or missing absolute target URL"
      });
      return;
    }

    const targetPort =
      targetUrl.port.length > 0
        ? Number(targetUrl.port)
        : targetUrl.protocol === "https:"
          ? 443
          : 80;
    const evaluation = this.evaluateHost(targetUrl.hostname);

    if (!evaluation.allowed) {
      this.recordAudit({
        timestamp: Date.now(),
        protocol: "HTTP",
        targetHost: evaluation.normalizedHost,
        targetPort,
        decision: "deny",
        reason: evaluation.reason,
        method: req.method,
        url: req.url
      });
      this.sendJsonError(res, 403, {
        error: "EgressBlocked",
        protocol: "HTTP",
        host: evaluation.normalizedHost,
        reason: evaluation.reason
      });
      return;
    }

    this.recordAudit({
      timestamp: Date.now(),
      protocol: "HTTP",
      targetHost: evaluation.normalizedHost,
      targetPort,
      decision: "allow",
      reason: evaluation.reason,
      method: req.method,
      url: req.url
    });

    const upstreamReq = http.request(
      {
        hostname: evaluation.normalizedHost,
        port: targetPort,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: req.method ?? "GET",
        headers: buildForwardedHeaders(req.headers, targetUrl.host),
        timeout: this.requestTimeoutMs
      },
      (upstreamRes) => {
        if (res.destroyed || res.writableEnded) {
          upstreamRes.resume();
          return;
        }
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );

    upstreamReq.on("timeout", () => {
      upstreamReq.destroy(new Error("Upstream HTTP request timed out."));
    });

    upstreamReq.on("error", (error: Error) => {
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        this.sendJsonError(res, 502, {
          error: "UpstreamError",
          protocol: "HTTP",
          host: evaluation.normalizedHost,
          reason: error.message
        });
      } else if (!res.destroyed) {
        res.destroy();
      }
    });

    req.on("aborted", () => {
      upstreamReq.destroy();
    });

    res.on("close", () => {
      if (!res.writableEnded) {
        upstreamReq.destroy();
      }
    });

    req.pipe(upstreamReq);
  }

  private handleConnectRequest(
    req: IncomingMessage,
    duplexSocket: Duplex,
    head: Buffer
  ): void {
    const clientSocket = duplexSocket as Socket;
    this.trackSocket(clientSocket);

    const parsed = parseConnectAuthority(req.url ?? "");
    if (parsed === undefined) {
      const rawTarget = req.url ?? "unknown";
      this.recordAudit({
        timestamp: Date.now(),
        protocol: "CONNECT",
        targetHost: rawTarget,
        decision: "deny",
        reason: "Malformed CONNECT authority",
        method: "CONNECT",
        url: req.url
      });
      if (!clientSocket.destroyed) {
        clientSocket.end(
          "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
      }
      return;
    }

    const evaluation = this.evaluateHost(parsed.host);
    if (!evaluation.allowed) {
      this.recordAudit({
        timestamp: Date.now(),
        protocol: "CONNECT",
        targetHost: evaluation.normalizedHost,
        targetPort: parsed.port,
        decision: "deny",
        reason: evaluation.reason,
        method: "CONNECT",
        url: req.url
      });
      if (!clientSocket.destroyed) {
        clientSocket.end(
          "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
      }
      return;
    }

    this.recordAudit({
      timestamp: Date.now(),
      protocol: "CONNECT",
      targetHost: evaluation.normalizedHost,
      targetPort: parsed.port,
      decision: "allow",
      reason: evaluation.reason,
      method: "CONNECT",
      url: req.url
    });

    let established = false;
    const upstreamSocket = net.connect({
      host: evaluation.normalizedHost,
      port: parsed.port
    });
    this.trackSocket(upstreamSocket);

    const teardownBoth = () => {
      if (!clientSocket.destroyed) {
        clientSocket.destroy();
      }
      if (!upstreamSocket.destroyed) {
        upstreamSocket.destroy();
      }
    };

    upstreamSocket.once("connect", () => {
      if (this.stopping || clientSocket.destroyed) {
        teardownBoth();
        return;
      }
      established = true;
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstreamSocket.write(head);
      }
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });

    upstreamSocket.on("error", () => {
      if (!established && !clientSocket.destroyed) {
        clientSocket.end(
          "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
      } else {
        teardownBoth();
      }
    });

    upstreamSocket.once("close", () => {
      if (!clientSocket.destroyed) {
        clientSocket.end();
      }
    });

    clientSocket.once("close", () => {
      if (!upstreamSocket.destroyed) {
        upstreamSocket.destroy();
      }
    });
  }
}

/**
 * OS-level filesystem write isolation + local HTTP proxy egress gate for unattended worktrees.
 */
export class WorktreeSandbox {
  createPolicy(
    options: CreateWorktreeSandboxPolicyOptions
  ): WorktreeSandboxPolicy {
    const targetPlatform = options.platform ?? process.platform;
    const resolvedWorktree = resolvePlatformAwarePath(
      options.worktreePath,
      targetPlatform
    );
    const resolvedTempDirs = (options.writableTempDirs ?? []).map((dir) =>
      resolvePlatformAwarePath(dir, targetPlatform)
    );

    return {
      worktreePath: resolvedWorktree,
      writableTempDirs: resolvedTempDirs,
      backend: options.backend ?? selectPlatformSandboxBackend(targetPlatform),
      platform: targetPlatform,
      egress: {
        enabled: options.egressEnabled ?? false,
        allowedDomains:
          options.allowedDomains !== undefined
            ? [...options.allowedDomains]
            : [...DEFAULT_ALLOWED_EGRESS_DOMAINS],
        ...(options.proxyPort !== undefined
          ? { proxyPort: options.proxyPort }
          : {})
      }
    };
  }

  isWriteTargetAllowed(
    policy: WorktreeSandboxPolicy,
    targetPath: string
  ): boolean {
    return isWriteTargetAllowed(policy, targetPath);
  }

  assertWriteTargetAllowed(
    policy: WorktreeSandboxPolicy,
    targetPath: string
  ): void {
    assertWriteTargetAllowed(policy, targetPath);
  }

  buildIsolationSpec(
    policy: WorktreeSandboxPolicy,
    command: string,
    args: readonly string[],
    options?: BuildIsolationSpecOptions
  ): SandboxIsolationSpec {
    return buildIsolationSpec(policy, command, args, options);
  }

  createEgressProxy(
    policy: WorktreeSandboxPolicy,
    options?: Omit<SandboxEgressProxyOptions, "policy">
  ): SandboxEgressProxy {
    return new SandboxEgressProxy({
      policy,
      ...options
    });
  }
}
