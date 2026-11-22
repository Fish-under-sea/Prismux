import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DaemonPairingInfo } from "@prismux/protocol";

export const DEFAULT_PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

interface PairingCodeRecord {
  codeHash: Buffer;
  expiresAt: number;
  used: boolean;
}

interface DeviceTokenRecord {
  tokenHash: Buffer;
  deviceLabel: string;
  issuedAt: number;
}

export interface ExchangePairingResult {
  token: string;
  deviceLabel: string;
  issuedAt: number;
}

export interface PairingManagerOptions {
  initialAuthToken?: string;
  defaultPairingTtlMs?: number;
}

function sha256Digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeHashEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Manages one-time pairing code exchange and SHA-256 + timingSafeEqual bearer token verification.
 */
export class PairingManager {
  private readonly defaultPairingTtlMs: number;
  private readonly pairingCodes: PairingCodeRecord[] = [];
  private readonly tokens: DeviceTokenRecord[] = [];

  constructor(options: PairingManagerOptions = {}) {
    this.defaultPairingTtlMs = Math.max(
      1_000,
      options.defaultPairingTtlMs ?? DEFAULT_PAIRING_CODE_TTL_MS
    );

    if (
      options.initialAuthToken !== undefined &&
      options.initialAuthToken.trim().length > 0
    ) {
      this.registerStaticToken(options.initialAuthToken.trim(), "cli-static");
    }
  }

  registerStaticToken(token: string, deviceLabel = "static"): void {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      throw new Error("Auth token must not be empty.");
    }
    const tokenHash = sha256Digest(trimmed);
    const alreadyExists = this.tokens.some((entry) =>
      constantTimeHashEquals(entry.tokenHash, tokenHash)
    );
    if (!alreadyExists) {
      this.tokens.push({
        tokenHash,
        deviceLabel,
        issuedAt: Date.now()
      });
    }
  }

  createPairingCode(
    ttlMs: number = this.defaultPairingTtlMs,
    daemonUrl = ""
  ): DaemonPairingInfo {
    this.pruneExpiredPairingCodes();

    const rawHex = randomBytes(12).toString("hex").toUpperCase();
    const pairingCode = `${rawHex.slice(0, 6)}-${rawHex.slice(6, 12)}-${rawHex.slice(12, 18)}-${rawHex.slice(18, 24)}`;
    const expiresAt = Date.now() + Math.max(1_000, ttlMs);

    this.pairingCodes.push({
      codeHash: sha256Digest(pairingCode),
      expiresAt,
      used: false
    });

    return {
      pairingCode,
      expiresAt,
      daemonUrl
    };
  }

  exchangePairingCode(
    code: string,
    deviceLabel = "paired-device"
  ): ExchangePairingResult | null {
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const candidateHash = sha256Digest(trimmed);
    const now = Date.now();
    let matched: PairingCodeRecord | undefined;

    for (const record of this.pairingCodes) {
      const hashMatched = constantTimeHashEquals(candidateHash, record.codeHash);
      if (hashMatched && !record.used && now <= record.expiresAt) {
        matched = record;
      }
    }

    if (matched === undefined) {
      return null;
    }

    matched.used = true;
    const token = `pmx_${randomBytes(32).toString("base64url")}`;
    const issuedAt = Date.now();
    const normalizedLabel =
      deviceLabel.trim().length > 0 ? deviceLabel.trim() : "paired-device";

    this.tokens.push({
      tokenHash: sha256Digest(token),
      deviceLabel: normalizedLabel,
      issuedAt
    });

    return {
      token,
      deviceLabel: normalizedLabel,
      issuedAt
    };
  }

  verifyToken(token: string): boolean {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return false;
    }

    const candidateHash = sha256Digest(trimmed);
    let verified = false;

    for (const record of this.tokens) {
      if (constantTimeHashEquals(candidateHash, record.tokenHash)) {
        verified = true;
      }
    }

    return verified;
  }

  revokeToken(token: string): boolean {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return false;
    }

    const candidateHash = sha256Digest(trimmed);
    let removedIndex = -1;

    for (let i = 0; i < this.tokens.length; i += 1) {
      const record = this.tokens[i];
      if (
        record !== undefined &&
        constantTimeHashEquals(candidateHash, record.tokenHash)
      ) {
        removedIndex = i;
      }
    }

    if (removedIndex === -1) {
      return false;
    }

    this.tokens.splice(removedIndex, 1);
    return true;
  }

  getActiveTokenCount(): number {
    return this.tokens.length;
  }

  private pruneExpiredPairingCodes(): void {
    const now = Date.now();
    for (let i = this.pairingCodes.length - 1; i >= 0; i -= 1) {
      const record = this.pairingCodes[i];
      if (record !== undefined && (record.used || now > record.expiresAt)) {
        this.pairingCodes.splice(i, 1);
      }
    }
  }
}
