import * as Schema from "effect/Schema";

// Separate module avoids an import cycle between settings and usage-limit contracts.
export const UsageLimitSourceId = Schema.String.pipe(Schema.brand("UsageLimitSourceId"));
export type UsageLimitSourceId = typeof UsageLimitSourceId.Type;

export const UsageLimitSourceKind = Schema.Literals(["newapi", "openaiBilling"]);
export type UsageLimitSourceKind = typeof UsageLimitSourceKind.Type;

/** Wire-compatible snapshot kind retaining legacy values for read-only display/tests. */
export const LegacyUsageLimitSourceKind = Schema.Literals([
  "newapi",
  "openaiBilling",
  "cliproxy",
]);
export type LegacyUsageLimitSourceKind = typeof LegacyUsageLimitSourceKind.Type;
