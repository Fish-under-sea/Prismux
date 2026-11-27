// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test renders into an in-memory MiniDocument instead of Playwright browser runner.
import { act, type MouseEvent, type ReactNode } from "react";
// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test explicitly unmounts its React root in try/finally.
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const buttonHandlers = new Map<string, () => void>();

vi.mock("../components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant: _variant,
    size: _size,
    ...props
  }: {
    children?: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    [key: string]: unknown;
  }) => {
    const key =
      props["data-pmx-blocked-configure-api"] !== undefined
        ? "configure-api"
        : props["data-pmx-blocked-open-waiver"] !== undefined
          ? "open-waiver"
          : null;
    if (key && onClick) {
      buttonHandlers.set(key, () => {
        if (!disabled) onClick({} as MouseEvent<HTMLButtonElement>);
      });
    }
    return (
      <button type="button" disabled={Boolean(disabled)} {...props}>
        {children}
      </button>
    );
  },
}));

import {
  ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
  PRISMUX_SUBSCRIPTION_BLOCKED_EVENT,
  SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
  SubscriptionOrchestrationBlockedDialog,
  emitSubscriptionOrchestrationBlocked,
  extractSubscriptionOrchestrationBlockedError,
  formatSubscriptionBlockedCopy,
  resolveBlockedProviderInstanceId,
  type SubscriptionOrchestrationBlockedDetail,
} from "./SubscriptionOrchestrationBlockedDialog";

function installMinimalDom() {
  class MiniNode {
    nodeType: number;
    nodeName: string;
    tagName: string;
    parentNode: MiniNode | null = null;
    childNodes: MiniNode[] = [];
    attributes = new Map<string, string>();
    style: Record<string, unknown> = {
      setProperty(name: string, val: string) {
        this[name] = val;
      },
      removeProperty(name: string) {
        delete this[name];
      },
      getPropertyValue(name: string) {
        return typeof this[name] === "string" ? (this[name] as string) : "";
      },
    };
    textContentVal = "";
    ownerDocument: MiniDocument | null = null;
    namespaceURI = "http://www.w3.org/1999/xhtml";

    constructor(nodeType: number, nodeName: string, doc: MiniDocument | null) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.tagName = nodeName;
      this.ownerDocument = doc;
    }

    get firstChild(): MiniNode | null {
      return this.childNodes[0] ?? null;
    }
    get lastChild(): MiniNode | null {
      return this.childNodes[this.childNodes.length - 1] ?? null;
    }
    get nextSibling(): MiniNode | null {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
    }
    get textContent(): string {
      if (this.nodeType === 3) return this.textContentVal;
      return this.childNodes.map((child) => child.textContent).join("");
    }
    set textContent(val: string) {
      if (this.nodeType === 3) {
        this.textContentVal = String(val ?? "");
      } else {
        this.childNodes = [];
        if (val) {
          this.appendChild(new MiniNode(3, "#text", this.ownerDocument).withText(String(val)));
        }
      }
    }
    get nodeValue(): string {
      return this.textContentVal;
    }
    set nodeValue(val: string) {
      this.textContentVal = String(val ?? "");
    }
    withText(text: string): this {
      this.textContentVal = text;
      return this;
    }
    appendChild(child: MiniNode): MiniNode {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(child: MiniNode, ref: MiniNode | null): MiniNode {
      if (!ref) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      const idx = this.childNodes.indexOf(ref);
      child.parentNode = this;
      if (idx < 0) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
      return child;
    }
    removeChild(child: MiniNode): MiniNode {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) this.childNodes.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
    setAttribute(name: string, val: string): void {
      this.attributes.set(name, String(val));
    }
    removeAttribute(name: string): void {
      this.attributes.delete(name);
    }
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    hasAttribute(name: string): boolean {
      return this.attributes.has(name);
    }
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  class MiniDocument extends MiniNode {
    documentElement: MiniNode;
    head: MiniNode;
    body: MiniNode;
    defaultView: Record<string, unknown> | null = null;
    constructor() {
      super(9, "#document", null);
      this.ownerDocument = this;
      this.documentElement = new MiniNode(1, "HTML", this);
      this.head = new MiniNode(1, "HEAD", this);
      this.body = new MiniNode(1, "BODY", this);
      this.documentElement.appendChild(this.head);
      this.documentElement.appendChild(this.body);
      this.appendChild(this.documentElement);
    }
    createElement(tag: string): MiniNode {
      return new MiniNode(1, tag.toUpperCase(), this);
    }
    createElementNS(_ns: string, tag: string): MiniNode {
      return new MiniNode(1, tag.toUpperCase(), this);
    }
    createTextNode(text: string): MiniNode {
      return new MiniNode(3, "#text", this).withText(text);
    }
    createComment(text: string): MiniNode {
      return new MiniNode(8, "#comment", this).withText(text);
    }
    getElementById(): null {
      return null;
    }
  }

  const doc = new MiniDocument();
  const winListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const MockHTMLIFrameElement = function MockHTMLIFrameElement() {};
  const win: Record<string, unknown> = {
    document: doc,
    navigator: { userAgent: "node" },
    HTMLElement: MiniNode,
    HTMLIFrameElement: MockHTMLIFrameElement,
    Element: MiniNode,
    Node: MiniNode,
    addEventListener: (type: string, fn: (...args: unknown[]) => void) => {
      let bucket = winListeners.get(type);
      if (!bucket) {
        bucket = new Set();
        winListeners.set(type, bucket);
      }
      bucket.add(fn);
    },
    removeEventListener: (type: string, fn: (...args: unknown[]) => void) => {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      const bucket = winListeners.get(event.type);
      if (bucket) {
        for (const fn of bucket) fn(event);
      }
      return true;
    },
  };
  doc.defaultView = win;

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("HTMLElement", MiniNode);
  vi.stubGlobal("HTMLIFrameElement", MockHTMLIFrameElement);
  vi.stubGlobal("Element", MiniNode);
  vi.stubGlobal("Node", MiniNode);
  // oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test enables act environment for deterministic React 19 state flushes and restores via unstubAllGlobals.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const container = doc.createElement("div");
  doc.body.appendChild(container);
  return { container, winListeners };
}

beforeEach(() => {
  buttonHandlers.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SubscriptionOrchestrationBlockedDialog", () => {
  it("formats required interception copy and extracts ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED from daemon/error payloads", () => {
    const detail: SubscriptionOrchestrationBlockedDetail = {
      code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
      providerId: "claudeAgent",
      authMode: "subscription_oauth",
      authLabel: "官方个人订阅 OAuth（默认锁定）",
      settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
    };

    expect(formatSubscriptionBlockedCopy(detail)).toBe(
      "当前 Claude 运行在官方个人订阅模式（官方个人订阅 OAuth（默认锁定）），为避免违反厂商服务条款导致封号，默认禁止参与蜂群或跨代理自动化调用；若你使用 API Key 或 CCS / Magpie 注入 API 模式则不受限制",
    );

    // Direct JSON payload
    expect(
      extractSubscriptionOrchestrationBlockedError({
        ok: false,
        code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
        providerId: "codex",
        authMode: "subscription_oauth",
        authLabel: "ChatGPT 个人订阅",
        settingsRoute: "/settings/providers#subscription-risk-waiver",
      }),
    ).toMatchObject({
      code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
      providerId: "codex",
      authLabel: "ChatGPT 个人订阅",
      settingsRoute: "/settings/providers#subscription-risk-waiver",
    });

    // Wrapped inside PrismuxDaemonError-shaped object with `.details`
    expect(
      extractSubscriptionOrchestrationBlockedError({
        code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
        details: {
          code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
          providerId: "antigravity",
          authLabel: "本机 agy 个人订阅",
        },
      }),
    ).toMatchObject({
      providerId: "antigravity",
      authLabel: "本机 agy 个人订阅",
    });

    // Stringified JSON error message
    expect(
      extractSubscriptionOrchestrationBlockedError(
        'Daemon rejected: {"code":"ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED","providerId":"codex","authLabel":"ChatGPT OAuth"}',
      ),
    ).toMatchObject({
      providerId: "codex",
      authLabel: "ChatGPT OAuth",
    });

    // Canonical provider instance resolution for API config navigation
    expect(resolveBlockedProviderInstanceId("claude-code")).toBe("claudeAgent");
    expect(resolveBlockedProviderInstanceId("codex")).toBe("codex");
    expect(resolveBlockedProviderInstanceId("agy")).toBe("antigravity");
  });

  it("renders interception dialog with exact Chinese copy and wires both direct action buttons + global event dispatch", async () => {
    const detail: SubscriptionOrchestrationBlockedDetail = {
      code: ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED,
      providerId: "codex",
      authMode: "subscription_oauth",
      authLabel: "官方个人订阅 OAuth（默认锁定）",
      settingsRoute: SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
    };

    const html = renderToStaticMarkup(
      <SubscriptionOrchestrationBlockedDialog
        detail={detail}
        onClose={() => undefined}
        onConfigureApi={() => undefined}
        onOpenWaiver={() => undefined}
      />,
    );
    expect(html).toContain('data-pmx-subscription-blocked-dialog="true"');
    expect(html).toContain(
      "当前 Codex 运行在官方个人订阅模式（官方个人订阅 OAuth（默认锁定）），为避免违反厂商服务条款导致封号，默认禁止参与蜂群或跨代理自动化调用；若你使用 API Key 或 CCS / Magpie 注入 API 模式则不受限制",
    );
    expect(html).toContain("配置 API 模式（推荐）");
    expect(html).toContain("前往设置签署免责声明");

    const { container } = installMinimalDom();
    const onClose = vi.fn();
    const onConfigureApi = vi.fn();
    const onOpenWaiver = vi.fn();

    const receivedEvents: unknown[] = [];
    window.addEventListener(PRISMUX_SUBSCRIPTION_BLOCKED_EVENT, (event) => {
      receivedEvents.push((event as CustomEvent).detail);
    });
    emitSubscriptionOrchestrationBlocked(detail);
    expect(receivedEvents).toEqual([detail]);

    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <SubscriptionOrchestrationBlockedDialog
            detail={detail}
            onClose={onClose}
            onConfigureApi={onConfigureApi}
            onOpenWaiver={onOpenWaiver}
          />,
        );
      });

      await act(async () => {
        buttonHandlers.get("configure-api")?.();
      });
      expect(onConfigureApi).toHaveBeenCalledWith(detail);

      await act(async () => {
        buttonHandlers.get("open-waiver")?.();
      });
      expect(onOpenWaiver).toHaveBeenCalledWith(detail);
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
