import { createFileRoute } from "@tanstack/react-router";

import { PrismuxUpdatesSettingsPage } from "../prismux/settings/PrismuxUpdatesSettingsPage";

function SettingsUpdatesRoute() {
  return <PrismuxUpdatesSettingsPage />;
}

export const Route = createFileRoute("/_chat/settings/updates")({
  component: SettingsUpdatesRoute,
});
