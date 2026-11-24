import {
  clerkFrontendApiHostnameFromPublishableKey,
  relayClerkTokenOptions,
} from "@t3tools/shared/relayAuth";
import { normalizeSecureRelayUrl } from "@t3tools/shared/relayUrl";
import * as Schema from "effect/Schema";

export class CloudPublicConfigMissingError extends Schema.TaggedError<CloudPublicConfigMissingError>()(
  "CloudPublicConfigMissingError",
  {
    key: Schema.Literal("T3CODE_CLERK_JWT_TEMPLATE"),
  },
) {
  override get message(): string {
    return `${this.key} is not configured.`;
  }
}

export interface CloudPublicConfig {
  readonly clerkPublishableKey: string | null;
  readonly clerkJwtTemplate: string | null;
  readonly relayUrl: string | null;
  readonly relayTracing: {
    readonly tracesUrl: string | null;
    readonly tracesDataset: string | null;
    readonly tracesToken: string | null;
  };
}

export const T3_CONNECT_OPT_IN_STORAGE_KEY = "prismux:t3-connect-opt-in";

export function trimNonEmpty(value: string | undefined): string | null {
  return value?.trim() || null;
}

/**
 * In the Electron desktop app, T3 Connect (Clerk + relay.t3.codes) is strictly
 * opt-in OFF by default so cold startup never makes silent outbound requests.
 */
export function isT3ConnectOptedIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem(T3_CONNECT_OPT_IN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setT3ConnectOptIn(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage?.setItem(T3_CONNECT_OPT_IN_STORAGE_KEY, "1");
    } else {
      window.localStorage?.removeItem(T3_CONNECT_OPT_IN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors in restricted environments.
  }
}

export function resolveCloudPublicConfig(): CloudPublicConfig {
  return {
    clerkPublishableKey: trimNonEmpty(
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined,
    ),
    clerkJwtTemplate: trimNonEmpty(import.meta.env.VITE_CLERK_JWT_TEMPLATE as string | undefined),
    relayUrl: normalizeSecureRelayUrl(
      (import.meta.env.VITE_T3CODE_RELAY_URL as string | undefined) ?? "",
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

export function hasCloudPublicConfig(): boolean {
  const config = resolveCloudPublicConfig();
  if (!config.clerkPublishableKey || !config.clerkJwtTemplate || !config.relayUrl) {
    return false;
  }

  // Electron requires explicit user opt-in before mounting Clerk so desktop startup
  // never phones home to clerk.t3.codes or relay.t3.codes without user action.
  if (typeof window !== "undefined" && window.desktopBridge !== undefined) {
    return isT3ConnectOptedIn();
  }

  // Development keys also support private browser origins.
  if (typeof window === "undefined" || !config.clerkPublishableKey.startsWith("pk_live_")) {
    return true;
  }

  try {
    // Custom Frontend API hosts use clerk.<production domain>.
    const domain = clerkFrontendApiHostnameFromPublishableKey(config.clerkPublishableKey).replace(
      /^clerk\./u,
      "",
    );
    const { hostname, protocol, port } = window.location;
    return (
      protocol === "https:" &&
      port === "" &&
      (hostname === domain || hostname.endsWith(`.${domain}`))
    );
  } catch {
    return false;
  }
}

export function resolveRelayClerkTokenOptions() {
  const { clerkJwtTemplate } = resolveCloudPublicConfig();
  if (!clerkJwtTemplate) {
    throw new CloudPublicConfigMissingError({ key: "T3CODE_CLERK_JWT_TEMPLATE" });
  }
  return relayClerkTokenOptions(clerkJwtTemplate);
}
