// Web/browser stand-in for react-native's ToastAndroid. Callers gate on `Platform.OS === "android"`,
// so this is never invoked; it exists so web bundles and the browser test project never pull
// react-native's Android-only module into a graph that also runs in a browser.
export const ToastAndroid = {
  SHORT: 1500,
  LONG: 3900,
  TOP: 49,
  BOTTOM: 81,
  CENTER: 17,
  show(_message: string, _duration?: number): void {},
  showWithGravity(_message: string, _duration?: number, _gravity?: number): void {},
  showWithGravityAndOffset(
    _message: string,
    _duration?: number,
    _gravity?: number,
    _xOffset?: number,
    _yOffset?: number,
  ): void {},
};
