import {
  ProviderDriverKind,
  UsageLimitSourceError,
  type UsageLimitSourceAccount,
  type UsageLimitSourceConfig,
  type UsageLimitSourceKind,
} from "@prismux/core-contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";

export type RelayQuotaKind = UsageLimitSourceKind;

/** A relay source with its credential already resolved from secret storage. */
export interface RelayQuotaTarget {
  readonly kind: RelayQuotaKind;
  readonly url: UsageLimitSourceConfig["url"];
  readonly apiKey: string;
  readonly userId?: string | undefined;
}

export interface NormalizedRelayUrl {
  readonly origin: string;
  readonly baseUrl: string;
}

const NEW_API_QUOTA_PER_USD = 500_000;
const UNLIMITED_USD_THRESHOLD = 1e8;
const MAX_RELAY_MODELS = 200;
const DAY_MS = 86_400_000;
const USAGE_LOOKBACK_DAYS = 99;
const RELAY_DRIVER = ProviderDriverKind.make("openaiCompatible");

const UNTRUSTED_CERTIFICATE_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

const nodeErrorCode = (cause: unknown): string | undefined => {
  for (let error = cause, depth = 0; error instanceof Error && depth < 3; depth += 1) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code)) return code;
    error = error.cause;
  }
  return undefined;
};

const trimmedString = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const finiteNonNegative = (value: unknown): number | undefined => {
  const numeric = finiteNumber(value);
  return numeric !== undefined && numeric >= 0 ? numeric : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const formatUtcDate = (epochMillis: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(epochMillis)).slice(0, 10);

const roundUsedPercent = (used: number, total: number): number => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 1000) / 10));
};

/**
 * Normalizes a user-entered relay URL into a canonical origin + base path without
 * trailing `/`, `/v1`, `/api`, query parameters, fragments, or embedded credentials.
 */
export function normalizeRelayBaseUrl(rawUrl: string): NormalizedRelayUrl | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return null;
  if (parsed.username.length > 0 || parsed.password.length > 0) return null;

  let pathname = parsed.pathname.replace(/\/+$/, "");
  while (/(?:\/v1|\/api)$/i.test(pathname)) {
    pathname = pathname.replace(/(?:\/v1|\/api)$/i, "");
  }
  pathname = pathname.replace(/\/+$/, "");

  return {
    origin: parsed.origin,
    baseUrl: `${parsed.origin}${pathname}`,
  };
}

type JsonRequestFailure =
  | { readonly _tag: "Timeout" }
  | { readonly _tag: "StatusCode"; readonly status: number }
  | { readonly _tag: "Transport"; readonly code?: string | undefined }
  | { readonly _tag: "InvalidJson" };

const classifyRequestFailure = (error: unknown): JsonRequestFailure => {
  if (Cause.isTimeoutError(error)) return { _tag: "Timeout" };
  if (HttpClientError.isHttpClientError(error)) {
    const reason = error.reason;
    if (reason._tag === "StatusCodeError") {
      return { _tag: "StatusCode", status: reason.response.status };
    }
    if (reason._tag === "TransportError") {
      return { _tag: "Transport", code: nodeErrorCode(reason.cause) };
    }
    if (reason._tag === "DecodeError") {
      return { _tag: "InvalidJson" };
    }
  }
  return { _tag: "InvalidJson" };
};

// Never expose upstream response bodies or API keys in surfaced error details.
const describeRelayFailure = (failure: JsonRequestFailure, withBillingHint: boolean): string => {
  const hint = withBillingHint
    ? " Check the relay URL, API key permissions, or whether billing balance endpoints are enabled."
    : "";
  switch (failure._tag) {
    case "Timeout":
      return "The relay did not answer within 8 seconds.";
    case "StatusCode":
      return `The relay answered with HTTP ${failure.status}.${hint}`;
    case "Transport": {
      if (failure.code !== undefined && UNTRUSTED_CERTIFICATE_CODES.has(failure.code)) {
        return `The relay's TLS certificate is not trusted (${failure.code}). If it comes from a private CA, add that CA to NODE_EXTRA_CA_CERTS.`;
      }
      return failure.code !== undefined
        ? `The relay request failed (${failure.code}).`
        : "The relay request failed.";
    }
    case "InvalidJson":
      return `The relay returned an unreadable balance response.${hint}`;
  }
};

const isHardNetworkFailure = (failure: JsonRequestFailure): boolean =>
  failure._tag === "Timeout" || failure._tag === "Transport";

interface ParsedNewApiUserSelf {
  readonly id: string;
  readonly email?: string | undefined;
  readonly group?: string | undefined;
  readonly quota: number;
  readonly usedQuota: number;
}

function parseNewApiUserSelf(raw: unknown): ParsedNewApiUserSelf | null {
  if (!isRecord(raw) || raw.success !== true || !isRecord(raw.data)) return null;
  const data = raw.data;
  const quota = finiteNumber(data.quota);
  if (quota === undefined) return null;
  const usedQuota = finiteNumber(data.used_quota) ?? 0;
  const id = trimmedString(data.id) ?? trimmedString(data.username) ?? "relay-account";
  const email =
    trimmedString(data.email) ?? trimmedString(data.username) ?? trimmedString(data.display_name);
  const group = trimmedString(data.group);
  return {
    id,
    ...(email !== undefined ? { email } : {}),
    ...(group !== undefined ? { group } : {}),
    quota,
    usedQuota,
  };
}

interface ParsedOpenAiSubscription {
  readonly hardLimitUsd?: number | undefined;
  readonly accessUntilIso?: string | undefined;
  readonly planTitle?: string | undefined;
  readonly accountName?: string | undefined;
  readonly unlimitedQuota: boolean;
}

function parseOpenAiSubscription(raw: unknown): ParsedOpenAiSubscription | null {
  if (!isRecord(raw)) return null;
  const hasKnownField =
    "hard_limit_usd" in raw ||
    "system_hard_limit_usd" in raw ||
    "unlimited_quota" in raw ||
    "access_until" in raw ||
    "plan" in raw ||
    "has_payment_method" in raw;
  if (!hasKnownField) return null;

  const hardLimitUsd =
    finiteNonNegative(raw.hard_limit_usd) ?? finiteNonNegative(raw.system_hard_limit_usd);
  const unlimitedQuota = raw.unlimited_quota === true;
  const accessUntilRaw = finiteNumber(raw.access_until);
  let accessUntilIso: string | undefined;
  if (accessUntilRaw !== undefined && accessUntilRaw > 0) {
    const ms = accessUntilRaw > 1e12 ? accessUntilRaw : accessUntilRaw * 1000;
    accessUntilIso = DateTime.formatIso(DateTime.makeUnsafe(ms));
  }
  const planTitle = isRecord(raw.plan) ? trimmedString(raw.plan.title) : undefined;
  const accountName = trimmedString(raw.account_name);
  return {
    ...(hardLimitUsd !== undefined ? { hardLimitUsd } : {}),
    ...(accessUntilIso !== undefined ? { accessUntilIso } : {}),
    ...(planTitle !== undefined ? { planTitle } : {}),
    ...(accountName !== undefined ? { accountName } : {}),
    unlimitedQuota,
  };
}

function parseOpenAiUsage(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const totalUsageCents = finiteNumber(raw.total_usage);
  if (totalUsageCents === undefined) return null;
  return Math.max(0, totalUsageCents / 100);
}

function parseRelayModels(raw: unknown): ReadonlyArray<string> | undefined {
  if (!isRecord(raw)) return undefined;
  const list = Array.isArray(raw.data) ? raw.data : Array.isArray(raw.models) ? raw.models : null;
  if (!list) return undefined;
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of list) {
    const id = isRecord(item) ? trimmedString(item.id) : trimmedString(item);
    if (id && !seen.has(id)) {
      seen.add(id);
      models.push(id);
      if (models.length >= MAX_RELAY_MODELS) break;
    }
  }
  return models.length > 0 ? models : undefined;
}

export const makeRelayQuotaApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const getJson = Effect.fn("RelayQuotaApi.getJson")(function* (
    url: string,
    headers: Record<string, string>,
    timeout: "8 seconds" | "3 seconds" = "8 seconds",
  ): Effect.fn.Return<unknown, JsonRequestFailure> {
    let request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("Accept", "application/json"),
    );
    for (const [name, value] of Object.entries(headers)) {
      request = request.pipe(HttpClientRequest.setHeader(name, value));
    }
    return yield* client.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout(timeout),
      Effect.mapError(classifyRequestFailure),
    );
  });

  const probeModels = Effect.fn("RelayQuotaApi.probeModels")(function* (
    baseUrl: string,
    apiKey: string,
  ): Effect.fn.Return<ReadonlyArray<string> | undefined> {
    const raw = yield* getJson(
      `${baseUrl}/v1/models`,
      { Authorization: `Bearer ${apiKey}` },
      "3 seconds",
    ).pipe(
      Effect.timeoutOption("3 seconds"),
      Effect.orElseSucceed(() => Option.none<unknown>()),
    );
    return Option.isSome(raw) ? parseRelayModels(raw.value) : undefined;
  });

  const readNewApiUserSelf = Effect.fn("RelayQuotaApi.readNewApiUserSelf")(function* (
    baseUrl: string,
    target: RelayQuotaTarget,
    checkedAt: string,
  ): Effect.fn.Return<UsageLimitSourceAccount, JsonRequestFailure> {
    const userId = target.userId?.trim();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${target.apiKey}`,
      ...(userId ? { "New-Api-User": userId, "Rix-Api-User": userId } : {}),
    };
    const raw = yield* getJson(`${baseUrl}/api/user/self`, headers);
    const parsed = parseNewApiUserSelf(raw);
    if (!parsed) {
      return yield* Effect.fail<JsonRequestFailure>({ _tag: "InvalidJson" });
    }
    const remainingUsd = Math.max(0, parsed.quota / NEW_API_QUOTA_PER_USD);
    const usedUsd = Math.max(0, parsed.usedQuota / NEW_API_QUOTA_PER_USD);
    const totalUsd = remainingUsd + usedUsd;
    const usedPercent = roundUsedPercent(usedUsd, totalUsd);
    return {
      id: parsed.id,
      driver: RELAY_DRIVER,
      ...(parsed.email !== undefined ? { email: parsed.email } : {}),
      plan: parsed.group ? `New API · ${parsed.group}` : "New API",
      usageLimits: {
        checkedAt,
        windows: [
          {
            id: "relay-balance",
            kind: "monthly",
            label: `$${remainingUsd.toFixed(2)} left · $${usedUsd.toFixed(2)} / $${totalUsd.toFixed(2)}`,
            usedPercent,
          },
        ],
      },
    };
  });

  const readOpenAiBilling = Effect.fn("RelayQuotaApi.readOpenAiBilling")(function* (
    baseUrl: string,
    target: RelayQuotaTarget,
    checkedAt: string,
    nowMillis: number,
  ): Effect.fn.Return<UsageLimitSourceAccount, UsageLimitSourceError> {
    const startDate = formatUtcDate(nowMillis - USAGE_LOOKBACK_DAYS * DAY_MS);
    const endDate = formatUtcDate(nowMillis + DAY_MS);
    const authHeader = { Authorization: `Bearer ${target.apiKey}` };

    const [subscriptionResult, usageResult, models] = yield* Effect.all(
      [
        getJson(`${baseUrl}/v1/dashboard/billing/subscription`, authHeader).pipe(Effect.result),
        getJson(
          `${baseUrl}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
          authHeader,
        ).pipe(Effect.result),
        probeModels(baseUrl, target.apiKey),
      ],
      { concurrency: 3 },
    );

    const subscription =
      subscriptionResult._tag === "Success"
        ? parseOpenAiSubscription(subscriptionResult.success)
        : null;
    const usedUsdFromApi =
      usageResult._tag === "Success" ? parseOpenAiUsage(usageResult.success) : null;

    if (subscription === null && usedUsdFromApi === null) {
      const primaryFailure: JsonRequestFailure =
        subscriptionResult._tag === "Failure"
          ? subscriptionResult.failure
          : usageResult._tag === "Failure"
            ? usageResult.failure
            : { _tag: "InvalidJson" };
      return yield* new UsageLimitSourceError({
        detail: describeRelayFailure(primaryFailure, true),
      });
    }

    const usedUsd = usedUsdFromApi ?? 0;
    const hardLimitUsd = subscription?.hardLimitUsd;
    const isUnlimited =
      subscription?.unlimitedQuota === true ||
      (hardLimitUsd !== undefined && hardLimitUsd >= UNLIMITED_USD_THRESHOLD);

    let label: string;
    let usedPercent: number;
    if (isUnlimited) {
      label = `Unlimited · Used $${usedUsd.toFixed(2)}`;
      usedPercent = 0;
    } else if (hardLimitUsd !== undefined) {
      const remainingUsd = Math.max(0, hardLimitUsd - usedUsd);
      usedPercent = roundUsedPercent(usedUsd, hardLimitUsd);
      label = `$${remainingUsd.toFixed(2)} left · $${usedUsd.toFixed(2)} / $${hardLimitUsd.toFixed(2)}`;
    } else {
      label = `Used $${usedUsd.toFixed(2)}`;
      usedPercent = 0;
    }

    const plan =
      subscription?.planTitle ?? (target.kind === "newapi" ? "New API" : "OpenAI Compatible");
    return {
      id: subscription?.accountName ?? "relay-account",
      driver: RELAY_DRIVER,
      ...(subscription?.accountName !== undefined ? { email: subscription.accountName } : {}),
      plan,
      ...(models !== undefined ? { models } : {}),
      usageLimits: {
        checkedAt,
        windows: [
          {
            id: "relay-balance",
            kind: "monthly",
            label,
            usedPercent,
            ...(subscription?.accessUntilIso !== undefined
              ? { resetsAt: subscription.accessUntilIso }
              : {}),
          },
        ],
      },
    };
  });

  const readAccounts = Effect.fn("RelayQuotaApi.readAccounts")(function* (
    target: RelayQuotaTarget,
  ): Effect.fn.Return<ReadonlyArray<UsageLimitSourceAccount>, UsageLimitSourceError> {
    const normalized = normalizeRelayBaseUrl(target.url);
    if (!normalized) {
      return yield* new UsageLimitSourceError({
        detail:
          "The relay URL is not valid. Use an http:// or https:// address without embedded credentials.",
      });
    }
    const now = yield* DateTime.now;
    const checkedAt = DateTime.formatIso(now);
    const nowMillis = DateTime.toEpochMillis(now);

    if (target.kind === "newapi") {
      const hasUserId = Boolean(target.userId?.trim());
      const looksLikeApiKey = target.apiKey.trim().toLowerCase().startsWith("sk-");
      if (hasUserId || !looksLikeApiKey) {
        const selfResult = yield* readNewApiUserSelf(normalized.baseUrl, target, checkedAt).pipe(
          Effect.result,
        );
        if (selfResult._tag === "Success") {
          return [selfResult.success];
        }
        // Fail fast on unreachable/TLS/timeout transport failures rather than timing out twice.
        if (isHardNetworkFailure(selfResult.failure)) {
          return yield* new UsageLimitSourceError({
            detail: describeRelayFailure(selfResult.failure, false),
          });
        }
        // 401/403/404/405/non-JSON or non-self token: fall back to OpenAI-compatible billing.
      }
      const billingAccount = yield* readOpenAiBilling(
        normalized.baseUrl,
        target,
        checkedAt,
        nowMillis,
      );
      return [billingAccount];
    }

    const billingAccount = yield* readOpenAiBilling(
      normalized.baseUrl,
      target,
      checkedAt,
      nowMillis,
    );
    return [billingAccount];
  });

  return { readAccounts };
});
