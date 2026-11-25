import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { LEGACY_T3_PROJECT_FILE_NAME, PRISMUX_PROJECT_FILE_NAME } from "@prismux/core-contracts";
import * as T3ProjectFileLoader from "./T3ProjectFileLoader.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(T3ProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "prismux-project-file-",
  });
});

const writeProjectFile = Effect.fn("writeProjectFile")(function* (
  cwd: string,
  contents: string,
  fileName: string = PRISMUX_PROJECT_FILE_NAME,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, fileName), contents).pipe(Effect.orDie);
});

it.layer(layerTest)("T3ProjectFileLoader", (it) => {
  describe("load", () => {
    it.effect("loads prismux.json as the primary project configuration", () =>
      Effect.gen(function* () {
        const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, '{ "iconPath": "assets/prismux.svg" }');

        const loaded = yield* loader.load(cwd);

        expect(Option.getOrUndefined(loaded)).toEqual({ iconPath: "assets/prismux.svg" });
      }),
    );

    it.effect("prefers prismux.json when both prismux.json and legacy t3.json exist", () =>
      Effect.gen(function* () {
        const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(
          cwd,
          '{ "iconPath": "assets/legacy.svg" }',
          LEGACY_T3_PROJECT_FILE_NAME,
        );
        yield* writeProjectFile(
          cwd,
          '{ "iconPath": "assets/prismux.svg" }',
          PRISMUX_PROJECT_FILE_NAME,
        );

        const loaded = yield* loader.load(cwd);

        expect(Option.getOrUndefined(loaded)).toEqual({ iconPath: "assets/prismux.svg" });
      }),
    );

    it.effect(
      "falls back read-only to legacy t3.json with a migration warning when prismux.json is absent",
      () =>
        Effect.gen(function* () {
          const warnings: Array<string> = [];
          const captureLogger = Logger.make(({ logLevel, message }) => {
            if (logLevel === "Warn") {
              warnings.push(String(message));
            }
          });
          const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* makeTempDir;
          yield* writeProjectFile(
            cwd,
            '{ "defaultThreadEnvMode": "worktree" }',
            LEGACY_T3_PROJECT_FILE_NAME,
          );

          const loaded = yield* loader
            .load(cwd)
            .pipe(Effect.provide(Logger.layer([captureLogger])));

          expect(Option.getOrUndefined(loaded)).toEqual({ defaultThreadEnvMode: "worktree" });
          expect(warnings.some((entry) => entry.includes("prismux.json"))).toBe(true);
          expect(yield* fileSystem.exists(path.join(cwd, PRISMUX_PROJECT_FILE_NAME))).toBe(false);
        }),
    );

    it.effect("returns none for malformed JSON without failing", () =>
      Effect.gen(function* () {
        const loader = yield* T3ProjectFileLoader.T3ProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, "{ not json");

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );
  });
});
