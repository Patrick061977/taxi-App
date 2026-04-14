#!/bin/bash
# Build-Script für Capacitor Android App
# Kopiert Web-Assets nach www/ und baut die APK

set -e

echo "📱 Taxi App Build starten..."

# 1. Web-Assets nach www/ kopieren
echo "📂 Kopiere Web-Assets nach www/..."
mkdir -p www
cp index.html www/
cp icon-192.png www/ 2>/dev/null || true
cp favicon.svg www/ 2>/dev/null || true
cp manifest.json www/ 2>/dev/null || true
echo "✅ Assets kopiert"

# 2. Environment
export ANDROID_HOME="/c/Users/Taxi/AppData/Local/Android/Sdk"
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

# 3. Capacitor sync
echo "🔄 Capacitor sync..."
npx cap sync android

# 4. APK bauen
echo "🔨 APK bauen..."
cd android
./gradlew assembleDebug

echo ""
echo "✅ APK fertig!"
echo "📦 Datei: android/app/build/outputs/apk/debug/app-debug.apk"
