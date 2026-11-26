// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as TestProviderHost from "@prismux/provider-testing/TestProviderHost";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { AcpRegistrySettings } from "../settings.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import { probeAcpRegistryConfiguration } from "./probe.ts";
import {
  clearPackagedDshDesktopCacheForTests,
  findDeepSeekCliArgStart,
  hasAsarEntrySync,
  isDeepSeekHarnessSpawn,
  isPlaceholderDshVersion,
  readAsarTextEntrySync,
  resolveDshInstalledVersion,
  resolveLocalAcpSpawn,
  resolvePackagedDshDesktopSpawn,
  selectPreferredDshVersion,
  unwrapWindowsLocalCmdShim,
  type LocalAcpResolutionFs,
} from "./dshLocal.ts";

const decodeAcpRegistrySettings = Schema.decodeSync(AcpRegistrySettings);

function makeMemoryFs(input: {
  readonly files?: Readonly<Record<string, string>>;
  readonly directories?: ReadonlyArray<string>;
  readonly asarEntries?: Readonly<Record<string, ReadonlyArray<string>>>;
}): LocalAcpResolutionFs {
  const files = new Map(
    Object.entries(input.files ?? {}).map(([k, v]) => [k.toLowerCase(), v] as const),
  );
  const dirs = new Set((input.directories ?? []).map((d) => d.toLowerCase()));
  const asars = new Map(
    Object.entries(input.asarEntries ?? {}).map(
      ([k, v]) => [k.toLowerCase(), new Set(v.map((entry) => entry.toLowerCase()))] as const,
    ),
  );
  return {
    isFile: (filePath) => files.has(filePath.toLowerCase()),
    isDirectory: (dirPath) => dirs.has(dirPath.toLowerCase()),
    readTextFile: (filePath) => files.get(filePath.toLowerCase()),
    hasAsarEntry: (asarPath, relativeEntry) =>
      asars.get(asarPath.toLowerCase())?.has(relativeEntry.toLowerCase()) ?? false,
    listDirectory: (dirPath) => {
      const normalized = dirPath.replace(/[\\/]+$/, "").toLowerCase();
      const seen = new Set<string>();
      for (const key of files.keys()) {
        const lastSep = Math.max(key.lastIndexOf("\\"), key.lastIndexOf("/"));
        if (lastSep > 0 && key.slice(0, lastSep) === normalized) {
          seen.add(key.slice(lastSep + 1));
        }
      }
      return Array.from(seen);
    },
  };
}

function writeMinimalAsar(asarPath: string, headerJson: Record<string, unknown>): void {
  const jsonBytes = Buffer.from(JSON.stringify(headerJson), "utf8");
  const alignedJsonSize = Math.ceil(jsonBytes.length / 4) * 4;
  const headerSize = alignedJsonSize + 8;
  const header = Buffer.alloc(16 + alignedJsonSize);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(headerSize, 4);
  header.writeUInt32LE(headerSize - 4, 8);
  header.writeUInt32LE(jsonBytes.length, 12);
  jsonBytes.copy(header, 16);
  NodeFS.writeFileSync(asarPath, header);
}

function writeAsarWithPayloads(
  asarPath: string,
  entries: Readonly<Record<string, string>>,
): void {
  const root: { files: Record<string, unknown> } = { files: {} };
  const chunks: Array<Buffer> = [];
  let offset = 0;
  for (const [relativePath, content] of Object.entries(entries)) {
    const buf = Buffer.from(content, "utf8");
    const segments = relativePath.split("/");
    let cursor = root.files;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const seg = segments[index]!;
      if (!cursor[seg] || typeof cursor[seg] !== "object") {
        cursor[seg] = { files: {} };
      }
      cursor = (cursor[seg] as { files: Record<string, unknown> }).files;
    }
    cursor[segments.at(-1)!] = { size: buf.length, offset: String(offset) };
    chunks.push(buf);
    offset += buf.length;
  }
  const jsonBytes = Buffer.from(JSON.stringify(root), "utf8");
  const alignedJsonSize = Math.ceil(jsonBytes.length / 4) * 4;
  const headerSize = alignedJsonSize + 8;
  const header = Buffer.alloc(16 + alignedJsonSize);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(headerSize, 4);
  header.writeUInt32LE(headerSize - 4, 8);
  header.writeUInt32LE(jsonBytes.length, 12);
  jsonBytes.copy(header, 16);
  NodeFS.writeFileSync(asarPath, Buffer.concat([header, ...chunks]));
}

describe("dshLocal", () => {
  it("auto-discovers packaged DSH NEXT on Windows when bare dsh is not on PATH", () => {
    const exePath = "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\DSH NEXT.exe";
    const asarPath = "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\resources\\app.asar";
    const lastHomePath = "C:\\Users\\Fish\\AppData\\Roaming\\DSH NEXT\\home\\desktop-next-last-home.json";
    const fs = makeMemoryFs({
      files: {
        [exePath]: "",
        [lastHomePath]: JSON.stringify({ home: "D:\\CustomDshHome" }),
      },
      directories: ["D:\\CustomDshHome"],
      asarEntries: {
        [asarPath]: ["lib/desktop-cli.js"],
      },
    });

    const resolved = resolveLocalAcpSpawn({
      commandPath: "dsh",
      commandArgs: ["acp"],
      platform: "win32",
      env: {
        PATH: "C:\\Windows\\System32",
        LOCALAPPDATA: "C:\\Users\\Fish\\AppData\\Local",
        APPDATA: "C:\\Users\\Fish\\AppData\\Roaming",
        DSH_DESKTOP_DEFAULT_PROFILE: "desktop",
        electron_run_as_node: "0",
      },
      resolveExecutable: () => undefined,
      fs,
    });

    expect(resolved).toEqual({
      command: exePath,
      args: [
        "--expose-internals",
        `${asarPath}\\lib\\desktop-cli.js`,
        "acp",
      ],
      env: {
        PATH: "C:\\Windows\\System32",
        LOCALAPPDATA: "C:\\Users\\Fish\\AppData\\Local",
        APPDATA: "C:\\Users\\Fish\\AppData\\Roaming",
        ELECTRON_RUN_AS_NODE: "1",
        DSH_HOME: "D:\\CustomDshHome",
      },
    });
  });

  it("preserves an explicit user DSH_HOME override when resolving packaged DSH NEXT", () => {
    const exePath = "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\DSH NEXT.exe";
    const asarPath = "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\resources\\app.asar";
    const fs = makeMemoryFs({
      files: { [exePath]: "" },
      asarEntries: { [asarPath]: ["lib/desktop-cli.js"] },
    });

    const resolved = resolvePackagedDshDesktopSpawn({
      commandArgs: ["acp"],
      platform: "win32",
      env: {
        LOCALAPPDATA: "C:\\Users\\Fish\\AppData\\Local",
        DSH_HOME: "E:\\PinnedHome",
      },
      fs,
    });

    expect(resolved?.env.DSH_HOME).toBe("E:\\PinnedHome");
    expect(resolved?.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("unwraps standard npm Node .cmd shims into direct node.exe shell:false launches", () => {
    const shimPath = "C:\\Users\\Fish\\AppData\\Roaming\\npm\\dsh.cmd";
    const scriptPath =
      "C:\\Users\\Fish\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
    const nodeExe = "C:\\Program Files\\nodejs\\node.exe";
    const npmShim = [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ") ELSE (",
      '  SET "_prog=node"',
      "  SET PATHEXT=%PATHEXT:;.JS;=;%",
      ")",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ].join("\r\n");

    const fs = makeMemoryFs({
      files: {
        [shimPath]: npmShim,
        [scriptPath]: "#!/usr/bin/env node\n",
      },
    });
    const resolved = resolveLocalAcpSpawn({
      commandPath: "dsh",
      commandArgs: ["acp"],
      platform: "win32",
      env: { PATH: "C:\\Users\\Fish\\AppData\\Roaming\\npm" },
      resolveExecutable: (cmd) => (cmd === "node" ? nodeExe : cmd === "dsh" ? shimPath : undefined),
      fs,
    });

    expect(resolved).toEqual({
      command: nodeExe,
      args: [scriptPath, "acp"],
      env: { PATH: "C:\\Users\\Fish\\AppData\\Roaming\\npm" },
    });
  });

  it("discovers and unwraps %APPDATA%\\npm\\dsh.cmd even when %APPDATA%\\npm is missing from PATH", () => {
    const shimPath = "C:\\Users\\Fish\\AppData\\Roaming\\npm\\dsh.cmd";
    const scriptPath =
      "C:\\Users\\Fish\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
    const nodeExe = "C:\\Program Files\\nodejs\\node.exe";
    const npmShim = [
      "@ECHO off",
      "GOTO start",
      ":find_dp0",
      "SET dp0=%~dp0",
      "EXIT /b",
      ":start",
      "SETLOCAL",
      "CALL :find_dp0",
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ") ELSE (",
      '  SET "_prog=node"',
      "  SET PATHEXT=%PATHEXT:;.JS;=;%",
      ")",
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ].join("\r\n");
    const fs = makeMemoryFs({
      files: {
        [shimPath]: npmShim,
        [scriptPath]: "#!/usr/bin/env node\n",
      },
    });
    const resolved = resolveLocalAcpSpawn({
      commandPath: "dsh",
      commandArgs: ["acp"],
      platform: "win32",
      env: {
        PATH: "C:\\Windows\\System32",
        APPDATA: "C:\\Users\\Fish\\AppData\\Roaming",
      },
      resolveExecutable: (cmd) => (cmd === "node" ? nodeExe : undefined),
      fs,
    });

    expect(resolved).toEqual({
      command: nodeExe,
      args: [scriptPath, "acp"],
      env: {
        PATH: "C:\\Windows\\System32",
        APPDATA: "C:\\Users\\Fish\\AppData\\Roaming",
      },
    });
  });

  it("unwraps pnpm Node .cmd shims and DSH Desktop internal dsh.cmd shims safely", () => {
    const pnpmShimPath = "C:\\Users\\Fish\\AppData\\Local\\pnpm\\dsh.cmd";
    const pnpmScriptPath =
      "C:\\Users\\Fish\\AppData\\Local\\pnpm\\global\\5\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";
    const nodeExe = "C:\\Program Files\\nodejs\\node.exe";
    const pnpmShim = [
      "@echo off",
      "SETLOCAL",
      '"node" "%~dp0\\global\\5\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*',
    ].join("\r\n");
    const pnpmFs = makeMemoryFs({
      files: {
        [pnpmShimPath]: pnpmShim,
        [pnpmScriptPath]: "",
      },
    });

    expect(
      unwrapWindowsLocalCmdShim({
        shimPath: pnpmShimPath,
        commandArgs: ["acp"],
        env: {},
        resolveExecutable: (cmd) => (cmd === "node" ? nodeExe : undefined),
        fs: pnpmFs,
      }),
    ).toEqual({
      command: nodeExe,
      args: [pnpmScriptPath, "acp"],
      env: {},
    });

    const internalShimPath = "C:\\Users\\Fish\\.dsh\\electron-user-data\\cli\\abc\\bin\\dsh.cmd";
    const exePath = "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\DSH NEXT.exe";
    const asarPath = "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\resources\\app.asar";
    const internalFs = makeMemoryFs({
      files: {
        [internalShimPath]:
          '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_DESKTOP_APP_EXECUTABLE%" --expose-internals "%DSH_DESKTOP_DSH_BOOTSTRAP%" %*\r\n',
        [exePath]: "",
      },
      asarEntries: { [asarPath]: ["lib/desktop-cli.js"] },
    });
    const unwrappedInternal = unwrapWindowsLocalCmdShim({
      shimPath: internalShimPath,
      commandArgs: ["acp"],
      env: { LOCALAPPDATA: "C:\\Users\\Fish\\AppData\\Local" },
      resolveExecutable: () => undefined,
      fs: internalFs,
    });
    expect(unwrappedInternal?.command).toBe(exePath);
    expect(unwrappedInternal?.args).toEqual([
      "--expose-internals",
      `${asarPath}\\lib\\desktop-cli.js`,
      "acp",
    ]);
    expect(unwrappedInternal?.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("refuses to unwrap arbitrary custom .cmd batch scripts so validateLocalExecutable rejects them", () => {
    const customShim = "C:\\bin\\custom-dsh.cmd";
    const fs = makeMemoryFs({
      files: { [customShim]: "@echo off\r\necho hacked\r\n" },
    });
    expect(
      unwrapWindowsLocalCmdShim({
        shimPath: customShim,
        commandArgs: ["acp"],
        env: {},
        resolveExecutable: () => "C:\\Program Files\\nodejs\\node.exe",
        fs,
      }),
    ).toBeUndefined();
  });

  it("reads real ASAR headers in plain Node.js without extracting the archive", () => {
    const tmpDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dsh-asar-test-"));
    try {
      const asarPath = NodePath.join(tmpDir, "app.asar");
      writeMinimalAsar(asarPath, {
        files: {
          lib: {
            files: {
              "desktop-cli.js": { size: 12, offset: "0" },
            },
          },
        },
      });
      expect(hasAsarEntrySync(asarPath, "lib/desktop-cli.js")).toBe(true);
      expect(hasAsarEntrySync(asarPath, "lib/missing.js")).toBe(false);
      expect(hasAsarEntrySync(asarPath, "lib")).toBe(false);
    } finally {
      NodeFS.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolves real installed DSH version from Electron ASAR, sibling app dir, npm package.json, and dsh --version fallback", () => {
    const tmpDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dsh-version-test-"));
    try {
      // 1. Real Electron DSH NEXT ASAR layout: prefer @deepseek-ai/dsh CLI version over shell version
      const desktopDir = NodePath.join(tmpDir, "DSH NEXT");
      const resourcesDir = NodePath.join(desktopDir, "resources");
      NodeFS.mkdirSync(resourcesDir, { recursive: true });
      const exePath = NodePath.join(desktopDir, "DSH NEXT.exe");
      NodeFS.writeFileSync(exePath, "");
      const asarPath = NodePath.join(resourcesDir, "app.asar");
      writeAsarWithPayloads(asarPath, {
        "package.json": JSON.stringify({ name: "dsh-desktop-next", version: "2.0.24-next" }),
        "node_modules/@deepseek-ai/dsh/package.json": JSON.stringify({
          name: "@deepseek-ai/dsh",
          version: "0.2.2-rc.4",
        }),
        "lib/desktop-cli.js": "export {};",
      });
      expect(readAsarTextEntrySync(asarPath, "node_modules/@deepseek-ai/dsh/package.json")).toContain(
        "0.2.2-rc.4",
      );
      expect(
        resolveDshInstalledVersion({
          command: exePath,
          args: ["--expose-internals", NodePath.join(asarPath, "lib", "desktop-cli.js"), "acp"],
          platform: "win32",
        }),
      ).toBe("0.2.2-rc.4");
      expect(
        resolveDshInstalledVersion({
          command: exePath,
          args: ["acp"],
          platform: "win32",
        }),
      ).toBe("0.2.2-rc.4");

      // 2. Minimal ASAR containing only root package.json
      const minimalAsar = NodePath.join(tmpDir, "minimal", "resources", "app.asar");
      NodeFS.mkdirSync(NodePath.dirname(minimalAsar), { recursive: true });
      writeAsarWithPayloads(minimalAsar, {
        "package.json": JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.3.1" }),
      });
      expect(
        resolveDshInstalledVersion({
          command: NodePath.join(tmpDir, "minimal", "DSH.exe"),
          args: [NodePath.join(minimalAsar, "lib", "desktop-cli.js"), "acp"],
          platform: "win32",
        }),
      ).toBe("0.3.1");

      // 3. Standalone npm package layout (`node .../node_modules/@deepseek-ai/dsh/lib/bin.js`)
      const npmDshRoot = NodePath.join(tmpDir, "npm", "node_modules", "@deepseek-ai", "dsh");
      NodeFS.mkdirSync(NodePath.join(npmDshRoot, "lib"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(npmDshRoot, "package.json"),
        JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.2.5-beta.1" }),
        "utf8",
      );
      expect(
        resolveDshInstalledVersion({
          command: process.execPath,
          args: [NodePath.join(npmDshRoot, "lib", "bin.js"), "acp"],
          platform: HostProcess.Platform.defaultValue(),
        }),
      ).toBe("0.2.5-beta.1");

      // 4. Standalone `dsh` binary falls back to `dsh --version` and rejects hardcoded 0.0.1
      expect(
        resolveDshInstalledVersion({
          command: "dsh",
          args: ["acp"],
          runVersionCommand: () => "dsh v0.2.4-rc.1\n",
        }),
      ).toBe("0.2.4-rc.1");
      expect(
        resolveDshInstalledVersion({
          command: "dsh",
          args: ["acp"],
          runVersionCommand: () => "0.0.1\n",
        }),
      ).toBeUndefined();

      expect(isPlaceholderDshVersion("0.0.1")).toBe(true);
      expect(isPlaceholderDshVersion("0.2.2-rc.4")).toBe(false);
      expect(selectPreferredDshVersion("0.2.2-rc.4", "0.0.1")).toBe("0.2.2-rc.4");
      expect(selectPreferredDshVersion(undefined, "0.0.1")).toBe("0.0.1");
    } finally {
      NodeFS.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects DeepSeek Harness spawns and CLI arg offsets for wrapped Electron/Node launchers", () => {
    const desktopArgs = [
      "--expose-internals",
      "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\resources\\app.asar\\lib\\desktop-cli.js",
      "acp",
    ];
    expect(isDeepSeekHarnessSpawn("DSH NEXT.exe", desktopArgs)).toBe(true);
    expect(findDeepSeekCliArgStart(desktopArgs)).toBe(2);
    expect(desktopArgs.slice(findDeepSeekCliArgStart(desktopArgs))).toEqual(["acp"]);

    const npmArgs = [
      "C:\\Users\\Fish\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js",
      "--profile",
      "acp",
    ];
    expect(isDeepSeekHarnessSpawn("node.exe", npmArgs)).toBe(true);
    expect(findDeepSeekCliArgStart(npmArgs)).toBe(1);
    expect(npmArgs.slice(findDeepSeekCliArgStart(npmArgs))).toEqual(["--profile", "acp"]);

    expect(isDeepSeekHarnessSpawn("dsh", ["acp"])).toBe(true);
    expect(findDeepSeekCliArgStart(["acp"])).toBe(0);
    expect(isDeepSeekHarnessSpawn("other-agent", ["acp"])).toBe(false);
  });

  it.live(
    "injects --patch probe history isolation when probing a wrapped DeepSeek Harness launcher",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-dsh-probe-unit-" });
        const binDir = NodePath.join(tempDir, "node_modules", "@deepseek-ai", "dsh", "lib");
        const fakeDshScript = NodePath.join(binDir, "bin.js");
        const argvLogPath = NodePath.join(tempDir, "argv.json");
        yield* fs.makeDirectory(binDir, { recursive: true });
        yield* fs.writeFileString(
          NodePath.join(tempDir, "node_modules", "@deepseek-ai", "dsh", "package.json"),
          JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.2.2-rc.4" }),
        );
        yield* fs.writeFileString(
          fakeDshScript,
          `
import * as fs from "node:fs";
import * as readline from "node:readline";
fs.writeFileSync(${JSON.stringify(argvLogPath)}, JSON.stringify(process.argv.slice(2)));
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: "deepseek-harness-acp", version: "0.0.1" },
        agentCapabilities: {
          mcpCapabilities: { http: true },
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
          sessionCapabilities: { close: {}, list: {}, resume: {} },
        },
        authMethods: [],
      },
    }) + "\\n");
  } else if (msg.method === "session/new") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        sessionId: "fake-dsh-session",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: '["deepseek-official","deepseek-v4-flash"]',
            options: [
              {
                group: "deepseek-official",
                name: "DeepSeek",
                options: [
                  { value: '["deepseek-official","deepseek-v4-flash"]', name: "deepseek-v4-flash" },
                  { value: '["deepseek-official","deepseek-v4-pro"]', name: "deepseek-v4-pro" },
                ],
              },
            ],
          },
          {
            id: "reasoning_effort",
            name: "Reasoning effort",
            category: "thought_level",
            type: "select",
            currentValue: "",
            options: [
              { value: "", name: "Provider default" },
              { value: "low", name: "Low" },
              { value: "high", name: "High" },
              { value: "max", name: "Max" },
            ],
          },
        ],
      },
    }) + "\\n");
  } else if (msg.method === "session/set_config_option") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: { configOptions: [] },
    }) + "\\n");
  }
});
`,
        );

        const settings = decodeAcpRegistrySettings({
          source: "local",
          commandPath: process.execPath,
          commandArgs: [fakeDshScript, "acp"],
          enabled: true,
        });
        const catalog = yield* AcpRegistrySupport.makeAcpRegistryCatalog({
          cacheDir: NodePath.join(tempDir, "cache"),
          toolsDir: NodePath.join(tempDir, "tools"),
        });

        const fakeDshHome = NodePath.join(tempDir, "fake-dsh-home");
        const fakeSkillDir = NodePath.join(fakeDshHome, "skills", "custom-audit");
        NodeFS.mkdirSync(fakeSkillDir, { recursive: true });
        NodeFS.writeFileSync(
          NodePath.join(fakeSkillDir, "SKILL.md"),
          "---\nname: custom-audit\ndescription: Audit local DSH repository\n---\n# Audit\n",
          "utf8",
        );

        const probed = yield* probeAcpRegistryConfiguration({
          instanceId: ProviderInstanceId.make("dsh"),
          settings,
          cwd: tempDir,
          environment: {
            ...process.env,
            DSH_HOME: fakeDshHome,
            AGENTS_HOME: NodePath.join(tempDir, "empty-agents-home"),
          },
        }).pipe(Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog));

        expect(probed.probe.ready).toBe(true);
        expect(probed.probe.agentVersion).toBe("0.2.2-rc.4");
        expect(probed.slashCommands.map((cmd) => cmd.name)).toEqual([
          "plan",
          "goal",
          "permission",
          "feedback",
        ]);
        expect(probed.skills).toEqual([
          expect.objectContaining({
            name: "custom-audit",
            description: "Audit local DSH repository",
            scope: "user",
            enabled: true,
          }),
        ]);
        expect(probed.probe.models.map((m) => m.name)).toEqual([
          "deepseek-v4-flash",
          "deepseek-v4-pro",
        ]);
        const reasoningOpt = probed.probe.configOptions.find(
          (opt) => opt.type === "select" && opt.role === "reasoning",
        );
        expect(reasoningOpt).toBeDefined();
        expect(reasoningOpt?.type === "select" ? reasoningOpt.options.map((o) => o.id) : []).toEqual([
          "low",
          "high",
          "max",
        ]);
        expect(reasoningOpt?.type === "select" ? reasoningOpt.currentValue : undefined).toBe("high");

        const observedArgv = JSON.parse(yield* fs.readFileString(argvLogPath)) as string[];
        expect(observedArgv).toContain("--patch");
        const patchIdx = observedArgv.indexOf("--patch");
        expect(observedArgv[patchIdx + 1]).toContain("probe.json");
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            NodeCrypto.layer,
            TestProviderHost.layer().pipe(
              Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
            ),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("unexpected registry HTTP request")),
            ),
          ),
        ),
      ),
  );

  it("discovers packaged DSH NEXT on custom drives via Windows Uninstall Registry without spawning live reg.exe for mock fs", () => {
    const customExe = "D:\\Apps\\DSH NEXT\\DSH NEXT.exe";
    const customAsar = "D:\\Apps\\DSH NEXT\\resources\\app.asar";
    const fallbackHome = "C:\\Users\\custom\\.dsh";
    const fs = makeMemoryFs({
      files: {
        [customExe]: "",
        [customAsar]: "",
      },
      directories: [fallbackHome],
      asarEntries: {
        [customAsar]: ["lib/desktop-cli.js"],
      },
    });
    const env: NodeJS.ProcessEnv = {
      PATH: "",
      USERPROFILE: "C:\\Users\\custom",
      APPDATA: "C:\\Users\\custom\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\custom\\AppData\\Local",
    };

    // Without queryRegistry, custom mock fs stays strictly hermetic (no live reg.exe).
    expect(
      resolvePackagedDshDesktopSpawn({
        commandArgs: ["acp"],
        env,
        platform: "win32",
        fs,
      }),
    ).toBeUndefined();

    // With Uninstall Registry entry pointing to D:\Apps\DSH NEXT, DSH NEXT resolves cleanly
    // AND resolves DSH_HOME via ~/.dsh fallback!
    const regOutput = [
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\4a513c97-f710-5eb4-97f6-b8e556e2c341",
      "    DisplayName    REG_SZ    DSH NEXT 2.0.24-next",
      '    UninstallString    REG_SZ    "D:\\Apps\\DSH NEXT\\Uninstall DSH NEXT.exe" /currentuser',
      "    DisplayIcon    REG_SZ    D:\\Apps\\DSH NEXT\\uninstallerIcon.ico",
    ].join("\r\n");

    const resolved = resolveLocalAcpSpawn({
      commandPath: "dsh",
      commandArgs: ["acp"],
      env,
      platform: "win32",
      fs,
      resolveExecutable: () => undefined,
      queryRegistry: () => regOutput,
    });
    expect(resolved).toMatchObject({
      command: customExe,
      args: ["--expose-internals", `${customAsar}\\lib\\desktop-cli.js`, "acp"],
      env: expect.objectContaining({
        ELECTRON_RUN_AS_NODE: "1",
        DSH_HOME: fallbackHome,
      }),
    });
  });

  it("discovers bare dsh CLI shims in bun, scoop, volta, nvm, and ~/.dsh/bin including dsh.bat", () => {
    const bunDsh = "C:\\Users\\dev\\.bun\\bin\\dsh.exe";
    const scoopDsh = "C:\\Users\\dev\\scoop\\shims\\dsh.bat";
    const scoopScript = "C:\\Users\\dev\\scoop\\apps\\dsh\\current\\lib\\bin.js";
    const voltaDsh = "C:\\Volta\\bin\\dsh.exe";
    const dotDshBin = "C:\\Users\\dev\\.dsh\\bin\\dsh.exe";
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: "",
      USERPROFILE: "C:\\Users\\dev",
      VOLTA_HOME: "C:\\Volta",
    };

    for (const [label, exePath] of [
      ["bun", bunDsh],
      ["volta", voltaDsh],
      ["~/.dsh/bin", dotDshBin],
    ] as const) {
      const fs = makeMemoryFs({
        files: {
          [exePath]: "",
        },
      });
      const resolved = resolveLocalAcpSpawn({
        commandPath: "dsh",
        commandArgs: ["acp"],
        env: baseEnv,
        platform: "win32",
        fs,
        resolveExecutable: () => undefined,
      });
      expect(resolved, `expected ${label} discovery`).toBeDefined();
      expect(resolved?.command).toBe(exePath);
      expect(resolved?.args).toEqual(["acp"]);
    }

    // Scoop .bat shim safely unwraps to direct node.exe execution without shell: true.
    const scoopFs = makeMemoryFs({
      files: {
        [scoopDsh]: '@echo off\r\n"node" "%~dp0..\\apps\\dsh\\current\\lib\\bin.js" %*\r\n',
        [scoopScript]: "export {};",
      },
    });
    const resolvedScoop = resolveLocalAcpSpawn({
      commandPath: "dsh",
      commandArgs: ["acp"],
      env: baseEnv,
      platform: "win32",
      fs: scoopFs,
      resolveExecutable: (cmd) => (cmd === "node" ? "C:\\Program Files\\nodejs\\node.exe" : undefined),
    });
    expect(resolvedScoop).toMatchObject({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [scoopScript, "acp"],
    });
  });

  it("broadens resolveDshDesktopHome across DSH NEXT, DSH, DeepSeek Harness, and ~/.dsh fallback", () => {
    const exePath = "C:\\Users\\dev\\AppData\\Local\\Programs\\DSH\\DSH.exe";
    const asarPath = "C:\\Users\\dev\\AppData\\Local\\Programs\\DSH\\resources\\app.asar";
    const markerPath = "C:\\Users\\dev\\AppData\\Roaming\\DeepSeek Harness\\home\\desktop-next-last-home.json";
    const persistedHome = "E:\\Work\\dsh-home";
    const fs = makeMemoryFs({
      files: {
        [exePath]: "",
        [asarPath]: "",
        [markerPath]: JSON.stringify({ home: persistedHome }),
      },
      directories: [persistedHome],
      asarEntries: {
        [asarPath]: ["lib/desktop-cli.js"],
      },
    });

    const resolved = resolvePackagedDshDesktopSpawn({
      commandArgs: ["acp"],
      env: {
        USERPROFILE: "C:\\Users\\dev",
        APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
      },
      platform: "win32",
      fs,
    });
    expect(resolved?.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: "1",
      DSH_HOME: persistedHome,
    });
  });

  it("does not probe Windows drive roots C..F by default unless probeDriveRoots: true is explicitly requested", () => {
    const exePath = "E:\\DSH NEXT\\DSH NEXT.exe";
    const asarPath = "E:\\DSH NEXT\\resources\\app.asar";
    const probedPaths: string[] = [];
    const baseFs = makeMemoryFs({
      files: { [exePath]: "" },
      directories: ["E:\\DSH NEXT"],
      asarEntries: { [asarPath]: ["lib/desktop-cli.js"] },
    });
    const spyingFs: LocalAcpResolutionFs = {
      ...baseFs,
      isFile: (filePath) => {
        probedPaths.push(filePath);
        return baseFs.isFile(filePath);
      },
    };
    const env = {
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    };

    expect(
      resolvePackagedDshDesktopSpawn({
        commandArgs: ["acp"],
        env,
        platform: "win32",
        fs: spyingFs,
      }),
    ).toBeUndefined();
    expect(probedPaths.some((p) => /^[DEF]:\\/i.test(p))).toBe(false);

    const optIn = resolvePackagedDshDesktopSpawn({
      commandArgs: ["acp"],
      env,
      platform: "win32",
      fs: spyingFs,
      probeDriveRoots: true,
    });
    expect(optIn?.command).toBe(exePath);
  });

  it("caches default-FS positive and negative packaged DSH probes until cleared while bypassing cache when custom fs is provided", () => {
    clearPackagedDshDesktopCacheForTests();
    const tmpDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dsh-probe-cache-"));
    try {
      // Use darwin layout under an isolated HOME so host Windows Uninstall Registry does not interfere.
      const posixHome = tmpDir.replaceAll("\\", "/");
      const env: NodeJS.ProcessEnv = {
        HOME: posixHome,
      };

      // Negative result is cached for default host FS.
      expect(
        resolvePackagedDshDesktopSpawn({
          commandArgs: ["acp"],
          env,
          platform: "darwin",
        }),
      ).toBeUndefined();

      // Create packaged DSH bundle after the negative cache entry was recorded.
      const macOsDir = NodePath.join(tmpDir, "Applications", "DSH NEXT.app", "Contents", "MacOS");
      const resourcesDir = NodePath.join(
        tmpDir,
        "Applications",
        "DSH NEXT.app",
        "Contents",
        "Resources",
      );
      NodeFS.mkdirSync(macOsDir, { recursive: true });
      NodeFS.mkdirSync(resourcesDir, { recursive: true });
      const exePath = NodePath.join(macOsDir, "DSH NEXT");
      const posixExePath = NodePath.posix.join(
        posixHome,
        "Applications",
        "DSH NEXT.app",
        "Contents",
        "MacOS",
        "DSH NEXT",
      );
      NodeFS.writeFileSync(exePath, "");
      writeMinimalAsar(NodePath.join(resourcesDir, "app.asar"), {
        files: { lib: { files: { "desktop-cli.js": { size: 4, offset: "0" } } } },
      });

      // Still returns cached negative hit until cache is cleared.
      expect(
        resolvePackagedDshDesktopSpawn({
          commandArgs: ["acp"],
          env,
          platform: "darwin",
        }),
      ).toBeUndefined();

      // Clearing cache allows fresh positive discovery, which is also cached.
      clearPackagedDshDesktopCacheForTests();
      const firstHit = resolvePackagedDshDesktopSpawn({
        commandArgs: ["acp"],
        env,
        platform: "darwin",
      });
      expect(firstHit?.command).toBe(posixExePath);

      NodeFS.rmSync(exePath, { force: true });
      const cachedHit = resolvePackagedDshDesktopSpawn({
        commandArgs: ["acp", "--extra"],
        env,
        platform: "darwin",
      });
      expect(cachedHit?.command).toBe(posixExePath);
      expect(cachedHit?.args.slice(-2)).toEqual(["acp", "--extra"]);
    } finally {
      clearPackagedDshDesktopCacheForTests();
      NodeFS.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it.live.runIf(process.env.PRISMUX_LIVE_DSH_PROBE === "1")(
    "LIVE: discovers local DSH NEXT on Windows, connects over ACP, and lists real models",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-live-dsh-" });
        const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
        delete cleanEnv.HTTP_PROXY;
        delete cleanEnv.HTTPS_PROXY;
        delete cleanEnv.ALL_PROXY;
        delete cleanEnv.http_proxy;
        delete cleanEnv.https_proxy;
        delete cleanEnv.all_proxy;
        delete cleanEnv.ELECTRON_RUN_AS_NODE;

        const settings = decodeAcpRegistrySettings({
          source: "local",
          commandPath: "dsh",
          commandArgs: ["acp"],
          enabled: true,
        });

        const catalog = yield* AcpRegistrySupport.makeAcpRegistryCatalog({
          cacheDir: NodePath.join(tempDir, "cache"),
          toolsDir: NodePath.join(tempDir, "tools"),
        });

        const inspected = yield* catalog.inspect(settings, cleanEnv);
        yield* Effect.logInfo(`[LIVE DSH INSPECT] ${JSON.stringify(inspected)}`);
        expect(inspected).toEqual({
          status: "ready",
          agentId: "dsh",
          version: null,
          distribution: "local",
        });

        const resolved = yield* catalog.resolve(settings, process.cwd(), cleanEnv);
        yield* Effect.logInfo(
          `[LIVE DSH RESOLVE] ${JSON.stringify({
            distribution: resolved.distribution,
            command: resolved.spawn.command,
            args: resolved.spawn.args,
            shell: resolved.spawn.shell,
            ELECTRON_RUN_AS_NODE: resolved.spawn.env?.ELECTRON_RUN_AS_NODE,
            DSH_HOME: resolved.spawn.env?.DSH_HOME,
          })}`,
        );
        expect(resolved.distribution).toBe("local");
        expect(resolved.spawn.shell).toBe(false);
        expect(resolved.spawn.env?.ELECTRON_RUN_AS_NODE).toBe("1");

        const probed = yield* probeAcpRegistryConfiguration({
          instanceId: ProviderInstanceId.make("dsh"),
          settings,
          cwd: process.cwd(),
          environment: cleanEnv,
        }).pipe(Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog));

        yield* Effect.logInfo(
          `[LIVE DSH PROBE] ${JSON.stringify({
            ready: probed.probe.ready,
            agentVersion: probed.probe.agentVersion,
            modelCount: probed.probe.models.length,
            currentModelId: probed.probe.currentModelId,
            models: probed.probe.models.map((model) => ({ id: model.id, name: model.name })),
            slashCommandCount: probed.slashCommands.length,
            slashCommands: probed.slashCommands.map((command) => command.name),
            skillCount: probed.skills.length,
            skills: probed.skills.map((skill) => ({ name: skill.name, scope: skill.scope })),
            sessionManagement: probed.probe.sessionManagement,
          })}`,
        );
        expect(probed.probe.ready).toBe(true);
        expect(probed.probe.agentVersion).toBeTruthy();
        expect(probed.probe.agentVersion).not.toBe("0.0.1");
        expect(probed.probe.agentVersion).toMatch(/^\d+\.\d+\.\d+/u);
        expect(probed.probe.agentVersion).toBe(
          resolveDshInstalledVersion({
            command: resolved.spawn.command,
            args: resolved.spawn.args,
            env: resolved.spawn.env,
            platform: HostProcess.Platform.defaultValue(),
          }),
        );
        expect(probed.probe.models.length).toBeGreaterThan(0);
        expect(probed.probe.currentModelId).toBeTruthy();
        expect(probed.slashCommands.length).toBeGreaterThan(0);
        expect(probed.slashCommands.map((command) => command.name)).toEqual(
          expect.arrayContaining(["plan", "goal", "permission", "feedback"]),
        );
        expect(probed.skills.length).toBeGreaterThan(0);
        expect(probed.skills.every((skill) => skill.enabled && skill.path.length > 0)).toBe(true);
        const liveReasoningOpt = probed.probe.configOptions.find(
          (opt) => opt.type === "select" && opt.role === "reasoning",
        );
        expect(liveReasoningOpt).toBeDefined();
        if (liveReasoningOpt?.type === "select") {
          expect(liveReasoningOpt.options.length).toBeGreaterThan(0);
          expect(
            liveReasoningOpt.options.some(
              (o) =>
                o.id === "_t3/empty" ||
                o.id.toLowerCase().includes("provider_default") ||
                o.label.toLowerCase().includes("provider default"),
            ),
          ).toBe(false);
        }
        expect(probed.probe.sessionManagement.canList).toBe(true);
        expect(probed.probe.sessionManagement.canResume).toBe(true);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            NodeCrypto.layer,
            TestProviderHost.layer().pipe(
              Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
            ),
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make(() => Effect.die("unexpected registry HTTP request")),
            ),
          ),
        ),
      ),
  );
});
