# Zuweisungs-Routine — Lebenszyklus einer Fahrt

**Stand:** v6.66.208 (04.10.2026)

Was passiert zwischen "Fahrt angelegt" und "Fahrt completed" — welche Regeln, welche Cloud Functions, welche Timeouts, welche Banner.

---

## 0. Trigger — Wann startet die Zuweisung?

| Trigger | Wann | Was tut er |
|---|---|---|
| **`onRideCreated`** (DB-Trigger) | Sofort bei neuer Ride | Admin-Push + ggf. direkt `autoAssignRide()` |
| **`scheduledAutoAssign`** (Cron 5 Min) | alle 5 Min | Lädt unzugewiesene new/warteschlange/wartepool-Rides + Vorbestellungen die in <25 Min starten → ruft `autoAssignRide()` pro Ride |
| **Admin manuell** | Button "🚗 Fahrer zuweisen" im admin-view / Dispo-Zentrale | `assignVehicleToRide()` setzt `assignedVehicle` + `assignmentLocked=true` + `assignedBy='claude-manual-...'` |

**Quick-Check-Optimierung** (v6.63.234): `scheduledAutoAssign` prüft zuerst ob überhaupt etwas zu tun ist (keine new/wartepool/Vorbestellung in <25 Min) — bei Idle Early-Return, spart 99% Reads.

---

## 1. `autoAssignRide` — Die Zuweisungs-Logik

### Safety-Guards (brechen sofort ab)
- `status === 'picked_up'` / `on_way` / `completed` → Fahrzeug läuft schon
- `assignmentLocked === true` → Admin hat manuell gelockt, Auto-Logic darf nicht ran
- `_allDriversTried === true` → bereits alle Fahrzeuge probiert

### Scoring (bestes Fahrzeug finden)
- **Priorität** (vehicle.priority, kleiner = besser)
- **Anfahrtzeit** (Google Routes TRAFFIC_AWARE, OSRM Fallback)
- **Schichtplan-Check** (`isVehicleAvailableAtSlot`) — Fahrzeug muss zur Pickup-Zeit Dienst haben
- **Push-fähig** (FCM-Token vorhanden, nicht `NotRegistered`)
- **30-Min-Hard-Cutoff** (`autoOptimierungVorlaufMinuten`): unter 30 Min Vorlauf keine Auto-Reassignment mehr

### Zuteilung
```
assignedVehicle = <best.vid>
assignedBy = 'cloud-auto-assign'
assignmentExpiresAt = Date.now() + 60_000   // 1 Min Offer-Timeout
estimatedArrivalAt = Date.now() + Anfahrt*60s
```
→ FCM-Push `ride_offer` an Fahrer-App.

### Caching (v6.63.648)
30s In-Memory-Cache für Rides+Vehicles — verhindert bei N Rides N×7 Firebase-Reads pro Cron-Lauf.

---

## 2. Was passiert nach dem Push an den Fahrer?

| Fahrer-Reaktion | Ergebnis |
|---|---|
| **✅ Akzeptiert** (Button in Native-App) | `acceptedAt`, `status='accepted'`, Push an Admin + Kunde (Bestätigung + Tracking-Link) |
| **❌ Abgelehnt** | `rejectedBy[]` erweitert, `assignedVehicle=null` → `autoAssignRide` nochmal mit `excludeVehicleIds=[alt]` → nächstes Fahrzeug probieren |
| **⏱ Timeout (60s)** | `assignmentExpiresAt` abgelaufen → Watchdog (`scheduledOpenRideCheck`) räumt `assignedVehicle` auf → nächstes Fahrzeug im Cron |
| **📵 FCM `NotRegistered`** | `fcm-notregistered-watchdog` (v6.66.203) → sofort in Wartepool + Admin-Alert |

### Push-Verlauf (lesbar in `showRideDetailsModal` → ANGEBOTS-VERLAUF, v6.66.205)
Pro Fahrzeug chronologisch:
- 📤 Push gesendet
- 📬 Push empfangen (App offen / Hintergrund)
- ⏰ Timeout / ✓ ANGENOMMEN / ✗ Rejected

Daten aus: `pushHistory` + `pushReceivedHistory` + `timeoutHistory` + `rejectHistory` + `acceptedAt/ByVehicle`.

---

## 3. `autoResolveConflicts` — Konflikt-Auflösung (Cron 5 Min)

Phase-Hierarchie (CLAUDE.md ist Autoritäts-Quelle):

| Phase | Was | Toleranz |
|---|---|---|
| **-2** | Duration-Reparatur (fehlende drivingTime) | — |
| **-1** | Unzugewiesene Vorbestellungen in <60 Min | — |
| **0** | Schicht-Validierung: Fahrzeug ohne Dienst zur Pickup-Zeit → Alternative | 15-Min-Heartbeat-Grace |
| **1** | Zeit-Konflikt: curr.endeMs + leerfahrtMin > next.pickupTimestamp → Vehicle-Swap oder Zeit-Shift | ±5-15 Min früher, max 5 Min später |
| **2** | Auto-Optimize wenn besseres Fahrzeug verfügbar | 60-Min-Cooldown gegen Ping-Pong |
| **3** | Prio-Time-Re-Sort: höher priorisiertes Fahrzeug frei → tauschen | 60-Min-Cooldown |

### Regeln (aus Patrick's Konflikt-Lösungs-Katalog)
- **Minimum-Disruption**: lieber EINE Fahrt um 5-15 Min verschieben als 2 Fahrzeuge umplanen
- **Bahnhofsfahrten FIX**: Pickup/Dropoff am Bahnhof = nicht verschieben
- **First-Come-First-Served**: Frühere Pickup hat immer Vorrang
- **Lock schlägt alles**: `assignmentLocked=true` → Phase 0/2/3 nie umverteilen

---

## 4. Was triggert den Wartepool?

Eine Ride landet in `status='wartepool'` wenn:

1. **Alle Fahrzeuge haben abgelehnt** (`autoAssignRide` findet nichts mehr nach `_allDriversTried`)
2. **Vorbestellung zugewiesen aber nie akzeptiert** (`scheduledOpenRideCheck` v6.63.770): <15 Min vor Pickup + `assignedVehicle` + kein `acceptedAt` → status='wartepool', Fahrzeug freigeben, Admin-Push
3. **FCM-Token kaputt** (`fcm-notregistered-watchdog` v6.66.203)
4. **Admin stornoiert Zuweisung** manuell

→ Danach versucht `scheduledAutoAssign` beim nächsten Lauf (5 Min) wieder.

---

## 5. Wann kommt die Fahrt in welchen Banner?

### Admin-View (`admin-view` in index.html)

| Banner | Bedingung | Code |
|---|---|---|
| **🚨 unaccepted-overdue-banner** (v6.66.202) | expiredRides (new/vorbestellt + Pickup >1h vorbei) + `assignedVehicle` + kein `acceptedAt` | Zeile ~30340 |
| **⚠️ wartepool-admin-section** (v6.66.208) | status='wartepool' ODER (status='new'/'sofort' ohne Fahrzeug + Pickup <60 Min) | Zeile ~30099 |
| **📋 Offene Fahrten** | status ∈ {vorbestellt, new, akzeptiert, accepted, unterwegs, picked_up, angekommen} + Pickup <1h vorbei | upcoming-rides-admin |
| **⏰ Abgelaufen** | status ∈ {new, vorbestellt} + Pickup >1h vorbei | expired-rides-admin |
| **💾 Abgelehnt** | status='rejected' | rejected-rides-admin |

### Native-App (`AdminDashboardActivity.java`)

| Banner | Bedingung | Fix |
|---|---|---|
| `admin_wartepool_banner` | wartepoolRides.size > 0 | v6.66.167: bleibt sichtbar bei dringlichen (<30 Min) Fahrten auch wenn Anfragen-Banner aktiv |

### Dispo-Zentrale (`disposition-view`)

| Banner | Bedingung |
|---|---|
| `dispo-wartepool-banner` | status='wartepool' ODER (new/sofort + kein assignedVehicle) |

### Dispo-Cockpit (`dispo-cockpit-view`, v6.66.204)

| Section | Bedingung |
|---|---|
| `dc-active` | assignedVehicle+unaccepted mit Pickup -30/+60 Min — zeigt Push-Status-Badge pro Ride |

---

## 6. Vermittlungs-Chronik (wo sehe ich den Verlauf?)

**📜 Chronik-Button** öffnet `showRideDetailsModal` → **ANGEBOTS-VERLAUF**-Block (v6.66.205).

Verfügbar in:
- Admin-View offene/abgelaufene/abgelehnte Fahrten (v6.66.207)
- Dispo-Zentrale: pro Fahrt-Zeile + Wartepool-Zeile (v6.66.207)
- Dispo-Cockpit `dc-active`: Chronik-Button (v6.66.204)
- Wartepool-Admin-Section: Chronik-Button (v6.66.208)

Chronik zeigt pro Fahrzeug chronologisch: Push gesendet → empfangen → Timeout/Angenommen/Rejected. Daten-Quellen siehe Abschnitt 2.

---

## 7. Idealer End-to-End-Flow (Vorbestellung in 30 Min)

1. **t-30 Min**: `scheduledAutoAssign` findet Ride → `autoAssignRide` → bestes Fahrzeug Vito → Push gesendet
2. **t-29 Min**: Fahrer tippt "Annehmen" → `acceptedAt`, status='accepted' → Kunde erhält Push "Fahrzeug kommt"
3. **t-15 Min**: `scheduledDepartureAlert` sendet Reminder "losfahren!" an Fahrer
4. **t-5 Min**: Fahrer startet, status='on_way' → GPS-Tracking live
5. **t±0**: Fahrer am Pickup, Kunde steigt ein, status='picked_up'
6. **t+15**: Fahrer am Ziel, status='completed' → `onRideUpdated` triggert `processAutoInvoice` → PDF via Puppeteer
7. Admin sieht in Chronik: komplette Verlaufs-Zeile

## 8. Fehlerpfade

| Problem | System-Reaktion |
|---|---|
| Fahrer offline | FCM-Token-Check → wenn NotRegistered → Wartepool + Alert |
| Fahrer akzeptiert nicht in 60s | Watchdog räumt `assignedVehicle` → nächstes Fahrzeug |
| Alle Fahrzeuge abgelehnt | `_allDriversTried=true` → Wartepool → Admin muss manuell |
| Schichtplan nicht erfüllt | Phase 0 in autoResolveConflicts → Alternative suchen |
| Zeit-Konflikt zu nahe | Phase 1 → 5-15 Min Zeit-Shift oder Vehicle-Swap |

---

**Übersicht der Cloud Functions:**
- `onRideCreated` — DB-Trigger, Admin-Push
- `onRideUpdated` — DB-Trigger, Fahrer-Push + Kunden-Bestätigung
- `onRideDeleted` — Admin + Fahrer informieren
- `scheduledAutoAssign` — Cron 5 Min, Zuweisungs-Haupt-Logik
- `scheduledOpenRideCheck` — Cron 5 Min, 10-Min-Warnung + Wartepool-Konvertierung
- `autoResolveConflicts` — Cron 5 Min, Konflikt-Phasen 0-3
- `scheduledDepartureAlert` — Cron, Losfahr-Reminder
- `onInvoicePdfRegenRequested` — DB-Trigger auf `needsPdfRegeneration=true`
