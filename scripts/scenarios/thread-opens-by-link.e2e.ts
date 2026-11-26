import { expect } from "e2e";

import { test, WEB } from "./prismux.ts";

test(
  "A seeded thread opens by its link and shows its history",
  WEB,
  async ({ prismux, app, screen }) => {
    const project = await prismux.project("demo");
    const thread = await prismux.thread({
      project,
      title: "Earlier work",
      messages: ["first", "second"],
    });
    await prismux.open(thread);

    await expect(screen.getByText("second fixture turn complete", { exact: false })).toBeVisible();
    await app.screenshot("thread");
  },
);
