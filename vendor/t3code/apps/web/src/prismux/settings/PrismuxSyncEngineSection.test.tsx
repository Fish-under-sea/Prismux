import { GTProvider, initializeGT } from "gt-react";
import { act, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
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
    const loc = { hash: "", pathname: "/settings/sync", state: {} };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

// Deterministic handler registries for headless React 19 testing without jsdom overhead.
const switchHandlers = new Map<string, (checked: boolean) => void>();
const inputHandlers = new Map<string, (value: string) => void>();
const buttonHandlers = new Map<string, { onClick: () => void; disabled: boolean }>();

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
    const matrixKey = props["data-pmx-sync-matrix-switch"];
    if (typeof channelKey === "string" && onCheckedChange) {
      switchHandlers.set(`channel:${channelKey}`, onCheckedChange);
    }
    if (typeof matrixKey === "string" && onCheckedChange) {
      switchHandlers.set(`matrix:${matrixKey}`, onCheckedChange);
    }
    return <input type="checkbox" readOnly checked={Boolean(checked)} {...props} />;
  },
}));

vi.mock("../../components/ui/input", () => ({
  Input: ({
    value,
    onChange,
    nativeInput: _nativeInput,
    size: _size,
    ...props
  }: {
    value?: string;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    nativeInput?: boolean;
    size?: string | number;
    [key: string]: unknown;
  }) => {
    const fieldKey =
      typeof props["data-pmx-sync-input"] === "string"
        ? (props["data-pmx-sync-input"] as string)
        : props["data-pmx-sync-passphrase-input"] !== undefined
          ? "passphrase"
          : null;
    if (fieldKey && onChange) {
      inputHandlers.set(fieldKey, (nextVal: string) => {
        onChange({ target: { value: nextVal } } as ChangeEvent<HTMLInputElement>);
      });
    }
    return <input value={value ?? ""} readOnly {...props} />;
  },
}));

vi.mock("../../components/ui/button", () => ({
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
      props["data-pmx-sync-save-all"] !== undefined
        ? "save-all"
        : props["data-pmx-sync-test-all"] !== undefined
          ? "test-all"
          : props["data-pmx-sync-now"] !== undefined
            ? "sync-now"
            : props["data-pmx-sync-save-passphrase"] !== undefined
              ? "save-passphrase"
              : props["data-pmx-sync-save-matrix"] !== undefined
                ? "save-matrix"
                : typeof props["data-pmx-sync-save-channel"] === "string"
                  ? `save-channel:${props["data-pmx-sync-save-channel"]}`
                  : typeof props["data-pmx-sync-test-channel"] === "string"
                    ? `test-channel:${props["data-pmx-sync-test-channel"]}`
                    : typeof props["data-pmx-sync-save-channel-collapsed"] === "string"
                      ? `save-channel-collapsed:${props["data-pmx-sync-save-channel-collapsed"]}`
                      : null;
    if (key && onClick) {
      buttonHandlers.set(key, {
        disabled: Boolean(disabled),
        onClick: () => onClick({} as MouseEvent<HTMLButtonElement>),
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
  PrismuxSyncEngineSection,
  validateEnabledSyncChannels,
  validateGitHubForm,
  validateS3Form,
  validateWebDavForm,
} from "./PrismuxSyncEngineSection";

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
  }

  const doc = new MiniDocument();
  class MiniIFrameElement {}
  const win = {
    document: doc,
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

  const prevKeys = [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const;
  const saved = new Map<string, unknown>();
  for (const key of prevKeys) {
    saved.set(key, (globalThis as Record<string, unknown>)[key]);
  }

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).Node = MiniNode;
  (globalThis as Record<string, unknown>).Element = MiniNode;
  (globalThis as Record<string, unknown>).HTMLElement = MiniNode;
  (globalThis as Record<string, unknown>).SVGElement = MiniNode;
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

  return {
    document: doc,
    cleanup() {
      for (const key of prevKeys) {
        const prev = saved.get(key);
        if (prev === undefined) {
          delete (globalThis as Record<string, unknown>)[key];
        } else {
          (globalThis as Record<string, unknown>)[key] = prev;
        }
      }
    },
  };
}

function createStatefulMockDaemon(options?: {
  failConfigPutWith?: string;
}) {
  const callLog: Array<{ op: string; method?: string; path?: string; payload?: unknown }> = [];
  const state = {
    ok: true,
    hasPassphrase: false,
    configPath: "C:\\Users\\Fish\\.prismux\\sync-config.json",
    status: { portableMode: false },
    syncMatrix: {
      privateMemory: { upload: true, download: true },
      workspaceMemory: { upload: true, download: true },
      socialMemory: { upload: false, download: false },
      commandsAndMcp: { upload: true, download: true },
      plugins: { upload: true, download: true },
      appearancePresets: { upload: true, download: true },
      usageLedger: { upload: true, download: true },
    } as Record<string, { upload: boolean; download: boolean }>,
    channels: {
      webdav: null as Record<string, unknown> | null,
      s3: null as Record<string, unknown> | null,
      github: null as Record<string, unknown> | null,
    },
  };

  const daemon = {
    requestJson: vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const parsedBody =
        typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      callLog.push({ op: "requestJson", method, path, payload: parsedBody });

      if (path === "/v1/sync/status") {
        return structuredClone(state);
      }

      if (path === "/v1/sync/config") {
        if (options?.failConfigPutWith) {
          throw new Error(options.failConfigPutWith);
        }
        if (parsedBody?.passphrase && typeof parsedBody.passphrase === "string") {
          state.hasPassphrase = true;
        }
        if (parsedBody?.syncMatrix && typeof parsedBody.syncMatrix === "object") {
          Object.assign(state.syncMatrix, parsedBody.syncMatrix);
        }
        const ch = parsedBody?.channels as Record<string, Record<string, unknown>> | undefined;
        if (ch?.github) {
          const gh = ch.github;
          if ((gh.owner && gh.repo) || state.channels.github) {
            state.channels.github = {
              enabled: Boolean(gh.enabled),
              owner: String(gh.owner ?? state.channels.github?.owner ?? ""),
              repo: String(gh.repo ?? state.channels.github?.repo ?? ""),
              branch: String(gh.branch ?? "main"),
              filePath: String(gh.filePath ?? "prismux-vault.prismux-backup"),
              hasSecret: Boolean(gh.token) || Boolean(state.channels.github?.hasSecret),
            };
          }
        }
        if (ch?.webdav) {
          const wd = ch.webdav;
          if (wd.endpointUrl || state.channels.webdav) {
            state.channels.webdav = {
              enabled: Boolean(wd.enabled),
              endpointUrl: String(wd.endpointUrl ?? state.channels.webdav?.endpointUrl ?? ""),
              username: String(wd.username ?? ""),
              remotePath: String(wd.remotePath ?? "/prismux/vault.prismux-backup"),
              hasSecret: Boolean(wd.password) || Boolean(state.channels.webdav?.hasSecret),
            };
          }
        }
        return structuredClone(state);
      }

      return { ok: true };
    }),
    testSyncConnection: vi.fn(async (req?: { channels?: string[] }) => {
      callLog.push({ op: "testSyncConnection", payload: req });
      return {
        ok: true,
        testedAt: Date.now(),
        message: "全部 1 个已启用同步通道连通性测试通过。",
        channels: [
          {
            channel: "github",
            ok: true,
            enabled: true,
            configured: true,
            reachable: true,
            latencyMs: 42,
            message: "连接成功（仓库 Fish-under-sea/prismux-vault 可访问，远端尚未上传首次快照）",
          },
        ],
      };
    }),
    triggerSyncNow: vi.fn(async (req?: Record<string, unknown>) => {
      callLog.push({ op: "triggerSyncNow", payload: req });
      return {
        ok: true,
        syncedAt: Date.now(),
        uploaded: 12,
        downloaded: 0,
        etag: "blob-sha-001",
        message: "同步完成（共 1 个通道，上传 12 条记录）。",
        channels: [
          {
            channel: "github",
            ok: true,
            enabled: true,
            configured: true,
            reachable: true,
            latencyMs: 88,
            uploaded: 12,
            downloaded: 0,
            message: "加密快照同步成功",
          },
        ],
      };
    }),
  };

  return { daemon, callLog, state };
}

describe("PrismuxSyncEngineSection contextual saves, validation, and auto-save before test/sync", () => {
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
    switchHandlers.clear();
    inputHandlers.clear();
    buttonHandlers.clear();
    dom = installMinimalDom();
  });

  afterEach(() => {
    dom?.cleanup();
    dom = null;
  });

  it("validates required non-secret fields on enabled WebDAV, S3, and GitHub forms with actionable Chinese errors", () => {
    expect(
      validateGitHubForm({
        enabled: true,
        owner: "",
        repo: "",
        branch: "main",
        filePath: "prismux-vault.prismux-backup",
        token: "",
        hasSecret: false,
      }),
    ).toContain("Owner");
    expect(
      validateGitHubForm({
        enabled: true,
        owner: "Fish-under-sea",
        repo: "   ",
        branch: "main",
        filePath: "prismux-vault.prismux-backup",
        token: "",
        hasSecret: false,
      }),
    ).toContain("私有仓库名");
    expect(
      validateWebDavForm({
        enabled: true,
        endpointUrl: "not-a-url",
        username: "",
        remotePath: "/vault",
        password: "",
        hasSecret: false,
      }),
    ).toContain("http:// 或 https://");
    expect(
      validateS3Form({
        enabled: true,
        endpointUrl: "https://s3.example.com",
        region: "auto",
        bucket: "",
        forcePathStyle: true,
        accessKeyId: "",
        secretAccessKey: "",
        hasSecret: false,
      }),
    ).toContain("Bucket");
    expect(
      validateEnabledSyncChannels({
        webdav: {
          enabled: false,
          endpointUrl: "",
          username: "",
          remotePath: "/v",
          password: "",
          hasSecret: false,
        },
        s3: {
          enabled: false,
          endpointUrl: "",
          region: "us-east-1",
          bucket: "",
          forcePathStyle: true,
          accessKeyId: "",
          secretAccessKey: "",
          hasSecret: false,
        },
        github: {
          enabled: true,
          owner: "Fish-under-sea",
          repo: "prismux-vault",
          branch: "main",
          filePath: "prismux-vault.prismux-backup",
          token: "",
          hasSecret: false,
        },
      }),
    ).toBeNull();
  });

  it("renders contextual inline save buttons (passphrase, channel card footer, matrix header), sends PUT /v1/sync/config, and clears isDirty", async () => {
    const { daemon, callLog } = createStatefulMockDaemon();
    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxSyncEngineSection daemon={daemon as never} refreshTick={0} />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // No orphan bottom save button; top save-all pill is hidden while clean.
    expect(container.textContent).not.toContain("保存加密同步配置");
    expect(container.querySelector("[data-pmx-sync-save-all]")).toBeNull();
    expect(buttonHandlers.get("save-passphrase")?.disabled).toBe(true);

    // 1. Inline Passphrase save sends PUT /v1/sync/config with passphrase only
    await act(async () => {
      inputHandlers.get("passphrase")?.("MyVaultPassphrase!2026");
    });
    expect(buttonHandlers.get("save-passphrase")?.disabled).toBe(false);
    expect(container.querySelector("[data-pmx-sync-save-all]")).not.toBeNull();

    await act(async () => {
      buttonHandlers.get("save-passphrase")?.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    const passPut = callLog.find((c) => c.path === "/v1/sync/config");
    expect(passPut?.method).toBe("PUT");
    expect(passPut?.payload).toEqual({ passphrase: "MyVaultPassphrase!2026" });
    expect(container.querySelector("[data-pmx-sync-save-all]")).toBeNull();
    expect(container.querySelector('[data-pmx-sync-passphrase-feedback="success"]')).not.toBeNull();
    expect(container.textContent).toContain("主口令已密封");

    // 2. Enable GitHub, fill fields -> labels & contextual footer visible -> save via PUT
    await act(async () => {
      switchHandlers.get("channel:github")?.(true);
      inputHandlers.get("github.owner")?.("Fish-under-sea");
      inputHandlers.get("github.repo")?.("prismux-vault");
      inputHandlers.get("github.token")?.("ghp_demo_token_123");
    });

    const ghFooter = container.querySelector('[data-pmx-sync-channel-footer="github"]');
    expect(ghFooter).not.toBeNull();
    expect(ghFooter?.textContent).toContain("保存此通道配置");
    expect(ghFooter?.textContent).toContain("测试此通道");
    expect(container.textContent).toContain("Owner");
    expect(container.textContent).toContain("私有仓库名");
    expect(container.textContent).toContain("Personal Access Token");
    expect(container.querySelector("[data-pmx-sync-save-all]")).not.toBeNull();

    await act(async () => {
      buttonHandlers.get("save-channel:github")?.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    const ghPut = [...callLog].reverse().find((c) => c.path === "/v1/sync/config");
    expect(ghPut?.method).toBe("PUT");
    expect(ghPut?.payload).toEqual({
      channels: {
        github: {
          enabled: true,
          owner: "Fish-under-sea",
          repo: "prismux-vault",
          branch: "main",
          filePath: "prismux-vault.prismux-backup",
          token: "ghp_demo_token_123",
        },
      },
    });
    expect(container.querySelector("[data-pmx-sync-save-all]")).toBeNull();
    expect(
      container
        .querySelector('[data-pmx-sync-channel-feedback="github"]')
        ?.getAttribute("data-pmx-sync-feedback-state"),
    ).toBe("success");

    // 3. Toggle matrix switch -> compact inline Save appears in matrix header -> PUT /v1/sync/config
    await act(async () => {
      switchHandlers.get("matrix:socialMemory.upload")?.(true);
    });
    expect(container.querySelector("[data-pmx-sync-save-matrix]")).not.toBeNull();

    await act(async () => {
      buttonHandlers.get("save-matrix")?.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    const matrixPut = [...callLog].reverse().find((c) => c.path === "/v1/sync/config");
    expect(matrixPut?.method).toBe("PUT");
    expect((matrixPut?.payload as { syncMatrix?: { socialMemory?: { upload: boolean } } })?.syncMatrix?.socialMemory?.upload).toBe(true);
    expect(container.querySelector("[data-pmx-sync-save-matrix]")).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it("auto-saves unsaved GitHub edits via PUT /v1/sync/config BEFORE calling testSyncConnection and triggerSyncNow", async () => {
    const { daemon, callLog } = createStatefulMockDaemon();
    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxSyncEngineSection daemon={daemon as never} refreshTick={0} />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Type GitHub config WITHOUT clicking Save, then click top「测试通道连通性」
    await act(async () => {
      switchHandlers.get("channel:github")?.(true);
      inputHandlers.get("github.owner")?.("Fish-under-sea");
      inputHandlers.get("github.repo")?.("prismux-vault");
      inputHandlers.get("github.token")?.("ghp_auto_save_test");
    });

    const logStart = callLog.length;
    await act(async () => {
      buttonHandlers.get("test-all")?.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterTestOps = callLog.slice(logStart);
    expect(afterTestOps.map((c) => `${c.op}:${c.method ?? ""}:${c.path ?? ""}`)).toEqual([
      "requestJson:PUT:/v1/sync/config",
      "testSyncConnection::",
    ]);
    expect(container.querySelector("[data-pmx-sync-save-all]")).toBeNull();
    expect(container.querySelector('[data-sync-operation-kind="test"]')?.textContent).toContain(
      "连通性测试通过",
    );

    // Edit branch + passphrase WITHOUT clicking Save, then click top「立即加密同步」
    await act(async () => {
      inputHandlers.get("github.branch")?.("vault-main");
      inputHandlers.get("passphrase")?.("SyncAutoSavePass!2026");
    });

    const syncLogStart = callLog.length;
    await act(async () => {
      buttonHandlers.get("sync-now")?.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterSyncOps = callLog.slice(syncLogStart);
    expect(afterSyncOps[0]?.op).toBe("requestJson");
    expect(afterSyncOps[0]?.method).toBe("PUT");
    expect(afterSyncOps[0]?.path).toBe("/v1/sync/config");
    expect(afterSyncOps[1]?.op).toBe("triggerSyncNow");
    expect(container.querySelector('[data-sync-operation-kind="sync"]')?.textContent).toContain(
      "同步完成",
    );

    // Edit GitHub repo and click per-channel「测试此通道」-> auto-saves GitHub only, then tests channels:["github"]
    await act(async () => {
      inputHandlers.get("github.repo")?.("prismux-vault-v2");
    });
    const singleTestStart = callLog.length;
    await act(async () => {
      buttonHandlers.get("test-channel:github")?.onClick();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const afterSingleTestOps = callLog.slice(singleTestStart);
    expect(afterSingleTestOps[0]?.op).toBe("requestJson");
    expect(afterSingleTestOps[0]?.method).toBe("PUT");
    expect(afterSingleTestOps[0]?.path).toBe("/v1/sync/config");
    expect(afterSingleTestOps[1]?.op).toBe("testSyncConnection");
    expect(afterSingleTestOps[1]?.payload).toEqual({ channels: ["github"] });
    expect(
      container
        .querySelector('[data-pmx-sync-channel-feedback="github"]')
        ?.getAttribute("data-pmx-sync-feedback-state"),
    ).toBe("success");

    await act(async () => {
      root.unmount();
    });
  });

  it("blocks test/sync with an actionable Chinese error when an enabled channel is missing required fields or auto-save fails", async () => {
    const { daemon, callLog } = createStatefulMockDaemon();
    const onError = vi.fn();
    const container = dom!.document.createElement("div");
    dom!.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    await act(async () => {
      root.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxSyncEngineSection daemon={daemon as never} refreshTick={0} onError={onError} />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Enable GitHub with empty Owner & Repo, then click「测试通道连通性」
    await act(async () => {
      switchHandlers.get("channel:github")?.(true);
    });

    const callsBefore = callLog.length;
    await act(async () => {
      buttonHandlers.get("test-all")?.onClick();
      await Promise.resolve();
    });

    // Must NOT call /v1/sync/config or testSyncConnection; must surface clear Chinese error in report box
    expect(callLog.length).toBe(callsBefore);
    expect(daemon.testSyncConnection).not.toHaveBeenCalled();
    const reportBox = container.querySelector('[data-sync-operation-kind="test"]');
    expect(reportBox?.textContent).toContain("Owner");
    expect(reportBox?.textContent).toContain("私有仓库名");
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("私有仓库名"));

    await act(async () => {
      root.unmount();
    });

    // Also verify auto-save server failure aborts testSyncConnection and displays exact server error
    const failing = createStatefulMockDaemon({
      failConfigPutWith: "磁盘写入失败：权限不足",
    });
    const container2 = dom!.document.createElement("div");
    dom!.document.body.appendChild(container2);
    const root2 = createRoot(container2 as unknown as Element);

    await act(async () => {
      root2.render(
        <GTProvider locale="zh" translations={{}}>
          <PrismuxSyncEngineSection daemon={failing.daemon as never} refreshTick={0} />
        </GTProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      switchHandlers.get("channel:github")?.(true);
      inputHandlers.get("github.owner")?.("Fish-under-sea");
      inputHandlers.get("github.repo")?.("prismux-vault");
    });

    await act(async () => {
      buttonHandlers.get("test-all")?.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(failing.daemon.testSyncConnection).not.toHaveBeenCalled();
    expect(container2.querySelector('[data-sync-operation-kind="test"]')?.textContent).toContain(
      "磁盘写入失败：权限不足",
    );

    await act(async () => {
      root2.unmount();
    });
  });
});
