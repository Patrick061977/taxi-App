# Taxi-App Entwicklungshinweise

---

## 🕵️ PFLICHT: Detektiv-Modus statt Rätselraten (WICHTIG!)

**Claude darf NIEMALS "könnte", "vielleicht", "möglicherweise" in Diagnosen verwenden.**

### Regel:
Wenn ein Problem gemeldet wird, arbeitet Claude **schematisch** ab:

1. **WAS HABEN WIR?** — Fakten sammeln (Versionen, Logs, Screenshots, Code-Stellen, Manifest)
2. **WAS MÜSSEN WIR ÜBERPRÜFEN?** — konkrete Checks aufschreiben (z.B. Grep-Befehl X, Datei Y lesen, GitHub-Release Z)
3. **WAS MACHEN WIR?** — die Checks DURCHFÜHREN, nicht beschreiben
4. **BEFUND** — was ist Fakt (✓), was ist widerlegt (✗), was ist noch offen (?)
5. **MAẞNAHME** — genau eine konkrete nächste Aktion, keine Aufzählung von Alternativen

### NICHT erlaubt:
- "Das könnte daran liegen, dass..."
- "Vielleicht ist das APK zu alt"
- "Möglicherweise killt Samsung den Service"
- Listen mit Optionen A/B/C ohne eigene Entscheidung

### ERLAUBT:
- "APK-Version laut AppUpdatePlugin: X. Git-Tag des letzten Release: Y. → Befund: veraltet/aktuell."
- "Call-Chain von loginShift() führt zu startShiftForegroundService(). In Zeile N steht try/catch der Fehler verschluckt → Fix: Fehler in debugErrors loggen."
- "Check 1 ergab ✓, Check 2 ergab ✗ an Zeile X. Maßnahme: Zeile X ändern auf Y."

### Wenn ein Check nur vom User beantwortbar ist:
- EINE klare Ja/Nein-Frage stellen (nicht 3 auf einmal)
- Vorher alle Checks ausgeschöpft haben, die Claude selbst machen kann

---

## 🔍 PFLICHT: Bugs sofort melden (WICHTIG!)

**Claude MUSS bei jeder Code-Analyse potenzielle Bugs und Schwachstellen sofort ansprechen — BEVOR sie Probleme verursachen!**

### Regel:
- Wenn Claude beim Lesen von Code eine Stelle findet, die Fehler verursachen KÖNNTE (nicht nur die aktuell bearbeitete Stelle), MUSS Claude das sofort ansprechen
- Nicht stillschweigend übergehen — immer aktiv kommunizieren
- Bugklassen die IMMER gemeldet werden müssen:
  - Funktionen die Parameter erwarten die sie nicht bekommen (oder ignorieren)
  - String-Vergleiche wo Koordinaten-Vergleich robuster wäre
  - Variablen die in einem Scope definiert sind aber woanders benutzt werden (`ReferenceError`)
  - Fehlende `try/catch` bei async-Operationen die den Bot stummschalten könnten
  - Fehlende Null-Checks bei Firebase-Daten
  - Duplikat-Checks die durch leicht unterschiedliche Strings fehlschlagen
  - Pending-State der bei Fehler nicht aufgeräumt wird → Bot hängt

### Format für Bug-Meldungen:
```
⚠️ POTENZIELLER BUG GEFUNDEN (Zeile X):
Problem: [kurze Beschreibung]
Auswirkung: [was passiert wenn es crasht]
Fix: [wie es behoben werden sollte]
Jetzt fixen? Ja/Nein
```

### Beispiele aus der Praxis:
- `setVehicle()` nimmt keinen Parameter → wird mit Argument aufgerufen, Argument wird ignoriert
- `searchWords` in `searchNominatimForTelegram()` definiert → im Handler-Scope benutzt → `ReferenceError`
- `booking.destination === booking._auftraggeberAddress` → schlägt fehl wenn Geocache Hotelname voranstellt
- Google Maps Pfad in `_awaitingNewBookingText` baute Buchung neu auf → Datum/Uhrzeit verloren
- `auftr_skip_` hatte keinen Duplikat-Check → Abholort = Zielort blieb nach "Weder noch"

---

## 🏨 Hotel Residenz Bug — Ursache & Prävention

### Was ist passiert:
1. **Stammkunde-Logik** setzt `booking.destination = customer.address` aus CRM → `"Kanalstraße 1, 17424 Heringsdorf"`
2. **Geocache** speichert dieselbe Adresse als POI-Name → `"Hotel Residenz, Kanalstraße 1, 17424 Heringsdorf"`
3. Buchungsflow nutzt Geocache-String → `booking.destination = "Hotel Residenz, Kanalstraße 1..."`
4. **Duplikat-Check** prüft `booking.destination === booking._auftraggeberAddress` → String-Vergleich schlägt fehl
5. → Abholort UND Zielort = Hotel Residenz (selbe Adresse, unterschiedlicher String)

### Warum trat der Bug dreifach auf:
- `auftr_pickup_` Handler: kein robuster Check (gefixt v6.38.94/97)
- `auftr_skip_` Handler: gar kein Check (gefixt v6.38.98)
- `_awaitingNewBookingText` Google Maps Pfad: Buchung neu aufgebaut ohne Duplikat-Check (gefixt v6.38.98)

### Präventionsregel — NIEMALS Adressen per String-Gleichheit vergleichen:
```js
// ❌ FALSCH — bricht wenn Geocache Hotelname voranstellt:
if (booking.destination === booking._auftraggeberAddress) { ... }

// ✅ RICHTIG — Koordinaten-Vergleich + String-Enthält-Check als Fallback:
const sameByCoords = booking.destinationLat && booking._auftraggeberLat &&
    Math.abs(parseFloat(booking.destinationLat) - parseFloat(booking._auftraggeberLat)) < 0.0002 &&
    Math.abs(parseFloat(booking.destinationLon) - parseFloat(booking._auftraggeberLon)) < 0.0002;
const sameByString = booking.destination && booking._auftraggeberAddress && (
    booking.destination === booking._auftraggeberAddress ||
    booking.destination.includes(booking._auftraggeberAddress) ||
    booking._auftraggeberAddress.includes(booking.destination)
);
if (booking.destination && (sameByCoords || sameByString)) { ... }
```

### Regel für ALLE Adress-Vergleiche im Booking-Flow:
- **Niemals `===` für Adressen** — immer Koordinaten zuerst, dann `.includes()` als Fallback
- **Geocache** fügt POI-Namen voran → CRM-Adresse ≠ Geocache-Adresse obwohl gleicher Ort
- **Jeder Handler** der Pickup oder Destination setzt muss prüfen ob das ANDERE Feld danach identisch ist
- Der Duplikat-Check muss in ALLEN drei Pfaden vorhanden sein: `auftr_pickup_`, `auftr_dest_`, `auftr_skip_`

### Präventionsregel — Buchungs-Kontext NIEMALS wegwerfen:
```js
// ❌ FALSCH — Buchung neu aufbauen wenn Adresse geändert wird:
const partialB = { intent: 'buchung', name: preselectedCustomer.name, ... }; // Datum/Zeit verloren!

// ✅ RICHTIG — Bestehende Buchung klonen, nur geändertes Feld leeren:
const partialB = pending.partial ? { ...pending.partial } : { /* Fallback */ };
partialB[isPickupField ? 'pickup' : 'destination'] = null; // nur dieses Feld leeren
```
Dies gilt für ALLE Pfade wo eine Adresse geändert wird: normaler Text, Google Maps Link, PLZ-Fallback.

### Präventionsregel — NIEMALS `deletePending` + `analyzeTelegramBooking` wenn `pending.partial` existiert:
```js
// ❌ FALSCH — Pending löschen und KI-Analyse neu starten:
await deletePending(chatId);
await analyzeTelegramBooking(chatId, enrichedText, userName, { preselectedCustomer });
// → Auftraggeber-Kontext verloren: guestName, _isAuftraggeberBooking, _auftraggeberResolved!

// ✅ RICHTIG — Bestehende Buchung aus pending.partial weiterverwenden:
const booking = pending.partial;
booking.destination = newDestination;  // nur das geänderte Feld setzen
booking.missing = booking.missing.filter(f => f !== 'destination');
await continueBookingFlow(chatId, booking, pending.originalText || '');
```
**Wichtig:** Jeder Callback-Handler (Favoriten, Google Maps, Adress-Bestätigung, etc.) der ein Feld
der Buchung ändert MUSS `pending.partial` weiterverwenden. `analyzeTelegramBooking` darf NUR
beim allerersten Buchungsstart aufgerufen werden — NIE mitten im Flow!

### Präventionsregel — `_auftraggeberResolved` IMMER setzen wenn Auftraggeber-Frage beantwortet:
Jeder Code-Pfad der die Auftraggeber-Adresse einem Feld zuordnet (Abholort/Zielort) MUSS
`booking._auftraggeberResolved = true` setzen — sonst fragt `continueBookingFlow` endlos nach.
Dies betrifft:
- `auftr_pickup_` Handler ✅
- `auftr_dest_` Handler ✅
- `auftr_skip_` Handler ✅
- `analyzeTelegramBooking` wenn KI beide Felder erkennt ✅ (v6.38.95)

---

## Aktueller Stand (2026-03-26)

**Version:** v6.38.34 | **Branch:** `main`

### Zuletzt implementierte Features (Session 26.03.2026):

| Version | Feature |
|---------|---------|
| **v6.25.5** | Fix: Vorbestell-Scheduler im Webhook-Modus deaktiviert (Cloud übernimmt) |
| **v6.25.5** | Fix: Admin-Buchung zeigt jetzt Kunden-Adresse (Nach Hause / Von zu Hause) |
| **v6.25.5** | Telegram: GPS-Adresse mit Bestätigung im Geocache speichern |
| **v6.25.5** | Telegram: Geocache-Suche mit Teilwort-Matching (z.B. "Lidl" findet "Lidl, Bansin") |
| **v6.25.5** | Kalender-Sync v5.0: findExistingEvent ohne Zeitfilter — sucht alle Events |
| **v6.25.4** | Booking-Modus (?mode=booking) + Kunden-Bildschirm Verbesserungen |
| **v6.25.3** | Fix: Konflikt-Checker filtert deleted/rejected Fahrten |

### Erledigte Aufgaben (Session 26.03.2026):
- Google Calendar Sync v5.0: Events werden über Firebase-ID gesucht, nicht mehr nach Datum → Datumsänderungen werden korrekt übernommen ✅
- Vorbestell-Scheduler: `startPreorderScheduler()` war im Webhook-Modus aktiv → Browser hat Fahrten zugewiesen statt Cloud Function ✅
- Admin-Telegram-Buchung: "Nach Hause"/"Von zu Hause" Buttons fehlten komplett → jetzt wird CRM-Adresse des ausgewählten Kunden gezeigt ✅
- GPS-Sticker: Adresse wird nach Bestätigung im Geocache gespeichert (mit Ja/Nein Frage) ✅
- Geocache Teilwort-Suche: Scoring-System für partielle Matches ✅

### In Arbeit:
- `buchen.html` — Eigenständige öffentliche Buchungs-Landingpage (ohne Login, Phone Auth erst bei Buchung)

### Bekannte offene Punkte:
- Google Apps Script: Code manuell ins Script kopieren + Zeitzone "Europe/Berlin" prüfen
- `functions/index.js` geändert → `firebase deploy --only functions` nötig
- Telegram-Adress-Suche: Weitere Verbesserungen bei Kundenname-Erkennung
- Vollständiges Changelog: siehe `CHANGELOG.md`

### TODO (Später):
- **Google Places Autocomplete** — Nominatim durch Google Places API ersetzen für Adresssuche (bessere POI-Erkennung, Tippfehler-Toleranz, schneller). Benötigt: Google Cloud Account + API Key mit Places API (New) aktiviert. Geschätzte Kosten: ~0-42 €/Monat (200$/Monat Gratis-Guthaben von Google). OSRM für Routing bleibt, Nominatim als Fallback.
- **Auto-Shift-End (Sicherheitsgurt gegen vergessene Schichten)** — Cloud Function die Schichten automatisch beendet. Ideen-Sammlung:
  - Option A: Um 00:00 Uhr Auto-Close, ABER Nachtschichten (z.B. 22:00–04:00) müssen ausgenommen werden → Prüfung gegen `shiftPlan`
  - Option B: Nach 12h ohne manuelles Ende automatisch schließen, dann Push-Benachrichtigung "Schicht wurde auto-beendet — neu anmelden?" an Fahrer
  - Option C: Hybrid: nach Ende laut Wochenplan + 1h Puffer, wenn keine laufende Fahrt → Auto-End
  - Implementierung: `scheduledShiftAutoEnd` in `functions/index.js` (z.B. alle 10 Min) + Fahrer-Telegram-Benachrichtigung
  - WICHTIG: Laufende Fahrten (`on_way`, `picked_up`) dürfen NIE automatisch beendet werden

### Architektur-Entscheidungen (26.03.2026):
- **Auto-Zuweisung:** Browser-Zuweisung (`auto-assign-schichtplan`) ist im Webhook-Modus DEAKTIVIERT. Cloud Function `scheduledAutoAssign` übernimmt (alle 10 Min)
- **Kalender-Sync:** `findExistingEvent()` sucht Events über Firebase-ID im gesamten Kalender (gestern bis +1 Jahr), kein Datumsfilter
- **buchen.html:** Soll eigenständige Seite werden (nicht ?mode=booking in index.html), mit gleicher Buchungslogik wie Kunden-Tab

---

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
- Änderungen an `index.html` → Build-Timestamp aktualisieren **+ `gh workflow run strato-zip.yml --ref main` PARALLEL ausführen!**
- Änderungen an `functions/index.js` → User auf `firebase deploy --only functions` hinweisen
- Änderungen an `google-apps-script/kalender-sync-v4.0.js` → User erinnern: Code manuell ins Google Apps Script kopieren
- Änderungen an beiden/allen → alles tun

---

## Strato-Deploy (WICHTIG — IMMER PARALLEL MACHEN!)

Die Fahrer-App (`index.html`) wird auf **Strato** gehostet.
**Bei JEDEM Push der `index.html` ändert MUSS Claude PARALLEL den Strato-Deploy auslösen!**

### GitHub Actions Workflow: `strato-zip.yml`

Das Strato-Deploy läuft über eine **GitHub Actions Workflow** namens **"Strato ZIP erstellen"**.
- **Workflow:** `strato-zip.yml` im Repository `Patrick061977/taxi-App`
- **Trigger:** `workflow_dispatch` (manuell) + automatisch bei Push auf `main`
- **Was es tut:** Erstellt eine ZIP-Datei mit der aktuellen `index.html` für Strato

### PFLICHT für Claude:
```bash
# Nach JEDEM git push der index.html ändert → Strato-Workflow triggern:
gh workflow run strato-zip.yml --ref main
```

### Ablauf bei index.html Änderungen:
1. `git add index.html && git commit`
2. `git push`
3. **PARALLEL:** `gh workflow run strato-zip.yml --ref main` ← NICHT VERGESSEN!
4. Prüfen: `gh run list --workflow=strato-zip.yml --limit 1`

### Regel:
- **Claude MUSS bei JEDER Änderung an `index.html` AUTOMATISCH den Strato-Workflow auslösen** — NICHT nur den User erinnern, sondern SELBER machen!
- Aktuell auf Strato: Version wird unten rechts in der Fahrer-App angezeigt (z.B. `v6.38.34`)
- Wenn Strato veraltet ist, sehen Fahrer alte Bugs/fehlendes Features

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
