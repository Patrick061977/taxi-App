# 📖 Funk-Taxi Heringsdorf — System-Handbuch

**Stand:** v6.63.838 (29.07.2026)
**Zweck:** Nachschlagewerk für Patrick was das System macht, wann es welche Entscheidung trifft, und wo Fehler entstehen können.

Kein Entwickler-Handbuch — geschrieben für den täglichen Betrieb.

---

## 📑 Inhalt

1. [Systemüberblick](#1-systemüberblick)
2. [Fahrt-Eingang — 5 Kanäle](#2-fahrt-eingang)
3. [Ride-Enrichment — was passiert direkt nach Anlage](#3-ride-enrichment)
4. [Auto-Zuweisung — wer wählt welches Fahrzeug](#4-auto-zuweisung)
5. [Fahrer-Push — wie kommt die Fahrt aufs Handy](#5-fahrer-push)
6. [Konflikte — Erkennung + Auflösung](#6-konflikte)
7. [Wartepool — was passiert wenn keiner will](#7-wartepool)
8. [Optimierung — kontinuierliche Verbesserung](#8-optimierung)
9. [Schichten — Wochenplan + Live-Status](#9-schichten)
10. [Ride-Abschluss](#10-ride-abschluss)
11. [Cloud Functions — was läuft wann](#11-cloud-functions)
12. [Firebase-Datenstruktur](#12-firebase-struktur)
13. [Verbindliche Regeln (Patricks Präferenzen)](#13-verbindliche-regeln)
14. [Failure-Modi](#14-failure-modi)

---

## 1. Systemüberblick

**Drei Komponenten:**

| Komponente | Wo | Zweck |
|---|---|---|
| **Web-Dispo** (`index.html`) | Browser | Vollständige Admin-Oberfläche — alles sehen + editieren |
| **Native Fahrer-App** (Android) | Fahrer-Handys | Fahrten annehmen, GPS senden, Status setzen |
| **Cloud Functions** (`functions/index.js`) | Firebase | 24/7 Auto-Zuweisung, Konflikt-Auflösung, Push-Versand |

**Datenspeicher:** Firebase Realtime Database — alles synchronisiert live zwischen Web-Dispo, Native-App und Cloud Functions.

**Rollen:**
- **Passenger** — Kunde, kann buchen (Web/Telegram)
- **Driver** — Fahrer, sieht + akzeptiert Fahrten in Native-App
- **Admin** — Patrick, sieht + kontrolliert alles (Web-Dispo + Native als Admin)

---

## 2. Fahrt-Eingang

Eine Fahrt landet auf 5 Wegen in Firebase (`/rides/{rideId}`):

### 2.1 Telegram-Bot (Kunde)
Kunde schickt Freitext oder Sprachnachricht an `@FunkTaxiHeringsdorfBot`.
KI-Analyse extrahiert Pickup/Ziel/Uhrzeit/Pax → Cloud Function `analyzeTelegramBooking` → Ride angelegt.

### 2.2 Web-App `buchen.html` (Kunde ohne Login)
Kunde tippt Adresse rein, wählt Zeit, bucht. Phone-Auth beim Absenden.

### 2.3 Web-App `kunden.html` (registrierter Kunde)
Kunde loggt sich per SMS-Code ein, sieht seine bisherigen Fahrten, bucht neu.

### 2.4 Native-App Admin (Patrick tippt manuell)
Bei Anruf: Patrick öffnet Dispo → CRM-Suche → „Neue Vorbestellung" → Adressen + Zeit + Pax → Anlegen.

### 2.5 Email-Anfrage (manuell)
Kunden-Email kommt an `taxiwydra@gmx.de` oder `taxiwydra@googlemail.com`. Claude/Patrick liest, legt manuell an, antwortet.

**Ergebnis in allen 5 Fällen:** Neuer Eintrag in `/rides/{rideId}` mit Pflichtfeldern:
`customerName`, `customerPhone`, `pickup`, `destination`, `pickupTimestamp`, `passengers`, `status: 'vorbestellt'` (oder `'new'` bei Sofortfahrt).

---

## 3. Ride-Enrichment

Sobald ein Ride angelegt ist, feuert Cloud Function `onRideCreated`. Diese macht:

### 3.1 Geocoding
Wenn `pickupLat/Lon` fehlen: Adresse → Koordinaten via Google Places oder Nominatim.

### 3.2 Routen-Berechnung
Von Pickup zu Ziel: Distanz + Dauer via Google Routes API (Fallback OSRM).
Speichert in Ride: `distance`, `duration`.

### 3.3 Preis-Kalkulation
Aus `settings/pricing` (Grundpreis + km-Tarif). Speichert in `estimatedPrice`.

### 3.4 Admin-Push
Meldung „Neue Vorbestellung" per Telegram-Bot an alle Admin-Chats (`settings/telegram/adminChats`).

### 3.5 Sofort-Zuweisung-Versuch
Bei Vorbestellung: Cloud Function versucht sofort ein passendes Fahrzeug zu finden (siehe Kapitel 4). Bei Sofortfahrt: sofort mit GPS-Check.

---

## 4. Auto-Zuweisung

**Herzstück des Systems.** Zwei Cloud Functions greifen ineinander:

### 4.1 `scheduledAutoAssign` — alle 5 Min
Läuft periodisch, schaut alle Rides im Fenster **jetzt bis +25 Min** und **jetzt+2h bis +24h** (Vorbestellungen). Versucht offene Rides (`vorbestellt`, `wartepool`, `warteschlange`, `new`) zu verteilen.

**Quick-Check** (v6.63.832): Skip wenn keine passenden Rides existieren → spart Firebase-Read.

### 4.2 `onRideUpdated` — bei jeder Änderung
Reagiert auf Ride-Änderungen. Triggert bei neuer Ride oder wenn was manuell verstellt wird ein sofortiges `autoAssignRide` für diese eine Ride.

### 4.3 Zwei Modi in `autoAssignRide`

**SOFORTFAHRT-Modus** (Pickup ≤ 15 + Anfahrt Min in Zukunft):
- **GPS first** — Fahrzeug mit kürzester GPS-Anfahrt gewinnt
- **Live-Shift-Pflicht** — nur Fahrzeuge mit `shift.status='active'` sind Kandidaten
- Fahrzeuge ohne aktive Schicht werden SOFORT abgelehnt (`Sofortfahrt: Schicht nicht live aktiv`)

**VORBESTELLUNG-Modus** (Pickup weiter in Zukunft):
- **Schichtplan-Pflicht** — Fahrzeug muss laut `vehicleShifts` zur Pickup-Zeit im Dienst sein
- **Priorität + Malus** entscheidet zwischen mehreren möglichen Kandidaten
- **GPS-Reality-Check** (v6.63.837): Wenn Pickup <2h weg + Fahrzeug frisches GPS hat und real zu weit entfernt ist → ablehnen

### 4.4 Kandidaten-Ausschluss-Reihenfolge

Für JEDES Fahrzeug prüft `autoAssignRide` diese Kriterien der Reihe nach:

1. **Kapazität** — Sitzplätze ≥ Passagiere? Wenn nein → skip
2. **Schicht `forceEnded`** heute → skip (Admin hat bewusst ausgeschaltet)
3. **Wochenplan** (nur Vorbestellung) — im Dienst zum Pickup-Datum+Zeit?
4. **Live-Shift** (nur Sofort) — `shift.status='active'`?
5. **Schicht ended / auto-ended + Pickup <4h** → skip (v6.63.568)
6. **GPS-Reality-Check** (Vorbestellung + Pickup <2h + frisches GPS) → skip wenn zu weit (v6.63.837)
7. **Schichtende-Prüfung** — Fahrtende darf Wochenplan-Ende nicht überschreiten (außer aktive Schicht)
8. **Busy-Ride-Filter** — schon auf `on_way`/`picked_up`/`arrived`? Nur bei Sofortfahrten blockierend
9. **Zeit-Konflikt** mit anderen zugewiesenen Rides des Fahrzeugs
10. **rejectedVehicles** — Fahrer hat kürzlich rejected

### 4.5 Score-Berechnung
Verbleibende Kandidaten bekommen einen Score aus:
- Anfahrtszeit (kürzer = besser)
- Anfahrtsdistanz
- Fahrzeug-Priorität aus `settings/vehiclePriorities`
- Malus aus `settings/vehiclePrioMalus` (Zeit-Malus in Min)
- Anschlussfahrt-Bonus (wenn nach vorheriger Fahrt in der Nähe)
- Homebase-Bonus (wenn Fahrzeug an Standort zurück)
- Sitzplatz-Reserve-Malus für 8-Sitzer bei Kleingruppen (v6.63.021)

**Niedrigster Score gewinnt.**

### 4.6 Assign-Persistierung
Gewinner-Fahrzeug wird in Ride geschrieben: `assignedVehicle`, `vehicleId`, `assignedTo`, `assignedVehicleName`, `assignedVehiclePlate`, `assignedAt`, `assignedBy: 'cloud-auto-assign'`. Alle Scores landen in `vehicleScores` für Transparenz.

---

## 5. Fahrer-Push

Sobald ein Fahrzeug zugewiesen ist, muss der Fahrer informiert werden.

### 5.1 FCM (Firebase Cloud Messaging) — Native-App-Push
Cloud Function `sendFCMToVehicle` schickt Push an das Handy. Voraussetzung: `vehicles/{vid}/fcmToken` ist gesetzt (kommt bei Native-App-Login + `onNewToken` — v6.63.836).

**Bei Sofortfahrten:** Full-Screen-Alert (`RideAlertActivity`) mit Sound + Vibration + „Annehmen"/„Ablehnen"-Buttons. Läuft über Lockscreen.

**Bei Vorbestellungen (Erst-Push):** Regulärer Push „Neue Vorbestellung — schau in App".

**Bei Vorbestellungen (Losfahr-Reminder):** `scheduledLosfahrCheck` sendet X Min vor Pickup einen „Jetzt losfahren"-Push.

### 5.2 90-Sekunden-Timer (Sofortfahrten)
Fahrer muss binnen 90 Sek „Annehmen" drücken, sonst → auto-reject → Ride wieder in Wartepool, Fahrzeug zu `rejectedVehicles`.

### 5.3 Kein 90s-Timer bei Vorbestellungen
Vorbestellungen bleiben am Fahrzeug bis Fahrer akzeptiert oder Cloud sie manuell verschiebt (z.B. Konflikt-Nachverdrängung).

### 5.4 Multi-Ride-Handling (v6.63.836)
`RideAlertActivity` mit `onNewIntent()`: wenn 2. Push kommt während 1. Alert offen ist → View wird auf neue Ride umgestellt. Fahrer kann beide bedienen.

### 5.5 Admin-Push
Parallel schickt Cloud Function an Admin-Chats (`settings/telegram/adminChats`) je nach Kategorie:
- Neue Fahrt → `category: new_ride`
- Statuswechsel → `status_change`
- Wartepool → `unassigned`
- Konflikt → `conflict`
- Optimierung → `optimization`

Admin kann Kategorien in `settings/adminNotifyPrefs/{chatId}` einzeln ausschalten.

---

## 6. Konflikte

Zwei Cloud Functions: `autoResolveConflicts` (kontinuierlich) + Guards in `onRideUpdated` (event-driven).

### 6.1 Wann entsteht ein Konflikt
Zwei Rides für dasselbe Fahrzeug mit überlappender Zeit:
`Ride A endet + Rückweg + Anfahrt > Ride B startet`

**Puffer** aus `settings/pricing`:
- `boardingTime` (Ein-/Aussteige-Zeit)
- `alightingTime`
- `trafficBufferMin` (Verkehr-Puffer, Default 3 Min ab v6.63.831)

### 6.2 Toleranzen (Patricks Präferenzen)
- **Overlap-Soft**: 5 Min (aus `settings/timeslotSettings.overlapToleranceSoft`)
- **Overlap-Hard**: 10 Min
- **Vorherige Fahrt früher**: erlaubt 5-15 Min nach vorn (Patrick 10.06.)
- **Folgefahrt später**: max 5 Min nach hinten
- **Bahnhofsfahrten**: FIX, nicht verschieben

### 6.3 Auflösungs-Phasen (autoResolveConflicts alle 5 Min)

**Phase -2 / -1:** Duration-Reparatur (fehlende Streckendaten) für unzugewiesene Vorbestellungen.

**Phase 0:** Schichtplan-Validierung. Fahrzeuge ohne Dienst zur Pickup-Zeit → Alternative suchen.

**Phase 1:** Zeit-Konflikt-Auflösung. Fahrt X Min früher/später legen (max 5-15 nach vorn, max 5 nach hinten).

**Phase 2:** Auto-Optimize wenn besseres Fahrzeug verfügbar (60-Min-Cooldown gegen Ping-Pong via `lastOptimizedAt`).

**Phase 3:** Priorisiertes Fahrzeug bekommt Vorrang wenn frei (60-Min-Cooldown).

### 6.4 Konflikt-Nachverdrängung (v6.63.835 P1-13, event-driven)
Wenn Fahrzeug X eine NEUE Fahrt akzeptiert und dadurch andere Vorbestellungen für X in Konflikt geraten → verdrängte Fahrt in Wartepool + `rejectedVehicles: [X]` + Admin-Push.

### 6.5 Eskalation bei unlösbarem Konflikt
1. Zeit-Shift (5-15 Min früher / max 5 später)
2. Vehicle-Swap zwischen kompatiblen Fahrzeugen
3. → Wartepool + Push „manuelle Entscheidung nötig"
4. **NIE eigenmächtig stornieren oder doppelt belegen**

---

## 7. Wartepool

**Wartepool** = Ride hat kein passendes Fahrzeug → wartet auf manuelle Zuweisung oder auf freies Fahrzeug.

### 7.1 Wann rein
- Auto-Assign findet niemanden
- 90s-Reject (Sofortfahrt)
- Konflikt-Nachverdrängung
- Manuell via Dispo

### 7.2 Was passiert im Wartepool
- Status = `wartepool`
- `statusBeforeWartepool` merkt sich alten Status
- Admin-Push „WARTEPOOL — manuelle Zuweisung"
- Cron `scheduledAutoAssign` (alle 5 Min) prüft ob jetzt ein Fahrzeug passt (v6.63.832 — Wartepool jetzt im Quick-Check enthalten)

### 7.3 Ride-Completed-Retry (v6.63.835 P1-7)
Wenn ein Fahrer eine Fahrt completed → Cloud prüft ob offene Vorbestellungen der nächsten 60 Min, die aktuell auf einem TOTEN Fahrzeug (ended/auto-ended/forceEnded) hängen, jetzt an ihn passen würden → auto-reassign + FCM-Push.

---

## 8. Optimierung

**Ziel:** aus einem legitimen Assign ein NOCH besseres machen wenn Umstände sich ändern.

### 8.1 Fenster
`autoResolveConflicts` optimiert Rides mit Pickup in **jetzt bis +24h** (nicht weiter — sonst Ping-Pong über Tage).

### 8.2 Ping-Pong-Schutz
`lastOptimizedAt` pro Ride. Wenn Ride vor <N Min schon zu Fahrzeug X optimiert wurde → Skip weitere Optimierung zu X. Verhindert dass Auto ständig zwischen 2 Fahrzeugen hin-und-her verschoben wird.

### 8.3 Wann sich Score ändern DARF
- Fahrer geht online/offline
- GPS-Position bewegt sich signifikant
- Neue Fahrt kommt dazu → Konflikt-Landschaft ändert sich
- Priorität/Malus wird manuell geändert

### 8.4 Wann optimiert wird NICHT
- Ride bereits `accepted` oder weiter (Fahrer hat es angenommen)
- `assignmentLocked=true` (Patrick hat manuell fixiert)
- `assignedBy` startet mit `native_admin_` / `claude-manual-` / `native_dashboard_grab`

---

## 9. Schichten

### 9.1 Wochenplan
`vehicleShifts/{vid}` enthält pro Wochentag Zeit-Slots (`Mo`, `Di`, ...). Auto-Assign nutzt den Plan als PFLICHT für Vorbestellungen.

### 9.2 Live-Shift (`vehicles/{vid}/shift`)
Fahrer öffnet Native-App → wählt Fahrzeug → „Schicht starten":
- `status: 'active'`
- `startTime: now`
- `driverName`, `driverUid`
- `lastHeartbeat: now`

Fahrer beendet: `status: 'ended'`, `endedAt: now`.

### 9.3 Automatik-Zustände
- **`auto-ended`** — Fahrer >12h kein Heartbeat → `scheduledShiftHeartbeatCheck` beendet automatisch
- **`forceEnded`** — Admin hat manuell im Schicht-Editor beendet (`shift-editor-aus`)
- **`stale`** — GPS >15 Min alt (v6.38.46)
- **`ended`** — normal beendet

### 9.4 Zombie-Repair (v6.63.816 + v6.63.832 Guard)
`scheduledAutoAssign` prüft: wenn `shift.status='active'` UND `endedAt` >12h alt → sollte gekillt werden. **Guard v6.63.832:** wenn `startTime > endedAt` (neue Schicht nach altem End) ODER `lastHeartbeat <15min` → NICHT killen.

### 9.5 Grace-Period (v6.63.830)
Fahrzeug mit `shift.status='auto-ended'` bleibt 15 Min lang Kandidat für Vorbestellungen — App-Update-Fenster.

### 9.6 Stale-Recovery (v6.63.834)
Wenn `staleAt` gesetzt aber `lastUpdate <5min` → automatisch clearen. Fahrzeug ist wieder grün in Dispo.

---

## 10. Ride-Abschluss

### 10.1 Native-App tippt „Fertig"
Status → `completed`, `completedAt`, `atDestinationAt`.

### 10.2 `onRideUpdated` reagiert
- **Auto-Rechnung** (Cloud Function `invoiceCreatedBy: cloud-auto-*`) — generiert PDF, uploaded, verlinkt
- **SMS an Kunde** — „Vielen Dank für die Fahrt" + ggf. Rechnungs-Link
- **Kalender-Sync** — `updatedAt` triggert Google Apps Script (5-Min-Poll)
- **activeRideStatus** cleared am Fahrzeug (v6.63.833 — grün in Kollegen-Karte)

### 10.3 Late-SMS (v6.63.832 opt-in)
Verspätungs-SMS an Kunde nur wenn `notifyLateSms=true` explizit gesetzt. Default: keine Auto-SMS.

### 10.4 Archive nach 24h
`scheduledRideAutoClose` bzw. Archive-Cron verschiebt completed Rides nach `/archiveRides` — spart Firebase-Reads.

---

## 11. Cloud Functions — Übersicht

| Function | Trigger | Zweck |
|---|---|---|
| **onRideCreated** | DB `/rides/{rideId}` create | Enrichment (Geocode, Route, Preis) + Admin-Push + Erst-Assign |
| **onRideUpdated** | DB `/rides/{rideId}` update | Alle Status-Änderungen: Push-Versand, Rechnung, Konflikt-Nachverdrängung, Completed-Retry |
| **onRideDeleted** | DB `/rides/{rideId}` delete | Fahrer + Admin informieren |
| **scheduledAutoAssign** | Cron 5 Min | Auto-Zuweisung offener Rides (25 Min + 24h Fenster), Zombie-Repair, Stale-Recovery |
| **autoResolveConflicts** | Cron 5 Min | Konflikt-Auflösung Phase 0-3 im 24h-Fenster, Optimierung |
| **scheduledOpenRideCheck** | Cron 1 Min | Warnung bei nicht-angenommenen Vorbestellungen, 90s-Reject-Handling |
| **scheduledLosfahrCheck** | Cron | Losfahr-Reminder-Push |
| **scheduledDepartureAlert** | Cron | Pre-Departure-Alarm |
| **scheduledShiftHeartbeatCheck** | Cron | Fahrzeuge ohne Heartbeat → auto-ended |
| **scheduledReachabilityCheck** | Cron | Live-ETA-Update während Fahrt |
| **scheduledRideAutoClose** | Cron | Alte Rides schließen/archivieren |
| **scheduledMorningWartepoolBriefing** | Cron 07:30 | Wartepool-Report morgens |
| **scheduledMorningBriefing** | Cron 08:03 | Generisches Morgen-Briefing |
| **scheduledEveningBriefing** | Cron 18:07 | Abend-Briefing |
| **scheduledDailyReport** | Cron 21:30 | Tages-Report mit Deep-Dive-Bewertung (v6.63.835) |
| **scheduledAutoCompletionReminder** | Cron | Erinnerung für vergessene Fahrten-Abschlüsse |
| **onAnfrageCreated** | DB `/anfragen` create | Web-Anfrage-Handling |
| **onShiftStatusChanged** | DB `vehicles/{vid}/shift/status` update | Bei Schicht-Ende Vorbestellungen umverteilen |
| **onVehicleShiftPlanChanged** | DB `vehicleShifts` update | Wochenplan-Änderungen → Re-Check aller Vorbestellungen |
| **stripeWebhook** | HTTPS | Stripe-Zahlung |
| **createStripeCheckoutSession** | HTTPS | Stripe-Link generieren |
| **regenerateInvoicePdf** | HTTPS | Rechnung-PDF neu generieren |
| **generateDailyReportManual** | HTTPS | Tages-Report on-demand (v6.63.835) |

---

## 12. Firebase-Struktur

Wichtigste Pfade:

```
/rides/{rideId}                     — Alle Fahrten (active + completed <24h)
/archiveRides/{rideId}              — Archivierte Fahrten (>24h)
/rideStatusAudit/{rideId}/{ts}      — Timeline aller Status-Wechsel pro Ride
/optimierungsLog/{key}              — Alle Optimierungs-Aktionen
/pushAudit/{vid}/{ts}               — FCM-Push-Verlauf pro Fahrzeug
/wartepoolAudit/{key}               — Wartepool-Ereignisse

/vehicles/{vid}                     — Fahrzeug-Stammdaten + Live-GPS
/vehicles/{vid}/shift               — Aktuelle Schicht (status, startTime, endedAt, lastHeartbeat)
/vehicles/{vid}/fcmToken            — Registrierter Push-Token (v6.63.836)
/vehicleShifts/{vid}/{Mo|Di|...}    — Wochenplan pro Fahrzeug + Wochentag
/shiftHistory/{vid}/{startTs}       — Historische Schichten
/shiftExceptionLog/{key}            — Manuelle Schicht-Ausnahmen

/customers/{cid}                    — CRM-Kunden
/drivers/{did}                      — Fahrer-Stammdaten
/staff/{sid}                        — Mitarbeiter-Daten

/settings/pricing                   — Grundpreis, km-Tarif, Puffer
/settings/vehiclePriorities         — Prio-Ranking Fahrzeuge (1=beste)
/settings/vehiclePrioMalus          — Zeit-Malus in Min pro Fahrzeug
/settings/telegram/botToken         — Hauptbot-Token
/settings/telegram/adminChats       — Admin-Chat-IDs (Push-Empfänger)
/settings/telegram/webhookActive    — true = Webhook-Modus
/settings/briefings                 — Morning/Evening Toggle
/settings/cloudJobs                 — Last-Run-Zeiten der Crons

/claudeBridge/inbox                 — Patrick → Claude Bridge-Nachrichten
/claudeBridge/outbox                — Claude → Patrick Bridge-Nachrichten
/errorLogs                          — App-Fehler
/debugLogs                          — Debug-Ausgabe
/logs                               — Aktivitäts-Log
```

---

## 13. Verbindliche Regeln (Patricks Präferenzen)

Alle aus dem Memory-System. Diese Regeln sind **verpflichtend** für Cloud-Function-Verhalten und Claude-Aktionen:

### Zuweisung
- **NIE eigenmächtig Fahrzeuge zuweisen** — Claude liefert Diagnose, nicht Auto-Verteilung
- **First-Come-First-Served**: frühere Pickup-Zeit hat Vorrang
- **Bahnhofsfahrten FIX**: nicht verschieben, andere Fahrzeuge weichen aus
- **Schichtplan = Fahrzeug, nicht Fahrer**: „Prius IK kein Dienst" statt „Kulpa kein Dienst"
- **Vorbestellung nur an Fahrzeuge im Schichtplan** (online-Status reicht nicht)

### Konflikt
- **Minimum-Disruption**: eine Fahrt 5-15 Min vorverlegen statt zwei Fahrzeuge umzuplanen
- **10-15 Min auseinanderziehen** bei Engpass als Vorschlag
- Toleranz: früher 15 Min ok, später max 5 Min
- **5-Min-Karenz beide Richtungen** (v6.63.435)

### Kundenkommunikation
- **NIE eigenmächtig an Kunden senden** — nur nach explizitem OK zum Preview
- **Auto-SMS „wird später" NUR bei `notifyLateSms=true`** (opt-in, v6.63.832)
- **Antworten via Claude-Bot**, nicht Hauptbot (für Bridge)
- **Auftraggeber-Rechnung ohne z.Hd.Gast** (Fahrgast in Body, nicht Anschrift)

### CRM
- **Beim Fahrt-Anlegen IMMER Kunde im CRM anlegen** wenn nicht vorhanden

### Adressen
- **NIEMALS `===` für Adress-Vergleich** — immer Koordinaten zuerst, dann `.includes()`
- **Buchungs-Kontext NIEMALS wegwerfen** — pending.partial klonen, nur geändertes Feld leeren

### Fahrzeug-Präferenzen
- **Tesla YM222 = Springer-Konzept** — kein Wochenplan, nur manuell-Lock pro Fahrt
- **Vetter Touristik**: immer 1 Fahrzeug für Sammel+Verteil Interferie Swinemünde

### Mails
- **Formell** — „Sehr geehrte/r ...", knapp, mit Signatur
- **Datum aus pickupTimestamp** — nicht pickupTime allein

### Deploy
- **Kein Bridge-Spam in Loops** — max 1 Nachricht pro Task-Abschluss
- **Nach jedem Merge CHANGELOG.md aktualisieren**
- **Native App**: bei `android/**`-Änderung IMMER `versionName`+`versionCode` hoch
- **Build-Timestamp** nach `index.html`-Änderung setzen

---

## 14. Failure-Modi

### 14.1 FCM-Push kommt nicht an
**Ursachen:**
- Kein `fcmToken` in DB (v6.63.836 Fix)
- Token abgelaufen (UNREGISTERED)
- Native App wurde von Android gekillt (Battery-Optimization)
- Notification-Channel muted / kein Sound
- Handy Silent-Mode

**Cloud-Function sieht keinen Fehler** — sie sendet an Telegram API, API sagt OK, das war's. Zustellung auf Handy nicht nachweisbar.

### 14.2 Fahrer wird „grau" in Kollegen-Karte
- `staleAt` in DB gesetzt, wird nicht gecleared → **v6.63.834 Stale-Recovery fixt**
- `dispatchStatus='online'` wurde als „unbekannt" gewertet → **v6.63.833 fixt**
- `activeRideStatus` nicht gesetzt → **v6.63.833 fixt**

### 14.3 Schicht wird fälschlich beendet
- Zombie-Repair killt neue Schicht weil altes `endedAt` nicht gecleared → **v6.63.832 Guard fixt** (`startTime > endedAt` oder `lastHeartbeat<15min` = safe)
- Native App löscht `endedAt` beim Login noch nicht → offen (App-Fix nötig)

### 14.4 Fahrzeug bekommt Fahrt die es real nicht schaffen kann
- Vorbestellungen ignorierten GPS bisher → **v6.63.837 GPS-Reality-Check bei Pickup <2h**
- Zeit-Konflikt-Check hatte Lücke bei nachträglicher Akzeptierung → **v6.63.835 P1-13 Konflikt-Nachverdrängung**

### 14.5 Wartepool-Fahrt wird nicht neu verteilt
- Quick-Check von `scheduledAutoAssign` ignorierte `wartepool`-Status → **v6.63.832 fixt**
- Ride-completed-Retry fehlte → **v6.63.835 P1-7 fixt**

### 14.6 Fahrer kann keine 2. Fahrt annehmen
- `RideAlertActivity` (singleTask) hatte kein `onNewIntent` → 2. Push zeigt alte Daten → **v6.63.836 fixt**

### 14.7 Nicole-Muster (silent auto-shift)
- Zeit-Shift ohne `activityLog` / `rideStatusAudit` → offen (P1-4)
- Fix-Vorschlag: universelle `pickupTimestampAudit` bei jeder Änderung

### 14.8 Sylvia-Muster (Instant-Heal-Race)
- `scheduledDepartureAlert` setzt `assigned`, `scheduledAutoAssign` setzt zurück auf `vorbestellt` → Loop → offen (P1-6)
- Fix-Vorschlag: Marker in separates Feld statt Status

### 14.9 Alerts landen im Hauptbot statt Claude-Bot
- `sendToAllAdmins` nutzt `loadBotToken()` = Hauptbot → offen (P1-8)
- Patrick nutzt Hauptbot nicht → Alerts kommen nicht an

---

## Änderungshistorie

- **v6.63.838** (29.07.2026): Handbuch erstellt.

---

**Bei Änderungen an Cloud Functions / Native App / Web-Dispo dieses Handbuch pflegen.**
