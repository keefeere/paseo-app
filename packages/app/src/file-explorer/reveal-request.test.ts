import { describe, expect, it } from "vitest";
import { explorerRevealDirectories, useExplorerRevealStore } from "./reveal-request";

describe("explorerRevealDirectories", () => {
  it.each([
    [".", []],
    ["docs", ["docs"]],
    ["packages/app/src", ["packages", "packages/app", "packages/app/src"]],
    ["./packages//app/", ["packages", "packages/app"]],
  ])("expands %s through its ancestors", (path, expected) => {
    expect(explorerRevealDirectories(path)).toEqual(expected);
  });
});

describe("useExplorerRevealStore", () => {
  it("keeps a newer request when an older one completes", () => {
    const store = useExplorerRevealStore.getState();
    store.request("key", "docs");
    const first = useExplorerRevealStore.getState().requests.key;
    store.request("key", "packages");
    store.complete("key", first.id);
    expect(useExplorerRevealStore.getState().requests.key?.path).toBe("packages");
    store.complete("key", useExplorerRevealStore.getState().requests.key.id);
    expect(useExplorerRevealStore.getState().requests.key).toBeUndefined();
  });
});
