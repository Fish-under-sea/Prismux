// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG, loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_root\nT3CODE_CLERK_JWT_TEMPLATE=template_root\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nT3CODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_local\nT3CODE_CLERK_JWT_TEMPLATE=template_local\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nT3CODE_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).T3CODE_RELAY_URL).toBe(
      "https://local.example.test",
    );
    expect(
      loadRepoEnv({
        baseEnv: {
          T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
          T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
          T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
          T3CODE_RELAY_URL: "https://ci.example.test",
        },
        repoRoot,
      }),
    ).toMatchObject({
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      T3CODE_RELAY_URL: "https://ci.example.test",
      VITE_T3CODE_RELAY_URL: "https://ci.example.test",
    });
  });

  it("falls back to official public T3 Connect identifiers when .env is absent and respects T3CODE_DISABLE_CLOUD=1", () => {
    const repoRoot = makeTemporaryDirectory();
    const resolved = loadRepoEnv({ baseEnv: {}, repoRoot });
    expect(resolved).toMatchObject({
      T3CODE_CLERK_PUBLISHABLE_KEY:
        DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_CLERK_PUBLISHABLE_KEY,
      VITE_CLERK_PUBLISHABLE_KEY:
        DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_CLERK_PUBLISHABLE_KEY,
      T3CODE_CLERK_JWT_TEMPLATE:
        DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_CLERK_JWT_TEMPLATE,
      VITE_CLERK_JWT_TEMPLATE:
        DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_CLERK_JWT_TEMPLATE,
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID:
        DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID,
      VITE_CLERK_CLI_OAUTH_CLIENT_ID:
        DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID,
      T3CODE_RELAY_URL: DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_RELAY_URL,
      VITE_T3CODE_RELAY_URL: DEFAULT_OFFICIAL_T3_CONNECT_PUBLIC_CONFIG.T3CODE_RELAY_URL,
    });

    const disabled = loadRepoEnv({ baseEnv: { T3CODE_DISABLE_CLOUD: "1" }, repoRoot });
    expect(disabled.T3CODE_RELAY_URL).toBeUndefined();
    expect(disabled.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
  });

  it("strips built-in upstream Axiom/OTLP relay and mobile trace env vars from all sources", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      [
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET=relay-ds",
        "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-root-token",
        "T3CODE_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "T3CODE_MOBILE_OTLP_TRACES_DATASET=mobile-ds",
        "T3CODE_MOBILE_OTLP_TRACES_TOKEN=xaat-mobile-token",
      ].join("\n"),
    );

    const resolved = loadRepoEnv({
      baseEnv: {
        VITE_RELAY_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
        VITE_RELAY_OTLP_TRACES_DATASET: "vite-ds",
        VITE_RELAY_OTLP_TRACES_TOKEN: "xaat-vite-token",
        EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      },
      repoRoot,
    });

    for (const blockedKey of [
      "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL",
      "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
      "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
      "VITE_RELAY_OTLP_TRACES_URL",
      "VITE_RELAY_OTLP_TRACES_DATASET",
      "VITE_RELAY_OTLP_TRACES_TOKEN",
      "T3CODE_MOBILE_OTLP_TRACES_URL",
      "T3CODE_MOBILE_OTLP_TRACES_DATASET",
      "T3CODE_MOBILE_OTLP_TRACES_TOKEN",
      "EXPO_PUBLIC_OTLP_TRACES_URL",
      "EXPO_PUBLIC_OTLP_TRACES_DATASET",
      "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
    ]) {
      expect(resolved[blockedKey]).toBeUndefined();
    }
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
