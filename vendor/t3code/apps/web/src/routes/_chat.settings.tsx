import { workspaceAreaProps } from "../lib/workspaceFocus";
import { Outlet, createFileRoute, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { ImageIcon, PaletteIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { useSettingsRestore } from "../components/settings/SettingsPanels";

import { AppRouteModal, AppRouteModalClose } from "../components/AppRouteModal";
import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { SettingsSidebarNav } from "../components/settings/SettingsSidebarNav";
import {
  SettingsScopeProvider,
  useSettingsScope,
} from "../components/settings/SettingsScopeContext";
import { useEnvironments } from "../state/environments";
import { SettingsScopeNotice } from "../components/settings/SettingsScopeNotice";
import { SETTINGS_DEVICE_ONLY_PATHS } from "../components/settings/SettingsScopeSentence";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "../components/settings/settingsScopeNavigation";
import {
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
  movedSettingsPath,
} from "../components/settings/settingsSearch";

function RestoreDeviceDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      <span className="max-sm:sr-only">
        <T>Restore device defaults</T>
      </span>
    </Button>
  );
}

function SettingsScopeBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  const { environments } = useEnvironments();
  const gt = useGT();
  const m = useMessages();
  const hash = useLocation({ select: (location) => location.hash });
  const searchTarget = getSettingsSearchTargetScope(hash);
  const autoSettlementAvailability = searchTarget?.requiresThreadAutoSettlement
    ? getThreadAutoSettlementSearchAvailability(environments, scope)
    : null;
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    autoSettlementAvailability &&
    !autoSettlementAvailability.isTargetAvailable
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        targetId={hash}
        eligibleEnvironmentIds={autoSettlementAvailability.eligibleEnvironmentIds}
      >
        {autoSettlementAvailability.eligibleEnvironmentIds.length > 0
          ? gt("{title} requires a supporting environment. Choose one to continue.", {
              title: m(searchTarget.title),
            })
          : gt(
              "{title} requires a supporting environment. Connect or update an environment to continue.",
              { title: m(searchTarget.title) },
            )}
      </SettingsScopeNotice>
    );
  }
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    !isSettingsSearchScopeAvailable(searchTarget.scope, scope.kind)
  ) {
    const target =
      searchTarget.scope === "environment" ||
      searchTarget.scope === "project" ||
      searchTarget.scope === "checkout"
        ? searchTarget.scope
        : "all";
    return (
      <SettingsScopeNotice target={target} targetId={hash}>
        {gt(
          "{title} is not available for the selected target. Choose its owning scope to continue.",
          { title: m(searchTarget.title) },
        )}
      </SettingsScopeNotice>
    );
  }
  if (
    SETTINGS_DEVICE_ONLY_PATHS.has(pathname) ||
    pathname === "/settings/projects" ||
    pathname === "/settings/diagnostics"
  ) {
    return children;
  }
  if (scope.kind === "unavailable")
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">{scope.message}</p>
      </SettingsPageContainer>
    );
  if (scope.kind === "environment" && connectedEnvironments.length === 0) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          <T>
            Reconnect <Var>{scope.label}</Var> to change its settings.
          </T>
        </p>
      </SettingsPageContainer>
    );
  }
  return children;
}

const APPEARANCE_WALLPAPER_TABS = [
  {
    to: "/settings/appearance" as const,
    label: msg("Appearance & Themes"),
    Icon: PaletteIcon,
  },
  {
    to: "/settings/wallpaper" as const,
    label: msg("Wallpaper Engine"),
    Icon: ImageIcon,
  },
] as const;

function AppearanceWallpaperSubNav({ pathname }: { pathname: string }) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const activeIndex = pathname === "/settings/wallpaper" ? 1 : 0;

  const selectTab = (to: (typeof APPEARANCE_WALLPAPER_TABS)[number]["to"]) => {
    if (pathname === to) return;
    void navigate({
      to,
      hash: "",
      replace: true,
      hashScrollIntoView: false,
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? APPEARANCE_WALLPAPER_TABS.length - 1
          : (activeIndex + (event.key === "ArrowRight" ? 1 : -1) + APPEARANCE_WALLPAPER_TABS.length) %
            APPEARANCE_WALLPAPER_TABS.length;
    const nextTab = APPEARANCE_WALLPAPER_TABS[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab.to);
    const button = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex];
    button?.focus();
  };

  return (
    <div className="shrink-0 border-b border-border/80 bg-background/70 px-5 py-2">
      <div
        role="tablist"
        aria-label={gt("Appearance and wallpaper views")}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-muted/60 p-1"
      >
        {APPEARANCE_WALLPAPER_TABS.map(({ to, label, Icon }, index) => {
          const isSelected = index === activeIndex;
          return (
            <button
              key={to}
              type="button"
              role="tab"
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              data-appearance-subtab={to}
              onClick={() => selectTab(to)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
                isSelected
                  ? "bg-background text-foreground shadow-xs ring-1 ring-inset ring-border/80"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span>{m(label)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SettingsContentLayout() {
  const gt = useGT();
  const contentArea = workspaceAreaProps("settings", 1, gt("Settings content"));
  const location = useLocation();
  const { search, environment } = useSettingsScope();
  const contentScopeKey =
    location.pathname === "/settings/diagnostics" || location.pathname === "/settings/providers"
      ? environment?.environmentId
      : JSON.stringify(search);
  const [restoreSignal, setRestoreSignal] = useState(0);
  const showAppearanceSubNav =
    location.pathname === "/settings/appearance" || location.pathname === "/settings/wallpaper";

  return (
    <AppRouteModal label={gt("Settings")}>
      <div className="relative flex min-h-0 flex-1">
        <SettingsSidebarNav pathname={location.pathname} />
        <div {...contentArea} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
            <SettingsBreadcrumb pathname={location.pathname} />
            <div className="ms-auto flex shrink-0 items-center gap-1">
              {location.pathname === "/settings/general" ? (
                <RestoreDeviceDefaultsButton
                  onRestored={() => setRestoreSignal((value) => value + 1)}
                />
              ) : null}
              <AppRouteModalClose />
            </div>
          </header>
          {showAppearanceSubNav ? <AppearanceWallpaperSubNav pathname={location.pathname} /> : null}
          <div key={`${contentScopeKey}:${restoreSignal}`} className="min-h-0 flex flex-1 flex-col">
            <SettingsScopeBoundary pathname={location.pathname}>
              <Outlet />
            </SettingsScopeBoundary>
          </div>
        </div>
      </div>
    </AppRouteModal>
  );
}

function SettingsRouteLayout() {
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <SettingsScopeProvider
      search={rawSearch}
      singleEnvironment={pathname === "/settings/providers" || pathname === "/settings/secrets"}
      deviceOnly={SETTINGS_DEVICE_ONLY_PATHS.has(pathname)}
      onChange={(next) => {
        // Send every axis so retain middleware recognizes "all" as an explicit target.
        void navigate({
          to: pathname,
          search: () => ({
            project: next.project,
            machine: next.machine,
            checkout: next.checkout,
          }),
          hash: "",
          resetScroll: false,
        });
      }}
    >
      <SettingsContentLayout />
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/_chat/settings")({
  validateSearch: validateSettingsRouteSearch,
  search: { middlewares: [retainSettingsScope] },
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
    if (location.pathname === "/settings/updates") {
      throw redirect({
        to: "/settings/about",
        search: true,
        hash: location.hash ? location.hash.replace(/^#/, "") : "prismux-updates",
        replace: true,
      });
    }
    const cleanHash = location.hash ? location.hash.replace(/^#/, "") : "";
    const moved = movedSettingsPath(location.pathname, cleanHash);
    if (moved) throw redirect({ to: moved, search: true, hash: true, replace: true });
  },
  component: SettingsRouteLayout,
});
