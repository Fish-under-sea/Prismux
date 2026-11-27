import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type PrismuxDispatchEnvelope,
  type ServerProvider,
} from "@prismux/core-contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@prismux/core-contracts/settings";
import { GTProvider, initializeGT } from "gt-react";
// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test renders into an in-memory MiniDocument instead of Playwright browser runner.
import { act, createElement, useEffect, type ReactNode } from "react";
// oxlint-disable-next-line prismux/require-disposable-render -- Headless Node unit test explicitly unmounts its React root.
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockNavigate = vi.fn(() => Promise.resolve());

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    hash,
    ...props
  }: {
    children?: unknown;
    to?: string;
    hash?: string;
    [key: string]: unknown;
  }) => (
    <a
      href={typeof to === "string" ? (hash ? `${to}#${hash}` : to) : undefined}
      data-hash={hash}
      {...props}
    >
      {children as never}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useLocation: (opts?: {
    select?: (loc: { hash: string; pathname: string; state: Record<string, unknown> }) => unknown;
  }) => {
    const loc = { hash: "", pathname: "/settings/memory", state: {} };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

const selectHandlers = new Map<string, (value: string | null) => void>();
let effortSliderHandler: ((value: string) => void) | null = null;

vi.mock("@prismux/appearance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismux/appearance")>();
  return {
    ...actual,
    PrismuxReasoningEffortSlider: (props: {
      readonly value?: string;
      readonly label?: string;
      readonly onChange?: (value: string) => void;
    }) => {
      effortSliderHandler = props.onChange ?? null;
      return (
        <div data-pmx-mock-effort-slider="" data-value={props.value ?? ""}>
          {props.label ?? ""}
        </div>
      );
    },
  };
});

vi.mock("../../components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (val: string | null) => void;
    children?: ReactNode;
  }) => (
    <div
      data-mock-select=""
      data-mock-select-value={value ?? ""}
      ref={(el) => {
        if (!el || !onValueChange) return;
        const trigger = el.querySelector(
          "[data-pmx-chief-provider-select],[data-pmx-chief-model-select],[data-pmx-memory-ns-filter],[data-pmx-memory-create-kind]",
        );
        if (trigger?.hasAttribute("data-pmx-chief-provider-select")) {
          selectHandlers.set("provider", onValueChange);
        } else if (trigger?.hasAttribute("data-pmx-chief-model-select")) {
          selectHandlers.set("model", onValueChange);
        } else if (trigger?.hasAttribute("data-pmx-memory-ns-filter")) {
          selectHandlers.set("memoryNs", onValueChange);
        } else if (trigger?.hasAttribute("data-pmx-memory-create-kind")) {
          selectHandlers.set("memoryKind", onValueChange);
        }
      }}
    >
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  SelectPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    value,
    children,
    ...props
  }: {
    value: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => (
    <div data-mock-select-item={value} {...props}>
      {children}
    </div>
  ),
}));

import { PrismuxDaemonClient, PrismuxDaemonError } from "../daemonClient";
import {
  CHIEF_SLOT_UPDATED_EVENT,
  PrismuxChiefStatusPill,
  emitChiefSlotUpdated,
  resetLastKnownChiefSlotForTests,
} from "../PrismuxChiefStatusPill";
import {
  PrismuxDispatchConfirmationBanner,
  buildChiefDispatchPrompt,
  buildDispatchModelSelection,
  handlePrismuxDispatchEnvelope,
  isChiefDispatchEnvelope,
  isChiefWorkspacePathLike,
  type DispatchExecutionDeps,
  type StagedPrismuxDispatch,
} from "../PrismuxIpcDispatchBridge";
import {
  PrismuxRuntimeProvider,
  usePrismuxRuntime,
  type PrismuxRuntimeContextValue,
} from "../PrismuxRuntimeProvider";
import { resetSubscriptionWaiverStateCache } from "../SubscriptionRiskWaiverSection";
import {
  ChiefIdentityAndAgentsMdSection,
  mergeChiefIdentityHeaderIntoDirtyAgentsMd,
} from "./ChiefIdentityAndAgentsMdSection";
import { ObsidianAgentImportCard, isValidObsidianTargetNamespace } from "./ObsidianAgentImportCard";
import {
  MEMORY_KIND_OPTIONS,
  PrismuxMemoryEngineSection,
  isValidMemoryNamespaceInput,
  normalizeMemoryKind,
  resolveMemoryNamespacesForFilter,
} from "./PrismuxMemoryEngineSection";
import {
  PrismuxMemorySettingsPage,
  buildChiefModelDropdownItems,
  buildChiefProviderOptions,
  resolveChiefEffortSpec,
} from "./PrismuxMemorySyncSettingsPage";

function installEventedMiniDom() {
  class MiniNode {
    nodeType: number;
    nodeName: string;
    tagName: string;
    parentNode: MiniNode | null = null;
    childNodes: MiniNode[] = [];
    attributes = new Map<string, string>();
    dataset: Record<string, string> = {};
    innerHTML = "";
    classSet = new Set<string>();
    classList = {
      add: (...tokens: string[]) => {
        for (const token of tokens) {
          this.classSet.add(token);
        }
      },
      remove: (...tokens: string[]) => {
        for (const token of tokens) {
          this.classSet.delete(token);
        }
      },
      toggle: (token: string, force?: boolean) => {
        const shouldHave = force ?? !this.classSet.has(token);
        if (shouldHave) {
          this.classSet.add(token);
        } else {
          this.classSet.delete(token);
        }
        return shouldHave;
      },
      contains: (token: string) => this.classSet.has(token),
    };
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
      return this.childNodes.map((c) => c.textContent).join("");
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
    remove(): void {
      this.parentNode?.removeChild(this);
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
    setAttributeNS(_ns: string | null, name: string, value: string): void {
      this.attributes.set(name, String(value));
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
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 600, height: 28, right: 600, bottom: 28 };
    }
    getContext() {
      return null;
    }
    focus() {}
    querySelector(selector: string): MiniNode | null {
      const matchers = selector
        .split(",")
        .map((s) => s.trim())
        .map((s) => /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .map((m) => ({ attr: m[1]!, val: m[2] }));
      const visit = (node: MiniNode): MiniNode | null => {
        for (const { attr, val } of matchers) {
          if (val === undefined ? node.hasAttribute(attr) : node.getAttribute(attr) === val) {
            return node;
          }
        }
        for (const child of node.childNodes) {
          const hit = visit(child);
          if (hit) return hit;
        }
        return null;
      };
      return visit(this);
    }
    querySelectorAll(selector: string): MiniNode[] {
      const hit = this.querySelector(selector);
      return hit ? [hit] : [];
    }
    contains(other: MiniNode | null): boolean {
      let cur: MiniNode | null = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
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
    createElementNS(ns: string, tag: string): MiniNode {
      const el = new MiniNode(1, tag.toUpperCase(), this);
      el.namespaceURI = ns;
      return el;
    }
    createTextNode(text: string): MiniNode {
      return new MiniNode(3, "#text", this).withText(String(text));
    }
    createComment(text: string): MiniNode {
      return new MiniNode(8, "#comment", this).withText(String(text));
    }
    getElementById(id: string): MiniNode | null {
      const visit = (node: MiniNode): MiniNode | null => {
        if (node.getAttribute("id") === id) return node;
        for (const child of node.childNodes) {
          const hit = visit(child);
          if (hit) return hit;
        }
        return null;
      };
      return visit(this.documentElement);
    }
  }

  const doc = new MiniDocument();
  const windowListeners = new Map<string, Set<(event: Event) => void>>();
  const storageMap = new Map<string, string>();
  const storage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => {
      storageMap.set(key, String(val));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
  };
  const win = {
    document: doc,
    location: {
      href: "http://localhost/settings/memory",
      origin: "http://localhost",
      hash: "",
      pathname: "/settings/memory",
      search: "",
    },
    localStorage: storage,
    HTMLIFrameElement: function MiniIFrameElement() {},
    HTMLElement: MiniNode,
    Element: MiniNode,
    Node: MiniNode,
    navigator: { userAgent: "node" },
    addEventListener: (type: string, fn: (event: Event) => void) => {
      let set = windowListeners.get(type);
      if (!set) {
        set = new Set();
        windowListeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener: (type: string, fn: (event: Event) => void) => {
      windowListeners.get(type)?.delete(fn);
    },
    dispatchEvent: (event: Event) => {
      for (const fn of Array.from(windowListeners.get(event.type) ?? [])) {
        fn(event);
      }
      return true;
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    },
    cancelAnimationFrame: () => undefined,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  const prev = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    HTMLElement: (globalThis as Record<string, unknown>).HTMLElement,
    Element: (globalThis as Record<string, unknown>).Element,
    Node: (globalThis as Record<string, unknown>).Node,
    requestAnimationFrame: (globalThis as Record<string, unknown>).requestAnimationFrame,
    cancelAnimationFrame: (globalThis as Record<string, unknown>).cancelAnimationFrame,
    getComputedStyle: (globalThis as Record<string, unknown>).getComputedStyle,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
  };

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).HTMLElement = MiniNode;
  (globalThis as Record<string, unknown>).Element = MiniNode;
  (globalThis as Record<string, unknown>).Node = MiniNode;
  (globalThis as Record<string, unknown>).requestAnimationFrame = win.requestAnimationFrame;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = win.cancelAnimationFrame;
  (globalThis as Record<string, unknown>).getComputedStyle = win.getComputedStyle;
  // oxlint-disable-next-line prismux/require-disposable-render -- Headless Node MiniDocument test enables React act() explicitly and restores it in cleanup().
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  return {
    document: doc,
    window: win,
    cleanup() {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) {
          delete (globalThis as Record<string, unknown>)[key];
        } else {
          (globalThis as Record<string, unknown>)[key] = value;
        }
      }
    },
  };
}

function getReactProps(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== "object") {
    throw new Error("Expected MiniNode");
  }
  const key = Object.keys(node as Record<string, unknown>).find((k) =>
    k.startsWith("__reactProps$"),
  );
  if (!key) {
    throw new Error("Missing __reactProps$ on MiniNode");
  }
  return (node as Record<string, unknown>)[key] as Record<string, unknown>;
}

function invokeClick(node: unknown): void {
  const props = getReactProps(node);
  const onClick = props.onClick as ((event?: unknown) => void) | undefined;
  if (typeof onClick !== "function") {
    throw new Error("Expected onClick handler on node");
  }
  onClick({ preventDefault: () => {}, stopPropagation: () => {} });
}

function invokeChange(node: unknown, value: string): void {
  const props = getReactProps(node);
  const onChange = props.onChange as ((event: { target: { value: string } }) => void) | undefined;
  if (typeof onChange !== "function") {
    throw new Error("Expected onChange handler on node");
  }
  onChange({ target: { value } });
}

function makeMockProvider(input: {
  instanceId: string;
  driver: string;
  displayName?: string;
  enabled?: boolean;
  acpRegistryAgentId?: string;
  models: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.acpRegistryAgentId ? { acpRegistryAgentId: input.acpRegistryAgentId } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-27T00:00:00.000Z",
    models: input.models,
    slashCommands: [],
    skills: [],
  } as unknown as ServerProvider;
}

const FIXED_TEST_EPOCH = 1_795_756_000_000;

describe("Chief Secretary Full-Flow Audit Regressions (7 Dimensions)", () => {
  let dom: ReturnType<typeof installEventedMiniDom> | null = null;

  beforeAll(async () => {
    await initializeGT({
      defaultLocale: "zh",
      locales: ["en", "zh"],
      loadTranslations: async () => ({}),
      cacheExpiryTime: null,
    });
  });

  beforeEach(() => {
    dom = installEventedMiniDom();
    mockNavigate.mockClear();
    selectHandlers.clear();
    effortSliderHandler = null;
    resetSubscriptionWaiverStateCache();
    resetLastKnownChiefSlotForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom?.cleanup();
    dom = null;
  });

  it("Dim 1: unwraps JSON tuple model slugs cleanly in Chief options, fallback items, and reasoning family detection", () => {
    const tupleProvider = makeMockProvider({
      instanceId: "acpRegistry_dsh",
      driver: "acpRegistry",
      displayName: "DeepSeek Harness",
      acpRegistryAgentId: "dsh",
      models: [
        {
          slug: '["magpie","group/deepseek-reasoner"]',
          name: '["magpie","group/deepseek-reasoner"]',
          isCustom: false,
          isDefault: true,
        } as ServerProvider["models"][number],
      ],
    });

    const options = buildChiefProviderOptions({
      serverProviders: [tupleProvider],
      settings: null,
    });
    const dsh = options.find((o) => o.value === "dsh");
    expect(dsh?.models[0]?.slug).toBe('["magpie","group/deepseek-reasoner"]');
    expect(dsh?.models[0]?.label).toBe("group/deepseek-reasoner");
    expect(dsh?.models[0]?.label).not.toContain('["magpie"');
    expect(dsh?.models[0]?.subtitle ?? "").not.toContain('["magpie"');

    const fallbackItems = buildChiefModelDropdownItems({
      providerOption: dsh,
      selectedModel: '["magpie","claude-opus-4-6"]',
    });
    expect(fallbackItems[0]?.slug).toBe('["magpie","claude-opus-4-6"]');
    expect(fallbackItems[0]?.label).toBe("当前配置：claude-opus-4-6");
    expect(fallbackItems[0]?.label).not.toContain('["magpie"');

    const claudeEffortSpec = resolveChiefEffortSpec({
      provider: "dsh",
      modelSlug: '["magpie","claude-opus-4-6"]',
    });
    expect(claudeEffortSpec.familyId).toBe("claude");
    expect(claudeEffortSpec.stops.some((stop) => stop.value === "ultracode")).toBe(true);
  });

  it("Dim 1: aligns daemonClient memory/obsidian/chief endpoints with Track A backend contracts", async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" && init.body.length > 0
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null;
      calls.push({ url, method, body });

      if (url.endsWith("/v1/memory/search")) {
        return new Response(
          JSON.stringify({
            ok: true,
            hits: [
              {
                id: "m-1",
                namespace: "private/chief",
                kind: "preference",
                title: "语言偏好",
                content: "始终使用简体中文",
              },
            ],
            totalCandidates: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true, id: "m-1", deleted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const prevUrl = (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_URL__;
    const prevToken = (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_TOKEN__;
    (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_URL__ = "http://127.0.0.1:4199";
    (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_TOKEN__ = "tok";
    const client = new PrismuxDaemonClient();
    try {
      const searchRes = await client.searchMemory({
        query: "中文",
        namespace: "private/chief",
        limit: 5,
      });
      expect(searchRes.hits).toHaveLength(1);
      expect(searchRes.results).toHaveLength(1);
      expect(searchRes.items).toHaveLength(1);
      expect(calls[0]?.body).toEqual({
        query: "中文",
        limit: 5,
        namespaces: ["private/chief"],
      });

      await client.upsertMemory({
        namespace: "private/chief",
        kind: "fact",
        title: "单一架构",
        content: "使用 SQLite 单文件记忆",
        sourceRef: "manual-ui",
      });
      expect(calls[1]?.url).toContain("/v1/memory/upsert");
      expect(calls[1]?.method).toBe("POST");
      expect(calls[1]?.body).toMatchObject({
        kind: "fact",
        sourceRef: "manual-ui",
      });

      await client.deleteMemory("mem-abc-123");
      expect(calls[2]?.url).toContain("/v1/memory/entries/mem-abc-123");
      expect(calls[2]?.method).toBe("DELETE");

      await client.importObsidian({
        vaultPath: "D:\\Notes\\Vault",
        namespace: "workspace/prismux",
      });
      expect(calls[3]?.url).toContain("/v1/memory/import-obsidian");
      expect(calls[3]?.body).toEqual({
        vaultPath: "D:\\Notes\\Vault",
        targetNamespace: "workspace/prismux",
      });
    } finally {
      if (prevUrl === undefined) {
        delete (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_URL__;
      } else {
        (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_URL__ = prevUrl;
      }
      if (prevToken === undefined) {
        delete (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_TOKEN__;
      } else {
        (globalThis as Record<string, unknown>).__PRISMUX_DAEMON_TOKEN__ = prevToken;
      }
      fetchSpy.mockRestore();
    }
  });

  it("Dim 1: saves full Chief payload (including secretaryName & dialMode), broadcasts immediately to RuntimeProvider, and uses full-width settings container", async () => {
    const providers = [
      makeMockProvider({
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        models: [
          { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false } as ServerProvider["models"][number],
        ],
      }),
      makeMockProvider({
        instanceId: "acpRegistry_dsh",
        driver: "acpRegistry",
        displayName: "DeepSeek Harness",
        acpRegistryAgentId: "dsh",
        models: [
          {
            slug: '["magpie","group/deepseek-v4"]',
            name: "DeepSeek V4",
            isCustom: false,
            isDefault: true,
          } as ServerProvider["models"][number],
        ],
      }),
    ];

    // Verify full-width container (max-w-none) on /settings/memory
    const staticHtml = renderToStaticMarkup(
      <GTProvider locale="zh" translations={{}}>
        <PrismuxMemorySettingsPage
          serverProvidersOverride={providers}
          settingsOverride={null}
          daemonReadyOverride
          initialTabOverride="chief"
        />
      </GTProvider>,
    );
    expect(staticHtml).toContain("max-w-none");

    const switchChiefSpy = vi.fn(async (payload: Record<string, unknown>) => ({
      ok: true,
      slot: {
        threadId: "chief-main",
        provider: String(payload.provider ?? "dsh"),
        activeProvider: String(payload.provider ?? "dsh"),
        model: String(payload.model ?? ""),
        reasoningEffort: String(payload.reasoningEffort ?? ""),
        secretaryName: String(payload.secretaryName ?? "小棱"),
        agentsMdPath: "~/.prismux/chief/AGENTS.md",
        updatedAt: FIXED_TEST_EPOCH,
      },
      secretaryName: String(payload.secretaryName ?? "小棱"),
      agentsMdPath: "~/.prismux/chief/AGENTS.md",
      dialMode: (payload.dialMode as "agent" | "oracle" | "review") ?? "oracle",
      coreConnected: true,
    }));

    const mockDaemon = {
      requestJson: vi.fn(async (endpoint: string) => {
        if (endpoint === "/v1/chief") {
          return {
            ok: true,
            slot: {
              threadId: "chief-main",
              provider: "codex",
              activeProvider: "codex",
              model: "gpt-5.4",
              reasoningEffort: "medium",
              secretaryName: "小棱",
              agentsMdPath: "~/.prismux/chief/AGENTS.md",
            },
            secretaryName: "小棱",
            agentsMdPath: "~/.prismux/chief/AGENTS.md",
            dialMode: "agent",
            coreConnected: true,
          };
        }
        if (endpoint === "/v1/chief/agents-md") {
          return {
            ok: true,
            path: "~/.prismux/chief/AGENTS.md",
            content: "# AGENTS",
            secretaryName: "小棱",
            updatedAt: FIXED_TEST_EPOCH,
            exists: true,
          };
        }
        return { ok: true };
      }),
      switchChief: switchChiefSpy,
      triggerSyncNow: vi.fn(async () => ({ ok: true })),
      testSyncConnection: vi.fn(async () => ({ ok: true })),
    };

    const runtimeBox: { current: PrismuxRuntimeContextValue | null } = { current: null };
    function RuntimeProbe({
      onRuntime,
    }: {
      readonly onRuntime: (value: PrismuxRuntimeContextValue) => void;
    }) {
      const value = usePrismuxRuntime();
      useEffect(() => {
        onRuntime(value);
      }, [onRuntime, value]);
      return null;
    }

    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxRuntimeProvider>
            <RuntimeProbe
              onRuntime={(val) => {
                runtimeBox.current = val;
              }}
            />
            <PrismuxMemorySettingsPage
              serverProvidersOverride={providers}
              settingsOverride={null}
              daemonOverride={mockDaemon as never}
              daemonReadyOverride
              initialTabOverride="chief"
            />
          </PrismuxRuntimeProvider>
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Switch provider -> DSH, model -> tuple model, effort -> xhigh, save
    await act(async () => {
      selectHandlers.get("provider")?.("dsh");
    });
    await act(async () => {
      selectHandlers.get("model")?.('["magpie","group/deepseek-v4"]');
    });
    await act(async () => {
      effortSliderHandler?.("xhigh");
    });

    expect(container.querySelector("[data-pmx-chief-dirty-badge]")).not.toBeNull();

    await act(async () => {
      invokeClick(container.querySelector("[data-pmx-chief-save-button]"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(switchChiefSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "dsh",
        model: '["magpie","group/deepseek-v4"]',
        reasoningEffort: "xhigh",
        defaultEffort: "xhigh",
        dialMode: "agent",
        secretaryName: "小棱",
      }),
    );

    // RuntimeProvider synced immediately via CHIEF_SLOT_UPDATED_EVENT
    expect(runtimeBox.current?.chiefProvider).toBe("dsh");
    expect(runtimeBox.current?.chiefSlot.model).toBe('["magpie","group/deepseek-v4"]');
    expect(runtimeBox.current?.chiefSlot.reasoningEffort).toBe("xhigh");
    expect(runtimeBox.current?.chiefSlot.secretaryName).toBe("小棱");
    // Status banner shows friendly model name, never leaks raw JSON tuple
    expect(container.textContent).toContain("DeepSeek V4");
    expect(container.textContent).not.toContain('["magpie"');
    // Unsaved badge clears after save
    expect(container.querySelector("[data-pmx-chief-dirty-badge]")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("Dim 2: preserves dirty AGENTS.md edits when renaming Chief Secretary and never broadcasts uncommitted dropdown drafts", async () => {
    const serverInitial = [
      "<!-- prismux:chief-identity:begin -->",
      "当前主秘书称呼：主秘书",
      "<!-- prismux:chief-identity:end -->",
      "",
      "原始正文段落。",
    ].join("\n");
    const serverRenamed = [
      "<!-- prismux:chief-identity:begin -->",
      "当前主秘书称呼：小棱",
      "<!-- prismux:chief-identity:end -->",
      "",
      "原始正文段落。",
    ].join("\n");

    const merged = mergeChiefIdentityHeaderIntoDirtyAgentsMd(
      serverInitial.replace("原始正文段落。", "我刚写的未保存工作纪律！"),
      serverRenamed,
    );
    expect(merged).toContain("当前主秘书称呼：小棱");
    expect(merged).toContain("我刚写的未保存工作纪律！");

    const broadcastDetails: Array<Record<string, unknown>> = [];
    dom!.window.addEventListener(CHIEF_SLOT_UPDATED_EVENT, (ev: Event) => {
      broadcastDetails.push((ev as CustomEvent<Record<string, unknown>>).detail);
    });

    let agentsMdReadCount = 0;
    const mockDaemon = {
      requestJson: vi.fn(async (endpoint: string, init?: RequestInit) => {
        if (endpoint === "/v1/chief/agents-md" && (!init?.method || init.method === "GET")) {
          agentsMdReadCount += 1;
          return {
            ok: true,
            path: "~/.prismux/chief/AGENTS.md",
            content: agentsMdReadCount === 1 ? serverInitial : serverRenamed,
            secretaryName: agentsMdReadCount === 1 ? "主秘书" : "小棱",
            updatedAt: FIXED_TEST_EPOCH,
            exists: true,
          };
        }
        if (endpoint === "/v1/chief/profile" && init?.method === "PUT") {
          return {
            ok: true,
            slot: { provider: "codex", secretaryName: "小棱" },
            secretaryName: "小棱",
            agentsMdPath: "~/.prismux/chief/AGENTS.md",
          };
        }
        return { ok: true };
      }),
    };

    const uncommittedDraftRef = {
      current: {
        provider: "dsh",
        providerLabel: "DeepSeek Harness",
        model: "deepseek-v4-pro",
        reasoningEffort: "max",
        dialMode: "oracle" as const,
      },
    };

    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <ChiefIdentityAndAgentsMdSection
            daemon={mockDaemon as never}
            secretaryName="主秘书"
            agentsMdPath="~/.prismux/chief/AGENTS.md"
            activeProvider="codex"
            activeProviderLabel="Codex"
            activeModel="gpt-5.4"
            activeEffort="medium"
            activeDialMode="agent"
            activeSlotRef={uncommittedDraftRef}
          />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const editor = container.querySelector("[data-pmx-chief-agents-md-editor]");
    const dirtyDraft = serverInitial.replace("原始正文段落。", "我的未保存重要指令");
    await act(async () => {
      invokeChange(editor, dirtyDraft);
    });

    const nameInput = container.querySelector("[data-pmx-chief-name-input]");
    await act(async () => {
      invokeChange(nameInput, "小棱");
    });

    // Find "保存称呼" button inside [data-pmx-chief-identity-controls]
    const controls = container.querySelector("[data-pmx-chief-identity-controls]");
    const saveNameBtn = controls?.childNodes.find(
      (node) => node.tagName === "BUTTON" && node.textContent.includes("保存称呼"),
    );
    expect(saveNameBtn).toBeDefined();

    await act(async () => {
      invokeClick(saveNameBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Unsaved draft prose survived rename, while identity header refreshed!
    const editorProps = getReactProps(container.querySelector("[data-pmx-chief-agents-md-editor]"));
    expect(String(editorProps.value)).toContain("当前主秘书称呼：小棱");
    expect(String(editorProps.value)).toContain("我的未保存重要指令");

    // Topbar broadcast carried COMMITTED codex slot, NOT uncommitted dsh draft!
    expect(broadcastDetails.at(-1)).toMatchObject({
      provider: "codex",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      dialMode: "agent",
      secretaryName: "小棱",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("Dim 3: renders PrismuxChiefStatusPill with unwrapped tuple models, high-contrast glass classes, and canonical provider labels", () => {
    emitChiefSlotUpdated({
      provider: "claude-code",
      model: '["magpie","claude-opus-4-6"]',
      reasoningEffort: "high",
      dialMode: "oracle",
      secretaryName: "主秘书",
      agentsMdPath: "~/.prismux/chief/AGENTS.md",
    });

    const glassHtml = renderToStaticMarkup(
      createElement(PrismuxChiefStatusPill, {
        online: true,
        isGlassActive: true,
      }),
    );
    expect(glassHtml).toContain("Claude");
    expect(glassHtml).not.toContain("Claude Code");
    expect(glassHtml).toContain("claude-opus-4-6");
    expect(glassHtml).not.toContain('["magpie"');
    // Light/dark glass safe surface contrast classes (WCAG >= 4.5:1)
    expect(glassHtml).toContain("bg-background/72");
    expect(glassHtml).toContain("dark:bg-black/42");
  });

  it("Dim 4: supports 3-domain memory filtering, empty-query browsing, manual create, inline edit, and DELETE /v1/memory/entries/:id", async () => {
    // Strictly align manual create/edit kinds with protocol MEMORY_KINDS
    const allowedMemoryKinds = ["episodic", "fact", "preference", "member_profile", "handoff_note"];
    expect(MEMORY_KIND_OPTIONS.map((item) => item.value).sort()).toEqual(
      [...allowedMemoryKinds].sort(),
    );
    expect(normalizeMemoryKind("knowledge")).toBe("fact");
    expect(normalizeMemoryKind("experience")).toBe("episodic");
    expect(normalizeMemoryKind("handoff_note")).toBe("handoff_note");

    expect(isValidMemoryNamespaceInput("private/chief")).toBe(true);
    expect(isValidMemoryNamespaceInput("workspace/prismux")).toBe(true);
    expect(isValidMemoryNamespaceInput("social/qq-group-10086")).toBe(true);
    expect(isValidMemoryNamespaceInput("workspace/*")).toBe(false);

    expect(
      resolveMemoryNamespacesForFilter({
        domain: "workspace",
        exactNamespace: "all",
        byNamespace: {
          "private/chief": 3,
          "workspace/prismux": 2,
          "workspace/docs": 1,
          "social/qq-group-99": 4,
        },
      }),
    ).toEqual({ namespaces: ["workspace/prismux", "workspace/docs"] });

    expect(
      resolveMemoryNamespacesForFilter({
        domain: "qq_group",
        exactNamespace: "all",
        byNamespace: { "private/chief": 3 },
      }),
    ).toEqual({ emptyDomain: true });

    const records = [
      {
        id: "mem-1",
        namespace: "private/chief",
        kind: "preference",
        title: "回复风格",
        content: "结论先行，使用中文",
        tags: ["style"],
        updatedAt: FIXED_TEST_EPOCH,
      },
      {
        id: "mem-2",
        namespace: "workspace/prismux",
        kind: "fact",
        title: "记忆引擎选型",
        content: "纯本地单文件 SQLite",
        tags: ["sqlite"],
        updatedAt: FIXED_TEST_EPOCH,
      },
    ];
    const searchBodies: Array<Record<string, unknown>> = [];
    const upsertBodies: Array<Record<string, unknown>> = [];
    const deletedUrls: string[] = [];

    const mockDaemon = {
      requestJson: vi.fn(async (endpoint: string, init?: RequestInit) => {
        if (endpoint === "/v1/memory/stats") {
          const byNamespace: Record<string, number> = {};
          for (const rec of records) {
            byNamespace[rec.namespace] = (byNamespace[rec.namespace] ?? 0) + 1;
          }
          return {
            ok: true,
            callerScope: "owner_chief",
            totalEntries: records.length,
            vectorSearchEnabled: true,
            sqliteVecLoaded: true,
            retrievalMode: "fts5+sqlite-vec",
            byNamespace,
            byKind: { preference: 1, fact: 1 },
            latestUpdatedAt: FIXED_TEST_EPOCH,
            dbSizeBytes: 65536,
            dbPath: "~/.prismux/data/memory.db",
          };
        }
        if (endpoint === "/v1/memory/search" && init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
          searchBodies.push(body);
          const filterNs = Array.isArray(body.namespaces) ? (body.namespaces as string[]) : null;
          const matched = records.filter((rec) => !filterNs || filterNs.includes(rec.namespace));
          return {
            ok: true,
            hits: matched.map((entry) => ({ entry, score: 0.9, matchSource: "fts" })),
            totalCandidates: matched.length,
            degradedToFtsOnly: false,
          };
        }
        if (endpoint === "/v1/memory/upsert" && init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
          upsertBodies.push(body);
          // Enforce real DaemonRpcServer.ts MEMORY_KINDS validation
          if (!allowedMemoryKinds.includes(String(body.kind ?? ""))) {
            throw new PrismuxDaemonError(`Invalid memory kind: "${String(body.kind ?? "")}".`, {
              status: 400,
              code: "invalid_params",
            });
          }
          const existingIdx = records.findIndex((rec) => rec.id === body.id);
          if (existingIdx >= 0) {
            records[existingIdx] = {
              ...records[existingIdx]!,
              title: String(body.title ?? ""),
              content: String(body.content ?? ""),
              kind: String(body.kind ?? "fact"),
            };
          } else {
            records.push({
              id: `mem-${records.length + 1}`,
              namespace: String(body.namespace ?? "private/chief"),
              kind: String(body.kind ?? "fact"),
              title: String(body.title ?? ""),
              content: String(body.content ?? ""),
              tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
              updatedAt: FIXED_TEST_EPOCH,
            });
          }
          return { ok: true };
        }
        if (endpoint.startsWith("/v1/memory/entries/") && init?.method === "DELETE") {
          deletedUrls.push(endpoint);
          const id = decodeURIComponent(endpoint.slice("/v1/memory/entries/".length));
          const idx = records.findIndex((rec) => rec.id === id);
          if (idx >= 0) {
            records.splice(idx, 1);
            return { ok: true, id, deleted: true, deletedAt: FIXED_TEST_EPOCH };
          }
          throw new PrismuxDaemonError("Not found", { status: 404, code: "MEMORY_NOT_FOUND" });
        }
        return { ok: true };
      }),
    };

    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxMemoryEngineSection
            daemon={mockDaemon as never}
            refreshTick={0}
            secretaryName="主秘书"
            activeProvider="codex"
            activeProviderLabel="Codex"
            activeModel="gpt-5.4"
          />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Initial auto-browse shows recent entries & formatted db size (64.0 KB)
    expect(container.textContent).toContain("64.0 KB");
    expect(container.textContent).toContain("回复风格");
    expect(container.textContent).toContain("记忆引擎选型");

    // Clicking "工作区" domain pill sends concrete namespaces ["workspace/prismux"], NOT "workspace/*"
    await act(async () => {
      invokeClick(container.querySelector('[data-pmx-memory-domain-pill="workspace"]'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(searchBodies.at(-1)?.namespaces).toEqual(["workspace/prismux"]);
    expect(container.textContent).toContain("记忆引擎选型");
    expect(container.textContent).not.toContain("回复风格");

    // Switch back to all domains and test manual add
    await act(async () => {
      invokeClick(container.querySelector('[data-pmx-memory-domain-pill="all"]'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      invokeClick(container.querySelector("[data-pmx-memory-add-toggle]"));
    });
    await act(async () => {
      invokeChange(container.querySelector("[data-pmx-memory-create-title]"), "测试新增记忆");
      invokeChange(container.querySelector("[data-pmx-memory-create-content]"), "每周五整理周报");
    });
    await act(async () => {
      invokeClick(container.querySelector("[data-pmx-memory-create-submit]"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("测试新增记忆");
    expect(upsertBodies[0]).toMatchObject({
      namespace: "private/chief",
      kind: "fact",
      title: "测试新增记忆",
      content: "每周五整理周报",
      sourceRef: "manual-ui",
    });

    // Inline edit existing mem-2 sends valid kind + sourceRef
    await act(async () => {
      invokeClick(container.querySelector('[data-pmx-memory-edit-btn="mem-2"]'));
    });
    await act(async () => {
      invokeClick(container.querySelector('[data-pmx-memory-edit-save="mem-2"]'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(upsertBodies[1]).toMatchObject({
      id: "mem-2",
      namespace: "workspace/prismux",
      kind: "fact",
      sourceRef: "manual-ui",
    });

    // Two-step delete on mem-1 hits DELETE /v1/memory/entries/mem-1
    await act(async () => {
      invokeClick(container.querySelector('[data-pmx-memory-delete-btn="mem-1"]'));
    });
    await act(async () => {
      invokeClick(container.querySelector('[data-pmx-memory-delete-confirm="mem-1"]'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(deletedUrls).toEqual(["/v1/memory/entries/mem-1"]);
    expect(container.querySelector('[data-pmx-memory-hit-id="mem-1"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("Dim 5: handles Obsidian non-CLI fallback warnings, avoids undefined namespace on commit, and propagates namespace overrides", async () => {
    expect(isValidObsidianTargetNamespace("private/chief")).toBe(true);
    expect(isValidObsidianTargetNamespace("bad/space")).toBe(false);

    let committedBody: Record<string, unknown> | null = null;
    const mockDaemon = {
      requestJson: vi.fn(async (endpoint: string, init?: RequestInit) => {
        if (endpoint === "/v1/memory/import-obsidian/plan") {
          return {
            ok: true,
            vaultPath: "D:\\Vault",
            defaultNamespace: "private/chief",
            curationSource: "structured-fallback",
            curatorLabel: "主秘书 · dsh",
            warnings: ["DSH 引擎暂不支持无头策展，已自动切换为本地结构化脱敏整理。"],
            items: [
              {
                id: "item-1",
                title: "架构笔记",
                summary: "采用单文件 SQLite",
                kind: "decision",
                namespace: "private/chief",
                tags: ["arch"],
                sourceFile: "arch.md",
                selected: true,
                curationSource: "structured-fallback",
                redactedSecretCount: 1,
              },
            ],
            stats: {
              scannedFiles: 4,
              curatedCount: 1,
              deduplicatedCount: 2,
              filteredNoiseCount: 1,
              redactedSecretCount: 1,
            },
          };
        }
        if (endpoint === "/v1/memory/import-obsidian/commit") {
          committedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          // Simulate legacy backend response omitting `namespace`
          return {
            ok: true,
            committedCount: 1,
            skippedCount: 0,
            redactedSecretCount: 1,
            entryIds: ["entry-1"],
          };
        }
        return { ok: true };
      }),
    };

    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <ObsidianAgentImportCard
            daemon={mockDaemon as never}
            secretaryName="小棱"
            activeProvider="dsh"
            activeProviderLabel="DeepSeek Harness"
            activeModel="deepseek-v4-pro"
          />
        </GTProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      invokeChange(container.querySelector("[data-pmx-obsidian-vault-input]"), "D:\\Vault");
    });
    await act(async () => {
      invokeClick(container.querySelector("[data-pmx-obsidian-plan-button]"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Displays fallback notice & dedup count
    expect(container.querySelector("[data-pmx-obsidian-fallback-notice]")?.textContent).toContain(
      "DSH 引擎暂不支持无头策展",
    );
    expect(container.textContent).toContain("去重 2");

    // Commit never prints "undefined" even when response lacks `namespace`
    await act(async () => {
      invokeClick(container.querySelector("[data-pmx-obsidian-commit-button]"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(committedBody).not.toBeNull();
    expect(container.textContent).toContain("已写入 1 条结构化记忆至 private/chief");
    expect(container.textContent).not.toContain("undefined");

    await act(async () => {
      root.unmount();
    });
  });

  it("Dim 6: resolves Chief slot provider/model/effort + AGENTS.md on Chief IPC dispatch without altering normal worker dispatches", async () => {
    const dshProvider = makeMockProvider({
      instanceId: "acpRegistry_dsh",
      driver: "acpRegistry",
      displayName: "DeepSeek Harness",
      acpRegistryAgentId: "dsh",
      models: [
        {
          slug: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          isCustom: false,
          isDefault: true,
        } as ServerProvider["models"][number],
      ],
    });

    // DSH with empty / synthetic modelId picks catalog default instead of Codex gpt-6.2-sol
    const dshSelection = buildDispatchModelSelection(
      {
        provider: "dsh",
        modelId: "dsh-default",
        reasoningEffort: "high",
      },
      [dshProvider],
    );
    expect(dshSelection.instanceId).toBe(ProviderInstanceId.make("acpRegistry_dsh"));
    expect(dshSelection.model).toBe("deepseek-v4-pro");

    expect(isChiefWorkspacePathLike("C:\\Users\\Fish\\.prismux\\chief-workspace")).toBe(true);
    expect(isChiefWorkspacePathLike("~/.prismux/chief-workspace")).toBe(true);
    expect(isChiefWorkspacePathLike("D:\\CustomData\\chief-workspace")).toBe(true);
    expect(isChiefWorkspacePathLike("C:\\Users\\Fish\\.prismux\\chief")).toBe(true);
    expect(isChiefWorkspacePathLike("D:\\workspace\\Prismux")).toBe(false);

    expect(
      isChiefDispatchEnvelope({
        provider: "chief",
        workspacePath: "",
        worktreePath: null,
      }),
    ).toBe(true);
    // Real Daemon dispatch with concrete provider + ~/.prismux/chief-workspace must be recognized as Chief dispatch
    expect(
      isChiefDispatchEnvelope({
        provider: "claude-code",
        workspacePath: "C:\\Users\\Fish\\.prismux\\chief-workspace",
        worktreePath: null,
      }),
    ).toBe(true);
    expect(
      isChiefDispatchEnvelope({
        provider: "codex",
        workspacePath: "D:\\workspace\\Prismux",
        worktreePath: null,
      }),
    ).toBe(false);

    // Idempotent AGENTS.md prompt builder
    const injectedOnce = buildChiefDispatchPrompt("帮我总结今天的改动", "# 主秘书规则\n先给结论");
    expect(injectedOnce).toContain("主秘书规则");
    expect(injectedOnce).toContain("帮我总结今天的改动");
    expect(buildChiefDispatchPrompt(injectedOnce, "# 主秘书规则\n先给结论")).toBe(injectedOnce);

    const startedTurns: Array<{
      prompt: string;
      modelSelection: { instanceId: string; model: string };
    }> = [];
    let capturedWorkspacePath = "";
    let storedPrompt: string | null = null;
    const deps: DispatchExecutionDeps = {
      resolveChiefContext: vi.fn(async () => ({
        provider: "dsh",
        model: "deepseek-v4-pro",
        reasoningEffort: "high",
        workspacePath: "C:\\Users\\Fish\\.prismux\\chief-workspace",
        agentsMdContent:
          "<!-- prismux:chief-identity:begin -->\n称呼：小棱\n<!-- prismux:chief-identity:end -->\n回复简洁专业。",
      })),
      resolveTargetProject: vi.fn(async (workspacePath) => {
        capturedWorkspacePath = workspacePath;
        return {
          environmentId: EnvironmentId.make("primary"),
          projectId: ProjectId.make("chief-proj"),
          logicalProjectKey: "logical:chief-proj",
          providers: [dshProvider],
        };
      }),
      allocateIds: () => ({
        draftId: "draft-chief-1" as never,
        threadId: ThreadId.make("thread-chief-1"),
        messageId: MessageId.make("msg-chief-1"),
      }),
      setLogicalProjectDraftThreadId: vi.fn(),
      setModelSelection: vi.fn(),
      setPrompt: (_draftId, prompt) => {
        storedPrompt = prompt;
      },
      getPrompt: () => storedPrompt,
      markDraftThreadPromoting: vi.fn(),
      clearComposerContent: vi.fn(),
      openWorkspaceDraftTab: vi.fn(),
      promoteWorkspaceDraftTab: vi.fn(),
      navigateToDraft: vi.fn(async () => {}),
      navigateToThread: vi.fn(async () => {}),
      startThreadTurn: vi.fn(async (input) => {
        startedTurns.push({
          prompt: input.prompt,
          modelSelection: {
            instanceId: input.modelSelection.instanceId,
            model: input.modelSelection.model,
          },
        });
        return { ok: true };
      }),
      onStagedForConfirmation: vi.fn(),
    };

    const chiefEnvelope: PrismuxDispatchEnvelope = {
      taskId: "task-chief-qq",
      status: "dispatched",
      mode: "send",
      workspacePath: "",
      worktreePath: null,
      prompt: "主秘书，帮我检查今天的工作区状态",
      provider: "chief",
      modelId: "",
      reasoningEffort: "",
      callerKind: "secretary_qq",
      createdAt: "2026-11-27T05:00:00.000Z",
      requiresHumanConfirmation: false,
      memoryContextSummary: null,
      replyChannel: { kind: "qq", targetId: "88888", label: "QQ 私聊" },
    };

    const outcome = await handlePrismuxDispatchEnvelope(chiefEnvelope, deps);
    expect(outcome.outcome).toBe("auto_sent");
    expect(capturedWorkspacePath).toBe("C:\\Users\\Fish\\.prismux\\chief-workspace");
    expect(startedTurns[0]?.modelSelection.instanceId).toBe("acpRegistry_dsh");
    expect(startedTurns[0]?.modelSelection.model).toBe("deepseek-v4-pro");
    expect(startedTurns[0]?.prompt).toContain("称呼：小棱");
    expect(startedTurns[0]?.prompt).toContain("主秘书，帮我检查今天的工作区状态");

    // Concrete provider (dsh) dispatched to real ~/.prismux/chief-workspace also receives AGENTS.md
    const concreteChiefOutcome = await handlePrismuxDispatchEnvelope(
      {
        ...chiefEnvelope,
        taskId: "task-chief-workspace-direct",
        provider: "dsh",
        workspacePath: "C:\\Users\\Fish\\.prismux\\chief-workspace",
        prompt: "汇总今日待办",
      },
      deps,
    );
    expect(concreteChiefOutcome.outcome).toBe("auto_sent");
    expect(startedTurns[1]?.prompt).toContain("称呼：小棱");
    expect(startedTurns[1]?.prompt).toContain("汇总今日待办");

    // Confirmation banner unwraps JSON tuple model slugs and uses custom displayName
    const bannerHtml = renderToStaticMarkup(
      createElement(PrismuxDispatchConfirmationBanner, {
        items: [
          {
            envelope: {
              ...chiefEnvelope,
              provider: "claude-code",
              modelId: '["magpie","claude-opus-4-6"]',
              requiresHumanConfirmation: true,
            },
            environmentId: EnvironmentId.make("primary"),
            projectId: ProjectId.make("proj-1"),
            draftId: "draft-1" as never,
            threadId: ThreadId.make("thread-1"),
            modelSelection: {
              instanceId: ProviderInstanceId.make("claudeAgent"),
              model: '["magpie","claude-opus-4-6"]',
            },
            stagedAt: "2026-11-27T05:00:00.000Z",
          } satisfies StagedPrismuxDispatch,
        ],
        busyTaskId: null,
        errorMessage: null,
        settings: {
          ...DEFAULT_UNIFIED_SETTINGS,
          providerInstances: {
            [ProviderInstanceId.make("claudeAgent")]: {
              enabled: true,
              driver: ProviderDriverKind.make("claudeAgent"),
              displayName: "主力 Claude",
            },
          },
        },
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    expect(bannerHtml).toContain("主力 Claude");
    expect(bannerHtml).toContain("claude-opus-4-6");
    expect(bannerHtml).not.toContain('["magpie"');
  });
});
