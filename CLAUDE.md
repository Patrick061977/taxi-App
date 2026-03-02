# Taxi-App Entwicklungshinweise

## Versions-System (WICHTIG!)

Nach JEDEM Commit der `index.html` ändert, MUSS der Build-Timestamp aktualisiert werden.
Der User sieht oben in der App: `📊 v6.3.0 • 01.03.2026 09:15`

```bash
# 1. Änderungen committen
git add index.html && git commit -m "beschreibung"

# 2. Datum+Uhrzeit als Build-Timestamp eintragen (deutsche Zeit CET/CEST)
TS=$(TZ="Europe/Berlin" date +"%d.%m.%Y %H:%M")
sed -i "s/const APP_BUILD = '.*'/const APP_BUILD = '$TS'/" index.html

# 3. Timestamp committen und pushen
git add index.html && git commit -m "build: $TS"
git push -u origin <branch-name>
```

## APP_VERSION Regeln
- Patch (6.3.X): Bugfixes
- Minor (6.X.0): Neue Features
- Major (X.0.0): Breaking Changes

Bei größeren Änderungen APP_VERSION hochzählen UND Timestamp aktualisieren.
