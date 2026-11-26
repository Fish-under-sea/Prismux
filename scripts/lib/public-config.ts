// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads optional root env files before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

type Environment = Readonly<Record<string, string | undefined>>;

const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");

/**
 * Prismux enforces pure local-first zero-telemetry execution with zero legacy
 * cloud, Clerk OAuth, relay, or OTLP trace endpoints.
 */
export const DEFAULT_PRISMUX_PUBLIC_CONFIG: Readonly<Record<string, string>> = {};

const STRIPPED_LEGACY_CLOUD_AND_TELEMETRY_KEYS = [
  "PRISMUX_CLERK_PUBLISHABLE_KEY",
  "VITE_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "PRISMUX_CLERK_PASSKEY_RP_DOMAINS",
  "PRISMUX_CLERK_JWT_TEMPLATE",
  "VITE_CLERK_JWT_TEMPLATE",
  "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
  "PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID",
  "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
  "PRISMUX_RELAY_URL",
  "VITE_PRISMUX_RELAY_URL",
  "PRISMUX_MOBILE_OTLP_TRACES_URL",
  "PRISMUX_MOBILE_OTLP_TRACES_DATASET",
  "PRISMUX_MOBILE_OTLP_TRACES_TOKEN",
  "EXPO_PUBLIC_OTLP_TRACES_URL",
  "EXPO_PUBLIC_OTLP_TRACES_DATASET",
  "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
  "PRISMUX_RELAY_CLIENT_OTLP_TRACES_URL",
  "PRISMUX_RELAY_CLIENT_OTLP_TRACES_DATASET",
  "PRISMUX_RELAY_CLIENT_OTLP_TRACES_TOKEN",
  "VITE_RELAY_OTLP_TRACES_URL",
  "VITE_RELAY_OTLP_TRACES_DATASET",
  "VITE_RELAY_OTLP_TRACES_TOKEN",
] as const;

export function loadRepoEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
  readonly useOfficialDefaults?: boolean;
} = {}): Record<string, string | undefined> {
  const rootEnv = readEnvFile(NodePath.join(repoRoot, ".env"));
  const localEnv = readEnvFile(NodePath.join(repoRoot, ".env.local"));

  const merged: Record<string, string | undefined> = {
    ...rootEnv,
    ...localEnv,
    ...baseEnv,
  };

  // Hard-strip legacy cloud/Clerk/relay and Axiom/OTLP trace keys from every source
  // so builds never embed or propagate external cloud auth or telemetry endpoints.
  for (const blockedKey of STRIPPED_LEGACY_CLOUD_AND_TELEMETRY_KEYS) {
    delete merged[blockedKey];
  }

  return merged;
}

function readEnvFile(path: string): Record<string, string | undefined> {
  return NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
}
