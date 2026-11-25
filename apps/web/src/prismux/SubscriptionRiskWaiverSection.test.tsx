// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test renders into an in-memory MiniDocument instead of Playwright browser runner.
import { act, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test explicitly unmounts its React root in try/finally.
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { PrismuxDaemonClient } from "./daemonClient";

const switchHandlers = new Map<string, { onChange: (checked: boolean) => void; disabled: boolean; checked: boolean }>();
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
    const key = typeof props["data-pmx-waiver-switch"] === "string"
      ? (props["data-pmx-waiver-switch"] as string)
      : null;
    if (key && onCheckedChange) {
      switchHandlers.set(key, {
        disabled: Boolean(disabled),
        checked: Boolean(checked),
        onChange: (nextChecked: boolean) => {
          if (!disabled) onCheckedChange(nextChecked);
        },
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
      props["data-pmx-waiver-open-modal"] !== undefined
        ? "open-modal"
        : props["data-pmx-waiver-confirm"] !== undefined
          ? "confirm"
          : props["data-pmx-waiver-cancel"] !== undefined
            ? "cancel"
            : props["data-pmx-waiver-revoke"] !== undefined
              ? "revoke"
              : props["data-pmx-probe-refresh"] !== undefined
                ? "probe-refresh"
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
  AGY_UNATTENDED_FORBIDDEN_BADGE_TEXT,
  AGY_WAIVER_REQUIRED_BADGE_TEXT,
  AgyWaiverRequiredBadge,
  LEGACY_ANTIGRAVITY_LOCK_ANCHOR_ID,
  PROVIDERS_PROBE_ENDPOINT,
  SUBSCRIPTION_WAIVER_ANCHOR_ID,
  SUBSCRIPTION_WAIVER_CONFIRM_TEXT,
  SUBSCRIPTION_WAIVER_ENDPOINT,
  SUBSCRIPTION_WAIVER_ROUTE,
  SUBSCRIPTION_WAIVER_VERSION,
  SubscriptionRiskWaiverSection,
  UNIFORM_API_CUSTOM_AUTH_LABEL,
  WAIVER_READ_WAIT_SECONDS,
  isAntigravityControlledAutomationAllowed,
  isAntigravityProviderLike,
  normalizeSubscriptionWaiverResponse,
  resetSubscriptionWaiverStateCache,
  resolveAntigravityComplianceBlock,
  subscribeSubscriptionWaiverState,
  type ProvidersProbeResponse,
  type SubscriptionWaiverState,
} from "./SubscriptionRiskWaiverSection";

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
    className = "";
    type = "";
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
      if (name === "class") this.className = String(val);
      if (name === "disabled") this.disabled = true;
    }
    removeAttribute(name: string): void {
      this.attributes.delete(name);
      if (name === "class") this.className = "";
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
    findByTag(tagName: string): MiniNode | null {
      const normalized = tagName.toUpperCase();
      if (this.tagName === normalized) {
        return this;
      }
      for (const child of this.childNodes) {
        const hit = child.findByTag(normalized);
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
    getElementById(id: string): MiniNode | null {
      return this.findByAttr("id", id);
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
  // oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test enables act environment for deterministic React 19 state flushes and restores via unstubAllGlobals.
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
    await Promise.resolve();
  });
}

const SAMPLE_PROBE_RESPONSE: ProvidersProbeResponse = {
  ok: true,
  generatedAt: "2026-11-25T10:00:00.000Z",
  providers: [
    {
      providerId: "claudeAgent",
      displayName: "Claude Code",
      installed: true,
      version: "2.1.0",
      binaryPath: "C:\\bin\\claude.exe",
      status: "ready",
      authMode: "api_or_custom",
      authSource: "ccs_or_magpie",
      endpoint: "https://ccs.local/v1",
      authLabel: "API / 自定义端点注入（已放行）",
      checkedAt: "2026-11-25T10:00:00.000Z",
    },
    {
      providerId: "codex",
      displayName: "Codex",
      installed: true,
      version: "0.90.0",
      binaryPath: "C:\\bin\\codex.exe",
      status: "ready",
      authMode: "subscription_oauth",
      authSource: "official_oauth",
      endpoint: null,
      authLabel: "官方个人订阅 OAuth（默认锁定）",
      checkedAt: "2026-11-25T10:00:00.000Z",
    },
    {
      providerId: "antigravity",
      displayName: "Antigravity",
      installed: true,
      version: "1.4.2",
      binaryPath: "C:\\bin\\agy.exe",
      status: "ready",
      authMode: "subscription_oauth",
      authSource: "official_oauth",
      endpoint: null,
      authLabel: "官方个人订阅 OAuth（默认锁定）",
      checkedAt: "2026-11-25T10:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  switchHandlers.clear();
  buttonHandlers.clear();
  resetSubscriptionWaiverStateCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SubscriptionRiskWaiverSection", () => {
  it("renders single unified risk waiver card with required anchors, title, and locked switches by default", () => {
    const mockDaemon: Pick<PrismuxDaemonClient, "requestJson"> = {
      requestJson: vi.fn(async () => ({
        signed: false,
        waiverVersion: null,
        signedAt: null,
        allowAntigravityAsControlledAgent: false,
        allowExternalSubscriptionAgentsInSwarm: false,
        defaultLocked: true as const,
      })) as unknown as PrismuxDaemonClient["requestJson"],
    };

    const html = renderToStaticMarkup(<SubscriptionRiskWaiverSection daemon={mockDaemon} />);
    expect(html).toContain(`id="${SUBSCRIPTION_WAIVER_ANCHOR_ID}"`);
    expect(html).toContain(`id="${LEGACY_ANTIGRAVITY_LOCK_ANCHOR_ID}"`);
    expect(html).toContain("个人订阅跨代理编排与自动化风险免责");
    expect(html).toContain("允许个人订阅态 Antigravity (AGY) 作为被控端/接受自动化调用");
    expect(html).toContain(
      "允许将官方个人订阅态外部 Agent（Codex / Claude Code 等）拉入蜂群与跨代理指挥",
    );
    expect(html).toContain('data-pmx-waiver-signed="false"');
    expect(html).toContain('data-pmx-waiver-switches-locked="true"');
    expect(html).not.toContain("订阅态高风险");
    expect(html).not.toContain("撤销免责并恢复硬锁");

    // Defense-in-depth normalizer keeps both switches false when unsigned
    expect(
      normalizeSubscriptionWaiverResponse({
        signed: false,
        allowAntigravityAsControlledAgent: true,
        allowExternalSubscriptionAgentsInSwarm: true,
      }),
    ).toEqual({
      signed: false,
      waiverVersion: null,
      signedAt: null,
      allowAntigravityAsControlledAgent: false,
      allowExternalSubscriptionAgentsInSwarm: false,
      defaultLocked: true,
    });
  });

  it("displays live probe badges, locks both switches until signed, enables switches with amber high-risk badge, and revokes cleanly via DELETE", async () => {
    const { container } = installMinimalDom();
    let serverWaiver: SubscriptionWaiverState = {
      signed: false,
      waiverVersion: null,
      signedAt: null,
      allowAntigravityAsControlledAgent: false,
      allowExternalSubscriptionAgentsInSwarm: false,
      defaultLocked: true,
    };

    const requestJson = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith(PROVIDERS_PROBE_ENDPOINT)) {
        return SAMPLE_PROBE_RESPONSE;
      }
      expect(path).toBe(SUBSCRIPTION_WAIVER_ENDPOINT);
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return serverWaiver;
      }
      if (method === "DELETE") {
        serverWaiver = {
          signed: false,
          waiverVersion: null,
          signedAt: null,
          allowAntigravityAsControlledAgent: false,
          allowExternalSubscriptionAgentsInSwarm: false,
          defaultLocked: true,
        };
        return serverWaiver;
      }
      expect(method).toBe("PUT");
      const body = JSON.parse(String(init?.body ?? "{}")) as Partial<SubscriptionWaiverState>;
      const nextSigned = body.signed ?? serverWaiver.signed;
      serverWaiver = {
        signed: nextSigned,
        waiverVersion: nextSigned
          ? (body.waiverVersion ?? serverWaiver.waiverVersion ?? SUBSCRIPTION_WAIVER_VERSION)
          : null,
        signedAt: nextSigned
          ? (body.signedAt ?? serverWaiver.signedAt ?? "2026-11-25T10:05:00.000Z")
          : null,
        allowAntigravityAsControlledAgent: nextSigned
          ? (body.allowAntigravityAsControlledAgent ??
            serverWaiver.allowAntigravityAsControlledAgent)
          : false,
        allowExternalSubscriptionAgentsInSwarm: nextSigned
          ? (body.allowExternalSubscriptionAgentsInSwarm ??
            serverWaiver.allowExternalSubscriptionAgentsInSwarm)
          : false,
        defaultLocked: true,
      };
      return serverWaiver;
    });

    const onWaiverChange = vi.fn();
    const root = createRoot(container as unknown as Element);

    try {
      await act(async () => {
        root.render(
          <SubscriptionRiskWaiverSection
            daemon={{ requestJson: requestJson as never }}
            onWaiverChange={onWaiverChange}
          />,
        );
      });
      await flushMicrotasks();

      // 1. Live probe badges distinguish CCS/Magpie API injection vs Official OAuth subscription
      expect(container.textContent).toContain("API / 自定义端点注入（已放行）");
      expect(container.textContent).toContain("官方个人订阅 OAuth（默认锁定）");
      expect(container.textContent).toContain("https://ccs.local/v1");
      expect(container.findByAttr("data-pmx-probe-auth-mode", "api_or_custom")).not.toBeNull();
      expect(
        container.findByAttr("data-pmx-probe-auth-mode", "subscription_oauth"),
      ).not.toBeNull();

      // 2. Both granular switches are strictly disabled/locked grey before signing
      expect(switchHandlers.get("agy-controlled")?.disabled).toBe(true);
      expect(switchHandlers.get("external-swarm")?.disabled).toBe(true);
      expect(switchHandlers.get("agy-controlled")?.checked).toBe(false);
      expect(switchHandlers.get("external-swarm")?.checked).toBe(false);

      // 3. Open unified signing modal covering Google Antigravity, Anthropic Claude, and OpenAI Codex
      vi.useFakeTimers();
      await act(async () => {
        buttonHandlers.get("open-modal")?.onClick();
      });
      const modal = container.findByAttr("data-pmx-waiver-modal");
      expect(modal).not.toBeNull();
      expect(modal?.textContent).toContain("Google Antigravity");
      expect(modal?.textContent).toContain("Anthropic Claude");
      expect(modal?.textContent).toContain("OpenAI Codex");
      expect(modal?.textContent).toContain(SUBSCRIPTION_WAIVER_VERSION);
      expect(modal?.textContent).toContain(
        "Prismux 仅作为纯本地开源编排工具，不介入账号鉴权且不承担任何平台风控或订阅损失连带责任",
      );
      expect(container.findByAttr("data-waiver-countdown", String(WAIVER_READ_WAIT_SECONDS))).not.toBeNull();
      expect(container.findByAttr("data-waiver-confirm-input", "1")).toBeNull();
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      // 4. Wait full 5-second reading gate, type full waiver disclaimer into single-line input, then sign
      await act(async () => {
        vi.advanceTimersByTime(WAIVER_READ_WAIT_SECONDS * 1000);
      });
      expect(container.findByAttr("data-waiver-countdown")).toBeNull();
      const inputNode = container.findByAttr("data-waiver-confirm-input", "1");
      expect(inputNode).not.toBeNull();
      expect(inputNode?.tagName).toBe("INPUT");
      expect(inputNode?.type).toBe("text");
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      const onInputChange = getReactProps(inputNode)?.onChange as
        | ((event: ChangeEvent<HTMLInputElement>) => void)
        | undefined;
      await act(async () => {
        onInputChange?.({
          target: { value: SUBSCRIPTION_WAIVER_CONFIRM_TEXT },
        } as ChangeEvent<HTMLInputElement>);
      });
      expect(buttonHandlers.get("confirm")?.disabled).toBe(false);
      vi.useRealTimers();

      await act(async () => {
        buttonHandlers.get("confirm")?.onClick();
      });
      await flushMicrotasks();

      // Modal closes, waiver signed, revoke button appears, BOTH switches unlocked (still false)
      expect(container.findByAttr("data-pmx-waiver-modal")).toBeNull();
      expect(container.textContent).toContain("撤销免责并恢复硬锁");
      expect(switchHandlers.get("agy-controlled")?.disabled).toBe(false);
      expect(switchHandlers.get("external-swarm")?.disabled).toBe(false);
      expect(switchHandlers.get("agy-controlled")?.checked).toBe(false);
      expect(switchHandlers.get("external-swarm")?.checked).toBe(false);
      expect(container.findByAttr("data-pmx-waiver-high-risk-badge")).toBeNull();

      // Verify PUT payload included signed: true + v3-unified-2026 + signedAt
      const signCall = requestJson.mock.calls.find(
        ([path, init]) => path === SUBSCRIPTION_WAIVER_ENDPOINT && init?.method === "PUT",
      );
      expect(signCall).toBeDefined();
      const signBody = JSON.parse(String(signCall?.[1]?.body)) as Record<string, unknown>;
      expect(signBody.signed).toBe(true);
      expect(signBody.waiverVersion).toBe("v3-unified-2026");
      expect(typeof signBody.signedAt).toBe("string");

      // 5. Toggle Switch A ON
      await act(async () => {
        switchHandlers.get("agy-controlled")?.onChange(true);
      });
      await flushMicrotasks();
      expect(switchHandlers.get("agy-controlled")?.checked).toBe(true);
      expect(switchHandlers.get("external-swarm")?.checked).toBe(false);

      // 6. Toggle Switch B ON -> subtle amber 「订阅态高风险」 badge renders!
      await act(async () => {
        switchHandlers.get("external-swarm")?.onChange(true);
      });
      await flushMicrotasks();
      expect(switchHandlers.get("external-swarm")?.checked).toBe(true);
      const riskBadge = container.findByAttr("data-pmx-waiver-high-risk-badge");
      expect(riskBadge).not.toBeNull();
      expect(riskBadge?.textContent).toContain("订阅态高风险");

      // 7. Click 1-click 「撤销免责并恢复硬锁」 -> sends DELETE and immediately resets & locks BOTH switches!
      await act(async () => {
        buttonHandlers.get("revoke")?.onClick();
      });
      await flushMicrotasks();

      const deleteCall = requestJson.mock.calls.find(
        ([path, init]) => path === SUBSCRIPTION_WAIVER_ENDPOINT && init?.method === "DELETE",
      );
      expect(deleteCall).toBeDefined();
      expect(switchHandlers.get("agy-controlled")?.disabled).toBe(true);
      expect(switchHandlers.get("external-swarm")?.disabled).toBe(true);
      expect(switchHandlers.get("agy-controlled")?.checked).toBe(false);
      expect(switchHandlers.get("external-swarm")?.checked).toBe(false);
      expect(container.findByAttr("data-pmx-waiver-high-risk-badge")).toBeNull();
      expect(onWaiverChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          signed: false,
          allowAntigravityAsControlledAgent: false,
          allowExternalSubscriptionAgentsInSwarm: false,
          defaultLocked: true,
        }),
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it("renders uniform API / 自定义端点注入（已放行） across Claude, Codex, and DeepSeek Harness and broadcasts waiver changes immediately", async () => {
    const { container } = installMinimalDom();
    const mixedApiProbes: ProvidersProbeResponse = {
      ok: true,
      generatedAt: "2026-11-25T15:00:00.000Z",
      providers: [
        {
          providerId: "claudeAgent",
          displayName: "Claude Code (claude)",
          installed: true,
          version: "2.1.0",
          binaryPath: "C:\\bin\\claude.exe",
          status: "ready",
          authMode: "api_or_custom",
          authSource: "custom_endpoint",
          endpoint: "http://127.0.0.1:3426",
          authLabel: "API / 自定义端点注入（已放行）",
          checkedAt: "2026-11-25T15:00:00.000Z",
        },
        {
          providerId: "codex",
          displayName: "Codex (codex)",
          installed: true,
          version: "0.90.0",
          binaryPath: "C:\\bin\\codex.exe",
          status: "ready",
          authMode: "api_or_custom",
          authSource: "ccs_or_magpie",
          endpoint: "http://127.0.0.1:3426/v1",
          // Even if an older daemon snapshot passes a legacy label, UI normalizes uniformly!
          authLabel: "CCS / Magpie API 注入（已放行）",
          checkedAt: "2026-11-25T15:00:00.000Z",
        },
        {
          providerId: "dsh",
          displayName: "DeepSeek Harness",
          installed: true,
          version: "0.2.2-rc.4",
          binaryPath: "C:\\bin\\dsh.exe",
          status: "ready",
          authMode: "api_or_custom",
          authSource: "api_key",
          endpoint: null,
          authLabel: "API / 自定义端点注入（已放行）",
          checkedAt: "2026-11-25T15:00:00.000Z",
        },
      ],
    };

    const observedStates: SubscriptionWaiverState[] = [];
    const unsubscribe = subscribeSubscriptionWaiverState((state) => {
      observedStates.push(state);
    });

    const requestJson = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith(PROVIDERS_PROBE_ENDPOINT)) return mixedApiProbes;
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}")) as Partial<SubscriptionWaiverState>;
        return {
          signed: body.signed ?? true,
          waiverVersion: SUBSCRIPTION_WAIVER_VERSION,
          signedAt: "2026-11-25T15:10:00.000Z",
          allowAntigravityAsControlledAgent: body.allowAntigravityAsControlledAgent ?? false,
          allowExternalSubscriptionAgentsInSwarm: false,
          defaultLocked: true as const,
        };
      }
      return {
        signed: true,
        waiverVersion: SUBSCRIPTION_WAIVER_VERSION,
        signedAt: "2026-11-25T15:10:00.000Z",
        allowAntigravityAsControlledAgent: false,
        allowExternalSubscriptionAgentsInSwarm: false,
        defaultLocked: true as const,
      };
    });

    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => {
        root.render(<SubscriptionRiskWaiverSection daemon={{ requestJson: requestJson as never }} />);
      });
      await flushMicrotasks();

      const claudeBadge = container.findByAttr("data-pmx-probe-auth-badge", "claudeAgent");
      const codexBadge = container.findByAttr("data-pmx-probe-auth-badge", "codex");
      const dshBadge = container.findByAttr("data-pmx-probe-auth-badge", "dsh");
      expect(claudeBadge?.textContent).toContain(UNIFORM_API_CUSTOM_AUTH_LABEL);
      expect(codexBadge?.textContent).toContain(UNIFORM_API_CUSTOM_AUTH_LABEL);
      expect(dshBadge?.textContent).toContain(UNIFORM_API_CUSTOM_AUTH_LABEL);
      expect(codexBadge?.textContent).not.toContain("CCS / Magpie API 注入（已放行）");

      // Enabling Switch A broadcasts immediately so Text Generation pickers unlock AGY live.
      expect(isAntigravityControlledAutomationAllowed(observedStates.at(-1))).toBe(false);
      await act(async () => {
        switchHandlers.get("agy-controlled")?.onChange(true);
      });
      await flushMicrotasks();
      expect(isAntigravityControlledAutomationAllowed(observedStates.at(-1))).toBe(true);
    } finally {
      unsubscribe();
      await act(async () => {
        root.unmount();
      });
    }
  });

  it("exports reusable AGY compliance helpers and red-bordered AgyWaiverRequiredBadge", () => {
    expect(SUBSCRIPTION_WAIVER_ROUTE).toBe("/settings/providers#subscription-risk-waiver");

    expect(isAntigravityProviderLike("antigravity")).toBe(true);
    expect(isAntigravityProviderLike("agy")).toBe(true);
    expect(isAntigravityProviderLike("antigravity-cli")).toBe(true);
    expect(isAntigravityProviderLike("acpRegistry:agy")).toBe(true);
    expect(isAntigravityProviderLike("codex")).toBe(false);
    expect(isAntigravityProviderLike("dsh")).toBe(false);
    expect(isAntigravityProviderLike(null)).toBe(false);

    const onOpenWaiver = vi.fn();
    const unsignedWaiver = { signed: false, allowAntigravityAsControlledAgent: false };
    const signedLockedWaiver = { signed: true, allowAntigravityAsControlledAgent: false };
    const signedAllowedWaiver = { signed: true, allowAntigravityAsControlledAgent: true };

    // Controlled automation blocks AGY until signed + switch A ON
    expect(
      resolveAntigravityComplianceBlock({
        entry: { driverKind: "antigravity", instanceId: "antigravity" },
        waiver: unsignedWaiver,
        mode: "controlled",
        onOpenWaiver,
      })?.badgeText,
    ).toBe(AGY_WAIVER_REQUIRED_BADGE_TEXT);
    expect(
      resolveAntigravityComplianceBlock({
        entry: { driverKind: "antigravity", instanceId: "antigravity" },
        waiver: signedLockedWaiver,
        mode: "controlled",
        onOpenWaiver,
      })?.badgeText,
    ).toBe(AGY_WAIVER_REQUIRED_BADGE_TEXT);
    expect(
      resolveAntigravityComplianceBlock({
        entry: { driverKind: "antigravity", instanceId: "antigravity" },
        waiver: signedAllowedWaiver,
        mode: "controlled",
        onOpenWaiver,
      }),
    ).toBeNull();
    expect(
      resolveAntigravityComplianceBlock({
        entry: { driverKind: "codex", instanceId: "codex" },
        waiver: unsignedWaiver,
        mode: "controlled",
        onOpenWaiver,
      }),
    ).toBeNull();

    // Unattended / cron permanently blocks personal AGY (showing 需签署免责 when unsigned, 无人值守禁止个人 AGY · 查看合规 when signed)
    expect(
      resolveAntigravityComplianceBlock({
        entry: { driverKind: "antigravity", instanceId: "antigravity" },
        waiver: unsignedWaiver,
        mode: "unattended",
        onOpenWaiver,
      })?.badgeText,
    ).toBe(AGY_WAIVER_REQUIRED_BADGE_TEXT);
    expect(
      resolveAntigravityComplianceBlock({
        entry: { driverKind: "antigravity", instanceId: "antigravity" },
        waiver: signedAllowedWaiver,
        mode: "unattended",
        onOpenWaiver,
      })?.badgeText,
    ).toBe(AGY_UNATTENDED_FORBIDDEN_BADGE_TEXT);

    const badgeHtml = renderToStaticMarkup(<AgyWaiverRequiredBadge onClick={onOpenWaiver} />);
    expect(badgeHtml).toContain("需签署免责");
    expect(badgeHtml).toContain("border-destructive");
    expect(badgeHtml).toContain("text-destructive");
    expect(badgeHtml).toContain('data-pmx-agy-waiver-badge="true"');
  });

  it("orders live probe badges by settings.providerOrder and renders configured custom display names", async () => {
    const codexId = ProviderInstanceId.make("codex");
    const claudeId = ProviderInstanceId.make("claudeAgent");
    const agyId = ProviderInstanceId.make("antigravity");
    const mockProviders: ServerProvider[] = [
      {
        instanceId: codexId,
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-11-26T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
      {
        instanceId: claudeId,
        driver: ProviderDriverKind.make("claudeAgent"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-11-26T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
      {
        instanceId: agyId,
        driver: ProviderDriverKind.make("antigravity"),
        enabled: true,
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-11-26T00:00:00.000Z",
        models: [],
        slashCommands: [],
        skills: [],
      },
    ];
    const daemon: Pick<PrismuxDaemonClient, "requestJson"> = {
      requestJson: vi.fn(async (endpoint: string) => {
        if (endpoint.startsWith(PROVIDERS_PROBE_ENDPOINT)) {
          return {
            ok: true,
            generatedAt: "2026-11-26T00:00:00.000Z",
            providers: [
              {
                providerId: "codex",
                displayName: "Codex",
                installed: true,
                version: "1.0.0",
                binaryPath: "codex",
                status: "ready",
                authMode: "subscription_oauth",
                authSource: "official_oauth",
                endpoint: null,
                authLabel: "官方个人订阅 OAuth（默认锁定）",
                checkedAt: "2026-11-26T00:00:00.000Z",
              },
              {
                providerId: "claude-code",
                displayName: "Claude Code",
                installed: true,
                version: "1.0.0",
                binaryPath: "claude",
                status: "ready",
                authMode: "api_or_custom",
                authSource: "ccs_or_magpie",
                endpoint: "https://proxy.example.com",
                authLabel: UNIFORM_API_CUSTOM_AUTH_LABEL,
                checkedAt: "2026-11-26T00:00:00.000Z",
              },
              {
                providerId: "antigravity",
                displayName: "Antigravity",
                installed: true,
                version: "1.0.0",
                binaryPath: "agy",
                status: "ready",
                authMode: "subscription_oauth",
                authSource: "official_oauth",
                endpoint: null,
                authLabel: "官方个人订阅 OAuth（默认锁定）",
                checkedAt: "2026-11-26T00:00:00.000Z",
              },
            ],
          } as never;
        }
        return {
          signed: false,
          waiverVersion: null,
          signedAt: null,
          allowAntigravityAsControlledAgent: false,
          allowExternalSubscriptionAgentsInSwarm: false,
          defaultLocked: true,
        } as never;
      }),
    };

    const { container } = installMinimalDom();
    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <SubscriptionRiskWaiverSection
            daemon={daemon}
            serverProvidersOverride={mockProviders}
            settingsOverride={{
              providerOrder: [claudeId, agyId, codexId],
              providerInstances: {
                [claudeId]: {
                  driver: ProviderDriverKind.make("claudeAgent"),
                  enabled: true,
                  displayName: "主力 Claude",
                },
                [agyId]: {
                  driver: ProviderDriverKind.make("antigravity"),
                  enabled: true,
                  displayName: "我的 AGY",
                },
                [codexId]: {
                  driver: ProviderDriverKind.make("codex"),
                  enabled: true,
                  displayName: "备用 Codex",
                },
              },
              projectSettingsOverrides: {},
            }}
          />,
        );
      });
      await flushMicrotasks();

      const probeList = container.findByAttr("data-pmx-probe-badge-list", "true");
      const providerNodes = (probeList?.childNodes ?? []).filter(
        (node) => node.getAttribute("data-pmx-probe-provider") !== null,
      );
      expect(providerNodes.map((node) => node.getAttribute("data-pmx-probe-provider"))).toEqual([
        "claude-code",
        "antigravity",
        "codex",
      ]);
      expect(providerNodes[0]?.textContent).toContain("主力 Claude");
      expect(providerNodes[1]?.textContent).toContain("我的 AGY");
      expect(providerNodes[2]?.textContent).toContain("备用 Codex");
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  });

  it("enforces dual-layer frosted glass blur, 5s countdown gate, single-line full disclaimer confirmation without copy button/copy hints, and resets on close", async () => {
    expect(WAIVER_READ_WAIT_SECONDS).toBe(5);
    expect(SUBSCRIPTION_WAIVER_CONFIRM_TEXT).toBe(
      "我已完整阅读并充分知晓：将 Google Antigravity、Anthropic Claude 或 OpenAI Codex 的官方个人订阅 OAuth 账号用于蜂群或跨代理自动化调用，存在违反厂商服务条款、触发限流、账号冻结及 403 封号等高风险；签署本免责不代表免疫任何平台风控，Prismux 作为纯本地工具不承担由此引发的账号或订阅损失责任，本人自愿承担全部后果。",
    );

    const { container } = installMinimalDom();
    const requestJson = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith(PROVIDERS_PROBE_ENDPOINT)) {
        return SAMPLE_PROBE_RESPONSE;
      }
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body ?? "{}")) as Partial<SubscriptionWaiverState>;
        return {
          signed: body.signed ?? true,
          waiverVersion: body.waiverVersion ?? SUBSCRIPTION_WAIVER_VERSION,
          signedAt: body.signedAt ?? "2026-11-25T21:00:00.000Z",
          allowAntigravityAsControlledAgent: false,
          allowExternalSubscriptionAgentsInSwarm: false,
          defaultLocked: true as const,
        };
      }
      return {
        signed: false,
        waiverVersion: null,
        signedAt: null,
        allowAntigravityAsControlledAgent: false,
        allowExternalSubscriptionAgentsInSwarm: false,
        defaultLocked: true as const,
      };
    });

    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <SubscriptionRiskWaiverSection daemon={{ requestJson: requestJson as never }} />,
        );
      });
      await flushMicrotasks();

      vi.useFakeTimers();

      // Open modal -> starts 5s countdown, hides input, applies dual-layer frosted blur
      await act(async () => {
        buttonHandlers.get("open-modal")?.onClick();
      });

      const backdrop = container.findByAttr("data-pmx-waiver-modal-backdrop", "true");
      const modal = container.findByAttr("data-pmx-waiver-modal", "true");
      expect(backdrop).not.toBeNull();
      expect(modal).not.toBeNull();

      // Dual-layer frosted glass & backdropFilter fallback assertions
      expect(backdrop?.className).toContain("bg-black/60");
      expect(backdrop?.className).toContain("backdrop-blur-md");
      expect(backdrop?.style.backdropFilter).toBe("blur(12px)");
      expect(backdrop?.style.WebkitBackdropFilter).toBe("blur(12px)");

      expect(modal?.getAttribute("data-pmx-glass-zone")).toBe("overlays");
      expect(modal?.className).toContain("backdrop-blur-2xl");
      expect(modal?.className).toContain("rgba(255,255,255,0.92)");
      expect(modal?.className).toContain("rgba(18,22,32,0.88)");
      expect(modal?.style.backdropFilter).toBe("blur(24px) saturate(160%)");
      expect(modal?.style.WebkitBackdropFilter).toBe("blur(24px) saturate(160%)");

      // Countdown steps 5 -> 4 -> 3 -> 2 -> 1 while input remains hidden and confirm stays disabled
      expect(container.findByAttr("data-waiver-countdown", "5")).not.toBeNull();
      expect(container.findByAttr("data-waiver-confirm-input", "1")).toBeNull();
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(container.findByAttr("data-waiver-countdown", "2")).not.toBeNull();
      expect(container.findByAttr("data-waiver-confirm-input", "1")).toBeNull();
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      // Closing early cancels timer and resets countdown back to 5 on next open
      await act(async () => {
        buttonHandlers.get("cancel")?.onClick();
      });
      expect(container.findByAttr("data-pmx-waiver-modal")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      await act(async () => {
        buttonHandlers.get("open-modal")?.onClick();
      });
      expect(container.findByAttr("data-waiver-countdown", "5")).not.toBeNull();
      expect(container.findByAttr("data-waiver-confirm-input", "1")).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      expect(container.findByAttr("data-waiver-countdown", "1")).not.toBeNull();
      expect(container.findByAttr("data-waiver-confirm-input", "1")).toBeNull();
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      // Final 1s completes countdown -> single-line input confirmation replaces checkbox
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.findByAttr("data-waiver-countdown")).toBeNull();

      const activeModal = container.findByAttr("data-pmx-waiver-modal", "true");
      expect(activeModal).not.toBeNull();
      expect(activeModal?.findByTag("TEXTAREA")).toBeNull();
      expect(activeModal?.findByAttr("data-pmx-waiver-checkbox")).toBeNull();
      expect(activeModal?.textContent).toContain("请完整输入以下免责声明以确认签署：");
      expect(activeModal?.textContent).not.toContain("可复制");
      expect(activeModal?.textContent).not.toContain("支持复制");
      expect(activeModal?.textContent).not.toContain("复制声明");
      expect(activeModal?.textContent).not.toContain("粘贴");

      // Selectable disclaimer display card uses natural select-text / user-select: text
      const confirmTextCard = container.findByAttr("data-pmx-waiver-confirm-text", "true");
      expect(confirmTextCard).not.toBeNull();
      expect(confirmTextCard?.textContent).toBe(SUBSCRIPTION_WAIVER_CONFIRM_TEXT);
      expect(confirmTextCard?.className).toContain("select-text");
      expect(confirmTextCard?.style.userSelect).toBe("text");

      // Single-line text input verification
      const confirmInput = container.findByAttr("data-waiver-confirm-input", "1");
      expect(confirmInput).not.toBeNull();
      expect(confirmInput?.tagName).toBe("INPUT");
      expect(confirmInput?.type).toBe("text");
      expect(confirmInput?.getAttribute("aria-label")).toBe("输入完整免责声明");
      expect(confirmInput?.getAttribute("placeholder")).toBe("请完整输入上方免责声明…");
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      const triggerInput = async (value: string) => {
        const onChange = getReactProps(container.findByAttr("data-waiver-confirm-input", "1"))
          ?.onChange as ((event: ChangeEvent<HTMLInputElement>) => void) | undefined;
        await act(async () => {
          onChange?.({ target: { value } } as ChangeEvent<HTMLInputElement>);
        });
      };

      // Partial / mismatched input keeps confirm disabled
      await triggerInput(SUBSCRIPTION_WAIVER_CONFIRM_TEXT.slice(0, 24));
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);
      expect(container.findByAttr("data-waiver-confirm-status", "mismatch")).not.toBeNull();

      // Closing clears typed text and resets countdown to 5
      await act(async () => {
        buttonHandlers.get("cancel")?.onClick();
      });
      await act(async () => {
        buttonHandlers.get("open-modal")?.onClick();
      });
      expect(container.findByAttr("data-waiver-countdown", "5")).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(WAIVER_READ_WAIT_SECONDS * 1000);
      });
      expect(container.findByAttr("data-waiver-confirm-input", "1")?.value ?? "").toBe("");
      expect(buttonHandlers.get("confirm")?.disabled).toBe(true);

      // Exact disclaimer with leading/trailing whitespace matches and unlocks signing
      await triggerInput(`  \n${SUBSCRIPTION_WAIVER_CONFIRM_TEXT}\n  `);
      expect(container.findByAttr("data-waiver-confirm-status", "matched")?.textContent).toContain(
        "已匹配完整免责声明，可点击签署",
      );
      expect(buttonHandlers.get("confirm")?.disabled).toBe(false);

      vi.useRealTimers();
      await act(async () => {
        buttonHandlers.get("confirm")?.onClick();
      });
      await flushMicrotasks();

      const putCall = requestJson.mock.calls.find(
        ([path, init]) => path === SUBSCRIPTION_WAIVER_ENDPOINT && init?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const putBody = JSON.parse(String(putCall?.[1]?.body)) as Record<string, unknown>;
      expect(putBody.signed).toBe(true);
      expect(putBody.waiverVersion).toBe("v3-unified-2026");
      expect(container.findByAttr("data-pmx-waiver-modal")).toBeNull();
    } finally {
      vi.useRealTimers();
      await act(async () => {
        root.unmount();
      });
    }
  });
});
