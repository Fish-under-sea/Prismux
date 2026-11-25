import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  hasCloudPublicConfig,
  relayTelemetryEnabled,
  resolveCloudPublicConfig,
  resolveRelayTracingConfig,
} from "./publicConfig";

describe("Prismux cloudless publicConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps third-party cloud auth and relay telemetry disabled by default", () => {
    expect(hasCloudPublicConfig()).toBe(false);
    expect(relayTelemetryEnabled()).toBe(false);
    expect(resolveRelayTracingConfig()).toBeNull();
    expect(resolveCloudPublicConfig().relayTracing).toEqual({
      tracesUrl: null,
      tracesDataset: null,
      tracesToken: null,
    });
  });

  it("reads optional self-hosted VITE_PRISMUX_RELAY_URL while keeping hosted cloud auth disabled", () => {
    vi.stubEnv("VITE_PRISMUX_RELAY_URL", "https://relay.example.test");
    expect(resolveCloudPublicConfig().relayUrl).toBe("https://relay.example.test");
    expect(hasCloudPublicConfig()).toBe(false);
  });
});
