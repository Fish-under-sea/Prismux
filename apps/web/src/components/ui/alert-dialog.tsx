import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { useRender } from "@base-ui/react/use-render";
import { createContext, use, useCallback, useMemo, useRef } from "react";

import { cn } from "~/lib/utils";
import {
  createBackdropDismissGuardState,
  DIALOG_BACKDROP_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS,
  recordBackdropPointerDown,
  shouldDismissOnBackdropClick,
} from "~/components/ui/dialog-styles";
import {
  ControlledOpenContext,
  DialogAction,
  renderRetainedPopup,
  useDialogActionInitialFocus,
} from "~/components/ui/dialog";

interface AlertDialogBackdropDismissContextValue {
  readonly enabled: boolean;
  readonly dismiss: () => void;
}

const AlertDialogBackdropDismissContext =
  createContext<AlertDialogBackdropDismissContextValue | null>(null);

function AlertDialog<Payload>({
  dismissOnBackdropClick = true,
  actionsRef: externalActionsRef,
  ...props
}: AlertDialogPrimitive.Root.Props<Payload> & {
  dismissOnBackdropClick?: boolean;
}) {
  const internalActionsRef = useRef<AlertDialogPrimitive.Root.Actions | null>(null);

  const mergedActionsRef = useMemo(
    () => ({
      get current() {
        return internalActionsRef.current;
      },
      set current(value: AlertDialogPrimitive.Root.Actions | null) {
        internalActionsRef.current = value;
        if (externalActionsRef) {
          (externalActionsRef as { current: AlertDialogPrimitive.Root.Actions | null }).current =
            value;
        }
      },
    }),
    [externalActionsRef],
  );

  const dismiss = useCallback(() => {
    internalActionsRef.current?.close();
  }, []);

  const dismissContextValue = useMemo<AlertDialogBackdropDismissContextValue>(
    () => ({
      enabled: dismissOnBackdropClick,
      dismiss,
    }),
    [dismiss, dismissOnBackdropClick],
  );

  return (
    <ControlledOpenContext value={props.open}>
      <AlertDialogBackdropDismissContext value={dismissContextValue}>
        <AlertDialogPrimitive.Root {...props} actionsRef={mergedActionsRef} />
      </AlertDialogBackdropDismissContext>
    </ControlledOpenContext>
  );
}

const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      forceRender
      className={cn(DIALOG_BACKDROP_CLASS, className)}
      data-slot="alert-dialog-backdrop"
      {...props}
    />
  );
}

function AlertDialogViewport({ className, ...props }: AlertDialogPrimitive.Viewport.Props) {
  return (
    <AlertDialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4 [-webkit-app-region:no-drag]",
        className,
      )}
      data-slot="alert-dialog-viewport"
      {...props}
    />
  );
}

function AlertDialogPopup({
  className,
  bottomStickOnMobile = true,
  portalContainer,
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  bottomStickOnMobile?: boolean;
  portalContainer?: AlertDialogPrimitive.Portal.Props["container"];
}) {
  const { popupRef, initialFocus } = useDialogActionInitialFocus();
  const backdropDismiss = use(AlertDialogBackdropDismissContext);
  const backdropGuardRef = useRef(createBackdropDismissGuardState());
  const popup = useRender({
    ref: popupRef,
    render: (
      <AlertDialogPrimitive.Popup
        className={cn(
          DIALOG_POPUP_CLASS,
          "max-h-full max-w-lg overflow-hidden bg-clip-padding text-popover-foreground",
          bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
          className,
        )}
        data-pmx-glass-zone="overlays"
        data-slot="alert-dialog-popup"
        initialFocus={initialFocus}
        render={renderRetainedPopup}
        {...props}
      />
    ),
  });
  const resolvedPortalContainer =
    portalContainer ?? (typeof document !== "undefined" ? document.body : undefined);
  return (
    <AlertDialogPortal container={resolvedPortalContainer}>
      <AlertDialogBackdrop
        onPointerDownCapture={(event) => {
          recordBackdropPointerDown(backdropGuardRef.current, event, popupRef.current);
        }}
        onClick={(event) => {
          if (
            backdropDismiss?.enabled &&
            shouldDismissOnBackdropClick(backdropGuardRef.current, event, popupRef.current)
          ) {
            backdropDismiss.dismiss();
          }
        }}
      />
      <AlertDialogViewport
        className={cn(bottomStickOnMobile && "max-sm:items-end max-sm:p-0 max-sm:pt-12")}
        onPointerDownCapture={(event) => {
          recordBackdropPointerDown(backdropGuardRef.current, event, popupRef.current);
        }}
        onClick={(event) => {
          if (
            backdropDismiss?.enabled &&
            shouldDismissOnBackdropClick(backdropGuardRef.current, event, popupRef.current)
          ) {
            backdropDismiss.dismiss();
          }
        }}
      >
        {popup}
      </AlertDialogViewport>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col gap-2 p-6 text-center max-sm:pb-4 sm:text-left",
        className,
      )}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)]",
        variant === "default" && "border-t bg-muted/72 py-4",
        variant === "bare" && "pb-6",
        className,
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("wrap-anywhere shrink-0 font-semibold text-xl leading-snug", className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn(
        "wrap-anywhere max-h-[min(24rem,60dvh)] min-h-0 overflow-y-auto overscroll-contain text-muted-foreground text-sm select-text",
        className,
      )}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogBackdrop,
  AlertDialogBackdrop as AlertDialogOverlay,
  AlertDialogPopup,
  AlertDialogPopup as AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
  DialogAction as AlertDialogAction,
  AlertDialogViewport,
};
