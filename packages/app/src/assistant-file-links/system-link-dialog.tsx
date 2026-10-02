import { useRetainedPanelActive } from "@/components/retained-panel";
import { useMemo } from "react";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { parseExternalUrl } from "@getpaseo/protocol/external-url";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { openSystemUrl } from "@/utils/open-external-url";

export default function SystemLinkDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation();
  const active = useRetainedPanelActive();
  const supported = parseExternalUrl(url) !== null;
  const action = useMutation({
    mutationFn: async (kind: "open" | "copy") => {
      if (kind === "copy") await Clipboard.setStringAsync(url);
      else await openSystemUrl(url);
    },
  });
  const header = useMemo(() => ({ title: t("common.links.title") }), [t]);
  const open = useStableEvent(() => action.mutate("open"));
  const copy = useStableEvent(() => action.mutate("copy"));
  return (
    <AdaptiveModalSheet
      visible={active}
      onClose={onClose}
      header={header}
      testID="system-link-dialog"
    >
      <View style={styles.body}>
        <Text selectable style={styles.text}>
          {url}
        </Text>
        <Text style={styles.text}>
          {supported ? t("common.links.systemHandler") : t("common.links.unsupported")}
        </Text>
        <View style={styles.actions}>
          {supported ? (
            <Button
              variant="outline"
              disabled={action.isPending}
              loading={action.isPending && action.variables === "open"}
              onPress={open}
              testID="system-link-open"
            >
              {t("common.links.open")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={action.isPending}
            onPress={copy}
            testID="system-link-copy"
          >
            {t("common.links.copy")}
          </Button>
        </View>
        {action.isError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {t("common.links.failed")} {action.error.message}
          </Text>
        ) : null}
        {action.isSuccess ? (
          <Text style={styles.text}>
            {action.variables === "copy" ? t("common.states.copied") : t("common.links.opened")}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { padding: theme.spacing[4], gap: theme.spacing[3] },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
}));
