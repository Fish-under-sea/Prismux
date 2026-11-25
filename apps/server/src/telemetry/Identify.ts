import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as HostProcess from "@prismux/core-shared/HostProcess";

const IdTokenClaims = Schema.Struct({
  "https://api.openai.com/auth": Schema.Struct({ user_id: Schema.NonEmptyString }),
});
const decodeIdTokenClaims = Schema.decodeUnknownOption(Schema.fromJsonString(IdTokenClaims));

export const TelemetryOwnerSource = Schema.Literals(["connect", "openai", "claude", "device"]);
export type TelemetryOwnerSource = typeof TelemetryOwnerSource.Type;

export interface TelemetryOwner {
  readonly source: TelemetryOwnerSource;
  readonly ownerId: string;
}

export const TelemetryIdentitySource = Schema.Literals(["codex", "claude", "anonymous"]);
export type TelemetryIdentitySource = typeof TelemetryIdentitySource.Type;

export class TelemetryAnonymousIdGenerationError extends Schema.TaggedError<TelemetryAnonymousIdGenerationError>()(
  "TelemetryAnonymousIdGenerationError",
  {
    source: Schema.Literal("anonymous"),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to generate anonymous telemetry identity for '${this.filePath}'.`;
  }
}

export class TelemetryAnonymousIdPersistenceError extends Schema.TaggedError<TelemetryAnonymousIdPersistenceError>()(
  "TelemetryAnonymousIdPersistenceError",
  {
    source: Schema.Literal("anonymous"),
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to persist anonymous telemetry identity at '${this.filePath}'.`;
  }
}

/**
 * Pure parser for the OpenAI account id claim inside a ChatGPT id_token.
 * Retained as a pure helper; never called for telemetry in Prismux.
 */
export const openAiUserId = (idToken: string) => {
  const payload = Base64Url.decodeString(idToken.split(".")[1] ?? "");
  return Result.isSuccess(payload)
    ? Option.map(
        decodeIdTokenClaims(payload.success),
        (claims) => claims["https://api.openai.com/auth"].user_id,
      )
    : Option.none<string>();
};

/**
 * Prismux hard-disables upstream telemetry identity collection and cross-tool
 * account harvesting. Never read `~/.codex/auth.json`, `~/.claude.json`, or
 * create/read `<stateDir>/anonymous-id` for telemetry.
 */
export const getTelemetryIdentityForHome = Effect.fn("getTelemetryIdentityForHome")(function* (
  _homeDirectory: string,
) {
  return {
    distinctId: null as string | null,
    installId: null as string | null,
  };
});

export const getTelemetryIdentity = Effect.flatMap(
  HostProcess.HomeDirectory,
  getTelemetryIdentityForHome,
);

/**
 * Prismux hard-disables owner harvesting (`CLOUD_LINKED_USER_ID`, Codex
 * `~/.codex/auth.json`, Claude `~/.claude.json`) so local AI accounts are never
 * silently linked or reported.
 */
export const getServerOwnersForHome = Effect.fn("getServerOwnersForHome")(function* (
  _homeDirectory: string,
): Effect.fn.Return<ReadonlyArray<TelemetryOwner>> {
  return [];
});

export const getServerOwners = Effect.flatMap(HostProcess.HomeDirectory, getServerOwnersForHome);
