import { i18n } from "@/i18n/i18next";

// User-facing copy for the usage surfaces, kept in one file so localization is a
// single-file change.
export const usageCopy = {
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
} as const;
