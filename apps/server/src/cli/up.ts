import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Command, Flag, GlobalFlag, Prompt } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../cloud/bootService.ts";
import { compareExactServiceVersions } from "../cloud/serviceProtocol.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedLimits from "../policy/managedLimits.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import { resolveHostCliCommand } from "./invocation.ts";
import * as CliService from "./service.ts";

type Route = "connect" | "lan";
type Routes = Readonly<Record<Route, boolean>>;

/** How other devices reach this machine now. */
interface Setup {
  readonly service: BootService.BootServiceStatus;
  /** Always null in local-first Prismux builds (cloud relay excised). */
  readonly connect: boolean | null;
  readonly connectRevoked: boolean;
  readonly lan: boolean;
  /** An installed service with no PRISMUX_LAN or PRISMUX_HOST keeps the old default: on. */
  readonly lanFromOldDefault: boolean;
  readonly host: string | undefined;
}

export const connectEnabled = (_link: {
  readonly cliDesired: boolean;
  readonly cliMode: "managed" | "publish_only";
  readonly managedTunnel: boolean;
  readonly revoked: boolean;
}) => false;

const readSetup = Effect.fn("cli.up.read_setup")(function* () {
  const { baseDir } = yield* ServerConfig.ServerConfig;
  const service = yield* (yield* BootService.BootService).status;
  const { entries } = yield* CliService.readServiceEnv(baseDir);
  const lan = yield* Config.Boolean("PRISMUX_LAN")
    .pipe(Config.option)
    .parse(ConfigProvider.fromEnv({ env: entries }));
  const servesThisHome = service.installed && service.otherBaseDir === undefined;
  return {
    service,
    connect: null,
    connectRevoked: false,
    lan: Option.getOrElse(lan, () => servesThisHome),
    lanFromOldDefault: Option.isNone(lan) && servesThisHome && entries.PRISMUX_HOST === undefined,
    host: entries.PRISMUX_HOST,
  } satisfies Setup;
});

export const planRoutes = (
  setup: { readonly installed: boolean; readonly connect: boolean | null; readonly lan: boolean },
  flags: { readonly connect: Option.Option<boolean>; readonly lan: Option.Option<boolean> },
) => {
  const ask = Option.isNone(flags.connect) && Option.isNone(flags.lan);
  const start = {
    connect: false,
    lan: setup.lan,
  };
  return {
    routes: {
      connect: Option.getOrElse(flags.connect, () => start.connect),
      lan: Option.getOrElse(flags.lan, () => start.lan),
    } satisfies Routes,
    ask: ask ? (["lan"] as const) : [],
  };
};

const needsRestart = (before: Routes, after: Routes) => after.lan !== before.lan;

const CHOICES = {
  lan: { title: "Local network", description: "LAN and tailnet. Pairing code required." },
} as const;

const resolveHints = Effect.fn("cli.up.resolve_hints")(function* (baseDir: Option.Option<string>) {
  const baseDirArgs = Option.match(baseDir, {
    onNone: () => [],
    onSome: (dir) => ["--base-dir", dir],
  });
  const command = (subcommand: string, args: ReadonlyArray<string> = []) =>
    Effect.map(resolveHostCliCommand(subcommand, [...baseDirArgs, ...args]), (r) => r.command);
  return {
    run: yield* command(""),
    pair: yield* command("pair"),
    up: yield* command("up"),
    upNoLan: yield* command("up", ["--no-lan"]),
  };
});
type Hints = Effect.Success<ReturnType<typeof resolveHints>>;

const formatSetup = (setup: Setup, hints: Hints) => {
  const { service } = setup;
  if (service.otherBaseDir !== undefined) {
    return [
      `  ${"Service".padEnd(15)}installed for another Prismux home · ${service.otherBaseDir}`,
      "",
      `Pass \`${BootService.formatBootServiceBaseDirOption(service.otherBaseDir)}\` to manage it.`,
    ].join("\n");
  }
  const rows: ReadonlyArray<readonly [string, string]> = [
    [
      "Service",
      !service.supported
        ? "unavailable"
        : service.installed
          ? `installed · prismux@${service.installedVersion ?? packageJson.version}`
          : "not installed",
    ],
    [
      "Local network",
      setup.host !== undefined
        ? `overridden · PRISMUX_HOST=${setup.host}`
        : setup.lanFromOldDefault
          ? "on · kept from an older install"
          : setup.lan
            ? "on · pairing code only"
            : "off",
    ],
  ];
  const notes = [
    ...(setup.host === undefined && setup.lan
      ? ["Anyone on your LAN or tailnet can reach the port. A pairing code is the only lock."]
      : []),
    ...(setup.lanFromOldDefault
      ? [`Older installs keep LAN access on. Turn it off: \`${hints.upNoLan}\`.`]
      : []),
  ];
  return [
    ...rows.map(([label, value]) => `  ${label.padEnd(15)}${value}`),
    ...(notes.length === 0 ? [] : ["", ...notes]),
  ].join("\n");
};

const formatNextSteps = (routes: Routes, serviceInstalled: boolean, hints: Hints) =>
  [
    ...(routes.lan ? [`Run \`${hints.pair}\`. Use the code on your other device.`] : []),
    ...(routes.lan
      ? []
      : [
          serviceInstalled
            ? "Remote access is off. Prismux still runs here in the background."
            : `Remote access is off. Run \`${hints.run}\` to use Prismux here.`,
        ]),
  ].join("\n");

const interactiveTerminal = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

const setUp = Effect.fn("cli.up")(function* (flags: {
  readonly baseDir: Option.Option<string>;
  readonly connect: Option.Option<boolean>;
  readonly lan: Option.Option<boolean>;
  readonly yes: boolean;
}) {
  const { baseDir } = yield* ServerConfig.ServerConfig;
  const service = yield* BootService.BootService;
  const baseDirArgs = Option.match(flags.baseDir, {
    onNone: () => [],
    onSome: (dir) => ["--base-dir", dir],
  });
  const hints = yield* resolveHints(flags.baseDir);
  const before = yield* readSetup();
  if (before.service.otherBaseDir !== undefined) {
    return yield* new BootService.BootServiceOtherBaseDirError({
      installedBaseDir: before.service.otherBaseDir,
      baseDir,
    });
  }
  if (Option.getOrElse(flags.connect, () => false)) {
    return yield* new CliError.UserError({
      cause: "connect",
      userMessage: "Prismux Connect cloud relay is unavailable in local-first Prismux builds. Use --lan or Tailscale QR pairing instead.",
    });
  }

  const current = { connect: false, lan: before.lan };
  const plan = planRoutes({ ...before, installed: before.service.installed }, flags);
  const interactive = !flags.yes && interactiveTerminal();
  let routes = plan.routes;
  if (plan.ask.length > 0 && interactive) {
    if (before.service.installed)
      yield* Console.log(`Current setup\n${formatSetup(before, hints)}\n`);
    const picked = yield* Prompt.run(
      Prompt.MultiSelect({
        message: "Allow connections through:",
        selectAll: "Select all",
        selectNone: "Clear all",
        inverseSelection: "Invert selection",
        choices: plan.ask.map((route) => ({
          ...CHOICES[route],
          value: route,
          selected: plan.routes[route],
        })),
      }),
    ).pipe(Effect.catchTags({ QuitError: () => Effect.succeed(null) }));
    if (picked === null) return yield* Console.log("Nothing changed.");
    routes = { connect: false, lan: picked.includes("lan") };
  } else if (plan.ask.length > 0 && !flags.yes && !before.service.installed) {
    return yield* new CliError.UserError({
      cause: "routes",
      userMessage:
        "No terminal. Choose access with --lan, or use --yes for the default. See `prismux up --help`.",
    });
  }
  if (routes.lan && !current.lan) {
    const policy = yield* ManagedPolicy.ManagedPolicy;
    if (!ManagedLimits.allowsRemoteClients(policy)) {
      return yield* ManagedLimits.refuseRemoteClients(policy);
    }
  }
  if (!before.service.installed && !routes.lan) {
    if (current.lan) yield* CliService.writeServiceEnv(baseDir, { PRISMUX_LAN: "false" });
    return yield* Console.log(formatNextSteps(routes, false, hints));
  }
  const { installedVersion } = before.service;
  const newer =
    installedVersion !== undefined &&
    compareExactServiceVersions(installedVersion, packageJson.version) > 0;
  const stopped = before.service.problems?.includes("service-stopped") === true;
  const restart =
    before.service.installed &&
    (before.service.current || newer) &&
    (needsRestart(current, routes) || stopped);
  const update = before.service.installed && !before.service.current && !newer && !stopped;
  if ((restart || update) && interactive && !stopped) {
    const confirmed = yield* Prompt.run(
      Prompt.Confirm({
        message: update
          ? "Update and restart Prismux? Running agent turns will stop."
          : "Apply changes and restart? Running agent turns will stop.",
        initial: true,
      }),
    ).pipe(Effect.catchTags({ QuitError: () => Effect.succeed(false) }));
    if (!confirmed) return yield* Console.log("Nothing changed.");
  }

  const previousLan = (yield* CliService.readServiceEnv(baseDir)).entries.PRISMUX_LAN;
  yield* CliService.writeServiceEnv(baseDir, { PRISMUX_LAN: String(routes.lan) });
  const restoreServiceEnv = before.service.installed
    ? CliService.writeServiceEnv(baseDir, { PRISMUX_LAN: previousLan })
    : Effect.void;
  const rollBack = before.service.installed
    ? restoreServiceEnv.pipe(Effect.andThen(service.restart.pipe(Effect.ignore)))
    : Effect.void;
  if (before.host !== undefined) {
    yield* Console.warn(
      `PRISMUX_HOST=${before.host} in service.env overrides the network choice. Remove it to apply it.`,
    );
  }

  const printServeCommand = Effect.fn(function* (reason: string) {
    const { command } = yield* resolveHostCliCommand("serve", [
      ...baseDirArgs,
      routes.lan ? "--lan" : "--no-lan",
    ]);
    yield* Console.log(`${reason} Keep this command running:\n  ${command}`);
    const shellHost = (yield* HostProcess.Environment).PRISMUX_HOST;
    if (shellHost !== undefined) {
      yield* Console.warn(
        `PRISMUX_HOST=${shellHost} in this shell overrides that choice. Unset it before you run the command.`,
      );
    }
  });
  if (!before.service.supported) {
    yield* printServeCommand("Background service unavailable.");
  } else {
    if (newer) {
      yield* Console.log(`Keeping installed service version prismux@${installedVersion}.`);
    }
    if (update && !interactive) {
      yield* Console.log("Updating Prismux. Running agent turns will stop.");
    }
    const result = newer
      ? ({ changed: false } as const)
      : yield* CliService.reconcileService().pipe(
          Effect.catchTags({
            BootServicePrerequisiteError: (error) => Effect.succeed({ failed: error.message }),
            BootServiceUnsupportedError: (error) => Effect.succeed({ failed: error.message }),
          }),
          Effect.tapError(() => rollBack),
        );
    if ("failed" in result && before.service.installed) {
      yield* restoreServiceEnv;
      yield* Console.log(
        `Service setup failed: ${result.failed} Fix that, then run \`${hints.up}\` again.`,
      );
    } else if ("failed" in result) {
      yield* printServeCommand(`Service setup failed: ${result.failed}`);
    } else if (result.changed) {
      yield* Console.log(CliService.formatServiceChange(result));
    } else if (restart) {
      if (!interactive && !stopped) {
        yield* Console.log("Restarting Prismux. Running agent turns will stop.");
      }
      const outcome = yield* service.restart.pipe(Effect.tapError(() => rollBack));
      if (outcome === "queued") {
        yield* Console.log("Restart queued. This session will disconnect.");
      }
      if (outcome === "skipped") {
        yield* Console.log(
          "The installed service was not restarted. Run `prismux service status` to see why.",
        );
      }
    }
  }

  const after = yield* readSetup();
  yield* Console.log(
    `\nThis machine\n${formatSetup(after, hints)}\n\n${formatNextSteps(
      { connect: false, lan: after.lan },
      after.service.installed,
      hints,
    )}`,
  );
});

export const upCommand = Command.make("up", {
  ...projectLocationFlags,
  connect: Flag.Boolean("connect").pipe(
    Flag.withDescription("Unavailable in local-first Prismux builds."),
    Flag.optional,
  ),
  lan: Flag.Boolean("lan").pipe(
    Flag.withDescription(
      "Allow LAN and tailnet connections. Anyone there can reach the port; a pairing code is the only lock. Turn off with --no-lan.",
    ),
    Flag.optional,
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withDescription("Ask nothing. Keep the access settings."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withShortDescription("Set up LAN/tailnet remote access and the Prismux background service."),
  Command.withDescription(
    "Set up LAN/tailnet remote access and the Prismux background service. Without a terminal, a needed restart runs without asking and stops running agent turns.",
  ),
  Command.withExamples([
    { command: "prismux up", description: "Choose remote access." },
    { command: "prismux up --lan", description: "Allow LAN access with pairing codes." },
    { command: "prismux up --no-lan", description: "Stop LAN access." },
    { command: "prismux up --yes", description: "Take the defaults with no questions." },
    { command: "prismux status --json", description: "Read the settings from a script." },
  ]),
  Command.withHandler(
    Effect.fn("cli.up.handler")(function* (flags) {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
        quietLogs: true,
      });
      yield* setUp(flags).pipe(
        Effect.provide(
          Layer.merge(CliService.layer(config), ManagedPolicy.layer).pipe(
            Layer.provideMerge(ServerConfig.layer(config)),
          ),
        ),
      );
    }),
  ),
);

const setupJson = (setup: Setup) =>
  JSON.stringify(
    {
      service: {
        supported: setup.service.supported,
        installed: setup.service.installed,
        installedVersion: setup.service.installedVersion ?? null,
        otherBaseDir: setup.service.otherBaseDir ?? null,
      },
      connect: null,
      lan: {
        enabled: setup.lan,
        inheritedDefault: setup.lanFromOldDefault,
        hostOverride: setup.host ?? null,
      },
    },
    null,
    2,
  );

export const statusCommand = Command.make("status", {
  ...projectLocationFlags,
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Print the settings as JSON. Does not test connections."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Show service setup and remote access settings."),
  Command.withExamples([
    { command: "prismux status", description: "Show the settings." },
    { command: "prismux status --json", description: "Print them for scripts and agents." },
  ]),
  Command.withHandler(
    Effect.fn("cli.status")(function* (flags) {
      const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel, {
        quietLogs: flags.json,
      });
      const setup = yield* readSetup().pipe(
        Effect.provide(
          CliService.layer(config).pipe(Layer.provideMerge(ServerConfig.layer(config))),
        ),
      );
      if (flags.json) return yield* Console.log(setupJson(setup));
      const hints = yield* resolveHints(flags.baseDir);
      yield* Console.log(
        setup.service.otherBaseDir !== undefined
          ? `This machine\n${formatSetup(setup, hints)}`
          : `This machine\n${formatSetup(setup, hints)}\n\nChange access: \`${hints.up}\`.`,
      );
    }),
  ),
);
