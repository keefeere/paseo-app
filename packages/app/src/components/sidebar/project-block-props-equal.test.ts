import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  areProjectBlockPropsEqual,
  type ProjectBlockPropsEqualInput,
} from "./project-block-props-equal";

function project(): SidebarProjectEntry {
  return {
    viewKey: "p",
    projectName: "P",
    projectKind: "git",
    iconWorkingDir: "/repo",
    hosts: [],
    workspaces: [],
  };
}

function props(overrides: Partial<ProjectBlockPropsEqualInput> = {}): ProjectBlockPropsEqualInput {
  return {
    project: project(),
    workspaceEntriesByKey: new Map(),
    collapsed: false,
    flattenSingleWorkspaceProjects: true,
    totalWorkspaceCount: 1,
    displayName: "P",
    iconDataUri: null,
    selectionEnabled: false,
    showShortcutBadges: false,
    shortcutIndexByWorkspaceKey: new Map(),
    hostBadgeByServerId: new Map(),
    supportsMultiplicityByServerId: new Map(),
    supportsPinningByServerId: new Map(),
    onToggleWorkspacePin: () => {},
    onToggleCollapsed: () => {},
    workspacesExpanded: false,
    onToggleWorkspacesExpanded: () => {},
    onWorkspacePress: undefined,
    parentGestureRef: undefined,
    onWorkspaceReorder: () => {},
    useNestable: false,
    dragGestureHostActive: false,
    manualSort: false,
    onWorktreeCreated: undefined,
    drag: () => {},
    isDragging: false,
    dragHandleProps: undefined,
    creatingWorkspaceIds: new Set(),
    activeWorkspaceSelection: null,
    ...overrides,
  };
}

describe("areProjectBlockPropsEqual", () => {
  it("returns true when nothing changed", () => {
    const base = props();
    expect(areProjectBlockPropsEqual(base, base)).toBe(true);
  });

  it("returns false for a count-only change", () => {
    const base = props();
    expect(areProjectBlockPropsEqual(base, { ...base, totalWorkspaceCount: 2 })).toBe(false);
  });

  it("returns false when the flatten toggle flips", () => {
    const base = props();
    expect(
      areProjectBlockPropsEqual(base, { ...base, flattenSingleWorkspaceProjects: false }),
    ).toBe(false);
  });
});
