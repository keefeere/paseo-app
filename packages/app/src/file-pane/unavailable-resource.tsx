import { buildAbsoluteExplorerPath } from "@/utils/explorer-paths";
import { useCallback } from "react";
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
  resource,
}: {
  serverId: string;
  cwd: string;
  resource: FilePreviewUnavailable;
}) {
  const { t } = useTranslation();
  const { openPreferredTarget } = usePaneContext();
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
  if (resource.reason === "directory") {
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
