#!/usr/bin/env bash
# v6.46.0: Auto-Install-on-Merge — pollt GitHub Releases, installiert neue APK
# automatisch via ADB sobald sie da ist.
#
# Läuft als persistentes Skript:
#   - alle 30s: prüft GitHub-Releases-API ob es einen neueren Tag gibt als installiert
#   - wenn ja: APK download + adb install -r + Re-Grant Permissions + Schicht-Restart-Hinweis
#
# Voraussetzungen:
#   - adb verbunden
#   - gh CLI authentifiziert (für unbegrenzte API-Calls)
#   - jq für JSON-Parsing

set -euo pipefail

ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
PKG="de.taxiheringsdorf.app"
REPO="Patrick061977/taxi-App"
DEVICE_ARG="$*"
DBURL="https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app"

bridge_push() {
    local msg="$1"
    local ts=$(date +%s)000
    local json=$(python3 -c "
import json,sys
print(json.dumps({'message': sys.argv[1], 'targetChatId': 6229490043, 'via': 'claude', 'ts': int(sys.argv[2])}))
" "$msg" "$ts")
    curl -s -X POST "$DBURL/claudeBridge/outbox.json?access_token=$(gcloud auth print-access-token 2>/dev/null)" -d "$json" >/dev/null
}

current_version() {
    "$ADB" $DEVICE_ARG shell dumpsys package $PKG 2>/dev/null | grep -oE 'versionName=[^ ]+' | head -1 | cut -d= -f2
}

latest_release() {
    gh api "repos/$REPO/releases/latest" --jq '.tag_name' 2>/dev/null | sed 's/^v//'
}

echo "🔄 Auto-Install-Watcher gestartet"
echo "    Device: $("$ADB" $DEVICE_ARG devices | grep device | head -1)"
echo "    Aktuell installiert: $(current_version)"

LAST_INSTALLED=""
while true; do
    INSTALLED=$(current_version || echo "")
    LATEST=$(latest_release || echo "")
    if [ -n "$LATEST" ] && [ -n "$INSTALLED" ] && [ "$LATEST" != "$INSTALLED" ] && [ "$LATEST" != "$LAST_INSTALLED" ]; then
        echo "📥 Neue Version: v$LATEST (installiert: v$INSTALLED) — installiere…"
        TMP="/tmp/taxi-app-v$LATEST.apk"
        if curl -fsSL "https://github.com/$REPO/releases/download/v$LATEST/taxi-app-v$LATEST.apk" -o "$TMP"; then
            if "$ADB" $DEVICE_ARG install -r "$TMP" 2>&1 | tail -2 | grep -q Success; then
                # Permissions re-grant
                for P in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION POST_NOTIFICATIONS READ_CALL_LOG READ_CONTACTS; do
                    "$ADB" $DEVICE_ARG shell pm grant $PKG android.permission.$P 2>/dev/null || true
                done
                echo "✅ v$LATEST installiert"
                bridge_push "🤖 Auto-Install: v$LATEST (von v$INSTALLED) installiert + Permissions granted. Falls Schicht aktiv war: STOPP+START tippen damit Service neu startet."
                LAST_INSTALLED=$LATEST
            else
                echo "❌ Install fehlgeschlagen"
                bridge_push "🤖 Auto-Install v$LATEST FEHLGESCHLAGEN — adb install Error. Bitte manuell prüfen."
                LAST_INSTALLED=$LATEST  # nicht endlos retry
            fi
        else
            echo "❌ Download fehlgeschlagen für v$LATEST"
        fi
    fi
    sleep 30
done
