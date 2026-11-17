import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@getpaseo/highlight";
import {
  DEFAULT_UI_FONT_STACK,
  DEFAULT_MONO_FONT_STACK,
  FONT_SIZE,
  SPACING,
  REGISTERED_THEMES,
  type Theme,
} from "@/styles/theme";
import { applyRootUiFont } from "./apply-root-font";
import { textSpacingScale } from "./spacing";

const ALL_THEME_KEYS = Object.keys(REGISTERED_THEMES) as (keyof typeof REGISTERED_THEMES)[];

export interface AppearanceInput {
  uiFontFamily: string; // "" -> default stack
  monoFontFamily: string; // "" -> default stack
  uiBaseFontSize: number; // already clamped
  contentFontSize: number; // already clamped
  uiSpacingPercent: number;
  textSpacingPercent: number;
  textLineHeightPercent: number;
  sidebarSpacingPercent: number;
  codeFontSize: number; // already clamped
  contentMaxWidth: number; // already clamped, default resolved
  syntaxTheme: SyntaxThemeId;
}

/**
 * Build the font-size ramp from the canonical `FONT_SIZE` ramp, scaled
 * proportionally from the requested base size so the type hierarchy is preserved
 * sizes. Deriving from the authored ramp — NOT the live (possibly already-scaled)
 * theme — makes `applyAppearance` idempotent: repeated applies never compound, and a
 * code-size change (base size unchanged) leaves the UI ramp at its authored values.
 * `code` is set absolutely to `codeSize`, never scaled by the UI factor — a separate
 * control on a separate semantic axis (mono/diff text).
 */
function scaleFontSize(
  uiBaseSize: number,
  contentSize: number,
  codeSize: number,
): Theme["fontSize"] {
  const r = uiBaseSize / FONT_SIZE.base;
  return {
    sm: Math.round(FONT_SIZE.sm * r),
    base: Math.round(FONT_SIZE.base * r),
    lg: Math.round(FONT_SIZE.lg * r),
    xl: Math.round(FONT_SIZE.xl * r),
    "2xl": Math.round(FONT_SIZE["2xl"] * r),
    "3xl": Math.round(FONT_SIZE["3xl"] * r),
    "4xl": Math.round(FONT_SIZE["4xl"] * r),
    content: contentSize, // absolute, NOT scaled
    code: codeSize, // absolute, NOT scaled
  };
}

/**
 * Patch every registered Unistyles theme with the user's appearance choices.
 * All keys in `ALL_THEME_KEYS` are patched because the active theme can change
 * and adaptive mode can flip light/dark — patching all keys keeps the active key
 * always current and makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant.
 *
 * The updater preserves the active theme wholesale (surfaces, accents,
 * terminal) and only patches the font ramp, content width, and syntax palette.
 * `updateTheme` replaces the stored theme rather than merging, so we spread
 * `...t` first.
 */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
  const diffLineHeight = Math.round(input.codeFontSize * 1.5); // couple to code size
  // Always scale the authored spacing so repeated updates never compound.
  const scaleSpacing = (percent: number): Theme["spacing"] =>
    Object.fromEntries(
      Object.entries(SPACING).map(([key, value]) => [key, (value * percent) / 100]),
    ) as Theme["spacing"];
  const spacing = scaleSpacing(input.uiSpacingPercent);
  const textSpacing = scaleSpacing(textSpacingScale(input.textSpacingPercent) * 100);
  const textLineHeight = input.textLineHeightPercent / 100;
  // The sidebar has its own spacing axis: `uiSpacingPercent` must not tighten it, and
  // `sidebarSpacingPercent` must not tighten the rest of the interface.
  const sidebarSpacing = scaleSpacing(input.sidebarSpacingPercent);
  const activeTheme = UnistylesRuntime.themeName;
  // Unistyles web emits after each registry patch. Updating the mounted theme
  // first ensures subscribers receive its new numeric tokens in this render;
  // updating it last makes Pure black appear one committed value behind.
  const themeKeys = activeTheme
    ? [activeTheme, ...ALL_THEME_KEYS.filter((key) => key !== activeTheme)]
    : ALL_THEME_KEYS;

  for (const key of themeKeys) {
    UnistylesRuntime.updateTheme(key, (t) => {
      const fontFamily = { ui, mono };
      const fontSize = scaleFontSize(
        input.uiBaseFontSize,
        input.contentFontSize,
        input.codeFontSize,
      );
      const lineHeight = { ...t.lineHeight, diff: diffLineHeight };
      // At zero, rows still keep 16px controls and a readable line box for the base font.
      // Compact breakpoints resolve their touch sizes from `density`, so these floors are
      // pointer-only.
      const sidebarRatio = Math.min(1, input.sidebarSpacingPercent / 100);
      const controlHeight = 16 + 8 * sidebarRatio;
      const sidebarLineHeight = Math.max(fontSize.base * 1.2, 14 + 6 * sidebarRatio);
      const sidebarRow = {
        controlHeight,
        lineHeight: sidebarLineHeight,
        // Navigation rows: 28px at 100%, one tight row of 16px at 0%.
        tightHeight: Math.max(16, 28 * sidebarRatio),
        minHeight:
          Math.max(
            fontSize.base * 1.4 * (0.75 + 0.25 * sidebarRatio),
            controlHeight,
            sidebarLineHeight,
          ) + sidebarSpacing[3],
      };

      if (t.colorScheme === "light") {
        return {
          ...t,
          spacing,
          textSpacing,
          sidebarSpacing,
          sidebarRow,
          textLineHeight,
          fontFamily,
          fontSize,
          lineHeight,
          contentMaxWidth: input.contentMaxWidth,
          colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
        };
      }
      return {
        ...t,
        spacing,
        textSpacing,
        sidebarSpacing,
        sidebarRow,
        textLineHeight,
        fontFamily,
        fontSize,
        lineHeight,
        contentMaxWidth: input.contentMaxWidth,
        colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
      };
    });
  }

  // Web: apply the UI font app-wide (RN-web stamps a default font on every text
  // element, so it can't be done through the theme alone). No-op on native.
  applyRootUiFont(ui);
}
