import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { markdownCopyImageSourcesDataSet } from "@/assistant-selection-copy/markup";
import { isWeb } from "@/constants/platform";
import { density } from "@/styles/density";
import { SPACING } from "@/styles/theme";

/** Stacks Markdown blocks rendered as separate views with the same gap the text puts between its blocks. */
export function MarkdownBlockStack({
  imageSources,
  children,
}: {
  imageSources?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <View
      style={styles.stack}
      dataSet={isWeb && imageSources ? markdownCopyImageSourcesDataSet(imageSources) : undefined}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => {
  const ratio = theme.textSpacing[4] / SPACING[4];
  return {
    stack: { gap: { xs: density.blockGap.xs * ratio, md: density.blockGap.md * ratio } },
  };
});
