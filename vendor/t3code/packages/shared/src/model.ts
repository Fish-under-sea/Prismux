import {
  type CustomModelSetting,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  ModelCapabilities,
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionChoice,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { copySorted } from "./Array.ts";

const DEFAULT_PROVIDER_DRIVER_KIND = ProviderDriverKind.make("codex");

export function modelSelectionCommandType(
  currentInstanceId: ProviderInstanceId,
  selection: ModelSelection,
) {
  return currentInstanceId === selection.instanceId
    ? ("thread.model-selection.set" as const)
    : ("provider.switch" as const);
}

export interface SelectableModelOption {
  slug: string;
  name: string;
  aliases?: ReadonlyArray<string> | undefined;
}

export function createModelCapabilities(input: {
  optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
}): ModelCapabilities {
  return {
    optionDescriptors: input.optionDescriptors.map(cloneDescriptor),
  };
}

function getRawSelectionValueById(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): string | boolean | undefined {
  const selection = selections?.find((candidate) => candidate.id === id);
  return selection?.value;
}

function getProviderOptionSelectionValue(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): string | boolean | undefined {
  return getRawSelectionValueById(selections, id);
}

function getProviderOptionStringSelectionValue(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): string | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "string" ? value : undefined;
}

function getProviderOptionBooleanSelectionValue(
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
): boolean | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "boolean" ? value : undefined;
}

export function getModelSelectionStringOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  return getProviderOptionStringSelectionValue(modelSelection?.options, id);
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): boolean | undefined {
  return getProviderOptionBooleanSelectionValue(modelSelection?.options, id);
}

function canonicalModelSelectionOptions(
  modelSelection: ModelSelection,
): ReadonlyArray<readonly [id: string, value: string | boolean]> {
  return copySorted(
    (modelSelection.options ?? []).map(
      (selection): readonly [id: string, value: string | boolean] => [
        selection.id,
        selection.value,
      ],
    ),
    (
      [leftId, leftValue]: readonly [id: string, value: string | boolean],
      [rightId, rightValue]: readonly [id: string, value: string | boolean],
    ) => {
      const idOrder = leftId.localeCompare(rightId);
      return idOrder !== 0 ? idOrder : String(leftValue).localeCompare(String(rightValue));
    },
  );
}

export function modelSelectionsEqual(left: ModelSelection, right: ModelSelection): boolean {
  if (left.instanceId !== right.instanceId || left.model !== right.model) {
    return false;
  }
  const leftOptions = canonicalModelSelectionOptions(left);
  const rightOptions = canonicalModelSelectionOptions(right);
  return (
    leftOptions.length === rightOptions.length &&
    leftOptions.every(
      ([id, value], index) => id === rightOptions[index]?.[0] && value === rightOptions[index]?.[1],
    )
  );
}

/**
 * Whether a composer's draft model pick is what the thread already runs. Web sends
 * `fastMode: false` for models with a fast toggle while mobile omits it, so off counts as unset.
 */
export function draftModelPickMatchesThread(pick: ModelSelection, thread: ModelSelection): boolean {
  const withoutFastModeOff = (selection: ModelSelection) =>
    createModelSelection(
      selection.instanceId,
      selection.model,
      selection.options?.filter((option) => option.id !== "fastMode" || option.value !== false),
    );
  return modelSelectionsEqual(withoutFastModeOff(pick), withoutFastModeOff(thread));
}

/** Cursor ACP can default Fast to true; T3 requires a user selection. */
export function withImplicitFastModeDefault(
  caps: ModelCapabilities,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const hasExplicitFastMode = modelOptions?.some((selection) => selection.id === "fastMode");
  if (hasExplicitFastMode) {
    return modelOptions ?? undefined;
  }
  const hasFastModeDescriptor = caps.optionDescriptors?.some(
    (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  if (!hasFastModeDescriptor) {
    return modelOptions ?? undefined;
  }
  return [...(modelOptions ?? []), { id: "fastMode", value: false }];
}

function resolveDescriptorChoiceValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  raw: string | null | undefined,
): string | undefined {
  const trimmed = trimOrNull(raw);
  if (!trimmed) {
    return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
  }
  if (descriptor.options.length === 0) {
    return trimmed;
  }
  if (
    descriptor.promptInjectedValues?.includes(trimmed) &&
    descriptor.options.some((option) => option.id === trimmed)
  ) {
    return descriptor.options.find((option) => option.isDefault)?.id;
  }
  if (descriptor.options.some((option) => option.id === trimmed)) {
    return trimmed;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

function cloneDescriptor(descriptor: ProviderOptionDescriptor): ProviderOptionDescriptor {
  return descriptor.type === "select"
    ? {
        ...descriptor,
        options: [...descriptor.options],
        ...(descriptor.promptInjectedValues
          ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
          : {}),
      }
    : { ...descriptor };
}

function cloneSelection(selection: ProviderOptionSelection): ProviderOptionSelection {
  return { ...selection };
}

function withDescriptorCurrentValue(
  descriptor: ProviderOptionDescriptor,
  rawCurrentValue: string | boolean | undefined,
): ProviderOptionDescriptor {
  if (descriptor.type === "boolean") {
    if (typeof rawCurrentValue === "boolean") {
      return {
        ...descriptor,
        currentValue: rawCurrentValue,
      };
    }
    return descriptor;
  }
  const currentValue =
    typeof rawCurrentValue === "string"
      ? resolveDescriptorChoiceValue(descriptor, rawCurrentValue)
      : resolveDescriptorChoiceValue(descriptor, descriptor.currentValue);
  if (!currentValue) {
    const { currentValue: _unusedCurrentValue, ...rest } = descriptor;
    return rest;
  }
  return {
    ...descriptor,
    currentValue,
  };
}

// Ultracode was a Claude effort level before it became its own toggle; that level ran at xhigh.
export function withLegacyUltracodeEffort<
  Selections extends ReadonlyArray<ProviderOptionSelection> | null | undefined,
>(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | null | undefined,
  selections: Selections,
): Selections | Array<ProviderOptionSelection> {
  if (
    getRawSelectionValueById(selections, "effort") !== "ultracode" ||
    !descriptors?.some(
      (descriptor) => descriptor.id === "ultracode" && descriptor.type === "boolean",
    )
  ) {
    return selections;
  }
  return [
    ...(selections ?? []).map((selection) =>
      selection.id === "effort" && selection.value === "ultracode"
        ? { id: "effort", value: "xhigh" }
        : selection,
    ),
    ...(getRawSelectionValueById(selections, "ultracode") === undefined
      ? [{ id: "ultracode", value: true }]
      : []),
  ];
}

export function getProviderOptionDescriptors(input: {
  caps: ModelCapabilities;
  selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const { caps } = input;
  const baseDescriptors = (caps.optionDescriptors ?? []).map(cloneDescriptor);
  const selections = withLegacyUltracodeEffort(baseDescriptors, input.selections);

  return baseDescriptors.map((descriptor) =>
    withDescriptorCurrentValue(
      descriptor,
      getRawSelectionValueById(selections, descriptor.id) ?? descriptor.currentValue,
    ),
  );
}

function getReportedOptionValue(
  id: string,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
) {
  if (
    !selection ||
    !reportedSelection ||
    selection.instanceId !== reportedSelection.instanceId ||
    selection.model !== reportedSelection.model ||
    selection.options?.some((option) => option.id === id)
  )
    return undefined;
  return getRawSelectionValueById(reportedSelection.options, id);
}

export function getProviderOptionStatedValue(
  id: string,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
) {
  return (
    getRawSelectionValueById(selection?.options, id) ??
    getReportedOptionValue(id, selection, reportedSelection)
  );
}

/** The variant choice that sends no variant; distinct from any variant name a provider defines. */
export const DEFAULT_VARIANT_CHOICE_ID = "t3:default";

export function getProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor | null | undefined,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): string | boolean | undefined {
  if (!descriptor) {
    return undefined;
  }
  const hasExplicitOption = selection?.options?.some((option) => option.id === descriptor.id);
  // Reported values are display-only; callers that build dispatch options omit this context.
  const reportedValue = getReportedOptionValue(descriptor.id, selection, reportedSelection);
  if (reportedValue !== undefined) return reportedValue;
  // Without an explicit variant none is sent, which is exactly the catalog's Default choice.
  if (
    descriptor.type === "select" &&
    descriptor.id === "variant" &&
    selection &&
    !hasExplicitOption &&
    descriptor.options.some((option) => option.id === DEFAULT_VARIANT_CHOICE_ID)
  ) {
    return DEFAULT_VARIANT_CHOICE_ID;
  }
  if (descriptor.id === "variant" && selection && !hasExplicitOption) return undefined;
  if (descriptor.type === "boolean") {
    return descriptor.currentValue;
  }
  if (descriptor.currentValue) {
    return descriptor.currentValue;
  }
  return descriptor.options.find((option) => option.isDefault)?.id;
}

export function getProviderOptionCurrentLabel(
  descriptor: ProviderOptionDescriptor | null | undefined,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): string | undefined {
  if (!descriptor) {
    return undefined;
  }
  if (descriptor.type === "boolean") {
    return typeof descriptor.currentValue === "boolean"
      ? descriptor.currentValue
        ? "On"
        : "Off"
      : undefined;
  }
  const currentValue = getProviderOptionCurrentValue(descriptor, selection, reportedSelection);
  return (
    descriptor.options.find((option) => option.id === currentValue)?.label ??
    (getReportedOptionValue(descriptor.id, selection, reportedSelection) === "default"
      ? "Default"
      : descriptor.id === "variant"
        ? "Unknown"
        : undefined)
  );
}

export function buildProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | null | undefined,
): Array<ProviderOptionSelection> | undefined {
  if (!descriptors || descriptors.length === 0) {
    return undefined;
  }

  const nextSelections: Array<ProviderOptionSelection> = [];

  for (const descriptor of descriptors) {
    const value = getProviderOptionCurrentValue(descriptor);
    if (typeof value === "string" || typeof value === "boolean") {
      nextSelections.push({ id: descriptor.id, value });
    }
  }

  return nextSelections.length > 0 ? nextSelections : undefined;
}

export function buildExplicitProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | null | undefined,
  selections: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): Array<ProviderOptionSelection> | undefined {
  if (!selections || selections.length === 0) {
    return undefined;
  }
  const explicitIds = new Set(
    withLegacyUltracodeEffort(descriptors, selections).map(({ id }) => id),
  );
  const normalized = buildProviderOptionSelectionsFromDescriptors(descriptors)?.filter(
    (selection) => explicitIds.has(selection.id),
  );
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function codexModelFamily(slug: string): string {
  const base = slug.slice(slug.lastIndexOf("/") + 1);
  return base.startsWith("openai.gpt-") ? base.slice("openai.".length) : base;
}

export function formatCodexModelName(name: string): string {
  return name.replace(/^gpt/i, "GPT").replace(/-([a-z])/g, (_, c) => "-" + c.toUpperCase());
}

const MODEL_ROUTING_COLON_PREFIX =
  /^(?:openai|anthropic|google|gemini|xai|x-ai|deepseek|qwen|zhipu|glm|openrouter|bedrock|vertex|azure|antigravity|codex|claude|claudeagent|cursor|pi|opencode|grok|dsh|meta|mistral|moonshot|minimax|kimi):(?=\S)/i;
const MODEL_VENDOR_LABEL_PREFIX = /^[A-Za-z0-9][A-Za-z0-9.&\- ]{0,24}:\s+(?=\S)/;
const MODEL_DOTTED_VENDOR_PREFIX =
  /^(?:(?:us|eu|ap|global|ca|sa|me|af)\.)?(?:anthropic|openai|google|meta|amazon|mistral|cohere|deepseek|xai)\./i;
const MODEL_DSH_DASH_PREFIX =
  /^dsh-(?=(?:gpt|claude|opus|sonnet|haiku|fable|gemini|grok|deepseek|qwen|glm|o[134])(?:[-.\s\d]|$))/i;
const MODEL_PURE_VERSION_TOKEN = /^v?\d+(?:\.\d+)*$/i;

const MODEL_TOKEN_CANONICAL: Readonly<Record<string, string>> = {
  gpt: "GPT",
  oss: "OSS",
  glm: "GLM",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  grok: "Grok",
  claude: "Claude",
  gemini: "Gemini",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable",
  codex: "Codex",
  astra: "Astra",
  sol: "Sol",
  luna: "Luna",
  terra: "Terra",
  neon: "Neon",
  carbon: "Carbon",
  argon: "Argon",
  flash: "Flash",
  pro: "Pro",
  mini: "Mini",
  nano: "Nano",
  max: "Max",
  ultra: "Ultra",
  plus: "Plus",
  lite: "Lite",
  fast: "Fast",
  turbo: "Turbo",
  spark: "Spark",
  coder: "Coder",
  chat: "Chat",
  reasoner: "Reasoner",
  thinking: "Thinking",
  preview: "Preview",
  air: "Air",
  ai: "AI",
  vl: "VL",
  r1: "R1",
  r2: "R2",
  o1: "o1",
  o3: "o3",
  o4: "o4",
};

function stripModelWireNoise(raw: string): string {
  let value = raw.trim();
  if (!value) return "";

  for (let pass = 0; pass < 3; pass += 1) {
    const before = value;
    value = value.replace(MODEL_VENDOR_LABEL_PREFIX, "").trim();
    value = value.replace(MODEL_ROUTING_COLON_PREFIX, "").trim();
    const slashIndex = value.lastIndexOf("/");
    if (slashIndex >= 0 && slashIndex < value.length - 1) {
      value = value.slice(slashIndex + 1).trim();
    }
    value = value.replace(MODEL_DOTTED_VENDOR_PREFIX, "").trim();
    value = value.replace(MODEL_DSH_DASH_PREFIX, "").trim();
    if (value === before) break;
  }

  return value
    .replace(/\[[^\]]*\]$/, "")
    .replace(/@[^@\s]*$/, "")
    .replace(/-v\d+(?::\d+)?$/i, "")
    .replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8})$/, "")
    .trim();
}

function formatModelToken(token: string): string {
  const parens = /^\((.+)\)$/.exec(token);
  if (parens?.[1]) {
    return `(${formatModelTokens(parens[1])})`;
  }
  const lower = token.toLowerCase();
  const canonical = MODEL_TOKEN_CANONICAL[lower];
  if (canonical !== undefined) return canonical;
  if (/^v\d+(?:\.\d+)*$/i.test(token)) {
    return `V${token.slice(1)}`;
  }
  if (/^(?:a)?\d+(?:\.\d+)?[bmk]$/i.test(token)) {
    return token.toUpperCase();
  }
  if (/^[a-z]/.test(token)) {
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
  return token;
}

function formatModelTokens(text: string): string {
  const tokens = text
    .trim()
    .split(/[\s_-]+/)
    .filter((token) => token.length > 0);
  return tokens.map(formatModelToken).join(" ");
}

function hasNonVersionWord(text: string): boolean {
  return text
    .replace(/[()]/g, " ")
    .split(/[\s_-]+/)
    .some((word) => word.length > 0 && !MODEL_PURE_VERSION_TOKEN.test(word));
}

function normalizeHyphenMinorVersion(text: string): string {
  return text.replace(/^(\d+)-(\d{1,2})(?=[-\s]|$)/, "$1.$2");
}

/**
 * Normalizes raw model slugs and provider display names into concise, properly cased
 * short names across OpenAI, Claude, Gemini/Antigravity, Grok, DeepSeek, Qwen, GLM, and dsh.
 */
export function formatModelSlugName(slug: string): string {
  const core = stripModelWireNoise(slug);
  if (!core) return "";

  const gptOss = /^gpt-oss(?:[-\s]+(.+))?$/i.exec(core);
  if (gptOss) {
    const rest = gptOss[1]?.trim();
    return rest ? `GPT-OSS ${formatModelTokens(rest)}` : "GPT-OSS";
  }

  const gpt = /^gpt[-\s]+(\d+(?:\.\d+)?)(?:[-\s]+(.+))?$/i.exec(core);
  if (gpt?.[1]) {
    const version = gpt[1];
    const rest = gpt[2]?.trim();
    if (rest && hasNonVersionWord(rest)) {
      return `${version} ${formatModelTokens(rest)}`;
    }
    return `GPT-${version}`;
  }

  const claude = /^(?:claude[-\s]+)?(opus|sonnet|haiku|fable)(?:[-\s]+(.+))?$/i.exec(core);
  if (claude?.[1]) {
    const family = formatModelToken(claude[1]);
    const rest = claude[2]?.trim();
    if (!rest) return family;
    return `${family} ${formatModelTokens(normalizeHyphenMinorVersion(rest))}`;
  }

  const gemini = /^gemini[-\s]+(\d+(?:[.-]\d{1,2}(?=[-\s]|$))?)(?:[-\s]+(.+))?$/i.exec(core);
  if (gemini?.[1]) {
    const version = gemini[1].replace("-", ".");
    const rest = gemini[2]?.trim();
    if (rest && hasNonVersionWord(rest)) {
      return `${version} ${formatModelTokens(rest)}`;
    }
    return `Gemini ${version}`;
  }
  const geminiNamed = /^gemini[-\s]+(.+)$/i.exec(core);
  if (geminiNamed?.[1]) {
    return `Gemini ${formatModelTokens(geminiNamed[1])}`;
  }

  const grok = /^grok(?:[-\s]+(.+))?$/i.exec(core);
  if (grok) {
    const rest = grok[1]?.trim();
    if (!rest) return "Grok";
    return `Grok ${formatModelTokens(normalizeHyphenMinorVersion(rest))}`;
  }

  const deepseek = /^deepseek(?:[-\s]+(.+))?$/i.exec(core);
  if (deepseek) {
    const rest = deepseek[1]?.trim();
    if (!rest) return "DeepSeek";
    const normalizedRest = rest.replace(/^(v\d+)-(\d{1,2})(?=[-\s]|$)/i, "$1.$2");
    return `DeepSeek ${formatModelTokens(normalizedRest)}`;
  }

  const qwen = /^qwen(?:[-\s]*(\d+(?:[.-]\d{1,2}(?=[-\s]|$))?))?(?:[-\s]+(.+))?$/i.exec(core);
  if (qwen && (qwen[1] || qwen[2] || /^qwen$/i.test(core))) {
    const version = qwen[1]?.replace("-", ".");
    const rest = qwen[2]?.trim();
    return ["Qwen", version, rest ? formatModelTokens(rest) : ""].filter(Boolean).join(" ");
  }

  const glm = /^glm(?:[-\s]+(.+))?$/i.exec(core);
  if (glm) {
    const rest = glm[1]?.trim();
    if (!rest) return "GLM";
    return `GLM ${formatModelTokens(normalizeHyphenMinorVersion(rest))}`;
  }

  const oSeries = /^(o[134])(?:[-\s]+(.+))?$/i.exec(core);
  if (oSeries?.[1]) {
    const family = oSeries[1].toLowerCase();
    const rest = oSeries[2]?.trim();
    return rest ? `${family} ${formatModelTokens(rest)}` : family;
  }

  if (/^[a-z0-9]+(?:[-_][a-z0-9.]+)+$/.test(core)) {
    return formatModelTokens(core);
  }

  return core;
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderDriverKind = DEFAULT_PROVIDER_DRIVER_KIND,
): string | null {
  const trimmed = normalizeCustomModelSlug(model);
  if (!trimmed) {
    return null;
  }

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] ?? {};
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
  return typeof aliased === "string" ? aliased : trimmed;
}

/** Custom model identifiers are provider-owned, so only trim them; never expand aliases. */
export function normalizeCustomModelSlug(model: string | null | undefined): string | null {
  if (typeof model !== "string") {
    return null;
  }

  return model.trim() || null;
}

export interface CustomModelDefinition {
  readonly slug: string;
  readonly name: string;
  readonly capabilities: ModelCapabilities | null;
}

const decodeCustomModelCapabilities = Schema.decodeUnknownOption(ModelCapabilities);

export function readCustomModelEntries(value: unknown): CustomModelDefinition[] {
  if (!Array.isArray(value)) return [];
  const entries: CustomModelDefinition[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const record =
      typeof raw === "string"
        ? { slug: raw }
        : raw !== null && typeof raw === "object"
          ? (raw as { slug?: unknown; name?: unknown; capabilities?: unknown })
          : null;
    if (!record) continue;
    const slug = normalizeCustomModelSlug(typeof record.slug === "string" ? record.slug : null);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const name =
      (typeof record.name === "string" ? normalizeCustomModelSlug(record.name) : null) ?? slug;
    const capabilities =
      record.capabilities === undefined || record.capabilities === null
        ? null
        : Option.getOrNull(decodeCustomModelCapabilities(record.capabilities));
    entries.push({
      slug,
      name,
      capabilities: capabilities
        ? createModelCapabilities({ optionDescriptors: capabilities.optionDescriptors ?? [] })
        : null,
    });
  }
  return entries;
}

export function toCustomModelSetting(entry: CustomModelDefinition): CustomModelSetting {
  const descriptors = entry.capabilities?.optionDescriptors ?? [];
  const name = entry.name !== entry.slug ? entry.name : undefined;
  if (!name && descriptors.length === 0) return entry.slug;
  return {
    slug: entry.slug,
    ...(name ? { name } : {}),
    ...(descriptors.length > 0
      ? { capabilities: createModelCapabilities({ optionDescriptors: descriptors }) }
      : {}),
  };
}

export function resolveSelectableModel(
  provider: ProviderDriverKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const byAlias = options.find((option) =>
    option.aliases?.some((alias) => alias.toLowerCase() === trimmed.toLowerCase()),
  );
  if (byAlias) {
    return byAlias.slug;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}

function cloneSelections(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Array<ProviderOptionSelection> {
  return selections.map(cloneSelection);
}

export function createModelSelection(
  instanceId: ProviderInstanceId,
  model: string,
  options?: ReadonlyArray<ProviderOptionSelection> | null,
): ModelSelection {
  const selections = options ? cloneSelections(options) : [];
  const base: ModelSelection = {
    instanceId,
    model,
  };
  return selections.length > 0 ? { ...base, options: selections } : base;
}

/** A model picker's pick: re-picking the current model keeps its options, another model starts without any. */
export function pickModelSelection(
  current: ModelSelection | null | undefined,
  instanceId: ProviderInstanceId,
  model: string,
): ModelSelection {
  return current?.instanceId === instanceId && current.model === model
    ? current
    : createModelSelection(instanceId, model);
}

export function resolvePromptInjectedEffort(
  caps: ModelCapabilities,
  rawEffort: string | null | undefined,
): string | null {
  const trimmed = trimOrNull(rawEffort);
  if (!trimmed) return null;
  const descriptors = getProviderOptionDescriptors({ caps });
  for (const descriptor of descriptors) {
    if (descriptor.type === "select" && descriptor.promptInjectedValues?.includes(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: string | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  // Prefixing slash commands prevents Claude invocation; command names allow any token without a second slash.
  if (effort !== "ultrathink" || /^\/[^\s/]+(?:\s|$)/u.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
}

/** Canonical reasoning-control option IDs across Codex, Claude, OpenCode, Cursor, ACP/Antigravity, and Pi. */
export const MODEL_REASONING_EFFORT_OPTION_IDS = [
  "reasoningEffort",
  "effort",
  "reasoning",
  "variant",
  "reasoning_effort",
  "thinking_level",
  "thought_level",
  "thinking",
] as const;

const MODEL_REASONING_EFFORT_OPTION_ID_SET: ReadonlySet<string> = new Set(
  MODEL_REASONING_EFFORT_OPTION_IDS,
);

export function isReasoningEffortDescriptor(descriptor: ProviderOptionDescriptor): boolean {
  return (
    (descriptor.type === "select" && descriptor.role === "reasoning") ||
    MODEL_REASONING_EFFORT_OPTION_ID_SET.has(descriptor.id)
  );
}

export function getReasoningEffortDescriptor(
  caps: ModelCapabilities | null | undefined,
  selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ProviderOptionDescriptor | null {
  if (!caps) return null;
  const descriptors = getProviderOptionDescriptors({ caps, selections });
  const explicitRole = descriptors.find(
    (descriptor) => descriptor.type === "select" && descriptor.role === "reasoning",
  );
  if (explicitRole) return explicitRole;
  for (const id of MODEL_REASONING_EFFORT_OPTION_IDS) {
    const select = descriptors.find(
      (descriptor) => descriptor.type === "select" && descriptor.id === id,
    );
    if (select) return select;
  }
  return (
    descriptors.find((descriptor) => descriptor.type === "boolean" && descriptor.id === "thinking") ??
    null
  );
}

export function getReasoningEffortLevels(
  caps: ModelCapabilities | null | undefined,
  options?: { readonly includePromptInjected?: boolean },
): ReadonlyArray<ProviderOptionChoice> {
  const descriptor = getReasoningEffortDescriptor(caps);
  if (descriptor?.type !== "select") return [];
  if (options?.includePromptInjected === true || !descriptor.promptInjectedValues?.length) {
    return descriptor.options;
  }
  return descriptor.options.filter(
    (choice) => !descriptor.promptInjectedValues?.includes(choice.id),
  );
}

export function getUltracodeDescriptor(
  caps: ModelCapabilities | null | undefined,
  selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): Extract<ProviderOptionDescriptor, { type: "boolean" }> | null {
  if (!caps) return null;
  const descriptors = getProviderOptionDescriptors({ caps, selections });
  return (
    descriptors.find(
      (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
        descriptor.type === "boolean" && descriptor.id === "ultracode",
    ) ?? null
  );
}

const DEFAULT_SERVICE_TIER_CHOICE_ID = "default";

export function isFastServiceTierChoice(
  choice: Pick<ProviderOptionChoice, "id" | "label">,
): boolean {
  const id = choice.id.trim().toLowerCase();
  const label = choice.label.trim().toLowerCase();
  return id === "fast" || id === "priority" || label === "fast";
}

export function isUltrafastServiceTierChoice(
  choice: Pick<ProviderOptionChoice, "id" | "label">,
): boolean {
  const id = choice.id.trim().toLowerCase();
  const label = choice.label.trim().toLowerCase();
  return id === "ultrafast" || label === "ultrafast" || label === "ultra fast";
}

export type FastModeControlDescriptor =
  | {
      readonly kind: "boolean";
      readonly optionId: "fastMode";
      readonly descriptor: Extract<ProviderOptionDescriptor, { type: "boolean" }>;
      readonly isSingleFastToggle: true;
    }
  | {
      readonly kind: "serviceTier";
      readonly optionId: "serviceTier";
      readonly descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>;
      readonly standardChoice: ProviderOptionChoice;
      readonly fastChoice: ProviderOptionChoice | null;
      readonly ultrafastChoice: ProviderOptionChoice | null;
      readonly speedChoices: ReadonlyArray<ProviderOptionChoice>;
      readonly isSingleFastToggle: boolean;
    };

/**
 * Resolves a model's speed / Fast Mode control across providers:
 * - Claude & Cursor expose a boolean `fastMode` descriptor.
 * - Codex & Pi extensions expose a `serviceTier` select descriptor (`default` + `fast`/`priority`/`ultrafast`/`flex`).
 */
export function getFastModeDescriptor(
  caps: ModelCapabilities | null | undefined,
  selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): FastModeControlDescriptor | null {
  if (!caps) return null;
  const descriptors = getProviderOptionDescriptors({ caps, selections });
  const booleanFast = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "boolean" }> =>
      descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  if (booleanFast) {
    return {
      kind: "boolean",
      optionId: "fastMode",
      descriptor: booleanFast,
      isSingleFastToggle: true,
    };
  }
  const serviceTier = descriptors.find(
    (descriptor): descriptor is Extract<ProviderOptionDescriptor, { type: "select" }> =>
      descriptor.type === "select" && descriptor.id === "serviceTier",
  );
  if (!serviceTier) return null;
  const standardChoice =
    serviceTier.options.find((choice) => choice.id === DEFAULT_SERVICE_TIER_CHOICE_ID) ?? {
      id: DEFAULT_SERVICE_TIER_CHOICE_ID,
      label: "Standard",
    };
  const speedChoices = serviceTier.options.filter(
    (choice) => choice.id !== DEFAULT_SERVICE_TIER_CHOICE_ID,
  );
  if (speedChoices.length === 0) return null;
  const fastChoice = speedChoices.find(isFastServiceTierChoice) ?? null;
  const ultrafastChoice = speedChoices.find(isUltrafastServiceTierChoice) ?? null;
  return {
    kind: "serviceTier",
    optionId: "serviceTier",
    descriptor: serviceTier,
    standardChoice,
    fastChoice,
    ultrafastChoice,
    speedChoices,
    isSingleFastToggle: speedChoices.length === 1 && fastChoice !== null,
  };
}

/** Whether the model exposes a Fast / Ultrafast mode option (`fastMode` toggle or Fast `serviceTier`). */
export function supportsFastMode(caps: ModelCapabilities | null | undefined): boolean {
  const control = getFastModeDescriptor(caps);
  if (!control) return false;
  return (
    control.kind === "boolean" ||
    control.fastChoice !== null ||
    control.ultrafastChoice !== null
  );
}

/** Returns the underlying provider option key (`"fastMode"` or `"serviceTier"`) when Fast Mode is supported. */
export function getFastModeOptionKey(
  caps: ModelCapabilities | null | undefined,
): "fastMode" | "serviceTier" | null {
  if (!supportsFastMode(caps)) return null;
  return getFastModeDescriptor(caps)?.optionId ?? null;
}

/**
 * Returns `"ultrafast"`, `"fast"`, or `false` for the current selection.
 * For boolean `fastMode`, requires an explicit or reported `true` (never treating an unselected
 * provider default `currentValue: true` as user-enabled).
 */
export function isFastModeActive(
  caps: ModelCapabilities | null | undefined,
  selection?: ModelSelection | null,
  reportedSelection?: ModelSelection | null,
): "fast" | "ultrafast" | false {
  const control = getFastModeDescriptor(caps, selection?.options);
  if (!control) return false;
  if (control.kind === "boolean") {
    return getProviderOptionStatedValue("fastMode", selection, reportedSelection) === true
      ? "fast"
      : false;
  }
  const current = getProviderOptionCurrentValue(control.descriptor, selection, reportedSelection);
  if (typeof current !== "string" || current === control.standardChoice.id) {
    return false;
  }
  if (control.ultrafastChoice && current === control.ultrafastChoice.id) {
    return "ultrafast";
  }
  if (control.fastChoice && current === control.fastChoice.id) {
    return "fast";
  }
  return false;
}

/**
 * Builds the canonical `ProviderOptionSelection` toggle entry for turning Fast Mode on or off
 * across both boolean `fastMode` (Claude/Cursor) and select `serviceTier` (Codex/Pi) models.
 */
export function buildFastModeSelectionUpdate(
  caps: ModelCapabilities | null | undefined,
  enabled: boolean,
): ProviderOptionSelection | null {
  const control = getFastModeDescriptor(caps);
  if (!control) return null;
  if (control.kind === "boolean") {
    return { id: "fastMode", value: enabled };
  }
  if (!enabled) {
    return { id: "serviceTier", value: control.standardChoice.id };
  }
  const target = control.fastChoice ?? control.ultrafastChoice;
  return target ? { id: "serviceTier", value: target.id } : null;
}

/**
 * Builds a mutually exclusive Codex speed-tier update (`default` | `fast` | `ultrafast`),
 * explicitly resetting to `serviceTier = "default"` when both toggles are off or unsupported.
 */
export function buildCodexSpeedTierSelectionUpdate(
  caps: ModelCapabilities | null | undefined,
  tier: "default" | "fast" | "ultrafast",
): ProviderOptionSelection {
  const control = getFastModeDescriptor(caps);
  if (!control || control.kind !== "serviceTier" || tier === "default") {
    return { id: "serviceTier", value: DEFAULT_SERVICE_TIER_CHOICE_ID };
  }
  if (tier === "ultrafast") {
    return {
      id: "serviceTier",
      value: control.ultrafastChoice ? control.ultrafastChoice.id : DEFAULT_SERVICE_TIER_CHOICE_ID,
    };
  }
  return {
    id: "serviceTier",
    value: control.fastChoice ? control.fastChoice.id : DEFAULT_SERVICE_TIER_CHOICE_ID,
  };
}
