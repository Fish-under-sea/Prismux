import { BRAND } from "@prismux/protocol";

export const OVERNIGHT_FACTORY_MILESTONE = "M5" as const;

export type FactoryInboundMode = "gmail-oauth2" | "imap";

export type FactoryStage =
  | "stage_a_handoff"
  | "stage_b_worktree_code"
  | "stage_c_oracle_review"
  | "stage_d_morning_report";

export interface FactoryInboundConfig {
  mode: FactoryInboundMode;
  matchAliasOrTag: string;
  pollIntervalMs: number;
}

export interface FactoryMorningReport {
  jobId: string;
  threadId: string;
  branchName: string;
  summary: string;
  changedFilesCount: number;
  reviewComments: string[];
  deepLink: string;
}

export function buildReviewDeepLink(threadId: string): string {
  return `${BRAND.uriScheme}://review/${encodeURIComponent(threadId)}`;
}

/**
 * Milestone M5 skeleton for unattended overnight pipeline:
 * Gmail/IMAP `#factory` inbound -> Handoff -> Sandbox Worktree coding -> Review dial -> HTML morning report.
 */
export class OvernightFactory {
  private readonly config: FactoryInboundConfig;

  constructor(config?: Partial<FactoryInboundConfig>) {
    this.config = {
      mode: config?.mode ?? "gmail-oauth2",
      matchAliasOrTag: config?.matchAliasOrTag ?? "#factory",
      pollIntervalMs: config?.pollIntervalMs ?? 60_000
    };
  }

  getInboundConfig(): FactoryInboundConfig {
    return { ...this.config };
  }

  renderMorningReportHtml(report: FactoryMorningReport): string {
    return [
      `<!doctype html>`,
      `<html lang="zh-CN">`,
      `<head><meta charset="utf-8"><title>${BRAND.appName} Overnight Factory</title></head>`,
      `<body>`,
      `<h1>${BRAND.appName} 夜间工场完工早报</h1>`,
      `<p><strong>任务线程：</strong>${report.threadId}</p>`,
      `<p><strong>交付分支：</strong><code>${report.branchName}</code></p>`,
      `<p><strong>成果摘要：</strong>${report.summary}</p>`,
      `<p><strong>变更文件数：</strong>${report.changedFilesCount}</p>`,
      `<p><a href="${report.deepLink}">在 ${BRAND.appName} 中审阅合并</a></p>`,
      `</body>`,
      `</html>`
    ].join("\n");
  }
}
