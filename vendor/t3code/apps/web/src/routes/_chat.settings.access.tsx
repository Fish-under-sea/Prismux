import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/access")({
  beforeLoad: ({ location }) => {
    const cleanHash = location.hash.replace(/^#/, "").trim();
    throw redirect({
      to: "/settings/connections",
      search: true,
      hash: cleanHash || "remote-access",
      replace: true,
    });
  },
  component: () => null,
});
