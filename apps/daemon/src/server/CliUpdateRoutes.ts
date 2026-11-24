import type { CallerScope } from "@prismux/protocol";
import {
  CliUpdateError,
  type CliUpdateInstallResult,
  type CliUpdatesCheckResponse,
  type CliUpdateService
} from "../system/CliUpdateService.js";

export interface CliUpdateRouteResponse {
  statusCode: number;
  payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTruthyFlag(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export class CliUpdateRouteService {
  private readonly service: CliUpdateService;

  constructor(service: CliUpdateService) {
    this.service = service;
  }

  async handleCheck(
    searchParams: URLSearchParams
  ): Promise<CliUpdateRouteResponse> {
    const force = parseTruthyFlag(searchParams.get("force"));
    const provider = searchParams.get("provider")?.trim() || null;
    const response: CliUpdatesCheckResponse = await this.service.checkUpdates({
      force,
      provider
    });
    return {
      statusCode: 200,
      payload: response
    };
  }

  async handleInstall(
    rawBody: unknown,
    callerScope: CallerScope
  ): Promise<CliUpdateRouteResponse> {
    if (callerScope !== "owner_chief") {
      return {
        statusCode: 403,
        payload: {
          ok: false,
          error: {
            code: "forbidden",
            message: "仅主控端（owner_chief）允许执行 CLI 自动更新。"
          }
        }
      };
    }

    if (!isRecord(rawBody) || typeof rawBody.provider !== "string" || rawBody.provider.trim().length === 0) {
      return {
        statusCode: 400,
        payload: {
          ok: false,
          error: {
            code: "invalid_params",
            message: 'Request body must include a non-empty string "provider".'
          }
        }
      };
    }

    try {
      const result: CliUpdateInstallResult = await this.service.installUpdate(
        rawBody.provider.trim()
      );
      return {
        statusCode: 200,
        payload: result
      };
    } catch (error) {
      if (error instanceof CliUpdateError) {
        return {
          statusCode: error.statusCode,
          payload: {
            ok: false,
            error: {
              code: error.code,
              message: error.message
            }
          }
        };
      }
      return {
        statusCode: 500,
        payload: {
          ok: false,
          error: {
            code: "CLI_UPDATE_INTERNAL_ERROR",
            message: error instanceof Error ? error.message : String(error)
          }
        }
      };
    }
  }
}
