import path from "node:path";

// App downloads run through main so the app window never navigates to a daemon
// URL. Navigating the app window to a download hands it to Electron's default
// flow, a save dialog parented to that window; on Linux that left the window
// blank and closable only from the taskbar. Claimed downloads go straight to the
// Downloads folder.

type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";
type DownloadDoneState = Exclude<DownloadState, "progressing">;

export interface DownloadItemHandle {
  getURLChain(): string[];
  getState(): DownloadState;
  setSavePath(path: string): void;
  once(event: "done", listener: (event: unknown, state: DownloadDoneState) => void): unknown;
}

interface DownloadSession {
  on(event: "will-download", listener: (event: unknown, item: DownloadItemHandle) => void): unknown;
}

export interface DownloadSource {
  readonly session: DownloadSession;
  downloadURL(url: string, options?: { headers?: Record<string, string> }): void;
}

export interface DesktopDownloadRequest {
  url: string;
  fileName: string;
  headers?: Record<string, string>;
}

export interface DesktopDownloadResult {
  state: DownloadDoneState;
  path: string;
}

export function parseDownloadRequest(input: unknown): DesktopDownloadRequest {
  if (!input || typeof input !== "object") {
    throw new Error("A download request is required.");
  }
  const { url, fileName, headers } = input as Record<string, unknown>;
  if (typeof url !== "string" || !URL.canParse(url)) {
    throw new Error("A download URL is required.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https downloads are supported.");
  }
  if (typeof fileName !== "string") {
    throw new Error("A download file name is required.");
  }
  if (headers === undefined) {
    return { url: parsed.href, fileName };
  }
  if (
    !headers ||
    typeof headers !== "object" ||
    Object.values(headers).some((value) => typeof value !== "string")
  ) {
    throw new Error("Download headers must be strings.");
  }
  return { url: parsed.href, fileName, headers: headers as Record<string, string> };
}

export function resolveDownloadPath(
  directory: string,
  fileName: string,
  exists: (candidate: string) => boolean,
): string {
  const cleaned = fileName
    .replaceAll("\0", "_")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  const safeName = cleaned === "" || cleaned === "." || cleaned === ".." ? "download" : cleaned;
  const ext = path.extname(safeName);
  const base = safeName.slice(0, safeName.length - ext.length);
  let candidate = path.join(directory, safeName);
  for (let suffix = 1; exists(candidate); suffix += 1) {
    candidate = path.join(directory, `${base} (${suffix})${ext}`);
  }
  return candidate;
}

export function createAppDownloads(deps: {
  directory: () => string;
  exists: (candidate: string) => boolean;
}) {
  const pending = new Map<string, (item: DownloadItemHandle) => void>();
  // Chromium writes under a temporary name until the download finishes, so a
  // second download of the same file would not see the first one on disk yet.
  const reserved = new Set<string>();
  const watchedSessions = new WeakSet<DownloadSession>();

  function claim(item: DownloadItemHandle): boolean {
    const url = item.getURLChain()[0];
    const take = url === undefined ? undefined : pending.get(url);
    if (!url || !take) return false;
    pending.delete(url);
    take(item);
    return true;
  }

  function watch(session: DownloadSession): void {
    if (watchedSessions.has(session)) return;
    watchedSessions.add(session);
    session.on("will-download", (_event, item) => {
      claim(item);
    });
  }

  function start(source: DownloadSource, input: unknown): Promise<DesktopDownloadResult> {
    const request = parseDownloadRequest(input);
    watch(source.session);
    return new Promise((resolve) => {
      pending.set(request.url, (item) => {
        const savePath = resolveDownloadPath(
          deps.directory(),
          request.fileName,
          (candidate) => reserved.has(candidate) || deps.exists(candidate),
        );
        item.setSavePath(savePath);
        // A request that fails before any response arrives is created already
        // interrupted and never emits "done".
        if (item.getState() === "interrupted") {
          resolve({ state: "interrupted", path: savePath });
          return;
        }
        reserved.add(savePath);
        item.once("done", (_event, state) => {
          reserved.delete(savePath);
          resolve({ state, path: savePath });
        });
      });
      source.downloadURL(request.url, request.headers ? { headers: request.headers } : undefined);
    });
  }

  return { start };
}
