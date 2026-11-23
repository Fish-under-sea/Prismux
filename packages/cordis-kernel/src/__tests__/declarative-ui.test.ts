import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { InstalledPluginRecord, PluginManifest } from "@prismux/protocol";
import {
  CordisPluginHost,
  DECLARATIVE_UI_MODE,
  DECLARATIVE_UI_NODE_TYPES,
  DeclarativeAtomStore,
  DeclarativeUiValidationError,
  EncryptedPluginCredentialStore,
  assertJsonSafeProps,
  normalizeAtomPersistScope,
  validateDeclarativePanelSpec,
  validateDeclarativeUiTree,
  type CordisPluginModule,
  type DeclarativeAtomStorage,
  type DeclarativeAtomValue,
  type DeclarativeUiNode,
  type DeclarativeUiPanelSpec
} from "../index.js";

function buildFullValidSpec(): DeclarativeUiPanelSpec {
  return {
    ui: DECLARATIVE_UI_MODE,
    schemaVersion: 1,
    title: "示例声明式面板",
    description: "覆盖全部 8 类安全液态玻璃原语与持久化 atom",
    atoms: [
      { key: "enabled", type: "boolean", defaultValue: true, persist: true },
      { key: "endpoint", type: "string", defaultValue: "https://example.com", persist: true },
      { key: "retryLimit", type: "number", defaultValue: 3, persist: false }
    ],
    actions: [
      { id: "panel:save", label: "保存配置", mutatesAtoms: ["endpoint"] },
      { id: "panel:reset", label: "重置", confirm: true, confirmMessage: "确认重置？" }
    ],
    root: {
      type: "Stack",
      direction: "column",
      gap: "md",
      children: [
        {
          type: "Card",
          title: "基础连接",
          subtitle: "受控 JSON-safe 原语",
          tone: "accent",
          children: [
            {
              type: "Stack",
              direction: "row",
              gap: "sm",
              align: "center",
              justify: "between",
              children: [
                { type: "Text", content: "连接状态", variant: "heading" },
                { type: "Badge", label: "0 Token 安全层", variant: "success" }
              ]
            },
            {
              type: "Switch",
              label: "启用自动同步",
              description: "仅同步公开配置",
              atomKey: "enabled"
            },
            {
              type: "Input",
              label: "服务地址",
              atomKey: "endpoint",
              inputType: "url",
              placeholder: "https://..."
            },
            {
              type: "Button",
              label: "保存配置",
              actionId: "panel:save",
              variant: "primary",
              payload: { reason: "manual", tags: ["safe", 1, true, null] }
            }
          ]
        },
        {
          type: "Table",
          caption: "通道概览",
          columns: [
            { key: "name", label: "名称" },
            { key: "latency", label: "延迟 (ms)", align: "right", mono: true },
            { key: "ok", label: "健康", align: "center" }
          ],
          rows: [
            { name: "primary", latency: 18, ok: true },
            { name: "fallback", latency: null, ok: false }
          ]
        }
      ]
    }
  };
}

test("validateDeclarativePanelSpec & validateDeclarativeUiTree parse all 8 primitives and return defensive clones", () => {
  assert.deepEqual(DECLARATIVE_UI_NODE_TYPES, [
    "Stack",
    "Card",
    "Text",
    "Badge",
    "Button",
    "Switch",
    "Input",
    "Table"
  ]);

  const inputSpec = buildFullValidSpec();
  const validated = validateDeclarativePanelSpec(inputSpec);
  assert.equal(validated.ui, "components");
  assert.equal(validated.atoms?.length, 3);
  assert.equal(validated.actions?.length, 2);
  assert.equal(validated.root.type, "Stack");
  assert.notEqual(validated.root, inputSpec.root, "validator must return defensive clone");

  const treeOnly = validateDeclarativeUiTree(inputSpec.root);
  assert.equal(treeOnly.type, "Stack");
});

test("Declarative UI validators reject unknown nodes, non-JSON-safe props, prototype pollution, HTML/SVG/CSS injection, and excess depth", () => {
  // 1. Unknown node types
  for (const badType of ["Html", "Svg", "Script", "Iframe", "div", "RawComponent"]) {
    assert.throws(
      () => validateDeclarativeUiTree({ type: badType, content: "x" }),
      (err: unknown) =>
        err instanceof DeclarativeUiValidationError && err.code === "UNKNOWN_NODE_TYPE"
    );
  }

  // 2. Non-JSON-safe props (functions, Symbol values & keys, BigInt, NaN, Infinity, Date, circular)
  assert.throws(
    () => assertJsonSafeProps({ cb: () => "boom" }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "NON_JSON_SAFE_VALUE"
  );
  assert.throws(
    () => assertJsonSafeProps({ sym: Symbol("secret") }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "NON_JSON_SAFE_VALUE"
  );
  assert.throws(
    () => assertJsonSafeProps({ [Symbol("hidden")]: "x" }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "NON_JSON_SAFE_VALUE"
  );
  assert.throws(
    () => assertJsonSafeProps({ count: BigInt(42) }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "NON_JSON_SAFE_VALUE"
  );
  assert.throws(
    () => assertJsonSafeProps({ ratio: Number.NaN }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "NON_JSON_SAFE_VALUE"
  );
  assert.throws(
    () => assertJsonSafeProps({ createdAt: new Date() }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "NON_JSON_SAFE_VALUE"
  );
  const cyclic: Record<string, unknown> = { ok: 1 };
  cyclic["self"] = cyclic;
  assert.throws(
    () => assertJsonSafeProps(cyclic),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "CIRCULAR_REFERENCE"
  );

  // 3. Prototype pollution keys (__proto__, constructor, prototype)
  const protoPayload = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
  assert.throws(
    () => assertJsonSafeProps(protoPayload),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "PROTOTYPE_POLLUTION_KEY"
  );
  assert.throws(
    () => assertJsonSafeProps({ constructor: { prototype: { pwn: 1 } } }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "PROTOTYPE_POLLUTION_KEY"
  );
  const protoNode = JSON.parse(
    '{"type":"Text","content":"ok","__proto__":{"polluted":true}}'
  ) as unknown;
  assert.throws(
    () => validateDeclarativeUiTree(protoNode),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "PROTOTYPE_POLLUTION_KEY"
  );
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);

  // 4. Raw HTML / SVG / script / CSS / inline DOM event handler injection keys
  const injectionPayloads: unknown[] = [
    { type: "Text", content: "hi", dangerouslySetInnerHTML: { __html: "<img src=x onerror=1>" } },
    { type: "Card", title: "x", html: "<script>alert(1)</script>" },
    { type: "Card", title: "x", svg: "<svg onload=alert(1)/>" },
    { type: "Card", title: "x", rawCss: "body { display:none }" },
    { type: "Card", title: "x", style: { color: "red" } },
    { type: "Button", label: "Go", actionId: "go", onClick: "alert(1)" },
    { type: "Button", label: "Go", actionId: "go", payload: { rawHtml: "<b>x</b>" } }
  ];
  for (const payload of injectionPayloads) {
    assert.throws(
      () => validateDeclarativeUiTree(payload),
      (err: unknown) =>
        err instanceof DeclarativeUiValidationError && err.code === "FORBIDDEN_INJECTION_KEY"
    );
  }

  // 5. Exceeding nesting depth limit, duplicate sibling ids, and metered byte budget
  let deepNode: DeclarativeUiNode = { type: "Text", content: "leaf" };
  for (let i = 0; i < 15; i += 1) {
    deepNode = { type: "Stack", children: [deepNode] };
  }
  assert.throws(
    () => validateDeclarativeUiTree(deepNode, { maxDepth: 8 }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "MAX_DEPTH_EXCEEDED"
  );

  assert.throws(
    () =>
      validateDeclarativeUiTree({
        type: "Stack",
        children: [
          { type: "Text", id: "dup-id", content: "a" },
          { type: "Text", id: "dup-id", content: "b" }
        ]
      }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "DUPLICATE_SIBLING_ID"
  );

  assert.throws(
    () =>
      validateDeclarativeUiTree(
        {
          type: "Stack",
          children: [
            { type: "Text", content: "a".repeat(400) },
            { type: "Text", content: "b".repeat(400) }
          ]
        },
        { maxTreeBytes: 512 }
      ),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "MAX_TREE_BYTES_EXCEEDED"
  );

  // Scoped & versioned atom migration (Orca declarative-atoms alignment)
  assert.equal(normalizeAtomPersistScope(undefined), "plugin");
  assert.equal(normalizeAtomPersistScope(true), "plugin");
  assert.equal(normalizeAtomPersistScope(false), "memory");
  assert.equal(normalizeAtomPersistScope("workspace"), "workspace");

  const versionedSpec = validateDeclarativePanelSpec({
    ui: "components",
    atoms: [
      { key: "theme", type: "string", defaultValue: "glass", persist: "workspace", version: 2 },
      { key: "ephemeral", type: "number", defaultValue: 0, persist: "memory" }
    ],
    root: { type: "Text", content: "ok" }
  });
  const resetStore = new DeclarativeAtomStore(versionedSpec.atoms, {
    theme: { version: 1, value: "legacy-light" },
    ephemeral: 99
  });
  assert.equal(resetStore.get("theme"), "glass", "version mismatch without migrator resets to default");
  assert.equal(resetStore.get("ephemeral"), 0, "memory-scoped atom ignores persisted snapshot");

  const migratedStore = new DeclarativeAtomStore(
    versionedSpec.atoms,
    { theme: { version: 1, value: "legacy-dark" } },
    undefined,
    (_key, stored, fromV, toV) => (fromV === 1 && toV === 2 && stored === "legacy-dark" ? "dark-v2" : undefined)
  );
  assert.equal(migratedStore.get("theme"), "dark-v2");
  resetStore.dispose();
  migratedStore.dispose();

  // 6. Atom/action cross-check & invalid ui mode
  assert.throws(
    () =>
      validateDeclarativePanelSpec({
        ui: "raw-html",
        root: { type: "Text", content: "nope" }
      }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "UNSUPPORTED_UI_MODE"
  );
  assert.throws(
    () =>
      validateDeclarativePanelSpec({
        ui: "components",
        atoms: [{ key: "count", type: "number", defaultValue: 1 }],
        root: { type: "Switch", label: "Wrong atom type", atomKey: "count" }
      }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "INVALID_ATOM_DEFINITION"
  );
  assert.throws(
    () =>
      validateDeclarativePanelSpec({
        ui: "components",
        actions: [{ id: "allowed:action" }],
        root: { type: "Button", label: "Bad", actionId: "undeclared:action" }
      }),
    (err: unknown) =>
      err instanceof DeclarativeUiValidationError && err.code === "INVALID_ACTION_DEFINITION"
  );
});

test("CordisPluginHost mounts declarative UI panels via ctx.effect() with zero residual state on unmount or apply rollback", async () => {
  const workDir = mkdtempSync(join(tmpdir(), "prismux-decl-host-"));
  try {
    const credStore = new EncryptedPluginCredentialStore({
      dataDir: workDir,
      masterKey: "declarative-ui-unit-test-master-key"
    });

    const persistedStore = new Map<string, Record<string, DeclarativeAtomValue>>();
    const atomStorage: DeclarativeAtomStorage = {
      load(pluginId, panelId) {
        return persistedStore.get(`${pluginId}:${panelId}`);
      },
      save(pluginId, panelId, atoms) {
        persistedStore.set(`${pluginId}:${panelId}`, { ...atoms });
      }
    };

    const adapterEvents: string[] = [];
    const uiHost = new CordisPluginHost("ui", {
      adapters: {
        declarativeAtomStorage: atomStorage,
        onRegisterDeclarativePanel(entry) {
          adapterEvents.push(`register:${entry.panelId}`);
          return () => {
            adapterEvents.push(`dispose:${entry.panelId}`);
          };
        }
      }
    });

    // Manifest with invalid ui mode must fail validation
    assert.equal(
      uiHost.validateManifest({
        id: "bad-ui-manifest",
        version: "1.0.0",
        realms: ["ui"],
        permissions: ["ui:panel"],
        modelVisible: false,
        ui: "iframe"
      } as unknown as PluginManifest),
      false
    );

    const manifest = {
      id: "decl-demo",
      version: "1.0.0",
      realms: ["ui"],
      permissions: ["ui:panel"],
      modelVisible: false,
      ui: "components"
    } as PluginManifest;
    assert.equal(uiHost.validateManifest(manifest), true);

    const record: InstalledPluginRecord = {
      manifest,
      packageName: "prismux-plugin-decl-demo",
      distribution: "managed",
      enabled: true,
      installPath: join(workDir, "plugins", "decl-demo"),
      installedAt: Date.now()
    };

    const observedActions: Array<{ actionId: string; endpoint: DeclarativeAtomValue | undefined }> = [];
    const observedAtomChanges: Array<{ key: string; value: DeclarativeAtomValue }> = [];
    let endpointSubCalls = 0;

    const mod: CordisPluginModule = {
      manifest,
      apply(ctx) {
        const handle = ctx.registerDeclarativePanel("decl-main", buildFullValidSpec(), {
          onAction(invocation) {
            observedActions.push({
              actionId: invocation.actionId,
              endpoint: invocation.atomsSnapshot["endpoint"]
            });
          },
          onAtomChange(key, value) {
            observedAtomChanges.push({ key, value });
          }
        });
        // Subscribe without manually unsubscribing — ctx.effect() MUST clean it up on unload!
        handle.subscribeAtom("endpoint", () => {
          endpointSubCalls += 1;
        });
        ctx.registerRoute?.("GET", "/plugins/decl-demo/info", () => ({ ok: true }));
        ctx.onHook?.("Notification", () => undefined);
      }
    };

    await uiHost.mountPlugin(record, mod, credStore.openForPlugin("decl-demo"));

    assert.equal(uiHost.getDeclarativePanels("decl-demo").length, 1);
    assert.deepEqual(uiHost.getDeclarativeRuntimeCounts("decl-demo"), {
      declarativePanels: 1,
      atomSubscriptions: 2, // 1 onAtomChange + 1 subscribeAtom("endpoint")
      actionHandlers: 1
    });
    assert.equal(uiHost.getActiveResourceCounts().panels, 1);
    assert.equal(uiHost.getActiveResourceCounts().routes, 1);
    assert.equal(uiHost.getActiveResourceCounts().hooks, 1);
    assert.ok(uiHost.getActiveResourceCounts().effects >= 3);

    // Mutate atom -> persists only persist!==false atoms, notifies subscribers
    uiHost.setDeclarativePanelAtom("decl-main", "endpoint", "https://prismux.local");
    uiHost.setDeclarativePanelAtom("decl-main", "retryLimit", 5);
    assert.equal(endpointSubCalls, 1);
    assert.equal(observedAtomChanges.length, 2);
    assert.deepEqual(persistedStore.get("decl-demo:decl-main"), {
      enabled: true,
      endpoint: "https://prismux.local"
    });

    // Dispatch controlled action
    await uiHost.dispatchDeclarativeAction("decl-main", "panel:save", { source: "test" });
    assert.deepEqual(observedActions, [
      { actionId: "panel:save", endpoint: "https://prismux.local" }
    ]);

    // Unmount -> ZERO residual panels, subscriptions, handlers, routes, hooks, effects
    await uiHost.unmountPlugin("decl-demo");
    assert.deepEqual(uiHost.getActiveResourceCounts(), {
      routes: 0,
      hooks: 0,
      panels: 0,
      styles: 0,
      timers: 0,
      effects: 0
    });
    assert.deepEqual(uiHost.getDeclarativeRuntimeCounts(), {
      declarativePanels: 0,
      atomSubscriptions: 0,
      actionHandlers: 0
    });
    assert.equal(uiHost.getDeclarativePanels().length, 0);
    assert.deepEqual(adapterEvents, ["register:decl-main", "dispose:decl-main"]);

    // Remounting hydrates persisted atoms cleanly
    await uiHost.mountPlugin(record, mod, credStore.openForPlugin("decl-demo"));
    assert.equal(
      uiHost.getDeclarativePanelAtoms("decl-main")["endpoint"],
      "https://prismux.local"
    );
    assert.equal(uiHost.getDeclarativePanelAtoms("decl-main")["retryLimit"], 3);
    await uiHost.uninstallPlugin("decl-demo");
    assert.deepEqual(uiHost.getDeclarativeRuntimeCounts(), {
      declarativePanels: 0,
      atomSubscriptions: 0,
      actionHandlers: 0
    });

    // Mid-apply failure after registering a declarative panel rolls back cleanly
    const flakyManifest: PluginManifest = {
      id: "decl-flaky",
      version: "0.1.0",
      realms: ["ui"],
      permissions: ["ui:panel"],
      modelVisible: false
    };
    await assert.rejects(
      () =>
        uiHost.mountPlugin(
          {
            manifest: flakyManifest,
            packageName: "prismux-plugin-decl-flaky",
            distribution: "managed",
            enabled: true,
            installPath: join(workDir, "plugins", "decl-flaky"),
            installedAt: Date.now()
          },
          {
            manifest: flakyManifest,
            apply(ctx) {
              const handle = ctx.registerDeclarativePanel("flaky-panel", buildFullValidSpec(), {
                onAction: () => undefined
              });
              handle.subscribeAtom("enabled", () => undefined);
              throw new Error("Simulated declarative apply failure");
            }
          } as CordisPluginModule,
          credStore.openForPlugin("decl-flaky")
        ),
      /Simulated declarative apply failure/
    );

    assert.deepEqual(uiHost.getActiveResourceCounts(), {
      routes: 0,
      hooks: 0,
      panels: 0,
      styles: 0,
      timers: 0,
      effects: 0
    });
    assert.deepEqual(uiHost.getDeclarativeRuntimeCounts(), {
      declarativePanels: 0,
      atomSubscriptions: 0,
      actionHandlers: 0
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
