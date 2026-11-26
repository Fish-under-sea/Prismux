import * as NodeEvents from "node:events";

import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as NetService from "@prismux/core-shared/Net";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { HttpClient } from "effect/http";
import { vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as PrismuxDaemonService from "./PrismuxDaemonService.ts";

const WINDOW_ACTIVITY_EVENTS = [
  "minimize",
  "restore",
  "hide",
  "show",
  "focus",
  "blur",
  "closed",
] as const;

function makeFakeBrowserWindow() {
  const emitter = new NodeEvents.EventEmitter();
  const removeListenerSpy = vi.spyOn(emitter, "removeListener");
  let destroyed = false;
  return {
    window: Object.assign(emitter, {
      isDestroyed: () => destroyed,
      isVisible: () => !destroyed,
      isMinimized: () => false,
      isFocused: () => !destroyed,
    }),
    markDestroyed: () => {
      destroyed = true;
    },
    removeListenerSpy,
  };
}

describe("PrismuxDaemonService window listener lifecycle", () => {
  it.effect(
    "detaches listeners and releases closed BrowserWindow references immediately on 'closed' instead of retaining until app quit",
    () =>
      Effect.gen(function* () {
        const appEmitter = new NodeEvents.EventEmitter();
        const scope = yield* Scope.make();

        const testLayer = PrismuxDaemonService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
                platform: "win32",
                isPackaged: false,
                rootDir: "/tmp/prismux",
                resourcesPath: "/tmp/prismux/resources",
                dirname: "/tmp/prismux/dist",
                path: {
                  join: (...parts: string[]) => parts.join("/"),
                  resolve: (...parts: string[]) => parts.join("/"),
                  dirname: (p: string) => p,
                },
              } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]),
              FileSystem.layerNoop({}),
              Layer.mock(NetService.NetService, {}),
              Layer.mock(SecureRandom.SecureRandom, {}),
              Layer.succeed(
                HttpClient.HttpClient,
                HttpClient.make(() => Effect.die("unexpected HTTP request")),
              ),
              Layer.succeed(HostProcess.ExecutablePath, process.execPath),
              Layer.succeed(HostProcess.Environment, {}),
              Layer.succeed(ElectronApp.ElectronApp, {
                on: (event: string, listener: (...args: unknown[]) => void) =>
                  Effect.acquireRelease(
                    Effect.sync(() => {
                      appEmitter.on(event, listener);
                    }),
                    () =>
                      Effect.sync(() => {
                        appEmitter.removeListener(event, listener);
                      }),
                  ),
                getAppMetrics: Effect.succeed([]),
              } as unknown as ElectronApp.ElectronApp["Service"]),
              Layer.succeed(ElectronWindow.ElectronWindow, {
                currentMainOrFirst: Effect.succeedNone,
              } as unknown as ElectronWindow.ElectronWindow["Service"]),
            ),
          ),
        );

        yield* Layer.buildWithScope(testLayer, scope);

        const first = makeFakeBrowserWindow();
        const second = makeFakeBrowserWindow();

        appEmitter.emit("browser-window-created", {}, first.window);
        appEmitter.emit("browser-window-created", {}, second.window);

        for (const eventName of WINDOW_ACTIVITY_EVENTS) {
          assert.equal(first.window.listenerCount(eventName), 1);
          assert.equal(second.window.listenerCount(eventName), 1);
        }

        // Closing the first window must run and remove its cleanup immediately.
        first.window.emit("closed");
        for (const eventName of WINDOW_ACTIVITY_EVENTS) {
          assert.equal(
            first.window.listenerCount(eventName),
            0,
            `expected ${eventName} listener detached immediately on window closed`,
          );
          assert.equal(second.window.listenerCount(eventName), 1);
        }

        const firstRemoveCallsOnClose = first.removeListenerSpy.mock.calls.length;
        assert.equal(firstRemoveCallsOnClose, WINDOW_ACTIVITY_EVENTS.length);

        // Closing the service scope cleans up remaining open windows without revisiting already-closed ones.
        yield* Scope.close(scope, Exit.void);
        assert.equal(
          first.removeListenerSpy.mock.calls.length,
          firstRemoveCallsOnClose,
          "closed window cleanup must not remain retained until shutdown finalizer",
        );
        for (const eventName of WINDOW_ACTIVITY_EVENTS) {
          assert.equal(second.window.listenerCount(eventName), 0);
        }
      }),
  );
});
