import { resolveLocale } from "@prismux/client-runtime/locales";
import { getTranslationsSnapshot } from "gt-react";

import {
  getClientSettings,
  subscribeClientSettings,
  updateClientSettings,
} from "../hooks/useSettings";
import { initializeI18n } from "./initializeI18n";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "./locales";
import { setActiveLocale } from "./messages";

type LocaleTranslations = Awaited<ReturnType<typeof getTranslationsSnapshot>>;

export interface I18nSnapshot {
  readonly locale: string;
  readonly translations: LocaleTranslations;
}

const loadedTranslations: LocaleTranslations = { [DEFAULT_LOCALE]: {} };
const pendingLoads = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let snapshot: I18nSnapshot = { locale: DEFAULT_LOCALE, translations: { ...loadedTranslations } };
let requestedLocale = DEFAULT_LOCALE;

function loadLocale(locale: string): Promise<void> {
  if (locale in loadedTranslations) return Promise.resolve();
  let load = pendingLoads.get(locale);
  if (!load) {
    // GT resolves a failed load to an empty catalog. Leave it uncached: English renders now
    // and the next request retries.
    load = getTranslationsSnapshot(locale).then((loaded) => {
      pendingLoads.delete(locale);
      const translations = loaded[locale];
      if (translations && Object.keys(translations).length > 0) {
        loadedTranslations[locale] = translations;
      }
    });
    pendingLoads.set(locale, load);
  }
  return load;
}

function activateLocale(locale: string): void {
  if (requestedLocale !== locale) return;
  if (snapshot.locale === locale && snapshot.translations[locale] === loadedTranslations[locale]) {
    return;
  }
  snapshot = { locale, translations: { ...loadedTranslations } };
  setActiveLocale(locale);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

const TIMEZONE_TO_LOCALE: Readonly<Record<string, string>> = {
  // Simplified Chinese (zh)
  "asia/shanghai": "zh",
  "asia/chongqing": "zh",
  "asia/chungking": "zh",
  "asia/harbin": "zh",
  "asia/kashgar": "zh",
  "asia/urumqi": "zh",
  "asia/beijing": "zh",
  "asia/hong_kong": "zh",
  "asia/macau": "zh",
  "asia/macao": "zh",
  "asia/taipei": "zh",
  prc: "zh",
  roc: "zh",
  hongkong: "zh",
  // Japanese (ja)
  "asia/tokyo": "ja",
  japan: "ja",
  // Korean (ko)
  "asia/seoul": "ko",
  rok: "ko",
  // German (de)
  "europe/berlin": "de",
  "europe/busingen": "de",
  "europe/vienna": "de",
  "europe/zurich": "de",
  // French (fr)
  "europe/paris": "fr",
  "europe/monaco": "fr",
  // Spanish (es)
  "europe/madrid": "es",
  "atlantic/canary": "es",
  "america/mexico_city": "es",
  "america/argentina/buenos_aires": "es",
  "america/bogota": "es",
  "america/lima": "es",
  "america/santiago": "es",
  "america/caracas": "es",
  "america/guayaquil": "es",
  "america/la_paz": "es",
  "america/montevideo": "es",
  "america/asuncion": "es",
  "america/panama": "es",
  "america/costa_rica": "es",
  "america/guatemala": "es",
  "america/havana": "es",
  "america/santo_domingo": "es",
  "america/managua": "es",
  "america/tegucigalpa": "es",
  "america/el_salvador": "es",
  "america/tijuana": "es",
  "america/monterrey": "es",
  "america/cancun": "es",
  // Brazilian Portuguese (pt-BR)
  "america/sao_paulo": "pt-BR",
  "america/fortaleza": "pt-BR",
  "america/recife": "pt-BR",
  "america/bahia": "pt-BR",
  "america/belem": "pt-BR",
  "america/manaus": "pt-BR",
  "america/cuiaba": "pt-BR",
  "america/campo_grande": "pt-BR",
  "america/porto_velho": "pt-BR",
  "america/rio_branco": "pt-BR",
  "america/boa_vista": "pt-BR",
  "america/maceio": "pt-BR",
  "america/araguaina": "pt-BR",
  "america/santarem": "pt-BR",
  "america/noronha": "pt-BR",
  "brazil/east": "pt-BR",
  "brazil/west": "pt-BR",
  // Russian (ru)
  "europe/moscow": "ru",
  "europe/kaliningrad": "ru",
  "europe/samara": "ru",
  "europe/volgograd": "ru",
  "europe/saratov": "ru",
  "europe/astrakhan": "ru",
  "europe/ulyanovsk": "ru",
  "europe/kirov": "ru",
  "asia/yekaterinburg": "ru",
  "asia/omsk": "ru",
  "asia/novosibirsk": "ru",
  "asia/barnaul": "ru",
  "asia/tomsk": "ru",
  "asia/novokuznetsk": "ru",
  "asia/krasnoyarsk": "ru",
  "asia/irkutsk": "ru",
  "asia/chita": "ru",
  "asia/yakutsk": "ru",
  "asia/khandyga": "ru",
  "asia/vladivostok": "ru",
  "asia/ust-nera": "ru",
  "asia/magadan": "ru",
  "asia/sakhalin": "ru",
  "asia/srednekolymsk": "ru",
  "asia/kamchatka": "ru",
  "asia/anadyr": "ru",
  "w-su": "ru",
  // Swedish (sv)
  "europe/stockholm": "sv",
};

/** Maps a host IANA timezone to a supported UI locale when available; null otherwise. */
export function resolveLocaleFromTimezone(
  timeZone: string | null | undefined,
  supportedLocales: ReadonlyArray<string> = SUPPORTED_LOCALES,
): string | null {
  if (typeof timeZone !== "string") return null;
  const candidate = TIMEZONE_TO_LOCALE[timeZone.trim().toLowerCase()];
  if (!candidate) return null;
  return supportedLocales.find((loc) => loc.toLowerCase() === candidate.toLowerCase()) ?? null;
}

/**
 * Resolves effective system locales when the user's saved language is still `"system"` (auto):
 * - Once the user explicitly picks ANY language in Settings (`language !== "system"`),
 *   `resolveLocale()` returns that saved choice directly and NEVER auto-switches again.
 * - While on `"system"`, if `navigator.languages` defaults to `en` or empty (common on Windows
 *   Electron), auto-detects the host IANA timezone (across all supported locales: zh, ja, ko, de,
 *   fr, es, pt-BR, ru, sv) and desktop regional locale so `/welcome` opens in the user's language.
 */
export function resolveEffectiveSystemLocales(input: {
  readonly navigatorLanguages: ReadonlyArray<string>;
  readonly timeZone?: string | null | undefined;
  readonly desktopSystemLocale?: string | null | undefined;
  readonly supportedLocales?: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const supported = input.supportedLocales ?? SUPPORTED_LOCALES;
  const primary = input.navigatorLanguages.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0,
  );
  const firstBase = primary[0]?.trim().toLowerCase().split(/[-_]/)[0];
  const tzLocale = resolveLocaleFromTimezone(input.timeZone, supported);
  const desktopLocale =
    typeof input.desktopSystemLocale === "string" && input.desktopSystemLocale.trim().length > 0
      ? input.desktopSystemLocale.trim()
      : null;
  const desktopBase = desktopLocale?.toLowerCase().split(/[-_]/)[0];

  if (!firstBase || firstBase === "en") {
    const inferred: string[] = [];
    if (tzLocale && tzLocale !== "en") inferred.push(tzLocale);
    if (desktopLocale && desktopBase && desktopBase !== "en") inferred.push(desktopLocale);
    if (inferred.length > 0) {
      return [...inferred, ...primary];
    }
  }

  if (
    primary.some((tag) => /^zh[-_](hant|tw|hk|mo)\b/i.test(tag.trim())) &&
    !primary.some((tag) => /^zh($|[-_](hans|cn|sg)\b)/i.test(tag.trim()))
  ) {
    return [...primary, "zh"];
  }

  return primary;
}

function readHostTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function readDesktopSystemLocale(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const bridge = (window as { desktopBridge?: { getSystemLocale?: () => string | null | undefined } })
      .desktopBridge;
    const locale = bridge?.getSystemLocale?.();
    return typeof locale === "string" && locale.trim().length > 0 ? locale : null;
  } catch {
    return null;
  }
}

function applyLanguageSetting(): void {
  const effectiveSystemLocales = resolveEffectiveSystemLocales({
    navigatorLanguages: typeof navigator !== "undefined" ? (navigator.languages ?? []) : [],
    timeZone: readHostTimezone(),
    desktopSystemLocale: readDesktopSystemLocale(),
  });
  requestedLocale = resolveLocale(
    getClientSettings().language,
    effectiveSystemLocales,
    SUPPORTED_LOCALES,
    DEFAULT_LOCALE,
  );
  void whenLocaleReady();
}

/** GT's own locale setters write the saved setting, which stays the only source of truth. */
export function persistGTLocale(locale: string): void {
  void updateClientSettings({ language: locale });
}

export function startI18n(): void {
  initializeI18n(persistGTLocale);
  subscribeClientSettings(applyLanguageSetting);
  applyLanguageSetting();
}

/** Resolves once the requested locale's translations are ready; immediate for English. */
export function whenLocaleReady(): Promise<void> {
  const locale = requestedLocale;
  return loadLocale(locale).then(() => activateLocale(locale));
}

export function subscribeI18n(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getI18nSnapshot(): I18nSnapshot {
  return snapshot;
}
