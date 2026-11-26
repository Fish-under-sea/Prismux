import { createRef, useState } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { requestConfirmDialog, resetConfirmDialogForTests } from "~/confirmDialog";
import { act, render } from "../../../test/render";
import { ConfirmDialogHost } from "../ConfirmDialogHost";
import { Button } from "./button";
import {
  Dialog,
  DialogAction,
  DialogClose,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

describe("dialog initial focus", () => {
  it.each([
    { label: "generic", options: undefined, focused: "Cancel", confirmed: false },
    {
      label: "destructive opt-in",
      options: { variant: "destructive", initialFocus: "confirm" },
      focused: "Cancel",
      confirmed: false,
    },
    { label: "opt-in", options: { initialFocus: "confirm" }, focused: "Confirm", confirmed: true },
  ] as const)(
    "focuses $focused for a $label confirmation",
    async ({ options, focused, confirmed }) => {
      resetConfirmDialogForTests();
      await using _screen = await render(<ConfirmDialogHost />);
      let confirmation: Promise<boolean> | undefined;
      await act(() => {
        confirmation = requestConfirmDialog("Continue?", options);
      });

      await expect.element(page.getByRole("button", { name: focused, exact: true })).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      await expect(confirmation).resolves.toBe(confirmed);
    },
  );

  it("focuses the dialog action and keeps the caller's popup ref", async () => {
    const popup = createRef<HTMLDivElement>();
    await using _screen = await render(
      <Dialog>
        <DialogTrigger>Open retry</DialogTrigger>
        <DialogPopup ref={popup}>
          <DialogTitle>Import failed</DialogTitle>
          <DialogClose>Cancel</DialogClose>
          <DialogAction>Try again</DialogAction>
        </DialogPopup>
      </Dialog>,
    );
    await act(() => page.getByRole("button", { name: "Open retry" }).element().focus());
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByRole("button", { name: "Try again" })).toHaveFocus();
    expect(popup.current).toBe(page.getByRole("dialog").element());
  });

  it.each(["disabled action", "caller initialFocus"] as const)(
    "falls back to Cancel for a %s",
    async (reason) => {
      const cancel = createRef<HTMLButtonElement>();
      await using _screen = await render(
        <Dialog defaultOpen>
          <DialogPopup {...(reason === "caller initialFocus" ? { initialFocus: cancel } : {})}>
            <DialogTitle>Install update?</DialogTitle>
            <DialogClose ref={cancel} render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <DialogAction disabled={reason === "disabled action"}>Install</DialogAction>
          </DialogPopup>
        </Dialog>,
      );

      await expect.element(page.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
    },
  );

  it("focuses the popup instead of the action when opened by touch", async () => {
    await using _screen = await render(
      <Dialog>
        <DialogTrigger>Open installer</DialogTrigger>
        <DialogPopup>
          <DialogTitle>Install relay client</DialogTitle>
          <DialogClose>Cancel</DialogClose>
          <DialogAction>Install</DialogAction>
        </DialogPopup>
      </Dialog>,
    );

    const trigger = page.getByRole("button", { name: "Open installer" }).element();
    await act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }),
      );
      trigger.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
      trigger.dispatchEvent(
        new PointerEvent("click", { bubbles: true, pointerType: "touch", detail: 1 }),
      );
    });

    await expect.element(page.getByRole("dialog")).toHaveFocus();
  });

  it("renders RetainedWhileClosed children in a single pass while open and preserves snapshot while closing", async () => {
    const renderedLabels: Array<string | null> = [];

    function TrackedBody({ label }: { readonly label: string | null }) {
      renderedLabels.push(label);
      return <p data-testid="retained-body">{label ?? "empty"}</p>;
    }

    function Harness() {
      const [open, setOpen] = useState(true);
      const [label, setLabel] = useState<string | null>("step-1");
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogPopup>
            <DialogTitle>Tracked dialog</DialogTitle>
            <TrackedBody label={label} />
            <button type="button" onClick={() => setLabel("step-2")}>
              Step 2
            </button>
            <button type="button" onClick={() => setLabel("step-3")}>
              Step 3
            </button>
            <button
              type="button"
              onClick={() => {
                setLabel(null);
                setOpen(false);
              }}
            >
              Close empty
            </button>
          </DialogPopup>
        </Dialog>
      );
    }

    await using _screen = await render(<Harness />);
    await expect.element(page.getByTestId("retained-body")).toHaveTextContent("step-1");
    const rendersAfterMount = renderedLabels.length;

    // Each state update while open must cause strictly 1 render of the dialog body (no double render from render-phase setState)
    await act(() => {
      (page.getByRole("button", { name: "Step 2" }).element() as HTMLElement).click();
    });
    await expect.element(page.getByTestId("retained-body")).toHaveTextContent("step-2");
    expect(renderedLabels.length - rendersAfterMount).toBe(1);

    await act(() => {
      (page.getByRole("button", { name: "Step 3" }).element() as HTMLElement).click();
    });
    await expect.element(page.getByTestId("retained-body")).toHaveTextContent("step-3");
    expect(renderedLabels.length - rendersAfterMount).toBe(2);

    // Closing while clearing parent data must not flash "empty" before unmount
    await act(() => {
      (page.getByRole("button", { name: "Close empty" }).element() as HTMLElement).click();
    });
    const closingBody = page.getByTestId("retained-body").query();
    if (closingBody) {
      expect(closingBody.textContent).toBe("step-3");
    }
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });
});
