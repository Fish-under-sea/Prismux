import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/settings/overnight-factory")({
  beforeLoad: () => {
    throw redirect({
      to: "/overnight-factory",
      replace: true,
    });
  },
  component: () => null,
});
