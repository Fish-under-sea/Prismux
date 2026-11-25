import * as Schema from "effect/Schema";

// Separate module avoids an import cycle between settings and usage-limit contracts.
export const UsageLimitSourceId = Schema.String.pipe(Schema.brand("UsageLimitSourceId"));
export type UsageLimitSourceId = typeof UsageLimitSourceId.Type;

export const UsageLimitSourceKind = Schema.Literals(["newapi", "openaiBilling", "cliproxy"]);
export type UsageLimitSourceKind = typeof UsageLimitSourceKind.Type;
