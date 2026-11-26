import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";

export interface ProjectBlockPropsEqualInput {
  project: SidebarProjectEntry;
  workspaceEntriesByKey: ReadonlyMap<string, unknown>;
  collapsed: boolean;
  flattenSingleWorkspaceProjects?: boolean;
  totalWorkspaceCount?: number;
  displayName: string;
  iconDataUri: string | null;
  selectionEnabled: boolean;
  showShortcutBadges: boolean;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  hostBadgeByServerId: unknown;
  supportsMultiplicityByServerId: unknown;
  supportsPinningByServerId: unknown;
  onToggleWorkspacePin: unknown;
  onToggleCollapsed: unknown;
  workspacesExpanded: boolean;
  onToggleWorkspacesExpanded: unknown;
  onWorkspacePress?: unknown;
  parentGestureRef?: unknown;
  onWorkspaceReorder: unknown;
  useNestable: boolean;
  dragGestureHostActive?: boolean;
  manualSort: boolean;
  onWorktreeCreated?: unknown;
  drag: unknown;
  isDragging: boolean;
  dragHandleProps?: unknown;
  creatingWorkspaceIds: unknown;
  activeWorkspaceSelection: ActiveWorkspaceSelection | null;
}

export function isProjectSelectedByRoute(input: {
  selection: ActiveWorkspaceSelection | null;
  project: SidebarProjectEntry;
  enabled: boolean;
}): boolean {
  return (
    input.enabled &&
    input.project.workspaces.some(
      (workspace) =>
        workspace.serverId === input.selection?.serverId &&
        workspace.workspaceId === input.selection.workspaceId,
    )
  );
}

export function activeWorkspaceSelectionKey(selection: ActiveWorkspaceSelection | null): string {
  return selection ? `${selection.serverId}:${selection.workspaceId}` : "";
}

function projectShortcutBadgesEqual(
  previous: ProjectBlockPropsEqualInput,
  next: ProjectBlockPropsEqualInput,
): boolean {
  if (
    !next.showShortcutBadges ||
    previous.shortcutIndexByWorkspaceKey === next.shortcutIndexByWorkspaceKey
  )
    return true;
  return next.project.workspaces.every(
    ({ workspaceKey }) =>
      previous.shortcutIndexByWorkspaceKey.get(workspaceKey) ===
      next.shortcutIndexByWorkspaceKey.get(workspaceKey),
  );
}

function projectWorkspaceEntriesEqual(
  previous: ProjectBlockPropsEqualInput,
  next: ProjectBlockPropsEqualInput,
): boolean {
  if (previous.workspaceEntriesByKey === next.workspaceEntriesByKey) return true;
  return next.project.workspaces.every(
    ({ workspaceKey }) =>
      previous.workspaceEntriesByKey.get(workspaceKey) ===
      next.workspaceEntriesByKey.get(workspaceKey),
  );
}

function areProjectBlockSelectionsEqual(
  previous: ProjectBlockPropsEqualInput,
  next: ProjectBlockPropsEqualInput,
): boolean {
  const previousActive = isProjectSelectedByRoute({
    selection: previous.activeWorkspaceSelection,
    project: previous.project,
    enabled: previous.selectionEnabled,
  });
  const nextActive = isProjectSelectedByRoute({
    selection: next.activeWorkspaceSelection,
    project: next.project,
    enabled: next.selectionEnabled,
  });
  if (previousActive !== nextActive) {
    return false;
  }
  if (!previousActive) {
    return true;
  }
  return (
    activeWorkspaceSelectionKey(previous.activeWorkspaceSelection) ===
    activeWorkspaceSelectionKey(next.activeWorkspaceSelection)
  );
}

// oxlint-disable-next-line complexity
export function areProjectBlockPropsEqual(
  previous: ProjectBlockPropsEqualInput,
  next: ProjectBlockPropsEqualInput,
): boolean {
  return (
    previous.project === next.project &&
    projectWorkspaceEntriesEqual(previous, next) &&
    previous.collapsed === next.collapsed &&
    previous.flattenSingleWorkspaceProjects === next.flattenSingleWorkspaceProjects &&
    previous.totalWorkspaceCount === next.totalWorkspaceCount &&
    previous.displayName === next.displayName &&
    previous.iconDataUri === next.iconDataUri &&
    previous.selectionEnabled === next.selectionEnabled &&
    previous.showShortcutBadges === next.showShortcutBadges &&
    projectShortcutBadgesEqual(previous, next) &&
    previous.hostBadgeByServerId === next.hostBadgeByServerId &&
    previous.supportsMultiplicityByServerId === next.supportsMultiplicityByServerId &&
    previous.supportsPinningByServerId === next.supportsPinningByServerId &&
    previous.onToggleWorkspacePin === next.onToggleWorkspacePin &&
    previous.onToggleCollapsed === next.onToggleCollapsed &&
    previous.workspacesExpanded === next.workspacesExpanded &&
    previous.onToggleWorkspacesExpanded === next.onToggleWorkspacesExpanded &&
    previous.onWorkspacePress === next.onWorkspacePress &&
    previous.parentGestureRef === next.parentGestureRef &&
    previous.onWorkspaceReorder === next.onWorkspaceReorder &&
    previous.useNestable === next.useNestable &&
    previous.dragGestureHostActive === next.dragGestureHostActive &&
    previous.manualSort === next.manualSort &&
    previous.onWorktreeCreated === next.onWorktreeCreated &&
    previous.drag === next.drag &&
    previous.isDragging === next.isDragging &&
    previous.dragHandleProps === next.dragHandleProps &&
    previous.creatingWorkspaceIds === next.creatingWorkspaceIds &&
    previous.activeWorkspaceSelection?.serverId === next.activeWorkspaceSelection?.serverId &&
    areProjectBlockSelectionsEqual(previous, next)
  );
}
