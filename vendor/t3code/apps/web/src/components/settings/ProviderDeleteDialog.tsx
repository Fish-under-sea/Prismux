import type { ProviderDriverKind, ProviderInstanceConfig, ProviderInstanceId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { AlertTriangleIcon, Trash2Icon } from "lucide-react";

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
import { Spinner } from "../ui/spinner";
import type { ProviderRemovalKind } from "./ProviderSettingsPanel.logic";

export interface PendingProviderDeletion {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly instance: ProviderInstanceConfig;
  readonly displayName: string;
  readonly removalKind: ProviderRemovalKind;
  readonly managedAcpAgentId: string | null;
}

export function ProviderDeleteDialog({
  target,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  readonly target: PendingProviderDeletion | null;
  readonly isDeleting: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
}) {
  const gt = useGT();

  return (
    <AlertDialog
      open={target !== null}
      dismissOnBackdropClick={!isDeleting}
      onOpenChange={(open) => {
        if (!open && !isDeleting) {
          onCancel();
        }
      }}
    >
      <AlertDialogPopup data-provider-delete-dialog>
        {target ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <span
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/12 text-destructive"
                  aria-hidden="true"
                >
                  <AlertTriangleIcon className="size-4" />
                </span>
                <span>{gt("Delete provider configuration?")}</span>
              </AlertDialogTitle>

              <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-left">
                <span className="truncate text-sm font-medium text-foreground">
                  {target.displayName}
                </span>
                <Badge variant="outline" size="sm" className="font-mono text-2xs">
                  {gt("Instance ID: {instanceId}", { instanceId: target.instanceId })}
                </Badge>
              </div>

              <AlertDialogDescription className="space-y-2 pt-1">
                <p>
                  {target.removalKind === "remove-builtin"
                    ? gt(
                        'Deleting this built-in provider will remove it from your configured list and clear its custom settings. Existing conversation history will be preserved, and you can add it again anytime via "+ Add provider".',
                      )
                    : gt(
                        'Deleting this configuration will remove its connection and model settings. Existing conversation history will be preserved, and you can add it again anytime via "+ Add provider".',
                      )}
                </p>
                {target.managedAcpAgentId !== null ? (
                  <p className="text-xs text-muted-foreground">
                    {gt(
                      "Managed ACP runtime files for this agent will also be cleaned up if no other provider instance uses them.",
                    )}
                  </p>
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose
                render={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isDeleting}
                    data-provider-delete-cancel
                  />
                }
              >
                {gt("Cancel")}
              </AlertDialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={() => void onConfirm()}
                data-provider-delete-confirm
              >
                {isDeleting ? <Spinner /> : <Trash2Icon className="size-3.5" />}
                <span>{isDeleting ? gt("Deleting...") : gt("Confirm delete")}</span>
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogPopup>
    </AlertDialog>
  );
}
