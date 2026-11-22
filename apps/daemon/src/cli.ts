#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { BRAND } from "@prismux/protocol";
import { resolvePortableDataDir } from "@prismux/sync-vault";
import {
  PrismuxDaemon,
  resolveDaemonPackageVersion,
  sanitizeProviderEnv
} from "./index.js";

export interface DaemonCliParsedArgs {
  command: "start" | "help" | "version";
  headless: boolean;
  dataDir: string;
  isPortable: boolean;
  portableRoot?: string;
  host: string;
  port: number;
  t3Url?: string;
  t3Token?: string;
  t3Command?: string;
  t3Args?: string[];
  authToken?: string;
}

export function resolveDefaultDataDir(): string {
  return join(homedir(), BRAND.dataDirName);
}

function readNextArg(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing value for CLI option ${flag}`);
  }
  return value;
}

export function parseDaemonCliArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  defaultExecutableDir: string = dirname(process.execPath)
): DaemonCliParsedArgs {
  let command: "start" | "help" | "version" = "start";
  let headless = false;
  let explicitDataDir: string | undefined;
  let explicitPortableRoot: string | undefined;
  let host = "127.0.0.1";
  let port = 0;
  let t3Url: string | undefined;
  let t3Token: string | undefined;
  let t3Command: string | undefined;
  let t3Args: string[] | undefined;
  let authToken: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      command = "help";
    } else if (arg === "--version" || arg === "-v") {
      command = "version";
    } else if (arg === "start") {
      command = "start";
    } else if (arg === "--headless") {
      headless = true;
    } else if (arg === "--data-dir") {
      explicitDataDir = resolve(readNextArg(argv, i, "--data-dir"));
      i += 1;
    } else if (arg === "--portable-root") {
      explicitPortableRoot = resolve(readNextArg(argv, i, "--portable-root"));
      i += 1;
    } else if (arg === "--host") {
      host = readNextArg(argv, i, "--host");
      i += 1;
    } else if (arg === "--port") {
      const rawPort = readNextArg(argv, i, "--port");
      const parsedPort = Number.parseInt(rawPort, 10);
      if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
        throw new Error(`Invalid port number for --port: ${rawPort}`);
      }
      port = parsedPort;
      i += 1;
    } else if (arg === "--t3-url") {
      t3Url = readNextArg(argv, i, "--t3-url");
      i += 1;
    } else if (arg === "--t3-token") {
      t3Token = readNextArg(argv, i, "--t3-token");
      i += 1;
    } else if (arg === "--t3-command") {
      t3Command = readNextArg(argv, i, "--t3-command");
      i += 1;
    } else if (arg === "--t3-args") {
      const rawJson = readNextArg(argv, i, "--t3-args");
      const parsed: unknown = JSON.parse(rawJson);
      if (
        !Array.isArray(parsed) ||
        parsed.some((entry) => typeof entry !== "string")
      ) {
        throw new Error("--t3-args must be a JSON array of strings.");
      }
      t3Args = parsed;
      i += 1;
    } else if (arg === "--auth-token") {
      authToken = readNextArg(argv, i, "--auth-token");
      i += 1;
    }
  }

  const envPortableDir = env.PRISMUX_PORTABLE_DIR?.trim();
  const probeExecutableDir =
    explicitPortableRoot ??
    (envPortableDir !== undefined && envPortableDir.length > 0
      ? resolve(envPortableDir)
      : defaultExecutableDir);

  let dataDir: string;
  let isPortable = false;
  let portableRoot: string | undefined;

  if (explicitDataDir !== undefined) {
    dataDir = explicitDataDir;
  } else {
    const portable = resolvePortableDataDir({
      executableDir: probeExecutableDir,
      defaultDataDir: resolveDefaultDataDir()
    });
    dataDir = portable.dataDir;
    isPortable = portable.isPortable;
    portableRoot = portable.isPortable ? probeExecutableDir : undefined;
  }

  return {
    command,
    headless,
    dataDir,
    isPortable,
    ...(portableRoot !== undefined ? { portableRoot } : {}),
    host,
    port,
    ...(t3Url !== undefined ? { t3Url } : {}),
    ...(t3Token !== undefined ? { t3Token } : {}),
    ...(t3Command !== undefined ? { t3Command } : {}),
    ...(t3Args !== undefined ? { t3Args } : {}),
    ...(authToken !== undefined ? { authToken } : {})
  };
}

export async function runDaemonCli(
  argv: string[] = process.argv.slice(2)
): Promise<number> {
  const parsed = parseDaemonCliArgs(argv);

  if (parsed.command === "help") {
    process.stdout.write(
      [
        `${BRAND.appName} Daemon CLI`,
        "",
        "Usage:",
        `  ${BRAND.appSlug} start [--headless] [--port <n>] [--host <h>] [--data-dir <dir>]`,
        "                 [--portable-root <dir>] [--t3-url <url>] [--t3-token <tok>]",
        "                 [--t3-command <cmd>] [--t3-args <json>] [--auth-token <tok>]",
        `  ${BRAND.appSlug} --help`,
        `  ${BRAND.appSlug} --version`,
        ""
      ].join("\n")
    );
    return 0;
  }

  if (parsed.command === "version") {
    process.stdout.write(`${BRAND.appSlug} ${resolveDaemonPackageVersion()}\n`);
    return 0;
  }

  sanitizeProviderEnv(process.env);

  let resolveShutdown: (() => void) | undefined;
  const shutdownSignal = new Promise<void>((resolvePromise) => {
    resolveShutdown = resolvePromise;
  });

  const triggerShutdown = () => {
    resolveShutdown?.();
  };

  const daemon = new PrismuxDaemon({
    headless: parsed.headless,
    dataDir: parsed.dataDir,
    portableRoot: parsed.portableRoot,
    host: parsed.host,
    port: parsed.port,
    t3Url: parsed.t3Url,
    t3Token: parsed.t3Token,
    t3Command: parsed.t3Command,
    t3Args: parsed.t3Args,
    authToken: parsed.authToken,
    onShutdownRequested: () => {
      triggerShutdown();
    }
  });

  process.on("SIGINT", triggerShutdown);
  process.on("SIGTERM", triggerShutdown);

  try {
    const readyInfo = await daemon.start();
    process.stdout.write(`PRISMUX_DAEMON_READY ${JSON.stringify(readyInfo)}\n`);
    await shutdownSignal;
  } finally {
    process.off("SIGINT", triggerShutdown);
    process.off("SIGTERM", triggerShutdown);
    await daemon.stop();
  }

  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
const entryArg = process.argv[1];
if (entryArg !== undefined && resolve(entryArg) === resolve(currentFile)) {
  const exitCode = await runDaemonCli();
  process.exitCode = exitCode;
}
