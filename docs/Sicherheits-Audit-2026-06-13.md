# Sicherheits-Audit Firebase RTDB — 13.06.2026

**Auslöser:** Patrick 13.06.2026 14:34 — „diese Sicherheits-Lags müssen wir alle finden und stopfen"
**Methode:** Live-Tests gegen Produktiv-RTDB ohne Auth + Code-Audit der `db.ref(...)`-Reads in den drei öffentlichen HTML-Seiten

---

## A) Befund — Was ist heute öffentlich erreichbar?

### A.1 — Anonym LESBAR (Live-getestet, alle bestätigt)

| Pfad | Inhalt | Risiko | DSGVO |
|---|---|---|---|
| `/rides` | komplette Fahrten (Kunden-Name, Phone, Pickup, Coords, Destination) | 🔴 hoch | ja, schwerwiegend |
| `/tracking` | Live-GPS-Tracking-Sessions | 🟠 mittel | Stalking-Vektor |
| `/vehicles` | Fahrzeuge inkl. aktueller GPS-Position | 🟠 mittel | nein (öffentliche Daten) |
| `/drivers` | Fahrer-Daten | 🟠 mittel | ja (Namen) |
| `/vehicleShifts` | wer wann Dienst hat | 🟠 mittel | ja (Arbeitszeit) |
| `/pois` | POI-Liste | 🟢 niedrig | nein |
| `/geocache` | Adress→Koord-Cache | 🟢 niedrig | nein |
| `/settings/googleMapsApiKey` | API-Key Klartext | 🔴 hoch | Kosten-Risiko |
| `/settings/googlePlacesApiKey` | API-Key Klartext | 🔴 hoch | Kosten-Risiko |
| `/settings/telegram/pending` | LAUFENDE Buchungs-Konversationen mit Tel-Nr | 🔴 hoch wenn aktiv | ja, schwerwiegend |
| `/settings/buchenLog` | Buchungs-Versuchs-Log | 🟢 niedrig | nein |
| `/settings/calendarExport`/`tarif`/`pricing`/`bookingSystemOnline` | UI-Konfiguration | 🟢 erforderlich | nein |
| `/publicData` | beliebige Daten | 🟢 erforderlich | nein |

### A.2 — Anonym SCHREIBBAR (ohne jeglichen Auth-Check)

| Pfad | Validation | Risiko |
|---|---|---|
| `/settings/buchenLog` | KEINE (Live-getestet: Schreiben ohne Login erfolgreich) | 🟠 DB-Bloat / Spam |
| `/anfragen` | Form-Validation (name + pickup/destination) | 🟠 Spam-Anfragen |
| `/feedback/$rideId` | rating-Range + Existenz-Check | 🟢 OK |
| `/contactMessages/$msgId` | Length 2-2000 chars | 🟢 OK |

### A.3 — Anonyme Reads in den 3 öffentlichen HTML-Seiten

**buchen.html** (KRITISCH — wird beim Öffnen ausgeführt):

| Z. | DB-Ref | Was wird angezeigt |
|---|---|---|
| 1383 | `db.ref('vehicleShifts').on('value')` | Schicht-Anzeige |
| 1901 | `db.ref('vehicles').once()` | Sofort-Verfügbarkeit Vehicle-Auswahl |
| 1938 | `db.ref('rides').once()` | Vergleich aktive Fahrten |
| 2478 | `db.ref('vehicles').on('value')` | Sofort-Toggle Update |
| 2500 | `db.ref('rides').orderByChild('createdAt').limitToLast(100)` | „Position in Warteschlange" |
| 4655 | `db.ref('pois').once()` | POI-Favoriten Dropdown |
| 4659 | `db.ref('geocache').once()` | Geocache-Vorschläge |
| 4440 | `db.ref('settings/tarif').once()` | Tarif-Anzeige |
| 4450 | `db.ref('settings/pricing').once()` | Preis-Berechnung |

**anfrage.html:** KEINE direkten DB-Reads (nur Form-Submit) → unkritisch.

**index.html:** alle Reads erfolgen NACH `auth.onAuthStateChanged` mit `auth.currentUser` → safe.

---

## B) Plan — 3 Schichten

### Schicht 1 — SOFORT (heute, ohne Performance-Verlust)

| # | Aktion | Aufwand | Risiko | Performance-Impact |
|---|---|---|---|---|
| 1 | Google API-Keys in Cloud Console mit Domain-Restriction (umwelt-taxi-insel-usedom.de + funk-taxi-heringsdorf.de) | 15 Min, kein Code | sehr niedrig | 0 |
| 2 | `/tracking` `.read` auf `auth!=null` — nur Admin braucht das | 5 Min Rules-Push | niedrig | 0 (UI nutzt es nicht öffentlich) |
| 3 | `/settings/buchenLog` Schreibe-Validation: Pflicht-Felder + Längen-Begrenzung | 10 Min Rules-Push | niedrig | 0 |
| 4 | `/settings/telegram/pending` `.read` auf `auth!=null` (kritisch wegen Tel-Nr) | 5 Min Rules-Push | niedrig | 0 |
| 5 | Test-Eintrag in `/settings/buchenLog` (mein POC) dauerhaft entfernt | erledigt | — | — |

→ **Quick-Wins ohne Code-Änderung in buchen.html / index.html.**

### Schicht 2 — DIESE WOCHE (UI muss anonyme Auth bekommen oder Public-Subset)

| # | Pfad | Heute | Soll |
|---|---|---|---|
| 6 | `/rides` `.read` | true | `auth!=null` |
| 7 | `/vehicles` `.read` | true | `auth!=null` |
| 8 | `/vehicleShifts` `.read` | true | `auth!=null` |
| 9 | `/drivers` `.read` | true | `auth!=null` |

**Vorbedingung:** buchen.html muss vor diesen DB-Reads `firebase.auth().signInAnonymously()` aufrufen (oder schon einen anderen Login-State haben). Anonym-Auth = jeder Browser bekommt ein Wegwerf-Token → `auth!=null` ist erfüllt.

**Risiko ohne diesen Schritt:** Sofort-Verfügbarkeit-Anzeige bricht für nicht-eingeloggte Erstbesucher.

**Aufwand:** 1 PR mit ~10 Zeilen Code in buchen.html (Anonymous-Auth-Aktivierung + Wait) + 1 Rules-Push.

### Schicht 3 — NÄCHSTE WOCHE (echter DSGVO-Schutz)

| # | Aktion | Aufwand |
|---|---|---|
| 10 | `/publicRides`-Subset bauen: Cloud-Function spiegelt nur aktive Vehicle-Positions + „busy"-Flag aus `/rides`, OHNE Kunden-Daten | 2-3h |
| 11 | buchen.html auf `/publicRides` umstellen | 1h |
| 12 | `/rides` Read-Regel auf `auth!=null && role in (admin/fahrer/passenger-für-eigene)` | 30 Min |
| 13 | DSGVO-Vorfalls-Notiz schreiben (Datum, Befund, Fix-Datum) für Dokumentations-Pflicht | 30 Min |

---

## C) Was bleibt freizügig

Diese Pfade SOLLEN public lesbar bleiben — sie enthalten keine personenbezogenen Daten und werden für die öffentliche Buchungs-Funktionalität gebraucht:

- `/settings/calendarExport` — Buchungs-Zeitraum
- `/settings/tarif` — Tarif-Anzeige
- `/settings/pricing` — Preis-Berechnung
- `/settings/bookingSystemOnline` — System-Status
- `/settings/timeslotSettings` — Slot-Konfig
- `/settings/googleMapsApiKey` / `googlePlacesApiKey` — durch Domain-Restriction abgesichert (Schicht 1)
- `/publicData` — explizit für Public

---

## D) Was war der konkrete „Rocket"-Leak-Pfad?

**Aktuelle Hypothese:** Der Rezensent (Ian Busch, 13.06.2026) hat „Rocket" über folgende Wege bekommen können:

1. **Direkter Live-Lese-Zugriff auf `/rides` ohne Auth** — wenn ein Tag/Feld im Repo „Rocket" enthielte. Live-Suche im RTDB: kein Treffer
2. **Telegram-Bot-Verlauf** — `/settings/telegram/botlog` ist public lesbar. Live-Test: 5/13/2026-Bot-Logs einsehbar, aber kein „Rocket"-Treffer
3. **Manuelle Beobachtung** — Aufkleber, Sound-System, Innenraum-Beschriftung. Patrick bestätigt: nicht vorhanden
4. **Patrick selbst hat es im Gespräch erwähnt** — kein Anzeichen für Hack, sondern soziale Quelle

→ Keine Daten-Leak-Pfade für „Rocket" identifiziert. Wahrscheinlich soziale Quelle.

---

## E) Patricks Wahl-Optionen

1. Schicht 1 alle 5 Punkte heute umsetzen + dokumentieren
2. Schicht 2 morgen umsetzen (Anonymous-Auth + Rules-Verschärfung)
3. Schicht 3 nächste Woche

Alle Punkte sind reversibel. Schicht 1 hat 0 Performance-Impact und ist die Quick-Win-Strategie.

---

**Erstellt:** 13.06.2026 · Patrick Wydra (Funk Taxi Heringsdorf) — Sicherheits-Audit
**Status:** Phase-Plan, wartet auf Patricks Go für Schicht-1-Umsetzung
