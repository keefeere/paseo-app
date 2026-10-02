import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createExternalUrlOpener, createLocalPathOpener } from "./opener";

describe("desktop opener", () => {
  it.each([
    "mailto:user@example.com",
    "tel:+123456",
    "ftp://host/file",
    "sftp://host/file",
    "ssh://user@host",
    "scp://user@host/file",
    "smb://server/share",
    "vnc://localhost:5900",
    "rdp://host",
    "magnet:?xt=urn:btih:abc",
    "vscode://file/tmp/file.ts",
  ])("dispatches %s to the system handler", async (url) => {
    const opened: string[] = [];
    await createExternalUrlOpener({
      open: async (value) => {
        opened.push(value);
      },
    })(url);
    expect(opened).toEqual([url]);
  });
  it("propagates a missing system handler", async () => {
    const open = createExternalUrlOpener({
      open: async () => {
        throw new Error("No handler installed");
      },
    });
    await expect(open("ssh://host")).rejects.toThrow("No handler installed");
  });
  it("passes a canonical web URL to its external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    await open("https://example.com/docs#install");

    expect(opened).toEqual(["https://example.com/docs#install"]);
  });

  it("does not hand unsafe, file or relative URLs to the external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    for (const input of [
      "file:///private/data",
      "javascript:alert(1)",
      "data:text/html,hi",
      "unknown-app://host",
      "ssh://host\n",
      "paseo://settings",
      "/docs",
      null,
    ]) {
      await expect(open(input)).rejects.toThrow("This URL scheme cannot open externally.");
    }

    expect(opened).toEqual([]);
  });
});

describe("local resource opener", () => {
  it("opens an existing file or directory and exposes OS failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "resource-opener-"));
    try {
      const file = join(root, "notes.txt");
      await writeFile(file, "notes");
      const opened: string[] = [];
      const open = createLocalPathOpener({
        open: async (path) => {
          opened.push(path);
          return "";
        },
      });
      await open(file);
      await open(root);
      expect(opened).toEqual([file, root]);
      await expect(
        createLocalPathOpener({ open: async () => "No application installed" })(file),
      ).rejects.toThrow("No application installed");
      await expect(open(join(root, "missing"))).rejects.toThrow();
      expect(opened).toEqual([file, root]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each(["relative.txt", "file:///tmp/file", "ssh://host", null, "/tmp/file\0"])(
    "rejects %s before invoking the system",
    async (input) => {
      const opened: string[] = [];
      const open = createLocalPathOpener({
        open: async (path) => {
          opened.push(path);
          return "";
        },
      });
      await expect(open(input)).rejects.toThrow("An absolute local path is required.");
      expect(opened).toEqual([]);
    },
  );
});
