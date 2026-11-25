import { createFileRoute } from "@tanstack/react-router";

import { PrismuxWallpaperSettingsPage } from "../prismux/settings/PrismuxWallpaperSettingsPage";

function SettingsWallpaperRoute() {
  return <PrismuxWallpaperSettingsPage />;
}

export const Route = createFileRoute("/_chat/settings/wallpaper")({
  component: SettingsWallpaperRoute,
});
