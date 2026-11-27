#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$root/packages/app"
build_root="${RUNNER_TEMP:-$root/.dev}/paseo-ios-sidestore"
output_dir="$root/artifacts/ios-sidestore"

for command in node npm pod xcodebuild ditto ldid; do
  command -v "$command" >/dev/null || { echo "Missing required tool: $command" >&2; exit 1; }
done

mkdir -p "$build_root" "$output_dir"
cd "$root"
npm run build:app-deps
cd "$app"
CI=1 APP_VARIANT=sidestore npx expo prebuild --platform ios --clean --no-install
cd ios
pod install
xcodebuild \
  -workspace PaseoFork.xcworkspace \
  -scheme PaseoFork \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$build_root/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY='' \
  DEVELOPMENT_TEAM='' \
  clean build

bundle="$build_root/DerivedData/Build/Products/Release-iphoneos/PaseoFork.app"
plist="$bundle/Info.plist"
test -d "$bundle"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" = "com.keefeere.paseo"
schemes="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes' "$plist")"
grep -Fq 'exp+paseo-fork' <<< "$schemes"
if grep -Fq 'exp+voice-mobile' <<< "$schemes"; then
  echo "App Store Expo URL scheme leaked into the SideStore build" >&2
  exit 1
fi
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
test -f "$bundle/$executable"
ldid -S "$bundle/$executable"
rm -rf "$build_root/Payload"
mkdir -p "$build_root/Payload"
ditto "$bundle" "$build_root/Payload/PaseoFork.app"
ipa="$output_dir/PaseoFork-unsigned.ipa"
(cd "$build_root" && ditto -c -k --sequesterRsrc --keepParent Payload "$ipa")
(cd "$output_dir" && shasum -a 256 "$(basename "$ipa")" > "$(basename "$ipa").sha256")
echo "Unsigned IPA: $ipa"
