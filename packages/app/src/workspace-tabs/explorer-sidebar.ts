import { supportsDesktopPaneSplits } from "@/constants/layout";
import { selectIsCompactFileExplorerOpen, usePanelStore } from "@/stores/panel-store";
import type { ExplorerCheckoutContext } from "@/stores/explorer-checkout-context";
import {
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";
import { buildExplorerRevealKey, useExplorerRevealStore } from "@/file-explorer/reveal-request";
import { isWorkspaceRootPath, resolveWorkspaceFilePaths } from "@/workspace/file-open";

export type ExplorerSidebarView = "changes" | "files" | "pr";
export type ExplorerSidebarPresentation = "overlay" | "dock" | "pane";

const VIEW_TARGETS: Record<ExplorerSidebarView, WorkspaceTabTarget> = {
  changes: { kind: "changes_tree" },
  files: { kind: "files" },
  pr: { kind: "pull_request" },
};

export interface ExplorerSidebarQuery {
  isCompact: boolean;
  workspaceKey: string | null;
  supportsPaneSplits?: boolean;
}

export interface ExplorerSidebarInput extends ExplorerSidebarQuery {
  checkout: ExplorerCheckoutContext | null;
}

export function resolveExplorerSidebarPresentation(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): ExplorerSidebarPresentation {
  if (input.isCompact) {
    return "overlay";
  }
  return (input.supportsPaneSplits ?? supportsDesktopPaneSplits()) ? "pane" : "dock";
}

export function usesCompactExplorerSidebar(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): boolean {
  return resolveExplorerSidebarPresentation(input) !== "pane";
}

function canUseExplorerSidebar(
  input: Pick<ExplorerSidebarQuery, "isCompact" | "supportsPaneSplits">,
): boolean {
  return resolveExplorerSidebarPresentation(input) === "pane";
}

/** Reveals the Explorer sidebar and selects one of its navigation trees. */
export function openExplorerSidebarView(
  input: ExplorerSidebarInput & { view: ExplorerSidebarView },
): void {
  if (usesCompactExplorerSidebar(input)) {
    if (!input.checkout) return;
    const panel = usePanelStore.getState();
    panel.setExplorerTabForCheckout({ ...input.checkout, tab: input.view });
    panel.openCompactFileExplorer(input.checkout);
    return;
  }
  if (!input.workspaceKey) return;
  const store = useWorkspaceLayoutStore.getState();
  const paneId = store.showExplorerSidebar(input.workspaceKey);
  store.openTab({
    workspaceKey: input.workspaceKey,
    target: VIEW_TARGETS[input.view],
    intent: "reveal",
    placement: paneId ? { mode: "pane", paneId } : undefined,
  });
}

/**
 * Shows a workspace directory in the Explorer sidebar's Files tree. Returns false when the
 * directory is outside the workspace; the sidebar tree is rooted at the workspace and cannot
 * show it.
 */
export function revealDirectoryInExplorerSidebar(input: {
  isCompact: boolean;
  serverId: string;
  workspaceId: string;
  workspaceRoot: string;
  path: string;
}): boolean {
  const relativePath = isWorkspaceRootPath({ path: input.path, workspaceRoot: input.workspaceRoot })
    ? "."
    : resolveWorkspaceFilePaths({ path: input.path, workspaceRoot: input.workspaceRoot })
        ?.relativePath;
  const explorerStateKey = buildWorkspaceExplorerStateKey({
    workspaceId: input.workspaceId,
    workspaceRoot: input.workspaceRoot,
  });
  if (!relativePath || !explorerStateKey) return false;
  useExplorerRevealStore
    .getState()
    .request(buildExplorerRevealKey(input.serverId, explorerStateKey), relativePath);
  openExplorerSidebarView({
    isCompact: input.isCompact,
    workspaceKey: buildWorkspaceTabPersistenceKey({
      serverId: input.serverId,
      workspaceId: input.workspaceId,
    }),
    // The Files tab exists in every checkout; `isGit` only gates the Changes tab.
    checkout: { serverId: input.serverId, cwd: input.workspaceRoot, isGit: false },
    view: "files",
  });
  return true;
}

export function showExplorerSidebar(input: ExplorerSidebarInput): void {
  if (usesCompactExplorerSidebar(input)) {
    if (input.checkout) usePanelStore.getState().openCompactFileExplorer(input.checkout);
    return;
  }
  if (input.workspaceKey && canUseExplorerSidebar(input)) {
    useWorkspaceLayoutStore.getState().showExplorerSidebar(input.workspaceKey);
  }
}

export function hideExplorerSidebar(input: ExplorerSidebarInput): void {
  if (usesCompactExplorerSidebar(input)) {
    usePanelStore.getState().showMobileAgent();
    return;
  }
  if (input.workspaceKey && canUseExplorerSidebar(input)) {
    useWorkspaceLayoutStore.getState().hideExplorerSidebar(input.workspaceKey);
  }
}

export function toggleExplorerSidebar(input: ExplorerSidebarInput): void {
  if (usesCompactExplorerSidebar(input)) {
    if (input.checkout) usePanelStore.getState().toggleCompactFileExplorer(input.checkout);
    return;
  }
  if (!input.workspaceKey) return;
  if (isExplorerSidebarOpen(input)) {
    hideExplorerSidebar(input);
  } else {
    showExplorerSidebar(input);
  }
}

export function useIsExplorerSidebarOpen(input: ExplorerSidebarQuery): boolean {
  const compactOpen = usePanelStore(selectIsCompactFileExplorerOpen);
  const paneOpen = useWorkspaceLayoutStore((state) =>
    input.workspaceKey && canUseExplorerSidebar(input)
      ? selectIsExplorerSidebarVisible(state, input.workspaceKey)
      : false,
  );
  return usesCompactExplorerSidebar(input) ? compactOpen : paneOpen;
}

export function isExplorerSidebarOpen(input: ExplorerSidebarQuery): boolean {
  if (usesCompactExplorerSidebar(input)) {
    return selectIsCompactFileExplorerOpen(usePanelStore.getState());
  }
  return Boolean(
    input.workspaceKey &&
    canUseExplorerSidebar(input) &&
    selectIsExplorerSidebarVisible(useWorkspaceLayoutStore.getState(), input.workspaceKey),
  );
}
