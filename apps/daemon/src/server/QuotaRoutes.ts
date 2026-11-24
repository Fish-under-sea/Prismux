import type { CallerScope } from "@prismux/protocol";
import type {
  OfficialQuotaService,
  OfficialQuotaSummaryResponse
} from "../system/OfficialQuotaService.js";
import { BusinessRouteError } from "./DaemonBusinessRoutes.js";

export interface QuotaRouteRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  callerScope: CallerScope;
}

export interface QuotaRouteResponse {
  statusCode: number;
  payload: OfficialQuotaSummaryResponse;
}

function isForceFlag(searchParams: URLSearchParams): boolean {
  const force = searchParams.get("force")?.trim().toLowerCase();
  const refresh = searchParams.get("refresh")?.trim().toLowerCase();
  return (
    force === "1" ||
    force === "true" ||
    refresh === "1" ||
    refresh === "true"
  );
}

/**
 * Matches `/v1/quota/summary` (GET, supports `?force=1`) and `/v1/quota/refresh` (POST).
 * Returns `null` when the request path does not belong to QuotaRoutes.
 */
export async function handleQuotaRoute(
  request: QuotaRouteRequest,
  quotaService: OfficialQuotaService | undefined
): Promise<QuotaRouteResponse | null> {
  const isSummaryGet =
    request.method === "GET" && request.pathname === "/v1/quota/summary";
  const isRefreshPost =
    request.method === "POST" && request.pathname === "/v1/quota/refresh";

  if (!isSummaryGet && !isRefreshPost) {
    return null;
  }

  if (request.callerScope !== "owner_chief") {
    throw new BusinessRouteError(
      403,
      "FORBIDDEN_SCOPE",
      `Scope "${request.callerScope}" is not permitted to access ${request.pathname}.`
    );
  }

  if (!quotaService) {
    throw new BusinessRouteError(
      503,
      "QUOTA_SERVICE_UNAVAILABLE",
      "OfficialQuotaService is not configured."
    );
  }

  const force = isRefreshPost || isForceFlag(request.searchParams);
  const summary = await quotaService.getQuotaSummary(force);
  return {
    statusCode: 200,
    payload: summary
  };
}
