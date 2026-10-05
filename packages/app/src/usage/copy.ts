import type { UsageProblem } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { formatCompactTimeAgo, formatCompactTimeAgoAsProse } from "@/utils/time";

// User-facing copy for the usage surfaces, kept in one file so localization is a
// single-file change.
export const usageCopy = {
  problem: (problem: UsageProblem, now: Date = new Date()): string => {
    if (problem.kind === "no_quota") return problem.detail;
    const remedy = problem.refreshedBy
      ? i18n.t("usage.problem.runToRefresh", { command: problem.refreshedBy })
      : i18n.t("usage.problem.signInAgain");
    if (problem.kind === "rejected") {
      return i18n.t("usage.problem.rejected", { status: problem.status, remedy });
    }
    const ago = formatCompactTimeAgoAsProse(formatCompactTimeAgo(new Date(problem.expiresAt), now));
    return i18n.t("usage.problem.expired", { ago, remedy });
  },
  get title() {
    return i18n.t("usage.title");
  },
  get planUsage() {
    return i18n.t("usage.planUsage");
  },
  get options() {
    return i18n.t("usage.options");
  },
  get refresh() {
    return i18n.t("usage.refresh");
  },
  get refreshAll() {
    return i18n.t("usage.refreshAll");
  },
  get refreshing() {
    return i18n.t("usage.refreshing");
  },
  get refreshFailed() {
    return i18n.t("usage.refreshFailed");
  },
  get updated() {
    return i18n.t("usage.updated");
  },
  get loading() {
    return i18n.t("usage.loading");
  },
  get empty() {
    return i18n.t("usage.empty");
  },
  get noHosts() {
    return i18n.t("usage.noHosts");
  },
  get errorTitle() {
    return i18n.t("usage.errorTitle");
  },
  agentError: (reason: string) => i18n.t("usage.agentError", { reason }),
  hostUnavailable: (host: string) => i18n.t("usage.hostUnavailable", { host }),
  hostUpgradeRequired: (host: string) => i18n.t("usage.hostUpgradeRequired", { host }),
  get clientUnavailable() {
    return i18n.t("usage.clientUnavailable");
  },
  get retry() {
    return i18n.t("usage.retry");
  },
  get pin() {
    return i18n.t("usage.pin");
  },
  get unpin() {
    return i18n.t("usage.unpin");
  },
  get displayAs() {
    return i18n.t("usage.displayAs");
  },
  get displayUsed() {
    return i18n.t("usage.displayUsed");
  },
  get displayRemaining() {
    return i18n.t("usage.displayRemaining");
  },
  get showInSidebar() {
    return i18n.t("usage.showInSidebar");
  },
  get showInSidebarHint() {
    return i18n.t("usage.showInSidebarHint");
  },
} as const;
