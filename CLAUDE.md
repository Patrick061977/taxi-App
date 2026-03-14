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
- **Database Triggers (v6.20.0)** — Server-seitige Telegram-Benachrichtigungen (siehe unten)

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

### 🆕 v6.20.0: Server-seitige Telegram-Benachrichtigungen (Database Triggers)

Alle Telegram-Benachrichtigungen für Fahrten laufen jetzt über **Firebase Database Triggers** in `functions/index.js` — **unabhängig vom Browser!**

#### Cloud Function Triggers:

| Export-Name | Trigger-Typ | Auslöser | Was wird gesendet |
|-------------|-------------|----------|-------------------|
| `onRideCreated` | `onValueCreated('/rides/{rideId}')` | Neue Fahrt in Firebase | Admin-Benachrichtigung (Sofort/Vorbestellung) |
| `onRideUpdated` | `onValueUpdated('/rides/{rideId}')` | Fahrt geändert | Status-Updates (accepted/storniert/picked_up/completed), Fahrer-Zuweisung, Kunden-Bestätigung |
| `onRideDeleted` | `onValueDeleted('/rides/{rideId}')` | Fahrt gelöscht | Admin + Fahrer werden informiert |
| `scheduledOpenRideCheck` | `onSchedule('every 1 minutes')` | Timer (jede Minute) | Warnung wenn Vorbestellung < 10 Min ohne Fahrer |

#### Duplikat-Schutz (Flags in Rides):
- `cloudNotificationSent: true` — Admin-Benachrichtigung bei Erstellung bereits gesendet
- `customerTelegramSent: true` — Kunden-Bestätigung bereits gesendet
- `openRideWarned: true` — Offene-Fahrt-Warnung bereits gesendet

#### Browser-Fallback:
Die 7 Browser-Funktionen in `index.html` prüfen `telegramWebhookMode`:
- `sendTelegramForNewRide()` — ☁️ skip wenn Webhook aktiv
- `sendTelegramStatusUpdate()` — ☁️ skip wenn Webhook aktiv
- `sendTelegramToDriver()` — ☁️ skip wenn Webhook aktiv
- `sendTelegramToDriverCancel()` — ☁️ skip wenn Webhook aktiv
- `sendCustomerTelegram()` — ☁️ skip wenn Webhook aktiv
- `sendTelegramForDeletedRide()` — ☁️ skip wenn Webhook aktiv
- `sendTelegramOpenRideWarning()` — ☁️ skip wenn Webhook aktiv

**Wenn Webhook deaktiviert wird**, übernehmen die Browser-Funktionen wieder automatisch.

#### Hilfsfunktionen (in functions/index.js):
- `sendToAllAdmins(message)` — Sendet an alle Admin-Chats
- `getDriverChatId(vehicleId)` — Ermittelt Fahrer-Telegram-Chat-ID (User → Fahrzeug Fallback)
- `getCustomerChatId(ride)` — Ermittelt Kunden-Chat-ID (Ride → CRM Fallback)
- `formatBerlinTime(timestamp)` — Berlin-Zeitzone Formatierung

#### WICHTIG:
- `autoAssignRide()` sendet Fahrer-Telegram **selbst** — `onRideUpdated` prüft `assignedBy !== 'cloud-auto-assign'` um Duplikate zu verhindern
- Gleiches gilt für `cloud-auto-replan` (Konflikt-Umplanung)

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
- **Cloud Functions**: `functions/index.js` für Telegram-Webhook + Database Triggers + Scheduled Tasks
- **Keine NPM/Build-Pipeline**: Direkt deployen, kein Bundler

---

## Änderungsprotokoll (Changelog)

### v6.20.0 — 14.03.2026 — Server-seitige Telegram-Benachrichtigungen
- **NEU:** Firebase Database Triggers für alle Telegram-Benachrichtigungen (funktioniert ohne Browser!)
- **NEU:** `onRideCreated`, `onRideUpdated`, `onRideDeleted` Cloud Function Triggers
- **NEU:** `scheduledOpenRideCheck` — prüft jede Minute ob Vorbestellungen ohne Fahrer sind
- **GEÄNDERT:** 7 Browser-Funktionen skippen im Webhook-Modus (Cloud Function übernimmt)
- **GEÄNDERT:** Duplikat-Schutz über Firebase-Flags (`cloudNotificationSent`, `customerTelegramSent`, `openRideWarned`)

### v6.19.x — 13.03.2026 — SMS/Kunden-Portal + Kalender-Fixes
- **NEU:** Kunden-Portal mit SMS-Verifizierung (`kunden.html`)
- **NEU:** SMS für Stornierung und Änderung + Speichern-Button
- **NEU:** Bushaltestellen-Erkennung im Karten-Picker und POI-System
- **NEU:** Bearbeiten-Button in POI- und Kunden-Marker-Popups auf der Karte
- **NEU:** Cloud-Backup in Firebase + Hotel-Sync Toggle in Admin-UI
- **NEU:** Zurück-/Abbrechen-Buttons im Telegram-Buchungsflow
- **FIX:** Doppelte/dreifache SMS an Kunden verhindern (Duplikat-Schutz)
- **FIX:** SMS-Protokoll in Firebase
- **FIX:** Hotel-Kalender-Sync deaktivierbar
- **FIX:** Überfällige Vorbestellungen auto-stornieren → completed statt cancelled
- **FIX:** Optimierung Oszillation verhindern (Fingerprint-Cache + Stabilitäts-Schwelle)
- **PERF:** Kalender nutzt globale Daten statt erneuter Firebase-Abfrage + Debouncing

### v6.17.0 — 13.03.2026 — Akzeptierungsfenster + Konflikt-Umplanung
- **NEU:** 60-Min-Akzeptierungsfenster für Vorbestellungen
- **NEU:** Cloud Function für automatische Konflikt-Umplanung alle 5 Min (`autoResolveConflicts`)
- **FIX:** Exakte Zeitkonflikte bei autoAssignVehicleToRide erkennen
- **FIX:** PLZ-Validierung durchgängig in allen Geocoding-Pfaden
- **FIX:** Geocoding-PLZ-Match + Adress-Neugeokodierung bei Route-Bearbeitung
- **FIX:** Admin-Bestätigung für Telegram-Änderungen

### v6.16.x — 12–13.03.2026 — Schichtplan + Telegram-Menü + Auto-Zuweisung
- **NEU:** Schichtplan-Übersicht im Kalender-Tag
- **NEU:** Telegram /menü Befehl mit Inline-Button-Hauptmenü
- **NEU:** `setupBotCommands` Cloud Function
- **NEU:** Smart Auto-Complete für überfällige Fahrten
- **NEU:** Auto-updatedAt Interceptor für Google Calendar Sync
- **NEU:** Fahrzeug-Übersicht zeigt Schichtstatus mit Dienst-Check
- **NEU:** Abbrechen-Button in jeden Telegram-Bot Buchungsschritt
- **REFACTOR:** Cloud Function Auto-Zuweisung mit zwei klaren Modi (Sofort vs. Vorbestellung)
- **FIX:** Schichtplan-Erkennung komplett überarbeitet (keine hardcoded 06:00-22:00 Fallbacks)
- **FIX:** Additive Ausnahmen überschreiben Wochenplan nicht mehr
- **FIX:** defaultTimes automatisch anlegen wenn Schichttag aktiviert wird
- **FIX:** Veraltete accepted-Fahrten blockieren nicht mehr Fahrzeugauswahl

### v6.15.x — 11–12.03.2026 — CRM-Detailansicht + Karten-Picker + Stammrouten
- **NEU:** Kunden-Detailansicht mit Routen-Übersicht und Bearbeitung
- **NEU:** Live-Status in Fahrt-Timeline anzeigen
- **NEU:** Karten-Picker im Bearbeiten-Modal für Abholort und Zielort
- **NEU:** Stammrouten bearbeiten/löschen + Koordinaten-Validierung
- **NEU:** Koordinaten neu berechnen Button im Edit-Modal
- **NEU:** Route neu berechnen Button + CRM-Name in Rechnung bevorzugt
- **NEU:** Alle Fahrten im CRM-Kundendetail mit Filter + Rechnung-Button
- **NEU:** Echtzeit-GPS-Tracking mit Live-ETA + Fortschrittsbalken
- **NEU:** KI-Training-System — Regeln in Firebase speichern und bei Analyse laden
- **NEU:** GPS-Standort — Abholort/Zielort-Auswahl + Büroklammer-Hinweise
- **NEU:** Auto-Zuweisung für Telegram-Sofortfahrten in Cloud Function
- **NEU:** Mobilnummer-Abfrage bei Festnetz-Erkennung
- **NEU:** Zwischenstopp als Adresse in KI-Analyse erkennen
- **NEU:** POIs priorisieren in Telegram-Adresssuche
- **NEU:** 9 neue POI-Kategorien (Vermietung, Ferienwohnung, Flughafen etc.)
- **NEU:** Koordinaten-Anzeige im Fahrt-Bearbeiten-Modal
- **NEU:** CRM-Daten via Telegram editieren
- **NEU:** Personenzahl in Telegram-Buchung änderbar (vor + nach Buchung)
- **FIX:** updatedAt bei Fleet-Timeline Drag&Drop setzen für Google Calendar Sync
- **FIX:** Geocoding-Cache + Autocomplete-Überschreibung im Map Picker

### v6.14.x — 07–11.03.2026 — Telegram-Bot + CRM + Audio + Auftraggeber
- **NEU:** Fahrt auf mehrere Tage kopieren
- **NEU:** Telegram Bot — Abholort/Zielort Zuhause-Frage + Vergangene Fahrten
- **NEU:** Admin Kundenanlage im Telegram + CRM-Sync bei Selbstregistrierung
- **NEU:** Audio-Dateien im Telegram transkribieren (MP3, WAV, M4A etc.)
- **NEU:** Auftraggeber-System (Hotel/Firma/Klinik bucht für Andere)
- **NEU:** Hotels als Kundenart + Gastname-Abfrage + Nummer-Zuordnung
- **NEU:** Lieferanten (type=supplier) als Auftraggeber erkennen
- **NEU:** Kundenart (Stammkunde/Gelegenheitskunde) im CRM + Telegram
- **NEU:** Kunden zusammenführen (Merge) im CRM
- **NEU:** Telefonnummer aus Audio-Dateinamen extrahieren + CRM-Auto-Zuordnung
- **NEU:** Dynamische zusätzliche Telefonnummern im CRM-Modal
- **NEU:** KI extrahiert Hotel-Gastname direkt aus Transkript
- **NEU:** Sofortfahrt-Anzeige bei "jetzt" Buchungen + Fahrer-Online-Check
- **NEU:** Email im Kurznachricht-Modal + AI Email-Extraktion
- **NEU:** Telegram Bot Log — Details aufklappen + Log kopieren Button
- **NEU:** Fahrer-Konto Modal + kompakter Schicht-Badge
- **NEU:** Schicht-Zusammenfassung per Telegram an Fahrer senden
- **NEU:** Telegram Datum ändern, Gastname, Losfahrt-Erinnerung + Notif-Settings
- **NEU:** Stripe API-Keys Eingabe im Admin-Panel
- **NEU:** System-Protokoll Einträge aufklappbar + Kopier-Button
- **NEU:** System-Ticker Telegram + Fahrzeugstatus in Fahrzeugauswahl
- **NEU:** Admin-Status im Telegram-Profil anzeigen
- **FIX:** Fuzzy-Matching (Levenshtein) für CRM-Kundensuche
- **FIX:** CRM-Kundensuche + Kontext-Verlust bei Text statt Button
- **FIX:** Mobilnummern fehlten im Google Kalender — customerMobile in allen Buchungsflows setzen
- **FIX:** mobilePhone-Fallback an 14+ Stellen — alle Buchungsflows lesen jetzt mobilePhone
- **FIX:** Telefonnummern beim Bearbeiten einer Fahrt nicht mehr überschreiben
- **FIX:** Google Calendar Sync — Erinnerungen (Reminder) hinzufügen
- **FIX:** Festnetz-Nummern Eingabe + kein SMS/WhatsApp für Festnetz
- **FIX:** Nominatim residential/neighbourhood Fallback in allen Autocompletes
- **FIX:** Sofort-Buchen Buttons + Zahlungsart + Datum-Picker nach Mitternacht
- **FIX:** KI-Adress-Halluzination bei abgeschnittenen Audio-Transkripten verhindern
