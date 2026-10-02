import { isAbsolutePath } from "./path";

interface BuildAbsoluteExplorerPathInput {
  workspaceRoot: string;
  entryPath: string;
}

export function buildAbsoluteExplorerPath({
  workspaceRoot,
  entryPath,
}: BuildAbsoluteExplorerPathInput): string {
  const trimmedRoot = workspaceRoot.trim();
  const isFilesystemRoot = trimmedRoot === "/" || /^[A-Za-z]:[\\/]$/.test(trimmedRoot);
  const normalizedWorkspaceRoot = isFilesystemRoot
    ? trimmedRoot
    : trimmedRoot.replace(/[\\/]+$/, "");
  const normalizedEntryPath = entryPath.trim();

  if (!normalizedWorkspaceRoot) {
    return normalizedEntryPath;
  }

  if (!normalizedEntryPath || normalizedEntryPath === ".") {
    return normalizedWorkspaceRoot;
  }

  if (isAbsolutePath(normalizedEntryPath)) {
    return normalizedEntryPath;
  }

  const separator = normalizedWorkspaceRoot.includes("\\") ? "\\" : "/";
  const segments = normalizedEntryPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) {
    return normalizedWorkspaceRoot;
  }

  const prefix = normalizedWorkspaceRoot.endsWith(separator)
    ? normalizedWorkspaceRoot
    : `${normalizedWorkspaceRoot}${separator}`;
  return `${prefix}${segments.join(separator)}`;
}

export function parentExplorerPath(entryPath: string): string {
  const separatorIndex = entryPath.lastIndexOf("/");
  return separatorIndex > 0 ? entryPath.slice(0, separatorIndex) : ".";
}
