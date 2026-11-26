import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import { resolveUsageAccess } from "@prismux/client-runtime/state/usage-access";
import { AuthOrchestrationOperateScope } from "@prismux/core-contracts";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import { useOpenInPreferredEditor } from "../../editorPreferences";
import { m as resolveMessage } from "~/i18n/messages";
import { useEnvironmentQuery } from "../../state/query";
import {
  environmentSession,
  readEnvironmentScope,
  useEnvironmentScope,
} from "../../state/session";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";
import { SettingsPageContainer } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

export function DiagnosticsSettingsPanel({
  embedded = false,
}: { readonly embedded?: boolean } = {}) {
  const { environment } = useSettingsScope();
  // Signals and pending UI state belong to one environment, so a scope switch starts fresh.
  return <DiagnosticsSettingsBody key={environment?.environmentId ?? ""} embedded={embedded} />;
}

export function DiagnosticsSettingsSections() {
  return <DiagnosticsSettingsPanel embedded />;
}

function DiagnosticsSettingsBody({ embedded }: { readonly embedded: boolean }) {
  const gt = useGT();
  const m = useMessages();
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const observability = environment?.serverConfig?.observability;
  const availableEditors = environment?.serverConfig?.availableEditors;
  const canOpenHostEditor = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const session = useEnvironmentQuery(
    environmentId === null ? null : environmentSession.sessionStateAtom(environmentId),
    m,
  );
  const diagnosticsAccess = resolveUsageAccess(
    {
      connectionPhase: environment?.connection.phase ?? "available",
      session: session.data,
      hasSessionError: session.error !== null,
    },
    m,
  );
  const canReadDiagnostics = diagnosticsAccess.canReadDiagnostics;
  const openInEditor = useOpenInPreferredEditor(environmentId, availableEditors ?? []);
  const [isOpeningLogsDirectory, setIsOpeningLogsDirectory] = useState(false);
  const [openLogsDirectoryError, setOpenLogsDirectoryError] = useState<string | null>(null);

  const openLogsDirectory = () => {
    const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
    if (!logsDirectoryPath) return;

    if (
      environmentId === null ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    ) {
      return;
    }

    setIsOpeningLogsDirectory(true);
    setOpenLogsDirectoryError(null);
    void (async () => {
      const result = await openInEditor(logsDirectoryPath);
      setIsOpeningLogsDirectory(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setOpenLogsDirectoryError(
          error instanceof Error
            ? (thrownErrorMessage(error, resolveMessage) ?? error.message)
            : gt("Unable to open logs folder."),
        );
      }
    })();
  };

  if (!canReadDiagnostics) {
    const content = (
      <p className="text-sm text-muted-foreground">
        {environmentId === null
          ? gt("Connect an environment to see diagnostics.")
          : diagnosticsAccess.isPending
            ? gt("Checking diagnostics access…")
            : diagnosticsAccess.error}
      </p>
    );
    return embedded ? (
      <div className="space-y-8">{content}</div>
    ) : (
      <SettingsPageContainer width="full" className="gap-8">
        {content}
      </SettingsPageContainer>
    );
  }

  const fullContent = (
    <ResourceTelemetryDiagnostics
      environmentId={environmentId}
      logsDirectoryAction={{
        disabled: !canOpenHostEditor || !observability?.logsDirectoryPath,
        isOpening: isOpeningLogsDirectory,
        error: openLogsDirectoryError,
        onOpen: openLogsDirectory,
      }}
    />
  );

  return embedded ? (
    <div className="space-y-8">{fullContent}</div>
  ) : (
    <SettingsPageContainer width="full" className="gap-8">
      {fullContent}
    </SettingsPageContainer>
  );
}
