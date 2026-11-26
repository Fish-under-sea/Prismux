import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  SecretProviderId,
  ServerConfigStreamEvent,
  UsageLimitSourceId,
  type ServerProviderUsageWindow,
  type UsageLimitSourceSnapshot,
} from "@prismux/core-contracts";
import * as SecretResolver from "@prismux/secret-provider-core/server/SecretResolver";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";

const encodeConfigEvent = Schema.encodeSync(ServerConfigStreamEvent);

it.effect("keeps malformed source URLs encodable for config subscribers", () =>
  Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    const snapshots = yield* sources.current;
    expect(snapshots.map((source) => source.label)).toEqual([
      "local-hub",
      "opaque-hub",
      "Named hub",
      "hub.test:8317",
      "Usage limit source",
    ]);
    // Only an http(s) hub URL names an endpoint an agent can be sent to.
    expect(snapshots.map((source) => source.origin)).toEqual([
      undefined,
      undefined,
      undefined,
      "https://hub.test:8317",
      undefined,
    ]);
    expect(snapshots[3]?.endpoint).toBe("https://hub.test:8317/team-a");
    expect(() =>
      encodeConfigEvent({
        version: 1,
        type: "usageLimitSourcesUpdated",
        payload: { sources: snapshots },
      }),
    ).not.toThrow();
    expect(snapshots.every((source) => source.error === "No API key configured.")).toBe(true);
  }).pipe(
    Effect.provide([
      Layer.succeed(SecretResolver.SecretResolver, {
        label: (provider) => Effect.succeed(provider),
        read: (references) => Effect.succeed(references.map(() => undefined)),
        invalidate: () => Effect.void,
      }),
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("local-hub")]: {
            kind: "newapi",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("opaque-hub")]: {
            kind: "newapi",
            url: "file:///tmp/hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("named-hub")]: {
            kind: "newapi",
            url: "localhost:8317",
            label: "Named hub",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make("valid-hub")]: {
            kind: "newapi",
            url: "https://hub.test:8317/team-a",
            managementKey: "",
            enabled: true,
          },
          [UsageLimitSourceId.make(" ")]: {
            kind: "newapi",
            url: "localhost:8317",
            managementKey: "",
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("Unexpected network request")),
      ),
      NodeCrypto.layer,
    ]),
  ),
);

it.effect("reads a management key from its secret provider", () => {
  const authorizations: Array<string | undefined> = [];
  const keySource = (reference: string) => ({
    provider: SecretProviderId.make("homelab"),
    reference,
  });
  return Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    const snapshots = yield* sources.streamChanges.pipe(
      Stream.filter((next) => next.length > 0),
      Stream.runHead,
      Effect.flatMap(Effect.fromOption),
    );
    expect(snapshots.map(({ id, error }) => ({ id, error }))).toEqual([
      { id: "resolved-hub", error: undefined },
      {
        id: "unresolved-hub",
        error: "Could not read the API key from its secret provider.",
      },
    ]);
    expect(authorizations).toEqual(["Bearer resolved-key"]);
  }).pipe(
    Effect.provide([
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("resolved-hub")]: {
            kind: "newapi",
            url: "https://resolved.test",
            managementKey: keySource("relay#key"),
            enabled: true,
          },
          [UsageLimitSourceId.make("unresolved-hub")]: {
            kind: "newapi",
            url: "https://unresolved.test",
            managementKey: keySource("missing#key"),
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(SecretResolver.SecretResolver, {
        label: (provider) => Effect.succeed(provider),
        read: (references) =>
          Effect.succeed(
            references.map((reference) =>
              reference.reference === "relay#key" ? "resolved-key" : undefined,
            ),
          ),
        invalidate: () => Effect.void,
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            authorizations.push(request.headers.authorization);
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                success: true,
                data: { id: 1, username: "alice", quota: 500_000, used_quota: 0 },
              }),
            );
          }),
        ),
      ),
      NodeCrypto.layer,
    ]),
  );
});

it.effect("keeps an account's last good reading when the relay's next read of it is refused", () => {
  let refused = true;
  let userId = "user-a";
  const readAccount = Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    return Effect.gen(function* () {
      yield* sources.refresh;
      const [source] = yield* sources.current;
      return source?.accounts[0]?.usageLimits;
    });
  });
  return Effect.gen(function* () {
    const read = yield* readAccount;
    expect(yield* read).toBeUndefined();
    refused = false;
    const good = yield* read;
    expect(good?.windows[0]?.usedPercent).toBeCloseTo(78, 1);
    expect(good?.unavailable).toBeUndefined();
    refused = true;
    const afterRefusal = yield* read;
    expect(afterRefusal?.windows[0]?.usedPercent).toBeCloseTo(78, 1);
    userId = "user-b";
    refused = false;
    const changed = yield* read;
    expect(changed?.windows[0]?.usedPercent).toBeCloseTo(78, 1);
  }).pipe(
    Effect.provide([
      ServerSettings.layerTest({
        usageLimitSources: {
          [UsageLimitSourceId.make("hub")]: {
            kind: "newapi",
            url: "http://hub.test:8317",
            managementKey: "management-secret",
            enabled: true,
          },
        },
      }),
      Layer.mock(BackgroundPolicy.BackgroundPolicy)({
        shouldRunScopeWork: () => Effect.succeed(false),
      }),
      Layer.succeed(SecretResolver.SecretResolver, {
        label: (provider) => Effect.succeed(provider),
        read: (references) => Effect.succeed(references.map(() => undefined)),
        invalidate: () => Effect.void,
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            if (refused) {
              return HttpClientResponse.fromWeb(request, Response.json({}, { status: 429 }));
            }
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                success: true,
                data: {
                  id: userId,
                  username: userId,
                  quota: 220_000,
                  used_quota: 780_000,
                },
              }),
            );
          }),
        ),
      ),
      NodeCrypto.layer,
    ]),
  );
});

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const at = (hours: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + hours * 3_600_000));
const spent = (id: string, hours: number): ServerProviderUsageWindow => ({
  id,
  kind: "weekly",
  label: id,
  usedPercent: 100,
  resetsAt: at(hours),
});
const hub = (
  accounts: ReadonlyArray<{
    driver?: string;
    models?: ReadonlyArray<string>;
    windows?: ReadonlyArray<ServerProviderUsageWindow>;
    unavailable?: true;
  }>,
): UsageLimitSourceSnapshot => ({
  id: UsageLimitSourceId.make("hub"),
  kind: "cliproxy",
  label: "hub",
  checkedAt: at(0),
  accounts: accounts.map((account, index) => ({
    id: `account-${index}`,
    driver: ProviderDriverKind.make(account.driver ?? "claudeAgent"),
    ...(account.models ? { models: account.models } : {}),
    usageLimits: {
      checkedAt: at(0),
      windows: account.windows ?? [],
      ...(account.unavailable ? { unavailable: { reason: "probeFailed" as const } } : {}),
    },
  })),
});

it.each([
  {
    name: "earliest refill when every account is spent, each at its latest spent window",
    accounts: [
      { windows: [spent("five_hour", 1), spent("seven_day", 3)] },
      { windows: [spent("five_hour", 2)] },
      { driver: "codex", windows: [] },
    ],
    model: "claude-haiku-5-5",
    expected: at(2),
  },
  {
    name: "unknown while an account still has room",
    accounts: [{ windows: [spent("five_hour", 1)] }, { windows: [] }],
    model: "claude-haiku-5-5",
    expected: null,
  },
  {
    name: "unknown while an account could not be read",
    accounts: [{ windows: [spent("five_hour", 1)] }, { unavailable: true as const }],
    model: "claude-haiku-5-5",
    expected: null,
  },
  {
    name: "unknown when a spent window has no reset or already reset",
    accounts: [{ windows: [{ ...spent("five_hour", 1), resetsAt: undefined }] }],
    model: "claude-haiku-5-5",
    expected: null,
  },
  {
    name: "a model-scoped weekly window blocks only its own model",
    accounts: [{ windows: [spent("seven_day_fable", 5)] }],
    model: "claude-haiku-5-5",
    expected: null,
  },
  {
    name: "a model-scoped weekly window blocks its own model",
    accounts: [{ windows: [spent("seven_day_fable", 5)] }],
    model: "claude-fable-5-2",
    expected: at(5),
  },
  {
    name: "no account of the driver",
    accounts: [{ driver: "codex", windows: [spent("five_hour", 1)] }],
    model: "claude-haiku-5-5",
    expected: null,
  },
  // regression: #30778 only the accounts the hub routes the model to can refill it
  {
    name: "an account of another driver the hub routes the model to counts",
    accounts: [
      { driver: "codex", models: ["gpt-5.6-sol"], windows: [spent("five_hour", 3)] },
      { models: ["claude-sonnet-4-6"], windows: [] },
    ],
    model: "gpt-5.6-sol",
    expected: at(3),
  },
  {
    name: "an account that lists no models is left out of an alias",
    accounts: [{ windows: [spent("five_hour", 1)] }, { models: [], windows: [] }],
    model: "opus",
    expected: at(1),
  },
  {
    name: "a spent Gemini quota does not hold back Claude on Antigravity",
    accounts: [
      {
        driver: "antigravity",
        models: ["claude-opus-4-6-thinking"],
        windows: [spent("3p-5h", 1), spent("gemini-5h", 24)],
      },
    ],
    model: "claude-opus-4-6-thinking",
    expected: at(1),
  },
  {
    name: "a hub thinking suffix routes by its base model",
    accounts: [
      { driver: "codex", models: ["gpt-5.2"], windows: [spent("five_hour", 3)] },
      { models: ["claude-sonnet-4-6"], windows: [] },
    ],
    model: "gpt-5.2(high)",
    expected: at(3),
  },
  {
    name: "a prefixed Gemini model is held back by the Gemini quota",
    accounts: [
      {
        driver: "antigravity",
        models: ["ag/gemini-3.1-pro-high"],
        windows: [spent("3p-5h", 1), spent("gemini-5h", 24)],
      },
    ],
    model: "ag/gemini-3.1-pro-high",
    expected: at(24),
  },
  {
    name: "an alias of unknown family is held back by every Antigravity quota",
    accounts: [{ driver: "antigravity", models: ["fast"], windows: [spent("gemini-5h", 24)] }],
    model: "fast",
    expected: at(24),
  },
  {
    name: "an own-driver account whose model list was unread still counts",
    accounts: [
      { windows: [spent("five_hour", 1)] },
      {
        driver: "antigravity",
        models: ["claude-sonnet-4-6"],
        windows: [spent("3p-5h", 8)],
      },
    ],
    model: "claude-sonnet-4-6",
    expected: at(1),
  },
  {
    name: "an Argon model waits only for the Argon quota",
    accounts: [
      {
        driver: "antigravity",
        models: ["gemini-4-argon-high"],
        windows: [spent("gemini-argon-5h", 2), spent("gemini-carbon-weekly", 96)],
      },
    ],
    model: "gemini-4-argon-high",
    expected: at(2),
  },
])("hub pool reset: $name", ({ accounts, model, expected }) => {
  expect(
    UsageLimitSources.hubPoolResetAt(
      [hub(accounts)],
      ProviderDriverKind.make("claudeAgent"),
      model,
      NOW,
    ),
  ).toBe(expected);
});

it.effect("the reset fallback refreshes its hub, and a stalled hub cannot hold the failure", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const roomLeft = { ...hub([{ windows: [spent("five_hour", 2)] }]), origin: "http://hub.test" };
    const cached = {
      ...roomLeft,
      accounts: roomLeft.accounts.map((account) => ({
        ...account,
        usageLimits: {
          ...account.usageLimits,
          windows: account.usageLimits.windows.map((window) => ({ ...window, usedPercent: 99 })),
        },
      })),
    };
    let current: ReadonlyArray<UsageLimitSourceSnapshot> = [cached];
    let refresh: Effect.Effect<void> = Effect.sync(() => {
      current = [roomLeft];
    });
    const lookup = UsageLimitSources.UsageLimitResetFallback.pipe(
      Effect.flatMap((fallback) =>
        fallback.resetAt(ProviderDriverKind.make("claudeAgent"), "http://hub.test", null),
      ),
      Effect.provide(
        UsageLimitSources.layerResetFallback.pipe(
          Layer.provide(
            Layer.mock(UsageLimitSources.UsageLimitSources)({
              current: Effect.sync(() => current),
              refresh: Effect.suspend(() => refresh),
            }),
          ),
        ),
      ),
    );
    // The last poll saw room; the account was spent after it.
    expect(yield* lookup).toBe(at(2));
    current = [cached];
    refresh = Effect.never;
    const stalled = yield* Effect.forkChild(lookup);
    yield* TestClock.adjust("5 seconds");
    expect(yield* Fiber.join(stalled)).toBeNull();
  }),
);

it.effect(
  "dispatches newapi and openaiBilling sources via relayQuotaApi and rejects reset credit consumption",
  () => {
    const seenHeaders: Array<{ readonly path: string; readonly user?: string | undefined }> = [];
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.make;
      yield* sources.refresh;
      const snapshots = yield* sources.current;

      expect(snapshots).toHaveLength(2);
      expect(() =>
        encodeConfigEvent({
          version: 1,
          type: "usageLimitSourcesUpdated",
          payload: { sources: snapshots },
        }),
      ).not.toThrow();

      const newApiSnapshot = snapshots.find((item) => item.id === "my-newapi");
      const billingSnapshot = snapshots.find((item) => item.id === "my-billing");

      expect(newApiSnapshot).toMatchObject({
        kind: "newapi",
        label: "Primary New API",
        origin: "https://newapi.example.com",
        endpoint: "https://newapi.example.com",
      });
      expect(newApiSnapshot?.error).toBeUndefined();
      expect(newApiSnapshot?.accounts[0]).toMatchObject({
        id: "7",
        driver: "openaiCompatible",
        email: "owner@example.com",
        plan: "New API · default",
        usageLimits: {
          windows: [
            {
              id: "relay-balance",
              kind: "monthly",
              label: "$10.00 left · $5.00 / $15.00",
              usedPercent: 33.3,
            },
          ],
        },
      });
      expect(seenHeaders).toContainEqual({ path: "/api/user/self", user: "7" });

      expect(billingSnapshot).toMatchObject({
        kind: "openaiBilling",
        label: "OpenAI Relay",
        origin: "https://relay.example.com",
        endpoint: "https://relay.example.com",
      });
      expect(billingSnapshot?.error).toBeUndefined();
      expect(billingSnapshot?.accounts[0]?.usageLimits.windows[0]).toMatchObject({
        id: "relay-balance",
        label: "$80.00 left · $20.00 / $100.00",
        usedPercent: 20,
      });

      const consumeError = yield* Effect.flip(
        sources.consumeResetCredit({
          sourceId: UsageLimitSourceId.make("my-newapi"),
          accountId: "7",
          creditId: "credit-1",
        }),
      );
      expect(consumeError.detail).toContain("relay quota usage sources");
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({
          usageLimitSources: {
            [UsageLimitSourceId.make("my-newapi")]: {
              kind: "newapi",
              label: "Primary New API",
              url: "https://newapi.example.com/v1",
              managementKey: "sys-access-token",
              userId: "7",
              enabled: true,
            },
            [UsageLimitSourceId.make("my-billing")]: {
              kind: "openaiBilling",
              label: "OpenAI Relay",
              url: "https://relay.example.com/v1/",
              managementKey: "sk-relay-key",
              enabled: true,
            },
          },
        }),
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          shouldRunScopeWork: () => Effect.succeed(false),
        }),
        Layer.succeed(SecretResolver.SecretResolver, {
          label: (provider) => Effect.succeed(provider),
          read: (references) => Effect.succeed(references.map(() => undefined)),
          invalidate: () => Effect.void,
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              const parsed = new URL(request.url);
              seenHeaders.push({ path: parsed.pathname, user: request.headers["new-api-user"] });
              if (parsed.pathname === "/api/user/self") {
                return HttpClientResponse.fromWeb(
                  request,
                  Response.json({
                    success: true,
                    data: {
                      id: 7,
                      username: "owner",
                      email: "owner@example.com",
                      quota: 5_000_000,
                      used_quota: 2_500_000,
                      group: "default",
                    },
                  }),
                );
              }
              if (parsed.pathname === "/v1/dashboard/billing/subscription") {
                return HttpClientResponse.fromWeb(request, Response.json({ hard_limit_usd: 100 }));
              }
              if (parsed.pathname === "/v1/dashboard/billing/usage") {
                return HttpClientResponse.fromWeb(request, Response.json({ total_usage: 2000 }));
              }
              return HttpClientResponse.fromWeb(request, Response.json({}, { status: 404 }));
            }),
          ),
        ),
        NodeCrypto.layer,
      ]),
    );
  },
);

it.effect(
  "refreshes sources in parallel (max not sum), deduplicates concurrent refreshes (singleflight), and bounds stalled sources by timeout",
  () => {
    let fastCalls = 0;
    let slowCalls = 0;
    let stallSlow = false;
    let fastQuota = 5_000_000;
    return Effect.gen(function* () {
      const fastStarted = yield* Deferred.make<void>();
      const slowStarted = yield* Deferred.make<void>();
      const releaseSlow = yield* Deferred.make<void>();

      const sources = yield* UsageLimitSources.make.pipe(
        Effect.provide([
          ServerSettings.layerTest({
            usageLimitSources: {
              [UsageLimitSourceId.make("fast-relay")]: {
                kind: "newapi",
                label: "Fast Relay",
                url: "https://fast.example.com/v1",
                managementKey: "fast-token",
                userId: "1",
                enabled: true,
              },
              [UsageLimitSourceId.make("slow-relay")]: {
                kind: "newapi",
                label: "Slow Relay",
                url: "https://slow.example.com/v1",
                managementKey: "slow-token",
                userId: "2",
                enabled: true,
              },
            },
          }),
          Layer.mock(BackgroundPolicy.BackgroundPolicy)({
            shouldRunScopeWork: () => Effect.succeed(false),
          }),
          Layer.succeed(SecretResolver.SecretResolver, {
            label: (provider) => Effect.succeed(provider),
            read: (references) => Effect.succeed(references.map(() => undefined)),
            invalidate: () => Effect.void,
          }),
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              const host = new URL(request.url).hostname;
              if (host === "fast.example.com") {
                fastCalls += 1;
                return Deferred.succeed(fastStarted, undefined).pipe(
                  Effect.ignore,
                  Effect.andThen(Effect.sleep("500 millis")),
                  Effect.as(
                    HttpClientResponse.fromWeb(
                      request,
                      Response.json({
                        success: true,
                        data: {
                          id: 1,
                          username: "fast",
                          quota: fastQuota,
                          used_quota: 500_000,
                        },
                      }),
                    ),
                  ),
                );
              }
              slowCalls += 1;
              return Deferred.succeed(slowStarted, undefined).pipe(
                Effect.ignore,
                Effect.andThen(
                  stallSlow
                    ? Effect.never
                    : Deferred.await(releaseSlow).pipe(Effect.andThen(Effect.sleep("2 seconds"))),
                ),
                Effect.as(
                  HttpClientResponse.fromWeb(
                    request,
                    Response.json({
                      success: true,
                      data: {
                        id: 2,
                        username: "slow",
                        quota: 1_000_000,
                        used_quota: 500_000,
                      },
                    }),
                  ),
                ),
              );
            }),
          ),
          NodeCrypto.layer,
        ]),
      );

      // 1. Both sources start concurrently (parallel, not sequential) and 3 concurrent refresh callers share ONE singleflight pass.
      yield* Deferred.await(fastStarted);
      yield* Deferred.await(slowStarted);
      const concurrent1 = yield* Effect.forkChild(sources.refresh);
      const concurrent2 = yield* Effect.forkChild(sources.refresh);
      yield* Effect.yieldNow;
      expect(fastCalls).toBe(1);
      expect(slowCalls).toBe(1);

      // Advance virtual clock by max(500ms, 2s) = 2s (NOT sum = 2.5s!) after releasing slow gate.
      yield* Deferred.succeed(releaseSlow, undefined);
      yield* TestClock.adjust("2 seconds");
      yield* Fiber.join(concurrent1);
      yield* Fiber.join(concurrent2);
      expect(fastCalls).toBe(1);
      expect(slowCalls).toBe(1);

      // 2. SWR progressive publish + bounded per-source timeout: when slow-relay stalls, fast-relay updates immediately at 500ms
      //    and slow-relay times out cleanly at DEFAULT_USAGE_LIMIT_SOURCE_TIMEOUT_MS (8s).
      stallSlow = true;
      fastQuota = 2_500_000; // $5.00 left vs $1.00 used
      const stalledRefresh = yield* Effect.forkChild(sources.refresh);
      yield* TestClock.adjust("500 millis");
      yield* Effect.yieldNow;
      const midSnapshots = yield* sources.current;
      const midFast = midSnapshots.find((s) => s.id === "fast-relay");
      expect(midFast?.accounts[0]?.usageLimits.windows[0]?.label).toContain("$5.00 left");

      yield* TestClock.adjust(`${UsageLimitSources.DEFAULT_USAGE_LIMIT_SOURCE_TIMEOUT_MS} millis`);
      yield* Fiber.join(stalledRefresh);
      const finalSnapshots = yield* sources.current;
      const timedOutSlow = finalSnapshots.find((s) => s.id === "slow-relay");
      expect(timedOutSlow?.error).toContain("8 seconds");
    });
  },
);
