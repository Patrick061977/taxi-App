# Taxi-App Entwicklungshinweise

## Versions-System (WICHTIG!)

Nach JEDEM Commit der `index.html` ändert, MUSS der Build-Hash aktualisiert werden:

```bash
# 1. Commit machen
git add index.html && git commit -m "beschreibung"

# 2. Git-Hash holen und in APP_BUILD schreiben
HASH=$(git rev-parse --short HEAD)
sed -i "s/const APP_BUILD = '.*'/const APP_BUILD = '$HASH'/" index.html

# 3. Build-Hash committen
git add index.html && git commit -m "build: $HASH"
```

Alternativ die Hilfsfunktion `update-build-hash` nutzen (siehe unten).

Der User sieht die Version oben in der App (Header) als: `📊 v6.3.0 • abc1234`
So kann er sofort erkennen ob der neue Code geladen ist.

## APP_VERSION Regeln
- Patch (6.3.X): Bugfixes
- Minor (6.X.0): Neue Features
- Major (X.0.0): Breaking Changes

Bei größeren Änderungen APP_VERSION hochzählen UND den Build-Hash aktualisieren.
