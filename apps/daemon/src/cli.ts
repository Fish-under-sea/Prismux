#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { BRAND } from "@prismux/protocol";
import { PrismuxDaemon, sanitizeProviderEnv } from "./index.js";

export interface DaemonCliParsedArgs {
  command: "start" | "help" | "version";
  headless: boolean;
  dataDir: string;
}

export function resolveDefaultDataDir(): string {
  return join(homedir(), BRAND.dataDirName);
}

export function parseDaemonCliArgs(argv: string[]): DaemonCliParsedArgs {
  let command: "start" | "help" | "version" = "start";
  let headless = false;
  let dataDir = resolveDefaultDataDir();

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
      const next = argv[i + 1];
      if (next !== undefined && next.length > 0) {
        dataDir = resolve(next);
        i += 1;
      }
    }
  }

  return { command, headless, dataDir };
}

export async function runDaemonCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseDaemonCliArgs(argv);

  if (parsed.command === "help") {
    process.stdout.write(
      `${BRAND.appName} Daemon CLI\n\nUsage:\n  ${BRAND.appSlug} start [--headless] [--data-dir <path>]\n  ${BRAND.appSlug} --help\n  ${BRAND.appSlug} --version\n`
    );
    return 0;
  }

  if (parsed.command === "version") {
    process.stdout.write(`${BRAND.appSlug} 0.1.0\n`);
    return 0;
  }

  const sanitizedEnv = sanitizeProviderEnv(process.env);
  const daemon = new PrismuxDaemon({
    headless: parsed.headless,
    dataDir: parsed.dataDir
  });
  await daemon.start();

  process.stdout.write(
    `[${BRAND.appName}] daemon scaffold started (headless=${String(parsed.headless)}, dataDir=${parsed.dataDir}, cleanEnvKeys=${Object.keys(sanitizedEnv).length}).\n`
  );
  await daemon.stop();
  return 0;
}

const currentFile = fileURLToPath(import.meta.url);
const entryArg = process.argv[1];
if (entryArg !== undefined && resolve(entryArg) === resolve(currentFile)) {
  const exitCode = await runDaemonCli();
  process.exitCode = exitCode;
}
