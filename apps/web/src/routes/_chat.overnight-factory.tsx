import { createFileRoute } from "@tanstack/react-router";

import { PrismuxOvernightFactorySettingsPage } from "../prismux/settings/PrismuxOvernightFactorySettingsPage";

function OvernightFactoryRoute() {
  return <PrismuxOvernightFactorySettingsPage standalone />;
}

export const Route = createFileRoute("/_chat/overnight-factory")({
  component: OvernightFactoryRoute,
});
