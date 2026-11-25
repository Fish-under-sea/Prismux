import { createFileRoute } from "@tanstack/react-router";

import { PrismuxDiagnosticsSection } from "../prismux/settings/PrismuxDiagnosticsSection";

function DiagnosticsRoute() {
  return <PrismuxDiagnosticsSection variant="full" standalone />;
}

export const Route = createFileRoute("/_chat/diagnostics")({
  component: DiagnosticsRoute,
});
