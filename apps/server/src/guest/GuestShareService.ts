import {
  GuestShareCreateError,
  type GuestShareCreateInput,
  type GuestShareCreateResult,
  type GuestRedeemRequest,
  type GuestStreamEvent,
  type GuestSubmitRequest,
  type ThreadId,
  type TurnItemId,
} from "@prismux/core-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

/** Disabled guest share access error retained only for non-overlap orchestration runtime layer compatibility. */
export class GuestShareAccessError extends Schema.TaggedError<GuestShareAccessError>()(
  "GuestShareAccessError",
  {
    reason: Schema.Literals([
      "invalid",
      "inactive",
      "used",
      "busy",
      "stale_page",
      "unavailable",
      "rejected",
      "empty",
      "too_many_files",
      "too_large",
      "unsupported_file",
      "files_busy",
    ]),
  },
) {
  override get message(): string {
    return "Guest sharing is disabled in local-only Prismux.";
  }
}

const disabledAccess = new GuestShareAccessError({ reason: "inactive" });

export class GuestShareService extends Context.Service<
  GuestShareService,
  {
    readonly create: (
      input: GuestShareCreateInput,
    ) => Effect.Effect<GuestShareCreateResult, GuestShareCreateError>;
    readonly redeem: (
      request: GuestRedeemRequest,
    ) => Effect.Effect<{ readonly sessionToken: string }, GuestShareAccessError>;
    readonly stream: (
      sessionToken: string,
    ) => Effect.Effect<Stream.Stream<GuestStreamEvent, GuestShareAccessError>, GuestShareAccessError>;
    readonly submit: (
      sessionToken: string,
      request: GuestSubmitRequest,
    ) => Effect.Effect<void, GuestShareAccessError>;
    readonly turnItemDetail: (
      sessionToken: string,
      turnItemId: TurnItemId,
    ) => Effect.Effect<unknown, GuestShareAccessError>;
    readonly attachment: (
      sessionToken: string,
      attachmentId: string,
    ) => Effect.Effect<{ readonly path: string; readonly mimeType: string }, GuestShareAccessError>;
    readonly deleteAttachment: (
      threadId: ThreadId,
      attachmentId: string,
    ) => Effect.Effect<void>;
  }
>()("@prismux/server/guest/GuestShareService") {}

const failCreateDisabled = Effect.fnUntraced(function* () {
  return yield* new GuestShareCreateError({ reason: "disabled" });
});
const failAccessDisabled = Effect.fnUntraced(function* () {
  return yield* disabledAccess;
});
const noopDeleteAttachment = Effect.fnUntraced(function* () {});

/** Guest sharing is permanently disabled in pure local-first Prismux. */
export const layer = Layer.succeed(
  GuestShareService,
  GuestShareService.of({
    create: failCreateDisabled,
    redeem: failAccessDisabled,
    stream: failAccessDisabled,
    submit: failAccessDisabled,
    turnItemDetail: failAccessDisabled,
    attachment: failAccessDisabled,
    deleteAttachment: noopDeleteAttachment,
  }),
);
