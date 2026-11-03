export interface SliderProps {
  value: number;
  minimumValue: number;
  maximumValue: number;
  step?: number;
  accessibilityLabel: string;
  onValueChange: (value: number) => void;
  onSlidingComplete: (value: number) => void;
}
