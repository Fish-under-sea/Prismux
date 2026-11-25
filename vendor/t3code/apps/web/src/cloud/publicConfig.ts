import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";

export interface CloudPublicConfig {
  readonly relayUrl: string | null;
  readonly relayTracing: {
    readonly tracesUrl: string | null;
    readonly tracesDataset: string | null;
    readonly tracesToken: string | null;
  };
}

export function trimNonEmpty(value: string | undefined): string | null {
  return value?.trim() || null;
}

/**
 * Prismux runs in pure local-first / LAN / Tailscale QR pairing mode with zero third-party
 * hosted cloud account or telemetry dependencies.
 */
export function resolveCloudPublicConfig(): CloudPublicConfig {
  return {
    relayUrl: normalizeSecureRelayUrl(
      (import.meta.env.VITE_PRISMUX_RELAY_URL as string | undefined) ?? "",
    ),
    // Prismux hard-disables built-in upstream Axiom/OTLP relay trace export.
    relayTracing: {
      tracesUrl: null,
      tracesDataset: null,
      tracesToken: null,
    },
  };
}

/** Prismux hard-disables relay telemetry export in both browser and desktop builds. */
export function relayTelemetryEnabled(): boolean {
  return false;
}

export function resolveRelayTracingConfig(): null {
  return null;
}

/** Third-party hosted cloud auth is permanently disabled in Prismux. */
export function hasCloudPublicConfig(): boolean {
  return false;
}
