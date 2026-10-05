import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createAppDownloads,
  type DownloadItemHandle,
  type DownloadSource,
  parseDownloadRequest,
  resolveDownloadPath,
} from "./downloads";

type DoneState = "completed" | "cancelled" | "interrupted";

function createDownloadItem(
  url: string,
  initialState: "progressing" | "interrupted" = "progressing",
) {
  let finish: ((event: unknown, state: DoneState) => void) | null = null;
  const item = {
    savePath: null as string | null,
    getURLChain: () => [url],
    getState: () => initialState,
    setSavePath: (value: string) => {
      item.savePath = value;
    },
    once: (_event: "done", listener: (event: unknown, state: DoneState) => void) => {
      finish = listener;
      return item;
    },
    finish: (state: DoneState) => finish?.({}, state),
  } satisfies DownloadItemHandle & Record<string, unknown>;
  return item;
}

function createSource() {
  const listeners: Array<(event: unknown, item: DownloadItemHandle) => void> = [];
  const requested: Array<{ url: string; headers?: Record<string, string> }> = [];
  const source: DownloadSource = {
    session: {
      on: (_event, listener) => {
        listeners.push(listener);
      },
    },
    downloadURL: (url, options) => {
      requested.push({ url, ...(options?.headers ? { headers: options.headers } : {}) });
    },
  };
  return {
    source,
    requested,
    listenerCount: () => listeners.length,
    emitWillDownload: (item: DownloadItemHandle) => {
      for (const listener of listeners) listener({}, item);
    },
  };
}

const DOWNLOAD_URL = "https://paseo.example.com/api/files/download?token=abc";

describe("app downloads", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "paseo-downloads-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function createDownloads() {
    return createAppDownloads({ directory: () => directory, exists: existsSync });
  }

  it("saves its own download into the downloads folder without a dialog", async () => {
    const downloads = createDownloads();
    const { source, requested, emitWillDownload } = createSource();

    const result = downloads.start(source, { url: DOWNLOAD_URL, fileName: "plan.md" });
    const item = createDownloadItem(DOWNLOAD_URL);
    emitWillDownload(item);
    item.finish("completed");

    await expect(result).resolves.toEqual({
      state: "completed",
      path: join(directory, "plan.md"),
    });
    expect(item.savePath).toBe(join(directory, "plan.md"));
    expect(requested).toEqual([{ url: DOWNLOAD_URL }]);
  });

  it("forwards request headers to the download", async () => {
    const downloads = createDownloads();
    const { source, requested, emitWillDownload } = createSource();

    const result = downloads.start(source, {
      url: DOWNLOAD_URL,
      fileName: "plan.md",
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    const item = createDownloadItem(DOWNLOAD_URL);
    emitWillDownload(item);
    item.finish("completed");

    await expect(result).resolves.toEqual({
      state: "completed",
      path: join(directory, "plan.md"),
    });
    expect(requested).toEqual([
      { url: DOWNLOAD_URL, headers: { Authorization: "Basic dXNlcjpwYXNz" } },
    ]);
  });

  it("keeps an existing file and saves next to it", async () => {
    await writeFile(join(directory, "plan.md"), "old");
    const downloads = createDownloads();
    const { source, emitWillDownload } = createSource();

    const result = downloads.start(source, { url: DOWNLOAD_URL, fileName: "plan.md" });
    const item = createDownloadItem(DOWNLOAD_URL);
    emitWillDownload(item);
    item.finish("completed");

    await expect(result).resolves.toEqual({
      state: "completed",
      path: join(directory, "plan (1).md"),
    });
  });

  it("gives concurrent downloads of one file distinct paths", async () => {
    const downloads = createDownloads();
    const { source, emitWillDownload } = createSource();
    const secondUrl = "https://paseo.example.com/api/files/download?token=def";

    const first = downloads.start(source, { url: DOWNLOAD_URL, fileName: "plan.md" });
    const second = downloads.start(source, { url: secondUrl, fileName: "plan.md" });
    const firstItem = createDownloadItem(DOWNLOAD_URL);
    const secondItem = createDownloadItem(secondUrl);
    emitWillDownload(firstItem);
    emitWillDownload(secondItem);
    firstItem.finish("completed");
    secondItem.finish("completed");

    await expect(first).resolves.toEqual({
      state: "completed",
      path: join(directory, "plan.md"),
    });
    await expect(second).resolves.toEqual({
      state: "completed",
      path: join(directory, "plan (1).md"),
    });
  });

  it("reports a download that fails before any response", async () => {
    const downloads = createDownloads();
    const { source, emitWillDownload } = createSource();

    const result = downloads.start(source, { url: DOWNLOAD_URL, fileName: "plan.md" });
    emitWillDownload(createDownloadItem(DOWNLOAD_URL, "interrupted"));

    await expect(result).resolves.toEqual({
      state: "interrupted",
      path: join(directory, "plan.md"),
    });
  });

  it("reports an interrupted download", async () => {
    const downloads = createDownloads();
    const { source, emitWillDownload } = createSource();

    const result = downloads.start(source, { url: DOWNLOAD_URL, fileName: "plan.md" });
    const item = createDownloadItem(DOWNLOAD_URL);
    emitWillDownload(item);
    item.finish("interrupted");

    await expect(result).resolves.toEqual({
      state: "interrupted",
      path: join(directory, "plan.md"),
    });
  });

  it("leaves downloads it did not start to Electron", () => {
    const downloads = createDownloads();
    const { source, emitWillDownload } = createSource();

    void downloads.start(source, { url: DOWNLOAD_URL, fileName: "plan.md" });
    const unrelated = createDownloadItem("https://example.com/image.png");
    emitWillDownload(unrelated);

    expect(unrelated.savePath).toBeNull();
  });

  it("listens to each session once", () => {
    const downloads = createDownloads();
    const { source, listenerCount } = createSource();

    void downloads.start(source, { url: DOWNLOAD_URL, fileName: "a.md" });
    void downloads.start(source, {
      url: "https://paseo.example.com/api/files/download?token=def",
      fileName: "b.md",
    });

    expect(listenerCount()).toBe(1);
  });
});

describe("parseDownloadRequest", () => {
  it.each(["file:///etc/passwd", "javascript:alert(1)", "paseo://app/", "not a url"])(
    "rejects %s",
    (url) => {
      expect(() => parseDownloadRequest({ url, fileName: "x" })).toThrow();
    },
  );

  it("rejects non-string headers", () => {
    expect(() =>
      parseDownloadRequest({ url: DOWNLOAD_URL, fileName: "x", headers: { Authorization: 1 } }),
    ).toThrow("Download headers must be strings.");
  });
});

describe("resolveDownloadPath", () => {
  it.each([
    ["../../.bashrc", ".._.._.bashrc"],
    ["..", "download"],
    ["  ", "download"],
    ["a/b\\c:d.txt", "a_b_c_d.txt"],
  ])("keeps %s inside the downloads folder", (fileName, expected) => {
    expect(resolveDownloadPath("/downloads", fileName, () => false)).toBe(
      join("/downloads", expected),
    );
  });
});
