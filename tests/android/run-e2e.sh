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

# Prove it works fully offline.
adb shell cmd connectivity airplane-mode enable || adb shell settings put global airplane_mode_on 1
adb shell settings get global airplane_mode_on > "$OUT/airplane_mode.txt"

adb logcat -c
maestro test flow.yaml --format junit --output "$OUT/report.xml" --test-output-dir "$OUT/maestro" 2>&1 | tee "$OUT/maestro.log"
RC=${PIPESTATUS[0]}

adb shell cmd uimode night yes || true
maestro test dark.yaml --test-output-dir "$OUT/maestro-dark" 2>&1 | tee "$OUT/maestro-dark.log" || true

adb logcat -d > "$OUT/logcat.txt"
grep -nE "FATAL EXCEPTION|AndroidRuntime: |ReactNativeJS.*(Error|Exception)" "$OUT/logcat.txt" > "$OUT/crashes.txt" || true
find . "$OUT" -name "*.png" -newer "$OUT/install.txt" -exec cp {} "$OUT/" \; 2>/dev/null || true
echo "maestro exit=$RC crashes=$(wc -l < "$OUT/crashes.txt")" | tee "$OUT/summary.txt"
exit $RC
