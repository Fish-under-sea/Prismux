// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test mounts into an in-memory MiniDocument instead of Playwright.
import { act, useEffect } from "react";
// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test explicitly unmounts its React root in finally.
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  prismuxDaemonClient,
  type DaemonSystemPortsResponse,
  type DaemonSystemResourcesResponse,
} from "./daemonClient";
import {
  PrismuxTelemetryProvider,
  usePrismuxTelemetry,
  type PrismuxTelemetryContextValue,
} from "./PrismuxTelemetryContext";

function installMiniDom(): {
  readonly container: unknown;
  readonly restore: () => void;
} {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevHtmlElement = (globalThis as Record<string, unknown>).HTMLElement;
  const prevHtmlIFrameElement = (globalThis as Record<string, unknown>).HTMLIFrameElement;
  const prevElement = (globalThis as Record<string, unknown>).Element;
  const prevNode = (globalThis as Record<string, unknown>).Node;
  const prevActEnv = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

  class MiniNode {
    nodeType: number;
    nodeName: string;
    tagName: string;
    parentNode: MiniNode | null = null;
    childNodes: MiniNode[] = [];
    ownerDocument: MiniDocument | null = null;
    namespaceURI = "http://www.w3.org/1999/xhtml";
    textContentVal = "";
    attributes = new Map<string, string>();
    listeners = new Map<string, Set<(...args: unknown[]) => void>>();

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
    removeChild(child: MiniNode): MiniNode {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    insertBefore(child: MiniNode, ref: MiniNode | null): MiniNode {
      if (!ref) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      const idx = this.childNodes.indexOf(ref);
      child.parentNode = this;
      if (idx >= 0) {
        this.childNodes.splice(idx, 0, child);
      } else {
        this.childNodes.push(child);
      }
      return child;
    }
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, String(value));
    }
    removeAttribute(name: string): void {
      this.attributes.delete(name);
    }
    addEventListener(type: string, fn: (...args: unknown[]) => void): void {
      let set = this.listeners.get(type);
      if (!set) {
        set = new Set();
        this.listeners.set(type, set);
      }
      set.add(fn);
    }
    removeEventListener(type: string, fn: (...args: unknown[]) => void): void {
      this.listeners.get(type)?.delete(fn);
    }
  }

  class MiniDocument extends MiniNode {
    documentElement: MiniNode;
    head: MiniNode;
    body: MiniNode;
    activeElement: MiniNode | null = null;
    visibilityState = "visible";

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
      return new MiniNode(3, "#text", this).withText(String(text));
    }
    createComment(text: string): MiniNode {
      return new MiniNode(8, "#comment", this).withText(String(text));
    }
  }

  const doc = new MiniDocument();
  const container = doc.createElement("div");
  doc.body.appendChild(container);

  const MiniIFrameElement = function MiniIFrameElement() {};
  const win: Record<string, unknown> = {
    document: doc,
    HTMLIFrameElement: MiniIFrameElement,
    HTMLElement: MiniNode,
    Element: MiniNode,
    Node: MiniNode,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).HTMLIFrameElement = MiniIFrameElement;
  (globalThis as Record<string, unknown>).HTMLElement = MiniNode;
  (globalThis as Record<string, unknown>).Element = MiniNode;
  (globalThis as Record<string, unknown>).Node = MiniNode;
  // oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test runs outside Playwright browser runner.
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  return {
    container,
    restore: () => {
      if (prevWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = prevWindow;
      if (prevDocument === undefined) delete (globalThis as Record<string, unknown>).document;
      else (globalThis as Record<string, unknown>).document = prevDocument;
      if (prevHtmlIFrameElement === undefined) {
        delete (globalThis as Record<string, unknown>).HTMLIFrameElement;
      } else {
        (globalThis as Record<string, unknown>).HTMLIFrameElement = prevHtmlIFrameElement;
      }
      if (prevHtmlElement === undefined) delete (globalThis as Record<string, unknown>).HTMLElement;
      else (globalThis as Record<string, unknown>).HTMLElement = prevHtmlElement;
      if (prevElement === undefined) delete (globalThis as Record<string, unknown>).Element;
      else (globalThis as Record<string, unknown>).Element = prevElement;
      if (prevNode === undefined) delete (globalThis as Record<string, unknown>).Node;
      else (globalThis as Record<string, unknown>).Node = prevNode;
      if (prevActEnv === undefined) {
        delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
      } else {
        // oxlint-disable-next-line prismux/require-disposable-render -- Restores prior IS_REACT_ACT_ENVIRONMENT value on teardown.
        (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      }
    },
  };
}

describe("PrismuxTelemetryContext callback stability & polling discipline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps action callback identities stable across snapshot updates without restarting 1.2s warmup or Ports polling", async () => {
    const fetchPortsSpy = vi
      .spyOn(prismuxDaemonClient, "fetchSystemPorts")
      .mockResolvedValue({ ok: true, ports: [] } as DaemonSystemPortsResponse);

    const observedContexts: PrismuxTelemetryContextValue[] = [];
    let resourceEffectMountCount = 0;
    let resourcePollRuns = 0;
    let portsEffectMountCount = 0;
    let portsEffectCleanupCount = 0;

    function StatusBarHarness() {
      const telemetry = usePrismuxTelemetry();
      observedContexts.push(telemetry);

      const { setSystemResourcesSnapshot, setPortsPopoverOpen } = telemetry;

      // Mirrors PrismuxStatusBar's 1.2s warmup + 15s poll effect using destructured stable callback.
      useEffect(() => {
        resourceEffectMountCount += 1;
        const poll = () => {
          resourcePollRuns += 1;
          const snapshot: DaemonSystemResourcesResponse = {
            ok: true,
            collectedAt: resourcePollRuns * 1_000,
            totalCpuPercent: resourcePollRuns,
          };
          setSystemResourcesSnapshot(snapshot);
        };
        const warmup = setTimeout(poll, 1_200);
        const interval = setInterval(poll, 15_000);
        return () => {
          clearTimeout(warmup);
          clearInterval(interval);
        };
      }, [setSystemResourcesSnapshot]);

      // Mirrors PrismuxStatusBar's portsOpen sync effect using destructured stable setter.
      useEffect(() => {
        portsEffectMountCount += 1;
        setPortsPopoverOpen(true);
        return () => {
          portsEffectCleanupCount += 1;
          setPortsPopoverOpen(false);
        };
      }, [setPortsPopoverOpen]);

      return <span>{telemetry.systemResources?.totalCpuPercent ?? 0}</span>;
    }

    const dom = installMiniDom();
    const root = createRoot(dom.container as unknown as Element);

    try {
      await act(async () => {
        root.render(
          <PrismuxTelemetryProvider daemonReady occluded={false}>
            <StatusBarHarness />
          </PrismuxTelemetryProvider>,
        );
      });

      // Initial mount triggers 1 open port scan and 0 resource polls yet.
      expect(resourceEffectMountCount).toBe(1);
      expect(portsEffectMountCount).toBe(1);
      expect(portsEffectCleanupCount).toBe(0);
      expect(fetchPortsSpy).toHaveBeenCalledTimes(1);

      // Advance 1.2s -> warmup fires ONCE and calls setSystemResourcesSnapshot.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(resourcePollRuns).toBe(1);

      // Advance another 10s (well past 1.2s, before 15s interval) -> ZERO extra polls, ZERO ports restarts!
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(resourcePollRuns).toBe(1);
      expect(resourceEffectMountCount).toBe(1);
      expect(portsEffectMountCount).toBe(1);
      expect(portsEffectCleanupCount).toBe(0);
      expect(fetchPortsSpy).toHaveBeenCalledTimes(1);

      // Advance past the 15s interval mark (1.2 + 10 + 4 = 15.2s) -> exactly 1 scheduled interval tick.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(resourcePollRuns).toBe(2);
      expect(resourceEffectMountCount).toBe(1);
      expect(portsEffectCleanupCount).toBe(0);
      expect(fetchPortsSpy).toHaveBeenCalledTimes(1);

      // Verify action callbacks stayed strictly referentially identical across every state update.
      expect(observedContexts.length).toBeGreaterThanOrEqual(3);
      const first = observedContexts[0]!;
      const last = observedContexts.at(-1)!;
      expect(last.systemResources?.totalCpuPercent).toBe(2);
      expect(Object.is(first.setSystemResourcesSnapshot, last.setSystemResourcesSnapshot)).toBe(
        true,
      );
      expect(Object.is(first.setPortsPopoverOpen, last.setPortsPopoverOpen)).toBe(true);
      expect(Object.is(first.refreshSystemResources, last.refreshSystemResources)).toBe(true);
      expect(Object.is(first.refreshSystemPorts, last.refreshSystemPorts)).toBe(true);
      expect(Object.is(first.killSystemPort, last.killSystemPort)).toBe(true);
      expect(Object.is(first.killStalePty, last.killStalePty)).toBe(true);
    } finally {
      await act(async () => {
        root.unmount();
      });
      dom.restore();
    }
  });

  it("ensures PrismuxStatusBar depends on destructured telemetry callbacks rather than the whole telemetry object", () => {
    const statusBarSource = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "PrismuxStatusBar.tsx"),
      "utf8",
    );
    expect(statusBarSource).not.toContain("[runtime, telemetry]");
    expect(statusBarSource).not.toContain("[portsOpen, telemetry]");
    expect(statusBarSource).not.toContain("[portsPopoverRequest, runtime, telemetry]");
    expect(statusBarSource).not.toContain("[activeWorkspaceRoot, runtime, telemetry]");
  });
});
