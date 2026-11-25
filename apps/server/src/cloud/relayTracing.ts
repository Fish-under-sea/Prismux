import { nodeProcessRuntimeAttributes } from "@prismux/core-shared/observability";
import * as RelayTracing from "@prismux/core-shared/relayTracing";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveRelayClientTracingConfig } from "./publicConfig.ts";

const relayClientTracingConfig = resolveRelayClientTracingConfig();

/** Prismux hard-disables relay OTLP tracing to upstream Prismux Connect collectors. */
export const relayLayer = (
  _resource: Omit<RelayTracing.RelayClientTracingResource, "serviceInstanceId">,
  _tracingConfig: RelayTracing.RelayClientTracingConfig | null = relayClientTracingConfig,
) => Layer.succeed(RelayTracing.RelayClientTracer, Option.none());

export const layerHeadlessRelayClient = relayLayer({
  serviceName: "prismux-server",
  runtime: "node",
  attributes: nodeProcessRuntimeAttributes(),
  client: "headless-cli",
});

export const layerServerRelayBroker = relayLayer({
  serviceName: "prismux-server",
  runtime: "node",
  attributes: nodeProcessRuntimeAttributes(),
  client: "environment-server",
  component: "relay-broker",
});
