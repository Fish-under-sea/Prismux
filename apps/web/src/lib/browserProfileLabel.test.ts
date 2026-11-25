import { BUILT_IN_BROWSER_PROFILES } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatBrowserProfileLabel,
  resolveBrowserProfileBadgeLabel,
} from "./browserProfileLabel";

describe("browserProfileLabel", () => {
  it("localizes built-in default and incognito profiles for Chinese and English locales", () => {
    expect(formatBrowserProfileLabel({ id: "default", name: "Default" }, "zh")).toBe("默认配置");
    expect(formatBrowserProfileLabel({ id: "default", name: "Default" }, "zh-CN")).toBe("默认配置");
    expect(formatBrowserProfileLabel({ id: "default", name: "Default" }, "en")).toBe("Default");
    expect(formatBrowserProfileLabel({ id: "default", name: "Default" }, "en-US")).toBe("Default");

    expect(formatBrowserProfileLabel({ id: "incognito", name: "Incognito" }, "zh")).toBe(
      "无痕模式",
    );
    expect(formatBrowserProfileLabel({ id: "incognito", name: "Incognito" }, "zh-CN")).toBe(
      "无痕模式",
    );
    expect(formatBrowserProfileLabel({ id: "incognito", name: "Incognito" }, "en")).toBe(
      "Incognito",
    );
    expect(formatBrowserProfileLabel({ id: "incognito", name: "Incognito" }, "en-US")).toBe(
      "Incognito",
    );
  });

  it("handles omitted or case-variant built-in names and preserves custom profile names untouched", () => {
    expect(formatBrowserProfileLabel({ id: "default" }, "zh")).toBe("默认配置");
    expect(formatBrowserProfileLabel({ id: "incognito", name: "  incognito  " }, "zh")).toBe(
      "无痕模式",
    );
    // Custom names on user-defined profiles stay untouched across locales.
    expect(formatBrowserProfileLabel({ id: "work", name: "Work" }, "zh")).toBe("Work");
    expect(formatBrowserProfileLabel({ id: "work", name: "Work" }, "en")).toBe("Work");
    expect(formatBrowserProfileLabel({ id: "staging", name: "测试账号" }, "zh")).toBe("测试账号");
    expect(formatBrowserProfileLabel({ id: "staging", name: "测试账号" }, "en")).toBe("测试账号");
    // Explicit custom label on a built-in id is respected if ever customized.
    expect(formatBrowserProfileLabel({ id: "default", name: "主工作配置" }, "zh")).toBe(
      "主工作配置",
    );
    // Fallback to id when a custom profile has an empty name.
    expect(formatBrowserProfileLabel({ id: "qa-profile", name: "   " }, "zh")).toBe("qa-profile");
  });

  it("resolves browser tab profile badge labels only for non-default profiles", () => {
    const profiles = [
      ...BUILT_IN_BROWSER_PROFILES,
      { id: "work", name: "Work", kind: "persistent" as const },
    ];

    expect(resolveBrowserProfileBadgeLabel(undefined, profiles, "zh")).toBeNull();
    expect(resolveBrowserProfileBadgeLabel("default", profiles, "zh")).toBeNull();
    expect(resolveBrowserProfileBadgeLabel("default", profiles, "en")).toBeNull();

    expect(resolveBrowserProfileBadgeLabel("incognito", profiles, "zh")).toBe("无痕模式");
    expect(resolveBrowserProfileBadgeLabel("incognito", profiles, "en")).toBe("Incognito");
    expect(resolveBrowserProfileBadgeLabel("work", profiles, "zh")).toBe("Work");
    expect(resolveBrowserProfileBadgeLabel("work", profiles, "en")).toBe("Work");
    // Unregistered non-default id still resolves gracefully.
    expect(resolveBrowserProfileBadgeLabel("incognito", [], "zh")).toBe("无痕模式");
    expect(resolveBrowserProfileBadgeLabel("sandbox", [], "zh")).toBe("sandbox");
  });
});
