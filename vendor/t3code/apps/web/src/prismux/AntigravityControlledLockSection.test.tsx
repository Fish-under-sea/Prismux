// oxlint-disable-next-line t3code/require-disposable-render -- Headless Node unit test renders into an in-memory MiniDocument instead of Playwright browser runner.
import { act, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
// oxlint-disable-next-line t3code/require-disposable-render -- Headless Node unit test explicitly unmounts its React root in try/finally.
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PrismuxDaemonClient } from "./daemonClient";

// Lightweight handler registries for headless React 19 interaction testing (zero jsdom overhead).
const switchHandlers = new Map<string, (checked: boolean) => void>();
const buttonHandlers = new Map<string, { onClick: () => void; disabled: boolean }>();

vi.mock("../components/ui/switch", () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    [key: string]: unknown;
  }) => {
    if (props["data-pmx-agy-controlled-switch"] !== undefined && onCheckedChange) {
      switchHandlers.set("agy-controlled", (nextChecked: boolean) => {
        if (!disabled) onCheckedChange(nextChecked);
      });
    }
    return (
      <input
        type="checkbox"
        role="switch"
        readOnly
        checked={Boolean(checked)}
        disabled={Boolean(disabled)}
        {...props}
      />
    );
  },
}));

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
      props["data-pmx-agy-disclaimer-confirm"] !== undefined
        ? "confirm"
        : props["data-pmx-agy-disclaimer-cancel"] !== undefined
          ? "cancel"
          : null;
    if (key && onClick) {
      buttonHandlers.set(key, {
        disabled: Boolean(disabled),
        onClick: () => {
          if (!disabled) onClick({} as MouseEvent<HTMLButtonElement>);
        },
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
  ANTIGRAVITY_CONTROLLED_DEFAULT_ENABLED,
  ANTIGRAVITY_CONTROLLED_DEFAULT_LOCKED,
  ANTIGRAVITY_DISCLAIMER_VERSION,
  ANTIGRAVITY_POLICY_ENDPOINT,
  AntigravityControlledLockSection,
  type AntigravityPolicyState,
} from "./AntigravityControlledLockSection";

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
    listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    textContentVal = "";
    value = "";
    checked = false;
    disabled = false;
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
      if (name === "disabled") this.disabled = true;
    }
    removeAttribute(name: string): void {
      this.attributes.delete(name);
      if (name === "disabled") this.disabled = false;
    }
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    hasAttribute(name: string): boolean {
      return this.attributes.has(name);
    }
    addEventListener(type: string, fn: (...args: unknown[]) => void): void {
      let bucket = this.listeners.get(type);
      if (!bucket) {
        bucket = new Set();
        this.listeners.set(type, bucket);
      }
      bucket.add(fn);
    }
    removeEventListener(type: string, fn: (...args: unknown[]) => void): void {
      this.listeners.get(type)?.delete(fn);
    }
    dispatchEvent(event: Record<string, unknown>): boolean {
      const type = String(event.type ?? "");
      event.target ??= this;
      event.currentTarget = this;
      const bucket = this.listeners.get(type);
      if (bucket) {
        for (const fn of bucket) fn(event);
      }
      if (event.bubbles && this.parentNode) {
        this.parentNode.dispatchEvent(event);
      }
      return true;
    }
    findByAttr(attrName: string, attrValue?: string): MiniNode | null {
      const actual = this.attributes.get(attrName);
      if (actual !== undefined && (attrValue === undefined || actual === attrValue)) {
        return this;
      }
      for (const child of this.childNodes) {
        const hit = child.findByAttr(attrName, attrValue);
        if (hit) return hit;
      }
      return null;
    }
  }

  class MiniDocument extends MiniNode {
    documentElement: MiniNode;
    head: MiniNode;
    body: MiniNode;
    defaultView: Record<string, unknown> | null = null;
    activeElement: MiniNode | null = null;

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
    Event: class MockEvent {
      type: string;
      bubbles: boolean;
      constructor(type: string, init?: { bubbles?: boolean }) {
        this.type = type;
        this.bubbles = Boolean(init?.bubbles);
      }
    },
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
  };
  doc.defaultView = win;

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("HTMLElement", MiniNode);
  vi.stubGlobal("HTMLIFrameElement", MockHTMLIFrameElement);
  vi.stubGlobal("Element", MiniNode);
  vi.stubGlobal("Node", MiniNode);
  // oxlint-disable-next-line t3code/require-disposable-render -- Headless Node unit test enables act environment for deterministic React 19 state flushes and restores via unstubAllGlobals.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  const container = doc.createElement("div");
  doc.body.appendChild(container);
  return { doc, container };
}

function getReactProps(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const propsKey = Object.keys(node as Record<string, unknown>).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!propsKey) return null;
  const raw = (node as Record<string, unknown>)[propsKey];
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  switchHandlers.clear();
  buttonHandlers.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AntigravityControlledLockSection", () => {
  it("defaults strictly locked with 默认锁定（仅总控） badge on initial static render", () => {
    expect(ANTIGRAVITY_CONTROLLED_DEFAULT_LOCKED).toBe(true);
    expect(ANTIGRAVITY_CONTROLLED_DEFAULT_ENABLED).toBe(false);

    const mockDaemon: Pick<PrismuxDaemonClient, "requestJson"> = {
      requestJson: vi.fn(async () => ({
        allowAntigravityAsControlledAgent: false,
        disclaimerAcceptedAt: null,
        disclaimerVersion: null,
        defaultLocked: true as const,
      })) as unknown as PrismuxDaemonClient["requestJson"],
    };

    const html = renderToStaticMarkup(<AntigravityControlledLockSection daemon={mockDaemon} />);
    expect(html).toContain('data-pmx-agy-controlled-lock="true"');
    expect(html).toContain('data-pmx-agy-lock-state="locked"');
    expect(html).toContain('data-pmx-agy-lock-badge="locked"');
    expect(html).toContain("默认锁定（仅总控）");
    expect(html).not.toContain("已签署免责解锁");
    expect(html).not.toContain('data-pmx-agy-disclaimer-modal="true"');
  });

  it("opens mandatory risk disclaimer modal on enable, gates confirm button on checkbox, persists PUT with disclaimerAccepted, and re-locks immediately on disable", async () => {
    const { container } = installMinimalDom();
    let serverPolicy: AntigravityPolicyState = {
      allowAntigravityAsControlledAgent: false,
      disclaimerAcceptedAt: null,
      disclaimerVersion: null,
      defaultLocked: true,
    };

    const requestJson = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe(ANTIGRAVITY_POLICY_ENDPOINT);
      if (!init?.method || init.method === "GET") {
        return serverPolicy;
      }
      expect(init.method).toBe("PUT");
      const body = JSON.parse(String(init.body ?? "{}")) as {
        allowAntigravityAsControlledAgent: boolean;
        disclaimerAccepted?: boolean;
        disclaimerVersion?: string;
      };
      if (body.allowAntigravityAsControlledAgent) {
        expect(body.disclaimerAccepted).toBe(true);
        expect(body.disclaimerVersion).toBe(ANTIGRAVITY_DISCLAIMER_VERSION);
        serverPolicy = {
          allowAntigravityAsControlledAgent: true,
          disclaimerAcceptedAt: "2026-11-25T09:30:00.000Z",
          disclaimerVersion: body.disclaimerVersion ?? ANTIGRAVITY_DISCLAIMER_VERSION,
          defaultLocked: true,
        };
      } else {
        serverPolicy = {
          allowAntigravityAsControlledAgent: false,
          disclaimerAcceptedAt: serverPolicy.disclaimerAcceptedAt,
          disclaimerVersion: serverPolicy.disclaimerVersion,
          defaultLocked: true,
        };
      }
      return serverPolicy;
    });

    const onPolicyChange = vi.fn();
    const root = createRoot(container as unknown as Element);

    try {
      await act(async () => {
        root.render(
          <AntigravityControlledLockSection
            daemon={{ requestJson: requestJson as never }}
            onPolicyChange={onPolicyChange}
          />,
        );
      });
      await flushMicrotasks();

      // 1. Initial GET loaded locked state
      expect(requestJson).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("默认锁定（仅总控）");
      expect(container.findByAttr("data-pmx-agy-disclaimer-modal")).toBeNull();

      // 2. Trying to turn ON opens modal WITHOUT sending PUT yet
      await act(async () => {
        switchHandlers.get("agy-controlled")?.(true);
      });
      expect(requestJson).toHaveBeenCalledTimes(1);
      const modal = container.findByAttr("data-pmx-agy-disclaimer-modal");
      expect(modal).not.toBeNull();
      expect(modal?.textContent).toContain("403");
      expect(modal?.textContent).toContain("封号");
      expect(modal?.textContent).toContain("企业版");
      expect(modal?.textContent).toContain("API Key");
      expect(modal?.textContent).toContain("后果自负");

      // 3. Confirm button is locked/disabled before checkbox is ticked
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      // 4. Cancel closes modal with ZERO PUT calls and keeps switch locked
      await act(async () => {
        buttonHandlers.get("cancel")?.onClick();
      });
      expect(container.findByAttr("data-pmx-agy-disclaimer-modal")).toBeNull();
      expect(requestJson).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain("默认锁定（仅总控）");

      // 5. Re-open modal, tick mandatory checkbox, then click confirm
      await act(async () => {
        switchHandlers.get("agy-controlled")?.(true);
      });
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      const checkboxNode = container.findByAttr("data-pmx-agy-disclaimer-checkbox");
      expect(checkboxNode).not.toBeNull();
      const checkboxProps = getReactProps(checkboxNode);
      const onCheckboxChange = checkboxProps?.onChange as
        | ((event: ChangeEvent<HTMLInputElement>) => void)
        | undefined;
      expect(typeof onCheckboxChange).toBe("function");

      await act(async () => {
        onCheckboxChange?.({
          target: { checked: true },
        } as ChangeEvent<HTMLInputElement>);
      });
      expect(buttonHandlers.get("confirm")?.disabled).toBe(false);

      await act(async () => {
        buttonHandlers.get("confirm")?.onClick();
      });
      await flushMicrotasks();

      expect(requestJson).toHaveBeenCalledTimes(2);
      const putCall = requestJson.mock.calls[1]!;
      expect(putCall[0]).toBe(ANTIGRAVITY_POLICY_ENDPOINT);
      expect(putCall[1]?.method).toBe("PUT");
      expect(JSON.parse(String(putCall[1]?.body))).toEqual({
        allowAntigravityAsControlledAgent: true,
        disclaimerAccepted: true,
        disclaimerVersion: "v3-2026",
      });
      expect(container.findByAttr("data-pmx-agy-disclaimer-modal")).toBeNull();
      expect(container.textContent).toContain("已签署免责解锁");

      // 6. Turning OFF immediately persists false (re-locks) without opening modal
      await act(async () => {
        switchHandlers.get("agy-controlled")?.(false);
      });
      await flushMicrotasks();

      expect(requestJson).toHaveBeenCalledTimes(3);
      const lockOffCall = requestJson.mock.calls[2]!;
      expect(lockOffCall[1]?.method).toBe("PUT");
      expect(JSON.parse(String(lockOffCall[1]?.body))).toEqual({
        allowAntigravityAsControlledAgent: false,
      });
      expect(container.findByAttr("data-pmx-agy-disclaimer-modal")).toBeNull();
      expect(container.textContent).toContain("默认锁定（仅总控）");
      expect(onPolicyChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          allowAntigravityAsControlledAgent: false,
          defaultLocked: true,
        }),
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it("stays strictly locked and displays error message if daemon rejects unlock PUT", async () => {
    const { container } = installMinimalDom();
    const requestJson = vi.fn(async (_path: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return {
          allowAntigravityAsControlledAgent: false,
          disclaimerAcceptedAt: null,
          disclaimerVersion: null,
          defaultLocked: true as const,
        };
      }
      throw new Error("AGY_DISCLAIMER_REQUIRED: 服务端拒绝解锁");
    });

    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <AntigravityControlledLockSection daemon={{ requestJson: requestJson as never }} />,
        );
      });
      await flushMicrotasks();

      await act(async () => {
        switchHandlers.get("agy-controlled")?.(true);
      });
      const checkboxNode = container.findByAttr("data-pmx-agy-disclaimer-checkbox");
      const onCheckboxChange = getReactProps(checkboxNode)?.onChange as
        | ((event: ChangeEvent<HTMLInputElement>) => void)
        | undefined;
      await act(async () => {
        onCheckboxChange?.({
          target: { checked: true },
        } as ChangeEvent<HTMLInputElement>);
      });
      await act(async () => {
        buttonHandlers.get("confirm")?.onClick();
      });
      await flushMicrotasks();

      expect(container.findByAttr("data-pmx-agy-disclaimer-modal")).not.toBeNull();
      expect(container.textContent).toContain("AGY_DISCLAIMER_REQUIRED");
      expect(container.textContent).toContain("默认锁定（仅总控）");
      expect(container.textContent).not.toContain("已签署免责解锁");
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });
});
