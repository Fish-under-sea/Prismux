import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import {
  makeRelayQuotaApi,
  normalizeRelayBaseUrl,
  type RelayQuotaTarget,
} from "./relayQuotaApi.ts";

interface CapturedRequest {
  readonly url: string;
  readonly pathname: string;
  readonly search: string;
  readonly headers: Record<string, string | undefined>;
}

function fixture(
  handler: (request: CapturedRequest) => Response | HttpClientError.HttpClientError,
) {
  const requests: CapturedRequest[] = [];
  const http = HttpClient.make((request) => {
    const parsed = new URL(request.url);
    const captured: CapturedRequest = {
      url: request.url,
      pathname: parsed.pathname,
      search: parsed.search,
      headers: {
        authorization: request.headers.authorization,
        "new-api-user": request.headers["new-api-user"],
        "rix-api-user": request.headers["rix-api-user"],
      },
    };
    requests.push(captured);
    const result = handler(captured);
    if (result instanceof Response) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, result));
    }
    return Effect.fail(result);
  });
  return {
    requests,
    api: makeRelayQuotaApi.pipe(Effect.provideService(HttpClient.HttpClient, http)),
  };
}

describe("normalizeRelayBaseUrl", () => {
  it.each([
    ["https://api.example.com", "https://api.example.com"],
    ["https://api.example.com/", "https://api.example.com"],
    ["https://api.example.com/v1", "https://api.example.com"],
    ["https://api.example.com/v1/", "https://api.example.com"],
    ["https://api.example.com/api", "https://api.example.com"],
    ["https://api.example.com/api/", "https://api.example.com"],
    ["https://api.example.com/relay/v1/", "https://api.example.com/relay"],
    ["https://api.example.com/relay/api/v1?foo=bar#hash", "https://api.example.com/relay"],
    ["http://127.0.0.1:3000/api-proxy/", "http://127.0.0.1:3000/api-proxy"],
  ])("normalizes %s -> %s", (input, expected) => {
    expect(normalizeRelayBaseUrl(input)?.baseUrl).toBe(expected);
  });

  it.each([
    "",
    "not-a-url",
    "ftp://api.example.com",
    "file:///etc/passwd",
    "https://user:secret@api.example.com",
  ])("rejects invalid or credential-bearing URL %s", (input) => {
    expect(normalizeRelayBaseUrl(input)).toBeNull();
  });
});

describe("New API / One API quota protocol", () => {
  it.effect("reads /api/user/self with system access token and New-Api-User / Rix-Api-User headers", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-26T00:00:00.000Z"));
      const test = fixture((request) => {
        expect(request.pathname).toBe("/api/user/self");
        expect(request.headers.authorization).toBe("Bearer sys-token-123");
        expect(request.headers["new-api-user"]).toBe("42");
        expect(request.headers["rix-api-user"]).toBe("42");
        return Response.json({
          success: true,
          data: {
            id: 42,
            username: "fish",
            email: "fish@example.com",
            display_name: "Fish",
            quota: 6_250_000, // $12.50 remaining
            used_quota: 3_750_000, // $7.50 used => $20.00 total, 37.5% used
            group: "vip",
          },
        });
      });
      const api = yield* test.api;
      const target: RelayQuotaTarget = {
        kind: "newapi",
        url: "https://relay.example.com/v1/",
        apiKey: "sys-token-123",
        userId: "42",
      };
      const [account] = yield* api.readAccounts(target);
      expect(account).toEqual({
        id: "42",
        driver: "openaiCompatible",
        email: "fish@example.com",
        plan: "New API · vip",
        usageLimits: {
          checkedAt: "2026-11-26T00:00:00.000Z",
          windows: [
            {
              id: "relay-balance",
              kind: "monthly",
              label: "$12.50 left · $7.50 / $20.00",
              usedPercent: 37.5,
            },
          ],
        },
      });
      expect(test.requests).toHaveLength(1);
    }),
  );

  it.effect("routes sk-... API keys directly to OpenAI-compatible billing for newapi sources", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-26T00:00:00.000Z"));
      const test = fixture((request) => {
        if (request.pathname === "/v1/dashboard/billing/subscription") {
          return Response.json({
            hard_limit_usd: 50,
            access_until: 1798761600,
            plan: { title: "Pay-as-you-go" },
          });
        }
        if (request.pathname === "/v1/dashboard/billing/usage") {
          expect(request.search).toBe("?start_date=2026-08-19&end_date=2026-11-27");
          return Response.json({ total_usage: 1250 }); // $12.50
        }
        if (request.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "gpt-4.1" }, { id: "claude-sonnet-4-6" }] });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      });
      const api = yield* test.api;
      const [account] = yield* api.readAccounts({
        kind: "newapi",
        url: "https://relay.example.com/api/",
        apiKey: "sk-live-secret",
      });
      expect(test.requests.map((r) => r.pathname)).not.toContain("/api/user/self");
      expect(account).toMatchObject({
        id: "relay-account",
        driver: "openaiCompatible",
        plan: "Pay-as-you-go",
        models: ["gpt-4.1", "claude-sonnet-4-6"],
        usageLimits: {
          windows: [
            {
              id: "relay-balance",
              kind: "monthly",
              label: "$37.50 left · $12.50 / $50.00",
              usedPercent: 25,
              resetsAt: "2027-01-01T00:00:00.000Z",
            },
          ],
        },
      });
    }),
  );

  it.effect("falls back to OpenAI-compatible billing when /api/user/self returns 401/403/404 or non-JSON", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-26T00:00:00.000Z"));
      const test = fixture((request) => {
        if (request.pathname === "/api/user/self") {
          return new Response("<html>not json</html>", { status: 401 });
        }
        if (request.pathname === "/v1/dashboard/billing/subscription") {
          return Response.json({ system_hard_limit_usd: 20 });
        }
        if (request.pathname === "/v1/dashboard/billing/usage") {
          return Response.json({ total_usage: 500 });
        }
        return Response.json({}, { status: 404 });
      });
      const api = yield* test.api;
      const [account] = yield* api.readAccounts({
        kind: "newapi",
        url: "https://relay.example.com",
        apiKey: "custom-token-without-sk-prefix",
      });
      expect(test.requests.map((r) => r.pathname)).toContain("/api/user/self");
      expect(account?.usageLimits.windows[0]).toMatchObject({
        id: "relay-balance",
        label: "$15.00 left · $5.00 / $20.00",
        usedPercent: 25,
      });
    }),
  );
});

describe("OpenAI-compatible billing protocol", () => {
  it.effect("handles unlimited_quota and ignores /v1/models failures while capping models at 200", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-26T00:00:00.000Z"));
      const test = fixture((request) => {
        if (request.pathname === "/proxy/v1/dashboard/billing/subscription") {
          return Response.json({ unlimited_quota: true, hard_limit_usd: 0 });
        }
        if (request.pathname === "/proxy/v1/dashboard/billing/usage") {
          return Response.json({ total_usage: 428 }); // $4.28
        }
        if (request.pathname === "/proxy/v1/models") {
          return Response.json({
            data: Array.from({ length: 250 }, (_, index) => ({ id: `model-${index}` })),
          });
        }
        return Response.json({}, { status: 404 });
      });
      const api = yield* test.api;
      const [account] = yield* api.readAccounts({
        kind: "openaiBilling",
        url: "https://relay.example.com/proxy/v1",
        apiKey: "sk-unlimited-key",
      });
      expect(account?.plan).toBe("OpenAI Compatible");
      expect(account?.models).toHaveLength(200);
      expect(account?.usageLimits.windows[0]).toMatchObject({
        id: "relay-balance",
        label: "Unlimited · Used $4.28",
        usedPercent: 0,
      });
    }),
  );

  it.effect("ignores /v1/models errors without blocking balance results", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-26T00:00:00.000Z"));
      const test = fixture((request) => {
        if (request.pathname === "/v1/dashboard/billing/subscription") {
          return Response.json({ hard_limit_usd: 100 });
        }
        if (request.pathname === "/v1/dashboard/billing/usage") {
          return Response.json({ total_usage: 2500 });
        }
        return Response.json({ error: "forbidden" }, { status: 403 });
      });
      const api = yield* test.api;
      const [account] = yield* api.readAccounts({
        kind: "openaiBilling",
        url: "https://relay.example.com",
        apiKey: "sk-key",
      });
      expect(account?.models).toBeUndefined();
      expect(account?.usageLimits.windows[0]?.label).toBe("$75.00 left · $25.00 / $100.00");
    }),
  );

  it.effect("returns a readable credential-free error when both billing endpoints fail", () =>
    Effect.gen(function* () {
      const test = fixture(() =>
        Response.json({ error: "invalid key sk-super-secret-value" }, { status: 401 }),
      );
      const api = yield* test.api;
      const error = yield* Effect.flip(
        api.readAccounts({
          kind: "openaiBilling",
          url: "https://relay.example.com",
          apiKey: "sk-super-secret-value",
        }),
      );
      expect(error.detail).toContain("HTTP 401");
      expect(error.detail).not.toContain("sk-super-secret-value");
    }),
  );

  it.effect("reports untrusted TLS certificates clearly without retrying twice", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new TypeError("fetch failed", {
                cause: Object.assign(new Error("self signed"), {
                  code: "DEPTH_ZERO_SELF_SIGNED_CERT",
                }),
              }),
            }),
          }),
        ),
      );
      const api = yield* makeRelayQuotaApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const error = yield* Effect.flip(
        api.readAccounts({
          kind: "newapi",
          url: "https://internal-relay.local",
          apiKey: "sys-token",
          userId: "1",
        }),
      );
      expect(error.detail).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(error.detail).toContain("NODE_EXTRA_CA_CERTS");
    }),
  );
});
