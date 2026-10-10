export const MIN_SPACING_PERCENT = 50;
export const MIN_TEXT_SPACING_PERCENT = 0;
export const MIN_TEXT_LINE_HEIGHT_PERCENT = 110;
export const MAX_TEXT_LINE_HEIGHT_PERCENT = 180;
export const MAX_UI_SPACING_PERCENT = 125;
export const MAX_TEXT_SPACING_PERCENT = 150;

// Compact prose needs less block whitespace without squeezing its glyph line box.
export function textSpacingScale(percent: number): number {
  const ratio = percent / 100;
  return ratio < 1 ? ratio * ratio : ratio;
}

export function proseLineHeight(percent: number): number {
  return Math.max(1.3, 1 + 0.4 * textSpacingScale(percent));
}
