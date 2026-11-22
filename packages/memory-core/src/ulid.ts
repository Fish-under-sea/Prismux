import { getRandomValues } from "node:crypto";

export const ULID_LENGTH = 26 as const;
export const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_ULID_TIME = 0xffff_ffff_ffff;
const TIME_CHAR_COUNT = 10;
const RANDOM_CHAR_COUNT = 16;

const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

function fillRandomDigits(target: Uint8Array): void {
  const bytes = new Uint8Array(10);
  getRandomValues(bytes);
  // Pack two 40-bit blocks (5 bytes each) into sixteen 5-bit Base32 digits.
  for (let block = 0; block < 2; block += 1) {
    const bOffset = block * 5;
    const dOffset = block * 8;
    const b0 = bytes[bOffset]!;
    const b1 = bytes[bOffset + 1]!;
    const b2 = bytes[bOffset + 2]!;
    const b3 = bytes[bOffset + 3]!;
    const b4 = bytes[bOffset + 4]!;

    target[dOffset] = (b0 >> 3) & 31;
    target[dOffset + 1] = ((b0 & 7) << 2) | ((b1 >> 6) & 3);
    target[dOffset + 2] = (b1 >> 1) & 31;
    target[dOffset + 3] = ((b1 & 1) << 4) | ((b2 >> 4) & 15);
    target[dOffset + 4] = ((b2 & 15) << 1) | ((b3 >> 7) & 1);
    target[dOffset + 5] = (b3 >> 2) & 31;
    target[dOffset + 6] = ((b3 & 3) << 3) | ((b4 >> 5) & 7);
    target[dOffset + 7] = b4 & 31;
  }
}

function incrementRandomDigits(digits: Uint8Array): boolean {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const next = digits[i]! + 1;
    if (next < 32) {
      digits[i] = next;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

function encodeTimestamp(timestampMs: number): string {
  const chars = new Array<string>(TIME_CHAR_COUNT);
  let remaining = timestampMs;
  for (let i = TIME_CHAR_COUNT - 1; i >= 0; i -= 1) {
    chars[i] = CROCKFORD_BASE32_ALPHABET[remaining % 32]!;
    remaining = Math.floor(remaining / 32);
  }
  return chars.join("");
}

function encodeRandomDigits(digits: Uint8Array): string {
  const chars = new Array<string>(RANDOM_CHAR_COUNT);
  for (let i = 0; i < RANDOM_CHAR_COUNT; i += 1) {
    chars[i] = CROCKFORD_BASE32_ALPHABET[digits[i]!]!;
  }
  return chars.join("");
}

function validateTimestamp(timestampMs: number): number {
  if (!Number.isFinite(timestampMs)) {
    throw new RangeError(`Invalid ULID timestamp: ${String(timestampMs)}`);
  }
  const normalized = Math.trunc(timestampMs);
  if (normalized < 0 || normalized > MAX_ULID_TIME) {
    throw new RangeError(
      `ULID timestamp out of 48-bit range [0, ${MAX_ULID_TIME}]: ${normalized}`
    );
  }
  return normalized;
}

export type UlidGenerator = (timestampMs?: number) => string;

/**
 * Creates an isolated monotonic ULID generator (26-char Crockford Base32).
 */
export function createMonotonicUlidGenerator(): UlidGenerator {
  let autoLastTimestamp = -1;
  const autoLastDigits = new Uint8Array(RANDOM_CHAR_COUNT);

  let explicitLastTimestamp = -1;
  const explicitLastDigits = new Uint8Array(RANDOM_CHAR_COUNT);

  return (timestampMs?: number): string => {
    if (timestampMs === undefined) {
      let ts = validateTimestamp(Date.now());
      if (ts <= autoLastTimestamp) {
        ts = autoLastTimestamp;
        if (!incrementRandomDigits(autoLastDigits)) {
          ts = validateTimestamp(autoLastTimestamp + 1);
          autoLastTimestamp = ts;
          fillRandomDigits(autoLastDigits);
        }
      } else {
        autoLastTimestamp = ts;
        fillRandomDigits(autoLastDigits);
      }
      return encodeTimestamp(ts) + encodeRandomDigits(autoLastDigits);
    }

    let ts = validateTimestamp(timestampMs);
    if (ts === explicitLastTimestamp) {
      if (!incrementRandomDigits(explicitLastDigits)) {
        ts = validateTimestamp(ts + 1);
        explicitLastTimestamp = ts;
        fillRandomDigits(explicitLastDigits);
      }
    } else {
      explicitLastTimestamp = ts;
      fillRandomDigits(explicitLastDigits);
    }
    return encodeTimestamp(ts) + encodeRandomDigits(explicitLastDigits);
  };
}

const defaultGenerator = createMonotonicUlidGenerator();

/**
 * Generates a 26-character Crockford Base32 ULID, monotonic within the same millisecond.
 */
export function generateUlid(timestampMs?: number): string {
  return defaultGenerator(timestampMs);
}

/**
 * Validates canonical 26-character Crockford Base32 ULID syntax.
 */
export function isValidUlid(value: string): boolean {
  return ULID_REGEX.test(value);
}

/**
 * Decodes the 48-bit millisecond timestamp prefix from a canonical ULID.
 */
export function decodeUlidTimestamp(ulid: string): number {
  if (!isValidUlid(ulid)) {
    throw new Error(`Invalid ULID: ${ulid}`);
  }
  let value = 0;
  for (let i = 0; i < TIME_CHAR_COUNT; i += 1) {
    const idx = CROCKFORD_BASE32_ALPHABET.indexOf(ulid[i]!);
    value = value * 32 + idx;
  }
  return value;
}
