/* oxlint-disable prismux/no-untranslated-copy -- locale-switched bilingual copy (zh-CN / en) for Prismux API relay quota settings */
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  UnifiedSettings,
  UsageLimitSourceConfig,
  UsageLimitSourceId,
} from "@prismux/core-contracts";
import { useLocale } from "gt-react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import {
  AddUsageLimitSourceDialog,
  type EditingUsageLimitSource,
} from "./AddUsageLimitSourceDialog";
import {
  getRelayProtocolMeta,
  getUsageProviderSettingsCopy,
  resolveRelayQuotaLocale,
  summarizeUsageLimitSourceSnapshot,
  type UsageProviderSettingsCopy,
} from "./AddUsageLimitSourceDialog.logic";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly readOnly: boolean;
}) {
  const locale = resolveRelayQuotaLocale(useLocale());
  const copy = getUsageProviderSettingsCopy(locale);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const snapshots = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) => config?.usageLimitSources,
  );
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditingUsageLimitSource | null>(null);
  const entries = Object.entries(sources) as Array<[UsageLimitSourceId, UsageLimitSourceConfig]>;

  return (
    <>
      <SettingsSection id="usage-providers" title={copy.sectionTitle}>
        {entries.length === 0 ? (
          <SettingsRow
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            control={
              !readOnly ? (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <PlusIcon className="size-3.5" aria-hidden />
                  {copy.addRelay}
                </Button>
              ) : null
            }
          />
        ) : (
          <>
            <div
              data-relay-toolbar="true"
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {copy.configuredCount(entries.length)}
              </span>
              {!readOnly ? (
                <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
                  <PlusIcon className="size-3" aria-hidden />
                  {copy.addRelay}
                </Button>
              ) : null}
            </div>
            {entries.map(([id, source]) => {
              const label = source.label?.trim() || source.url;
              const protocol = getRelayProtocolMeta(source.kind, locale);
              const snapshot = snapshots?.find((item) => item.id === id);
              const summary = source.enabled
                ? summarizeUsageLimitSourceSnapshot(snapshot, locale)
                : null;
              return (
                <SettingsRow
                  key={id}
                  title={
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span>{label}</span>
                      <Badge variant="secondary" size="sm" data-relay-protocol={source.kind}>
                        {protocol.badgeLabel}
                      </Badge>
                      {!source.enabled ? (
                        <Badge variant="outline" size="sm">
                          {copy.disabledBadge}
                        </Badge>
                      ) : summary ? (
                        <Badge
                          variant={
                            summary.tone === "success"
                              ? "success"
                              : summary.tone === "error"
                                ? "error"
                                : "secondary"
                          }
                          size="sm"
                          data-relay-status={summary.tone}
                          title={summary.text}
                          className="max-w-72"
                        >
                          <span className="truncate">{summary.text}</span>
                        </Badge>
                      ) : null}
                    </span>
                  }
                  description={
                    <span className="break-all font-mono text-2xs">
                      {source.url}
                      {source.kind === "newapi" && source.userId ? ` · UID ${source.userId}` : ""}
                    </span>
                  }
                  control={
                    !readOnly ? (
                      <div className="flex items-center gap-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setEditing({ id, config: source })}
                        >
                          {copy.edit}
                        </Button>
                        <RemoveUsageProviderButton
                          label={label}
                          environmentLabel={environmentLabel}
                          copy={copy}
                          onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                        />
                        <Switch
                          checked={source.enabled}
                          onCheckedChange={(enabled) =>
                            updateSettings({
                              usageLimitSources: {
                                [id]: { ...source, enabled },
                              },
                            })
                          }
                          aria-label={copy.toggleAria(label)}
                        />
                      </div>
                    ) : null
                  }
                />
              );
            })}
          </>
        )}
      </SettingsSection>
      {(adding || editing !== null) && !readOnly ? (
        <AddUsageLimitSourceDialog
          key={editing ? `edit:${editing.id}` : "add"}
          open
          onOpenChange={(next) => {
            if (!next) {
              setAdding(false);
              setEditing(null);
            }
          }}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          sources={sources}
          editing={editing}
        />
      ) : null}
    </>
  );
}

function RemoveUsageProviderButton({
  label,
  environmentLabel,
  copy,
  onConfirm,
}: {
  readonly label: string;
  readonly environmentLabel: string;
  readonly copy: UsageProviderSettingsCopy;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {copy.remove}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.confirmRemoveTitle(label)}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.confirmRemoveDescription(environmentLabel)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {copy.cancel}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {copy.confirmRemoveAction}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
