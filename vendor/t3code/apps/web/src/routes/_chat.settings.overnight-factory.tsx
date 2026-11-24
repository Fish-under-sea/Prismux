import { createFileRoute } from "@tanstack/react-router";

import { PrismuxOvernightFactorySettingsPage } from "../prismux/settings/PrismuxOvernightFactorySettingsPage";

function SettingsOvernightFactoryRoute() {
  return <PrismuxOvernightFactorySettingsPage />;
}

export const Route = createFileRoute("/_chat/settings/overnight-factory")({
  component: SettingsOvernightFactoryRoute,
});
