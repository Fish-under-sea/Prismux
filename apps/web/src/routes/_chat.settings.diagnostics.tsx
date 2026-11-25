import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/diagnostics")({
  beforeLoad: ({ location }) => {
    const cleanHash = location.hash.replace(/^#/, "").trim();
    throw redirect({
      to: "/settings/maintenance",
      search: true,
      hash: cleanHash || "diagnostics",
      replace: true,
    });
  },
  component: () => null,
});
