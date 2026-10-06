import { describe, expect, it } from "vitest";
import { getAutoDismissDelayMs } from "./download-toast-policy";

describe("getAutoDismissDelayMs", () => {
  it("never dismisses a download that is still running", () => {
    expect(getAutoDismissDelayMs({ status: "downloading" })).toBeNull();
  });

  it("keeps a failure on screen until the user closes it", () => {
    expect(getAutoDismissDelayMs({ status: "error" })).toBeNull();
  });

  it("keeps a saved file on screen so its buttons can be used", () => {
    expect(
      getAutoDismissDelayMs({ status: "complete", savedPath: "/home/u/Downloads/a.md" }),
    ).toBeNull();
  });

  it("closes a completion that has nothing to act on", () => {
    expect(getAutoDismissDelayMs({ status: "complete" })).toBe(3000);
  });
});
