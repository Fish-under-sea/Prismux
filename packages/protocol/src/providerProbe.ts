export const PROVIDER_AUTH_MODES = [
  "api_or_custom",
  "subscription_oauth",
  "local",
  "unauthenticated"
] as const;

export type ProviderAuthMode = (typeof PROVIDER_AUTH_MODES)[number];

export const PROVIDER_AUTH_SOURCES = [
  "env",
  "cli_config",
  "custom_endpoint",
  "ccs_or_magpie",
  "official_oauth",
  "cloud_iam",
  "local_runtime",
  "none"
] as const;

export type ProviderAuthSource = (typeof PROVIDER_AUTH_SOURCES)[number];

export const PROVIDER_PROBE_STATUSES = [
  "ready",
  "degraded",
  "not_installed",
  "unauthenticated"
] as const;

export type ProviderProbeStatus = (typeof PROVIDER_PROBE_STATUSES)[number];

export interface PrismuxProviderProbeSnapshot {
  providerId: string;
  displayName: string;
  installed: boolean;
  version: string | null;
  binaryPath: string | null;
  status: ProviderProbeStatus;
  authMode: ProviderAuthMode;
  authSource: ProviderAuthSource;
  endpoint: string | null;
  authLabel: string;
  checkedAt: string;
  error?: string | null;
  latencyMs?: number;
}

export interface PrismuxProviderProbeResponse {
  ok: true;
  generatedAt: string;
  providers: PrismuxProviderProbeSnapshot[];
}

export function isProviderAuthMode(value: unknown): value is ProviderAuthMode {
  return (
    typeof value === "string" &&
    (PROVIDER_AUTH_MODES as readonly string[]).includes(value)
  );
}

export function isProviderAuthSource(
  value: unknown
): value is ProviderAuthSource {
  return (
    typeof value === "string" &&
    (PROVIDER_AUTH_SOURCES as readonly string[]).includes(value)
  );
}

export function isProviderProbeStatus(
  value: unknown
): value is ProviderProbeStatus {
  return (
    typeof value === "string" &&
    (PROVIDER_PROBE_STATUSES as readonly string[]).includes(value)
  );
}
