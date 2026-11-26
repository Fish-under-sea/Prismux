import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  LEGACY_T3_PROJECT_FILE_NAME,
  PRISMUX_PROJECT_FILE_NAME,
  type PrismuxProjectFile,
} from "@prismux/core-contracts";
import { PrismuxProjectFileFromJson } from "@prismux/core-shared/prismuxProjectFile";

const decodePrismuxProjectFileJson = Schema.decodeEffect(PrismuxProjectFileFromJson);

export class PrismuxProjectFileLoadError extends Schema.TaggedError<PrismuxProjectFileLoadError>()(
  "PrismuxProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${PRISMUX_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

export class PrismuxProjectFileLoader extends Context.Service<
  PrismuxProjectFileLoader,
  {
    /** Never fails; missing/unreadable/invalid files return none, with warnings for invalid files. */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<PrismuxProjectFile>>;
  }
>()("@prismux/server/project/PrismuxProjectFileLoader") {}

const logPrismuxProjectFileLoadError = (error: PrismuxProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const readProjectFileCandidate = Effect.fn("PrismuxProjectFileLoader.readCandidate")(function* (
    workspaceRoot: string,
    fileName: string,
  ): Effect.fn.Return<
    | { readonly _tag: "found"; readonly filePath: string; readonly raw: string }
    | { readonly _tag: "not-found" }
    | { readonly _tag: "read-error" }
  > {
    const filePath = path.join(workspaceRoot, fileName);
    return yield* fileSystem.readFileString(filePath).pipe(
      Effect.map((raw) => ({ _tag: "found" as const, filePath, raw })),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed({ _tag: "not-found" as const })
            : logPrismuxProjectFileLoadError(
                new PrismuxProjectFileLoadError({
                  operation: "read",
                  workspaceRoot,
                  filePath,
                  cause: error,
                }),
              ).pipe(Effect.as({ _tag: "read-error" as const })),
      }),
    );
  });

  const load: PrismuxProjectFileLoader["Service"]["load"] = Effect.fn(
    "PrismuxProjectFileLoader.load",
  )(function* (workspaceRoot) {
    const primary = yield* readProjectFileCandidate(workspaceRoot, PRISMUX_PROJECT_FILE_NAME);
    let loaded: { readonly filePath: string; readonly raw: string; readonly isLegacy: boolean };

    if (primary._tag === "found") {
      loaded = { filePath: primary.filePath, raw: primary.raw, isLegacy: false };
    } else if (primary._tag === "read-error") {
      return Option.none<PrismuxProjectFile>();
    } else {
      const legacy = yield* readProjectFileCandidate(workspaceRoot, LEGACY_T3_PROJECT_FILE_NAME);
      if (legacy._tag !== "found") {
        return Option.none<PrismuxProjectFile>();
      }
      yield* Effect.logWarning(
        `Loaded legacy ${LEGACY_T3_PROJECT_FILE_NAME} read-only; migrate this file to ${PRISMUX_PROJECT_FILE_NAME}.`,
      ).pipe(
        Effect.annotateLogs({
          workspaceRoot,
          filePath: legacy.filePath,
          recommendedFileName: PRISMUX_PROJECT_FILE_NAME,
          migrationFallback: "read-only",
        }),
      );
      loaded = { filePath: legacy.filePath, raw: legacy.raw, isLegacy: true };
    }

    return yield* decodePrismuxProjectFileJson(loaded.raw).pipe(
      Effect.asSome,
      Effect.catchTags({
        SchemaError: (error) =>
          logPrismuxProjectFileLoadError(
            new PrismuxProjectFileLoadError({
              operation: "decode",
              workspaceRoot,
              filePath: loaded.filePath,
              cause: error,
            }),
          ).pipe(Effect.as(Option.none<PrismuxProjectFile>())),
      }),
    );
  });

  return PrismuxProjectFileLoader.of({ load });
});

export const layer = Layer.effect(PrismuxProjectFileLoader, make);
