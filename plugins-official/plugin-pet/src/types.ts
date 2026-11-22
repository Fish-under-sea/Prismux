export const PET_ACTION_NAMESPACE = "prismux.pet" as const;

export type PetOwnerKind = "native" | "plugin";

export type PetLeaseRejectReason =
  | "stale_lease"
  | "expired_lease"
  | "unknown_instance";

export interface PetLeaseToken {
  leaseId: string;
  instanceId: string;
  expiresAt: number;
  generation?: number;
}

export interface IssuedPetLeaseToken extends PetLeaseToken {
  generation: number;
  acquiredAt: number;
  ownerId?: string;
}

export interface PetPlaybackProgress {
  playbackId: string;
  currentTime: number;
  duration: number;
  buffering: boolean;
}

export interface PetInstanceMeta {
  kind?: "desktop" | "web" | "overlay";
  windowLabel?: string;
  title?: string;
  capabilities?: string[];
}

export interface PetBubbleState {
  text: string;
  kind?: "email" | "factory_complete" | "approval" | "notice" | (string & {});
  deepLink?: string;
  updatedAt: number;
}

export interface PetMotionState {
  motionName: string;
  playbackId?: string;
  startedAt: number;
}

export interface PetInstanceSnapshot {
  instanceId: string;
  meta: Readonly<PetInstanceMeta>;
  motionOwner: PetOwnerKind;
  bubbleOwner: PetOwnerKind;
  activeMotion: Readonly<PetMotionState> | null;
  activeBubble: Readonly<PetBubbleState> | null;
  activeLease: Readonly<IssuedPetLeaseToken> | null;
  generationCounter: number;
  registeredAt: number;
  updatedAt: number;
}

export interface PetActionInput {
  type?: "perform" | "motion" | "bubble";
  motion?: string;
  playbackId?: string;
  bubbleText?: string;
  bubbleKind?: PetBubbleState["kind"];
  deepLink?: string;
  bubble?: {
    text: string;
    kind?: PetBubbleState["kind"];
    deepLink?: string;
  };
}

export interface PetActionRequest {
  instanceId: string;
  leaseId?: string;
  lease?: PetLeaseToken;
  action: PetActionInput;
  now?: number;
}

export interface PetActionResult {
  accepted: boolean;
  reason?: PetLeaseRejectReason;
  instanceId: string;
  leaseId?: string;
  generation?: number;
  motionOwner?: PetOwnerKind;
  bubbleOwner?: PetOwnerKind;
  activeMotion?: Readonly<PetMotionState> | null;
  activeBubble?: Readonly<PetBubbleState> | null;
}

export interface PetLeaseRenewResult {
  accepted: boolean;
  reason?: PetLeaseRejectReason;
  lease?: Readonly<IssuedPetLeaseToken>;
}

export interface PetLeaseReleaseResult {
  released: boolean;
  reason?: PetLeaseRejectReason;
}

export interface PetHandoverResult {
  accepted: boolean;
  reason?: PetLeaseRejectReason;
  instanceId: string;
  motionOwner?: PetOwnerKind;
  bubbleOwner?: PetOwnerKind;
  bubblePreserved: boolean;
  activeBubble: Readonly<PetBubbleState> | null;
}

export type PetProgressListener = (
  snapshot: Readonly<PetPlaybackProgress>,
  meta: Readonly<{ instanceId?: string }>
) => void;

export interface PetGlobalConfig {
  [key: string]: unknown;
}

export type PetNamespaceActionHandler<TInput = unknown, TOutput = unknown> = (
  payload: TInput
) => TOutput;

export interface PetBridgeControllerOptions {
  defaultLeaseTtlMs?: number;
  nowFn?: () => number;
  globalConfig?: PetGlobalConfig;
}
