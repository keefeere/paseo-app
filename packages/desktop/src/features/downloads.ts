import path from "node:path";

// App downloads run through main so the app window never navigates to a daemon
// URL. Navigating the app window to a download hands it to Electron's default
// flow, a save dialog parented to that window; on Linux that left the window
// blank and closable only from the taskbar. Claimed downloads go straight to the
// Downloads folder.
//
// Electron reports a download only once the response headers arrive. An endpoint
// that never answers (an unreachable address, a stalled TLS handshake) produces
// no event at all, so a request that gets no response in time is reported as
// unreachable instead of leaving the caller waiting for the TCP timeout.

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;

type DownloadState = "progressing" | "completed" | "cancelled" | "interrupted";
type DownloadDoneState = Exclude<DownloadState, "progressing">;

export interface DownloadItemHandle {
  getURLChain(): string[];
  getState(): DownloadState;
  setSavePath(path: string): void;
  cancel(): void;
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
  state: DownloadDoneState | "unreachable";
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

function describeUrl(url: string): string {
  const { protocol, host, pathname } = new URL(url);
  return `${protocol}//${host}${pathname}`;
}

export function createAppDownloads(deps: {
  directory: () => string;
  exists: (candidate: string) => boolean;
  responseTimeoutMs?: number;
  log?: (message: string) => void;
}) {
  const responseTimeoutMs = deps.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
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
    const target = describeUrl(request.url);
    deps.log?.(`download requested (${target})`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = new Promise<DesktopDownloadResult>((resolve) => {
      pending.set(request.url, (item) => {
        clearTimeout(timer);
        const savePath = resolveDownloadPath(
          deps.directory(),
          request.fileName,
          (candidate) => reserved.has(candidate) || deps.exists(candidate),
        );
        item.setSavePath(savePath);
        // A request that fails before any response arrives is created already
        // interrupted and never emits "done".
        if (item.getState() === "interrupted") {
          deps.log?.(`download failed before a response (${target})`);
          resolve({ state: "interrupted", path: savePath });
          return;
        }
        reserved.add(savePath);
        item.once("done", (_event, state) => {
          reserved.delete(savePath);
          deps.log?.(`download ${state} (${target})`);
          resolve({ state, path: savePath });
        });
      });
    });
    const silence = new Promise<DesktopDownloadResult>((resolve) => {
      timer = setTimeout(() => {
        // The query carries a one-shot token, so a response that arrives after
        // the caller gave up is cancelled rather than handed to Electron's dialog.
        pending.set(request.url, (item) => item.cancel());
        deps.log?.(`download got no response in ${responseTimeoutMs}ms (${target})`);
        resolve({ state: "unreachable", path: "" });
      }, responseTimeoutMs);
    });
    source.downloadURL(request.url, request.headers ? { headers: request.headers } : undefined);
    return Promise.race([response, silence]);
  }

  return { start };
}
