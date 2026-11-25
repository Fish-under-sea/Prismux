// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";

import { GTProvider, initializeGT, useGT, useMessages } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  threadUndoLabel,
  threadUndoNoticeSummary,
  type ThreadUndoNoticeAction,
} from "../hooks/showThreadUndoNotice";
import zhCatalog from "../i18n/translations/zh.json";
import { ThreadUndoToastCard } from "./ThreadUndoToast";

const ALL_UNDO_ACTIONS: readonly ThreadUndoNoticeAction[] = [
  "Settled",
  "Snoozed",
  "Unpinned",
  "Archived",
  "Discarded",
];

describe("ThreadUndoToast bottom-right floating popup", () => {
  it("renders bottom-right liquid-glass popup matching PrismuxUpdateToastCard for all 5 undo actions in zh & en", () => {
    initializeGT({ defaultLocale: "en", locales: ["en", "zh"] });
    const zhTranslations = { zh: zhCatalog } as unknown as NonNullable<
      Parameters<typeof GTProvider>[0]["translations"]
    >;

    function Probe({ action, count }: { readonly action: ThreadUndoNoticeAction; readonly count: number }) {
      const messages = useMessages();
      const gt = useGT();
      const summary = threadUndoNoticeSummary({ action, count }, messages);
      const undoHint = threadUndoLabel([], messages);
      return createElement(ThreadUndoToastCard, {
        notice: { action, count, revision: 1 },
        summary,
        undoHint,
        undoButtonLabel: gt("Undo"),
        dismissLabel: gt("Dismiss"),
        shortcutLabel: "Ctrl+Z",
        stackedAboveUpdateToast: false,
        onUndo: vi.fn(),
        onDismiss: vi.fn(),
      });
    }

    for (const action of ALL_UNDO_ACTIONS) {
      const zhHtml = renderToStaticMarkup(
        createElement(
          GTProvider,
          { locale: "zh", translations: zhTranslations },
          createElement(Probe, { action, count: 1 }),
        ),
      );
      expect(zhHtml).toContain('data-testid="prismux-thread-undo-toast"');
      expect(zhHtml).toContain(`data-undo-action="${action}"`);
      expect(zhHtml).toContain('data-pmx-glass-zone="overlays"');
      expect(zhHtml).toContain("dialog-glass");
      expect(zhHtml).toContain("fixed right-4");
      expect(zhHtml).toContain("bottom-[calc(var(--pmx-status-bar-height,20px)+12px)]");
      expect(zhHtml).toContain('data-testid="prismux-thread-undo-action"');
      expect(zhHtml).toContain('data-testid="prismux-thread-undo-dismiss"');
      expect(zhHtml).toContain('data-testid="prismux-thread-undo-progress"');
      expect(zhHtml).toContain("Ctrl+Z");
      expect(zhHtml).toContain("撤销");
      expect(zhHtml).toContain('aria-label="忽略"');
    }

    // Stacks cleanly above PrismuxUpdateToastCard when both are open simultaneously.
    const stackedHtml = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: zhTranslations },
        createElement(ThreadUndoToastCard, {
          notice: { action: "Archived", count: 2, revision: 3 },
          summary: "Archived 2 threads",
          undoHint: "Ctrl+Z to undo",
          undoButtonLabel: "Undo",
          dismissLabel: "Dismiss",
          shortcutLabel: "Ctrl+Z",
          stackedAboveUpdateToast: true,
          onUndo: vi.fn(),
          onDismiss: vi.fn(),
        }),
      ),
    );
    expect(stackedHtml).toContain("Archived 2 threads");
    expect(stackedHtml).toContain("bottom-[calc(var(--pmx-status-bar-height,20px)+168px)]");
  });

  it("completely removes the legacy inline sidebar footer undo strip and mounts ThreadUndoToast globally in __root.tsx", () => {
    const srcRoot = NodePath.resolve(
      NodePath.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
      "..",
    );
    const chromeSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/sidebar/SidebarChrome.tsx"),
      "utf8",
    );
    const legacyNoticeSrc = NodeFS.readFileSync(
      NodePath.join(srcRoot, "components/sidebar/SidebarThreadUndoNotice.tsx"),
      "utf8",
    );
    const rootSrc = NodeFS.readFileSync(NodePath.join(srcRoot, "routes/__root.tsx"), "utf8");

    expect(chromeSrc).not.toContain("SidebarThreadUndoNotice");
    expect(legacyNoticeSrc).not.toContain("SidebarMenuItem");
    expect(legacyNoticeSrc).toContain("return null");
    expect(rootSrc).toContain("<ThreadUndoToast />");
  });
});
