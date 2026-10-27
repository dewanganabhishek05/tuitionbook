#!/usr/bin/env bash
# Installs the APK on the running emulator, turns on airplane mode, runs the Maestro flows,
# and collects screenshots, logs and crash traces into /tmp/e2e.
set -u
APK="$1"
OUT=/tmp/e2e
mkdir -p "$OUT"
cd "$(dirname "$0")"

adb wait-for-device
adb install -r "$APK" | tee "$OUT/install.txt"
adb shell dumpsys package com.tuitionbook.app | grep -E "versionName|versionCode|permission" > "$OUT/package.txt" || true

# Slow CI emulators sometimes show "System UI / Launcher isn't responding" over the app: hide those.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put global anr_show_background 0 || true

# Prove it works fully offline.
adb shell cmd connectivity airplane-mode enable || adb shell settings put global airplane_mode_on 1
adb shell settings get global airplane_mode_on > "$OUT/airplane_mode.txt"

adb logcat -c
maestro test flow.yaml --format junit --output "$OUT/report.xml" --test-output-dir "$OUT/maestro" 2>&1 | tee "$OUT/maestro.log"
RC=${PIPESTATUS[0]}
if [ "$RC" -ne 0 ]; then
  # One retry, so an emulator hiccup isn't reported as an app failure (both logs are kept).
  echo "First attempt failed; retrying once" | tee "$OUT/retry.txt"
  maestro test flow.yaml --format junit --output "$OUT/report-retry.xml" --test-output-dir "$OUT/maestro-retry" 2>&1 | tee "$OUT/maestro-retry.log"
  RC=${PIPESTATUS[0]}
fi

# Upload-student-data flow: OCR of an image, a photo and a PDF pushed to Downloads. Run on its own so a
# system file-picker hiccup is reported separately.
adb shell mkdir -p /sdcard/Download
for f in assets/*; do
  adb push "$f" "/sdcard/Download/$(basename "$f")"
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$(basename "$f")" > /dev/null || true
done
maestro test import.yaml --format junit --output "$OUT/report-import.xml" --test-output-dir "$OUT/maestro-import" 2>&1 | tee "$OUT/maestro-import.log"
IMPORT_RC=${PIPESTATUS[0]}
echo "import-flow exit=$IMPORT_RC" | tee "$OUT/import-summary.txt"

adb shell cmd uimode night yes || true
maestro test dark.yaml --test-output-dir "$OUT/maestro-dark" 2>&1 | tee "$OUT/maestro-dark.log" || true

adb logcat -d > "$OUT/logcat.txt"
grep -nE "FATAL EXCEPTION|AndroidRuntime: |ReactNativeJS.*(Error|Exception)" "$OUT/logcat.txt" | grep -v "VM exiting" > "$OUT/crashes.txt" || true
find . "$OUT" -name "*.png" -newer "$OUT/install.txt" -exec cp {} "$OUT/" \; 2>/dev/null || true
echo "maestro exit=$RC import=$IMPORT_RC crashes=$(wc -l < "$OUT/crashes.txt")" | tee "$OUT/summary.txt"
exit $RC
