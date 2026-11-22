import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomUUID
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { PluginCredentialsHandle } from "@prismux/protocol";

const SAFE_PLUGIN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const CREDENTIAL_MAGIC = Buffer.from("PRXC01", "ascii");
const CREDENTIAL_HKDF_INFO = "prismux-plugin-cred-v1";
const CREDENTIAL_KEY_BYTES = 32;
const CREDENTIAL_IV_BYTES = 12;
const CREDENTIAL_AUTH_TAG_BYTES = 16;
const CREDENTIAL_CIPHER_ALGORITHM = "chacha20-poly1305" as const;

export interface PluginCredentialStore {
  /** Resolves an isolated `0600` encrypted credential handle for a single plugin ID. */
  openForPlugin(pluginId: string): PluginCredentialsHandle;
}

export interface EncryptedPluginCredentialStoreOptions {
  dataDir: string;
  masterKey: string | Uint8Array;
}

export class PluginCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginCredentialError";
  }
}

export function validateCredentialPluginId(pluginId: string): string {
  if (typeof pluginId !== "string" || pluginId.length === 0) {
    throw new PluginCredentialError("Plugin ID must be a non-empty string.");
  }
  if (
    pluginId.includes("..") ||
    pluginId.includes("/") ||
    pluginId.includes("\\") ||
    pluginId.includes("\0") ||
    !SAFE_PLUGIN_ID_PATTERN.test(pluginId)
  ) {
    throw new PluginCredentialError(
      `Invalid or unsafe plugin ID for credential storage: "${pluginId}".`
    );
  }
  return pluginId;
}

function isPlainStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  for (const val of Object.values(value)) {
    if (typeof val !== "string") {
      return false;
    }
  }
  return true;
}

/**
 * Isolated per-plugin encrypted credential store:
 * `<dataDir>/credentials/<plugin-id>.enc` (`0600`), HKDF-SHA256 per-plugin key,
 * and ChaCha20-Poly1305 (12B IV + 16B authTag).
 */
export class EncryptedPluginCredentialStore implements PluginCredentialStore {
  private readonly credentialsDir: string;
  private readonly masterKey: Buffer;
  private readonly pluginQueues = new Map<string, Promise<unknown>>();

  constructor(options: EncryptedPluginCredentialStoreOptions) {
    if (typeof options.dataDir !== "string" || options.dataDir.trim().length === 0) {
      throw new PluginCredentialError("dataDir must be a non-empty string.");
    }
    const keyBuf =
      typeof options.masterKey === "string"
        ? Buffer.from(options.masterKey, "utf8")
        : Buffer.from(options.masterKey);
    if (keyBuf.byteLength === 0) {
      throw new PluginCredentialError("masterKey must not be empty.");
    }

    this.credentialsDir = resolve(options.dataDir, "credentials");
    this.masterKey = keyBuf;
  }

  getCredentialsDir(): string {
    return this.credentialsDir;
  }

  getCredentialFilePath(pluginId: string): string {
    const safeId = validateCredentialPluginId(pluginId);
    const resolved = resolve(this.credentialsDir, `${safeId}.enc`);
    if (
      dirname(resolved) !== this.credentialsDir ||
      basename(resolved) !== `${safeId}.enc`
    ) {
      throw new PluginCredentialError(
        `Credential file path escaped credentials directory for "${pluginId}".`
      );
    }
    return resolved;
  }

  openForPlugin(pluginId: string): PluginCredentialsHandle {
    const safeId = validateCredentialPluginId(pluginId);
    const filePath = this.getCredentialFilePath(safeId);

    const handle: PluginCredentialsHandle = {
      get: (key: string): Promise<string | null> => {
        if (typeof key !== "string" || key.length === 0) {
          return Promise.reject(
            new PluginCredentialError("Credential key must be a non-empty string.")
          );
        }
        return this.enqueue(safeId, () => {
          const map = this.readPluginMap(safeId, filePath);
          return Object.prototype.hasOwnProperty.call(map, key)
            ? (map[key] ?? null)
            : null;
        });
      },

      set: (key: string, value: string): Promise<void> => {
        if (typeof key !== "string" || key.length === 0) {
          return Promise.reject(
            new PluginCredentialError("Credential key must be a non-empty string.")
          );
        }
        if (typeof value !== "string") {
          return Promise.reject(
            new PluginCredentialError("Credential value must be a string.")
          );
        }
        return this.enqueue(safeId, () => {
          const map = this.readPluginMap(safeId, filePath);
          map[key] = value;
          this.writePluginMap(safeId, filePath, map);
        });
      },

      delete: (key: string): Promise<void> => {
        if (typeof key !== "string" || key.length === 0) {
          return Promise.reject(
            new PluginCredentialError("Credential key must be a non-empty string.")
          );
        }
        return this.enqueue(safeId, () => {
          if (!existsSync(filePath)) {
            return;
          }
          const map = this.readPluginMap(safeId, filePath);
          if (!Object.prototype.hasOwnProperty.call(map, key)) {
            return;
          }
          delete map[key];
          this.writePluginMap(safeId, filePath, map);
        });
      }
    };

    return Object.freeze(handle);
  }

  /**
   * Decrypts an explicit raw `.enc` buffer using the key and AAD bound solely to `pluginId`.
   */
  decryptRawForPlugin(
    pluginId: string,
    rawBytes: Uint8Array
  ): Record<string, string> {
    const safeId = validateCredentialPluginId(pluginId);
    const buf = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);

    const minBytes =
      CREDENTIAL_MAGIC.byteLength +
      CREDENTIAL_IV_BYTES +
      CREDENTIAL_AUTH_TAG_BYTES;
    if (buf.byteLength < minBytes) {
      throw new PluginCredentialError(
        `Corrupted credential blob for "${safeId}": payload too short.`
      );
    }

    const magic = buf.subarray(0, CREDENTIAL_MAGIC.byteLength);
    if (!magic.equals(CREDENTIAL_MAGIC)) {
      throw new PluginCredentialError(
        `Corrupted credential blob for "${safeId}": invalid magic header.`
      );
    }

    const ivStart = CREDENTIAL_MAGIC.byteLength;
    const tagStart = ivStart + CREDENTIAL_IV_BYTES;
    const ciphertextStart = tagStart + CREDENTIAL_AUTH_TAG_BYTES;

    const iv = buf.subarray(ivStart, tagStart);
    const authTag = buf.subarray(tagStart, ciphertextStart);
    const ciphertext = buf.subarray(ciphertextStart);

    const pluginKey = this.derivePluginKey(safeId);
    try {
      const decipher = createDecipheriv(
        CREDENTIAL_CIPHER_ALGORITHM,
        pluginKey,
        iv,
        { authTagLength: CREDENTIAL_AUTH_TAG_BYTES }
      );
      decipher.setAAD(Buffer.from(`${CREDENTIAL_HKDF_INFO}:${safeId}`, "utf8"), {
        plaintextLength: ciphertext.byteLength
      });
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]).toString("utf8");

      const parsed: unknown = JSON.parse(plaintext);
      if (!isPlainStringRecord(parsed)) {
        throw new PluginCredentialError(
          `Decrypted credential payload for "${safeId}" is not a string map.`
        );
      }
      return { ...parsed };
    } catch (error) {
      if (error instanceof PluginCredentialError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new PluginCredentialError(
        `Failed to decrypt credentials for plugin "${safeId}": ${message}`
      );
    } finally {
      pluginKey.fill(0);
    }
  }

  private derivePluginKey(pluginId: string): Buffer {
    const derived = hkdfSync(
      "sha256",
      this.masterKey,
      pluginId,
      CREDENTIAL_HKDF_INFO,
      CREDENTIAL_KEY_BYTES
    );
    return Buffer.from(derived);
  }

  private encryptMapForPlugin(
    pluginId: string,
    map: Record<string, string>
  ): Buffer {
    const pluginKey = this.derivePluginKey(pluginId);
    try {
      const iv = randomBytes(CREDENTIAL_IV_BYTES);
      const plaintext = Buffer.from(JSON.stringify(map), "utf8");
      const cipher = createCipheriv(
        CREDENTIAL_CIPHER_ALGORITHM,
        pluginKey,
        iv,
        { authTagLength: CREDENTIAL_AUTH_TAG_BYTES }
      );
      cipher.setAAD(Buffer.from(`${CREDENTIAL_HKDF_INFO}:${pluginId}`, "utf8"), {
        plaintextLength: plaintext.byteLength
      });

      const ciphertext = Buffer.concat([
        cipher.update(plaintext),
        cipher.final()
      ]);
      const authTag = cipher.getAuthTag();

      return Buffer.concat([CREDENTIAL_MAGIC, iv, authTag, ciphertext]);
    } finally {
      pluginKey.fill(0);
    }
  }

  private readPluginMap(
    pluginId: string,
    filePath: string
  ): Record<string, string> {
    if (!existsSync(filePath)) {
      return {};
    }
    const raw = readFileSync(filePath);
    return this.decryptRawForPlugin(pluginId, raw);
  }

  private writePluginMap(
    pluginId: string,
    filePath: string,
    map: Record<string, string>
  ): void {
    mkdirSync(this.credentialsDir, { recursive: true, mode: 0o700 });
    const encrypted = this.encryptMapForPlugin(pluginId, map);
    const tempPath = resolve(
      this.credentialsDir,
      `.${pluginId}.enc.tmp-${process.pid}-${randomUUID()}`
    );

    try {
      writeFileSync(tempPath, encrypted, { mode: 0o600 });
      chmodSync(tempPath, 0o600);
      renameSync(tempPath, filePath);
      chmodSync(filePath, 0o600);
    } catch (error) {
      rmSync(tempPath, { force: true });
      throw error;
    }
  }

  private enqueue<T>(pluginId: string, task: () => T): Promise<T> {
    const previous = this.pluginQueues.get(pluginId) ?? Promise.resolve();
    const run = previous.then(
      () => task(),
      () => task()
    );
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    this.pluginQueues.set(pluginId, settled);
    void settled.finally(() => {
      if (this.pluginQueues.get(pluginId) === settled) {
        this.pluginQueues.delete(pluginId);
      }
    });
    return run;
  }
}
