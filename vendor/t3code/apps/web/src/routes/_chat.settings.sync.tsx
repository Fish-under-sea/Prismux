import { createFileRoute } from "@tanstack/react-router";

import { PrismuxSyncSettingsPage } from "../prismux/settings/PrismuxSyncSettingsPage";

function SettingsSyncRoute() {
  return <PrismuxSyncSettingsPage />;
}

export const Route = createFileRoute("/_chat/settings/sync")({
  component: SettingsSyncRoute,
});
