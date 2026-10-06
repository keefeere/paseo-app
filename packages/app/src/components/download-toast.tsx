import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Check, X, XCircle } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { getDesktopHost } from "@/desktop/host";
import { useDownloadStore, formatSpeed, formatEta, type Download } from "@/stores/download-store";
import { getAutoDismissDelayMs } from "@/stores/download-toast-policy";

function getDownloadStatusText(download: Download, t: TFunction): string {
  if (download.status === "downloading") {
    if (download.progress) {
      return `${Math.round(download.progress.percent * 100)}% · ${formatSpeed(download.progress.speed)} · ${formatEta(download.progress.eta)}`;
    }
    return t("common.states.starting");
  }
  if (download.status === "complete") {
    const complete = t("common.states.downloadComplete");
    return download.savedPath ? `${complete} · ${download.savedPath}` : complete;
  }
  return download.message ?? t("common.states.downloadFailed");
}

export function DownloadToast() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const downloads = useDownloadStore((state) => state.downloads);
  const activeDownloadId = useDownloadStore((state) => state.activeDownloadId);
  const dismissDownload = useDownloadStore((state) => state.dismissDownload);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openFailedFor, setOpenFailedFor] = useState<string | null>(null);

  const activeDownload = activeDownloadId ? downloads.get(activeDownloadId) : null;
  const savedPath = activeDownload?.status === "complete" ? activeDownload.savedPath : undefined;
  const opener = savedPath ? getDesktopHost()?.opener : undefined;

  useEffect(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
      dismissTimeoutRef.current = null;
    }

    const delay = activeDownload ? getAutoDismissDelayMs(activeDownload) : null;
    if (activeDownload && delay !== null) {
      dismissTimeoutRef.current = setTimeout(() => {
        dismissDownload(activeDownload.id);
      }, delay);
    }

    return () => {
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
      }
    };
  }, [activeDownload, dismissDownload]);

  const containerStyle = useMemo(
    () => [styles.container, { bottom: theme.spacing[4] + insets.bottom }],
    [theme.spacing, insets.bottom],
  );

  const handleDismiss = useCallback(() => {
    if (activeDownload) {
      dismissDownload(activeDownload.id);
    }
  }, [activeDownload, dismissDownload]);

  const runFileAction = useCallback(
    (action: ((path: string) => Promise<void>) | undefined) => {
      if (!activeDownload || !savedPath || !action) return;
      setOpenFailedFor(null);
      action(savedPath).catch(() => setOpenFailedFor(activeDownload.id));
    },
    [activeDownload, savedPath],
  );
  const handleOpen = useCallback(() => runFileAction(opener?.openPath), [opener, runFileAction]);
  const handleShowInFolder = useCallback(
    () => runFileAction(opener?.showItemInFolder),
    [opener, runFileAction],
  );

  if (!activeDownload) {
    return null;
  }

  return (
    <View style={containerStyle} pointerEvents="box-none">
      <View style={styles.toast}>
        {activeDownload.status === "downloading" ? (
          <LoadingSpinner size="small" color={theme.colors.foreground} />
        ) : null}
        {activeDownload.status === "complete" ? (
          <Check size={18} color={theme.colors.primary} />
        ) : null}
        {activeDownload.status !== "downloading" && activeDownload.status !== "complete" ? (
          <XCircle size={18} color={theme.colors.destructive} />
        ) : null}
        <View style={styles.textContainer}>
          <Text style={styles.fileName} numberOfLines={1}>
            {activeDownload.fileName}
          </Text>
          <Text style={styles.status}>
            {openFailedFor === activeDownload.id
              ? t("downloads.openFailed")
              : getDownloadStatusText(activeDownload, t)}
          </Text>
          {savedPath && opener ? (
            <View style={styles.actions}>
              {opener.openPath ? (
                <Button size="sm" variant="outline" testID="download-open" onPress={handleOpen}>
                  {t("downloads.open")}
                </Button>
              ) : null}
              {opener.showItemInFolder ? (
                <Button
                  size="sm"
                  variant="outline"
                  testID="download-show-in-folder"
                  onPress={handleShowInFolder}
                >
                  {t("downloads.showInFolder")}
                </Button>
              ) : null}
            </View>
          ) : null}
          {activeDownload.status === "downloading" && activeDownload.progress && (
            <View style={styles.progressBar}>
              <ProgressFill percent={activeDownload.progress.percent} />
            </View>
          )}
        </View>
        {activeDownload.status !== "downloading" && (
          <Pressable onPress={handleDismiss} hitSlop={8} style={styles.dismiss}>
            <X size={16} color={theme.colors.foregroundMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ProgressFill({ percent }: { percent: number }) {
  const width: `${number}%` = `${Math.round(percent * 100)}%`;
  const fillStyle = useMemo(() => [styles.progressFill, { width }], [width]);
  return <View style={fillStyle} />;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    left: theme.spacing[4],
    right: theme.spacing[4],
    zIndex: 1000,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    ...theme.shadow.md,
  },
  textContainer: {
    flex: 1,
    gap: theme.spacing[1],
  },
  fileName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  status: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  progressBar: {
    height: 3,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    marginTop: theme.spacing[1],
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.full,
  },
  dismiss: {
    padding: theme.spacing[1],
  },
}));
