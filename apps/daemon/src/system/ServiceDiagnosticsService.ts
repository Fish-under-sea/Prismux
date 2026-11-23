import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { SqliteMemoryStore } from "@prismux/memory-core";
import {
  DIAGNOSTIC_CATEGORIES,
  UPDATE_ENDPOINTS,
  type DiagnosticCategoryId,
  type DiagnosticCheckItem,
  type DiagnosticCheckStatus,
  type DiagnosticGroupSummary,
  type ServiceDiagnosticsResponse
} from "@prismux/protocol";
import type { SyncVaultEngine } from "@prismux/sync-vault";
import type { LifecycleHookBus } from "../hooks/LifecycleHookBus.js";
import type { PersistentPtyPool } from "../pty/PersistentPtyPool.js";
import {
  selectPlatformSandboxBackend,
  type WorktreeSandbox
} from "../sandbox/WorktreeSandbox.js";
import type { T3RpcClient } from "../t3/T3RpcClient.js";
import type { T3ServerSupervisor } from "../t3/T3ServerSupervisor.js";
import { resolve7zaBinary, type AppUpdater } from "../updater/AppUpdater.js";
import type { WallpaperMediaService } from "../wallpapers/WallpaperMediaService.js";
import type { OvernightFactory } from "../workflows/OvernightFactory.js";
import type { ResourceMonitorService } from "./ResourceMonitorService.js";

const execFileAsync = promisify(execFile);

const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_SINGLE_CHECK_TIMEOUT_MS = 1_100;
const DEFAULT_GLOBAL_BUDGET_MS = 2_400;

export interface CliProbeResult {
  found: boolean;
  path?: string | null;
  version?: string | null;
  latencyMs: number;
  error?: string;
}

export interface NetworkProbeResult {
  reachable: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error?: string;
}

export interface ServiceDiagnosticsOptions {
  dataDir: string;
  version: string;
  headless: boolean;
  startedAt: number;
  memoryStore?: SqliteMemoryStore;
  memoryDbPath?: string;
  syncVault?: SyncVaultEngine;
  t3Supervisor?: T3ServerSupervisor;
  t3RpcClient?: T3RpcClient;
  /** Optional explicit T3 Server URL (HTTP or WS) when desktop-hosted. */
  t3ServerUrl?: string;
  /** Optional T3 Server bearer token used strictly as a probe header (never logged/returned). */
  t3Token?: string;
  ptyPool?: PersistentPtyPool;
  resourceMonitor?: ResourceMonitorService;
  appUpdater?: AppUpdater;
  wallpaperService?: WallpaperMediaService;
  overnightFactory?: OvernightFactory;
  hookBus?: LifecycleHookBus;
  sandbox?: WorktreeSandbox;
  cacheTtlMs?: number;
  singleCheckTimeoutMs?: number;
  globalBudgetMs?: number;
  /** Injectable CLI version probe for deterministic tests (never reads OAuth/keyring). */
  cliProbe?: (
    command: string,
    args: string[],
    timeoutMs: number
  ) => Promise<CliProbeResult>;
  /** Injectable network reachability probe for deterministic tests. */
  networkProbe?: (
    url: string,
    timeoutMs: number,
    headers?: Record<string, string>,
    method?: "HEAD" | "GET"
  ) => Promise<NetworkProbeResult>;
  /** Injectable Android SDK path detector for deterministic tests. */
  detectAndroidSdk?: () => { sdkRoot: string | null; adbPath: string | null };
  /** Injectable 7za path resolver for deterministic tests. */
  resolve7za?: () => string | null;
}

const CATEGORY_LABELS: Record<DiagnosticCategoryId, string> = {
  host_core: "宿主核心",
  memory_sync: "记忆与同步",
  ai_providers: "AI Provider CLI",
  simulators_media: "模拟器与媒体工具",
  network_mirrors: "网络与镜像源",
  dormant_engines: "沉睡内核状态摘要"
};

function findExecutableOnPath(commandNames: readonly string[]): string | null {
  const pathEnv = process.env["PATH"] ?? process.env["Path"] ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  const exts =
    process.platform === "win32"
      ? ["", ".exe", ".cmd", ".bat"]
      : [""];

  for (const rawDir of pathEnv.split(sep)) {
    const dir = rawDir.trim().replace(/^"|"$/g, "");
    if (!dir) continue;
    for (const cmd of commandNames) {
      const hasExt = /\.[a-z0-9]+$/i.test(cmd);
      const variants = hasExt ? [cmd] : exts.map((ext) => `${cmd}${ext}`);
      for (const variant of variants) {
        const candidate = join(dir, variant);
        try {
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          // ignore
        }
      }
    }
  }
  return null;
}

function extractFirstVersionLine(output: string): string | null {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return null;
  }
  const first = lines[0]!;
  return first.length > 100 ? `${first.slice(0, 97)}...` : first;
}

async function defaultCliProbe(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<CliProbeResult> {
  const started = performance.now();
  const located = findExecutableOnPath([command]);
  if (!located) {
    return {
      found: false,
      path: null,
      version: null,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      error: `PATH 中未找到 ${command}`
    };
  }

  try {
    const isWinCmd =
      process.platform === "win32" && /\.(cmd|bat)$/i.test(located);
    const { stdout, stderr } = isWinCmd
      ? await execFileAsync(
          process.env["COMSPEC"] || "cmd.exe",
          ["/d", "/s", "/c", located, ...args],
          {
            timeout: timeoutMs,
            windowsHide: true,
            maxBuffer: 512 * 1024
          }
        )
      : await execFileAsync(located, args, {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 512 * 1024
        });
    const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
    return {
      found: true,
      path: located,
      version: extractFirstVersionLine(combined),
      latencyMs: Math.max(0, Math.round(performance.now() - started))
    };
  } catch (err) {
    return {
      found: true,
      path: located,
      version: null,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Converts a T3 Server URL (HTTP/HTTPS or WS/WSS, including `/ws` or `/rpc`
 * paths) into an HTTP/HTTPS endpoint suitable for lightweight liveness probing.
 */
export function normalizeT3HttpProbeUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const lowerPath = parsed.pathname.toLowerCase();
    if (
      lowerPath === "/ws" ||
      lowerPath === "/ws/" ||
      lowerPath === "/rpc" ||
      lowerPath === "/rpc/"
    ) {
      parsed.pathname = "/";
      parsed.search = "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

async function defaultNetworkProbe(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
  method: "HEAD" | "GET" = "HEAD"
): Promise<NetworkProbeResult> {
  const started = performance.now();
  return new Promise<NetworkProbeResult>((resolvePromise) => {
    let settled = false;
    const done = (result: NetworkProbeResult) => {
      if (!settled) {
        settled = true;
        resolvePromise(result);
      }
    };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      done({
        reachable: false,
        statusCode: null,
        latencyMs: null,
        error: `无效 URL: ${url}`
      });
      return;
    }

    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(
      parsed,
      {
        method,
        agent: false,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; Prismux-Diagnostics/0.1)",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          connection: "close",
          ...headers
        }
      },
      (res) => {
        res.resume();
        const statusCode = res.statusCode ?? 0;
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        // 2xx, 3xx, or 405 (method not allowed on HEAD) still confirms endpoint reachability.
        const reachable =
          (statusCode >= 200 && statusCode < 400) || statusCode === 405;
        done({
          reachable,
          statusCode,
          latencyMs,
          ...(reachable ? {} : { error: `HTTP ${statusCode}` })
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`请求超时（>${timeoutMs}ms）`));
    }, timeoutMs);
    timer.unref?.();

    req.on("error", (err) => {
      clearTimeout(timer);
      done({
        reachable: false,
        statusCode: null,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        error: err.message
      });
    });

    req.on("close", () => {
      clearTimeout(timer);
    });

    req.end();
  });
}

function defaultDetectAndroidSdk(): {
  sdkRoot: string | null;
  adbPath: string | null;
} {
  const candidates: string[] = [];
  const envHome = process.env["ANDROID_HOME"]?.trim();
  const envSdkRoot = process.env["ANDROID_SDK_ROOT"]?.trim();
  if (envHome) candidates.push(resolve(envHome));
  if (envSdkRoot) candidates.push(resolve(envSdkRoot));

  if (process.platform === "win32") {
    const localAppData =
      process.env["LOCALAPPDATA"]?.trim() ||
      join(homedir(), "AppData", "Local");
    candidates.push(join(localAppData, "Android", "Sdk"));
  } else if (process.platform === "darwin") {
    candidates.push(join(homedir(), "Library", "Android", "sdk"));
  } else {
    candidates.push(join(homedir(), "Android", "Sdk"));
  }

  let sdkRoot: string | null = null;
  let adbPath: string | null = null;
  const adbBin = process.platform === "win32" ? "adb.exe" : "adb";

  for (const dir of candidates) {
    if (existsSync(dir)) {
      if (sdkRoot === null) {
        sdkRoot = dir;
      }
      const adbCandidate = join(dir, "platform-tools", adbBin);
      if (existsSync(adbCandidate)) {
        sdkRoot = dir;
        adbPath = adbCandidate;
        break;
      }
    }
  }

  if (adbPath === null) {
    adbPath = findExecutableOnPath([adbBin]);
  }

  return { sdkRoot, adbPath };
}

function detectLocalToolchainPackage(
  packageBinary: string,
  dataDir: string
): string | null {
  const onPath = findExecutableOnPath([packageBinary]);
  if (onPath) {
    return onPath;
  }

  const binExt = process.platform === "win32" ? ".cmd" : "";
  const home = homedir();
  const roots = [
    join(dataDir, "device-toolchain"),
    join(home, ".t3", "device-toolchain"),
    join(home, ".prismux", "device-toolchain")
  ];

  for (const root of roots) {
    const candidates = [
      join(root, "node_modules", ".bin", `${packageBinary}${binExt}`),
      join(root, "node_modules", packageBinary, "package.json")
    ];
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function withTimeoutFallback<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: () => T
): Promise<T> {
  return new Promise<T>((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolvePromise(fallback());
      }
    }, timeoutMs);
    timer.unref?.();

    promise
      .then((value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolvePromise(value);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolvePromise(fallback());
        }
      });
  });
}

function computeGroupStatus(
  items: readonly DiagnosticCheckItem[]
): DiagnosticCheckStatus {
  if (items.some((item) => item.status === "error")) {
    return "error";
  }
  if (items.some((item) => item.status === "degraded")) {
    return "degraded";
  }
  return "ok";
}

/**
 * Full-system asynchronous health & environment diagnostics service.
 * Runs all 6 groups in parallel with per-check timeouts, a hard <3s global budget,
 * and a 30s response cache (bypassable via `?force=1`).
 *
 * Security redline: AI Provider CLI probes ONLY inspect binary presence & `--version`;
 * NEVER reads any OAuth tokens, Keyring entries, or credential files.
 */
export class ServiceDiagnosticsService {
  private readonly opts: ServiceDiagnosticsOptions;
  private readonly cacheTtlMs: number;
  private readonly singleCheckTimeoutMs: number;
  private readonly globalBudgetMs: number;
  private readonly cliProbeFn: (
    command: string,
    args: string[],
    timeoutMs: number
  ) => Promise<CliProbeResult>;
  private readonly networkProbeFn: (
    url: string,
    timeoutMs: number,
    headers?: Record<string, string>,
    method?: "HEAD" | "GET"
  ) => Promise<NetworkProbeResult>;
  private readonly detectAndroidSdkFn: () => {
    sdkRoot: string | null;
    adbPath: string | null;
  };
  private readonly resolve7zaFn: () => string | null;

  private cachedReport: ServiceDiagnosticsResponse | null = null;
  private inflightRun: Promise<ServiceDiagnosticsResponse> | null = null;

  constructor(options: ServiceDiagnosticsOptions) {
    this.opts = options;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.singleCheckTimeoutMs = Math.min(
      options.singleCheckTimeoutMs ?? DEFAULT_SINGLE_CHECK_TIMEOUT_MS,
      2_000
    );
    this.globalBudgetMs = Math.min(
      options.globalBudgetMs ?? DEFAULT_GLOBAL_BUDGET_MS,
      2_700
    );
    this.cliProbeFn = options.cliProbe ?? defaultCliProbe;
    this.networkProbeFn = options.networkProbe ?? defaultNetworkProbe;
    this.detectAndroidSdkFn =
      options.detectAndroidSdk ?? defaultDetectAndroidSdk;
    this.resolve7zaFn =
      options.resolve7za ??
      (() => this.opts.appUpdater?.resolve7zaPath() ?? resolve7zaBinary());
  }

  clearCache(): void {
    this.cachedReport = null;
  }

  async runDiagnostics(force = false): Promise<ServiceDiagnosticsResponse> {
    const now = Date.now();
    if (
      !force &&
      this.cachedReport !== null &&
      now - this.cachedReport.checkedAt < this.cacheTtlMs
    ) {
      return {
        ...this.cachedReport,
        cached: true
      };
    }

    if (!force && this.inflightRun !== null) {
      return this.inflightRun;
    }

    const run = this.executeAllChecks().finally(() => {
      if (this.inflightRun === run) {
        this.inflightRun = null;
      }
    });
    this.inflightRun = run;
    return run;
  }

  private async executeAllChecks(): Promise<ServiceDiagnosticsResponse> {
    const startedAt = performance.now();
    const budget = this.globalBudgetMs;
    const perCheckTimeout = Math.min(this.singleCheckTimeoutMs, budget);

    const checkSpecs: Array<{
      id: string;
      category: DiagnosticCategoryId;
      name: string;
      settingsRoute?: string;
      run: () => Promise<DiagnosticCheckItem>;
    }> = [
      // a. 宿主核心 (4)
      {
        id: "host.daemon",
        category: "host_core",
        name: "Prismux Daemon",
        run: async () => this.checkDaemonCore()
      },
      {
        id: "host.t3_server",
        category: "host_core",
        name: "Prismux Server",
        run: () => this.checkT3Server(perCheckTimeout)
      },
      {
        id: "host.electron_bridge",
        category: "host_core",
        name: "Electron Bridge",
        run: async () => this.checkElectronBridge()
      },
      {
        id: "host.resource_monitor",
        category: "host_core",
        name: "Resource Monitor",
        run: async () => this.checkResourceMonitor()
      },

      // b. 记忆与同步 (3)
      {
        id: "memory.sqlite_wal",
        category: "memory_sync",
        name: "memory.db (SQLite WAL + FTS5)",
        settingsRoute: "/settings/memory-sync",
        run: async () => this.checkMemoryDb()
      },
      {
        id: "memory.sqlite_vec",
        category: "memory_sync",
        name: "sqlite-vec 混合向量引擎",
        settingsRoute: "/settings/memory-sync",
        run: async () => this.checkSqliteVec()
      },
      {
        id: "sync.vault",
        category: "memory_sync",
        name: "SyncVault 加密同步通道",
        settingsRoute: "/settings/memory-sync",
        run: async () => this.checkSyncVault()
      },

      // c. AI Provider CLI (6) — version-only probes, ZERO OAuth/keyring reads
      {
        id: "provider.agy",
        category: "ai_providers",
        name: "Antigravity CLI (agy · 纯 ACP)",
        settingsRoute: "/settings/providers",
        run: () =>
          this.checkProviderCli({
            id: "provider.agy",
            name: "Antigravity CLI (agy · 纯 ACP)",
            command: "agy",
            args: ["--version"],
            fixAction: "安装本机 agy CLI 并运行 ACP 登录",
            fixCommand: "agy acp --login",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "provider.claude",
        category: "ai_providers",
        name: "Claude Code CLI (claude)",
        settingsRoute: "/settings/providers",
        run: () =>
          this.checkProviderCli({
            id: "provider.claude",
            name: "Claude Code CLI (claude)",
            command: "claude",
            args: ["--version"],
            fixAction: "安装官方 Claude Code CLI",
            fixCommand: "npm install -g @anthropic-ai/claude-code",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "provider.codex",
        category: "ai_providers",
        name: "Codex CLI (codex)",
        settingsRoute: "/settings/providers",
        run: () =>
          this.checkProviderCli({
            id: "provider.codex",
            name: "Codex CLI (codex)",
            command: "codex",
            args: ["--version"],
            fixAction: "安装官方 Codex CLI",
            fixCommand: "npm install -g @openai/codex",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "provider.omp",
        category: "ai_providers",
        name: "Oh My Pi CLI (omp · ACP)",
        settingsRoute: "/settings/providers",
        run: () =>
          this.checkProviderCli({
            id: "provider.omp",
            name: "Oh My Pi CLI (omp · ACP)",
            command: "omp",
            args: ["--version"],
            fixAction: "安装 OMP CLI（支持 ACP 转向与用量）",
            fixCommand: "npm install -g @oh-my-pi/pi-coding-agent",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "provider.gemini",
        category: "ai_providers",
        name: "Gemini CLI (gemini)",
        settingsRoute: "/settings/providers",
        run: () =>
          this.checkProviderCli({
            id: "provider.gemini",
            name: "Gemini CLI (gemini)",
            command: "gemini",
            args: ["--version"],
            fixAction: "安装官方 Gemini CLI",
            fixCommand: "npm install -g @google/gemini-cli",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "provider.opencode",
        category: "ai_providers",
        name: "OpenCode CLI (opencode)",
        settingsRoute: "/settings/providers",
        run: () =>
          this.checkProviderCli({
            id: "provider.opencode",
            name: "OpenCode CLI (opencode)",
            command: "opencode",
            args: ["--version"],
            fixAction: "安装 OpenCode CLI",
            fixCommand: "npm install -g opencode-ai",
            timeoutMs: perCheckTimeout
          })
      },

      // d. 模拟器与媒体工具 (7)
      {
        id: "tool.7zip",
        category: "simulators_media",
        name: "7za / 7z 解压工具",
        settingsRoute: "/settings/updates",
        run: () => this.check7Zip(perCheckTimeout)
      },
      {
        id: "tool.steam_431960",
        category: "simulators_media",
        name: "Steam Workshop 431960 (Wallpaper Engine)",
        settingsRoute: "/settings/wallpaper",
        run: () => this.checkSteam431960()
      },
      {
        id: "tool.android_sdk",
        category: "simulators_media",
        name: "Android SDK / adb",
        run: () => this.checkAndroidSdk(perCheckTimeout)
      },
      {
        id: "tool.expo_device_hub",
        category: "simulators_media",
        name: "expo-device-hub",
        run: async () =>
          this.checkDeviceToolchainBinary(
            "tool.expo_device_hub",
            "expo-device-hub",
            "expo-device-hub"
          )
      },
      {
        id: "tool.agent_device",
        category: "simulators_media",
        name: "agent-device",
        run: async () =>
          this.checkDeviceToolchainBinary(
            "tool.agent_device",
            "agent-device",
            "agent-device"
          )
      },
      {
        id: "tool.git",
        category: "simulators_media",
        name: "Git",
        run: () =>
          this.checkGenericCliTool({
            id: "tool.git",
            name: "Git",
            command: "git",
            args: ["--version"],
            fixAction: "安装 Git 并加入 PATH",
            fixCommand: "winget install --id Git.Git -e",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "tool.gh",
        category: "simulators_media",
        name: "GitHub CLI (gh)",
        run: () =>
          this.checkGenericCliTool({
            id: "tool.gh",
            name: "GitHub CLI (gh)",
            command: "gh",
            args: ["--version"],
            fixAction: "按需安装 GitHub CLI（仅做版本探测）",
            fixCommand: "winget install --id GitHub.cli -e",
            timeoutMs: perCheckTimeout
          })
      },

      // e. 网络与镜像源 (5)
      {
        id: "mirror.github_releases",
        category: "network_mirrors",
        name: "GitHub Releases",
        settingsRoute: "/settings/updates",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.github_releases",
            name: "GitHub Releases",
            url: `${UPDATE_ENDPOINTS.githubWebBase}/${UPDATE_ENDPOINTS.githubOwner}/${UPDATE_ENDPOINTS.githubRepo}/releases/latest`,
            headers: {
              accept: "text/html,application/xhtml+xml,*/*;q=0.8"
            },
            fixAction: "可在「软件更新」切换国内镜像或配置自定义代理前缀",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.gitee_releases",
        category: "network_mirrors",
        name: "Gitee Releases（国内源）",
        settingsRoute: "/settings/updates",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.gitee_releases",
            name: "Gitee Releases（国内源）",
            url: `${UPDATE_ENDPOINTS.giteeWebBase}/${UPDATE_ENDPOINTS.giteeOwner}/${UPDATE_ENDPOINTS.giteeRepo}/releases/latest`,
            headers: {
              accept: "text/html,application/xhtml+xml,*/*;q=0.8"
            },
            fixAction: "可在「软件更新」切换为海外 GitHub 源",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.npmjs",
        category: "network_mirrors",
        name: "npmjs Registry",
        settingsRoute: "/settings/plugins",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.npmjs",
            name: "npmjs Registry",
            url: `${UPDATE_ENDPOINTS.npmRegistry}/-/ping`,
            fixAction: "可在「软件更新」将插件源切换至 npmmirror 国内镜像",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.npmmirror",
        category: "network_mirrors",
        name: "npmmirror 国内镜像",
        settingsRoute: "/settings/plugins",
        run: () =>
          this.checkMirrorEndpoint({
            id: "mirror.npmmirror",
            name: "npmmirror 国内镜像",
            url: `${UPDATE_ENDPOINTS.npmMirrorRegistry}/-/ping`,
            fixAction: "检查网络连接或切换至 npmjs 官方源",
            settingsRoute: "/settings/updates",
            timeoutMs: perCheckTimeout
          })
      },
      {
        id: "mirror.huggingface",
        category: "network_mirrors",
        name: "HuggingFace / HF-Mirror",
        run: () => this.checkHuggingFaceMirror(perCheckTimeout)
      },

      // f. 沉睡内核状态摘要 (3) — read-only summaries
      {
        id: "engine.overnight_factory",
        category: "dormant_engines",
        name: "OvernightFactory（夜间全自动工场）",
        run: async () => this.checkOvernightFactory()
      },
      {
        id: "engine.lifecycle_hook_bus",
        category: "dormant_engines",
        name: "LifecycleHookBus（生命周期钩子总线）",
        run: async () => this.checkLifecycleHookBus()
      },
      {
        id: "engine.worktree_sandbox",
        category: "dormant_engines",
        name: "WorktreeSandbox（工作树隔离沙箱）",
        run: async () => this.checkWorktreeSandbox()
      }
    ];

    const settledItems = await Promise.all(
      checkSpecs.map((spec) =>
        withTimeoutFallback(
          spec.run(),
          Math.min(perCheckTimeout + 150, budget),
          (): DiagnosticCheckItem => ({
            id: spec.id,
            category: spec.category,
            name: spec.name,
            status: "degraded",
            summary: `探测超时（>${perCheckTimeout}ms），已跳过以保护整体体检响应速度`,
            ...(spec.settingsRoute !== undefined
              ? { settingsRoute: spec.settingsRoute }
              : {})
          })
        )
      )
    );

    const groups: DiagnosticGroupSummary[] = DIAGNOSTIC_CATEGORIES.map((catId) => {
      const catItems = settledItems.filter((item) => item.category === catId);
      const okCount = catItems.filter((i) => i.status === "ok").length;
      const degradedCount = catItems.filter((i) => i.status === "degraded").length;
      const errorCount = catItems.filter((i) => i.status === "error").length;
      const label = CATEGORY_LABELS[catId];
      return {
        id: catId,
        label,
        title: label,
        status: computeGroupStatus(catItems),
        okCount,
        degradedCount,
        errorCount,
        items: catItems
      };
    });

    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const okTotal = settledItems.filter((i) => i.status === "ok").length;
    const degradedTotal = settledItems.filter((i) => i.status === "degraded").length;
    const errorTotal = settledItems.filter((i) => i.status === "error").length;

    const report: ServiceDiagnosticsResponse = {
      ok: true,
      checkedAt: Date.now(),
      durationMs,
      cached: false,
      summary: {
        total: settledItems.length,
        ok: okTotal,
        degraded: degradedTotal,
        error: errorTotal
      },
      groups,
      items: settledItems
    };

    this.cachedReport = report;
    return report;
  }

  private checkDaemonCore(): DiagnosticCheckItem {
    const uptimeSec = Math.max(0, Math.round((Date.now() - this.opts.startedAt) / 1000));
    return {
      id: "host.daemon",
      category: "host_core",
      name: "Prismux Daemon",
      status: "ok",
      version: this.opts.version,
      summary: `运行正常（v${this.opts.version}，已运行 ${uptimeSec}s）`,
      detail: `PID ${process.pid} · 数据目录 ${this.opts.dataDir}`
    };
  }

  private async checkT3Server(timeoutMs: number): Promise<DiagnosticCheckItem> {
    const sup = this.opts.t3Supervisor?.getStatus();
    const rpc = this.opts.t3RpcClient?.getStatus();
    const connected = rpc?.connected ?? false;
    if (connected) {
      return {
        id: "host.t3_server",
        category: "host_core",
        name: "Prismux Server",
        status: "ok",
        summary: `已连接${sup?.pid ? `（PID ${sup.pid}）` : ""}`,
        detail: rpc?.wsUrl ? `RPC: ${rpc.wsUrl}` : undefined
      };
    }

    const rawCandidates = [
      this.opts.t3ServerUrl,
      process.env["PRISMUX_T3_SERVER_URL"],
      process.env["T3CODE_SERVER_URL"],
      sup?.healthUrl,
      rpc?.wsUrl
    ];
    const probeUrls: string[] = [];
    for (const raw of rawCandidates) {
      if (typeof raw !== "string") {
        continue;
      }
      const normalized = normalizeT3HttpProbeUrl(raw);
      if (normalized !== null && !probeUrls.includes(normalized)) {
        probeUrls.push(normalized);
      }
    }

    if (probeUrls.length > 0) {
      const probeHeaders: Record<string, string> = {
        accept: "*/*"
      };
      const t3Token = this.opts.t3Token?.trim();
      if (t3Token && t3Token.length > 0) {
        probeHeaders["authorization"] = `Bearer ${t3Token}`;
      }

      let lastProbeError: string | undefined;
      for (const probeUrl of probeUrls) {
        const probed = await this.networkProbeFn(
          probeUrl,
          timeoutMs,
          probeHeaders,
          "GET"
        );
        const httpAlive =
          probed.reachable ||
          (probed.statusCode !== null &&
            probed.statusCode >= 200 &&
            probed.statusCode < 500);
        if (httpAlive) {
          let hostLabel = probeUrl;
          try {
            hostLabel = new URL(probeUrl).host;
          } catch {
            // keep full URL label
          }
          const codeLabel =
            probed.statusCode !== null ? `HTTP ${probed.statusCode}` : "HTTP OK";
          const latencySuffix =
            probed.latencyMs !== null ? ` · ${probed.latencyMs}ms` : "";
          return {
            id: "host.t3_server",
            category: "host_core",
            name: "Prismux Server",
            status: "ok",
            ...(probed.latencyMs !== null ? { latencyMs: probed.latencyMs } : {}),
            summary: sup?.pid
              ? `运行中（PID ${sup.pid} · ${codeLabel}${latencySuffix}）`
              : `桌面托管运行中（${hostLabel} · ${codeLabel}${latencySuffix}）`,
            detail: `HTTP 存活探测通过：${probeUrl}`
          };
        }
        lastProbeError = probed.error ?? lastProbeError;
      }

      if (sup?.state === "running") {
        return {
          id: "host.t3_server",
          category: "host_core",
          name: "Prismux Server",
          status: "degraded",
          summary: `进程已启动（PID ${sup.pid ?? "?"}），HTTP/RPC 就绪探测中`,
          detail: lastProbeError ?? rpc?.lastError ?? sup.lastError
        };
      }

      let firstHost = probeUrls[0]!;
      try {
        firstHost = new URL(probeUrls[0]!).host;
      } catch {
        // keep full URL
      }
      return {
        id: "host.t3_server",
        category: "host_core",
        name: "Prismux Server",
        status: "degraded",
        summary: `Prismux Server 未响应（${firstHost}）`,
        detail:
          lastProbeError ??
          sup?.lastError ??
          rpc?.lastError ??
          `HTTP 探测未连通：${probeUrls[0]}`
      };
    }

    if (sup?.state === "running") {
      return {
        id: "host.t3_server",
        category: "host_core",
        name: "Prismux Server",
        status: "degraded",
        summary: `进程已启动（PID ${sup.pid ?? "?"}），RPC 重连中`,
        detail: rpc?.lastError ?? sup.lastError
      };
    }
    return {
      id: "host.t3_server",
      category: "host_core",
      name: "Prismux Server",
      status: "degraded",
      summary: "独立模式或未附加 Prismux Server 监督器",
      detail: sup?.lastError ?? rpc?.lastError ?? "可由桌面宿主托管连接"
    };
  }

  private checkElectronBridge(): DiagnosticCheckItem {
    const hasMainPid = Boolean(process.env["PRISMUX_MAIN_PID"]?.trim());
    const hasResourcesPath = Boolean(
      (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    );
    if (!this.opts.headless || hasMainPid || hasResourcesPath) {
      return {
        id: "host.electron_bridge",
        category: "host_core",
        name: "Electron Bridge",
        status: "ok",
        summary: "桌面宿主桥接模式就绪",
        detail: hasMainPid
          ? `宿主主进程 PID ${process.env["PRISMUX_MAIN_PID"]}`
          : "已启用桌面窗口桥接上下文"
      };
    }
    return {
      id: "host.electron_bridge",
      category: "host_core",
      name: "Electron Bridge",
      status: "degraded",
      summary: "当前为无头守护模式（--headless）",
      detail: "从 Prismux 桌面客户端启动后自动接通原生 Electron Bridge"
    };
  }

  private checkResourceMonitor(): DiagnosticCheckItem {
    const ptyCount = this.opts.ptyPool?.listSessions().length ?? 0;
    const rssMb = Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;
    return {
      id: "host.resource_monitor",
      category: "host_core",
      name: "Resource Monitor",
      status: this.opts.resourceMonitor ? "ok" : "degraded",
      summary: this.opts.resourceMonitor
        ? `采样正常（Daemon ${rssMb} MB · ${ptyCount} 个 PTY）`
        : "资源监控服务未挂载",
      detail: `平台 ${process.platform}`
    };
  }

  private checkMemoryDb(): DiagnosticCheckItem {
    const dbPath =
      this.opts.memoryDbPath ?? join(this.opts.dataDir, "data", "memory.db");
    if (!this.opts.memoryStore) {
      return {
        id: "memory.sqlite_wal",
        category: "memory_sync",
        name: "memory.db (SQLite WAL + FTS5)",
        status: "error",
        summary: "记忆存储未初始化",
        settingsRoute: "/settings/memory-sync"
      };
    }
    const exists = dbPath === ":memory:" || existsSync(dbPath);
    const sizeKb =
      dbPath !== ":memory:" && exists
        ? Math.round((statSync(dbPath).size / 1024) * 10) / 10
        : null;
    return {
      id: "memory.sqlite_wal",
      category: "memory_sync",
      name: "memory.db (SQLite WAL + FTS5)",
      status: exists ? "ok" : "degraded",
      summary: exists
        ? `SQLite WAL + FTS5 就绪${sizeKb !== null ? `（${sizeKb} KB）` : ""}`
        : "memory.db 尚未落盘",
      detail: dbPath,
      settingsRoute: "/settings/memory-sync"
    };
  }

  private checkSqliteVec(): DiagnosticCheckItem {
    const loaded = this.opts.memoryStore?.isVectorSearchEnabled() ?? false;
    if (loaded) {
      return {
        id: "memory.sqlite_vec",
        category: "memory_sync",
        name: "sqlite-vec 混合向量引擎",
        status: "ok",
        summary: "FTS5 + sqlite-vec 混合态",
        detail: "已加载 vec0 原生向量扩展，支持 RRF 混合检索。",
        settingsRoute: "/settings/memory-sync"
      };
    }
    return {
      id: "memory.sqlite_vec",
      category: "memory_sync",
      name: "sqlite-vec 混合向量引擎",
      status: "degraded",
      summary: "FTS5 降级态（缺 vec0.dll，无兼容风险）",
      detail: "当前自动使用 SQLite FTS5 trigram 全文检索，记忆读写与隔离完全正常。",
      settingsRoute: "/settings/memory-sync"
    };
  }

  private checkSyncVault(): DiagnosticCheckItem {
    if (!this.opts.syncVault) {
      return {
        id: "sync.vault",
        category: "memory_sync",
        name: "SyncVault 加密同步通道",
        status: "degraded",
        summary: "SyncVault 引擎未启用",
        settingsRoute: "/settings/memory-sync"
      };
    }
    const status = this.opts.syncVault.getStatus();
    const enabled = status.enabledChannels;
    if (enabled.length > 0) {
      return {
        id: "sync.vault",
        category: "memory_sync",
        name: "SyncVault 加密同步通道",
        status: "ok",
        summary: `已启用通道：${enabled.join(", ")}`,
        detail: status.portable.isPortable
          ? `便携模式 (${status.portable.dataDir})`
          : `看门狗 ${Math.round(status.watchdog.stallTimeoutMs / 1000)}s`,
        settingsRoute: "/settings/memory-sync"
      };
    }
    return {
      id: "sync.vault",
      category: "memory_sync",
      name: "SyncVault 加密同步通道",
      status: "degraded",
      summary: "尚未启用远程加密同步通道（仅本地存储）",
      fixAction: "前往「记忆与同步」配置 WebDAV / S3 / GitHub 加密同步",
      settingsRoute: "/settings/memory-sync"
    };
  }

  private async checkProviderCli(params: {
    id: string;
    name: string;
    command: string;
    args: string[];
    fixAction: string;
    fixCommand: string;
    timeoutMs: number;
  }): Promise<DiagnosticCheckItem> {
    const probed = await this.cliProbeFn(
      params.command,
      params.args,
      params.timeoutMs
    );
    if (probed.found && probed.version) {
      return {
        id: params.id,
        category: "ai_providers",
        name: params.name,
        status: "ok",
        version: probed.version,
        latencyMs: probed.latencyMs,
        summary: `已安装（${probed.version}）`,
        detail: probed.path ?? undefined,
        settingsRoute: "/settings/providers"
      };
    }
    if (probed.found) {
      return {
        id: params.id,
        category: "ai_providers",
        name: params.name,
        status: "degraded",
        latencyMs: probed.latencyMs,
        summary: "已发现可执行文件，但版本探测未返回",
        detail: probed.error ?? probed.path ?? undefined,
        fixAction: params.fixAction,
        fixCommand: params.fixCommand,
        settingsRoute: "/settings/providers"
      };
    }
    return {
      id: params.id,
      category: "ai_providers",
      name: params.name,
      status: "degraded",
      latencyMs: probed.latencyMs,
      summary: "未检测到本机 CLI（按需安装）",
      fixAction: params.fixAction,
      fixCommand: params.fixCommand,
      settingsRoute: "/settings/providers"
    };
  }

  private async check7Zip(timeoutMs: number): Promise<DiagnosticCheckItem> {
    const binPath = this.resolve7zaFn();
    if (!binPath) {
      return {
        id: "tool.7zip",
        category: "simulators_media",
        name: "7za / 7z 解压工具",
        status: "degraded",
        summary: "未找到 7za.exe / 7z.exe（Gitee 分卷更新重组需要）",
        fixAction: "安装 7-Zip 或设置环境变量 PRISMUX_7ZA_PATH",
        fixCommand: "winget install --id 7zip.7zip -e",
        settingsRoute: "/settings/updates"
      };
    }
    const started = performance.now();
    let version: string | null = null;
    try {
      const { stdout } = await execFileAsync(binPath, ["i"], {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 256 * 1024
      });
      version = extractFirstVersionLine(stdout);
    } catch {
      // Presence alone is sufficient
    }
    return {
      id: "tool.7zip",
      category: "simulators_media",
      name: "7za / 7z 解压工具",
      status: "ok",
      version,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      summary: version ? `可用（${version}）` : "已就绪（可解压 Gitee 分卷安装包）",
      detail: binPath,
      settingsRoute: "/settings/updates"
    };
  }

  private async checkSteam431960(): Promise<DiagnosticCheckItem> {
    try {
      if (this.opts.wallpaperService) {
        const inv = await this.opts.wallpaperService.getInventory();
        const workshopCount = inv.workshopDirs.length;
        const steamItems = inv.items.filter((item) => item.source === "steam").length;
        if (workshopCount > 0) {
          return {
            id: "tool.steam_431960",
            category: "simulators_media",
            name: "Steam Workshop 431960 (Wallpaper Engine)",
            status: "ok",
            summary: `已接入 ${workshopCount} 个创意工坊目录（共 ${steamItems} 个壁纸）`,
            detail: inv.workshopDirs.join("; "),
            settingsRoute: "/settings/wallpaper"
          };
        }
      }
    } catch {
      // fall through to degraded state
    }

    return {
      id: "tool.steam_431960",
      category: "simulators_media",
      name: "Steam Workshop 431960 (Wallpaper Engine)",
      status: "degraded",
      summary: "未检测到 Steam 431960 创意工坊目录（可使用内置或本地壁纸）",
      fixAction: "前往「壁纸引擎」设置手动指定 Steam 根目录或自定义壁纸文件夹",
      settingsRoute: "/settings/wallpaper"
    };
  }

  private async checkAndroidSdk(timeoutMs: number): Promise<DiagnosticCheckItem> {
    const detected = this.detectAndroidSdkFn();
    if (detected.adbPath) {
      let version: string | null = null;
      const started = performance.now();
      try {
        const { stdout } = await execFileAsync(detected.adbPath, ["version"], {
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 256 * 1024
        });
        version = extractFirstVersionLine(stdout);
      } catch {
        // adb exists even if version failed
      }
      return {
        id: "tool.android_sdk",
        category: "simulators_media",
        name: "Android SDK / adb",
        status: "ok",
        version,
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        summary: version ? `adb 就绪（${version}）` : "已检测到 adb",
        detail: detected.sdkRoot
          ? `SDK: ${detected.sdkRoot} · adb: ${detected.adbPath}`
          : detected.adbPath
      };
    }

    return {
      id: "tool.android_sdk",
      category: "simulators_media",
      name: "Android SDK / adb",
      status: "degraded",
      summary: detected.sdkRoot
        ? `已检测到 SDK 目录但缺少 platform-tools/adb`
        : "未检测到 Android SDK 或 adb（仅真机/安卓模拟器需要）",
      detail: detected.sdkRoot ?? undefined,
      fixAction: "安装 Android Platform Tools 并设置 ANDROID_HOME",
      fixCommand: "winget install --id Google.PlatformTools -e"
    };
  }

  private checkDeviceToolchainBinary(
    id: string,
    name: string,
    binName: string
  ): DiagnosticCheckItem {
    const located = detectLocalToolchainPackage(binName, this.opts.dataDir);
    if (located) {
      return {
        id,
        category: "simulators_media",
        name,
        status: "ok",
        summary: "已安装（移动设备联调工具就绪）",
        detail: located
      };
    }
    return {
      id,
      category: "simulators_media",
      name,
      status: "degraded",
      summary: "尚未安装（可在设备模拟器面板按需安装，支持国内 npmmirror 镜像）",
      fixAction: `使用 npmmirror 安装 ${binName}`,
      fixCommand: `npm install -g ${binName} --registry=https://registry.npmmirror.com`
    };
  }

  private async checkGenericCliTool(params: {
    id: string;
    name: string;
    command: string;
    args: string[];
    fixAction: string;
    fixCommand: string;
    timeoutMs: number;
  }): Promise<DiagnosticCheckItem> {
    const probed = await this.cliProbeFn(
      params.command,
      params.args,
      params.timeoutMs
    );
    if (probed.found) {
      return {
        id: params.id,
        category: "simulators_media",
        name: params.name,
        status: "ok",
        version: probed.version ?? null,
        latencyMs: probed.latencyMs,
        summary: probed.version ? `已安装（${probed.version}）` : "已安装",
        detail: probed.path ?? undefined
      };
    }
    return {
      id: params.id,
      category: "simulators_media",
      name: params.name,
      status: "degraded",
      latencyMs: probed.latencyMs,
      summary: `未在 PATH 中找到 ${params.command}`,
      fixAction: params.fixAction,
      fixCommand: params.fixCommand
    };
  }

  private async checkMirrorEndpoint(params: {
    id: string;
    name: string;
    url: string;
    headers?: Record<string, string>;
    fixAction: string;
    settingsRoute?: string;
    timeoutMs: number;
  }): Promise<DiagnosticCheckItem> {
    const probed = await this.networkProbeFn(
      params.url,
      params.timeoutMs,
      params.headers
    );
    if (probed.reachable) {
      return {
        id: params.id,
        category: "network_mirrors",
        name: params.name,
        status: "ok",
        latencyMs: probed.latencyMs,
        summary: `可达（${probed.latencyMs ?? 0}ms · HTTP ${probed.statusCode ?? 200}）`,
        detail: params.url,
        ...(params.settingsRoute !== undefined
          ? { settingsRoute: params.settingsRoute }
          : {})
      };
    }
    return {
      id: params.id,
      category: "network_mirrors",
      name: params.name,
      status: "degraded",
      latencyMs: probed.latencyMs,
      summary: `不可达或超时（${probed.error ?? "连接失败"}）`,
      detail: params.url,
      fixAction: params.fixAction,
      ...(params.settingsRoute !== undefined
        ? { settingsRoute: params.settingsRoute }
        : {})
    };
  }

  private async checkHuggingFaceMirror(
    timeoutMs: number
  ): Promise<DiagnosticCheckItem> {
    const configured = process.env["HF_ENDPOINT"]?.trim();
    const primaryUrl =
      configured && /^https?:\/\//i.test(configured)
        ? configured.replace(/\/+$/, "")
        : "https://hf-mirror.com";
    const probe = await this.networkProbeFn(primaryUrl, timeoutMs);
    if (probe.reachable) {
      return {
        id: "mirror.huggingface",
        category: "network_mirrors",
        name: "HuggingFace / HF-Mirror",
        status: "ok",
        latencyMs: probe.latencyMs,
        summary: `镜像可达（${primaryUrl} · ${probe.latencyMs ?? 0}ms）`,
        detail: configured
          ? `已配置 HF_ENDPOINT=${configured}`
          : "国内网络建议设置 HF_ENDPOINT=https://hf-mirror.com 以加速语音/本地模型下载"
      };
    }
    return {
      id: "mirror.huggingface",
      category: "network_mirrors",
      name: "HuggingFace / HF-Mirror",
      status: "degraded",
      latencyMs: probe.latencyMs,
      summary: `镜像暂不可达（${primaryUrl}：${probe.error ?? "连接失败"}）`,
      fixAction: "国内环境建议配置 HF_ENDPOINT=https://hf-mirror.com",
      fixCommand: "$env:HF_ENDPOINT = 'https://hf-mirror.com'"
    };
  }

  private checkOvernightFactory(): DiagnosticCheckItem {
    if (!this.opts.overnightFactory) {
      return {
        id: "engine.overnight_factory",
        category: "dormant_engines",
        name: "OvernightFactory（夜间全自动工场）",
        status: "degraded",
        summary: "未挂载夜间工场实例"
      };
    }
    const cfg = this.opts.overnightFactory.getInboundConfig();
    const stages = this.opts.overnightFactory.getStages();
    const processedCount = this.opts.overnightFactory.getProcessedMessageIds().length;
    return {
      id: "engine.overnight_factory",
      category: "dormant_engines",
      name: "OvernightFactory（夜间全自动工场）",
      status: "ok",
      summary: `待命就绪（模式 ${cfg.mode} · 标签 ${cfg.matchAliasOrTag} · ${stages.length} 阶段）`,
      detail: `已处理任务邮件 ${processedCount} 封（只读摘要）`
    };
  }

  private checkLifecycleHookBus(): DiagnosticCheckItem {
    if (!this.opts.hookBus) {
      return {
        id: "engine.lifecycle_hook_bus",
        category: "dormant_engines",
        name: "LifecycleHookBus（生命周期钩子总线）",
        status: "degraded",
        summary: "未挂载钩子总线实例"
      };
    }
    const permMode = this.opts.hookBus.getPermissionMode();
    const hooksCount = this.opts.hookBus.getRegisteredHooks().length;
    const pendingApprovals = this.opts.hookBus
      .listApprovalRecords()
      .filter((r) => r.status === "pending").length;
    return {
      id: "engine.lifecycle_hook_bus",
      category: "dormant_engines",
      name: "LifecycleHookBus（生命周期钩子总线）",
      status: "ok",
      summary: `运行待命（权限档 ${permMode} · 已注册 ${hooksCount} 条钩子 · 待审批 ${pendingApprovals} 条）`,
      detail: "安全钩子默认 onFailure=block（只读摘要）"
    };
  }

  private checkWorktreeSandbox(): DiagnosticCheckItem {
    const backend = selectPlatformSandboxBackend(process.platform);
    return {
      id: "engine.worktree_sandbox",
      category: "dormant_engines",
      name: "WorktreeSandbox（工作树隔离沙箱）",
      status: this.opts.sandbox ? "ok" : "degraded",
      summary: this.opts.sandbox
        ? `隔离引擎待命（后端 ${backend}）`
        : "未挂载工作树隔离沙箱",
      detail: `平台 ${process.platform} · OS 级写隔离 + 域名白名单网关（只读摘要）`
    };
  }
}
