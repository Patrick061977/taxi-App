# Stresstest-Plan v6.63

Strukturierter Live-Test der gesamten Auftrags-Kette: Buchung → Auto-Zuweisung → Fahrer-Push → Annehmen → on_way → picked_up → completed → Tracking, aus drei Perspektiven (Kunde / Fahrer / Admin).

Erstellt: 2026-04-27 nach v6.62.20-Deploy. Eigentümer: Patrick + Claude.

---

## 1. Setup

### Geräte (Minimal — ein Fahrer reicht für 90% der Cases)

| Rolle | Gerät | Was läuft drauf |
|-------|-------|-----------------|
| **Fahrer** | **S9** (Fahrer-Handy von Patrick) | Native APK ≥ v6.62.20, Schicht aktiv auf einem Fahrzeug (z.B. tesla) |
| **Admin/Beobachter** | Patrick-Privathandy oder Laptop-Browser | https://umwelt-taxi-insel-usedom.de — Admin-Login, Karte, Logs, Telegram-Bridge offen |
| **Kunde** | 2. Browser (inkognito) auf Laptop oder anderem Handy | https://umwelt-taxi-insel-usedom.de/Taxi-App/buchen.html + track.html |

### Ergänzungen für Multi-Fahrer-Cases (später)

| Rolle | Gerät |
|-------|-------|
| Fahrer 2 | Tesla / S20 → Fahrzeug B (z.B. opel-1) |
| Lock-Test | 2. Handy versucht zusätzlich gleiches Fahrzeug zu klauen |

### Voraussetzungen vor Test-Start

- [ ] Alle Geräte auf gleicher APK-Version (vor Test prüfen via Hamburger-Menü → "📱 Version vX.Y.Z")
- [ ] `settings/telegram/webhookActive = true` in Firebase (Cloud-Functions sind aktiv)
- [ ] `settings/telegram/adminChats` enthält genau **eine** Chat-ID (sonst kommen Pushes mehrfach an, siehe `project_fahrer-zugewiesen-spam.md`)
- [ ] Patrick lädt `kunden.html` einmal ein damit Test-Kunden-Account aktiv ist
- [ ] gcloud authentifiziert: `gcloud functions logs read healthCheck --limit 1` muss klappen
- [ ] Bridge-Outbox funktional: 1 Test-Message senden + sehen ob sie ankommt

---

## 2. Aufzeichnung — was wir loggen

| Quelle | Inhalt | Wie ausgewertet |
|--------|--------|-----------------|
| **rideLog** (`/rides/{id}/rideLog`) | Lifecycle-Schritte mit Emoji + Quelle | Admin-UI → Fahrt-Detail; oder Firebase-Console |
| **Cloud-Function-Logs** | `onRideCreated`, `onRideUpdated`, `scheduledAutoAssign`, `autoResolveConflicts`, `shiftHeartbeatPing`, `rideAction` | `gcloud functions logs read <fn> --limit 100` (live tail während Test) |
| **Bridge-Outbox** (`/claudeBridge/outbox`) | Claude pingt Patrick bei jedem auffälligen Event | Patrick im Telegram |
| **Screenshots** | Kunde + Fahrer-Dashboard + Admin-Karte gleichzeitig | Playwright (Web) + ADB-Screenshot (Native) |
| **gpsHealth** (`/gpsHealth/{vid}/history`) | letzte 30min GPS+Power-Status | Diagnose-Tab |
| **buchenLog** (`/settings/buchenLog`) | Server-side Telegram-/Status-Events | Firebase-Console |

### Test-Run-Slot in Firebase

Pro Test-Run schreiben wir einen Eintrag unter `/diagnostics/stresstests/{ts}`:

```json
{
  "startedAt": 1777300000000,
  "tester": "Patrick",
  "claudeSession": "afd45...",
  "version": { "apk": "6.62.20", "functions": "deployed-2026-04-27T13:16Z" },
  "cases": [
    {
      "id": "POI-1",
      "input": "Lidl",
      "expected": "Lidl, Ahlbecker Ch 9, 17429 ...",
      "actual": "...",
      "status": "pass | fail | skip",
      "notes": "...",
      "rideIds": ["-Oxxx"]
    }
  ]
}
```

Claude legt den Eintrag beim Test-Start an und ergänzt nach jedem Case. Patrick sagt einfach: **"Test 1: POI Lidl"** → Claude schreibt rein + tail die Logs.

---

## 3. Test-Cases — Adress-Erkennung

| # | Eingabe | Soll-Ergebnis Kunde | Soll-Ergebnis Fahrer-Dashboard | Soll-Ergebnis Native-Notification |
|---|---------|---------------------|--------------------------------|-----------------------------------|
| **A1** | "Lidl" | "Lidl, Ahlbecker Ch 9, 17429 Heringsdorf" mit Koordinaten | "Lidl, Ahlbecker Ch 9..." (POI vor Adresse) | Push-Body zeigt "Lidl..." |
| **A2** | "Bülowstraße" (ohne Hausnummer) | Hausnummer-Pflicht-Dialog | nie ankommen | nie ankommen |
| **A3** | "Bahnhof Heringsdorf" | "Heringsdorf, Bahnhof, ..." | dito | dito |
| **A4** | "Hotel Residenz Kanalstraße 1" | "Hotel Residenz, Kanalstr 1, 17424..." | "Hotel Residenz, ..." | dito |
| **A5** | nur PLZ "17424" | Straße-Pflicht-Dialog | nie ankommen | nie ankommen |
| **A6** | Tippfehler "Heringssdorf" | korrigiert auf "Heringsdorf" | dito | dito |
| **A7** | Ahlbecker Chaussee mit Hausnummer | normales Match | dito | dito |
| **A8** | Stammkunde aus CRM (z.B. Patrick Wydra) | Auto-Vervollständigung mit CRM-Adresse | "Patrick Wydra, ..." | dito |

**Bug-Marker:** wenn Field-Inhalt am Ende nur "Ahlbecker Chaussee 9" zeigt, obwohl Places-API "Lidl" als Name geliefert hat → v6.62.19-Regression. Dann Code-Inspect in `CallLogActivity.java:88-101`.

---

## 4. Test-Cases — Workflow (3-Perspektiven-Vergleich)

Pro Case: was sieht JEDE Perspektive zur gleichen Zeit?

### W1 — Sofort, Fahrer FREI

| Schritt | Kunde | Fahrer (Tesla) | Admin (S9) |
|---------|-------|----------------|------------|
| Buchung absenden | Erfolg-Card + Track-Link | (noch nichts) | rideLog Eintrag |
| 1-3s später | Status: "Fahrer zugewiesen" | 🔔 Push mit Annehmen/Ablehnen | Karte zeigt Fahrt blau |
| Annehmen tippen | Status: "🚗 Fahrer kommt" + Live-ETA | App öffnet, Status accepted | rideLog "accepted" |
| Tesla auf "On Way" | Track-Marker bewegt sich | Status: on_way | dito |
| Tesla auf "picked_up" | "🟢 unterwegs" | dito | dito |
| Tesla auf "completed" | "🏁 angekommen" | Bezahl-Dialog | rideLog completed |

### W2 — Sofort, Fahrer BESETZT (Warteschlange-Test)

Tesla ist auf Fahrt. Neuer Kunde bucht.

| Schritt | Kunde | Fahrer | Admin |
|---------|-------|--------|-------|
| Buchung absenden | Status `warteschlange`, ETA in Min | KEIN Push | rideLog: warteschlange |
| Tesla schließt Fahrt 1 ab | Status: "Fahrer zugewiesen" | 🔔 Push für Fahrt 2 | rideLog re-assign |

**Bug-Marker:** wenn Tesla während laufender Fahrt schon Push für Fahrt 2 bekommt → Cloud-Funktion überschreibt busy-Filter. Dann `autoAssignRide`-Logs prüfen.

### W3 — Vorbestellung 2h voraus

| Schritt | Kunde | Fahrer | Admin |
|---------|-------|--------|-------|
| Buchung absenden | "im System, du wirst informiert" | (nichts) | rideLog "geplant" |
| 60min vor Pickup | (nichts) | (nichts) | scheduledAutoAssign vergibt Fahrzeug |
| 15min + Anfahrt vor Pickup | "Fahrer wird losfahren" | 🔔 Push (PUSH-REMINDER v6.61.0) | dito |
| Tesla "On Way" | Track-Link aktiv | Navi-Button | dito |

### W4 — Storno durch Kunde während on_way

| Schritt | Kunde | Fahrer | Admin |
|---------|-------|--------|-------|
| Storno-Button | Bestätigung | 🔔 "❌ storniert" | rideLog "cancelled" |

### W5 — Fahrer lehnt ab

| Schritt | Kunde | Fahrer | Admin |
|---------|-------|--------|-------|
| Push reinkommen | (Status assigned) | "❌ Ablehnen" tippen | (nichts) |
| Auto-Reassign | Status: "Suche neuen Fahrer" | Push weg | rideLog "rejected" + neue Zuweisung |
| Wenn kein anderer frei | Status `warteschlange` | (nichts) | rideLog re-queue |

### W6 — Pause während Test (v6.62.21-Verifikation)

| Schritt | Fahrer | Admin |
|---------|--------|-------|
| Hamburger → Pause | Status "⏸ Pause" | online=false in Firebase |
| 2 Min warten + Heartbeat | Status bleibt "Pause" | online bleibt false ✅ |
| Online-Toggle | "🟢 Aktiv" | online=true |

---

## 5. Architektur-Audit (parallel zu den Tests)

Während wir testen, prüfen wir ob der Code wirklich macht was er soll:

### A1 — Busy-Filter in autoAssignRide

**Frage:** wenn Tesla auf Fahrt ist (status=on_way), filtert `autoAssignRide` ihn raus?
**Audit:** Cloud-Function-Code in `functions/index.js` rund um autoAssignRide lesen + verifizieren dass `busyVehicleIds` aus aktiven Rides gebildet wird.
**Fail-Markierung:** Patrick bekommt Push während besetzt.

### A2 — Warteschlange + Re-Assign nach completed

**Frage:** wenn Tesla `completed` schreibt, sucht onRideUpdated die älteste warteschlange-Fahrt und weist sie zu?
**Audit:** Code-Stelle `if (newStatus === 'completed')` in onRideUpdated suchen → existiert das überhaupt?
**Wahrscheinliches Ergebnis:** noch nicht gebaut → Aufgabe für v6.63.0.

### A3 — Konflikt zwischen 2 Vorbestellungen

**Frage:** zwei Fahrten gleicher Zeit, nur 1 Fahrzeug — wie löst autoResolveConflicts?
**Audit:** Code lesen + Cloud-Logs eines bestehenden Konflikt-Cases.

### A4 — onRideDeleted

**Frage:** Was passiert wenn Admin manuell eine Fahrt löscht während sie zugewiesen ist?
**Audit:** Trigger-Code lesen.

---

## 6. Architektur-Vorschlag — Warteschlange + Re-Assign

> Patrick: "erst wenn ich wieder frei bin, sollte mir die Fahrt zugeteilt werden"

### Schritt 1 — Audit (vor dem Bauen!)

Lesen: schreibt `autoAssignRide` heute schon Status `warteschlange` korrekt? Oder fällt sie einfach durch?

### Schritt 2 — Cloud Function `onRideUpdated` ergänzen

```js
// Neuer Block in onRideUpdated:
if (newStatus === 'completed' && oldStatus !== 'completed') {
  const vid = after.assignedVehicle || after.vehicleId;
  if (vid) {
    // Suche älteste warteschlange-Fahrt für dieses Fahrzeug oder generell
    const queueSnap = await db.ref('rides').orderByChild('status').equalTo('warteschlange').once('value');
    let oldest = null;
    queueSnap.forEach(c => {
      const r = c.val();
      if (!oldest || r.createdAt < oldest.createdAt) {
        oldest = { ...r, firebaseId: c.key };
      }
    });
    if (oldest) {
      await autoAssignRide(oldest.firebaseId, oldest);
    }
  }
}
```

### Schritt 3 — buchen.html Live-ETA für Warteschlange-Kunden

Schon teilweise da (`estimatedWaitMinutes` v6.61.2). Erweitern: alle 30s aus `_busyEndTimes` nachrechnen.

### Schritt 4 — Stresstest

3 Sofortfahrten in 2-Min-Abstand mit nur Tesla aktiv:
- Kunde 1: sofort zugewiesen
- Kunde 2: warteschlange + ETA
- Kunde 3: warteschlange + ETA (länger)
- Kunde 1 completed → Kunde 2 sofort zugewiesen
- Kunde 2 completed → Kunde 3 sofort zugewiesen

---

## 7. Ablauf am Test-Tag

### Variante A — Patrick fährt, Claude beobachtet

1. Patrick startet Test: schreibt im Telegram "stresstest start" via Bridge
2. Claude legt `/diagnostics/stresstests/{ts}` an + tail aller relevanten Cloud-Function-Logs
3. Patrick sagt jeweils: **"Test A1: POI Lidl"** (oder Test-Nummer aus dieser Datei)
4. Claude:
   - liest aktuellen Firebase-State
   - protokolliert was er sieht
   - vergleicht mit Soll-Tabelle hier
   - schreibt `pass | fail | notes` ins Diagnostik-Slot
   - meldet via Bridge: "✅ A1 pass" oder "❌ A1 fail: ..." mit konkretem Befund
5. Bei `fail`: sofort Detektiv-Modus (siehe CLAUDE.md), nicht weitermachen mit anderen Tests

### Variante B — Claude testet autonom über Browser (Playwright)

Funktioniert für **alle Cases ausser denen die zwingend die Native-APK brauchen** (Push-Empfang, native Notification, ADB-Schicht-Toggle).

| Perspektive | Wie | Was geht |
|-------------|-----|----------|
| Kunde | Playwright auf `buchen.html` mit Fake-Phone-Nr | Booking-Flow, Adresse-Eingabe, Tracking, Storno |
| Admin | Playwright auf Admin-Login | Karte, Lifecycle-Log, manuelle Zuweisung, Storno |
| Fahrer | Web-Dashboard (driver-tab in index.html) ODER ADB-Befehl an S9 wenn Native nötig | Status-Toggle, Annehmen, on_way, picked_up, completed |

**Test-Kunden — Anlegen?**
- Es gibt schon den Test-Account `+4915127585179` (Patrick Wydra) im CRM. Reicht für die meisten Cases (sequentielle Buchungen mit Storno dazwischen).
- Für **parallele Multi-Kunden-Cases** (W2 Warteschlange-Test mit 3 verschiedenen Kunden) lege ich 2-3 zusätzliche Test-Kunden an mit klar markierten Namen ("TestKunde-1", "TestKunde-2") und Phone-Nummern aus der `+4915127585XXX`-Range. Diese landen im CRM mit Tag `test=true` damit wir sie nachher in einem Rutsch löschen können.
- Echte Phone-Nummer ist für Buchung NICHT nötig (kunden.html prüft die nicht hart, SMS-Verifizierung ist optional in test-mode).

**Datenhygiene:**
- Vor dem Test: aktuellen Stand der `/rides` snapshotten (`firebase database:get /rides > snapshot-pre.json`)
- Nach dem Test: alle Test-Rides finden (`testRun=true` Tag setze ich beim Anlegen) und löschen
- CRM-Test-Kunden: bleiben drin, sind als `test=true` markiert

---

## 8. Was wir aus dem Test rausziehen

- **Pass-Liste**: was zuverlässig funktioniert → Confidence für Live-Betrieb
- **Fail-Liste**: konkrete Tickets mit Reproduktionsschritten (steht alles im Diagnostik-Slot)
- **Architektur-Schwächen**: stellen wo Code mehr macht als nötig oder zu wenig

Nach dem Test: Claude schreibt Patch-PRs für die Top-3 Fails, ggf. neue Memory-Einträge wenn Erkenntnisse session-übergreifend wichtig sind.

---

## Anhang — Bekannte Gotchas (vor dem Test lesen!)

- `settings/telegram/adminChats` mehrfach besetzt → Pushes kommen mehrfach an, fühlt sich wie Spam an, ist aber Konfig-Issue
- `autoResolveConflicts` läuft alle 5 Min — Konflikt-Tests brauchen Wartezeit oder manuellen Trigger
- `scheduledAutoAssign` läuft alle 1 Min — Vorbestellungs-Tests brauchen Geduld oder Pickup-Zeit innerhalb 60min
- Tesla-Lock: wenn S20 zwischendurch auf Tesla zugreift, kann es Lock-Konflikt geben (v6.62.11 Hard-Block aktiv)
- Pause + Heartbeat: nach v6.62.21 bleibt Pause stabil, vorher überschrieben alle 30s
- Native Places API: braucht Internet + nicht-Browser-Key (siehe `reference_api-keys.md`)

---

**Plan-Version:** 1.0  
**Erstellt nach:** v6.62.20 / v6.62.21-Cloud-Deploy  
**Eigentümer:** Patrick (Test-Driver) + Claude (Auswertung)  
**Bei Änderungen:** PR mit Begründung, Plan-Version hochzählen.
