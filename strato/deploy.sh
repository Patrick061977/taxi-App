#!/bin/bash
# ============================================================
# Strato Deploy-Script
# Kopiert alle nötigen Dateien nach strato-upload/
# Danach per FTP auf den Strato-Server hochladen.
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/strato-upload"

echo "=========================================="
echo " Strato Deploy-Vorbereitung"
echo "=========================================="
echo ""
echo "Projekt:  $PROJECT_ROOT"
echo "Ausgabe:  $OUTPUT_DIR"
echo ""

# 1. Ausgabe-Ordner erstellen/leeren
echo "1) strato-upload/ vorbereiten..."
mkdir -p "$OUTPUT_DIR/Taxi-App"

# 2. Root-Dateien (Strato FTP-Root)
echo "2) Root-Dateien kopieren..."
cp "$SCRIPT_DIR/.htaccess"       "$OUTPUT_DIR/.htaccess"
cp "$SCRIPT_DIR/root-index.html" "$OUTPUT_DIR/index.html"

# 3. Taxi-App Unterordner — .htaccess
echo "3) Taxi-App .htaccess kopieren..."
cp "$SCRIPT_DIR/Taxi-App/.htaccess" "$OUTPUT_DIR/Taxi-App/.htaccess"

# 4. Haupt-App-Dateien aus dem Projekt-Root
echo "4) App-Dateien kopieren..."
APP_FILES=(
    "index.html"
    "kunden.html"
    "track.html"
    "manifest.json"
    "service-worker.js"
    "favicon.svg"
    "icon-192.png"
)

for file in "${APP_FILES[@]}"; do
    if [ -f "$PROJECT_ROOT/$file" ]; then
        cp "$PROJECT_ROOT/$file" "$OUTPUT_DIR/Taxi-App/$file"
        echo "   -> $file"
    else
        echo "   !! $file nicht gefunden (übersprungen)"
    fi
done

# 5. Zusammenfassung
echo ""
echo "=========================================="
echo " Fertig! Dateien in strato-upload/:"
echo "=========================================="
echo ""
find "$OUTPUT_DIR" -type f | sort | while read f; do
    SIZE=$(du -h "$f" | cut -f1)
    echo "  $SIZE  ${f#$OUTPUT_DIR/}"
done

echo ""
echo "Jetzt per FTP auf Strato hochladen:"
echo "  - strato-upload/.htaccess        -> FTP-Root /"
echo "  - strato-upload/index.html       -> FTP-Root /"
echo "  - strato-upload/Taxi-App/*       -> FTP-Root /Taxi-App/"
echo ""
echo "Tipp: Nur index.html hat sich meistens geändert."
echo "      Die .htaccess und Assets ändern sich selten."
