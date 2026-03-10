# Taxi-App Entwicklungshinweise

## Versions-System (WICHTIG!)

Nach JEDEM Commit der `index.html` ändert, MUSS der Build-Timestamp aktualisiert werden.
Der User sieht oben in der App: `📊 v6.10.0 • 04.03.2026 12:55`

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
- Patch (6.10.X): Bugfixes
- Minor (6.X.0): Neue Features
- Major (X.0.0): Breaking Changes

Bei größeren Änderungen APP_VERSION hochzählen UND Timestamp aktualisieren.

---

## Deploy-Pflicht bei Cloud Functions (WICHTIG!)

Nach JEDEM Commit der `functions/index.js` ändert, MUSS ein Deploy-Hinweis gegeben werden.
Die Cloud Function läuft auf Firebase-Servern — Code-Änderungen sind erst nach Deploy aktiv!

```bash
# Nach dem Push den User erinnern:
# "WICHTIG: functions/index.js wurde geändert → Deploy nötig:"
firebase deploy --only functions
```

### Was wird über Cloud Functions gesteuert:
- **Telegram-Webhook** — alle Bot-Nachrichten, Buchungen, Admin-Befehle
- **Konversations-Flow** — Pending-States, Follow-Ups, CRM-Suche
- **KI-Analyse** — Buchungs-Parsing via Anthropic API
- **Benachrichtigungen** — Buchungsbestätigungen an Kunden + Admins

### Regel:
- Änderungen an `index.html` → Build-Timestamp aktualisieren
- Änderungen an `functions/index.js` → User auf `firebase deploy --only functions` hinweisen
- Änderungen an `google-apps-script/kalender-sync-v4.0.js` → User erinnern: Code manuell ins Google Apps Script kopieren
- Änderungen an beiden/allen → alles tun

---

## Google Apps Script — Kalender-Sync (WICHTIG!)

### Datei: `google-apps-script/kalender-sync-v4.0.js`

Das Google Apps Script läuft **extern** auf Google-Servern (nicht Firebase!) und synchronisiert Fahrten aus Firebase in den Google Kalender.

### Versionierung (WICHTIG!):
- **VOR** jeder Änderung an einer Script-Datei: aktuelle Version als Backup kopieren!
- Namensschema: `kalender-sync-v4.0-backup.js` (Version aus dem Dateinamen übernehmen)
- Beispiel: Bevor `kalender-sync-v4.0.js` geändert wird:
  ```bash
  cp google-apps-script/kalender-sync-v4.0.js google-apps-script/kalender-sync-v4.0-backup.js
  ```
- Alte Backups bleiben im Ordner — NICHT löschen!

### Deployment:
- Code wird **nicht** automatisch deployed!
- Nach Änderungen muss der User den Code **manuell** ins Google Apps Script Projekt kopieren
- Google Apps Script Editor: https://script.google.com

### Was das Script macht:
- Liest alle Fahrten aus `/rides` in Firebase
- Erstellt/aktualisiert Google Kalender Events für zukünftige Fahrten
- Löscht Events für stornierte Fahrten
- Läuft automatisch alle 5 Minuten (Timer-Trigger)
- Erkennt Änderungen über `updatedAt` Feld in Rides

### Wichtige Abhängigkeiten:
- **`updatedAt`** in Rides MUSS gesetzt werden bei jeder Änderung (Fahrzeug, Status, etc.)
  → Sonst erkennt das Script die Änderung nicht und Kalender wird nicht aktualisiert
- **`customerPhone`/`customerMobile`** in Rides für Telefonnummern-Anzeige im Kalender
- **`customerId`** als Fallback: Script lädt CRM-Daten nach wenn Phone fehlt
- **Export-Einstellungen** aus `settings/calendarExport` in Firebase

### NICHT VERGESSEN:
- Bei JEDER Ride-Änderung `updatedAt: Date.now()` setzen!
- Telefonnummer aus CRM in Ride speichern (customerPhone/customerMobile)

---

## Architektur-Übersicht

### Tech-Stack
- **Single-Page Application (SPA)** — alles in einer `index.html` (~110.000 Zeilen)
- **Vanilla JavaScript** — keine Frameworks (kein React, Vue, Angular)
- **Firebase Realtime Database** — zentraler Datenspeicher + Echtzeit-Sync
- **Firebase Auth** — Benutzer-Authentifizierung (passenger/driver/admin Rollen)
- **Firebase Cloud Functions** — `functions/index.js` für Telegram Webhook
- **Leaflet** — Kartenansicht
- **OSRM** — Routing/Streckenberechnung
- **Nominatim** — Geocoding (Adresse → Koordinaten und umgekehrt)
- **Telegram Bot API** — Kundenkommunikation + Buchungen
- **Google Calendar API** — Hotel-Kalender-Sync (OAuth + iCal)

### Firebase-Struktur
```
/rides              - Alle Fahrten
/vehicles           - Fahrzeuge (mit Live-GPS-Position)
/users              - Benutzer (role: passenger/driver/admin)
/drivers            - Fahrer-Details
/customers          - CRM-Kunden
/pois               - POI-Favoriten (Karten-Marker)
/cancellations      - Stornierungen
/callHistory        - Anruf-Protokoll
/callPopup          - Echtzeit-Popup bei eingehenden Anrufen
/errorLogs          - Fehler-Logging
/settings/          - System-Konfiguration:
  /tarif            - Tarifeinstellungen
  /pricing          - Preiskonfiguration
  /telegram/        - Telegram-Bot-Konfiguration:
    /botToken       - Bot-Token
    /webhookActive  - true = Webhook-Modus, false/null = Polling
    /lastUpdateId   - Polling-Offset
    /pollLock       - Geräte-Lock (verhindert doppeltes Polling)
    /pending        - Laufende Buchungs-Konversationen
    /customers      - Telegram-Kunden-Cache
    /adminChats     - Admin-Chat-IDs
    /botlog         - Bot-Log-Einträge
  /bookingSystemOnline - Online/Offline-Status des Buchungssystems
```

### Benutzer-Rollen
- **passenger** — Buchen, eigene Buchungen sehen
- **driver** — + Aufträge annehmen, GPS-Tracking
- **admin** — + ALLES (Verwaltung, Statistiken, Einstellungen)

---

## Telegram-System (WICHTIG!)

### Architektur-Entscheidung: Webhook ist primär!

Das Telegram-System hat zwei Modi:

1. **Webhook (Cloud Function)** — `functions/index.js` — **PRIMÄRES SYSTEM**
   - Läuft 24/7 auf Firebase-Servern
   - Antwortet auch ohne offenen Browser
   - Gesteuert durch Firebase-Flag: `settings/telegram/webhookActive = true`
   - Deploy: `firebase deploy --only functions`

2. **Long-Polling (Browser)** — Code in `index.html` — **DEAKTIVIERT, CODE BLEIBT**
   - Polling-Code ist vollständig vorhanden aber startet NICHT wenn Webhook aktiv
   - Dient als Fallback falls Webhook mal abgeschaltet wird
   - Gesteuert durch: `telegramWebhookMode` (JS-Variable) + Firebase-Flag

### Steuerung
- `settings/telegram/webhookActive = true` in Firebase → Webhook-Modus
- `telegramWebhookMode` (globale JS-Variable) — wird aus Firebase geladen
- `startTelegramPolling()` prüft beides und startet NICHT wenn Webhook aktiv
- Token-Speicher-Funktionen löschen den Webhook NICHT im Webhook-Modus

### NICHT ÄNDERN:
- Polling-Code NICHT löschen — bleibt als Fallback
- `deleteWebhook`-Aufrufe NICHT im Webhook-Modus ausführen
- Webhook-Flag in Firebase ist die Single Source of Truth

---

## Echtzeit-Daten (Firebase Listener)

Diese `.on('value')` Listener laufen permanent und sind KEIN Polling:
- `rides` — Fahrten-Updates
- `vehicles` — Fahrzeug-Positionen/Status
- `cancellations` — Stornierungen
- `callHistory` — Anruf-Protokoll (letzte 20)
- `callPopup` — Eingehende Anrufe (Popup)
- `settings/pricing` — Tarifänderungen
- `settings/bookingSystemOnline` — System-Status
- `settings/telegram/pending` — Laufende Telegram-Buchungen
- `.info/connected` — Verbindungsstatus

Diese Listener sind essenziell und dürfen NICHT entfernt werden.

---

## Periodische Aufgaben (Intervals)

| Interval | Funktion | Zweck |
|----------|----------|-------|
| 2s | `loadLiveMonitorData()` | Live-Monitor-Daten |
| 1.9s | `runFullSystemDiagnostics()` | Diagnostik-Auto-Refresh |
| 3s | `updateTgDiagStatus()` | Telegram-Status-Anzeige |
| 5s | GPS Health Check | GPS-Überwachung |
| 5s | `refreshFleetMapOverview()` | Flottenübersicht (wenn aktiv) |
| 19s | `trackMemoryUsage()` | Speicher-Monitoring |
| 30s | Batterie-Monitor | Akkustand |
| 60s | `checkPendingTrackingLinks()` | Tracking-Links prüfen |
| 2min | `getStandbyPosition()` | Standby-GPS (grob) |
| 5min | `cleanupExpiredTelegramPendings()` | Abgelaufene Telegram-Konversationen |
| 15min | `syncAllHotelCalendars()` | Hotel-Kalender-Sync |

---

## GPS-Tracking

- **Aktive Fahrt**: `navigator.geolocation.watchPosition()` — kontinuierlich
- **Standby**: `getCurrentPosition()` alle 2 Minuten (grob, WiFi/cellular)
- Daten gehen nach `/vehicles/{vehicleId}` in Firebase
- Sicherheitschecks: Validiert vehicleId vor jedem Firebase-Write

---

## Wichtige Konventionen

- **Sprache im Code**: Deutsch (Kommentare, Variablennamen, Log-Meldungen)
- **Versions-Tags im Code**: `// 🌐 v6.3.1:` etc. markieren wann was geändert wurde
- **Alles in einer Datei**: `index.html` enthält HTML, CSS und JavaScript
- **Cloud Functions**: Nur `functions/index.js` für den Telegram-Webhook
- **Keine NPM/Build-Pipeline**: Direkt deployen, kein Bundler
