import { getDesktopHost } from "@/desktop/host";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useFileDownload } from "@/hooks/use-file-download";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { usePaneContext } from "@/panels/pane-context";
import {
  openDesktopTarget,
  useDesktopOpenTargets,
  type DesktopOpenTarget,
} from "@/workspace/desktop-open-targets";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";

interface ResourceActionsProps {
  serverId: string;
  cwd: string;
  path: string;
  directory?: boolean;
  downloadable?: boolean;
}

function OpenTargetItem({
  target,
  onOpen,
  disabled,
}: {
  target: DesktopOpenTarget;
  onOpen: (target: DesktopOpenTarget) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const open = useStableEvent(() => onOpen(target));
  return (
    <DropdownMenuItem disabled={disabled} onSelect={open}>
      {t("workspace.fileActions.openIn", { target: target.label })}
    </DropdownMenuItem>
  );
}

export function ResourceActions({
  serverId,
  cwd,
  path,
  directory = false,
  downloadable = true,
}: ResourceActionsProps) {
  const { t } = useTranslation();
  const { openPreferredTarget } = usePaneContext();
  const isLocalExecution = useIsLocalDaemon(serverId);
  const { targets } = useDesktopOpenTargets({ isLocalExecution });
  const download = useFileDownload({ serverId, workspaceRoot: cwd });
  const resolved = resolveWorkspaceFilePaths({ path, workspaceRoot: cwd });
  const absolutePath = directory ? cwd : resolved?.absolutePath;
  const openLocalPath = isLocalExecution ? getDesktopHost()?.opener?.openPath : undefined;
  const action = useMutation({
    mutationFn: async (target: DesktopOpenTarget | "copy" | "system") => {
      if (target === "copy") {
        await Clipboard.setStringAsync(absolutePath ?? path);
        return;
      }
      if (!absolutePath) return;
      if (target === "system") {
        if (!openLocalPath) throw new Error("System file opening is unavailable");
        await openLocalPath(absolutePath);
        return;
      }
      await openDesktopTarget({
        editorId: target.id,
        workspacePath: cwd,
        ...(directory ? {} : { filePath: absolutePath }),
      });
    },
  });
  const parentPath = containingDirectory(absolutePath);
  const downloadFile = useStableEvent(() =>
    download({ path, fileName: path.split(/[\\/]/).pop() || path }),
  );
  const showParent = useStableEvent(() => {
    if (parentPath) openPreferredTarget({ kind: "file", path: parentPath }, "chatFiles");
  });
  const openSystem = useStableEvent(() => action.mutate("system"));
  const copyPath = useStableEvent(() => action.mutate("copy"));
  const openTarget = useStableEvent((target: DesktopOpenTarget) => action.mutate(target));
  return (
    <View style={styles.container} testID="resource-actions">
      <View style={styles.row}>
        {!directory && downloadable ? (
          <Button size="sm" variant="outline" testID="resource-download" onPress={downloadFile}>
            {t("workspace.fileActions.download")}
          </Button>
        ) : null}
        {parentPath && parentPath !== absolutePath ? (
          <Button size="sm" variant="outline" testID="resource-parent" onPress={showParent}>
            {t("panels.file.showDirectory")}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            style={styles.trigger}
            disabled={action.isPending}
            testID="resource-menu"
          >
            <Text style={styles.text}>
              {action.isPending ? t("common.loading") : t("panels.file.resourceActions")}
            </Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {openLocalPath && absolutePath ? (
              <DropdownMenuItem disabled={action.isPending} onSelect={openSystem}>
                {t("common.links.open")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={copyPath} disabled={action.isPending}>
              {t("workspace.fileActions.copyPath")}
            </DropdownMenuItem>
            {absolutePath
              ? targets.map((target) => (
                  <OpenTargetItem
                    key={target.id}
                    target={target}
                    onOpen={openTarget}
                    disabled={action.isPending}
                  />
                ))
              : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {action.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error.message}
        </Text>
      ) : null}
      {action.isSuccess && action.variables === "copy" ? (
        <Text style={styles.text}>{t("common.states.copied")}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing[2],
  },
  container: { gap: theme.spacing[2], padding: theme.spacing[3] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], alignItems: "center" },
  text: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));

function containingDirectory(path: string | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) return null;
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return null;
  const parent = normalized.slice(0, slash) || "/";
  return /^[A-Za-z]:$/.test(parent) ? `${parent}/` : parent;
}
