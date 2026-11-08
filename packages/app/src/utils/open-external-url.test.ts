import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "./open-external-url";

const open = vi.fn();

describe("external URL policy", () => {
  beforeEach(() => {
    open.mockClear();
    vi.stubGlobal("window", { open });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["javascript:alert(1)", "/relative", "invalid"])(
    "safely ignores %s for fire-and-forget callers",
    async (url) => {
      await expect(openExternalUrl(url)).resolves.toBeUndefined();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("hands an allowed non-http scheme to the web opener", async () => {
    await expect(openExternalUrl("mailto:person@example.com")).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith("mailto:person@example.com", "_blank", "noopener,noreferrer");
  });
});
