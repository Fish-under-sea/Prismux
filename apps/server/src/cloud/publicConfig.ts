/**
 * Prismux operates strictly local-first with LAN / Tailscale QR remote pairing.
 * Third-party hosted cloud relay, Clerk OAuth, and OTLP relay tracing are permanently disabled.
 */

export function resolveRelayClientTracingConfig(): null {
  return null;
}

export const hasCloudPublicConfig = false as const;
