import type { CallerScope } from "@prismux/protocol";
import type {
  OfficialQuotaCreditsResponse,
  OfficialQuotaService,
  OfficialQuotaSummaryResponse,
} from "../system/OfficialQuotaService.js";
import { BusinessRouteError } from "./DaemonBusinessRoutes.js";

export interface QuotaRouteRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  callerScope: CallerScope;
}

export interface QuotaInvalidateResponse {
  ok: true;
  cleared: true;
  cacheGeneration: number;
}

export interface QuotaRouteResponse {
  statusCode: number;
  payload: OfficialQuotaSummaryResponse | OfficialQuotaCreditsResponse | QuotaInvalidateResponse;
}

function isForceFlag(searchParams: URLSearchParams): boolean {
  const force = searchParams.get("force")?.trim().toLowerCase();
  const refresh = searchParams.get("refresh")?.trim().toLowerCase();
  return force === "1" || force === "true" || refresh === "1" || refresh === "true";
}

function isExplicitlyDisabledFlag(searchParams: URLSearchParams): boolean {
  const disabled = searchParams.get("disabled")?.trim().toLowerCase();
  const enabled = searchParams.get("enabled")?.trim().toLowerCase();
  return disabled === "1" || disabled === "true" || enabled === "0" || enabled === "false";
}

function isSwrFlag(searchParams: URLSearchParams): boolean {
  const swr = searchParams.get("swr")?.trim().toLowerCase();
  return swr === "1" || swr === "true";
}

/**
 * Matches:
 * - `GET /v1/quota/summary` (supports `?force=1`; runs ONLY `agy -p "/usage"`)
 * - `POST /v1/quota/refresh` (forced summary refresh; runs ONLY `agy -p "/usage"`)
 * - `GET /v1/quota/credits` (on-demand popover credits; supports `?force=1`; runs ONLY `agy -p "/credits"`)
 * - `POST /v1/quota/invalidate` (immediately clears both `/usage` and `/credits` caches)
 *
 * Returns `null` when the request path does not belong to QuotaRoutes.
 */
export async function handleQuotaRoute(
  request: QuotaRouteRequest,
  quotaService: OfficialQuotaService | undefined,
): Promise<QuotaRouteResponse | null> {
  const isSummaryGet = request.method === "GET" && request.pathname === "/v1/quota/summary";
  const isRefreshPost = request.method === "POST" && request.pathname === "/v1/quota/refresh";
  const isCreditsGet = request.method === "GET" && request.pathname === "/v1/quota/credits";
  const isInvalidatePost = request.method === "POST" && request.pathname === "/v1/quota/invalidate";

  if (!isSummaryGet && !isRefreshPost && !isCreditsGet && !isInvalidatePost) {
    return null;
  }

  if (request.callerScope !== "owner_chief") {
    throw new BusinessRouteError(
      403,
      "FORBIDDEN_SCOPE",
      `Scope "${request.callerScope}" is not permitted to access ${request.pathname}.`,
    );
  }

  if (!quotaService) {
    throw new BusinessRouteError(
      503,
      "QUOTA_SERVICE_UNAVAILABLE",
      "OfficialQuotaService is not configured.",
    );
  }

  if (isInvalidatePost) {
    quotaService.clearCache();
    return {
      statusCode: 200,
      payload: {
        ok: true,
        cleared: true,
        cacheGeneration: quotaService.getCacheGeneration(),
      },
    };
  }

  const explicitlyDisabled = isExplicitlyDisabledFlag(request.searchParams);
  const allowStale = isSwrFlag(request.searchParams);

  if (isCreditsGet) {
    if (explicitlyDisabled) {
      return {
        statusCode: 200,
        payload: quotaService.buildDisabledCreditsResponse(),
      };
    }
    const force = isForceFlag(request.searchParams);
    const credits = await quotaService.getCredits(force, { allowStale });
    return {
      statusCode: 200,
      payload: credits,
    };
  }

  if (explicitlyDisabled) {
    return {
      statusCode: 200,
      payload: quotaService.buildDisabledSummaryResponse(),
    };
  }

  const force = isRefreshPost || isForceFlag(request.searchParams);
  const summary = await quotaService.getSummary(force, { allowStale });
  return {
    statusCode: 200,
    payload: summary,
  };
}
