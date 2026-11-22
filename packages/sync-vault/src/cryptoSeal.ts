import {
  argon2Sync,
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { assertDistinctBackupPassphrase } from "./types.js";

export const BACKUP_HEADER_MAGIC = "PRMXBK01" as const;
export const BACKUP_CIPHER_NAME = "chacha20-poly1305" as const;
export const BACKUP_KDF_NAME = "argon2id" as const;
export const BACKUP_IV_LENGTH = 12;
export const BACKUP_SALT_LENGTH = 16;
export const BACKUP_AUTH_TAG_LENGTH = 16;
export const BACKUP_KEY_LENGTH = 32;

const MAX_METADATA_BYTES = 1024 * 1024;
const SENSITIVE_SNAPSHOT_KEYS = new Set([
  "apiKeys",
  "authSessions",
  "pluginCredentials"
]);

export interface Argon2KdfParams {
  memory: number;
  passes: number;
  parallelism: number;
  tagLength: number;
}

export const DEFAULT_ARGON2_PARAMS: Argon2KdfParams = {
  memory: 65_536,
  passes: 3,
  parallelism: 4,
  tagLength: BACKUP_KEY_LENGTH
};

export interface SealedBackupMetadata {
  format: typeof BACKUP_HEADER_MAGIC;
  cipher: typeof BACKUP_CIPHER_NAME;
  kdf: typeof BACKUP_KDF_NAME;
  kdfParams: Argon2KdfParams;
  saltB64: string;
  ivB64: string;
  authTagLength: typeof BACKUP_AUTH_TAG_LENGTH;
  createdAt: number;
  compressed: "gzip" | "none";
  containsSecrets: boolean;
}

export interface SealBackupOptions {
  kdfParams?: Partial<Argon2KdfParams>;
  compression?: "gzip" | "none";
  containsSecrets?: boolean;
  createdAt?: number;
}

export interface UnsealedBackupResult<T = unknown> {
  metadata: SealedBackupMetadata;
  payload: T;
}

export interface OfflineBackupSnapshot {
  schemaVersion?: number;
  machineId?: string;
  exportedAt?: number;
  privateMemory?: unknown[];
  workspaceMemory?: unknown[];
  socialMemory?: unknown[];
  commandsAndMcp?: Record<string, unknown>;
  plugins?: unknown[];
  appearancePresets?: unknown[];
  usageLedger?: unknown[];
  apiKeys?: Record<string, unknown>;
  authSessions?: unknown[] | Record<string, unknown>;
  pluginCredentials?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ExportOfflineBackupOptions {
  passphrase: string;
  remoteSecrets?: readonly string[];
  includeSecrets?: boolean;
  passphraseConfirmed?: boolean;
  kdfParams?: Partial<Argon2KdfParams>;
  compression?: "gzip" | "none";
}

export interface OfflineBackupExportResult {
  sealedBytes: Buffer;
  containsSecrets: boolean;
  strippedFields: string[];
  metadata: SealedBackupMetadata;
}

export class BackupDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupDecryptionError";
  }
}

function resolveAndValidateKdfParams(
  partial?: Partial<Argon2KdfParams>
): Argon2KdfParams {
  const params: Argon2KdfParams = {
    memory: partial?.memory ?? DEFAULT_ARGON2_PARAMS.memory,
    passes: partial?.passes ?? DEFAULT_ARGON2_PARAMS.passes,
    parallelism: partial?.parallelism ?? DEFAULT_ARGON2_PARAMS.parallelism,
    tagLength: partial?.tagLength ?? DEFAULT_ARGON2_PARAMS.tagLength
  };

  if (params.tagLength !== BACKUP_KEY_LENGTH) {
    throw new Error(
      `Invalid Argon2id tagLength: expected ${BACKUP_KEY_LENGTH}, got ${params.tagLength}.`
    );
  }
  if (
    !Number.isInteger(params.parallelism) ||
    params.parallelism < 1 ||
    params.parallelism > 16
  ) {
    throw new Error(
      `Invalid Argon2id parallelism: ${params.parallelism} (must be integer 1..16).`
    );
  }
  if (
    !Number.isInteger(params.passes) ||
    params.passes < 1 ||
    params.passes > 32
  ) {
    throw new Error(
      `Invalid Argon2id passes: ${params.passes} (must be integer 1..32).`
    );
  }
  const minMemory = Math.max(64, 8 * params.parallelism);
  if (
    !Number.isInteger(params.memory) ||
    params.memory < minMemory ||
    params.memory > 1_048_576
  ) {
    throw new Error(
      `Invalid Argon2id memory: ${params.memory} KiB (must be integer ${minMemory}..1048576).`
    );
  }

  return params;
}

function deriveKeyArgon2id(
  passphrase: string,
  salt: Buffer,
  params: Argon2KdfParams
): Buffer {
  return Buffer.from(
    argon2Sync("argon2id", {
      message: Buffer.from(passphrase, "utf8"),
      nonce: salt,
      parallelism: params.parallelism,
      tagLength: params.tagLength,
      memory: params.memory,
      passes: params.passes
    })
  );
}

/**
 * Seals any JSON-serializable payload into a self-describing `.prismux-backup`
 * binary block using Argon2id + ChaCha20-Poly1305 (with header+metadata bound as AAD).
 */
export function sealBackupPayload<T>(
  payload: T,
  passphrase: string,
  remoteSecrets: readonly string[] = [],
  options?: SealBackupOptions
): Buffer {
  assertDistinctBackupPassphrase(passphrase, remoteSecrets);

  const kdfParams = resolveAndValidateKdfParams(options?.kdfParams);
  const salt = randomBytes(BACKUP_SALT_LENGTH);
  const iv = randomBytes(BACKUP_IV_LENGTH);

  const jsonSerialized = JSON.stringify(payload);
  if (jsonSerialized === undefined) {
    throw new Error("Backup payload must be JSON-serializable.");
  }
  const rawBytes = Buffer.from(jsonSerialized, "utf8");

  let compression: "gzip" | "none" = options?.compression ?? "gzip";
  let plaintext = rawBytes;
  if (compression === "gzip") {
    const gzipped = gzipSync(rawBytes);
    // Verify round-trip gzip integrity before encrypting (guards against Node zlib edge cases).
    if (gunzipSync(gzipped).equals(rawBytes)) {
      plaintext = gzipped;
    } else {
      compression = "none";
      plaintext = rawBytes;
    }
  }

  const metadata: SealedBackupMetadata = {
    format: BACKUP_HEADER_MAGIC,
    cipher: BACKUP_CIPHER_NAME,
    kdf: BACKUP_KDF_NAME,
    kdfParams,
    saltB64: salt.toString("base64"),
    ivB64: iv.toString("base64"),
    authTagLength: BACKUP_AUTH_TAG_LENGTH,
    createdAt: options?.createdAt ?? Date.now(),
    compressed: compression,
    containsSecrets: options?.containsSecrets ?? false
  };

  const metaBytes = Buffer.from(JSON.stringify(metadata), "utf8");
  const prefix = Buffer.allocUnsafe(12);
  prefix.write(BACKUP_HEADER_MAGIC, 0, 8, "ascii");
  prefix.writeUInt32BE(metaBytes.length, 8);
  const headerBytes = Buffer.concat([prefix, metaBytes]);

  const key = deriveKeyArgon2id(passphrase, salt, kdfParams);
  try {
    const cipher = createCipheriv(BACKUP_CIPHER_NAME, key, iv, {
      authTagLength: BACKUP_AUTH_TAG_LENGTH
    });
    cipher.setAAD(headerBytes, { plaintextLength: plaintext.length });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([headerBytes, ciphertext, authTag]);
  } finally {
    key.fill(0);
  }
}

export interface InspectedBackupHeader {
  metadata: SealedBackupMetadata;
  headerBytes: Buffer;
  ciphertext: Buffer;
  authTag: Buffer;
  salt: Buffer;
  iv: Buffer;
}

/**
 * Parses and structurally validates the self-describing `.prismux-backup` header
 * without decrypting the payload.
 */
export function inspectSealedBackupHeader(
  sealedBytes: Uint8Array
): InspectedBackupHeader {
  const buf = Buffer.isBuffer(sealedBytes)
    ? sealedBytes
    : Buffer.from(
        sealedBytes.buffer,
        sealedBytes.byteOffset,
        sealedBytes.byteLength
      );

  if (buf.length < 12 + 2 + BACKUP_AUTH_TAG_LENGTH) {
    throw new BackupDecryptionError(
      "Backup block is truncated or malformed (too short)."
    );
  }

  const magic = buf.subarray(0, 8).toString("ascii");
  if (magic !== BACKUP_HEADER_MAGIC) {
    throw new BackupDecryptionError(
      `Invalid backup header magic: expected ${BACKUP_HEADER_MAGIC}.`
    );
  }

  const metaLen = buf.readUInt32BE(8);
  if (
    metaLen < 2 ||
    metaLen > MAX_METADATA_BYTES ||
    12 + metaLen + BACKUP_AUTH_TAG_LENGTH > buf.length
  ) {
    throw new BackupDecryptionError(
      "Backup metadata length is out of valid bounds."
    );
  }

  const headerEnd = 12 + metaLen;
  const headerBytes = buf.subarray(0, headerEnd);
  const metaJson = buf.subarray(12, headerEnd).toString("utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(metaJson);
  } catch {
    throw new BackupDecryptionError("Corrupted backup metadata JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BackupDecryptionError("Invalid backup metadata object.");
  }

  const meta = parsed as Partial<SealedBackupMetadata>;
  if (
    meta.format !== BACKUP_HEADER_MAGIC ||
    meta.cipher !== BACKUP_CIPHER_NAME ||
    meta.kdf !== BACKUP_KDF_NAME ||
    meta.authTagLength !== BACKUP_AUTH_TAG_LENGTH ||
    (meta.compressed !== "gzip" && meta.compressed !== "none") ||
    typeof meta.saltB64 !== "string" ||
    typeof meta.ivB64 !== "string" ||
    typeof meta.containsSecrets !== "boolean" ||
    typeof meta.createdAt !== "number" ||
    typeof meta.kdfParams !== "object" ||
    meta.kdfParams === null
  ) {
    throw new BackupDecryptionError(
      "Unsupported or tampered backup metadata fields."
    );
  }

  let kdfParams: Argon2KdfParams;
  try {
    kdfParams = resolveAndValidateKdfParams(meta.kdfParams);
  } catch (err) {
    throw new BackupDecryptionError(
      err instanceof Error ? err.message : "Invalid KDF parameters."
    );
  }

  const salt = Buffer.from(meta.saltB64, "base64");
  const iv = Buffer.from(meta.ivB64, "base64");
  if (salt.length < 8 || salt.length > 64) {
    throw new BackupDecryptionError("Invalid backup salt length.");
  }
  if (iv.length !== BACKUP_IV_LENGTH) {
    throw new BackupDecryptionError("Invalid backup IV length.");
  }

  const tagStart = buf.length - BACKUP_AUTH_TAG_LENGTH;
  const ciphertext = buf.subarray(headerEnd, tagStart);
  const authTag = buf.subarray(tagStart);

  return {
    metadata: {
      format: meta.format,
      cipher: meta.cipher,
      kdf: meta.kdf,
      kdfParams,
      saltB64: meta.saltB64,
      ivB64: meta.ivB64,
      authTagLength: meta.authTagLength,
      createdAt: meta.createdAt,
      compressed: meta.compressed,
      containsSecrets: meta.containsSecrets
    },
    headerBytes,
    ciphertext,
    authTag,
    salt,
    iv
  };
}

/**
 * Verifies authentication tag + header AAD and decrypts a `.prismux-backup` block.
 * Rejects wrong passphrases or any 1-byte modification in header, metadata, ciphertext, or tag.
 */
export function unsealBackupPayload<T = unknown>(
  sealedBytes: Uint8Array,
  passphrase: string
): UnsealedBackupResult<T> {
  if (passphrase.length === 0) {
    throw new BackupDecryptionError("Backup passphrase must not be empty.");
  }

  const inspected = inspectSealedBackupHeader(sealedBytes);
  const key = deriveKeyArgon2id(
    passphrase,
    inspected.salt,
    inspected.metadata.kdfParams
  );

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv(BACKUP_CIPHER_NAME, key, inspected.iv, {
      authTagLength: BACKUP_AUTH_TAG_LENGTH
    });
    decipher.setAAD(inspected.headerBytes, {
      plaintextLength: inspected.ciphertext.length
    });
    decipher.setAuthTag(inspected.authTag);
    plaintext = Buffer.concat([
      decipher.update(inspected.ciphertext),
      decipher.final()
    ]);
  } catch (err) {
    throw new BackupDecryptionError(
      `Backup authentication or decryption failed (wrong passphrase or corrupted/tampered payload): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    key.fill(0);
  }

  const jsonBytes =
    inspected.metadata.compressed === "gzip"
      ? gunzipSync(plaintext)
      : plaintext;

  try {
    const payload = JSON.parse(jsonBytes.toString("utf8")) as T;
    return {
      metadata: inspected.metadata,
      payload
    };
  } catch {
    throw new BackupDecryptionError(
      "Decrypted backup payload is not valid JSON."
    );
  }
}

function stripSensitiveFieldsRecursive(
  value: unknown,
  pathPrefix: string,
  strippedFields: string[]
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      stripSensitiveFieldsRecursive(item, `${pathPrefix}[${idx}]`, strippedFields)
    );
  }
  if (typeof value === "object" && value !== null) {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entryVal] of Object.entries(input)) {
      const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      if (SENSITIVE_SNAPSHOT_KEYS.has(key)) {
        if (entryVal !== undefined) {
          strippedFields.push(nextPath);
        }
        continue;
      }
      if (entryVal !== undefined) {
        out[key] = stripSensitiveFieldsRecursive(
          entryVal,
          nextPath,
          strippedFields
        );
      }
    }
    return out;
  }
  return value;
}

/**
 * Exports an offline `.prismux-backup` archive.
 * By default, forcibly strips all `apiKeys`, `authSessions`, and `pluginCredentials`.
 * Secrets are sealed ONLY when BOTH `includeSecrets === true` AND `passphraseConfirmed === true`.
 */
export function exportOfflineBackup(
  snapshot: OfflineBackupSnapshot,
  options: ExportOfflineBackupOptions
): OfflineBackupExportResult {
  const allowSecrets =
    options.includeSecrets === true && options.passphraseConfirmed === true;

  const strippedFields: string[] = [];
  const preparedSnapshot = allowSecrets
    ? (structuredClone(snapshot) as OfflineBackupSnapshot)
    : (stripSensitiveFieldsRecursive(
        snapshot,
        "",
        strippedFields
      ) as OfflineBackupSnapshot);

  const sealedBytes = sealBackupPayload(
    preparedSnapshot,
    options.passphrase,
    options.remoteSecrets ?? [],
    {
      kdfParams: options.kdfParams,
      compression: options.compression,
      containsSecrets: allowSecrets
    }
  );

  const { metadata } = inspectSealedBackupHeader(sealedBytes);

  return {
    sealedBytes,
    containsSecrets: allowSecrets,
    strippedFields,
    metadata
  };
}
