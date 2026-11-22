export const DIAL_MODES = ["agent", "oracle", "review"] as const;

export type DialMode = (typeof DIAL_MODES)[number];

export const DIAL_MODE_DESCRIPTIONS: Record<
  DialMode,
  { label: string; readOnly: boolean; purpose: string }
> = {
  agent: {
    label: "Agent",
    readOnly: false,
    purpose: "Full read-write coding and task execution mode."
  },
  oracle: {
    label: "Oracle",
    readOnly: true,
    purpose: "High-level read-only architectural advisor and planner."
  },
  review: {
    label: "Review",
    readOnly: true,
    purpose: "Independent read-only git diff and defect reviewer."
  }
};

export interface HandoffSummary {
  goal: string;
  decisions: string[];
  touchedFiles: string[];
  openQuestions: string[];
}

export interface HandoffRequest {
  sourceThreadId: string;
  targetDialMode?: DialMode;
  targetWorkspace?: string;
  targetBranch?: string;
  additionalContext?: string;
}

export interface HandoffResult {
  sourceThreadId: string;
  newThreadId: string;
  dialMode: DialMode;
  summary: HandoffSummary;
  createdAt: number;
}

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ReasoningModelProfile {
  providerId: string;
  modelId: string;
  effort: ReasoningEffort;
  tokenBudget?: number;
  supportsMultimodal: boolean;
  multimodalEnabled: boolean;
}
