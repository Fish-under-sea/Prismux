import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectConfiguredDiagnosticsProviderIds,
  DIAGNOSTICS_BADGE_PASSIVE_COOLDOWN_MS,
  shouldForceRefreshForBadgeReason,
} from "./useLiveDiagnosticsBadgeTone";
import { createDiagnosticsRefreshController } from "./prismuxDiagnostics.logic";

describe("useLiveDiagnosticsBadgeTone polling discipline", () => {
  it("uses >= 5 min cooldown for passive visibility checks and never forces on focus/visibility/settings-left", () => {
    expect(DIAGNOSTICS_BADGE_PASSIVE_COOLDOWN_MS).toBeGreaterThanOrEqual(5 * 60_000);

    expect(shouldForceRefreshForBadgeReason("manual")).toBe(true);
    expect(shouldForceRefreshForBadgeReason("plugin-mutated")).toBe(true);
    expect(shouldForceRefreshForBadgeReason("focus")).toBe(false);
    expect(shouldForceRefreshForBadgeReason("visibility")).toBe(false);
    expect(shouldForceRefreshForBadgeReason("settings-left")).toBe(false);
    expect(shouldForceRefreshForBadgeReason("mount")).toBe(false);

    let now = 1_000_000;
    const calls: Array<{ reason: string; force: boolean }> = [];
    const controller = createDiagnosticsRefreshController(
      (reason) => {
        calls.push({ reason, force: shouldForceRefreshForBadgeReason(reason) });
      },
      { cooldownMs: DIAGNOSTICS_BADGE_PASSIVE_COOLDOWN_MS, now: () => now },
    );

    // Mount marks initial cached fetch timestamp
    controller.markRefreshed(now);

    // Visibility returns 30 seconds or 4 minutes later -> suppressed
    now += 30_000;
    expect(controller.trigger("visibility")).toBe(false);
    now += 4 * 60_000;
    expect(controller.trigger("visibility")).toBe(false);
    expect(calls).toHaveLength(0);

    // After >= 5 minutes -> triggers a single non-forced cached refresh
    now += 60_000;
    expect(controller.trigger("visibility")).toBe(true);
    expect(calls).toEqual([{ reason: "visibility", force: false }]);

    // Explicit manual / plugin-mutated bypasses cooldown and forces refresh
    now += 1_000;
    expect(controller.trigger("plugin-mutated", { bypassCooldown: true })).toBe(true);
    expect(calls).toEqual([
      { reason: "visibility", force: false },
      { reason: "plugin-mutated", force: true },
    ]);
  });

  it("collects only enabled configured provider IDs and resolves ACP local DSH without unadded providers", () => {
    const codexId = ProviderInstanceId.make("codex");
    const claudeDisabledId = ProviderInstanceId.make("claudeAgent");
    const dshLocalId = ProviderInstanceId.make("acp_local_dsh");

    const providers = [
      {
        instanceId: codexId,
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-11-26T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
      {
        instanceId: claudeDisabledId,
        driver: ProviderDriverKind.make("claudeAgent"),
        enabled: false,
        installed: false,
        version: null,
        status: "disabled",
        auth: { status: "unauthenticated" },
        checkedAt: "2026-11-26T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
      {
        instanceId: dshLocalId,
        driver: ProviderDriverKind.make("acpRegistry"),
        displayName: "我的本地助手",
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-11-26T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
    ] as unknown as ServerProvider[];

    const presentations = new Map([
      [
        "local",
        {
          serverConfig: {
            providers,
            settings: {
              providerInstances: {
                [dshLocalId]: {
                  driver: ProviderDriverKind.make("acpRegistry"),
                  enabled: true,
                  displayName: "我的本地助手",
                  config: { source: "local", commandPath: "C:\\Tools\\dsh.exe" },
                },
              },
            },
          },
        },
      ],
    ]);

    expect(collectConfiguredDiagnosticsProviderIds(presentations)).toEqual(["codex", "dsh"]);
  });
});
