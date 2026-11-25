// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_PRISMUX_PUBLIC_CONFIG, loadRepoEnv } from "./public-config.ts";

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
      "PRISMUX_CLERK_PUBLISHABLE_KEY=pk_root\nPRISMUX_CLERK_JWT_TEMPLATE=template_root\nPRISMUX_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nPRISMUX_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "PRISMUX_CLERK_PUBLISHABLE_KEY=pk_local\nPRISMUX_CLERK_JWT_TEMPLATE=template_local\nPRISMUX_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nPRISMUX_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).PRISMUX_RELAY_URL).toBe(
      "https://local.example.test",
    );
    expect(
      loadRepoEnv({
        baseEnv: {
          PRISMUX_CLERK_PUBLISHABLE_KEY: "pk_ci",
          PRISMUX_CLERK_JWT_TEMPLATE: "template_ci",
          PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
          PRISMUX_RELAY_URL: "https://ci.example.test",
        },
        repoRoot,
      }),
    ).toMatchObject({
      PRISMUX_CLERK_PUBLISHABLE_KEY: "pk_ci",
      PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      PRISMUX_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      PRISMUX_RELAY_URL: "https://ci.example.test",
      VITE_PRISMUX_RELAY_URL: "https://ci.example.test",
    });
  });

  it("leaves cloud/relay defaults empty when .env is absent and strips them under PRISMUX_DISABLE_CLOUD=1", () => {
    const repoRoot = makeTemporaryDirectory();
    expect(DEFAULT_PRISMUX_PUBLIC_CONFIG).toEqual({});

    const resolved = loadRepoEnv({ baseEnv: {}, repoRoot });
    expect(resolved.PRISMUX_RELAY_URL).toBeUndefined();
    expect(resolved.VITE_PRISMUX_RELAY_URL).toBeUndefined();
    expect(resolved.PRISMUX_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(resolved.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();

    const disabled = loadRepoEnv({
      baseEnv: {
        PRISMUX_DISABLE_CLOUD: "1",
        PRISMUX_RELAY_URL: "https://ci.example.test",
        PRISMUX_CLERK_PUBLISHABLE_KEY: "pk_ci",
      },
      repoRoot,
    });
    expect(disabled.PRISMUX_RELAY_URL).toBeUndefined();
    expect(disabled.VITE_PRISMUX_RELAY_URL).toBeUndefined();
    expect(disabled.PRISMUX_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(disabled.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
  });

  it("strips built-in upstream Axiom/OTLP relay and mobile trace env vars from all sources", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      [
        "PRISMUX_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "PRISMUX_RELAY_CLIENT_OTLP_TRACES_DATASET=relay-ds",
        "PRISMUX_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-root-token",
        "PRISMUX_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "PRISMUX_MOBILE_OTLP_TRACES_DATASET=mobile-ds",
        "PRISMUX_MOBILE_OTLP_TRACES_TOKEN=xaat-mobile-token",
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
      "PRISMUX_RELAY_CLIENT_OTLP_TRACES_URL",
      "PRISMUX_RELAY_CLIENT_OTLP_TRACES_DATASET",
      "PRISMUX_RELAY_CLIENT_OTLP_TRACES_TOKEN",
      "VITE_RELAY_OTLP_TRACES_URL",
      "VITE_RELAY_OTLP_TRACES_DATASET",
      "VITE_RELAY_OTLP_TRACES_TOKEN",
      "PRISMUX_MOBILE_OTLP_TRACES_URL",
      "PRISMUX_MOBILE_OTLP_TRACES_DATASET",
      "PRISMUX_MOBILE_OTLP_TRACES_TOKEN",
      "EXPO_PUBLIC_OTLP_TRACES_URL",
      "EXPO_PUBLIC_OTLP_TRACES_DATASET",
      "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
    ]) {
      expect(resolved[blockedKey]).toBeUndefined();
    }
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "prismux-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
