import { createFileRoute } from "@tanstack/react-router";

import { PrismuxMemorySyncSettingsPage } from "../prismux/settings/PrismuxMemorySyncSettingsPage";

function SettingsMemorySyncRoute() {
  return <PrismuxMemorySyncSettingsPage />;
}

export const Route = createFileRoute("/_chat/settings/memory-sync")({
  component: SettingsMemorySyncRoute,
});
