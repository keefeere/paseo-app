import type { Download } from "@/stores/download-store";

const COMPLETE_DISMISS_MS = 3000;

// A toast that closes before it can be read, or before its buttons can be
// reached, is worse than one that stays. Failures and downloads with file
// actions wait for the user; a plain "complete" with nothing to act on does not.
export function getAutoDismissDelayMs(
  download: Pick<Download, "status" | "savedPath">,
): number | null {
  if (download.status !== "complete") return null;
  return download.savedPath ? null : COMPLETE_DISMISS_MS;
}
