import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { PrismuxProjectFile, PRISMUX_PROJECT_FILE_SCHEMA_URL } from "@prismux/core-contracts";

import { fromLenientJson } from "./schemaJson.ts";

export const PrismuxProjectFileFromJson = fromLenientJson(PrismuxProjectFile);

const decodePrismuxProjectFile = Schema.decodeExit(PrismuxProjectFileFromJson);

export function parsePrismuxProjectFile(contents: string): PrismuxProjectFile | null {
  const decoded = decodePrismuxProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function buildPrismuxProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(PrismuxProjectFile, { onExcessProperty: "error" });
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: PRISMUX_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
