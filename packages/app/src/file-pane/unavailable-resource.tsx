import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { useCallback, useLayoutEffect, useState } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { revealDirectoryInExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { FilePreviewUnavailable } from "@getpaseo/protocol/messages";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { usePaneContext } from "@/panels/pane-context";
import { ResourceActions } from "./resource-actions";

export function UnavailableResource({
  serverId,
  cwd,
  requestedPath,
  resource,
}: {
  serverId: string;
  cwd: string;
  /** The path the tab asked for; `resource.path` is canonical and may leave a symlinked root. */
  requestedPath: string;
  resource: FilePreviewUnavailable;
}) {
  const { t } = useTranslation();
  const { openPreferredTarget, workspaceId, closeCurrentTab } = usePaneContext();
  const isCompact = useIsCompactFormFactor();
  const workspaceRoot = useWorkspaceDirectory(serverId, workspaceId);
  const isDirectory = resource.reason === "directory";
  const [revealedInSidebar, setRevealedInSidebar] = useState(false);
  // A workspace directory belongs in the sidebar tree, so the tab that discovered it closes.
  useLayoutEffect(() => {
    if (!isDirectory || !workspaceRoot) return;
    const absoluteRequestedPath = buildAbsoluteExplorerPath({
      workspaceRoot: cwd,
      entryPath: requestedPath,
    });
    const revealed = [absoluteRequestedPath, resource.path].some((path) =>
      revealDirectoryInExplorerSidebar({ isCompact, serverId, workspaceId, workspaceRoot, path }),
    );
    if (!revealed) return;
    setRevealedInSidebar(true);
    closeCurrentTab();
  }, [
    closeCurrentTab,
    cwd,
    isCompact,
    isDirectory,
    requestedPath,
    resource.path,
    serverId,
    workspaceId,
    workspaceRoot,
  ]);
  const openFile = useCallback(
    (path: string) => {
      const absolutePath = buildAbsoluteExplorerPath({
        workspaceRoot: resource.path,
        entryPath: path,
      });
      openPreferredTarget({ kind: "file", path: absolutePath }, "explorerFiles");
    },
    [resource.path, openPreferredTarget],
  );
  if (revealedInSidebar) return null;
  if (isDirectory) {
    return (
      <View style={styles.container} testID="directory-resource">
        <ResourceActions serverId={serverId} cwd={resource.path} path={resource.path} directory />
        <FileExplorerPane
          key={resource.path}
          serverId={serverId}
          workspaceRoot={resource.path}
          onOpenFile={openFile}
        />
      </View>
    );
  }
  const message =
    resource.reason === "too_large"
      ? t("panels.file.tooLargeToDisplay")
      : t("panels.file.binaryPreviewUnavailable");
  return (
    <View style={styles.container} testID="file-preview-unavailable">
      <ResourceActions
        serverId={serverId}
        cwd={cwd}
        path={resource.path}
        downloadable={resource.mimeType !== "inode/special"}
      />
      <View style={styles.center}>
        <Text style={styles.text}>{message}</Text>
        <Text selectable style={styles.text}>
          {resource.path}
        </Text>
        <Text style={styles.text}>
          {resource.mimeType} · {resource.size.toLocaleString()} B
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base, textAlign: "center" },
}));
