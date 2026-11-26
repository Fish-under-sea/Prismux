import { expect } from "e2e";

import { test, WEB } from "./prismux.ts";

test(
  "An invalid host filter keeps the Issues page open",
  WEB,
  async ({ prismux, app, browser }) => {
    await prismux.project("demo");
    await prismux.open("/issues?host=true");

    await app.screenshot("issues-invalid-host");
    await expect(browser.locator("h1")).toHaveText("Issues");
  },
);
