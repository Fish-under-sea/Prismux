// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads optional root env files before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

export interface PrismuxPublicConfig {
  readonly clerkPublishableKey: string | undefined;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
  readonly relayUrl: string | undefined;
  readonly mobileOtlpTracesUrl: string | undefined;
  readonly mobileOtlpTracesDataset: string | undefined;
  readonly mobileOtlpTracesToken: string | undefined;
  readonly relayClientOtlpTracesUrl: string | undefined;
  readonly relayClientOtlpTracesDataset: string | undefined;
  readonly relayClientOtlpTracesToken: string | undefined;
}

type Environment = Readonly<Record<string, string | undefined>>;

const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");

/**
 * Prismux defaults to pure local-first execution with zero baked-in external cloud
 * or relay endpoints. Explicit overrides may still be supplied via `.env`, `.env.local`,
 * or process environment, and disabled explicitly with `PRISMUX_DISABLE_CLOUD=1`.
 */
export const DEFAULT_PRISMUX_PUBLIC_CONFIG: Readonly<Record<string, string>> = {};

export function loadRepoEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
  useOfficialDefaults,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
  readonly useOfficialDefaults?: boolean;
} = {}): Record<string, string | undefined> {
  const rootEnv = readEnvFile(NodePath.join(repoRoot, ".env"));
  const localEnv = readEnvFile(NodePath.join(repoRoot, ".env.local"));
  const cloudExplicitlyDisabled =
    firstNonEmpty([baseEnv, localEnv, rootEnv], "PRISMUX_DISABLE_CLOUD") === "1";
  const applyOfficialDefaults =
    useOfficialDefaults !== undefined
      ? useOfficialDefaults && !cloudExplicitlyDisabled
      : !cloudExplicitlyDisabled;
  const fallbackDefaults: Environment = applyOfficialDefaults ? DEFAULT_PRISMUX_PUBLIC_CONFIG : {};
  const config = cloudExplicitlyDisabled
    ? {
        clerkPublishableKey: undefined,
        clerkJwtTemplate: undefined,
        clerkCliOAuthClientId: undefined,
        relayUrl: undefined,
        mobileOtlpTracesUrl: undefined,
        mobileOtlpTracesDataset: undefined,
        mobileOtlpTracesToken: undefined,
        relayClientOtlpTracesUrl: undefined,
        relayClientOtlpTracesDataset: undefined,
        relayClientOtlpTracesToken: undefined,
      }
    : resolvePublicConfig(baseEnv, localEnv, rootEnv, fallbackDefaults);

  const merged: Record<string, string | undefined> = {
    ...rootEnv,
    ...localEnv,
    ...baseEnv,
    ...(config.clerkPublishableKey
      ? {
          PRISMUX_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          VITE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
        }
      : {}),
    ...(config.clerkJwtTemplate
      ? {
          PRISMUX_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          VITE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          EXPO_PUBLIC_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
        }
      : {}),
    ...(config.clerkCliOAuthClientId
      ? {
          PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
          VITE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
        }
      : {}),
    ...(config.relayUrl
      ? {
          PRISMUX_RELAY_URL: config.relayUrl,
          VITE_PRISMUX_RELAY_URL: config.relayUrl,
        }
      : {}),
  };

  if (cloudExplicitlyDisabled) {
    for (const cloudKey of [
      "PRISMUX_CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "PRISMUX_CLERK_JWT_TEMPLATE",
      "VITE_CLERK_JWT_TEMPLATE",
      "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
      "PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID",
      "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
      "PRISMUX_RELAY_URL",
      "VITE_PRISMUX_RELAY_URL",
    ]) {
      delete merged[cloudKey];
    }
  }

  // Prismux hard-strips built-in upstream Axiom/OTLP relay trace keys so builds
  // never embed or propagate third-party relay trace endpoints or bearer tokens.
  for (const blockedKey of [
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
  ]) {
    delete merged[blockedKey];
  }

  return merged;
}

function resolvePublicConfig(...sources: readonly Environment[]): PrismuxPublicConfig {
  return {
    clerkPublishableKey: firstNonEmpty(
      sources,
      "PRISMUX_CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ),
    clerkJwtTemplate: firstNonEmpty(
      sources,
      "PRISMUX_CLERK_JWT_TEMPLATE",
      "VITE_CLERK_JWT_TEMPLATE",
      "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
    ),
    clerkCliOAuthClientId: firstNonEmpty(
      sources,
      "PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID",
      "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
    ),
    relayUrl: firstNonEmpty(sources, "PRISMUX_RELAY_URL", "VITE_PRISMUX_RELAY_URL"),
    mobileOtlpTracesUrl: undefined,
    mobileOtlpTracesDataset: undefined,
    mobileOtlpTracesToken: undefined,
    relayClientOtlpTracesUrl: undefined,
    relayClientOtlpTracesDataset: undefined,
    relayClientOtlpTracesToken: undefined,
  };
}

function firstNonEmpty(sources: readonly Environment[], ...names: readonly string[]) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name]?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function readEnvFile(path: string): Record<string, string | undefined> {
  return NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
}
