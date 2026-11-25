import { createFileRoute } from "@tanstack/react-router";

import { PrismuxPluginsSettingsPage } from "../prismux/settings/PrismuxPluginsSettingsPage";

function SettingsPluginsRoute() {
  return <PrismuxPluginsSettingsPage />;
}

export const Route = createFileRoute("/_chat/settings/plugins")({
  component: SettingsPluginsRoute,
});
