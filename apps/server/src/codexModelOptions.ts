import type { ModelCapabilities, ModelSelection } from "@prismux/core-contracts";
import {
  getFastModeDescriptor,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  supportsFastMode,
} from "@prismux/core-shared/model";

export type CanonicalCodexServiceTier = "default" | "fast" | "ultrafast";

/**
 * Normalizes a Codex service_tier value into the canonical set (`default` | `fast` | `ultrafast`):
 * - Legacy `"priority"` maps to `"fast"`.
 * - Hidden `"flex"` and unknown values explicitly reset to `"default"`.
 */
export function normalizeCodexServiceTier(
  raw: string | null | undefined,
): CanonicalCodexServiceTier | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "fast" || normalized === "priority") return "fast";
  if (normalized === "ultrafast") return "ultrafast";
  return "default";
}

function tierSupportedByCapabilities(
  tier: CanonicalCodexServiceTier,
  capabilities: ModelCapabilities | null | undefined,
): boolean {
  if (tier === "default") return true;
  if (capabilities === undefined) return true;
  if (capabilities === null) return false;
  const control = getFastModeDescriptor(capabilities);
  if (!control || control.kind !== "serviceTier") return false;
  return tier === "ultrafast" ? control.ultrafastChoice !== null : control.fastChoice !== null;
}

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
  capabilities?: ModelCapabilities | null,
): string | undefined {
  const rawServiceTier = getModelSelectionStringOptionValue(modelSelection, "serviceTier");
  if (rawServiceTier !== undefined) {
    const normalized = normalizeCodexServiceTier(rawServiceTier) ?? "default";
    return tierSupportedByCapabilities(normalized, capabilities) ? normalized : "default";
  }
  const legacyFastMode = getModelSelectionBooleanOptionValue(modelSelection, "fastMode");
  if (legacyFastMode === true) {
    return tierSupportedByCapabilities("fast", capabilities) ? "fast" : "default";
  }
  if (legacyFastMode === false) {
    return "default";
  }
  if (capabilities !== undefined && !supportsFastMode(capabilities)) {
    return "default";
  }
  return undefined;
}
