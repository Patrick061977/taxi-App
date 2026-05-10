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
    "mitarbeiter.html"
    "schichtplan.html"
    "dms.html"
    "buchen.html"
    "buchung-test.html"
    "hotel.html"
    "landing.html"
    "berlin.html"
    "anfrage.html"
    "ausflugsziele.html"
    "track.html"
    "gps-track.html"
    "payment-success.html"
    "payment-cancel.html"
    "manifest.json"
    "service-worker.js"
    "favicon.svg"
    "icon-192.png"
    "icon-funktaxi.svg"
    "icon-funktaxi-original.jpg"
    "icon-mockup-A.svg"
    "icon-mockup-B.svg"
    "icon-mockup-C.svg"
    "icon-mockup-D.svg"
    "icon-mockup-E.svg"
    "icon-preview.html"
    "manifest-kunden.json"
    "service-worker-kunden.js"
    "manifest-buchen.json"
    "service-worker-buchen.js"
    "manifest-hotel.json"
    "service-worker-hotel.js"
    "manifest-landing.json"
    "service-worker-landing.js"
    "pwa-install.js"
    "advanced-logger.js"
    "firebase-remote-logger.js"
    "robots.txt"
    "sitemap.xml"
    "googleb29a71be78bd0c12.html"
)

# 🆕 v6.62.552: Service-SEO-Pages (Patrick — eigene Landingpages pro Leistung).
# Liegen direkt unter /Taxi-App/ (= umwelt-taxi-insel-usedom.de Root), dienen als
# statische Landingpages mit eigenen Metas/JSON-LD pro Leistung.
SEO_PAGES=(
    "flughafen-heringsdorf.html"
    "bahnhofstransfer.html"
    "krankenfahrten.html"
    "inselfahrten.html"
    "grossraumtaxi.html"
    "pauschalpreise-swinoujscie.html"
    "restaurants-usedom.html"
)
APP_FILES=("${APP_FILES[@]}" "${SEO_PAGES[@]}")

for file in "${APP_FILES[@]}"; do
    if [ -f "$PROJECT_ROOT/$file" ]; then
        cp "$PROJECT_ROOT/$file" "$OUTPUT_DIR/Taxi-App/$file"
        echo "   -> $file"
    else
        echo "   !! $file nicht gefunden (übersprungen)"
    fi
done

# 🆕 v6.62.594: POI-Bilder mitkopieren (Wikipedia-Hotlink war geblockt → lokal hosten)
if [ -d "$PROJECT_ROOT/images" ]; then
    echo "5b) images/ Ordner kopieren..."
    mkdir -p "$OUTPUT_DIR/Taxi-App/images"
    cp -r "$PROJECT_ROOT/images/"* "$OUTPUT_DIR/Taxi-App/images/" 2>/dev/null || true
    find "$OUTPUT_DIR/Taxi-App/images" -type f | while read f; do
        echo "   -> ${f#$OUTPUT_DIR/Taxi-App/}"
    done
fi

# v6.52.4: APP_BUILD-Stempel im DEPLOY-COPY auf JETZT setzen — Patrick: 'das Datum
# in der Web-App ist veraltet'. Bisher wurde der Stempel nur manuell beim Commit
# gesetzt und oft vergessen. Jetzt überschreibt der Strato-Deploy ihn automatisch
# mit der aktuellen Build-Zeit (Berlin/CET). Source-Repo bleibt unverändert.
if [ -f "$OUTPUT_DIR/Taxi-App/index.html" ]; then
    BUILD_TS=$(TZ="Europe/Berlin" date +"%d.%m.%Y %H:%M")
    sed -i.bak "s/const APP_BUILD = '[^']*'/const APP_BUILD = '$BUILD_TS'/" "$OUTPUT_DIR/Taxi-App/index.html"
    rm -f "$OUTPUT_DIR/Taxi-App/index.html.bak"
    echo "   -> APP_BUILD-Stempel auf '$BUILD_TS' gesetzt"
fi

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
