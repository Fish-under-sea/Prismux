import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { validateTrustedCallerScope } from "@prismux/memory-core";
import type { CallerScope, DaemonPairingInfo } from "@prismux/protocol";

export const DEFAULT_PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_MAX_CONSECUTIVE_PAIRING_FAILURES = 5;

interface PairingCodeRecord {
  codeHash: Buffer;
  expiresAt: number;
  used: boolean;
  callerScope: CallerScope;
}

interface DeviceTokenRecord {
  tokenHash: Buffer;
  deviceLabel: string;
  callerScope: CallerScope;
  issuedAt: number;
}

export interface ExchangePairingResult {
  token: string;
  deviceLabel: string;
  callerScope: CallerScope;
  issuedAt: number;
}

export interface PairingManagerOptions {
  initialAuthToken?: string;
  defaultPairingTtlMs?: number;
  maxConsecutiveFailures?: number;
}

function sha256Digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function constantTimeHashEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Manages one-time pairing code exchange and SHA-256 + timingSafeEqual bearer token verification
 * with server-authoritative `CallerScope` binding.
 */
export class PairingManager {
  private readonly defaultPairingTtlMs: number;
  private readonly maxConsecutiveFailures: number;
  private readonly pairingCodes: PairingCodeRecord[] = [];
  private readonly tokens: DeviceTokenRecord[] = [];
  private consecutiveFailures = 0;

  constructor(options: PairingManagerOptions = {}) {
    this.defaultPairingTtlMs = Math.max(
      1_000,
      options.defaultPairingTtlMs ?? DEFAULT_PAIRING_CODE_TTL_MS
    );
    this.maxConsecutiveFailures = Math.max(
      1,
      Math.floor(
        options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_PAIRING_FAILURES
      )
    );

    if (
      options.initialAuthToken !== undefined &&
      options.initialAuthToken.trim().length > 0
    ) {
      this.registerStaticToken(
        options.initialAuthToken.trim(),
        "cli-static",
        "owner_chief"
      );
    }
  }

  registerStaticToken(
    token: string,
    deviceLabel = "static",
    callerScope: CallerScope = "owner_chief"
  ): void {
    this.registerScopedToken(token, callerScope, deviceLabel);
  }

  registerScopedToken(
    token: string,
    callerScope: CallerScope,
    deviceLabel?: string
  ): void {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      throw new Error("Auth token must not be empty.");
    }
    const verifiedScope = validateTrustedCallerScope(callerScope);
    const tokenHash = sha256Digest(trimmed);
    const label =
      deviceLabel !== undefined && deviceLabel.trim().length > 0
        ? deviceLabel.trim()
        : verifiedScope === "owner_chief"
          ? "owner-static"
          : `scoped:${verifiedScope}`;

    const existing = this.tokens.find((entry) =>
      constantTimeHashEquals(entry.tokenHash, tokenHash)
    );
    if (existing !== undefined) {
      existing.callerScope = verifiedScope;
      existing.deviceLabel = label;
      return;
    }

    this.tokens.push({
      tokenHash,
      deviceLabel: label,
      callerScope: verifiedScope,
      issuedAt: Date.now()
    });
  }

  createPairingCode(
    ttlMs: number = this.defaultPairingTtlMs,
    daemonUrl = "",
    callerScope: CallerScope = "owner_chief"
  ): DaemonPairingInfo {
    this.pruneExpiredPairingCodes();

    const verifiedScope = validateTrustedCallerScope(callerScope);
    const rawHex = randomBytes(12).toString("hex").toUpperCase();
    const pairingCode = `${rawHex.slice(0, 6)}-${rawHex.slice(6, 12)}-${rawHex.slice(12, 18)}-${rawHex.slice(18, 24)}`;
    const expiresAt = Date.now() + Math.max(1_000, ttlMs);

    this.pairingCodes.push({
      codeHash: sha256Digest(pairingCode),
      expiresAt,
      used: false,
      callerScope: verifiedScope
    });
    this.consecutiveFailures = 0;

    return {
      pairingCode,
      expiresAt,
      daemonUrl
    };
  }

  /**
   * Immediately revokes all active, unused pairing codes (e.g. after repeated failed attempts).
   */
  invalidateActivePairingCodes(): number {
    let invalidated = 0;
    for (const record of this.pairingCodes) {
      if (!record.used) {
        record.used = true;
        invalidated += 1;
      }
    }
    this.pairingCodes.length = 0;
    return invalidated;
  }

  /**
   * Records a failed pairing attempt and automatically invalidates all active pairing
   * codes once `maxConsecutiveFailures` consecutive failures are reached.
   */
  recordFailedPairingAttempt(): {
    invalidatedActiveCodes: boolean;
    consecutiveFailures: number;
  } {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      const revokedCount = this.invalidateActivePairingCodes();
      this.consecutiveFailures = 0;
      return {
        invalidatedActiveCodes: revokedCount > 0,
        consecutiveFailures: this.maxConsecutiveFailures
      };
    }
    return {
      invalidatedActiveCodes: false,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  exchangePairingCode(
    code: string,
    deviceLabel = "paired-device"
  ): ExchangePairingResult | null {
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      this.recordFailedPairingAttempt();
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
      this.recordFailedPairingAttempt();
      return null;
    }

    matched.used = true;
    this.consecutiveFailures = 0;
    const token = `pmx_${randomBytes(32).toString("base64url")}`;
    const issuedAt = Date.now();
    const normalizedLabel =
      deviceLabel.trim().length > 0 ? deviceLabel.trim() : "paired-device";

    this.tokens.push({
      tokenHash: sha256Digest(token),
      deviceLabel: normalizedLabel,
      callerScope: matched.callerScope,
      issuedAt
    });

    return {
      token,
      deviceLabel: normalizedLabel,
      callerScope: matched.callerScope,
      issuedAt
    };
  }

  resolveTokenScope(token: string): CallerScope | null {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const candidateHash = sha256Digest(trimmed);
    let resolvedScope: CallerScope | null = null;

    for (const record of this.tokens) {
      if (constantTimeHashEquals(candidateHash, record.tokenHash)) {
        resolvedScope = record.callerScope;
      }
    }

    return resolvedScope;
  }

  verifyToken(token: string): boolean {
    return this.resolveTokenScope(token) !== null;
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
