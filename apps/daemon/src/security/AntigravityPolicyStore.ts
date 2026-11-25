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
  type AntigravityPolicyRecord,
  type AntigravityPolicyResponse,
  type AntigravityPolicyUpdateRequest
} from "@prismux/protocol";

const POLICY_FILENAME = "antigravity-policy.json" as const;

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

export interface AntigravityPolicyStoreOptions {
  dataDir?: string;
  policyFilePath?: string;
  now?: () => number;
}

function createDefaultPolicyRecord(): AntigravityPolicyRecord {
  return {
    allowAntigravityAsControlledAgent: false,
    disclaimerAcceptedAt: null,
    disclaimerVersion: null
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
 * Persistent fail-closed store for personal Antigravity (AGY) controlled-agent policy.
 * Stored under `<dataDir>/config/antigravity-policy.json` (default `~/.prismux/config/antigravity-policy.json`).
 * Defaults strictly to `{ allowAntigravityAsControlledAgent: false, disclaimerAcceptedAt: null, disclaimerVersion: null }`.
 */
export class AntigravityPolicyStore {
  private readonly filePath: string;
  private readonly now: () => number;
  private record: AntigravityPolicyRecord;

  constructor(options: AntigravityPolicyStoreOptions = {}) {
    const resolvedDataDir =
      options.dataDir ?? join(homedir(), `.${BRAND.appSlug}`);
    this.filePath =
      options.policyFilePath ??
      join(resolvedDataDir, "config", POLICY_FILENAME);
    this.now = options.now ?? (() => Date.now());
    this.record = this.loadFromDisk();
  }

  getFilePath(): string {
    return this.filePath;
  }

  getPolicy(): AntigravityPolicyResponse {
    return {
      allowAntigravityAsControlledAgent:
        this.record.allowAntigravityAsControlledAgent,
      disclaimerAcceptedAt: this.record.disclaimerAcceptedAt,
      disclaimerVersion: this.record.disclaimerVersion,
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
        allowAntigravityAsControlledAgent: true,
        disclaimerAcceptedAt: new Date(this.now()).toISOString(),
        disclaimerVersion: version
      };
    } else {
      // Turning OFF immediately re-locks to fail-closed commander-only posture.
      this.record = createDefaultPolicyRecord();
    }

    writeJsonAtomic(this.filePath, this.record);
    return this.getPolicy();
  }

  private loadFromDisk(): AntigravityPolicyRecord {
    if (!existsSync(this.filePath)) {
      return createDefaultPolicyRecord();
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as unknown;
      if (!isPlainObject(parsed)) {
        return createDefaultPolicyRecord();
      }
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

      // Fail-closed invariant: persisted `true` without recorded disclaimer timestamp/version is treated as locked.
      if (allow && (acceptedAt === null || version === null)) {
        return createDefaultPolicyRecord();
      }

      return {
        allowAntigravityAsControlledAgent: allow,
        disclaimerAcceptedAt: allow ? acceptedAt : null,
        disclaimerVersion: allow ? version : null
      };
    } catch {
      // Fail-closed on corrupt JSON.
      return createDefaultPolicyRecord();
    }
  }
}
