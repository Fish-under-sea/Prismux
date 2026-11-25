import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { GTProvider, initializeGT } from "gt-react";
// oxlint-disable-next-line t3code/require-disposable-render -- Headless Node unit test renders into an in-memory MiniDocument instead of Playwright browser runner.
import { act, type ReactNode } from "react";
// oxlint-disable-next-line t3code/require-disposable-render -- Headless Node unit test explicitly unmounts its React root.
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: unknown; [key: string]: unknown }) => (
    <a {...props}>{children as never}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
  useLocation: (opts?: {
    select?: (loc: { hash: string; pathname: string; state: Record<string, unknown> }) => unknown;
  }) => {
    const loc = { hash: "", pathname: "/settings/memory-sync", state: {} };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

// Expose direct select, slider, and switch change handlers for deterministic headless React 19 fiber commit testing.
const selectHandlers = new Map<string, (value: string | null) => void>();
const syncSwitchHandlers = new Map<string, (checked: boolean) => void>();
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
  }) => {
    // Identify each Select by scanning child trigger data attributes or binding dynamically via context
    return (
      <div
        data-mock-select=""
        data-mock-select-value={value ?? ""}
        ref={(el) => {
          if (!el || !onValueChange) return;
          const trigger = el.querySelector("[data-pmx-chief-provider-select],[data-pmx-chief-model-select]");
          if (trigger?.hasAttribute("data-pmx-chief-provider-select")) {
            selectHandlers.set("provider", onValueChange);
          } else if (trigger?.hasAttribute("data-pmx-chief-model-select")) {
            selectHandlers.set("model", onValueChange);
          }
        }}
      >
        {children}
      </div>
    );
  },
  SelectTrigger: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  SelectPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
    <div data-mock-select-item={value}>{children}</div>
  ),
}));

vi.mock("../../components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    [key: string]: unknown;
  }) => {
    const channelKey = props["data-pmx-sync-channel-switch"];
    if (typeof channelKey === "string" && onCheckedChange) {
      syncSwitchHandlers.set(channelKey, onCheckedChange);
    }
    return <input type="checkbox" readOnly checked={Boolean(checked)} {...props} />;
  },
}));

import { ChiefIdentityAndAgentsMdSection } from "./ChiefIdentityAndAgentsMdSection";
import { ObsidianAgentImportCard } from "./ObsidianAgentImportCard";
import { PrismuxMemoryEngineSection } from "./PrismuxMemoryEngineSection";
import {
  PrismuxMemorySyncSettingsPage,
  type PrismuxMemorySyncSectionKey,
} from "./PrismuxMemorySyncSettingsPage";
import { PrismuxSyncEngineSection } from "./PrismuxSyncEngineSection";

/**
 * Minimal zero-dependency DOM shim so React 19 `createRoot` executes real Fiber commits
 * and `React.memo` bailout checks inside Vitest's fast Node `unit` project.
 */
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
  const MiniIFrameElement = function MiniIFrameElement() {};
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
      href: "http://localhost/settings/memory-sync",
      origin: "http://localhost",
      hash: "",
      pathname: "/settings/memory-sync",
      search: "",
    },
    localStorage: storage,
    HTMLIFrameElement: MiniIFrameElement,
    HTMLElement: MiniNode,
    Element: MiniNode,
    Node: MiniNode,
    navigator: { userAgent: "node" },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => undefined,
    dispatchEvent: () => true,
  };
  (doc as unknown as { defaultView: unknown }).defaultView = win;

  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevLocalStorage = globalThis.localStorage;
  const prevNode = globalThis.Node;
  const prevElement = globalThis.Element;
  const prevHTMLElement = globalThis.HTMLElement;
  const prevSVGElement = globalThis.SVGElement;
  const prevActEnv = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).localStorage = storage;
  (globalThis as Record<string, unknown>).Node = MiniNode;
  (globalThis as Record<string, unknown>).Element = MiniNode;
  (globalThis as Record<string, unknown>).HTMLElement = MiniNode;
  (globalThis as Record<string, unknown>).SVGElement = MiniNode;
  // oxlint-disable-next-line t3code/require-disposable-render -- Headless Node unit test enables act environment and restores it in cleanup().
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  return {
    document: doc,
    cleanup() {
      const restore = (key: string, prev: unknown) => {
        if (prev === undefined) {
          delete (globalThis as Record<string, unknown>)[key];
        } else {
          (globalThis as Record<string, unknown>)[key] = prev;
        }
      };
      restore("window", prevWindow);
      restore("document", prevDocument);
      restore("localStorage", prevLocalStorage);
      restore("Node", prevNode);
      restore("Element", prevElement);
      restore("HTMLElement", prevHTMLElement);
      restore("SVGElement", prevSVGElement);
      restore("IS_REACT_ACT_ENVIRONMENT", prevActEnv);
    },
  };
}

function makeMockProvider(input: {
  instanceId: string;
  driver: string;
  displayName?: string;
  models: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-23T00:00:00.000Z",
    models: input.models,
    slashCommands: [],
    skills: [],
  } as unknown as ServerProvider;
}

describe("PrismuxMemorySyncSettingsPage React.memo render isolation", () => {
  let dom: ReturnType<typeof installMinimalDom> | null = null;

  beforeAll(async () => {
    await initializeGT({
      defaultLocale: "zh",
      locales: ["en", "zh"],
      loadTranslations: async () => ({}),
      cacheExpiryTime: null,
    });
  });

  beforeEach(() => {
    selectHandlers.clear();
    syncSwitchHandlers.clear();
    effortSliderHandler = null;
    dom = installMinimalDom();
  });

  afterEach(() => {
    dom?.cleanup();
    dom = null;
  });

  it("wraps sibling sections in React.memo and triggers zero sibling re-renders when switching Chief Provider, Model, or Effort", async () => {
    const reactMemoSymbol = Symbol.for("react.memo");
    expect((ChiefIdentityAndAgentsMdSection as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      reactMemoSymbol,
    );
    expect((ObsidianAgentImportCard as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      reactMemoSymbol,
    );
    expect((PrismuxMemoryEngineSection as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      reactMemoSymbol,
    );
    expect((PrismuxSyncEngineSection as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      reactMemoSymbol,
    );

    const mockProviders: ServerProvider[] = [
      makeMockProvider({
        instanceId: "codex",
        driver: "codex",
        displayName: "Codex",
        models: [
          { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true } as ServerProvider["models"][number],
          { slug: "gpt-6-astra", name: "GPT-6 Astra", isCustom: false } as ServerProvider["models"][number],
        ],
      }),
      makeMockProvider({
        instanceId: "antigravity",
        driver: "antigravity",
        displayName: "Antigravity",
        models: [
          { slug: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen", isCustom: false } as ServerProvider["models"][number],
          { slug: "gemini-3-pro", name: "Gemini 3 Pro", isCustom: false } as ServerProvider["models"][number],
          { slug: "claude-opus-4-6", name: "Claude Opus 4.6", isCustom: false } as ServerProvider["models"][number],
        ],
      }),
    ];

    const requestJson = vi.fn(async (endpoint: string) => {
      if (endpoint === "/v1/chief") {
        return {
          ok: true,
          slot: {
            threadId: "chief-iso-thread",
            provider: "codex",
            model: "gpt-5.4",
            reasoningEffort: "high",
            secretaryName: "主秘书",
            agentsMdPath: "~/.prismux/chief/AGENTS.md",
          },
          dialMode: "agent",
          availableProviders: ["codex", "antigravity", "claude-code", "dsh"],
          t3Connected: true,
        };
      }
      if (endpoint === "/v1/chief/agents-md") {
        return {
          ok: true,
          path: "~/.prismux/chief/AGENTS.md",
          content: "# 主秘书规则",
          secretaryName: "主秘书",
          updatedAt: Date.now(),
          exists: true,
        };
      }
      if (endpoint === "/v1/memory/stats") {
        return {
          ok: true,
          callerScope: "owner_chief",
          totalEntries: 28,
          vectorSearchEnabled: true,
          sqliteVecLoaded: true,
          retrievalMode: "fts5+sqlite-vec",
          byNamespace: { "private/chief": 28 },
          byKind: { note: 28 },
          latestUpdatedAt: Date.now(),
          dbPath: "~/.prismux/data/memory.db",
        };
      }
      if (endpoint === "/v1/sync/status") {
        return {
          ok: true,
          hasPassphrase: true,
          configPath: "~/.prismux/sync.json",
          status: { portableMode: false },
          syncMatrix: {},
          channels: { webdav: null, s3: null, github: null },
        };
      }
      return { ok: true };
    });

    const mockDaemon = {
      requestJson,
      switchChief: vi.fn(async () => ({ ok: true })),
      triggerSyncNow: vi.fn(async () => ({ ok: true })),
      testSyncConnection: vi.fn(async () => ({ ok: true })),
    };

    const renderCounts: Record<PrismuxMemorySyncSectionKey, number> = {
      chiefSlot: 0,
      identityAgentsMd: 0,
      memory: 0,
      obsidian: 0,
      sync: 0,
    };

    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxMemorySyncSettingsPage
            serverProvidersOverride={mockProviders}
            settingsOverride={null}
            daemonOverride={mockDaemon as never}
            daemonReadyOverride
            onSectionRender={(section) => {
              renderCounts[section] += 1;
            }}
          />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Confirm AGENTS.md remains a plain-text <textarea> source editor
    const agentsEditor = container.querySelector("[data-pmx-chief-agents-md-editor]");
    expect(agentsEditor?.tagName).toBe("TEXTAREA");

    const baseline = { ...renderCounts };
    const baselineRequests = requestJson.mock.calls.length;
    expect(selectHandlers.has("provider")).toBe(true);
    expect(selectHandlers.has("model")).toBe(true);
    // Duplicate effort <Select> dropdown is removed in favor of the single reasoning slider.
    expect(container.querySelector("[data-pmx-chief-effort-select]")).toBeNull();
    expect(container.querySelector("[data-pmx-chief-effort-slider]")).not.toBeNull();
    expect(typeof effortSliderHandler).toBe("function");

    // 1. Switch Provider: Codex -> Antigravity
    await act(async () => {
      selectHandlers.get("provider")?.("antigravity");
    });

    expect(renderCounts.chiefSlot).toBeGreaterThan(baseline.chiefSlot);
    expect(renderCounts.identityAgentsMd).toBe(baseline.identityAgentsMd);
    expect(renderCounts.memory).toBe(baseline.memory);
    expect(renderCounts.obsidian).toBe(baseline.obsidian);
    expect(renderCounts.sync).toBe(baseline.sync);
    expect(requestJson.mock.calls.length).toBe(baselineRequests);
    expect(container.querySelector("[data-pmx-chief-provider-select]")?.textContent).toContain(
      "Antigravity",
    );

    // 2. Switch Model: default -> Gemini 4 Hydrogen
    const afterProviderChiefRenders = renderCounts.chiefSlot;
    await act(async () => {
      selectHandlers.get("model")?.("gemini-4-hydrogen");
    });

    expect(renderCounts.chiefSlot).toBeGreaterThan(afterProviderChiefRenders);
    expect(renderCounts.identityAgentsMd).toBe(baseline.identityAgentsMd);
    expect(renderCounts.memory).toBe(baseline.memory);
    expect(renderCounts.obsidian).toBe(baseline.obsidian);
    expect(renderCounts.sync).toBe(baseline.sync);
    expect(requestJson.mock.calls.length).toBe(baselineRequests);
    expect(container.querySelector("[data-pmx-chief-model-select]")?.textContent).toContain(
      "Gemini 4 Hydrogen",
    );

    // 3. Switch Effort via single reasoning slider: high -> max
    const afterModelChiefRenders = renderCounts.chiefSlot;
    await act(async () => {
      effortSliderHandler?.("max");
    });

    expect(renderCounts.chiefSlot).toBeGreaterThan(afterModelChiefRenders);
    expect(renderCounts.identityAgentsMd).toBe(baseline.identityAgentsMd);
    expect(renderCounts.memory).toBe(baseline.memory);
    expect(renderCounts.obsidian).toBe(baseline.obsidian);
    expect(renderCounts.sync).toBe(baseline.sync);
    expect(requestJson.mock.calls.length).toBe(baselineRequests);
    expect(
      container.querySelector("[data-pmx-mock-effort-slider]")?.getAttribute("data-value"),
    ).toBe("max");

    // 4. Outer re-render with unchanged primitive runtime props (simulating PrismuxRuntimeProvider
    //    periodic resources/ports polling) triggers 0 re-renders across every section.
    const beforeOuterRerender = { ...renderCounts };
    const onSectionRender = (section: PrismuxMemorySyncSectionKey) => {
      renderCounts[section] += 1;
    };
    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxMemorySyncSettingsPage
            serverProvidersOverride={mockProviders}
            settingsOverride={null}
            daemonOverride={mockDaemon as never}
            daemonReadyOverride
            onSectionRender={onSectionRender}
          />
        </GTProvider>,
      );
    });
    const afterStableAttach = { ...renderCounts };
    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxMemorySyncSettingsPage
            serverProvidersOverride={mockProviders}
            settingsOverride={null}
            daemonOverride={mockDaemon as never}
            daemonReadyOverride
            onSectionRender={onSectionRender}
          />
        </GTProvider>,
      );
    });
    expect(renderCounts).toEqual(afterStableAttach);
    expect(beforeOuterRerender.identityAgentsMd).toBe(baseline.identityAgentsMd);

    await act(async () => {
      root.unmount();
    });
  });

  it("organizes sync into 2 segmented tabs and expands/collapses GitHub, WebDAV, and S3 channel editors cleanly", async () => {
    const clickNode = (node: unknown) => {
      if (!node || typeof node !== "object") {
        throw new Error("Expected clickable MiniNode");
      }
      const propsKey = Object.keys(node as Record<string, unknown>).find((key) =>
        key.startsWith("__reactProps$"),
      );
      const onClick = propsKey
        ? ((node as Record<string, unknown>)[propsKey] as { onClick?: () => void } | undefined)
            ?.onClick
        : undefined;
      if (typeof onClick !== "function") {
        throw new Error("Expected React onClick handler on MiniNode");
      }
      onClick();
    };

    const mockDaemonDefaultOff = {
      requestJson: vi.fn(async () => ({
        ok: true,
        hasPassphrase: false,
        configPath: "~/.prismux/sync.json",
        status: { portableMode: false },
        syncMatrix: {},
        channels: {
          webdav: { enabled: false, endpointUrl: "", username: "", remotePath: "/prismux/vault.prismux-backup", hasSecret: false },
          s3: { enabled: false, endpointUrl: "", region: "us-east-1", bucket: "", forcePathStyle: true, accessKeyId: "", hasSecret: false },
          github: { enabled: false, owner: "", repo: "", branch: "main", filePath: "prismux-vault.prismux-backup", hasSecret: false },
        },
      })),
      triggerSyncNow: vi.fn(async () => ({ ok: true })),
      testSyncConnection: vi.fn(async () => ({ ok: true })),
    };

    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxSyncEngineSection daemon={mockDaemonDefaultOff as never} refreshTick={0} />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Default tab is `overview` with the flattened 7-domain sync switch list.
    expect(container.querySelector('[data-active-tab="overview"]')).not.toBeNull();
    expect(container.querySelector("[data-pmx-sync-matrix-list]")).not.toBeNull();
    expect(container.querySelector("[data-pmx-sync-channel]")).toBeNull();

    // Switch to Tab 2 (`channels`) to manage GitHub / WebDAV / S3 channels.
    await act(async () => {
      clickNode(container.querySelector('[data-tab-id="channels"]'));
    });
    expect(container.querySelector('[data-active-tab="channels"]')).not.toBeNull();

    const getPanel = (ch: "webdav" | "s3" | "github") =>
      container.querySelector(`[data-pmx-sync-channel="${ch}"]`);
    const selectChannel = async (ch: "webdav" | "s3" | "github") => {
      await act(async () => {
        clickNode(container.querySelector(`[data-pmx-sync-channel-tab="${ch}"]`));
      });
    };

    // 1. All 3 channels start collapsed when disabled
    for (const ch of ["github", "webdav", "s3"] as const) {
      await selectChannel(ch);
      const panel = getPanel(ch);
      expect(panel?.getAttribute("data-pmx-sync-channel-expanded")).toBe("false");
    }

    // 2. Toggle WebDAV ON -> expands WebDAV form cleanly; S3 & GitHub stay collapsed
    await selectChannel("webdav");
    await act(async () => {
      syncSwitchHandlers.get("webdav")?.(true);
    });
    expect(getPanel("webdav")?.getAttribute("data-pmx-sync-channel-expanded")).toBe("true");
    expect(container.querySelector('[data-pmx-sync-input="webdav.endpointUrl"]')).not.toBeNull();

    await selectChannel("s3");
    expect(getPanel("s3")?.getAttribute("data-pmx-sync-channel-expanded")).toBe("false");
    await selectChannel("github");
    expect(getPanel("github")?.getAttribute("data-pmx-sync-channel-expanded")).toBe("false");

    // 3. Toggle S3 & GitHub ON -> expand cleanly; toggle WebDAV OFF -> collapses back
    await act(async () => {
      syncSwitchHandlers.get("github")?.(true);
    });
    expect(getPanel("github")?.getAttribute("data-pmx-sync-channel-expanded")).toBe("true");
    await selectChannel("s3");
    await act(async () => {
      syncSwitchHandlers.get("s3")?.(true);
    });
    expect(getPanel("s3")?.getAttribute("data-pmx-sync-channel-expanded")).toBe("true");
    await selectChannel("webdav");
    await act(async () => {
      syncSwitchHandlers.get("webdav")?.(false);
    });
    expect(getPanel("webdav")?.getAttribute("data-pmx-sync-channel-expanded")).toBe("false");
    expect(container.querySelector('[data-pmx-sync-input="webdav.endpointUrl"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });

    // 4. Persisted enabled channels hydrate expanded on initial render inside the Channels tab
    const mockDaemonPersisted = {
      requestJson: vi.fn(async () => ({
        ok: true,
        hasPassphrase: true,
        configPath: "~/.prismux/sync.json",
        status: { portableMode: false },
        syncMatrix: {},
        channels: {
          webdav: { enabled: true, endpointUrl: "https://dav.example.com/dav", username: "fish", remotePath: "/prismux/vault.prismux-backup", hasSecret: true },
          s3: { enabled: false, endpointUrl: "", region: "us-east-1", bucket: "", forcePathStyle: true, accessKeyId: "", hasSecret: false },
          github: { enabled: true, owner: "Fish-under-sea", repo: "vault", branch: "main", filePath: "vault.enc", hasSecret: true },
        },
      })),
      triggerSyncNow: vi.fn(async () => ({ ok: true })),
      testSyncConnection: vi.fn(async () => ({ ok: true })),
    };

    const container2 = dom!.document.createElement("div");
    dom!.document.body.appendChild(container2);
    const root2 = createRoot(container2 as unknown as Element);

    await act(async () => {
      root2.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxSyncEngineSection
            daemon={mockDaemonPersisted as never}
            refreshTick={0}
            initialTabOverride="channels"
          />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const selectChannel2 = async (ch: "webdav" | "s3" | "github") => {
      await act(async () => {
        clickNode(container2.querySelector(`[data-pmx-sync-channel-tab="${ch}"]`));
      });
    };

    expect(
      container2
        .querySelector('[data-pmx-sync-channel="github"]')
        ?.getAttribute("data-pmx-sync-channel-expanded"),
    ).toBe("true");
    await selectChannel2("webdav");
    expect(
      container2
        .querySelector('[data-pmx-sync-channel="webdav"]')
        ?.getAttribute("data-pmx-sync-channel-expanded"),
    ).toBe("true");
    await selectChannel2("s3");
    expect(
      container2
        .querySelector('[data-pmx-sync-channel="s3"]')
        ?.getAttribute("data-pmx-sync-channel-expanded"),
    ).toBe("false");

    await act(async () => {
      root2.unmount();
    });
  });
});
