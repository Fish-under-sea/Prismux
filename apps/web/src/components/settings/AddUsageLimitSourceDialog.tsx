import {
  isSecretReference,
  type EnvironmentId,
  type SecretReference,
  type UnifiedSettings,
  type UsageLimitSourceConfig,
  type UsageLimitSourceId,
  type UsageLimitSourceKind,
} from "@prismux/core-contracts";
import { useLocale } from "gt-react";
import { GlobeIcon, LayersIcon, ServerIcon } from "lucide-react";
import { useId, useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  getRelayDialogCopy,
  getRelayProtocolMeta,
  RELAY_PROTOCOL_ORDER,
  resolveRelayQuotaLocale,
  sourceIdFromUrl,
} from "./AddUsageLimitSourceDialog.logic";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";

export interface EditingUsageLimitSource {
  readonly id: UsageLimitSourceId;
  readonly config: UsageLimitSourceConfig;
}

const PROTOCOL_ICON = {
  newapi: LayersIcon,
  openaiBilling: GlobeIcon,
  cliproxy: ServerIcon,
} as const;

/** Send the key once to server secret storage; settings retain only a redaction marker. */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
  sources,
  editing = null,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly editing?: EditingUsageLimitSource | null;
}) {
  const locale = resolveRelayQuotaLocale(useLocale());
  const copy = getRelayDialogCopy(locale);
  const formId = useId();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);

  const existing = editing?.config ?? null;
  const [kind, setKind] = useState<UsageLimitSourceKind>(existing?.kind ?? "newapi");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [userId, setUserId] = useState(existing?.userId ?? "");
  const secretSources = useSecretSources(environmentId);
  const [keyDraft, setKeyDraft] = useState<string | SecretReference>(
    isSecretReference(existing?.managementKey) ? existing.managementKey : "",
  );
  const [keyValid, setKeyValid] = useState(true);

  const protocol = getRelayProtocolMeta(kind, locale);
  // A saved literal key arrives redacted; sending the marker back preserves it on the server.
  const storedKey = typeof existing?.managementKey === "string" ? existing.managementKey : "";
  const managementKey = typeof keyDraft === "string" ? keyDraft.trim() || storedKey : keyDraft;
  const trimmedUrl = url.trim();
  const trimmedLabel = label.trim();
  const trimmedUserId = userId.trim();
  const canSave = keyValid && trimmedUrl.length > 0 && managementKey !== "";

  const reset = () => {
    setKind(existing?.kind ?? "newapi");
    setLabel(existing?.label ?? "");
    setUrl(existing?.url ?? "");
    setUserId(existing?.userId ?? "");
    setKeyDraft(isSecretReference(existing?.managementKey) ? existing.managementKey : "");
    setKeyValid(true);
  };

  const save = () => {
    if (!canSave) return;
    const id = editing?.id ?? sourceIdFromUrl(trimmedUrl, sources, kind);
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind,
          ...(trimmedLabel ? { label: trimmedLabel } : {}),
          url: trimmedUrl,
          managementKey,
          ...(kind === "newapi" && trimmedUserId ? { userId: trimmedUserId } : {}),
          enabled: existing?.enabled ?? true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? copy.editTitle : copy.addTitle}</DialogTitle>
          <DialogDescription>{copy.description(environmentLabel)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="grid gap-1.5">
              <span className="text-sm font-medium text-foreground">{copy.protocolLabel}</span>
              <div
                role="radiogroup"
                aria-label={copy.protocolLabel}
                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
              >
                {RELAY_PROTOCOL_ORDER.map((candidate) => {
                  const meta = getRelayProtocolMeta(candidate, locale);
                  const Icon = PROTOCOL_ICON[candidate];
                  const selected = candidate === kind;
                  return (
                    <button
                      key={candidate}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-relay-kind={candidate}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selected
                          ? "border-primary bg-primary/8 text-foreground ring-1 ring-primary/80 ring-inset"
                          : "border-border/70 bg-background/70 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                      onClick={() => setKind(candidate)}
                    >
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Icon className="size-3.5 shrink-0 opacity-85" aria-hidden />
                        {meta.title}
                      </span>
                      <span className="text-2xs leading-snug text-muted-foreground">
                        {meta.subtitle}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">{protocol.urlLabel}</Label>
              <Input
                id="usage-source-url"
                placeholder={protocol.urlPlaceholder}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                spellCheck={false}
                autoFocus
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">{protocol.keyLabel}</Label>
              <SecretSourceInput
                id="usage-source-key"
                aria-label={protocol.keyLabel}
                value={keyDraft}
                configured={storedKey !== ""}
                sources={secretSources}
                environmentId={environmentId}
                onChange={(event) => setKeyDraft(event.target.value)}
                onSecretChange={(secret) => setKeyDraft(secret ?? "")}
                onValidityChange={setKeyValid}
              />
            </div>

            {protocol.showUserId ? (
              <div className="grid gap-1.5">
                <Label htmlFor="usage-source-user-id">{protocol.userIdLabel}</Label>
                <Input
                  id="usage-source-user-id"
                  placeholder={protocol.userIdPlaceholder}
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  spellCheck={false}
                />
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">{copy.nameLabel}</Label>
              <Input
                id="usage-source-label"
                placeholder={protocol.labelPlaceholder}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {copy.cancel}
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {editing ? copy.saveAction : copy.addAction}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
