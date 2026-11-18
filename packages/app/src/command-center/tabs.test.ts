import { describe, expect, it } from "vitest";
import {
  availableCommandCenterTabs,
  resolveCommandCenterTab,
  rotateCommandCenterTab,
  type CommandCenterTab,
} from "./tabs";

const IN_WORKSPACE = availableCommandCenterTabs({ hasWorkspace: true, hasMessageSearch: true });
const NO_WORKSPACE = availableCommandCenterTabs({ hasWorkspace: false, hasMessageSearch: true });
const NO_MESSAGE_SEARCH = availableCommandCenterTabs({
  hasWorkspace: true,
  hasMessageSearch: false,
});

function walk(available: readonly CommandCenterTab[], direction: "next" | "previous") {
  const walked: CommandCenterTab[] = ["all"];
  for (let step = 0; step < available.length; step += 1) {
    walked.push(rotateCommandCenterTab(walked[walked.length - 1], direction, available));
  }
  return walked;
}

describe("command center tabs", () => {
  it("walks All, Messages, Workspaces, Files, Actions in a workspace and wraps", () => {
    expect(walk(IN_WORKSPACE, "next")).toEqual([
      "all",
      "messages",
      "workspaces",
      "files",
      "actions",
      "all",
    ]);
    expect(walk(IN_WORKSPACE, "previous")).toEqual([
      "all",
      "actions",
      "files",
      "workspaces",
      "messages",
      "all",
    ]);
  });

  it("offers no Files tab outside a workspace, and Tab skips it", () => {
    expect(NO_WORKSPACE).toEqual(["all", "messages", "workspaces", "actions"]);
    expect(walk(NO_WORKSPACE, "next")).toEqual(["all", "messages", "workspaces", "actions", "all"]);
    expect(walk(NO_WORKSPACE, "previous")).toEqual([
      "all",
      "actions",
      "workspaces",
      "messages",
      "all",
    ]);
  });

  it("offers no Messages tab when no host can search message text", () => {
    expect(NO_MESSAGE_SEARCH).toEqual(["all", "workspaces", "files", "actions"]);
    expect(resolveCommandCenterTab("messages", NO_MESSAGE_SEARCH)).toBe("all");
  });

  it("opens a requested tab only when it is on offer", () => {
    expect(resolveCommandCenterTab("files", IN_WORKSPACE)).toBe("files");
    expect(resolveCommandCenterTab("files", NO_WORKSPACE)).toBe("all");
    expect(resolveCommandCenterTab("messages", IN_WORKSPACE)).toBe("messages");
    expect(resolveCommandCenterTab("actions", NO_WORKSPACE)).toBe("actions");
  });
});
