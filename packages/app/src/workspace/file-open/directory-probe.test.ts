import { describe, expect, it, vi } from "vitest";
import { FilePreviewUnavailableError } from "@getpaseo/client/internal/daemon-client";
import { mayBeDirectoryPath, probeDirectory } from "./directory-probe";

const ROOT = "/work/project";

function directoryError(path: string) {
  return new FilePreviewUnavailableError("Requested path is a directory", {
    reason: "directory",
    path,
    size: 0,
    mimeType: "inode/directory",
  });
}

describe("mayBeDirectoryPath", () => {
  it.each([
    ["docs/", true],
    ["/work/project/packages", true],
    ["/work/project/.github", true],
    ["Makefile", true],
    ["src/index.ts", false],
    ["/work/project/README.md", false],
  ])("%s -> %s", (path, expected) => {
    expect(mayBeDirectoryPath(path)).toBe(expected);
  });
});

describe("probeDirectory", () => {
  it("returns the canonical path when the daemon reports a directory", async () => {
    const readFile = vi.fn().mockRejectedValue(directoryError("/real/project/docs"));
    await expect(
      probeDirectory({ client: { readFile }, workspaceRoot: ROOT, path: `${ROOT}/docs/` }),
    ).resolves.toBe("/real/project/docs");
    expect(readFile).toHaveBeenCalledWith(ROOT, `${ROOT}/docs/`, undefined, 1);
  });

  it("returns null for files, missing paths and oversized files", async () => {
    for (const result of [
      Promise.resolve({}),
      Promise.reject(new Error("ENOENT")),
      Promise.reject(
        new FilePreviewUnavailableError("too large", {
          reason: "too_large",
          path: `${ROOT}/big`,
          size: 9,
          mimeType: "text/plain",
        }),
      ),
    ]) {
      const readFile = vi.fn().mockReturnValue(result);
      await expect(
        probeDirectory({ client: { readFile }, workspaceRoot: ROOT, path: `${ROOT}/big` }),
      ).resolves.toBeNull();
    }
  });

  it("skips the request for paths that look like files", async () => {
    const readFile = vi.fn();
    await expect(
      probeDirectory({ client: { readFile }, workspaceRoot: ROOT, path: "src/index.ts" }),
    ).resolves.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});
