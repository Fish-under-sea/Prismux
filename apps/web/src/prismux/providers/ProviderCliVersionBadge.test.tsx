import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TooltipProvider } from "../../components/ui/tooltip";
import type { DaemonCliUpdateItemDto } from "../daemonClient";
import {
  createInitialCliVersionBadgeState,
  formatCliVersionDisplay,
  ProviderCliVersionBadge,
  resolveCliVersionBadgeViewModel,
} from "./ProviderCliVersionBadge";

function makeCheckItem(overrides: Partial<DaemonCliUpdateItemDto> = {}): DaemonCliUpdateItemDto {
  return {
    provider: "codex",
    canonicalProvider: "codex",
    command: "codex",
    packageName: "@openai/codex",
    installed: true,
    installedPath: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\codex.cmd",
    currentVersion: "0.172.0",
    rawVersion: "codex-cli 0.172.0",
    latestVersion: "0.172.0",
    hasUpdate: false,
    updateSupported: true,
    installMethod: "npm-global",
    registryUsed: "https://registry.npmmirror.com",
    checkedAt: 1_700_000_000_000,
    cached: false,
    ...overrides,
  };
}

describe("ProviderCliVersionBadge state machine & rendering", () => {
  it("normalizes CLI version strings cleanly with a leading v", () => {
    expect(formatCliVersionDisplay("0.172.0")).toBe("v0.172.0");
    expect(formatCliVersionDisplay("v0.172.0")).toBe("v0.172.0");
    expect(formatCliVersionDisplay("2.1.331 (Claude Code)")).toBe("v2.1.331");
    expect(formatCliVersionDisplay("codex-cli 0.171.0")).toBe("v0.171.0");
    expect(formatCliVersionDisplay("")).toBeNull();
    expect(formatCliVersionDisplay(null)).toBeNull();
  });

  it("resolves all 6 state-machine phases accurately", () => {
    // 1. Up-to-date -> quiet clickable version badge
    const latestVm = resolveCliVersionBadgeViewModel({
      providerLabel: "Codex",
      currentVersionProp: "0.172.0",
      state: createInitialCliVersionBadgeState(makeCheckItem({ hasUpdate: false })),
    });
    expect(latestVm?.phase).toBe("latest");
    expect(latestVm?.buttonText).toBe("v0.172.0");
    expect(latestVm?.tooltipText).toContain("已是最新");
    expect(latestVm?.interactive).toBe(true);

    // 2. Checking -> subtle loading state
    const checkingVm = resolveCliVersionBadgeViewModel({
      providerLabel: "Codex",
      currentVersionProp: "0.172.0",
      state: { ...createInitialCliVersionBadgeState(), checking: true },
    });
    expect(checkingVm?.phase).toBe("checking");
    expect(checkingVm?.buttonText).toBe("v0.172.0");
    expect(checkingVm?.interactive).toBe(false);

    // 3. Update available -> transforms in-place into one-click update pill button
    const updateVm = resolveCliVersionBadgeViewModel({
      providerLabel: "Codex",
      currentVersionProp: "0.172.0",
      state: createInitialCliVersionBadgeState(
        makeCheckItem({
          currentVersion: "0.172.0",
          latestVersion: "0.173.0",
          hasUpdate: true,
        }),
      ),
    });
    expect(updateVm?.phase).toBe("update-available");
    expect(updateVm?.buttonText).toBe("更新 v0.173.0");
    expect(updateVm?.tooltipText).toContain("当前 v0.172.0 → 最新 v0.173.0");
    expect(updateVm?.tooltipText).toContain("点击立即原地自动更新");
    expect(updateVm?.interactive).toBe(true);

    // 4. Updating -> spinner + disabled double-click guard
    const updatingVm = resolveCliVersionBadgeViewModel({
      providerLabel: "Codex",
      currentVersionProp: "0.172.0",
      state: {
        ...createInitialCliVersionBadgeState(
          makeCheckItem({ currentVersion: "0.172.0", latestVersion: "0.173.0", hasUpdate: true }),
        ),
        updating: true,
      },
    });
    expect(updatingVm?.phase).toBe("updating");
    expect(updatingVm?.buttonText).toBe("更新中…");
    expect(updatingVm?.interactive).toBe(false);

    // 5. Error -> retryable error pill
    const errorVm = resolveCliVersionBadgeViewModel({
      providerLabel: "Codex",
      currentVersionProp: "0.172.0",
      state: {
        ...createInitialCliVersionBadgeState(
          makeCheckItem({ currentVersion: "0.172.0", latestVersion: "0.173.0", hasUpdate: true }),
        ),
        errorMessage: "ETIMEDOUT",
      },
    });
    expect(errorVm?.phase).toBe("error");
    expect(errorVm?.buttonText).toBe("重试 v0.173.0");
    expect(errorVm?.tooltipText).toContain("ETIMEDOUT");
    expect(errorVm?.interactive).toBe(true);

    // 6. Managed native client (antigravity) -> calm read-only version, no fake update button
    const readonlyVm = resolveCliVersionBadgeViewModel({
      providerLabel: "Antigravity",
      currentVersionProp: "1.4.2",
      state: createInitialCliVersionBadgeState(
        makeCheckItem({
          provider: "antigravity",
          canonicalProvider: "antigravity",
          currentVersion: "1.4.2",
          latestVersion: null,
          hasUpdate: false,
          updateSupported: false,
          installMethod: "unsupported",
        }),
      ),
    });
    expect(readonlyVm?.phase).toBe("readonly");
    expect(readonlyVm?.buttonText).toBe("v1.4.2");
    expect(readonlyVm?.interactive).toBe(false);
  });

  it("renders quiet monospace version when up-to-date and transforms into one-click button when update exists", () => {
    const latestHtml = renderToStaticMarkup(
      <TooltipProvider>
        <ProviderCliVersionBadge
          provider="codex"
          currentVersion="0.172.0"
          displayName="Codex"
          disableAutoCheck
          initialCheckItem={makeCheckItem({ hasUpdate: false })}
        />
      </TooltipProvider>,
    );
    expect(latestHtml).toContain('data-cli-version-badge="codex"');
    expect(latestHtml).toContain('data-cli-version-state="latest"');
    expect(latestHtml).toContain("v0.172.0");
    expect(latestHtml).not.toContain("更新 v0.173.0");

    const updateHtml = renderToStaticMarkup(
      <TooltipProvider>
        <ProviderCliVersionBadge
          provider="codex"
          currentVersion="0.172.0"
          displayName="Codex"
          disableAutoCheck
          initialCheckItem={makeCheckItem({
            currentVersion: "0.172.0",
            latestVersion: "0.173.0",
            hasUpdate: true,
          })}
        />
      </TooltipProvider>,
    );
    expect(updateHtml).toContain('data-cli-version-state="update-available"');
    expect(updateHtml).toContain('data-cli-latest-version="v0.173.0"');
    expect(updateHtml).toContain("更新 v0.173.0");
    // Must never render an external <a> redirect link for silent in-place update
    expect(updateHtml).not.toContain("<a ");

    const agyHtml = renderToStaticMarkup(
      <TooltipProvider>
        <ProviderCliVersionBadge
          provider="antigravity"
          currentVersion="1.4.2"
          displayName="Antigravity"
          disableAutoCheck
          initialCheckItem={makeCheckItem({
            provider: "antigravity",
            canonicalProvider: "antigravity",
            currentVersion: "1.4.2",
            latestVersion: null,
            hasUpdate: false,
            updateSupported: false,
            installMethod: "unsupported",
          })}
        />
      </TooltipProvider>,
    );
    expect(agyHtml).toContain('data-cli-version-state="readonly"');
    expect(agyHtml).toContain("<code");
    expect(agyHtml).toContain("v1.4.2");

    // Read-only mode suppresses interactive update pill even when update is available
    const readOnlyHtml = renderToStaticMarkup(
      <TooltipProvider>
        <ProviderCliVersionBadge
          provider="codex"
          currentVersion="0.172.0"
          displayName="Codex"
          readOnly
          disableAutoCheck
          initialCheckItem={makeCheckItem({
            currentVersion: "0.172.0",
            latestVersion: "0.173.0",
            hasUpdate: true,
          })}
        />
      </TooltipProvider>,
    );
    expect(readOnlyHtml).toContain('data-cli-version-state="readonly"');
    expect(readOnlyHtml).toContain("v0.172.0");
    expect(readOnlyHtml).not.toContain("更新 v0.173.0");

    // Empty version renders nothing cleanly
    const emptyHtml = renderToStaticMarkup(
      <TooltipProvider>
        <ProviderCliVersionBadge provider="codex" currentVersion={null} disableAutoCheck />
      </TooltipProvider>,
    );
    expect(emptyHtml).toBe("");
  });
});
