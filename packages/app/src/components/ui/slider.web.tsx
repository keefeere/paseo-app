import { useCallback, useMemo, type CSSProperties, type SyntheticEvent } from "react";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import type { SliderProps } from "./slider-types";

function SliderBase({
  value,
  minimumValue,
  maximumValue,
  step = 1,
  accessibilityLabel,
  onValueChange,
  onSlidingComplete,
  accentColor,
}: SliderProps & { accentColor?: string }) {
  const style = useMemo<CSSProperties>(
    () => ({
      width: "100%",
      margin: 0,
      height: 32,
      cursor: "pointer",
      accentColor,
    }),
    [accentColor],
  );
  const change = useCallback(
    (event: SyntheticEvent<HTMLInputElement>) => onValueChange(Number(event.currentTarget.value)),
    [onValueChange],
  );
  const complete = useCallback(
    (event: SyntheticEvent<HTMLInputElement>) =>
      onSlidingComplete(Number(event.currentTarget.value)),
    [onSlidingComplete],
  );
  return (
    <input
      type="range"
      aria-label={accessibilityLabel}
      aria-valuetext={`${value}%`}
      min={minimumValue}
      max={maximumValue}
      step={step}
      value={value}
      style={style}
      onChange={change}
      onPointerUp={complete}
      onKeyUp={complete}
      onBlur={complete}
    />
  );
}

const ThemedSlider = withUnistyles(SliderBase);
const sliderTheme = (theme: Theme) => ({ accentColor: theme.colors.accentBright });
export function Slider(props: SliderProps) {
  return <ThemedSlider {...props} uniProps={sliderTheme} />;
}
