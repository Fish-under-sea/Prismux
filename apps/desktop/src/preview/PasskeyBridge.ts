import type { CreateCredentialResult, GetCredentialResult } from "electron-webauthn";

import { PASSKEY_CREATE_CHANNEL, PASSKEY_GET_CHANNEL } from "./GuestProtocol.ts";

export type PasskeyCeremonyResult =
  | Extract<CreateCredentialResult, { success: true }>
  | Extract<GetCredentialResult, { success: true }>
  | { readonly success: false; readonly error: string };

type PasskeyChannel = typeof PASSKEY_CREATE_CHANNEL | typeof PASSKEY_GET_CHANNEL;
// Credential Management Level 1 added `mediation` to creation requests.
type CreationOptions = CredentialCreationOptions & {
  readonly mediation?: CredentialMediationRequirement;
};
type InvokePasskeyCeremony = (channel: PasskeyChannel, publicKey: unknown) => Promise<unknown>;

const NOT_ALLOWED_MESSAGE =
  "The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.";
const DOM_EXCEPTION_NAMES = new Set([
  "AbortError",
  "InvalidStateError",
  "NotAllowedError",
  "NotSupportedError",
  "SecurityError",
]);

const fromBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
};

const toBase64Url = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");

const ceremonyError = (name: string) =>
  name === "TypeError"
    ? new TypeError("The passkey request options are invalid.")
    : new DOMException(
        NOT_ALLOWED_MESSAGE,
        DOM_EXCEPTION_NAMES.has(name) ? name : "NotAllowedError",
      );

// Chromium drops unknown members; discard uncloneable values instead of failing the ceremony.
const toCloneable = (value: unknown): unknown => {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  if (Array.isArray(value)) return value.map(toCloneable);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, member]) =>
        typeof member === "function" || member === undefined ? [] : [[key, toCloneable(member)]],
      ),
    );
  }
  return value;
};

// Shadow native getters: they reject objects Chromium did not create, even with the correct prototype.
const withValues = <T extends object>(target: T, values: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true });
  }
  return target;
};

const prfOutputs = (prf: {
  readonly enabled?: boolean;
  readonly results?: { readonly first?: string; readonly second?: string };
}): AuthenticationExtensionsPRFOutputs => {
  const first = prf.results?.first;
  const second = prf.results?.second;
  return {
    ...(prf.enabled === undefined ? {} : { enabled: prf.enabled }),
    ...(first === undefined
      ? {}
      : {
          results: {
            first: fromBase64Url(first),
            ...(second === undefined ? {} : { second: fromBase64Url(second) }),
          },
        }),
  };
};

const extensionResultsJson = (results: AuthenticationExtensionsClientOutputs) =>
  JSON.parse(
    JSON.stringify(results, (_key, value: unknown) =>
      value instanceof ArrayBuffer ? toBase64Url(value) : value,
    ),
  ) as unknown;

const makeCredential = (input: {
  readonly id: string;
  readonly authenticatorAttachment: AuthenticatorAttachment | null;
  readonly response: AuthenticatorResponse;
  readonly responseJson: Record<string, unknown>;
  readonly extensionResults: AuthenticationExtensionsClientOutputs;
}) =>
  withValues(Object.create(PublicKeyCredential.prototype) as PublicKeyCredential, {
    id: input.id,
    rawId: fromBase64Url(input.id),
    type: "public-key",
    authenticatorAttachment: input.authenticatorAttachment,
    response: input.response,
    getClientExtensionResults: () => input.extensionResults,
    toJSON: () => ({
      id: input.id,
      rawId: input.id,
      type: "public-key",
      ...(input.authenticatorAttachment === null
        ? {}
        : { authenticatorAttachment: input.authenticatorAttachment }),
      response: input.responseJson,
      clientExtensionResults: extensionResultsJson(input.extensionResults),
    }),
  });

const credentialFromCreateResult = (
  data: Extract<CreateCredentialResult, { success: true }>["data"],
) => {
  const transports = [...data.transports];
  const publicKey = data.publicKey.length > 0 ? data.publicKey : null;
  const extensionResults: AuthenticationExtensionsClientOutputs = {
    ...(data.extensions.credProps ? { credProps: { ...data.extensions.credProps } } : {}),
    ...(data.extensions.prf ? { prf: prfOutputs(data.extensions.prf) } : {}),
    ...(data.extensions.largeBlob ? { largeBlob: { ...data.extensions.largeBlob } } : {}),
  };
  return makeCredential({
    id: data.credentialId,
    // The native layer cannot tell a synced passkey from a security key.
    authenticatorAttachment: null,
    response: withValues(
      Object.create(AuthenticatorAttestationResponse.prototype) as AuthenticatorAttestationResponse,
      {
        clientDataJSON: fromBase64Url(data.clientDataJSON),
        attestationObject: fromBase64Url(data.attestationObject),
        getTransports: () => [...transports],
        getAuthenticatorData: () => fromBase64Url(data.authData),
        getPublicKey: () => (publicKey === null ? null : fromBase64Url(publicKey)),
        getPublicKeyAlgorithm: () => data.publicKeyAlgorithm,
      },
    ),
    responseJson: {
      clientDataJSON: data.clientDataJSON,
      attestationObject: data.attestationObject,
      authenticatorData: data.authData,
      transports,
      ...(publicKey === null ? {} : { publicKey }),
      publicKeyAlgorithm: data.publicKeyAlgorithm,
    },
    extensionResults,
  });
};

const credentialFromGetResult = (data: Extract<GetCredentialResult, { success: true }>["data"]) => {
  const userHandle =
    data.userHandle !== null && data.userHandle.length > 0 ? data.userHandle : null;
  const { prf, largeBlob } = data.extensions ?? {};
  const extensionResults: AuthenticationExtensionsClientOutputs = {
    ...(prf ? { prf: prfOutputs(prf) } : {}),
    ...(largeBlob
      ? {
          largeBlob: {
            ...(largeBlob.blob === undefined ? {} : { blob: fromBase64Url(largeBlob.blob) }),
            ...(largeBlob.written === undefined ? {} : { written: largeBlob.written }),
          },
        }
      : {}),
  };
  return makeCredential({
    id: data.credentialId,
    authenticatorAttachment: null,
    response: withValues(
      Object.create(AuthenticatorAssertionResponse.prototype) as AuthenticatorAssertionResponse,
      {
        clientDataJSON: fromBase64Url(data.clientDataJSON),
        authenticatorData: fromBase64Url(data.authenticatorData),
        signature: fromBase64Url(data.signature),
        userHandle: userHandle === null ? null : fromBase64Url(userHandle),
      },
    ),
    responseJson: {
      clientDataJSON: data.clientDataJSON,
      authenticatorData: data.authenticatorData,
      signature: data.signature,
      ...(userHandle === null ? {} : { userHandle }),
    },
    extensionResults,
  });
};

const abortReason = (signal: AbortSignal) =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

/** Keep conditional requests native so autofill and upgrades cannot open a modal sheet unprompted. */
export function installPasskeyBridge(invoke: InvokePasskeyCeremony) {
  if (typeof CredentialsContainer === "undefined" || typeof PublicKeyCredential === "undefined") {
    return;
  }
  const run = async (
    channel: PasskeyChannel,
    publicKey: unknown,
    signal: AbortSignal | undefined,
  ): Promise<PublicKeyCredential> => {
    if (signal?.aborted) throw abortReason(signal);
    const ceremony = invoke(channel, toCloneable(publicKey)).then(
      (value) => {
        const result = value as PasskeyCeremonyResult;
        if (!result.success) throw ceremonyError(result.error);
        return "attestationObject" in result.data
          ? credentialFromCreateResult(result.data)
          : credentialFromGetResult(result.data);
      },
      (error: unknown) => {
        throw error instanceof DOMException || error instanceof TypeError
          ? error
          : ceremonyError("NotAllowedError");
      },
    );
    if (!signal) return ceremony;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      ceremony.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };

  const container = CredentialsContainer.prototype;
  const nativeCreate = container.create;
  const nativeGet = container.get;
  const define = (target: object, key: string, value: unknown) =>
    Object.defineProperty(target, key, { value, configurable: true, writable: true });

  define(
    container,
    "create",
    function create(this: CredentialsContainer, options?: CreationOptions) {
      return options?.publicKey && options.mediation !== "conditional"
        ? run(PASSKEY_CREATE_CHANNEL, options.publicKey, options.signal)
        : Reflect.apply(nativeCreate, this, [options]);
    },
  );
  define(
    container,
    "get",
    function get(this: CredentialsContainer, options?: CredentialRequestOptions) {
      return options?.publicKey && options.mediation !== "conditional"
        ? run(PASSKEY_GET_CHANNEL, options.publicKey, options.signal)
        : Reflect.apply(nativeGet, this, [options]);
    },
  );

  define(PublicKeyCredential, "isUserVerifyingPlatformAuthenticatorAvailable", async () => true);
  define(PublicKeyCredential, "isConditionalMediationAvailable", async () => false);
  const nativeCapabilities = PublicKeyCredential.getClientCapabilities;
  if (typeof nativeCapabilities === "function") {
    define(PublicKeyCredential, "getClientCapabilities", async () => ({
      ...(await Reflect.apply(nativeCapabilities, PublicKeyCredential, [])),
      conditionalCreate: false,
      conditionalGet: false,
      hybridTransport: true,
      passkeyPlatformAuthenticator: true,
      userVerifyingPlatformAuthenticator: true,
    }));
  }
}

const PASSKEY_BRIDGE_INIT_TYPE = "__prismux_passkey_bridge_init__";
const ALLOWED_PASSKEY_CHANNELS: ReadonlySet<string> = new Set([
  PASSKEY_CREATE_CHANNEL,
  PASSKEY_GET_CHANNEL,
]);

function generateBridgeNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Generates an unprivileged main-world script that bridges WebAuthn ceremonies to the
 * isolated preload exclusively over a nonce-verified, privately transferred MessagePort.
 * Never exposes ipcRenderer or any global bridge handle to untrusted page scripts.
 */
export function buildMainWorldPasskeyBridgeScript(
  nonce: string,
  createChannel: string = PASSKEY_CREATE_CHANNEL,
  getChannel: string = PASSKEY_GET_CHANNEL,
): string {
  return `(() => {
    const expectedNonce = ${JSON.stringify(nonce)};
    const initType = ${JSON.stringify(PASSKEY_BRIDGE_INIT_TYPE)};
    const createChannel = ${JSON.stringify(createChannel)};
    const getChannel = ${JSON.stringify(getChannel)};
    const notAllowedMessage = ${JSON.stringify(NOT_ALLOWED_MESSAGE)};
    const domExceptionNames = new Set(${JSON.stringify([...DOM_EXCEPTION_NAMES])});
    let bridgePort = null;
    let nextRequestId = 1;
    const pending = new Map();

    const fromBase64Url = (value) => {
      const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
      const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
      return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
    };
    const toBase64Url = (buffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
    const ceremonyError = (name) =>
      name === "TypeError"
        ? new TypeError("The passkey request options are invalid.")
        : new DOMException(notAllowedMessage, domExceptionNames.has(name) ? name : "NotAllowedError");
    const toCloneable = (value) => {
      if (value instanceof ArrayBuffer) return value.slice(0);
      if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      }
      if (Array.isArray(value)) return value.map(toCloneable);
      if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
          Object.entries(value).flatMap(([key, member]) =>
            typeof member === "function" || member === undefined ? [] : [[key, toCloneable(member)]],
          ),
        );
      }
      return value;
    };
    const withValues = (target, values) => {
      for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(target, key, { value, enumerable: true, configurable: true });
      }
      return target;
    };
    const prfOutputs = (prf) => {
      const first = prf.results?.first;
      const second = prf.results?.second;
      return {
        ...(prf.enabled === undefined ? {} : { enabled: prf.enabled }),
        ...(first === undefined
          ? {}
          : {
              results: {
                first: fromBase64Url(first),
                ...(second === undefined ? {} : { second: fromBase64Url(second) }),
              },
            }),
      };
    };
    const extensionResultsJson = (results) =>
      JSON.parse(
        JSON.stringify(results, (_key, value) =>
          value instanceof ArrayBuffer ? toBase64Url(value) : value,
        ),
      );
    const makeCredential = (input) =>
      withValues(Object.create(PublicKeyCredential.prototype), {
        id: input.id,
        rawId: fromBase64Url(input.id),
        type: "public-key",
        authenticatorAttachment: input.authenticatorAttachment,
        response: input.response,
        getClientExtensionResults: () => input.extensionResults,
        toJSON: () => ({
          id: input.id,
          rawId: input.id,
          type: "public-key",
          ...(input.authenticatorAttachment === null
            ? {}
            : { authenticatorAttachment: input.authenticatorAttachment }),
          response: input.responseJson,
          clientExtensionResults: extensionResultsJson(input.extensionResults),
        }),
      });
    const credentialFromCreateResult = (data) => {
      const transports = [...data.transports];
      const publicKey = data.publicKey.length > 0 ? data.publicKey : null;
      const extensionResults = {
        ...(data.extensions.credProps ? { credProps: { ...data.extensions.credProps } } : {}),
        ...(data.extensions.prf ? { prf: prfOutputs(data.extensions.prf) } : {}),
        ...(data.extensions.largeBlob ? { largeBlob: { ...data.extensions.largeBlob } } : {}),
      };
      return makeCredential({
        id: data.credentialId,
        authenticatorAttachment: null,
        response: withValues(Object.create(AuthenticatorAttestationResponse.prototype), {
          clientDataJSON: fromBase64Url(data.clientDataJSON),
          attestationObject: fromBase64Url(data.attestationObject),
          getTransports: () => [...transports],
          getAuthenticatorData: () => fromBase64Url(data.authData),
          getPublicKey: () => (publicKey === null ? null : fromBase64Url(publicKey)),
          getPublicKeyAlgorithm: () => data.publicKeyAlgorithm,
        }),
        responseJson: {
          clientDataJSON: data.clientDataJSON,
          attestationObject: data.attestationObject,
          authenticatorData: data.authData,
          transports,
          ...(publicKey === null ? {} : { publicKey }),
          publicKeyAlgorithm: data.publicKeyAlgorithm,
        },
        extensionResults,
      });
    };
    const credentialFromGetResult = (data) => {
      const userHandle = data.userHandle !== null && data.userHandle.length > 0 ? data.userHandle : null;
      const { prf, largeBlob } = data.extensions ?? {};
      const extensionResults = {
        ...(prf ? { prf: prfOutputs(prf) } : {}),
        ...(largeBlob
          ? {
              largeBlob: {
                ...(largeBlob.blob === undefined ? {} : { blob: fromBase64Url(largeBlob.blob) }),
                ...(largeBlob.written === undefined ? {} : { written: largeBlob.written }),
              },
            }
          : {}),
      };
      return makeCredential({
        id: data.credentialId,
        authenticatorAttachment: null,
        response: withValues(Object.create(AuthenticatorAssertionResponse.prototype), {
          clientDataJSON: fromBase64Url(data.clientDataJSON),
          authenticatorData: fromBase64Url(data.authenticatorData),
          signature: fromBase64Url(data.signature),
          userHandle: userHandle === null ? null : fromBase64Url(userHandle),
        }),
        responseJson: {
          clientDataJSON: data.clientDataJSON,
          authenticatorData: data.authenticatorData,
          signature: data.signature,
          ...(userHandle === null ? {} : { userHandle }),
        },
        extensionResults,
      });
    };
    const abortReason = (signal) =>
      signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    const invokeOverPort = (channel, publicKey) => {
      if (!bridgePort) return Promise.reject(ceremonyError("NotAllowedError"));
      const id = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        bridgePort.postMessage({ nonce: expectedNonce, id, channel, publicKey });
      });
    };
    const installOnPrototypes = () => {
      if (typeof CredentialsContainer === "undefined" || typeof PublicKeyCredential === "undefined") {
        return;
      }
      const run = async (channel, publicKey, signal) => {
        if (signal?.aborted) throw abortReason(signal);
        const ceremony = invokeOverPort(channel, toCloneable(publicKey)).then(
          (result) => {
            if (!result || !result.success) throw ceremonyError(result?.error ?? "NotAllowedError");
            return "attestationObject" in result.data
              ? credentialFromCreateResult(result.data)
              : credentialFromGetResult(result.data);
          },
          (error) => {
            throw error instanceof DOMException || error instanceof TypeError
              ? error
              : ceremonyError("NotAllowedError");
          },
        );
        if (!signal) return ceremony;
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(abortReason(signal));
          signal.addEventListener("abort", onAbort, { once: true });
          ceremony.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
        });
      };
      const container = CredentialsContainer.prototype;
      const nativeCreate = container.create;
      const nativeGet = container.get;
      const define = (target, key, value) =>
        Object.defineProperty(target, key, { value, configurable: true, writable: true });
      define(container, "create", function create(options) {
        return options?.publicKey && options.mediation !== "conditional"
          ? run(createChannel, options.publicKey, options.signal)
          : Reflect.apply(nativeCreate, this, [options]);
      });
      define(container, "get", function get(options) {
        return options?.publicKey && options.mediation !== "conditional"
          ? run(getChannel, options.publicKey, options.signal)
          : Reflect.apply(nativeGet, this, [options]);
      });
      define(PublicKeyCredential, "isUserVerifyingPlatformAuthenticatorAvailable", async () => true);
      define(PublicKeyCredential, "isConditionalMediationAvailable", async () => false);
      const nativeCapabilities = PublicKeyCredential.getClientCapabilities;
      if (typeof nativeCapabilities === "function") {
        define(PublicKeyCredential, "getClientCapabilities", async () => ({
          ...(await Reflect.apply(nativeCapabilities, PublicKeyCredential, [])),
          conditionalCreate: false,
          conditionalGet: false,
          hybridTransport: true,
          passkeyPlatformAuthenticator: true,
          userVerifyingPlatformAuthenticator: true,
        }));
      }
    };
    const onHandshake = (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== initType || data.nonce !== expectedNonce) {
        return;
      }
      const port = event.ports && event.ports[0];
      if (!port) return;
      window.removeEventListener("message", onHandshake);
      bridgePort = port;
      bridgePort.onmessage = (msgEvent) => {
        const payload = msgEvent.data;
        if (!payload || typeof payload !== "object" || payload.nonce !== expectedNonce) return;
        const entry = pending.get(payload.id);
        if (!entry) return;
        pending.delete(payload.id);
        if (payload.ok) entry.resolve(payload.result);
        else entry.reject(ceremonyError(typeof payload.error === "string" ? payload.error : "NotAllowedError"));
      };
      if (typeof bridgePort.start === "function") bridgePort.start();
      installOnPrototypes();
    };
    window.addEventListener("message", onHandshake);
  })();`;
}

export interface IsolatedPasskeyBridgeOptions {
  readonly executeInMainWorld: (script: string) => Promise<unknown>;
  readonly invoke: InvokePasskeyCeremony;
  readonly targetWindow?: {
    postMessage(message: unknown, targetOrigin: string, transfer?: Transferable[]): void;
  };
}

/**
 * Installs the passkey bridge under `contextIsolation: true`: preload keeps `ipcRenderer`
 * strictly in the isolated world and talks to the unprivileged main-world WebAuthn shim
 * exclusively over a nonce-verified MessageChannel pair.
 */
export function installIsolatedPasskeyBridge(options: IsolatedPasskeyBridgeOptions): {
  readonly nonce: string;
  readonly port: MessagePort;
  readonly ready: Promise<void>;
} {
  const nonce = generateBridgeNonce();
  const channel = new MessageChannel();
  const { port1, port2 } = channel;
  port1.onmessage = (event: MessageEvent) => {
    const data = event.data as
      | {
          readonly nonce?: unknown;
          readonly id?: unknown;
          readonly channel?: unknown;
          readonly publicKey?: unknown;
        }
      | null
      | undefined;
    if (!data || typeof data !== "object") return;
    if (data.nonce !== nonce) return;
    if (typeof data.id !== "number" || !Number.isInteger(data.id)) return;
    if (typeof data.channel !== "string" || !ALLOWED_PASSKEY_CHANNELS.has(data.channel)) {
      port1.postMessage({ nonce, id: data.id, ok: false, error: "SecurityError" });
      return;
    }
    const passkeyChannel = data.channel as PasskeyChannel;
    void options
      .invoke(passkeyChannel, toCloneable(data.publicKey))
      .then(
        (result) => {
          port1.postMessage({ nonce, id: data.id, ok: true, result });
        },
        () => {
          port1.postMessage({ nonce, id: data.id, ok: false, error: "NotAllowedError" });
        },
      );
  };
  if (typeof port1.start === "function") {
    port1.start();
  }

  const target = options.targetWindow ?? window;
  const ready = options
    .executeInMainWorld(buildMainWorldPasskeyBridgeScript(nonce))
    .then(() => {
      target.postMessage({ type: PASSKEY_BRIDGE_INIT_TYPE, nonce }, "*", [port2]);
    })
    .catch(() => {
      port1.close();
      port2.close();
    });

  return { nonce, port: port1, ready };
}
