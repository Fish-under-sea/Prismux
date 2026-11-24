import { createFileRoute } from "@tanstack/react-router";

import { PrismuxMemorySettingsPage } from "../prismux/settings/PrismuxMemorySyncSettingsPage";

function SettingsMemoryRoute() {
  return <PrismuxMemorySettingsPage />;
}

export const Route = createFileRoute("/_chat/settings/memory")({
  component: SettingsMemoryRoute,
});
