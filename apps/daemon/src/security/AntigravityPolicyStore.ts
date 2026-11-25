import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import {
  ANTIGRAVITY_DISCLAIMER_VERSION,
  BRAND,
  SUBSCRIPTION_WAIVER_VERSION,
  type AntigravityPolicyResponse,
  type AntigravityPolicyUpdateRequest,
  type SubscriptionWaiverRecord,
  type SubscriptionWaiverResponse,
  type SubscriptionWaiverUpdateRequest
} from "@prismux/protocol";

const WAIVER_FILENAME = "subscription-waiver.json" as const;
const LEGACY_POLICY_FILENAME = "antigravity-policy.json" as const;

export class AntigravityPolicyError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AntigravityPolicyError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class SubscriptionWaiverError extends AntigravityPolicyError {
  constructor(statusCode: number, code: string, message: string) {
    super(statusCode, code, message);
    this.name = "SubscriptionWaiverError";
  }
}

export interface SubscriptionWaiverStoreOptions {
  dataDir?: string;
  waiverFilePath?: string;
  policyFilePath?: string;
  legacyPolicyFilePath?: string;
  now?: () => number;
}

export type AntigravityPolicyStoreOptions = SubscriptionWaiverStoreOptions;

function createDefaultWaiverRecord(): SubscriptionWaiverRecord {
  return {
    signed: false,
    waiverVersion: null,
    signedAt: null,
    allowAntigravityAsControlledAgent: false,
    allowExternalSubscriptionAgentsInSwarm: false
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.tmp-${basename(filePath)}-${process.pid}-${randomUUID()}`
  );
  try {
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Ignore cleanup failure
    }
    throw err;
  }
}

/**
 * Persistent fail-closed store for the unified Personal Subscription Cross-Agent
 * Orchestration & Automation Risk Waiver.
 *
 * Persisted at `<dataDir>/config/subscription-waiver.json` (default
 * `~/.prismux/config/subscription-waiver.json`), automatically migrating any
 * legacy `<dataDir>/config/antigravity-policy.json`.
 *
 * Defaults strictly to all-locked (`signed: false`, both toggles `false`).
 */
export class SubscriptionWaiverStore {
  private readonly filePath: string;
  private readonly legacyFilePath: string;
  private readonly now: () => number;
  private record: SubscriptionWaiverRecord;

  constructor(options: SubscriptionWaiverStoreOptions = {}) {
    const resolvedDataDir =
      options.dataDir ?? join(homedir(), `.${BRAND.appSlug}`);
    this.filePath =
      options.waiverFilePath ??
      options.policyFilePath ??
      join(resolvedDataDir, "config", WAIVER_FILENAME);
    this.legacyFilePath =
      options.legacyPolicyFilePath ??
      join(resolvedDataDir, "config", LEGACY_POLICY_FILENAME);
    this.now = options.now ?? (() => Date.now());
    this.record = this.loadFromDisk();
  }

  getFilePath(): string {
    return this.filePath;
  }

  getWaiver(): SubscriptionWaiverResponse {
    return {
      signed: this.record.signed,
      waiverVersion: this.record.waiverVersion,
      signedAt: this.record.signedAt,
      allowAntigravityAsControlledAgent:
        this.record.allowAntigravityAsControlledAgent,
      allowExternalSubscriptionAgentsInSwarm:
        this.record.allowExternalSubscriptionAgentsInSwarm,
      defaultLocked: true
    };
  }

  reloadWaiver(): SubscriptionWaiverResponse {
    this.record = this.loadFromDisk();
    return this.getWaiver();
  }

  updateWaiver(rawInput: unknown): SubscriptionWaiverResponse {
    if (!isPlainObject(rawInput)) {
      throw new SubscriptionWaiverError(
        400,
        "INVALID_WAIVER_PAYLOAD",
        "Request body must be a JSON object."
      );
    }

    const signedRaw = rawInput["signed"];
    if (signedRaw !== undefined && typeof signedRaw !== "boolean") {
      throw new SubscriptionWaiverError(
        400,
        "INVALID_WAIVER_PAYLOAD",
        'Field "signed" must be a boolean.'
      );
    }

    const allowAgyRaw = rawInput["allowAntigravityAsControlledAgent"];
    if (allowAgyRaw !== undefined && typeof allowAgyRaw !== "boolean") {
      throw new SubscriptionWaiverError(
        400,
        "INVALID_WAIVER_PAYLOAD",
        'Field "allowAntigravityAsControlledAgent" must be a boolean.'
      );
    }

    const allowSwarmRaw = rawInput["allowExternalSubscriptionAgentsInSwarm"];
    if (allowSwarmRaw !== undefined && typeof allowSwarmRaw !== "boolean") {
      throw new SubscriptionWaiverError(
        400,
        "INVALID_WAIVER_PAYLOAD",
        'Field "allowExternalSubscriptionAgentsInSwarm" must be a boolean.'
      );
    }

    const versionRaw = rawInput["waiverVersion"];
    if (versionRaw !== undefined && typeof versionRaw !== "string") {
      throw new SubscriptionWaiverError(
        400,
        "INVALID_WAIVER_PAYLOAD",
        'Field "waiverVersion" must be a string.'
      );
    }

    const input: SubscriptionWaiverUpdateRequest = {
      ...(signedRaw !== undefined ? { signed: signedRaw } : {}),
      ...(versionRaw !== undefined ? { waiverVersion: versionRaw } : {}),
      ...(allowAgyRaw !== undefined
        ? { allowAntigravityAsControlledAgent: allowAgyRaw }
        : {}),
      ...(allowSwarmRaw !== undefined
        ? { allowExternalSubscriptionAgentsInSwarm: allowSwarmRaw }
        : {})
    };

    const nextSigned =
      input.signed !== undefined ? input.signed : this.record.signed;

    // Attempting to enable either toggle while unsigned MUST fail with HTTP 400 WAIVER_SIGNATURE_REQUIRED.
    if (
      !nextSigned &&
      (input.allowAntigravityAsControlledAgent === true ||
        input.allowExternalSubscriptionAgentsInSwarm === true)
    ) {
      throw new SubscriptionWaiverError(
        400,
        "WAIVER_SIGNATURE_REQUIRED",
        "启用个人订阅跨代理编排或 Antigravity 受控开关前，必须先签署统一风险免责声明（signed: true）。"
      );
    }

    // Setting signed: false immediately revokes waiver & hard-locks BOTH toggles to false.
    if (input.signed === false || !nextSigned) {
      this.record = createDefaultWaiverRecord();
      writeJsonAtomic(this.filePath, this.record);
      return this.getWaiver();
    }

    const resolvedVersion =
      input.waiverVersion !== undefined && input.waiverVersion.trim().length > 0
        ? input.waiverVersion.trim()
        : (this.record.waiverVersion ?? SUBSCRIPTION_WAIVER_VERSION);
    const resolvedSignedAt =
      this.record.signed && this.record.signedAt && input.signed !== true
        ? this.record.signedAt
        : new Date(this.now()).toISOString();

    this.record = {
      signed: true,
      waiverVersion: resolvedVersion,
      signedAt: resolvedSignedAt,
      allowAntigravityAsControlledAgent:
        input.allowAntigravityAsControlledAgent ??
        this.record.allowAntigravityAsControlledAgent,
      allowExternalSubscriptionAgentsInSwarm:
        input.allowExternalSubscriptionAgentsInSwarm ??
        this.record.allowExternalSubscriptionAgentsInSwarm
    };

    writeJsonAtomic(this.filePath, this.record);
    return this.getWaiver();
  }

  revokeWaiver(): SubscriptionWaiverResponse {
    this.record = createDefaultWaiverRecord();
    writeJsonAtomic(this.filePath, this.record);
    return this.getWaiver();
  }

  // ── Backward-compatible legacy AntigravityPolicyStore methods ─────────────

  getPolicy(): AntigravityPolicyResponse {
    const allowed =
      this.record.signed && this.record.allowAntigravityAsControlledAgent;
    return {
      allowAntigravityAsControlledAgent: allowed,
      disclaimerAcceptedAt: allowed ? this.record.signedAt : null,
      disclaimerVersion: allowed ? this.record.waiverVersion : null,
      defaultLocked: true
    };
  }

  reload(): AntigravityPolicyResponse {
    this.record = this.loadFromDisk();
    return this.getPolicy();
  }

  updatePolicy(rawInput: unknown): AntigravityPolicyResponse {
    if (!isPlainObject(rawInput)) {
      throw new AntigravityPolicyError(
        400,
        "INVALID_POLICY_PAYLOAD",
        "Request body must be a JSON object."
      );
    }

    const allowRaw = rawInput["allowAntigravityAsControlledAgent"];
    if (typeof allowRaw !== "boolean") {
      throw new AntigravityPolicyError(
        400,
        "INVALID_POLICY_PAYLOAD",
        'Field "allowAntigravityAsControlledAgent" must be a boolean.'
      );
    }

    const input: AntigravityPolicyUpdateRequest = {
      allowAntigravityAsControlledAgent: allowRaw,
      ...(typeof rawInput["disclaimerAccepted"] === "boolean"
        ? { disclaimerAccepted: rawInput["disclaimerAccepted"] }
        : {}),
      ...(typeof rawInput["disclaimerVersion"] === "string"
        ? { disclaimerVersion: rawInput["disclaimerVersion"] }
        : {})
    };

    if (input.allowAntigravityAsControlledAgent) {
      if (input.disclaimerAccepted !== true) {
        throw new AntigravityPolicyError(
          400,
          "AGY_DISCLAIMER_REQUIRED",
          "启用个人版 Antigravity（AGY）受控代理前，必须显式阅读风险提示并传入 disclaimerAccepted: true 签署免责声明。"
        );
      }

      const version =
        input.disclaimerVersion !== undefined &&
        input.disclaimerVersion.trim().length > 0
          ? input.disclaimerVersion.trim()
          : ANTIGRAVITY_DISCLAIMER_VERSION;

      this.record = {
        signed: true,
        waiverVersion: version,
        signedAt: new Date(this.now()).toISOString(),
        allowAntigravityAsControlledAgent: true,
        allowExternalSubscriptionAgentsInSwarm:
          this.record.allowExternalSubscriptionAgentsInSwarm
      };
    } else if (this.record.allowExternalSubscriptionAgentsInSwarm && this.record.signed) {
      // Preserve active Switch B while locking Switch A.
      this.record = {
        ...this.record,
        allowAntigravityAsControlledAgent: false
      };
    } else {
      // Turning OFF re-locks cleanly to fail-closed posture.
      this.record = createDefaultWaiverRecord();
    }

    writeJsonAtomic(this.filePath, this.record);
    return this.getPolicy();
  }

  private loadFromDisk(): SubscriptionWaiverRecord {
    if (existsSync(this.filePath)) {
      return this.parseWaiverJson(this.filePath);
    }

    // One-time transparent migration from legacy `antigravity-policy.json`.
    if (
      this.legacyFilePath !== this.filePath &&
      existsSync(this.legacyFilePath)
    ) {
      const migrated = this.parseLegacyPolicyJson(this.legacyFilePath);
      if (migrated.signed) {
        try {
          writeJsonAtomic(this.filePath, migrated);
        } catch {
          // Non-fatal if read-only filesystem; keep in-memory migrated record.
        }
      }
      return migrated;
    }

    return createDefaultWaiverRecord();
  }

  private parseWaiverJson(filePath: string): SubscriptionWaiverRecord {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (!isPlainObject(parsed)) {
        return createDefaultWaiverRecord();
      }

      // Support legacy schema if a caller explicitly pointed waiverFilePath at a legacy file.
      if (
        !("signed" in parsed) &&
        "allowAntigravityAsControlledAgent" in parsed
      ) {
        return this.parseLegacyRecord(parsed);
      }

      const signed = parsed["signed"] === true;
      const signedAt =
        typeof parsed["signedAt"] === "string" &&
        parsed["signedAt"].trim().length > 0
          ? parsed["signedAt"].trim()
          : null;
      const waiverVersion =
        typeof parsed["waiverVersion"] === "string" &&
        parsed["waiverVersion"].trim().length > 0
          ? parsed["waiverVersion"].trim()
          : null;
      const allowAgy = parsed["allowAntigravityAsControlledAgent"] === true;
      const allowSwarm =
        parsed["allowExternalSubscriptionAgentsInSwarm"] === true;

      // Fail-closed invariant: unsigned or missing signature metadata forces all locks closed.
      if (!signed || signedAt === null || waiverVersion === null) {
        return createDefaultWaiverRecord();
      }

      return {
        signed: true,
        waiverVersion,
        signedAt,
        allowAntigravityAsControlledAgent: allowAgy,
        allowExternalSubscriptionAgentsInSwarm: allowSwarm
      };
    } catch {
      return createDefaultWaiverRecord();
    }
  }

  private parseLegacyPolicyJson(filePath: string): SubscriptionWaiverRecord {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
      if (!isPlainObject(parsed)) {
        return createDefaultWaiverRecord();
      }
      return this.parseLegacyRecord(parsed);
    } catch {
      return createDefaultWaiverRecord();
    }
  }

  private parseLegacyRecord(
    parsed: Record<string, unknown>
  ): SubscriptionWaiverRecord {
    const allow = parsed["allowAntigravityAsControlledAgent"] === true;
    const acceptedAt =
      typeof parsed["disclaimerAcceptedAt"] === "string" &&
      parsed["disclaimerAcceptedAt"].trim().length > 0
        ? parsed["disclaimerAcceptedAt"].trim()
        : null;
    const version =
      typeof parsed["disclaimerVersion"] === "string" &&
      parsed["disclaimerVersion"].trim().length > 0
        ? parsed["disclaimerVersion"].trim()
        : null;

    if (!allow || acceptedAt === null || version === null) {
      return createDefaultWaiverRecord();
    }

    return {
      signed: true,
      waiverVersion: version,
      signedAt: acceptedAt,
      allowAntigravityAsControlledAgent: true,
      allowExternalSubscriptionAgentsInSwarm: false
    };
  }
}

/**
 * Backward-compatible alias class extending `SubscriptionWaiverStore`.
 */
export class AntigravityPolicyStore extends SubscriptionWaiverStore {}
