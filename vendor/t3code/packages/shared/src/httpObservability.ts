import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Headers from "effect/http/Headers";
import * as UrlParams from "effect/http/UrlParams";

export const layer = Layer.mergeAll(
  Layer.effect(
    Headers.CurrentRedactedNames,
    // Redact session secrets, authorization headers, cookies, API keys, and OTLP collector tokens.
    Effect.map(Headers.CurrentRedactedNames, (names) => [
      ...names,
      "dpop",
      "expo-session",
      "authorization",
      "proxy-authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
      "api-key",
      "x-axiom-dataset",
    ]),
  ),
  Layer.effect(
    UrlParams.CurrentRedactedNames,
    // Socket tickets and proofs, pairing tokens, API keys, and OAuth/tracking params in query strings.
    Effect.map(UrlParams.CurrentRedactedNames, (names) => [
      ...names,
      "wsTicket",
      "dpop",
      "token",
      "access_token",
      "refresh_token",
      "id_token",
      "api_key",
      "apiKey",
      "secret",
      "password",
      "pairingUrl",
      "code",
      "state",
      "challenge",
      "clientOwner",
      "clientDevice",
    ]),
  ),
);
