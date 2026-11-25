import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/devices")({
  beforeLoad: ({ location }) => {
    const cleanHash = location.hash.replace(/^#/, "").trim();
    throw redirect({
      to: "/settings/browser",
      search: true,
      hash: cleanHash || "devices",
      replace: true,
    });
  },
  component: () => null,
});
