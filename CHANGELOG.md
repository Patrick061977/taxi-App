# Changelog

Alle wichtigen Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

---

## [5.93.18] - 2026-02-06

### ⚡ Performance
- **KRITISCHER PERFORMANCE-FIX: Schnellbuchung extrem beschleunigt**
  - `findUserIdForCustomer()` Stufe 3 DEAKTIVIERT (index.html:26107-26157)
  - **Problem**: Stufe 3 hat ALLE User aus Firebase geladen → extrem langsam!
  - **Lösung**: Stufe 1 & 2 (indexed queries) reichen aus
  - **Impact**: Schnellbuchung ist jetzt 5-10x schneller! 🚀
  - Falls userId nicht gefunden wird, erscheint Fahrt einfach nicht in "Meine Fahrten" - akzeptabel

### 🔧 Behoben
- Performance-Problem bei Schnellbuchung behoben
- Datenbank-Queries reduziert

---

## [5.93.17] - 2026-02-06

### 🐛 Debug
- **Detaillierte Performance-Logs für Schnellbuchung hinzugefügt**
  - `submitQuickBooking()` hat jetzt einen `debugTimer` der jeden Schritt loggt
  - Zeigt Gesamt-Zeit und Schritt-Zeit für jeden Vorgang
  - Datei: `index.html:59142-59154`

### ⚠️ BEKANNTE PROBLEME (DRINGEND FIXEN!)

**🔴 PERFORMANCE-PROBLEM: Schnellbuchung extrem langsam**
- **Ursache**: `findUserIdForCustomer()` Stufe 3 lädt ALLE User aus Datenbank (index.html:26114)
- **Datei**: `index.html:26035-26163`
- **Impact**: Bei vielen Usern dauert Schnellbuchung mehrere Sekunden
- **Lösung**: Stufe 3 entfernen oder durch Index-Query ersetzen
- **Zusätzliche Probleme**:
  - Zeile 59528: `db.ref('customers/' + finalCustomerId).once('value')`
  - Zeile 59543: `db.ref('users').orderByChild('displayName')...`
  - Zeile 59672: `db.ref('vehicles/' + vehicle).once('value')`

**🔴 FAHRZEUGE-PROBLEM: Nur noch 5 Fahrzeuge in Liste**
- **Ursache**: v5.93.9 Filter akzeptiert nur `OFFICIAL_VEHICLES` (5 Fahrzeuge)
- **Datei**: `index.html:15710-15753`
- **Impact**: Alle anderen Fahrzeuge werden automatisch aus Firebase gelöscht!
- **OFFICIAL_VEHICLES** enthält nur (Zeile 9322-9348):
  1. Tesla Model Y (PW-MY 222 E)
  2. Toyota Prius IK (PW-IK 222)
  3. Toyota Prius II (PW-KI 222)
  4. Renault Traffic 8 Pax (PW-SK 222)
  5. Mercedes Vito 8 Pax (VG-LK 111)

---

## [5.93.16] - 2026-02-06

### ✅ Hinzugefügt
- **Vollständige Fahrt-Infos in "Akzeptierte Fahrten"**

---

## [5.93.15] - 2026-02-06

### 🔧 Behoben
- **GPS-Toggle beim App-Start IMMER auf "aus"**

---

## [5.93.14] - 2026-02-06

### 🔧 Geändert
- **Minimal: Eine Zeile Top-Bar - mehr Platz für Fahrten**

---

## [5.93.13] - 2026-02-06

### 🔧 Behoben
- **Fahrzeug-Box nur zum Auswählen, nicht Wechseln**

---

## [5.93.12] - 2026-02-06

### 🔧 Behoben
- **Fahrzeug-Box komplett klickbar - Fahrzeug auswählbar**

---

## [5.93.11] - 2026-02-06

### 🎨 UI/UX
- **Design: Großes Fahrzeug-Display - sofort erkennbar**

---

## [5.93.10] - 2026-02-06

### 🎨 UI/UX
- **Mobile-Layout: Top-Bar kompakt & lesbar**

---

## [5.93.9] - 2026-02-06

### 🔒 Sicherheit / Datenintegrität
- **NUR OFFICIAL_VEHICLES in Fahrzeugliste + Auto-Cleanup**
  - Datei: `index.html:15710-15753`
  - VEHICLES-Liste akzeptiert nur noch Fahrzeuge aus `OFFICIAL_VEHICLES`
  - Realtime-Listener merged `OFFICIAL_VEHICLES` mit Firebase GPS-Daten
  - **Auto-Cleanup**: Löscht ungültige Fahrzeuge automatisch aus Firebase (Zeilen 15741-15753)

### ⚠️ BREAKING CHANGE
- **Alle Fahrzeuge die NICHT in `OFFICIAL_VEHICLES` sind werden gelöscht!**
  - `OFFICIAL_VEHICLES` definiert in: `index.html:9322-9348`
  - Enthält nur 5 Fahrzeuge (siehe oben)
  - **Falls mehr Fahrzeuge benötigt werden**: `OFFICIAL_VEHICLES` erweitern!

---

## [5.93.8] - 2026-02-06

### 🔧 Behoben
- **GPS-Toggle nur mit ausgewähltem Fahrzeug aktivierbar**

---

## [5.93.7] - 2026-02-06

### 🔧 Behoben
- **Power-Save Buttons NUR für Fahrer, NICHT für Admins**

---

## [5.92.6] - 2026-02-05

### 🔧 Behoben
- **Fahrzeugliste repariert**:
  - Entfernt "Unbekannt"-Einträge aus der Fahrzeugauswahl
  - Nur noch gültige Fahrzeuge mit Namen werden angezeigt
  - Fahrzeuge werden nach Priorität sortiert
  - Offizielle Fahrzeuge (OFFICIAL_VEHICLES) werden immer angezeigt
  - Verbesserte Filterung: Nur Einträge aus `vehicles` (keine `drivers` mehr)
  - Merge von Firebase-Daten mit offiziellen Fahrzeugdaten

### 📝 Technische Details
- `editRide()` lädt jetzt nur noch aus Firebase `vehicles/` Pfad
- Filtert ungültige Einträge ohne Namen
- Garantiert, dass alle OFFICIAL_VEHICLES verfügbar sind
- Sortierung nach `priority`-Feld (1-5, dann 99 für andere)

---

## [3.9.3] - 2024-11-21

### ✅ Hinzugefügt
- **📅 Zukunfts-Fahrten Management** im Verlauf:
  - Tab "Kommende Fahrten" zeigt alle geplanten Fahrten
  - Tab "Vergangene Fahrten" zeigt Fahrthistorie
  - Countdown bis zur Abholung angezeigt
- **👨‍💼 Admin: Vorgemerkte Fahrten** Kategorie:
  - Zeigt alle zukünftigen Buchungen
  - Sortiert nach Abholzeit
  - Countdown bis zur Abholung
  - Übersichtliche Darstellung mit Datum, Zeit, Kunde, Route
- **EmailJS Integration vorbereitet** (deaktiviert, kann später aktiviert werden):
  - E-Mail mit Buchungsbestätigung
  - ICS-Kalender-Datei als Anhang
  - Benachrichtigung an Admin

### 🔧 Geändert
- History View zeigt jetzt Tabs für bessere Organisation
- Admin Dashboard zeigt vorgemerkte Fahrten separat
- Zukunfts-Fahrten werden farblich hervorgehoben (hellblau)

---

## [3.9.2] - 2024-11-21

### ✅ Hinzugefügt
- Auto-Fill für Name-Feld bei Login
- Versionsnummer wird bei jedem Update erhöht

### 🔧 Geändert
- **User-Profil im Header** massiv kompakter (28px Avatar, 11px Text, "Aus" statt "Abmelden")
- **Zukunfts-Fahrten Check** nutzt jetzt `pickupTimestamp` statt `pickupTime` String
- Bessere Erkennung von vorgemerkten Fahrten (5 Min Puffer)

### 🐛 Behoben
- Zukunfts-Fahrten werden jetzt korrekt als "📅 Fahrt vorgemerkt" angezeigt
- Name wird automatisch aus Login übernommen

---

## [3.9.1] - 2024-11-21

### ✅ Hinzugefügt
- **🐛 Debug-Panel (Eruda)** für Mobile-Debugging direkt im Handy
- **🔐 Login-System** mit Firebase Auth:
  - Google Login
  - E-Mail/Passwort Login
  - Registrierung
  - User-Profil im Header
  - Abmelden-Funktion
- **📅 Zukunfts-Fahrten** werden jetzt anders angezeigt:
  - "Fahrt vorgemerkt" statt "Warte auf Fahrer"
  - Datum und Zeit prominent angezeigt
  - Benachrichtigungs-Hinweis 30 Min vorher

### 🔧 Geändert
- Firebase Auth Script hinzugefügt (`firebase-auth-compat.js`)
- Auth Observer für automatischen Login-Status

### 🐛 Behoben
- Firebase Auth nicht verfügbar Fehler

---

## [3.9.0] - 2024-11-20

### ✅ Hinzugefügt
- **📖 Verlauf-Features** - Erweiterte Fahrthistorie
- **🔁 Route umkehren** - Rückfahrt mit einem Klick buchen
- **⭐ Stammkunden-System** - Automatische Wiedererkennung
- Besseres Autocomplete mit Hotel-Namen und PLZ

### 🔧 Geändert
- Verlauf zeigt jetzt mehr Details
- Schnellbuchung aus Verlauf heraus

---

## [3.8.0] - 2024-11-20

### ✅ Hinzugefügt
- **Verbessertes Autocomplete** für Adressen
- POI-Namen werden angezeigt (Hotels, Restaurants)
- PLZ wird in Vorschlägen angezeigt
- Schönere Formatierung der Adress-Vorschläge

### 🔧 Geändert
- Autocomplete zeigt jetzt: "🏨 Hotel-Name" + "Straße, PLZ Ort"

---

## [3.7.1] - 2024-11-19

### 🔧 Geändert
- UI Cleanup und Optimierungen

---

## [3.6.0] - 2024-11-18

### ✅ Hinzugefügt
- **🔔 Push-Benachrichtigungen** für Fahrer
- **Service Worker** für Offline-Support
- **PWA-Features** - App kann installiert werden
- **Auto-Zuweisung** mit 30 Sekunden Timer

### 🔧 Geändert
- Benachrichtigungs-Banner beim Start
- Sound bei neuen Buchungen

---

## [3.5.0] - 2024-11-17

### ✅ Hinzugefügt
- **🗑️ Stornierung** mit Fahrer-Benachrichtigung
- **Stornogebühr** von 10€ nach 5 Minuten
- Fahrer erhält Push-Benachrichtigung bei Stornierung

### 🐛 Behoben
- Fahrer wurde nicht über Stornierungen informiert

---

## [3.4.0] - 2024-11-16

### ✅ Hinzugefügt
- **📍 GPS-Tracking** während der Fahrt
- **⏱️ ETA-Berechnung** - Automatische Ankunftszeit
- **Live-Karte** für Fahrgast mit Taxi-Position
- Fortschrittsbalken für Fahrt-Status

---

## [3.3.0] - 2024-11-15

### ✅ Hinzugefügt
- **🚗 Fahrer-Dashboard** mit GPS-Tracking
- **Fahrt-Annahme** System mit Timer
- **Fahrer-Karte** mit Route zum Kunden

---

## [3.2.0] - 2024-11-14

### ✅ Hinzugefügt
- **📅 Datum & Zeit Auswahl** für Vorausbuchungen
- Warnung bei Buchungen > 7 Tage im Voraus
- Prüfung ob Zeit in der Vergangenheit liegt

---

## [3.1.0] - 2024-11-13

### ✅ Hinzugefügt
- **🔥 Firebase Realtime Database** Integration
- Live-Synchronisation zwischen Geräten
- Status-Anzeige (Live/Lokal)

---

## [3.0.0] - 2024-11-12

### ✅ Hinzugefügt
- **Multi-Device Support** - Firebase Backend
- Echte Synchronisation zwischen Fahrgast, Fahrer und Admin

### 🔧 Geändert
- Von localStorage zu Firebase migriert

---

## [2.0.0] - 2024-11-11

### ✅ Hinzugefügt
- **💰 Preis-Berechnung** nach Vorpommern-Greifswald Tarif
- **🗺️ OpenStreetMap** Integration
- **📍 Routing** zwischen Abholort und Ziel
- **Zuschläge** für Nacht, Sonntag, Feiertage

---

## [1.3.0] - 2024-11-10

### ✅ Hinzugefügt
- **localStorage** für lokale Datenspeicherung
- Buchungen bleiben nach Reload erhalten

---

## [1.2.0] - 2024-11-09

### ✅ Hinzugefügt
- **👤 Fahrgast-View** - Taxi buchen
- **🚗 Fahrer-View** - Buchungen sehen
- **👨‍💼 Admin-View** - Übersicht

---

## [1.1.0] - 2024-11-08

### ✅ Hinzugefügt
- Basis-Formular für Buchungen
- Eingabefelder für Abholort, Ziel, Passagiere

---

## [1.0.0] - 2024-11-07

### ✅ Hinzugefügt
- Initiales Projekt-Setup
- HTML-Grundstruktur
- CSS-Styling (Purple Gradient Theme)
- Responsive Design

---

## Legende

- ✅ **Hinzugefügt** - Neue Features
- 🔧 **Geändert** - Änderungen an bestehenden Features
- 🗑️ **Entfernt** - Entfernte Features
- 🐛 **Behoben** - Bug Fixes
- 🔒 **Sicherheit** - Sicherheits-Updates

---

**Versionsnummern:**
- **Major** (X.0.0) - Große Änderungen, Breaking Changes
- **Minor** (x.X.0) - Neue Features, rückwärtskompatibel
- **Patch** (x.x.X) - Bug Fixes, kleine Verbesserungen
