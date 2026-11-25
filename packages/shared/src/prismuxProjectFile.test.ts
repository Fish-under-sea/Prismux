import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  PRISMUX_PROJECT_FILE_NAME,
  LEGACY_T3_PROJECT_FILE_NAME,
  PRISMUX_PROJECT_FILE_SCHEMA_URL,
} from "@prismux/core-contracts";
import {
  buildPrismuxProjectFileJsonSchema,
  parsePrismuxProjectFile,
  PrismuxProjectFileFromJson,
} from "./prismuxProjectFile.ts";

const decodeJson = Schema.decodeUnknownSync(PrismuxProjectFileFromJson);

describe("PrismuxProjectFileFromJson", () => {
  it("uses prismux.json as primary config with prismux.app schema URL and t3.json legacy fallback constant", () => {
    expect(PRISMUX_PROJECT_FILE_NAME).toBe("prismux.json");
    expect(LEGACY_T3_PROJECT_FILE_NAME).toBe("t3.json");
    expect(PRISMUX_PROJECT_FILE_SCHEMA_URL).toBe("https://prismux.app/schema/prismux.json");

    const schema = buildPrismuxProjectFileJsonSchema();
    expect(schema.$id).toBe("https://prismux.app/schema/prismux.json");
    expect(JSON.stringify(schema)).not.toContain(["t3", "codes"].join("."));
    expect(JSON.stringify(schema)).not.toContain(["T3", "Code"].join(" "));
  });

  it("decodes lenient JSONC with comments and trailing commas", () => {
    const decoded = decodeJson(`{
      // team scripts
      "iconPath": "assets/logo.svg",
      "scripts": [
        { "name": "Dev", "command": "pnpm dev", "stopOnSettle": true, },
      ],
    }`);

    expect(decoded.iconPath).toBe("assets/logo.svg");
    expect(decoded.scripts?.[0]).toEqual({ name: "Dev", command: "pnpm dev", stopOnSettle: true });
  });
});

describe("parsePrismuxProjectFile", () => {
  it("reads project defaults from JSONC with a URL in a block comment", () => {
    expect(
      parsePrismuxProjectFile(`{
        /* See https://prismux.app/schema/prismux.json */
        "defaultThreadEnvMode": "worktree"
      }`),
    ).toEqual({ defaultThreadEnvMode: "worktree" });
  });
});
