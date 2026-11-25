import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import { m } from "~/i18n/messages";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@prismux/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { T, useGT, useMessages } from "gt-react";
import { useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";

import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";

interface ProviderSetupSectionProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly binaryPath?: string | undefined;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly onEnable: () => void;
}

export function ProviderSetupSection(props: ProviderSetupSectionProps) {
  const gt = useGT();
  return (
    <section
      aria-label={gt("Antigravity setup")}
      className="divide-y divide-border/45 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{gt("Environment")}</h3>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary" size="sm">
            <code className="max-w-52 truncate font-mono text-2xs text-foreground/85">
              {props.environmentLabel}
            </code>
          </Badge>
          {!props.enabled && !props.readOnly ? (
            <Button size="xs" variant="outline" onClick={props.onEnable}>
              <T>Enable Antigravity</T>
            </Button>
          ) : null}
        </div>
      </div>
      {props.readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">{gt("Setup unavailable")}</h3>
          <span className="text-xs text-muted-foreground">
            {gt("Provider setup is read-only.")}
          </span>
        </div>
      ) : props.provider?.setup === undefined ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
          <h3 className="text-sm font-medium text-foreground">{gt("Update required")}</h3>
          <span className="text-xs text-muted-foreground">
            {gt("Update this environment to manage Antigravity.")}
          </span>
        </div>
      ) : (
        <ProviderSetupActions
          key={`${props.environmentId}:${props.instanceId}`}
          environmentId={props.environmentId}
          environmentLabel={props.environmentLabel}
          instanceId={props.instanceId}
          provider={props.provider}
          binaryPath={props.binaryPath}
          enabled={props.enabled}
        />
      )}
    </section>
  );
}

function ProviderSetupActions({
  environmentId,
  environmentLabel,
  instanceId,
  provider,
  enabled,
  binaryPath,
}: Pick<
  ProviderSetupSectionProps,
  "environmentId" | "environmentLabel" | "instanceId" | "enabled" | "binaryPath"
> & {
  readonly provider: ServerProvider;
}) {
  const gt = useGT();
  const target = { environmentId, input: { instanceId } };
  const authQuery = useEnvironmentQuery(serverEnvironment.providerAuthState(target), useMessages());
  const installQuery = useEnvironmentQuery(
    serverEnvironment.providerInstallState(target),
    useMessages(),
  );
  const auth = authQuery.data;
  const installation = installQuery.data;
  const commandOptions = { reportFailure: false, reportDefect: false };
  const startInstall = useAtomCommand(serverEnvironment.startProviderInstall, commandOptions);
  const cancelInstall = useAtomCommand(serverEnvironment.cancelProviderInstall, commandOptions);
  const removeInstall = useAtomCommand(
    serverEnvironment.removeProviderInstallation,
    commandOptions,
  );
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const authActive =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const installActive =
    installation?.phase === "downloading" ||
    installation?.phase === "extracting" ||
    installation?.phase === "verifying";
  const usesCustomBinary = Boolean(binaryPath?.trim());
  const installed =
    provider.installed || (!usesCustomBinary && installation?.installedVersion != null);
  const queryError = authQuery.error ?? installQuery.error;
  const actionsDisabled = pendingLabel !== null || queryError !== null;
  const installationStatusMessage =
    installation === null
      ? gt("Checking the Antigravity runtime.")
      : installation?.phase === "downloading"
        ? installation.totalBytes === null
          ? gt("Downloading {downloaded} MB.", {
              downloaded: (installation.downloadedBytes / 1_000_000).toFixed(1),
            })
          : gt("Downloading {downloaded} MB of {total} MB.", {
              downloaded: (installation.downloadedBytes / 1_000_000).toFixed(1),
              total: (installation.totalBytes / 1_000_000).toFixed(1),
            })
        : installation?.phase === "extracting"
          ? gt("Extracting Antigravity.")
          : installation?.phase === "verifying"
            ? gt("Checking the downloaded runtime.")
            : installed
              ? !installation?.installedVersion
                ? gt("Using local agy CLI.")
                : gt("Installed.")
              : usesCustomBinary
                ? enabled
                  ? gt("The configured Antigravity runtime is unavailable.")
                  : gt("The configured Antigravity runtime has not been checked.")
                : installation?.totalBytes
                  ? gt("{size} MB download.", {
                      size: Math.ceil(installation.totalBytes / 1_000_000),
                    })
                  : gt("Not installed.");

  async function runCommand<A, E>(
    label: string,
    request: () => Promise<AtomCommandResult<A, E>>,
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingLabel(label);
    setError(null);
    const settled = await settlePromise(request);
    pendingRef.current = false;
    setPendingLabel(null);
    if (settled._tag === "Failure") {
      setError(gt("Provider setup failed. Try again."));
      return false;
    }
    const result = settled.value;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error
            ? (thrownErrorMessage(failure, m) ?? failure.message)
            : gt("Provider setup failed."),
        );
      }
      return false;
    }
    return true;
  }

  async function removeRuntime() {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      gt(
        "Remove the downloaded Antigravity runtime from {environment}? Your local agy CLI sign-in and thread history are kept.",
        { environment: environmentLabel },
      ),
    );
    if (confirmed) {
      await runCommand(gt("Removing runtime"), () => removeInstall(target));
    }
  }

  const showInstallControl =
    (installActive && Boolean(installation?.operationId)) ||
    (!installActive && Boolean(provider.setup?.canInstall)) ||
    Boolean(installation?.canRemove && !installActive);
  const showDownloadProgress =
    installation?.phase === "downloading" &&
    installation.totalBytes !== null &&
    installation.totalBytes > 0;

  return (
    <div className="divide-y divide-border/45">
      {/* Keep the live region first so sibling divider rules do not add a divider after the last visible
       * row. */}
      <p className="sr-only" role="status">
        {pendingLabel ? `${pendingLabel}.` : null}
      </p>
      <div className="px-4 py-3">
        <div className="flex flex-col gap-2.5 @min-[22rem]/detail-card:flex-row @min-[22rem]/detail-card:items-center @min-[22rem]/detail-card:justify-between @min-[22rem]/detail-card:gap-4">
          <div className="min-w-0 flex-1 space-y-0.5">
            <h3 className="text-sm font-medium text-foreground">{gt("Runtime")}</h3>
            <p role="status" className="text-xs leading-snug text-muted-foreground tabular-nums">
              {installationStatusMessage}
            </p>
            {usesCustomBinary ? (
              <p className="text-2xs text-muted-foreground/80">
                <T>Uses the custom binary path below. Installation keeps that path.</T>
              </p>
            ) : null}
            {!installed && !provider.setup?.canInstall ? (
              <p className="text-2xs text-muted-foreground/80">
                <T>
                  Automatic installation unavailable. Set a binary path or use another environment.
                </T>
              </p>
            ) : null}
            {!installActive &&
            installation?.message &&
            installation.message !== installationStatusMessage ? (
              <p className="text-2xs text-muted-foreground/80 [overflow-wrap:anywhere]">
                {installation.message}
              </p>
            ) : null}
          </div>
          {showInstallControl ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {installation?.canRemove && !installActive ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={gt("Remove downloaded runtime")}
                        disabled={actionsDisabled || authActive}
                        onClick={() => void removeRuntime()}
                      />
                    }
                  >
                    <Trash2Icon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup>
                    <T>Remove downloaded runtime</T>
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              {installActive && installation.operationId ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionsDisabled}
                  onClick={() => {
                    const operationId = installation.operationId;
                    if (!operationId) return;
                    void runCommand(gt("Cancelling installation"), () =>
                      cancelInstall({ environmentId, input: { instanceId, operationId } }),
                    );
                  }}
                >
                  <T>Cancel installation</T>
                </Button>
              ) : !installActive && provider.setup?.canInstall ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionsDisabled || authActive}
                  onClick={() =>
                    void runCommand(gt("Starting installation"), () => startInstall(target))
                  }
                >
                  {installation?.installedVersion
                    ? installation.version &&
                      installation.version !== installation.installedVersion
                      ? gt("Update Antigravity")
                      : gt("Reinstall Antigravity")
                    : installation?.phase === "failed" || installation?.phase === "cancelled"
                      ? gt("Retry installation")
                      : installed
                        ? gt("Install managed runtime")
                        : gt("Install Antigravity")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {showDownloadProgress ? (
          <div className="mt-2.5 h-1">
            <progress
              aria-label={gt("Antigravity download")}
              // Forced-colors mode repaints the track and fill as Canvas, and
              // appearance:auto cannot bring the native widget back: the
              // preflight border reset marks every <progress> as author-styled,
              // so Chromium keeps its fallback paint. Use system colors instead.
              className="block h-1 w-full appearance-none overflow-hidden rounded-full bg-muted forced-colors:border [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary forced-colors:[&::-moz-progress-bar]:bg-[Highlight] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary forced-colors:[&::-webkit-progress-value]:bg-[Highlight]"
              value={installation.downloadedBytes}
              max={installation.totalBytes!}
            />
          </div>
        ) : null}
      </div>

      <ProviderAuthenticationSection
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        instanceId={instanceId}
        provider={provider}
        readOnly={false}
      />

      {error || queryError ? (
        <div className="grid gap-2 px-4 py-3">
          <p role="alert" className="text-destructive [overflow-wrap:anywhere]">
            {error ?? queryError}
          </p>
          {queryError ? (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => {
                authQuery.refresh();
                installQuery.refresh();
              }}
            >
              <T>Retry setup status</T>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
