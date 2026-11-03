import { useCallback, useMemo, useRef } from "react";
import {
  PanResponder,
  View,
  type LayoutChangeEvent,
  type AccessibilityActionEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SliderProps } from "./slider-types";

export function Slider(props: SliderProps) {
  const current = useRef(props);
  current.current = props;
  const width = useRef(1);
  const start = useRef(0);
  const latestValue = useRef(props.value);
  const responder = useMemo(() => {
    const setPosition = (x: number) => {
      const p = current.current;
      const step = p.step ?? 1;
      const raw = p.minimumValue + (x / width.current) * (p.maximumValue - p.minimumValue);
      const value = Math.max(
        p.minimumValue,
        Math.min(p.maximumValue, p.minimumValue + Math.round((raw - p.minimumValue) / step) * step),
      );
      latestValue.current = value;
      p.onValueChange(value);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        start.current = event.nativeEvent.locationX;
        setPosition(start.current);
      },
      onPanResponderMove: (_event, gesture) => setPosition(start.current + gesture.dx),
      onPanResponderRelease: () => current.current.onSlidingComplete(latestValue.current),
      onPanResponderTerminate: () => current.current.onSlidingComplete(latestValue.current),
    });
  }, []);
  const percent =
    ((props.value - props.minimumValue) / (props.maximumValue - props.minimumValue)) * 100;
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    width.current = Math.max(1, event.nativeEvent.layout.width);
  }, []);
  const accessibilityValue = useMemo(
    () => ({
      min: props.minimumValue,
      max: props.maximumValue,
      now: props.value,
      text: `${props.value}%`,
    }),
    [props.minimumValue, props.maximumValue, props.value],
  );
  const adjust = useCallback((event: AccessibilityActionEvent) => {
    const p = current.current;
    const value = Math.max(
      p.minimumValue,
      Math.min(
        p.maximumValue,
        p.value + (event.nativeEvent.actionName === "increment" ? 1 : -1) * (p.step ?? 1),
      ),
    );
    p.onValueChange(value);
    p.onSlidingComplete(value);
  }, []);
  return (
    <View
      {...responder.panHandlers}
      style={styles.control}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityValue={accessibilityValue}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={adjust}
    >
      <View pointerEvents="none" style={styles.track} />
      <View pointerEvents="none" style={[styles.thumb, { left: `${percent}%` }]} />
    </View>
  );
}
const ACTIONS = [{ name: "increment" }, { name: "decrement" }];
const styles = StyleSheet.create((theme) => ({
  control: { width: "100%", height: 44, justifyContent: "center" },
  track: { height: 4, backgroundColor: theme.colors.border, borderRadius: 2 },
  thumb: {
    position: "absolute",
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: theme.colors.accentBright,
  },
}));
