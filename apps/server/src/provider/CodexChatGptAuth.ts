// @effect-diagnostics nodeBuiltinImport:off - OAuth loopback listener uses Node APIs.
import * as NodeHttp from "node:http";
import {
  ProviderSetupError,
  type ChatGptReconnectProfile,
  type ChatGptTransferredProfile,
  type ProviderInstanceId,
} from "@prismux/core-contracts";
import { codexCallbackUrl } from "@prismux/core-shared/codexAuthHandoff";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as JoseError from "effect/jose/JoseError";
import * as Jwks from "effect/jose/Jwks";
import * as Jwt from "effect/jose/Jwt";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Hex from "effect/encoding/Hex";
import * as Exit from "effect/Exit";
import { codexAuthCallbackPage, codexAuthReturnUrl } from "./CodexAuthCallbackPage.ts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ProviderAuthFlow from "@prismux/provider-core/server/providerAuthFlow";
import type { ProviderAuthFlowContext } from "@prismux/provider-core/server/providerAuthFlow";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import type { HttpClientResponse } from "effect/http";
import * as ProviderCredentialStore from "./ProviderCredentialStore.ts";
import { withChatGptSessionLock } from "./CodexChatGptSessionLock.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

const isSetupError = Schema.is(ProviderSetupError);
const RESOURCE = "https://api.openai.com/v1";
const REQUIRED_SCOPE = "chatgpt.tokens.use.direct";
const DEFAULT_OPENAI_ISSUER = "https://auth.openai.com";
const DISCOVERY = `${DEFAULT_OPENAI_ISSUER}/.well-known/openid-configuration`;
const OIDC_USER_AGENT = "Prismux";
const DISCOVERY_TIMEOUT = "10 seconds";
const TOKEN_EXCHANGE_TIMEOUT = "15 seconds";
const FALLBACK_DISCOVERY_TTL_MS = 5 * 60 * 1000;
const UNTRUSTED_CERTIFICATE_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const HTTP_403_GUIDANCE =
  "Check your network, proxy, or VPN settings, confirm auth.openai.com is reachable in your browser, or use an API key or locally signed-in Codex CLI.";

const nodeErrorCode = (cause: unknown): string | undefined => {
  const queue: unknown[] = [cause];
  let visited = 0;
  while (queue.length > 0 && visited < 8) {
    const current = queue.shift();
    visited += 1;
    if (!(current instanceof Error)) continue;
    const code = (current as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{1,64}$/u.test(code)) return code;
    if ("cause" in current && current.cause !== undefined) queue.push(current.cause);
    if (current instanceof AggregateError) {
      for (const nested of current.errors) queue.push(nested);
    }
  }
  return undefined;
};

type OidcHttpStage = "discover" | "jwks" | "exchange";

const stageLabel = (stage: OidcHttpStage): string => {
  switch (stage) {
    case "discover":
      return "ChatGPT sign-in discovery";
    case "jwks":
      return "ChatGPT sign-in key lookup";
    case "exchange":
      return "ChatGPT token exchange";
  }
};

const describeStatusFailure = (stage: OidcHttpStage, status: number): string => {
  const label = stageLabel(stage);
  if (status === 403) {
    return `${label} was rejected with HTTP 403. ${HTTP_403_GUIDANCE}`;
  }
  return `${label} failed with HTTP ${status}. Check your network or proxy settings and try again.`;
};

const describeTimeoutFailure = (stage: OidcHttpStage): string =>
  `${stageLabel(stage)} timed out. Check your network, proxy, or VPN connection and try again.`;

const describeTransportFailure = (stage: OidcHttpStage, code: string | undefined): string => {
  const target = stage === "jwks" ? "ChatGPT sign-in keys" : "ChatGPT sign-in";
  if (code !== undefined && UNTRUSTED_CERTIFICATE_CODES.has(code)) {
    return `Could not connect to ${target} because the TLS certificate is not trusted (${code}). Check your proxy or configure NODE_EXTRA_CA_CERTS.`;
  }
  return code !== undefined
    ? `Could not connect to ${target} (${code}). Check your network, proxy, or VPN settings and try again.`
    : `Could not connect to ${target} due to a network or proxy error. Check your network settings and try again.`;
};

const describeDecodeFailure = (stage: OidcHttpStage): string => {
  switch (stage) {
    case "discover":
      return "ChatGPT sign-in returned an invalid OpenID configuration response. Check if a proxy or firewall intercepted the request and try again.";
    case "jwks":
      return "ChatGPT sign-in returned an invalid signing key set. Check if a proxy or firewall intercepted the request and try again.";
    case "exchange":
      return "ChatGPT returned an invalid token response. Sign in again.";
  }
};

const withOidcHeaders = (request: HttpClientRequest.HttpClientRequest) =>
  request.pipe(
    HttpClientRequest.setHeader("accept", "application/json"),
    HttpClientRequest.setHeader("user-agent", OIDC_USER_AGENT),
  );
const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optionalKey(Schema.NonEmptyString),
  id_token: Schema.optionalKey(Schema.String),
  token_type: Schema.String,
  expires_in: Schema.Int.check(Schema.isGreaterThan(0)),
  scope: Schema.String,
  earliest_refresh_at: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.String])),
});
const Record = Schema.Struct({
  clientId: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.NullOr(Schema.String),
  expiresAt: Schema.Finite,
  earliestRefreshAt: Schema.NullOr(Schema.Finite),
  scopes: Schema.Array(Schema.String),
  subject: Schema.String,
  email: Schema.NullOr(Schema.String),
  idToken: Schema.optionalKey(Schema.String),
  issuer: Schema.optionalKey(Schema.String),
});
export type CodexChatGptCredentials = typeof Record.Type;
const Sessions = Schema.Struct({
  activeClientId: Schema.NullOr(Schema.String),
  sessions: Schema.Array(Record),
});
const sessionLocks = new WeakMap<
  typeof ServerSecretStore.ServerSecretStore.Service,
  Map<string, Semaphore.Semaphore>
>();
const Registration = Schema.Struct({
  clientId: Schema.String.check(Schema.isPattern(/^oaiapp_/u)),
  subject: Schema.optionalKey(Schema.String),
  connectionLabel: Schema.optionalKey(Schema.String),
  sharingEnabled: Schema.optionalKey(Schema.Boolean),
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  redirectUri: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^http:\/\/(?:127\.0\.0\.1|localhost):[1-9]\d{0,4}\/auth\/callback$/u),
    ),
  ),
});
const RegistrationProfiles = Schema.Struct({
  profiles: Schema.Array(Registration),
  lastClientId: Schema.NullOr(Schema.String),
});
const decodeRegistration = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Union([RegistrationProfiles, Registration])),
);
const encodeRegistration = Schema.encodeEffect(Schema.fromJsonString(RegistrationProfiles));
const profileMethodId = (clientId: string) => `chatgpt-profile:${clientId}`;
const Discovery = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
  revocation_endpoint: Schema.optionalKey(Schema.String),
});
const DEFAULT_OPENAI_DISCOVERY: typeof Discovery.Type = {
  issuer: DEFAULT_OPENAI_ISSUER,
  authorization_endpoint: `${DEFAULT_OPENAI_ISSUER}/api/accounts/authorize`,
  token_endpoint: `${DEFAULT_OPENAI_ISSUER}/api/accounts/oauth/token`,
  jwks_uri: `${DEFAULT_OPENAI_ISSUER}/.well-known/jwks.json`,
  revocation_endpoint: `${DEFAULT_OPENAI_ISSUER}/api/accounts/oauth/revoke`,
};
const isTrustedOpenAiDiscovery = (doc: typeof Discovery.Type): boolean => {
  if (doc.issuer !== DEFAULT_OPENAI_ISSUER) return false;
  const endpoints = [
    doc.authorization_endpoint,
    doc.token_endpoint,
    doc.jwks_uri,
    ...(doc.revocation_endpoint ? [doc.revocation_endpoint] : []),
  ];
  return endpoints.every((url) => {
    const parsed = URL.parse(url);
    return parsed !== null && parsed.origin === doc.issuer;
  });
};
const OAuthError = Schema.Struct({ error: Schema.String });
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;
const IdTokenClaims = Schema.Struct({
  sub: Schema.String,
  nonce: Schema.optionalKey(Schema.Unknown),
  email: Schema.optionalKey(Schema.Unknown),
});
const decodeKeySet = Schema.decodeUnknownEffect(Jwks.KeySet);
const decodeSessions = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Union([Sessions, Record])),
);
const encodeSessions = Schema.encodeEffect(Schema.fromJsonString(Sessions));
const decodeTokens = Schema.decodeUnknownSync(TokenResponse);
const decodeDiscoveryEffect = Schema.decodeUnknownEffect(Discovery);
const decodeOAuthError = Schema.decodeUnknownSync(OAuthError);

export const makeCodexChatGptAuth = Effect.fn("makeCodexChatGptAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly discoveryUrl?: string;
  readonly resource?: string;
  readonly defaultReturnUrl?: string;
  readonly reconnectProfile?: ChatGptReconnectProfile | null;
  readonly telemetryFlow?: "direct" | "primary_handoff";
  readonly expectedProfileKey?: string;
}) {
  const analytics = yield* Effect.serviceOption(AnalyticsService.AnalyticsService);
  const settings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
  const track = Effect.fn("CodexChatGptAuth.track")(function* <A, E extends ProviderSetupError, R>(
    event: "auth" | "transfer",
    properties: Readonly<Record<string, string>>,
    task: Effect.Effect<A, E, R>,
    expiresAt?: number,
  ) {
    if (Option.isNone(analytics)) return yield* task;
    const record = (name: string, properties: Readonly<Record<string, unknown>>) =>
      analytics.value.record(name, properties).pipe(Effect.ignoreCause);
    const startedAt = yield* Clock.currentTimeMillis;
    yield* record(`chatgpt.${event}.started`, properties);
    return yield* task.pipe(
      Effect.onExit((result) =>
        Effect.gen(function* () {
          const endedAt = yield* Clock.currentTimeMillis;
          const error = Exit.isFailure(result)
            ? Cause.findErrorOption(result.cause)
            : Option.none();
          const counts =
            Exit.isSuccess(result) &&
            (event === "transfer" || options.telemetryFlow !== "primary_handoff")
              ? yield* accountCounts.pipe(Effect.catchCause(() => Effect.succeed({})))
              : {};
          yield* record(`chatgpt.${event}.completed`, {
            ...counts,
            ...properties,
            outcome: Exit.isSuccess(result)
              ? "succeeded"
              : Cause.hasInterruptsOnly(result.cause)
                ? expiresAt !== undefined && endedAt >= expiresAt
                  ? "expired"
                  : "cancelled"
                : "failed",
            durationMs: Math.max(0, endedAt - startedAt),
            ...(Option.isSome(error) && isSetupError(error.value)
              ? { failureStage: error.value.operation }
              : {}),
          });
        }),
      ),
    );
  });
  const http = yield* HttpClient.HttpClient;
  const store = yield* ProviderCredentialStore.make("codex-chatgpt", options.instanceId);
  const registrationStore = yield* ProviderCredentialStore.make(
    "codex-chatgpt-registration",
    options.instanceId,
  );
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const digest = yield* Digest.Digest;
  const signature = yield* Signature.Signature;
  const environmentLocks = sessionLocks.get(secrets) ?? new Map<string, Semaphore.Semaphore>();
  sessionLocks.set(secrets, environmentLocks);
  const lock = environmentLocks.get(store.binding.key) ?? (yield* Semaphore.make(1));
  environmentLocks.set(store.binding.key, lock);
  const withSessionLock = <A, E, R>(task: Effect.Effect<A, E, R>) =>
    withChatGptSessionLock(secrets.directory, store.binding.key, options.instanceId, task);
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const hostId = `urn:uuid:${yield* environment.getEnvironmentId}`;
  const resource = options.resource ?? RESOURCE;
  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail });
  const executeOidcRequest = Effect.fnUntraced(function* (
    request: HttpClientRequest.HttpClientRequest,
  ) {
    return yield* http.execute(withOidcHeaders(request)).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.catchIf(
        (error): error is HttpClientError.HttpClientError =>
          HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError",
        (error) =>
          error.reason._tag === "StatusCodeError"
            ? Effect.succeed(error.reason.response)
            : Effect.fail(error),
      ),
    );
  });
  const failOidcRequestError = Effect.fnUntraced(function* (
    stage: OidcHttpStage,
    operation: string,
    url: string,
    error: unknown,
  ) {
    if (isSetupError(error)) return yield* error;
    if (Cause.isTimeoutError(error)) {
      yield* Effect.logWarning("ChatGPT OpenID request timed out", { stage, url });
      return yield* failure(operation, describeTimeoutFailure(stage));
    }
    if (HttpClientError.isHttpClientError(error)) {
      const reason = error.reason;
      if (reason._tag === "StatusCodeError") {
        const status = reason.response.status;
        yield* Effect.logWarning("ChatGPT OpenID request returned non-2xx status", {
          stage,
          url,
          statusCode: status,
          contentType: reason.response.headers["content-type"] ?? null,
        });
        return yield* failure(operation, describeStatusFailure(stage, status));
      }
      if (reason._tag === "TransportError") {
        const code = nodeErrorCode(reason.cause);
        yield* Effect.logWarning("ChatGPT OpenID request transport failed", {
          stage,
          url,
          errorCode: code ?? null,
        });
        return yield* failure(operation, describeTransportFailure(stage, code));
      }
      if (reason._tag === "DecodeError" || reason._tag === "EmptyBodyError") {
        yield* Effect.logWarning("ChatGPT OpenID response body could not be decoded", {
          stage,
          url,
          errorKind: reason._tag,
          contentType: reason.response.headers["content-type"] ?? null,
        });
        return yield* failure(operation, describeDecodeFailure(stage));
      }
      yield* Effect.logWarning("ChatGPT OpenID request failed", {
        stage,
        url,
        errorKind: reason._tag,
      });
      return yield* failure(operation, describeTransportFailure(stage, undefined));
    }
    yield* Effect.logWarning("ChatGPT OpenID response schema validation failed", {
      stage,
      url,
    });
    return yield* failure(operation, describeDecodeFailure(stage));
  });
  let metadata:
    | { readonly value: typeof Discovery.Type; readonly expiresAt: number | null }
    | undefined;
  const discover = Effect.gen(function* () {
    if (metadata !== undefined) {
      if (metadata.expiresAt === null || metadata.expiresAt > (yield* Clock.currentTimeMillis)) {
        return metadata.value;
      }
      metadata = undefined;
    }
    const discoveryUrl = options.discoveryUrl ?? DISCOVERY;
    const isDefaultDiscovery = !options.discoveryUrl;
    const response: HttpClientResponse.HttpClientResponse = yield* executeOidcRequest(
      HttpClientRequest.get(discoveryUrl),
    ).pipe(
      Effect.timeout(DISCOVERY_TIMEOUT),
      Effect.catch((error) => failOidcRequestError("discover", "discover", discoveryUrl, error)),
    );
    if (response.status < 200 || response.status >= 300) {
      if (isDefaultDiscovery && isTrustedOpenAiDiscovery(DEFAULT_OPENAI_DISCOVERY)) {
        yield* Effect.logWarning(
          "OpenAI OpenID discovery returned a non-2xx status; falling back to verified default endpoints",
          {
            stage: "discover",
            discoveryUrl,
            statusCode: response.status,
            contentType: response.headers["content-type"] ?? null,
            fallbackIssuer: DEFAULT_OPENAI_DISCOVERY.issuer,
          },
        );
        metadata = {
          value: DEFAULT_OPENAI_DISCOVERY,
          expiresAt: (yield* Clock.currentTimeMillis) + FALLBACK_DISCOVERY_TTL_MS,
        };
        return DEFAULT_OPENAI_DISCOVERY;
      }
      yield* Effect.logWarning("OpenAI OpenID discovery returned a non-2xx status", {
        stage: "discover",
        discoveryUrl,
        statusCode: response.status,
        contentType: response.headers["content-type"] ?? null,
      });
      return yield* failure("discover", describeStatusFailure("discover", response.status));
    }
    const result = yield* response.json.pipe(
      Effect.flatMap(decodeDiscoveryEffect),
      Effect.timeout(DISCOVERY_TIMEOUT),
      Effect.catch((error) => failOidcRequestError("discover", "discover", discoveryUrl, error)),
    );
    if (isDefaultDiscovery && !isTrustedOpenAiDiscovery(result)) {
      yield* Effect.logWarning("OpenAI OpenID discovery failed same-origin verification", {
        stage: "discover",
        discoveryUrl,
        issuer: result.issuer,
      });
      return yield* failure("discover", "ChatGPT sign-in configuration could not be verified.");
    }
    metadata = { value: result, expiresAt: null };
    return result;
  });
  // Reused for 10 minutes like jose's remote set; an unknown kid refetches once for rotation.
  let keySet: { readonly keys: Jwks.KeySet; readonly expiresAt: number } | undefined;
  const fetchKeySet = Effect.fn("CodexChatGptAuth.fetchKeySet")(function* (jwksUri: string) {
    return yield* Effect.gen(function* () {
      const response = yield* executeOidcRequest(HttpClientRequest.get(jwksUri));
      if (response.status !== 200) {
        yield* Effect.logWarning("OpenAI JWKS endpoint returned a non-200 status", {
          stage: "jwks",
          url: jwksUri,
          statusCode: response.status,
          contentType: response.headers["content-type"] ?? null,
        });
        return yield* failure("verify", describeStatusFailure("jwks", response.status));
      }
      return yield* response.json.pipe(Effect.flatMap(decodeKeySet));
    }).pipe(
      // Bounds the body read too, as jose's remote set did; a stalled endpoint fails the sign-in.
      Effect.timeout("5 seconds"),
      Effect.catch((error) => failOidcRequestError("jwks", "verify", jwksUri, error)),
      Effect.tap((fetched) =>
        Effect.map(Clock.currentTimeMillis, (now) => {
          keySet = { keys: fetched, expiresAt: now + JWKS_CACHE_TTL_MS };
        }),
      ),
    );
  });
  const verifyIdToken = Effect.fn("CodexChatGptAuth.verifyIdToken")(
    function* (token: string, audience: string) {
      const endpoints = yield* discover;
      const verifyWith = (keys: Jwks.KeySet) =>
        Jwks.makeLocal(keys).pipe(
          Effect.flatMap((jwks) =>
            Jwt.verifyWithKeySet(IdTokenClaims, token, {
              issuer: endpoints.issuer,
              audience,
              algorithms: ["RS256", "ES256"],
              clockTolerance: "5 seconds",
              requiredClaims: ["exp"],
            }).pipe(Effect.provideService(Jwks.Jwks, jwks)),
          ),
        );
      const fresh = fetchKeySet(endpoints.jwks_uri).pipe(Effect.flatMap(verifyWith));
      const cached = keySet;
      return yield* cached === undefined || cached.expiresAt <= (yield* Clock.currentTimeMillis)
        ? fresh
        : verifyWith(cached.keys).pipe(
            Effect.catchIf(
              (error) => JoseError.isJoseError(error) && error.reason._tag === "KeyNotFound",
              () => fresh,
            ),
          );
    },
    Effect.provideService(Signature.Signature, signature),
  );
  const readSessions = store.get.pipe(
    Effect.mapError(() => failure("read", "Could not read the saved ChatGPT connection.")),
    Effect.flatMap((bytes) =>
      Option.isNone(bytes)
        ? Effect.succeed<typeof Sessions.Type>({ activeClientId: null, sessions: [] })
        : decodeSessions(new TextDecoder().decode(bytes.value)).pipe(
            Effect.map((saved) =>
              "sessions" in saved ? saved : { activeClientId: saved.clientId, sessions: [saved] },
            ),
            Effect.mapError(() =>
              failure("read", "The saved ChatGPT connection is invalid. Sign in again."),
            ),
          ),
    ),
  );
  const read = readSessions.pipe(
    Effect.map((saved) =>
      Option.fromUndefinedOr(
        saved.sessions.find((session) => session.clientId === saved.activeClientId),
      ),
    ),
  );
  const writeSessions = (saved: typeof Sessions.Type) =>
    encodeSessions(saved).pipe(
      Effect.flatMap((json) => store.set(new TextEncoder().encode(json))),
      Effect.mapError(() => failure("save", "Could not save the ChatGPT connection.")),
    );
  const readRegistrations = registrationStore.get.pipe(
    Effect.mapError(() =>
      failure("registration", "Could not read the ChatGPT sign-in registration. Try again."),
    ),
    Effect.flatMap((bytes) =>
      Option.isNone(bytes)
        ? Effect.succeed<typeof RegistrationProfiles.Type>({ profiles: [], lastClientId: null })
        : decodeRegistration(new TextDecoder().decode(bytes.value)).pipe(
            Effect.map((record) => {
              const saved =
                "profiles" in record
                  ? record
                  : { profiles: [record], lastClientId: record.clientId };
              const last = saved.profiles.find(
                (profile) => profile.clientId === saved.lastClientId,
              );
              const ordered = last
                ? [last, ...saved.profiles.filter((profile) => profile.clientId !== last.clientId)]
                : saved.profiles;
              return {
                ...saved,
                profiles: ordered.map((profile) => ({
                  ...profile,
                  connectionLabel:
                    profile.connectionLabel ?? `Connection ${saved.profiles.indexOf(profile) + 1}`,
                })),
              };
            }),
            Effect.mapError(() =>
              failure("registration", "The saved ChatGPT sign-in registration is invalid."),
            ),
          ),
    ),
  );
  const accountCounts = Effect.gen(function* () {
    const instanceIds = new Set<string>([options.instanceId]);
    if (Option.isSome(settings)) {
      const current = yield* settings.value.getSettings;
      instanceIds.add("codex");
      for (const [id, instance] of Object.entries(current.providerInstances)) {
        if (instance.driver === "codex") instanceIds.add(id);
      }
    }
    const accounts = new Set<string>();
    const connections = new Set<string>();
    const savedConnections = new Set<string>();
    let unidentifiedConnectedConnectionCount = 0;
    for (const id of instanceIds) {
      const registrations = yield* ProviderCredentialStore.make("codex-chatgpt-registration", id);
      const registrationBytes = yield* registrations.get;
      if (Option.isSome(registrationBytes)) {
        const saved = yield* decodeRegistration(new TextDecoder().decode(registrationBytes.value));
        for (const profile of "profiles" in saved ? saved.profiles : [saved]) {
          savedConnections.add(profile.clientId);
        }
      }
      const credentials = yield* ProviderCredentialStore.make("codex-chatgpt", id);
      const credentialBytes = yield* credentials.get;
      if (Option.isNone(credentialBytes)) continue;
      const saved = yield* decodeSessions(new TextDecoder().decode(credentialBytes.value));
      for (const session of "sessions" in saved ? saved.sessions : [saved]) {
        if (!session.scopes.includes(REQUIRED_SCOPE) || connections.has(session.clientId)) continue;
        connections.add(session.clientId);
        // Client-scoped subjects need verified email for local counting only; never export email or merge profiles.
        const email = session.email?.trim().toLowerCase();
        if (email) accounts.add(email);
        else unidentifiedConnectedConnectionCount++;
      }
    }
    return {
      accountCountScope: Option.isSome(settings) ? "environment" : "provider_instance",
      connectedAccountCount: accounts.size,
      connectedConnectionCount: connections.size,
      savedConnectionCount: savedConnections.size,
      unidentifiedConnectedConnectionCount,
    };
  }).pipe(
    Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
    Effect.provideService(SecureRandom.SecureRandom, random),
    Effect.provideService(Digest.Digest, digest),
  );
  const saveRegistration = Effect.fnUntraced(function* (profile: typeof Registration.Type) {
    const saved = yield* readRegistrations;
    let connectionNumber = saved.profiles.length + 1;
    while (
      saved.profiles.some((entry) => entry.connectionLabel === `Connection ${connectionNumber}`)
    )
      connectionNumber++;
    profile = {
      ...profile,
      connectionLabel:
        saved.profiles.find((entry) => entry.clientId === profile.clientId)?.connectionLabel ??
        profile.connectionLabel ??
        `Connection ${connectionNumber}`,
    };
    yield* encodeRegistration({
      profiles: [profile, ...saved.profiles.filter((entry) => entry.clientId !== profile.clientId)],
      lastClientId: profile.clientId,
    }).pipe(
      Effect.flatMap((json) => registrationStore.set(new TextEncoder().encode(json))),
      Effect.mapError(() =>
        failure("registration", "Could not save the ChatGPT sign-in registration. Try again."),
      ),
    );
  });
  const save = Effect.fnUntraced(function* (record: CodexChatGptCredentials, activate = true) {
    const saved = yield* readSessions;
    yield* writeSessions({
      activeClientId: activate ? record.clientId : saved.activeClientId,
      sessions: [
        ...saved.sessions.filter((session) => session.clientId !== record.clientId),
        record,
      ],
    });
  });
  const clearTokens = Effect.gen(function* () {
    const saved = yield* readSessions;
    const sessions = saved.sessions.filter((session) => session.clientId !== saved.activeClientId);
    if (sessions.length) yield* writeSessions({ activeClientId: null, sessions });
    else
      yield* store.remove.pipe(
        Effect.mapError(() =>
          failure("disconnect", "Could not clear the ChatGPT connection. Try again."),
        ),
      );
  });
  const remove = Effect.gen(function* () {
    const credentials = yield* read;
    if (Option.isSome(credentials)) {
      const { clientId, subject, email } = credentials.value;
      const saved = yield* readRegistrations;
      const profile = saved.profiles.find((entry) => entry.clientId === clientId);
      if (profile && (profile.subject === undefined || profile.email === undefined))
        yield* saveRegistration({ ...profile, subject, email });
    }
    yield* clearTokens;
  });
  const exchange = Effect.fn("CodexChatGptAuth.exchange")(function* (body: URLSearchParams) {
    const endpoints = yield* discover;
    const response = yield* executeOidcRequest(
      HttpClientRequest.post(endpoints.token_endpoint).pipe(
        HttpClientRequest.bodyText(body.toString(), "application/x-www-form-urlencoded"),
      ),
    ).pipe(
      Effect.timeout(TOKEN_EXCHANGE_TIMEOUT),
      Effect.catch((error) =>
        failOidcRequestError("exchange", "exchange", endpoints.token_endpoint, error),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      const parsedBody = yield* response.json.pipe(Effect.timeout("5 seconds"), Effect.result);
      const oauthError =
        parsedBody._tag === "Success"
          ? (() => {
              try {
                return decodeOAuthError(parsedBody.success).error;
              } catch {
                return undefined;
              }
            })()
          : undefined;
      if (oauthError !== undefined) {
        if (
          body.get("grant_type") === "refresh_token" &&
          [
            "invalid_grant",
            "invalid_refresh_token",
            "token_expired",
            "refresh_token_expired",
            "refresh_token_invalidated",
            "refresh_token_reused",
          ].includes(oauthError)
        ) {
          yield* remove;
          return yield* failure(
            "refresh",
            "Your ChatGPT connection expired or was disconnected. Sign in again.",
          );
        }
        if (oauthError === "invalid_client")
          return yield* failure(
            "client",
            "OpenAI rejected this app's client registration. Check the ChatGPT connection configuration.",
          );
        if (body.get("grant_type") === "authorization_code" && oauthError === "invalid_grant")
          return yield* failure("code-expired", "This sign-in code expired. Start again.");
        if (oauthError === "access_denied")
          return yield* failure(
            "exchange",
            "ChatGPT sign-in was declined. Sign in again when you are ready.",
          );
        yield* Effect.logWarning("ChatGPT token exchange returned an OAuth error", {
          stage: "exchange",
          url: endpoints.token_endpoint,
          statusCode: response.status,
          oauthError,
        });
        if (response.status === 403) {
          return yield* failure("exchange", describeStatusFailure("exchange", response.status));
        }
        return yield* failure(
          "exchange",
          `ChatGPT could not complete sign-in (HTTP ${response.status}). Try again.`,
        );
      }
      yield* Effect.logWarning("ChatGPT token exchange returned a non-2xx status", {
        stage: "exchange",
        url: endpoints.token_endpoint,
        statusCode: response.status,
        contentType: response.headers["content-type"] ?? null,
      });
      return yield* failure("exchange", describeStatusFailure("exchange", response.status));
    }
    const raw = yield* response.json.pipe(
      Effect.timeout(TOKEN_EXCHANGE_TIMEOUT),
      Effect.catch((error) =>
        failOidcRequestError("exchange", "exchange", endpoints.token_endpoint, error),
      ),
    );
    return yield* Effect.try({
      try: () => decodeTokens(raw),
      catch: () =>
        failure("exchange", "ChatGPT returned an invalid token response. Sign in again."),
    });
  });
  const earliest = (value: (typeof TokenResponse.Type)["earliest_refresh_at"]) => {
    if (value === undefined) return null;
    const time = typeof value === "number" ? value * 1000 : Date.parse(value);
    return Number.isFinite(time) ? time : null;
  };
  const authenticate = Effect.fn("CodexChatGptAuth.authenticate")(function* (
    method: string,
    context: ProviderAuthFlowContext,
  ) {
    const endpoints = yield* discover;
    const existing = yield* read;
    const previous = Option.getOrUndefined(existing);
    const registrations = yield* readRegistrations;
    const changingAccount = method === "chatgpt-change-account";
    const selectedClientId = method.startsWith("chatgpt-profile:")
      ? method.slice("chatgpt-profile:".length)
      : (previous?.clientId ?? registrations.lastClientId);
    const savedRegistration = changingAccount
      ? undefined
      : registrations.profiles.find((profile) => profile.clientId === selectedClientId);
    // Legacy localhost registrations cannot change on reauth; register 127.0.0.1 while preserving the verified account.
    const legacyCallback = savedRegistration?.redirectUri?.includes("//localhost:") === true;
    const registeredClientId = legacyCallback ? undefined : savedRegistration?.clientId;
    const selectedTokens = (yield* readSessions).sessions.find(
      (session) => session.clientId === selectedClientId,
    );
    const randomToken = (size: number) =>
      random.randomBytes(size).pipe(Effect.map(Base64Url.encode));
    const state = yield* randomToken(32);
    const nonce = yield* randomToken(32);
    const verifier = yield* randomToken(64);
    const returnUrl =
      codexAuthReturnUrl(context.returnUrl) ?? codexAuthReturnUrl(options.defaultReturnUrl);
    const pageNonce = yield* randomToken(24);
    const callback = Promise.withResolvers<{ url: URL; response?: NodeHttp.ServerResponse }>();
    const clientCallback = context.callbackMode === "client";
    let used = false;
    const server = clientCallback
      ? undefined
      : yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              new Promise<NodeHttp.Server>((resolve, reject) => {
                const callbackBase = "http://127.0.0.1/auth/callback";
                const server = NodeHttp.createServer((request, response) => {
                  const url = URL.parse(request.url ?? "/", callbackBase);
                  if (request.method !== "GET" || url?.pathname !== "/auth/callback") {
                    response.writeHead(404).end();
                    return;
                  }
                  if (used) {
                    response.writeHead(410).end("Sign-in is no longer active.");
                    return;
                  }
                  // Reject a stray request without ending the sign-in, so the real redirect still lands.
                  let returned: URL;
                  try {
                    returned = codexCallbackUrl(url.toString(), callbackBase, state);
                  } catch {
                    response
                      .writeHead(400)
                      .end("This response does not belong to the active sign-in.");
                    return;
                  }
                  used = true;
                  callback.resolve({ url: returned, response });
                });
                server.once("error", reject);
                server.listen(0, "127.0.0.1", () => resolve(server));
              }),
            catch: () =>
              failure("callback", "Could not start the local sign-in callback. Try again."),
          }),
          (server) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  server.closeAllConnections();
                  server.close(() => resolve());
                }),
            ),
        );
    const address = server?.address();
    if (!clientCallback && (!address || typeof address === "string"))
      return yield* failure("callback", "Could not start the local sign-in callback.");
    // Only the port may vary between attempts; token exchange uses this exact URI.
    const port =
      address && typeof address !== "string"
        ? address.port
        : yield* random.intBetween(49_152, 65_536, { halfOpen: true });
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
    const idTokenHint = selectedTokens?.idToken ?? options.reconnectProfile?.idTokenHint;
    const codeChallenge = Base64Url.encode(
      yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier)),
    );
    const url = new URL(endpoints.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: registeredClientId ?? "dynamic_agent_client",
      ...(registeredClientId
        ? {
            ...(savedRegistration?.email ? { login_hint: savedRegistration.email } : {}),
            ...(idTokenHint ? { id_token_hint: idTokenHint } : {}),
            ...(savedRegistration?.sharingEnabled === false ||
            (selectedTokens && !selectedTokens.scopes.includes(REQUIRED_SCOPE))
              ? { prompt: "consent" }
              : {}),
          }
        : { agent_name_hint: "Prismux" }),
      ext_agent_host_id: hostId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: codeChallenge,
    }).toString();
    yield* context.setInteraction(
      {
        type: "browser",
        id: context.flowId,
        url: url.toString(),
        requiresConsent: false,
        acceptsCallback: true,
      },
      undefined,
      (callbackUrl) =>
        Effect.try({
          try: () => {
            const returned = codexCallbackUrl(callbackUrl, redirectUri, state);
            if (used) throw new Error("used");
            used = true;
            callback.resolve({ url: returned });
          },
          catch: () =>
            failure("complete", "This redirect URL does not belong to the active ChatGPT sign-in."),
        }),
    );
    const received = yield* Effect.tryPromise({
      try: () => callback.promise,
      catch: () => failure("callback", "ChatGPT sign-in could not be completed."),
    });
    const returned = received.url;
    yield* Effect.gen(function* () {
      if (returned.searchParams.get("state") !== state)
        return yield* failure("callback", "ChatGPT sign-in could not be verified. Start again.");
      if (returned.searchParams.has("error"))
        return yield* failure(
          "callback",
          returned.searchParams.get("error") === "access_denied"
            ? "ChatGPT sign-in was declined. Sign in again when you are ready."
            : "ChatGPT sign-in could not be completed. Start again.",
        );
      const code = returned.searchParams.get("code");
      const clientId = registeredClientId ?? returned.searchParams.get("client_id");
      if (
        !code ||
        !clientId ||
        !clientId.startsWith("oaiapp_") ||
        (registeredClientId &&
          returned.searchParams.has("client_id") &&
          returned.searchParams.get("client_id") !== registeredClientId)
      )
        return yield* failure(
          "callback",
          "ChatGPT registration is incomplete. Start sign-in again.",
        );
      yield* context.verifying;
      const tokens = yield* exchange(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          resource,
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            if (error.operation === "code-expired") {
              if (!registeredClientId)
                yield* withSessionLock(saveRegistration({ clientId, redirectUri }));
              return yield* failure(
                "exchange",
                "This sign-in code expired. Reconnect the saved ChatGPT profile to start a fresh sign-in.",
              );
            }
            return yield* error;
          }),
        ),
      );
      if (!tokens.id_token)
        return yield* failure(
          "verify",
          "ChatGPT did not return a verified identity. Sign in again.",
        );
      const identity = yield* verifyIdToken(tokens.id_token, clientId).pipe(
        Effect.flatMap(({ claims }) =>
          claims.nonce === nonce
            ? Effect.succeed({
                subject: claims.sub,
                email: typeof claims.email === "string" ? claims.email : null,
              })
            : Effect.fail(failure("verify", "ChatGPT sign-in could not be verified. Start again.")),
        ),
        Effect.mapError((error) =>
          isSetupError(error)
            ? error
            : failure("verify", "ChatGPT sign-in could not be verified. Start again."),
        ),
      );
      const expectedSubject =
        savedRegistration?.subject ??
        (previous?.clientId === registeredClientId ? previous?.subject : undefined);
      // Compare subjects only within a registration; legacy callback migration creates a new client.
      if (registeredClientId && expectedSubject && identity.subject !== expectedSubject)
        return yield* failure(
          "verify",
          "This sign-in returned a different ChatGPT account. Use the different-account sign-in option instead. Your saved connection is unchanged.",
        );
      const knownProfile = registrations.profiles.find((profile) => profile.clientId === clientId);
      if (
        knownProfile &&
        ((knownProfile.redirectUri &&
          (() => {
            const original = new URL(knownProfile.redirectUri);
            const current = new URL(redirectUri);
            return (
              original.protocol !== current.protocol ||
              original.hostname !== current.hostname ||
              original.pathname !== current.pathname
            );
          })()) ||
          (knownProfile.subject && knownProfile.subject !== identity.subject))
      )
        return yield* failure(
          "verify",
          "ChatGPT returned a conflicting account registration. Start again.",
        );
      if (tokens.token_type.toLowerCase() !== "bearer")
        return yield* failure(
          "verify",
          "ChatGPT returned an unsupported connection. Sign in again.",
        );
      const scopes = tokens.scope.split(/\s+/).filter(Boolean);
      yield* withSessionLock(
        Effect.gen(function* () {
          yield* saveRegistration({
            clientId,
            redirectUri,
            sharingEnabled: scopes.includes(REQUIRED_SCOPE),
            ...identity,
          });
          yield* save(
            {
              clientId,
              accessToken: tokens.access_token,
              idToken: tokens.id_token!,
              issuer: endpoints.issuer,
              refreshToken: tokens.refresh_token ?? null,
              expiresAt: (yield* Clock.currentTimeMillis) + tokens.expires_in * 1000,
              earliestRefreshAt: earliest(tokens.earliest_refresh_at),
              scopes,
              ...identity,
            },
            scopes.includes(REQUIRED_SCOPE) || Option.isNone(yield* read),
          );
        }),
      );
      if (!scopes.includes(REQUIRED_SCOPE))
        return yield* failure(
          "sharing",
          previous && previous.clientId !== clientId
            ? "Token sharing was not enabled for the new account. Your existing ChatGPT connection is unchanged."
            : "Signed in with ChatGPT, but token sharing is disabled. Sign in again and enable token sharing, or use another provider.",
        );
    }).pipe(
      Effect.onExit((result) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              const response = received.response;
              if (!response || response.destroyed) {
                resolve();
                return;
              }
              response.once("close", resolve);
              response
                .writeHead(200, {
                  "content-type": "text/html; charset=utf-8",
                  "cache-control": "no-store",
                  "referrer-policy": "no-referrer",
                  "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${pageNonce}'; base-uri 'none'; frame-ancestors 'none'`,
                  "x-content-type-options": "nosniff",
                })
                .end(codexAuthCallbackPage(Exit.isSuccess(result), returnUrl, pageNonce), resolve);
            }),
        ),
      ),
    );
  });
  // ID tokens survive renewal but change on sign-in. Bind active children to the
  // launch profile without putting an identity token or subject in their argv.
  const profileKey = (record: CodexChatGptCredentials) =>
    digest
      .digest(
        Digest.sha256,
        new TextEncoder().encode(
          JSON.stringify([record.clientId, record.subject, record.idToken ?? null]),
        ),
      )
      .pipe(Effect.map(Hex.encode), Effect.orDie);
  const access = Effect.gen(function* () {
    const saved = yield* read;
    if (Option.isNone(saved))
      return yield* failure("access", "Sign in with ChatGPT to use managed Codex.");
    let record = saved.value;
    if (
      options.expectedProfileKey !== undefined &&
      (yield* profileKey(record)) !== options.expectedProfileKey
    )
      return yield* failure("access", "The ChatGPT connection changed. Start a new session.");
    if (!record.scopes.includes(REQUIRED_SCOPE))
      return yield* failure(
        "sharing",
        "Token sharing is disabled. Sign in with ChatGPT and enable token sharing.",
      );
    const now = yield* Clock.currentTimeMillis;
    if (record.expiresAt - now > 60_000) return record;
    if (record.earliestRefreshAt !== null && record.earliestRefreshAt > now) {
      if (record.expiresAt > now) return record;
      return yield* failure(
        "refresh",
        "ChatGPT cannot renew this connection yet. Try again shortly.",
      );
    }
    if (!record.refreshToken) {
      yield* remove;
      return yield* failure("refresh", "Your ChatGPT connection expired. Sign in again.");
    }
    const tokens = yield* exchange(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: record.clientId,
        refresh_token: record.refreshToken,
        resource,
      }),
    ).pipe(
      Effect.interruptible,
      Effect.timeout("20 seconds"),
      Effect.mapError((error) =>
        isSetupError(error)
          ? error.operation === "client" || error.operation === "refresh"
            ? error
            : failure("refresh", `Could not renew the ChatGPT connection: ${error.detail}`)
          : failure(
              "refresh",
              "Could not renew the ChatGPT connection (timed out). Retry, or sign in again.",
            ),
      ),
    );
    if (!tokens.refresh_token || tokens.token_type.toLowerCase() !== "bearer") {
      return yield* failure("refresh", "ChatGPT returned an invalid renewal. Sign in again.");
    }
    record = {
      ...record,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: (yield* Clock.currentTimeMillis) + tokens.expires_in * 1000,
      earliestRefreshAt: earliest(tokens.earliest_refresh_at),
      scopes: tokens.scope.split(/\s+/).filter(Boolean),
    };
    yield* save(record);
    if (!record.scopes.includes(REQUIRED_SCOPE))
      return yield* failure(
        "sharing",
        "ChatGPT token sharing is no longer enabled. Sign in again.",
      );
    return record;
  }).pipe(Effect.uninterruptible, withSessionLock, lock.withPermit);
  const logout = Effect.gen(function* () {
    const credentials = Option.getOrUndefined(yield* read);
    let confirmed = !credentials?.refreshToken;
    if (credentials?.refreshToken) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = yield* Effect.gen(function* () {
          const endpoints = yield* discover;
          if (!endpoints.revocation_endpoint) return { confirmed: false, retry: false };
          const response = yield* executeOidcRequest(
            HttpClientRequest.post(endpoints.revocation_endpoint).pipe(
              HttpClientRequest.bodyText(
                new URLSearchParams({
                  token: credentials.refreshToken!,
                  token_type_hint: "refresh_token",
                  client_id: credentials.clientId,
                }).toString(),
                "application/x-www-form-urlencoded",
              ),
            ),
          );
          return { confirmed: response.status === 200, retry: response.status >= 500 };
        }).pipe(
          Effect.timeout("10 seconds"),
          Effect.orElseSucceed(() => ({ confirmed: false, retry: true })),
        );
        confirmed = result.confirmed;
        if (confirmed || !result.retry || attempt === 2) break;
        yield* Effect.sleep(attempt === 0 ? "250 millis" : "1 second");
      }
    }
    yield* remove;
    return confirmed
      ? undefined
      : "Signed out locally. Remote revocation could not be confirmed. Disconnect the app in ChatGPT Settings.";
  });
  if (options.reconnectProfile) {
    const { idTokenHint: _hint, ...registration } = options.reconnectProfile;
    yield* saveRegistration(registration).pipe(Effect.orDie);
  }
  const controller = yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: store.binding,
    refreshMethodsAfterAuth: true,
    methods: Effect.gen(function* () {
      const saved = yield* readRegistrations;
      const active = Option.getOrUndefined(yield* read);
      const sessions = (yield* readSessions).sessions;
      const current = saved.profiles.find(
        (profile) => profile.clientId === (active?.clientId ?? saved.lastClientId),
      );
      const profiles = current
        ? [current, ...saved.profiles.filter((profile) => profile.clientId !== current.clientId)]
        : saved.profiles;
      return [
        {
          id: "chatgpt",
          name: "Sign in with ChatGPT",
          description: current?.email ? `Reconnect ${current.email}.` : null,
          ...(current?.email ? { accountEmail: current.email } : {}),
          type: "agent" as const,
        },
        {
          id: "chatgpt-change-account",
          name: "Use a different ChatGPT account",
          description: "Register a connection for another ChatGPT account.",
          type: "agent" as const,
        },
        ...profiles.slice(0, 30).map((profile) => ({
          id: profileMethodId(profile.clientId),
          canRemove:
            profile.subject === undefined &&
            !sessions.some((session) => session.clientId === profile.clientId),
          name: `${profile.email ?? "ChatGPT account"} · ${profile.connectionLabel}`,
          ...(profile.email ? { accountEmail: profile.email } : {}),
          description: "Reuse this account's original sign-in registration.",
          type: "agent" as const,
        })),
      ];
    }),
    authenticate: (method, context) =>
      lock.withPermit(
        track(
          "auth",
          {
            flow: options.telemetryFlow ?? "direct",
            intent:
              options.telemetryFlow === "primary_handoff"
                ? options.reconnectProfile
                  ? "saved_profile"
                  : "different_account"
                : method === "chatgpt-change-account"
                  ? "different_account"
                  : method.startsWith("chatgpt-profile:")
                    ? "saved_profile"
                    : "default",
            callbackMode: context.callbackMode ?? "server",
          },
          authenticate(method, context),
          context.expiresAt,
        ),
      ),
    removeMethod: Effect.fn("CodexChatGptAuth.removeMethod")(function (methodId) {
      return lock.withPermit(
        withSessionLock(
          Effect.gen(function* () {
            const saved = yield* readRegistrations;
            const profile = saved.profiles.find(
              (entry) => profileMethodId(entry.clientId) === methodId,
            );
            if (
              !profile ||
              profile.subject !== undefined ||
              (yield* readSessions).sessions.some(
                (session) => session.clientId === profile.clientId,
              )
            )
              return yield* failure(
                "removeMethod",
                "Only incomplete ChatGPT connections can be removed.",
              );
            const profiles = saved.profiles.filter((entry) => entry.clientId !== profile.clientId);
            yield* encodeRegistration({
              profiles,
              lastClientId:
                saved.lastClientId === profile.clientId
                  ? (profiles[0]?.clientId ?? null)
                  : saved.lastClientId,
            }).pipe(
              Effect.flatMap((json) => registrationStore.set(new TextEncoder().encode(json))),
              Effect.mapError(() =>
                failure(
                  "removeMethod",
                  "Could not remove the saved ChatGPT connection. Try again.",
                ),
              ),
            );
          }),
        ),
      );
    }),
    logout: lock.withPermit(withSessionLock(logout)),
  });
  const reconnectProfile = Effect.fnUntraced(function* (methodId: string) {
    if (methodId === "chatgpt-change-account") return null;
    const registrations = yield* readRegistrations;
    const active = Option.getOrUndefined(yield* read);
    const clientId = methodId.startsWith("chatgpt-profile:")
      ? methodId.slice("chatgpt-profile:".length)
      : (active?.clientId ?? registrations.lastClientId);
    const registration = registrations.profiles.find((profile) => profile.clientId === clientId);
    if (!registration) {
      if (methodId.startsWith("chatgpt-profile:"))
        return yield* failure("export", "This saved connection is no longer available.");
      return null;
    }
    const session = (yield* readSessions).sessions.find((session) => session.clientId === clientId);
    return { ...registration, ...(session?.idToken ? { idTokenHint: session.idToken } : {}) };
  });
  const exportProfile = Effect.gen(function* () {
    const credentials = Option.getOrUndefined(yield* read);
    const registration =
      credentials &&
      (yield* readRegistrations).profiles.find(
        (profile) => profile.clientId === credentials.clientId,
      );
    if (!credentials?.idToken || !credentials.issuer || !registration)
      return yield* failure(
        "export",
        "Complete ChatGPT sign-in before transferring this connection.",
      );
    return {
      registration,
      credentials: { ...credentials, idToken: credentials.idToken, issuer: credentials.issuer },
    } satisfies ChatGptTransferredProfile;
  });
  const importProfile = (
    profile: ChatGptTransferredProfile,
    stopSessions: Effect.Effect<void, ProviderSetupError>,
  ) => {
    const validate = Effect.gen(function* () {
      const endpoints = yield* discover;
      const credentials = profile.credentials;
      if (
        credentials.clientId !== profile.registration.clientId ||
        credentials.issuer !== endpoints.issuer ||
        !credentials.scopes.includes(REQUIRED_SCOPE) ||
        credentials.expiresAt <= (yield* Clock.currentTimeMillis)
      )
        return yield* failure(
          "import",
          "The transferred ChatGPT connection is invalid or expired.",
        );
      const identity = yield* verifyIdToken(credentials.idToken, credentials.clientId).pipe(
        Effect.mapError((error) =>
          isSetupError(error)
            ? error
            : failure("import", "The transferred ChatGPT identity could not be verified."),
        ),
      );
      if (
        identity.claims.sub !== credentials.subject ||
        profile.registration.subject !== credentials.subject ||
        (identity.claims.email ?? null) !== credentials.email ||
        (profile.registration.email !== undefined &&
          profile.registration.email !== credentials.email)
      )
        return yield* failure(
          "import",
          "The transferred ChatGPT identity does not match its profile.",
        );
    });
    const saveImported = Effect.gen(function* () {
      const { idTokenHint: _hint, ...registration } = profile.registration;
      const existing = (yield* readRegistrations).profiles.find(
        (saved) => saved.clientId === registration.clientId,
      );
      if (existing?.subject && existing.subject !== profile.credentials.subject)
        return yield* failure(
          "import",
          "The transferred identity conflicts with the saved ChatGPT connection.",
        );
      yield* saveRegistration(registration);
      yield* save(profile.credentials, true);
    });
    return lock.withPermit(
      track(
        "transfer",
        { flow: "primary_handoff" },
        validate.pipe(
          Effect.andThen(controller.adoptCredentials!(withSessionLock(saveImported), stopSessions)),
        ),
      ),
    );
  };
  return {
    controller: { ...controller, reconnectProfile, importProfile },
    read,
    access,
    profileKey,
    exportProfile,
    revoke: lock.withPermit(withSessionLock(remove)),
  };
});
