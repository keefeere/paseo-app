import {
  FilePreviewUnavailableError,
  type DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import { resolveFilePreviewReadTarget } from "@/file-explorer/preview-target";

/** Paths that can plausibly name a directory: a trailing slash, or a last segment without an extension. */
export function mayBeDirectoryPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/");
  if (normalized.endsWith("/")) return true;
  const lastSegment = normalized.split("/").findLast(Boolean) ?? "";
  return lastSegment.length > 0 && !lastSegment.slice(1).includes(".");
}

/**
 * Asks the daemon whether a link target is a directory before a tab exists for it. The
 * one-byte budget makes the daemon answer with metadata for directories and larger files
 * without transferring any contents. Returns the canonical directory path, or null for
 * anything that is not a directory.
 */
export async function probeDirectory(input: {
  client: Pick<DaemonClient, "readFile">;
  workspaceRoot: string;
  path: string;
}): Promise<string | null> {
  if (!mayBeDirectoryPath(input.path)) return null;
  const target = resolveFilePreviewReadTarget({
    path: input.path,
    workspaceRoot: input.workspaceRoot,
  });
  if (!target) return null;
  try {
    await input.client.readFile(target.cwd, target.path, undefined, 1);
    return null;
  } catch (error) {
    if (error instanceof FilePreviewUnavailableError && error.resource.reason === "directory") {
      return error.resource.path;
    }
    return null;
  }
}
