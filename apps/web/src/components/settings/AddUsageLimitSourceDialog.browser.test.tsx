import { EnvironmentId } from "@prismux/core-contracts";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const updateSettings = vi.hoisted(() => vi.fn());

vi.mock(import("../../hooks/useSettings"), async (original) => ({
  ...(await original()),
  useUpdateEnvironmentSettings: (() => updateSettings) as never,
}));
vi.mock(import("./SecretSourceInput"), async (original) => ({
  ...(await original()),
  useSecretSources: () => [],
}));

import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";

describe("AddUsageLimitSourceDialog", () => {
  it("adds a New API relay by default when Enter is pressed in a field", async () => {
    updateSettings.mockClear();
    const onOpenChange = vi.fn();
    await using _screen = await render(
      <AddUsageLimitSourceDialog
        open
        onOpenChange={onOpenChange}
        environmentId={EnvironmentId.make("local")}
        environmentLabel="This Machine"
        sources={{}}
      />,
    );

    await userEvent.type(page.getByLabelText("Relay URL"), "https://api.example.com");
    await userEvent.type(
      page.getByLabelText("API key (sk-...) or system access token"),
      "sys-token-123",
    );
    await userEvent.type(page.getByLabelText("User ID (New-Api-User, optional)"), "7{Enter}");

    expect(updateSettings).toHaveBeenCalledOnce();
    expect(updateSettings).toHaveBeenCalledWith({
      usageLimitSources: {
        "newapi-api.example.com": expect.objectContaining({
          kind: "newapi",
          url: "https://api.example.com",
          managementKey: "sys-token-123",
          userId: "7",
          enabled: true,
        }),
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports switching to OpenAI Billing relay protocol without exposing CLIProxyAPI", async () => {
    updateSettings.mockClear();
    const onOpenChange = vi.fn();
    await using _screen = await render(
      <AddUsageLimitSourceDialog
        open
        onOpenChange={onOpenChange}
        environmentId={EnvironmentId.make("local")}
        environmentLabel="This Machine"
        sources={{}}
      />,
    );

    await userEvent.click(page.getByRole("radio", { name: /OpenAI Billing/i }));
    await userEvent.type(page.getByLabelText("Base URL"), "https://relay.example.com/v1");
    await userEvent.type(page.getByLabelText("API Key"), "secret-key{Enter}");

    expect(updateSettings).toHaveBeenCalledOnce();
    expect(updateSettings).toHaveBeenCalledWith({
      usageLimitSources: {
        "relay-relay.example.com": expect.objectContaining({
          kind: "openaiBilling",
          url: "https://relay.example.com/v1",
          managementKey: "secret-key",
          enabled: true,
        }),
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
