# 📱 Schichtplan-Einstellungen — Vollständige Doku

Stand v6.62.525 (09.05.2026). Alles was du im **Schichtplan-Tab** ändern kannst, was es bewirkt und ob die Änderung sofort greift.

---

## Abschnitt 1: Fahrzeug-Verfügbarkeit (Wochenkalender)

### 🚗 Wochenplan
- **Wo:** Schichtplan → Top der Seite, Wochen-Kalender mit ◀ ▶ zum Blättern.
- **Was:** Pro Fahrzeug × Wochentag — ist das Auto verfügbar oder nicht.
- **Klick auf Tag** = Ausnahme nur für diese Woche (additiv).
- **Speicherung:** `/vehicleShifts/{vehicleId}/{YYYY-MM-DD}` (Ausnahme) oder `/vehicleShifts/{vehicleId}/defaults/{0-6}` (Wochen-Default).
- **Greift sofort:** ✅ Cloud Function `autoAssignRide` und `autoResolveConflicts` lesen `vehicleShifts` bei jeder Zuweisung neu (nicht gecacht).

### ⚙️ Standard-Tage (Button rechts oben)
- **Wo:** Schichtplan → 🚗 Fahrzeug-Verfügbarkeit → ⚙️ Standard-Tage.
- **Was:** Standard-Wochenplan pro Fahrzeug — z.B. Tesla Mo-Fr aktiv, Sa-So aus. Plus Standard-Zeiten (HH:MM von/bis) pro Tag.
- **Speicherung:** `/vehicleShifts/{vid}/defaults/{dow}` (true/false) und `/vehicleShifts/{vid}/defaultTimes/{dow}/{start,end}`.
- **Greift sofort:** ✅ Beide Cloud Functions lesen das jeden Lauf neu.

### 📍 Standort pro Fahrzeug
- **Wo:** Innerhalb Wochenplan → Klick auf Fahrzeug → 📍 Standort.
- **Was:** Heimatstandort des Fahrzeugs. Nur relevant wenn Fahrzeug GPS aus hat — dann rechnet das System Leerfahrt ab Heimat.
- **Speicherung:** `/vehicles/{vid}/homeLocation` + `homeCoords`.
- **Greift sofort:** ✅ `estimateVehicleLeerfahrt` liest es bei jedem Score-Vorgang.

### 🔄 Standard anwenden (Button)
- **Was:** Setzt alle Einzeländerungen dieser Woche zurück.
- **Greift sofort:** ✅

---

## Abschnitt 2: ⚙️ Einstellungen (aufklappbarer Block)

### 🏆 Zuteilungs-Priorität

#### Reihenfolge ↑↓
- **Was:** Reihenfolge der Fahrzeuge (1, 2, 3...). Prio 1 = bevorzugt.
- **Speicherung:** `/settings/vehiclePriorities/{vid}` = Zahl 1..N.
- **Greift sofort:** ✅ — und löst `rebuildVehicleScoresForFutureRides()` aus, das alle zukünftigen Fahrten neu bewertet (sichtbar in der Tabelle innerhalb 1 Sek).

#### 🆕 Pro-Fahrzeug Prio-Malus-Override (v6.62.518)
- **Wo:** Direkt in der Fahrzeug-Liste, kleines Eingabefeld pro Fahrzeug („🏆 Prio-Malus").
- **Was:** Überschreibt die Formel `(Prio-1) × Prio-Vorteil`. Z.B. Tesla auf 999 → Tesla nur als letzte Wahl.
- **Speicherung:** `/settings/vehiclePrioMalus/{vid}` = Zahl in Min.
- **Greift sofort:** ✅ Browser + Cloud Function. Toast-Bestätigung beim Speichern.
- **Reset:** ↺-Button neben dem Feld → zurück auf automatisch.

#### ⚖️ Zuteilungs-Modus (Slider 0–60 Min/Stufe)
- **Was:** Penalty pro Rang-Stufe. 0 = faire Verteilung (Prio egal), 60 = strikt (Prio 1 fast immer).
- **Speicherung:** `/settings/pricing/priorityAdvantageMinutes`.
- **Greift sofort:** ✅ — Live-Vorschau-Tabelle zeigt sofort die neuen Werte. Cloud Functions lesen es bei jeder Zuweisung neu.

#### Live-Vorschau-Tabelle
- Zeigt für aktuelle Einstellungen, welcher Score-Aufschlag pro Fahrzeug entsteht.

---

### ⏱ Wartezeit pro Zwischenstopp (Default für Auftrag-Import)
- **Slider:** 0–15 Min, Default 3.
- **Was:** Beim Auftrag-Import (Sammeltransfer-PDF) wird pro Zwischenstopp diese Wartezeit eingerechnet.
- **Speicherung:** `/settings/pricing/waypointDwellMin`.
- **Greift sofort:** ✅ Bei nächstem PDF-Import. In der Vorschau-Card pro Stopp einzeln nachjustierbar mit +/−.

---

### 📋 Zuteilungs-Log
- **Was:** Anzeige & Filter über alle automatischen Fahrzeug-Zuweisungen.
- **Speicherung:** `/optimierungsLog/*` (keine Einstellung).
- **Filter:** Quelle (Startup, Optimierung, Neue Buchung, Bearbeitung, Leerfahrt-Replan, Schicht-Fix, Telegram, Express), Zeit (Heute / Alle), Anzahl (10/20/50/100).
- **Greift:** Anzeige-Filter sofort.

---

### 📡 Telegram System-Ticker
- **Toggle:** On/Off.
- **Event-Filter:** Auto-Zuweisungen / Umplanungen / Schicht-Korrekturen / Express-Vermittlungen.
- **Speicherung:** `/settings/systemTicker/{enabled, events}`.
- **Greift sofort:** ✅ Cloud Function-Pushes ab dem Toggle.

---

### ⏰ Auto-Optimierungs-Intervall
- **Buttons:** 10 / 30 / 60 / 120 Min.
- **Was:** Wie oft Cloud Function `autoResolveConflicts` läuft.
- **Speicherung:** `/settings/pricing/autoOptimierungIntervall`.
- **Greift:** ⚠️ Erst nach **Cloud Function Re-Deploy** (`firebase deploy --only functions:autoResolveConflicts`) — der Schedule-Trigger ist beim Function-Deploy fest. Manuelles Triggern aber jederzeit per Debug-Button möglich.
- **Effektiv aktuell:** 5 Min (festes Schedule).

---

### 🔍 Optimierung debuggen
- **Button:** „🔍 Debug per Telegram anfordern".
- **Was:** Der nächste 5-Min-Lauf der Cloud Function sendet einen detaillierten Telegram-Bericht mit Schichtplan, Konflikten, Zuweisungs-Gründen.
- **Greift sofort:** ✅ (markiert ein Flag in Firebase, Cloud Function reagiert beim nächsten Lauf).

---

### ⚡ Überlappungs-Toleranz

#### 🟡 Soft-Grenze (0–20 Min)
- **Was:** Bis zu X Min Überschneidung → Fahrzeug wird mit gelber Warnung zugeteilt. Default 0.
- **Speicherung:** `/settings/timeslotSettings/overlapToleranceSoft`.

#### 🔴 Hard-Grenze (0–30 Min)
- **Was:** Ab X Min Überschneidung → Fahrzeug wird ausgeschlossen, anderes muss übernehmen. Default 10.
- **Speicherung:** `/settings/timeslotSettings/overlapToleranceHard`.

#### ⏱️ Mindest-Abstand zwischen Aufträgen (0–60 Min, 5er-Schritte)
- **Was:** Garantierte Pause zwischen Auftragsende und nächstem Start. 0 = aus.
- **Speicherung:** `/settings/pricing/mindestAbstandMin`.

**Greift sofort:** ✅ alle drei. Cloud Function `autoResolveConflicts` liest sie pro Lauf.

---

### 📅 Sofort vs. Vorbestellung

#### Grenze Sofort/Vorbestellung (Dropdown 15–120 Min)
- **Was:** Buchungen unter X Min Vorlauf → GPS-Sofortvermittlung. Ab X Min → Schichtplan-Zuweisung.
- **Default:** 60 Min.
- **Speicherung:** `/settings/pricing/autoOptimierungVorlaufMinuten`.
- **Greift sofort:** ✅ Cloud Function liest es pro Buchung.

#### 🛰️ Rückkehr-Puffer (kein GPS) (Dropdown 0–60 Min)
- **Was:** Pause zwischen Aufträgen ≥ Puffer → System rechnet ab Heimatstandort. Pause < Puffer → ab letztem Ziel.
- **Wichtig:** Greift NUR wenn GPS aus ist. GPS-online → echte Position hat IMMER Vorrang.
- **Default:** 30 Min.
- **Speicherung:** `/settings/pricing/standortRueckkehrPufferMinuten`.
- **Greift sofort:** ✅

---

### 🔗 Anschlussfahrt-Erkennung

#### Zeitfenster (Slider 5–60 Min, 5er-Schritte)
- **Was:** Pause < Zeitfenster UND Abholort nah → Anschlussfahrt (Fahrer bleibt vor Ort, kein Heim-Zwischenstopp).
- **Default:** 20 Min.
- **Speicherung:** `/settings/pricing/anschlussfahrtZeitfensterMin`.

#### Radius (Slider 1–20 km)
- **Was:** Max. Entfernung letztes Ziel → nächster Abholort, ab der noch als Anschlussfahrt zählt.
- **Default:** 5 km.
- **Speicherung:** `/settings/pricing/anschlussfahrtRadiusKm`.

#### Anschlussfahrt-Bonus (Slider 0–20 Min)
- **Wo:** In der Lastverteilungs-Box.
- **Was:** Bonus auf den Score wenn Anschlussfahrt erkannt — Fahrzeug bekommt -X Min im Score = wird bevorzugt.
- **Default:** 5 Min.
- **Speicherung:** `/settings/pricing/anschlussfahrtBonusMinuten`.
- **Greift sofort:** ✅

---

### ⚖️ Intelligente Lastverteilung

#### Lastenmalus (Slider 0–15 Min/Mehrfahrt)
- **Was:** Pro Fahrt über dem Schnitt aller Fahrzeuge wird X Min Score-Strafe aufgeschlagen.
- **Beispiel:** Mercedes hat 5 Fahrten (Schnitt 3) → +6 Min bei Lastenmalus=3.
- **Default:** 5 Min (aktuell).
- **Speicherung:** `/settings/pricing/lastverteilungMalusMinuten`.
- **Greift sofort:** ✅ Cloud Functions + Browser.

---

### 📅 NEU: Optimierung pro Wochentag (v6.62.520/525)

Eigene **Top-Level-Box** unter Lastverteilung. Pro Wochentag (Mo–So) eigene Werte für:

#### Prio-Vorteil pro Tag
- **Wo:** Tag-Tab wählen → Eingabefeld „🏆 Prio-Vorteil".
- **Speicherung:** `/settings/optimizationByDay/{Mo|Di|...|So}/prioVorteil`.
- **Leer = global** (Fallback auf `priorityAdvantageMinutes`).

#### Lastenmalus pro Tag
- **Wo:** Tag-Tab → Eingabefeld „⚖️ Lastenmalus".
- **Speicherung:** `/settings/optimizationByDay/{day}/lastenmalus`.
- **Leer = global** (Fallback auf `lastverteilungMalusMinuten`).

#### Pro Fahrzeug Malus pro Tag
- **Wo:** Tag-Tab → unter „🚗 Pro Fahrzeug" — eine Zeile pro Fahrzeug.
- **Speicherung:** `/settings/optimizationByDay/{day}/vehicleMalus/{vid}`.
- **Hierarchie:** Tag-Override > globaler Override (`vehiclePrioMalus`) > Formel.

**Greift sofort:** ✅ Browser + Cloud Function (Resolver `getOptForTimestamp(pickupTimestamp)` an 3 Stellen: `autoAssignRide`, `autoResolveConflicts`, `scheduledAutoAssign`).

**Tag-Indikatoren:**
- 🟢 „heute" Label am aktuellen Wochentag
- 🔴 Roter Punkt am Tab-Tag wenn dieser Tag Override-Werte hat
- Inputs werden lila eingefärbt wenn Override aktiv

**Save-Toast:** „✅ {Tag}: {Feld} = {N} Min gespeichert" zur Bestätigung.

---

### ⏰ Zeitpuffer-Einstellungen (aufklappbar)

#### Standard-Fahrtdauer (Slider 5–30 Min)
- **Was:** Notfall-Wert wenn OSRM nicht erreichbar.
- **Default:** 10 Min.
- **Speicherung:** `/settings/pricing/standardRideDurationMin`.

#### Standard-Fahrzeit zwischen Fahrten (Slider 2–20 Min)
- **Was:** Notfall-Wert für Anfahrtszeit ohne OSRM.
- **Default:** 5 Min.
- **Speicherung:** `/settings/pricing/standardTravelTimeMin`.

#### Ein-/Aussteigezeit (Slider)
- **Was:** Boarding-Zeit, wird zur Fahrtdauer addiert.
- **Speicherung:** `/settings/pricing/boardingTime`, `alightingTime`.

**Greift sofort:** ✅ alle.

---

## Wo greift was — Cheat-Sheet

| Setting | Browser | Cloud Function | Native App |
|---------|---------|----------------|------------|
| Wochenplan / Standard-Tage | ✅ sofort | ✅ pro Lauf | ❌ kein direkter Effekt |
| Heimatstandort | ✅ | ✅ | ❌ |
| Prio-Reihenfolge | ✅ + Rebuild | ✅ | ❌ |
| Per-Fahrzeug Prio-Malus | ✅ + Rebuild | ✅ | ❌ |
| Prio-Vorteil global | ✅ | ✅ | ❌ |
| Per-Wochentag Override | ✅ + Rebuild | ✅ | ❌ |
| Lastenmalus | ✅ | ✅ | ❌ |
| Vorlauf-Grenze | ✅ | ✅ | ❌ |
| Rückkehr-Puffer | ✅ | ✅ | ❌ |
| Anschlussfahrt | ✅ | ✅ | ❌ |
| Überlappungs-Toleranz | ✅ | ✅ | ❌ |
| Mindest-Abstand | ✅ | ✅ | ❌ |
| Zeitpuffer | ✅ | ✅ | ❌ |
| Telegram-Ticker | — | ✅ | ❌ |
| Optimierungs-Intervall | — | ⚠️ Re-Deploy | ❌ |

---

## Test ob ein Setting wirklich greift

1. **Setting ändern** in der UI.
2. **Save-Toast** erscheint („✅ ... gespeichert"). Wenn nicht: Browser-Cache leeren (Strg+Shift+R).
3. **Firebase-Pfad checken** (kann ich dir auf Wunsch direkt prüfen): z.B. `/settings/vehiclePrioMalus`.
4. **Auf Wirkung warten:** entweder eine neue Buchung anlegen oder warten bis `autoResolveConflicts` (alle 5 Min) läuft. Im Zuteilungs-Log siehst du dann den Score-Breakdown mit den neuen Werten.

---

## Häufige Fragen

**„Mein Per-Wochentag-Override greift nicht."**  
→ Berlin-Wochentag wird aus Pickup-Timestamp ermittelt. Test: Vorbestellung am Sonntag um 14:00. Im Zuteilungs-Log → die Score-Breakdown sollte den Sonntag-Wert nutzen. Falls nein: Browser-Cache.

**„Was ist Prio-Vorteil 0 vs. Lastenmalus 5?"**  
→ Prio 0 = Reihenfolge spielt keine Rolle. Lastenmalus 5 = pro Mehrfahrt 5 Min Strafe → System verteilt fair zwischen gleichwertigen Fahrzeugen. Aktuell so eingestellt = empfohlen.

**„Tesla soll nur Backup sein."**  
→ Tesla-Zeile → Prio-Malus-Override = 999. Greift global. Bei Sofortfahrten + GPS aktiv ist die Logik aktuell überschrieben (echte Position zählt) — nur bei Vorbestellungen 100% wirksam.

**„Werner-Duplikat-Bug — passiert das wieder?"**  
→ Nein, ab v6.62.523 prüft die Native CRM-Suche und Anrufliste vor dem Anlegen ob für den Kunden schon eine aktive Buchung ±15 Min existiert.
