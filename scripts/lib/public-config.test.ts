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
  it("applies process, root local, and root precedence for local dev env keys", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "PRISMUX_PORT=4001\nPRISMUX_CUSTOM_FLAG=root\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "PRISMUX_PORT=4002\nPRISMUX_CUSTOM_FLAG=local\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot })).toMatchObject({
      PRISMUX_PORT: "4002",
      PRISMUX_CUSTOM_FLAG: "local",
    });
    expect(
      loadRepoEnv({
        baseEnv: {
          PRISMUX_PORT: "4003",
        },
        repoRoot,
      }),
    ).toMatchObject({
      PRISMUX_PORT: "4003",
      PRISMUX_CUSTOM_FLAG: "local",
    });
  });

  it("unconditionally strips legacy Clerk OAuth, relay, and Axiom/OTLP env vars from all sources", () => {
    const repoRoot = makeTemporaryDirectory();
    expect(DEFAULT_PRISMUX_PUBLIC_CONFIG).toEqual({});

    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      [
        "PRISMUX_CLERK_PUBLISHABLE_KEY=pk_root",
        "PRISMUX_CLERK_PASSKEY_RP_DOMAINS=root.clerk.accounts.dev",
        "PRISMUX_CLERK_JWT_TEMPLATE=template_root",
        "PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root",
        "PRISMUX_RELAY_URL=https://root.example.test",
        "PRISMUX_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "PRISMUX_RELAY_CLIENT_OTLP_TRACES_DATASET=relay-ds",
        "PRISMUX_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-root-token",
        "PRISMUX_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "PRISMUX_MOBILE_OTLP_TRACES_DATASET=mobile-ds",
        "PRISMUX_MOBILE_OTLP_TRACES_TOKEN=xaat-mobile-token",
      ].join("\n"),
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "PRISMUX_CLERK_PUBLISHABLE_KEY=pk_local\nPRISMUX_RELAY_URL=https://local.example.test\n",
    );

    const resolved = loadRepoEnv({
      baseEnv: {
        PRISMUX_CLERK_PUBLISHABLE_KEY: "pk_ci",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
        PRISMUX_CLERK_PASSKEY_RP_DOMAINS: "ci.clerk.accounts.dev",
        PRISMUX_CLERK_JWT_TEMPLATE: "template_ci",
        VITE_CLERK_JWT_TEMPLATE: "template_ci",
        EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
        PRISMUX_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
        VITE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
        PRISMUX_RELAY_URL: "https://ci.example.test",
        VITE_PRISMUX_RELAY_URL: "https://ci.example.test",
        VITE_RELAY_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
        VITE_RELAY_OTLP_TRACES_DATASET: "vite-ds",
        VITE_RELAY_OTLP_TRACES_TOKEN: "xaat-vite-token",
        EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      },
      repoRoot,
    });

    for (const blockedKey of [
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
