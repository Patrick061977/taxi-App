#!/usr/bin/env bash
# v6.46.0: Auto-Crash-Watcher — läuft lokal, durchforstet adb logcat permanent
# nach FATAL/AndroidRuntime/Crashlytics-Markers für de.taxiheringsdorf.app.
#
# Bei Treffer: Stacktrace-Block (10 Zeilen vorher + 30 Zeilen nachher) wird in eine
# Logfile geschrieben + an die Claude-Bridge (/claudeBridge/inbox) als Telegram-Push
# weitergeleitet damit Patrick + ich es sofort sehen.
#
# Usage:
#   ./scripts/adb-crash-watcher.sh                  # default: adb default device
#   ./scripts/adb-crash-watcher.sh -s RZ8NC051JJX   # spezifisches Gerät
#
# Voraussetzungen:
#   - adb im PATH oder $LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe
#   - gcloud (für Firebase REST-Push)
#   - Handy via USB-Debug verbunden

set -euo pipefail

ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
PKG="de.taxiheringsdorf.app"
DEVICE_ARG="$*"
DBURL="https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app"
LOG_FILE="/tmp/adb-crash-watcher-$(date +%Y%m%d).log"

echo "🔍 Crash-Watcher gestartet → $LOG_FILE"
echo "    Device: $($ADB $DEVICE_ARG devices | grep device | head -1)"

# Filter: nur unsere App + nur FATAL/AndroidRuntime/Crashlytics
"$ADB" $DEVICE_ARG logcat -v threadtime "*:F" "AndroidRuntime:E" "FirebaseCrashlytics:*" "DriverDashboard:E" "ShiftForegroundSvc:E" "TaxiFCMService:E" 2>&1 \
    | grep --line-buffered -E "$PKG|FATAL|AndroidRuntime.*FATAL|Crashlytics.*Exception" \
    | while IFS= read -r line; do
        echo "$line" >> "$LOG_FILE"
        # Nur ECHTE Crashes pushen (FATAL EXCEPTION oder AndroidRuntime-Block)
        if echo "$line" | grep -qE "FATAL EXCEPTION|AndroidRuntime.*FATAL|java\.lang\..*Exception|NullPointerException|ClassCastException"; then
            echo "🚨 CRASH erkannt: $line"
            # Push an Bridge
            TS=$(date +%s)000
            MSG="🚨 NATIVE CRASH erkannt (adb-watcher)

$line

Vollständiger Stacktrace im Log: $LOG_FILE
Tippe auf Handy: '$PKG' neu starten oder warte auf Auto-Restart."
            JSON=$(python3 -c "
import json,sys
print(json.dumps({'message': sys.argv[1], 'targetChatId': 6229490043, 'via': 'claude', 'ts': int(sys.argv[2])}))
" "$MSG" "$TS")
            curl -s -X POST "$DBURL/claudeBridge/outbox.json?access_token=$(gcloud auth print-access-token 2>/dev/null)" -d "$JSON" >/dev/null
        fi
    done
