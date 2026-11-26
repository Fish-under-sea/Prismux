import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useRender } from "@base-ui/react/use-render";
import { useGT } from "gt-react";
import { XIcon } from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { cn } from "~/lib/utils";
import { useNativeTitlebarHeight } from "~/lib/windowControlsOverlay";
import { Button, type ButtonVariant } from "~/components/ui/button";
import {
  createBackdropDismissGuardState,
  DIALOG_BACKDROP_CLASS,
  DIALOG_MEDIA_BACKDROP_CLASS,
  DIALOG_MEDIA_POPUP_CLASS,
  DIALOG_MOBILE_SHEET_CLASS,
  DIALOG_POPUP_CLASS,
  recordBackdropPointerDown,
  shouldDismissOnBackdropClick,
} from "~/components/ui/dialog-styles";
import { ScrollArea } from "~/components/ui/scroll-area";

const ControlledOpenContext = createContext<boolean | undefined>(undefined);

interface DialogBackdropDismissContextValue {
  readonly enabled: boolean;
  readonly dismiss: () => void;
}

const DialogBackdropDismissContext = createContext<DialogBackdropDismissContextValue | null>(null);

const RETAINED_CLOSE_RELEASE_MS = 350;

function RetainedWhileClosed({ open, children }: { open: boolean; children: ReactNode }) {
  const controlledOpen = use(ControlledOpenContext);
  const isOpen = open && controlledOpen !== false;
  const retainedRef = useRef<ReactNode>(isOpen ? children : null);
  if (isOpen) {
    // oxlint-disable-next-line react-hooks/refs -- ref-based retention avoids double synchronous setState renders while open
    retainedRef.current = children;
  }
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- releases retained closed-dialog children ref after exit animation or unmount
  useEffect(() => {
    if (isOpen) return;
    const timer = window.setTimeout(() => {
      retainedRef.current = null;
    }, RETAINED_CLOSE_RELEASE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen]);
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- clears retained children ref on unmount
  useEffect(() => {
    return () => {
      retainedRef.current = null;
    };
  }, []);
  // oxlint-disable-next-line react-hooks/refs -- renders last open snapshot while popup plays its closing transition
  return isOpen ? children : retainedRef.current;
}

function renderRetainedPopup(props: ComponentProps<"div">, state: { open: boolean }) {
  return (
    <div {...props}>
      <RetainedWhileClosed open={state.open}>{props.children}</RetainedWhileClosed>
    </div>
  );
}

function Dialog<Payload>(props: DialogPrimitive.Root.Props<Payload>) {
  const internalActionsRef = useRef<DialogPrimitive.Root.Actions | null>(null);
  const externalActionsRef = props.actionsRef;
  const externalOnOpenChange = props.onOpenChange;
  const controlledOpenRef = useRef<boolean | undefined>(props.open);
  controlledOpenRef.current = props.open;
  const lastCloseHandledAtRef = useRef<number>(0);

  const mergedActionsRef = useMemo(
    () => ({
      get current() {
        return internalActionsRef.current;
      },
      set current(value: DialogPrimitive.Root.Actions | null) {
        internalActionsRef.current = value;
        if (externalActionsRef) {
          (externalActionsRef as { current: DialogPrimitive.Root.Actions | null }).current = value;
        }
      },
    }),
    [externalActionsRef],
  );

  const handleOpenChange = useCallback<NonNullable<DialogPrimitive.Root.Props<Payload>["onOpenChange"]>>(
    (nextOpen, eventDetails) => {
      if (!nextOpen) {
        lastCloseHandledAtRef.current = performance.now();
      }
      externalOnOpenChange?.(nextOpen, eventDetails);
    },
    [externalOnOpenChange],
  );

  const dismiss = useCallback(() => {
    const requestedAt = performance.now();
    queueMicrotask(() => {
      if (controlledOpenRef.current === false) return;
      if (requestedAt - lastCloseHandledAtRef.current < 80 || lastCloseHandledAtRef.current >= requestedAt) {
        return;
      }
      internalActionsRef.current?.close();
    });
  }, []);

  const dismissContextValue = useMemo<DialogBackdropDismissContextValue>(
    () => ({
      enabled: !props.disablePointerDismissal,
      dismiss,
    }),
    [dismiss, props.disablePointerDismissal],
  );

  return (
    <ControlledOpenContext value={props.open}>
      <DialogBackdropDismissContext value={dismissContextValue}>
        <DialogPrimitive.Root
          {...props}
          actionsRef={mergedActionsRef}
          onOpenChange={handleOpenChange}
        />
      </DialogBackdropDismissContext>
    </ControlledOpenContext>
  );
}

function useDialogActionInitialFocus() {
  const popupRef = useRef<HTMLDivElement>(null);
  const initialFocus = (openType: string) => {
    // Match Base UI: touch opens focus the popup to avoid opening the virtual keyboard.
    if (openType === "touch") return popupRef.current;
    return (
      popupRef.current?.querySelector<HTMLElement>(
        '[data-slot="dialog-action"]:not(:disabled):not([aria-disabled="true"])',
      ) ?? true
    );
  };
  return { popupRef, initialFocus };
}

const DialogPortal = DialogPrimitive.Portal;

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogBackdrop({
  className,
  variant = "default",
  ...props
}: DialogPrimitive.Backdrop.Props & { variant?: "default" | "media" }) {
  return (
    <DialogPrimitive.Backdrop
      forceRender
      className={cn(
        variant === "media" ? DIALOG_MEDIA_BACKDROP_CLASS : DIALOG_BACKDROP_CLASS,
        className,
      )}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

function DialogViewport({ className, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      // Electron drag regions ignore z-index, so without no-drag a click over a header drag strip never reaches the page.
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center p-4 [-webkit-app-region:no-drag]",
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  bottomStickOnMobile = true,
  variant = "default",
  mediaControlsPlacement = "outside",
  portalContainer,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  bottomStickOnMobile?: boolean;
  variant?: "default" | "media";
  mediaControlsPlacement?: "inside" | "outside";
  portalContainer?: DialogPrimitive.Portal.Props["container"];
}) {
  const gt = useGT();
  const { popupRef, initialFocus } = useDialogActionInitialFocus();
  const backdropDismiss = use(DialogBackdropDismissContext);
  const backdropGuardRef = useRef(createBackdropDismissGuardState());
  const popup = useRender({
    ref: popupRef,
    render: (
      <DialogPrimitive.Popup
        className={cn(
          variant === "media" ? DIALOG_MEDIA_POPUP_CLASS : DIALOG_POPUP_CLASS,
          "text-popover-foreground",
          variant === "default" && "max-h-full max-w-lg overflow-hidden bg-clip-padding",
          bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
          className,
        )}
        data-pmx-glass-zone={variant === "media" ? undefined : "overlays"}
        data-slot="dialog-popup"
        initialFocus={initialFocus}
        render={renderRetainedPopup}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            aria-label={gt("Close", { $context: "button, closes the dialog" })}
            className="absolute end-2 top-2"
            render={<Button size="icon" variant="ghost" />}
          >
            <XIcon />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    ),
  });
  // macOS has no CSS window-controls overlay, so use the platform titlebar height.
  const nativeTitlebarHeight = useNativeTitlebarHeight();
  const resolvedPortalContainer =
    portalContainer ?? (typeof document !== "undefined" ? document.body : undefined);
  return (
    <DialogPortal container={resolvedPortalContainer}>
      {/* Media opens from inside other overlays (a composer chip, a popover), so it sits above them. */}
      <DialogBackdrop
        className={variant === "media" ? "z-[60]" : undefined}
        variant={variant}
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
      <DialogViewport
        className={cn(
          bottomStickOnMobile && "max-sm:items-end max-sm:p-0 max-sm:pt-12",
          variant === "media" &&
            "z-[60] px-4 max-[8rem]:px-0 py-[max(1.5rem,calc(var(--media-dialog-titlebar-height,0px)+1.5rem))] [-webkit-app-region:no-drag]",
          variant === "media" &&
            mediaControlsPlacement === "inside" &&
            "py-[min(calc(var(--media-dialog-titlebar-height,0px)+1.5rem),50dvh)]",
        )}
        style={
          variant === "media"
            ? ({ "--media-dialog-titlebar-height": `${nativeTitlebarHeight}px` } as CSSProperties)
            : undefined
        }
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
      </DialogViewport>
    </DialogPortal>
  );
}

type DialogActionProps = Omit<React.ComponentProps<typeof Button>, "variant"> & {
  variant?: Exclude<ButtonVariant, `${string}destructive${string}`>;
};

function DialogAction(props: DialogActionProps) {
  return <Button data-slot="dialog-action" {...props} />;
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3 max-sm:pb-4",
        className,
      )}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
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
        variant === "bare" && "py-4",
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("wrap-anywhere font-semibold text-xl leading-snug", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogPanel({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<"div"> & { scrollFade?: boolean }) {
  return (
    <ScrollArea scrollFade={scrollFade}>
      <div
        className={cn(
          "space-y-4 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer]:not(.border-t))]:pb-1",
          className,
        )}
        data-slot="dialog-panel"
        {...props}
      />
    </ScrollArea>
  );
}

export {
  ControlledOpenContext,
  renderRetainedPopup,
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogAction,
  useDialogActionInitialFocus,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogViewport,
};
