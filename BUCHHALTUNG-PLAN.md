# Claude Code Prompt: Buchhaltungs-Integration für Funk Taxi Heringsdorf

> Das ist der finale, komplette Prompt. Alle Module 1-9 in einem Dokument.
> Kopiere den Text zwischen ## START PROMPT und ## ENDE PROMPT in Claude Code.

---

## Vorbereitung für Patrick

Bevor du startest:

1. Git-Backup: git commit -am "vor Buchhaltungs-Integration"
2. Neuer Branch: git checkout -b buchhaltung-integration
3. HALE-CSV-Beispiel bereitlegen: 1 Tag aus HALE Datacenter exportieren, in /samples/hale_export_beispiel.csv legen
4. Optional klären bei ECOVIS: SKR03 oder SKR04? (Default: SKR03)

---

## START PROMPT

### Kontext

Ich bin Patrick Wydra, Inhaber von Funk Taxi Heringsdorf auf der Insel Usedom. Ich betreibe 5 Tesla-Fahrzeuge als Taxi mit angestellten Fahrern.

Technische Ausgangslage:
- Dispatch-App: selbst entwickelt, Firebase-basiert, läuft unter https://umwelt-taxi-insel-usedom.de
- Hauptdatei: index.html, aktuelle Version v5.92
- Taxameter: HALE MCT-06 in allen 5 Fahrzeugen
- TSE-Signierung: 4 Fahrzeuge mit SEI-03M Boxen (ohne Bluetooth), 1 Fahrzeug ohne Box – TSE-Umrüstung bei HALE läuft parallel zu diesem Projekt
- Aktuell alle HALE-Fahrten unsigniert, wird sich in Kürze ändern – System muss mit UND ohne TSE-Signatur umgehen
- HALE Datacenter (datacenter.hale.de) versendet konfigurierte Berichte als CSV per E-Mail
- Dispatch-App hat funktionierende E-Mail-Integration (Bereich 📧 Email-Postfach) mit automatischer Weiterleitung an [email protected]
- Dispatch-App hat Telegram-Bot-Integration für Alarme
- Steuerberater: ECOVIS, nutzt DATEV (Unternehmen online)
- Aktuell werden Barkasse-Einträge manuell in DATEV erfasst – das soll künftig die App automatisch liefern
- Rechnungsausgänge (BG BAU, DKV, Hotels) bleiben in Phase 1 bei DATEV
- Rechnungseingänge (Lieferantenrechnungen via ScanSnap) bleiben komplett bei DATEV
- Optional später: HALE TPD-02-BT-D Thermopapierdrucker für Bluetooth-Integration (noch nicht vorhanden, aber vorbereiten)

Ziel:
Die Dispatch-App wird zum zentralen Buchhaltungs-Cockpit:
- HALE-Daten (Barumsätze) + Dispatch-Daten (Rechnungsfahrten, CRM) mergen
- Barausgaben erfassen (Kassenbuch mit Belegfoto)
- Geldtransit Kasse/Bank abbilden
- Lücken zwischen HALE und Dispositionsdaten erkennen
- DATEV-CSV-Exporte erzeugen
- USt-Voranmeldungen für ELSTER vorbereiten
- Monatliche Kompletheitsberichte für Betriebsprüfung
- Bluetooth-Drucker-Anbindung vorbereiten (Infrastruktur jetzt, Aktivierung später)

Kernprinzip:
- HALE = Quelle der Wahrheit für Barumsätze (nach TSE-Aktivierung signiert)
- Dispatch-App = Quelle der Wahrheit für Rechnungsfahrten und Barausgaben
- Neues Buchhaltungs-Modul führt alles zusammen

---

### Technische Vorgaben (gelten für alle Module)

- Bestehende App-Features NICHT brechen – die App läuft produktiv
- Neue Module in eigene JS-Dateien: hale-sync.js, reconciliation.js, buchhaltung.js, datev-export.js, ust-report.js, stammdaten.js, kassenbuch.js, belege.js, geldtransit.js, drucker.js
- Firebase-Collections neu: hale_fahrten, daily_reconciliation, buchungssaetze, debitoren, belegnummern, kontenrahmen, kassenbuch_eintraege, fahrzeug_tse_status, import_batches, drucker_queue, drucker_events
- UI im bestehenden App-Stil: Mobile-first, Emojis, klare Buttons
- Neuer Haupt-Admin-Bereich: "📊 Buchhaltung" mit Unter-Tabs pro Modul
- Version nach erfolgreichem Deploy: v5.93.0
- Alle neuen Funktionen im bestehenden Debug-System dokumentieren
- HALE-Daten sind unveränderlich: Feld locked: true
- Fehler sichtbar im UI anzeigen, nicht nur in Console
- Rückwirkender Import möglich (auch 2024/2025), markiert als historisch: true, zur_abrechnung: false – erscheint im Sync-Monitor, aber NICHT in aktuellen DATEV-Exporten
- Wichtig: Wirtschaftsjahr 2025 bleibt komplett bei ECOVIS, sauberer Schnitt zum 01.01.2026

---

### MODUL 1: Stammdaten mit SKR03/SKR04-Umschaltung

Admin-Bereich: "📊 Buchhaltung" → "⚙️ Stammdaten"

#### 1.1 Kontenrahmen-Verwaltung

---FRAGMENT-BREAK---

Beide Kontenrahmen parallel in Firebase pflegen, mit Umschalter:

kontenrahmen (Collection)
├── settings
│   └── active: "SKR03"  // Default, umschaltbar
├── mapping
│   ├── barfahrt_7
│   │   ├── skr03: { konto: 8300, gegenkonto: 1000, bu_schluessel: 2 }
│   │   └── skr04: { konto: 4300, gegenkonto: 1600, bu_schluessel: 2 }
│   ├── barfahrt_19
│   │   ├── skr03: { konto: 8400, gegenkonto: 1000, bu_schluessel: 3 }
│   │   └── skr04: { konto: 4400, gegenkonto: 1600, bu_schluessel: 3 }
│   ├── ec_karte_7
│   │   ├── skr03: { konto: 8300, gegenkonto: 1360, bu_schluessel: 2 }
│   │   └── skr04: { konto: 4300, gegenkonto: 1460, bu_schluessel: 2 }
│   ├── paypal_7
│   │   ├── skr03: { konto: 8300, gegenkonto: 1361, bu_schluessel: 2 }
│   │   └── skr04: { konto: 4300, gegenkonto: 1461, bu_schluessel: 2 }
│   ├── rechnung_firma_7
│   │   ├── skr03: { konto: 8300, gegenkonto: "DEBITOR", bu_schluessel: 2 }
│   │   └── skr04: { konto: 4300, gegenkonto: "DEBITOR", bu_schluessel: 2 }
│   ├── krankenfahrt_steuerfrei
│   │   ├── skr03: { konto: 8120, gegenkonto: "DEBITOR", bu_schluessel: null }
│   │   └── skr04: { konto: 4120, gegenkonto: "DEBITOR", bu_schluessel: null }
│   ├── transportschein
│   │   ├── skr03: { konto: 8300, gegenkonto: 1000, bu_schluessel: 2 }
│   │   └── skr04: { konto: 4300, gegenkonto: 1600, bu_schluessel: 2 }
│   ├── tankbeleg
│   │   ├── skr03: { konto: 4530, gegenkonto: 1000, bu_schluessel: 9 }
│   │   └── skr04: { konto: 6530, gegenkonto: 1600, bu_schluessel: 9 }
│   ├── werkstattkosten
│   │   ├── skr03: { konto: 4540, gegenkonto: 1000, bu_schluessel: 9 }
│   │   └── skr04: { konto: 6540, gegenkonto: 1600, bu_schluessel: 9 }
│   ├── privatentnahme
│   │   ├── skr03: { konto: 1800, gegenkonto: 1000, bu_schluessel: null }
│   │   └── skr04: { konto: 2100, gegenkonto: 1600, bu_schluessel: null }
│   ├── geldtransit_kasse_bank
│   │   ├── skr03: { konto: 1360, bu_schluessel: null }
│   │   └── skr04: { konto: 1460, bu_schluessel: null }
│   └── sonstige_betriebsausgaben
│       ├── skr03: { konto: 4980, gegenkonto: 1000, bu_schluessel: 9 }
│       └── skr04: { konto: 6980, gegenkonto: 1600, bu_schluessel: 9 }
UI-Anforderung:
- Radio-Button oben: "Aktiver Kontenrahmen: ⚪ SKR03 / ⚪ SKR04" (Default SKR03)
- Bestätigungsdialog bei Umschaltung mit Warnhinweis
- Audit-Log (wann wurde von wem umgeschaltet)
- Tabelle aller Mappings editierbar

#### 1.2 Debitoren-Verwaltung

Collection debitoren:
- Firmenkunden (BG BAU, DKV, Krankenkassen, Hotels)
- Debitoren-Nummer (10000–69999)
- Zuordnung welche Zahlungsart/Fahrttyp → Debitor
- CSV-Import/Export

#### 1.3 Beleg-Nummernkreis

Collection belegnummern:
- Separate Nummernkreise: Einnahmen (E-2026-00001), Barausgaben (A-2026-00001), Rechnungen (R-2026-00001), Geldtransit (T-2026-00001)
- Fortlaufend, keine Lücken
- Stornos bleiben erhalten mit Kennzeichen

#### 1.4 Fahrzeug-Stammdaten mit TSE-Status und Drucker-Config

Pro Fahrzeug in fahrzeug_tse_status:
{
  kennzeichen: "HST-IA 100",
  hale_vehicle_id: "hale_12345",
  dispatch_vehicle_id: "tesla_100",
  taxameter_modell: "MCT-06",
  sei_box: "SEI-03M" | "SEI-03MBT" | "keine",
  online_uebertragung: true/false,
  tse_status: "nicht_nachgeruestet" | "geplant" | "aktiv",
  tse_active_since: Date|null,
  planned_upgrade_date: Date|null,
  drucker_config: {
    hat_drucker: false,             // Default false
    drucker_modell: null,           // z.B. "TPD-02-BT-D"
    bluetooth_id: null,
    gekoppelt_seit: null,
    letzte_verbindung: null,
    verbindungs_status: "nicht_gekoppelt"
  },
  notes: string
}
UI mit Ampel pro Fahrzeug:
- TSE-Status: 🔴 nicht nachgerüstet / 🟡 geplant / 🟢 aktiv
- Drucker-Status: ⚪ nicht vorhanden / 🟡 eingebaut, nicht gekoppelt / 🟢 gekoppelt

#### 1.5 Bankkonten-Verwaltung (für Geldtransit)

Collection bankkonten:
- Name (z.B. "Sparkasse Geschäftskonto")
- IBAN (optional, nur intern)
- Aktiv: ja/nein
- SKR03-Konto: 1200 / SKR04-Konto: 1800

Für Geldtransit-Buchungen (Modul 8).

#### 1.6 Einstellun

---FRAGMENT-BREAK---

Checkbox in Stammdaten:
- ⚪ DATEV importiert Bankauszüge automatisch (Default: ja)
- Wenn ja: Geldtransit exportiert nur die Kassen-Seite
- Wenn nein: Geldtransit exportiert beide Seiten (Kasse und Bank)

#### 1.7 GoBD-Aufbewahrungssperre

Fahrten, Buchungssätze und Kassenbuch-Einträge älter als 10 Jahre: nicht löschbar, Warnung bei Versuch.

---

### MODUL 2: HALE-Daten-Import (E-Mail + manueller CSV-Upload)

Admin-Bereich: "📊 Buchhaltung" → "🟢 HALE Sync"

#### 2.1 Manueller CSV-Upload (Primär-Test-Pfad)

- Upload-Button im Admin
- Vorschau-Ansicht VOR Import: "X Fahrten erkannt, Y Duplikate, Z Fehler"
- Spalten-Zuordnung automatisch erkennen (Header-Matching)
- Import erst nach expliziter Bestätigung durch User
- Fortschrittsbalken bei großen Dateien

Zusätzliche Option bei Upload:
- Checkbox: "Historischer Import (nur Dokumentation, nicht zur aktuellen Abrechnung)"
- Wenn angehakt: historisch: true, zur_abrechnung: false

#### 2.2 E-Mail-Parser (Automatisierung, später zu aktivieren)

Erweitere die bestehende E-Mail-Verarbeitung:
- Absender-Filter: konfigurierbar für HALE-Domains
- CSV-Anhänge automatisch erkennen und parsen
- Identischer Parser wie bei 2.1
- Admin-Schalter "E-Mail-Sync aktiviert: JA/NEIN" (Default NEIN bis manueller Test abgeschlossen)

#### 2.3 Import-Historie und Rollback

Collection import_batches:
- Jeder Import bekommt Batch-ID
- Liste aller Batches mit Anzahl Fahrten, Zeitstempel, User, Quelle
- Rollback-Button pro Batch: "Diesen Import rückgängig machen" – löscht nur die Fahrten aus diesem Batch
- Audit-Log vollständig

#### 2.4 TSE-Status pro Fahrt

Erweitere hale_fahrten um strukturiertes Feld:
tse_status: {
  signed: boolean,
  signature_hash: string|null,
  signature_timestamp: Date|null,
  reason_unsigned: string|null
}
Wichtig: Beim Import:
- TSE-Feld in CSV vorhanden und gefüllt → signed: true, Hash übernehmen
- TSE-Feld leer → signed: false, reason_unsigned: "TSE nicht nachgerüstet"
- Alle Fahrten werden trotzdem importiert – keine Ablehnung wegen fehlender Signatur
- Falls Fahrzeug-TSE-Status "aktiv" aber Fahrt unsigniert: Warnung im Sync-Monitor

#### 2.5 HALE-Fahrt-Felder (Firebase-Schema)

Minimal zu speichern pro Fahrt:
- hale_id (Duplikat-Schlüssel)
- fahrzeug_id, fahrer_id, schicht_id
- datum, start_zeit, end_zeit
- km_besetzt, km_leer
- brutto, mwst_satz, mwst_betrag, netto
- zahlungsart, fahrttyp
- tse_status (siehe oben)
- historisch: boolean, zur_abrechnung: boolean
- source: "hale", source_detail: "email_csv" | "manual_csv" | "bluetooth_drucker" | "mock"
- locked: true, imported_at, imported_from, batch_id

#### 2.6 Status-Dashboard

- Letzter Sync mit Zeitstempel und Anzahl
- Fehlerprotokoll
- Statistik: "Signierungsrate letzte 30 Tage"
- Kennzahl: "Tage ohne HALE-Daten in den letzten 30 Tagen"
- Manueller Trigger für E-Mail-Sync

---

### MODUL 3: Kompletheits-Monitor (Lückendetektor)

Admin-Bereich: "📊 Buchhaltung" → "🗓️ Sync-Monitor"

Zweck: Findet Lücken zwischen Dispatch-Fahrten und HALE-Fahrten, bevor eine Betriebsprüfung sie findet.

#### 3.1 Kalender-Matrix

Tage × Fahrzeuge, auf Mobile umschaltbar. Ampel-Status pro Zelle:

| Status | Farbe | Bedingung |
|--------|-------|-----------|
| Synchron | 🟢 | HALE ≥ 95% Dispatch, Umsatz-Diff < 5% |
| Teilweise | 🟡 | HALE 30–95% Dispatch |
| Fehlend | 🔴 | HALE < 30% UND Dispatch ≥ 3 Fahrten |
| Kein Betrieb | ⚪ | Weder Dispatch noch HALE |
| Nur HALE | 🔵 | HALE vorhanden, Dispatch leer (Winker) |

Zusätzlich: TSE-Warnsymbol auf der Zelle, wenn Fahrzeug auf "aktiv" steht aber unsignierte Fahrten importiert wurden.

#### 3.2 Detail-Ansicht

Klick auf Zelle öffnet Panel:
- Links: Dispatch-Fahrten
- Rechts: HALE-Fahrten (mit TSE-Status-Symbol pro Fahrt)
- Auto-Matching-Vorschläge (Zeit ±15 Min, Umsatz-Diff < 2€)
- Manuelles Matching per Klick
- Notiz-Feld: "Cey am XX.XX. eingelesen" / "Werkstatt" / "Krank"

#### 3.3 Idempotenter Re-Abgleich

---FRAGMENT-BREAK---

Selbstheilend: Nachträgliche HALE-Imports triggern Neuberechnung der betroffenen Tage. Ampel aktualisiert sich automatisch. Kein manueller Eingriff nötig.

#### 3.4 Telegram-Alarme

- Täglich 08:00: Zusammenfassung pro Fahrzeug
- Sofort-Alarm bei > 3 Tagen rot
- Freitag 17:00: Wochen-Erinnerung Cey-Auslesung
- Zusatz: "Fahrzeug XY noch nicht TSE-nachgerüstet" falls Status "geplant" und Upgrade-Datum überschritten

#### 3.5 Monats-Kompletheitsbericht (PDF)

- Fahrzeug-Tabelle Soll (Dispatch) vs. Ist (HALE) pro Tag
- TSE-Statistik: signiert/unsigniert pro Fahrzeug
- Verbleibende rote Tage mit Notiz
- Umsatz-Differenzen
- Erklärungstext zu TSE-Upgrade-Status
- Wird mit DATEV-Export archiviert

#### 3.6 Datenstruktur

daily_reconciliation (Collection)
└── {date}_{vehicleId}
    ├── date, vehicleId
    ├── dispatch_count, dispatch_revenue, dispatch_km
    ├── hale_count, hale_revenue, hale_km
    ├── hale_signed_count, hale_unsigned_count
    ├── status: "green" | "yellow" | "red" | "gray" | "blue"
    ├── tse_warning: boolean
    ├── last_calculated: Timestamp
    ├── matches: [{dispatchId, haleId, confidence}]
    ├── notes: string
    └── audit_log: [{timestamp, event, user, old_status, new_status}]
---

### MODUL 4: Buchungssätze (Merge-Layer)

Admin-Bereich: "📊 Buchhaltung" → "📋 Buchungssätze"

#### 4.1 Merge-Regeln

Logische View über hale_fahrten, rides (Dispatch) und kassenbuch_eintraege:

- Barfahrt / EC-Karte → HALE-Datensatz maßgeblich
- Rechnungsfahrt Firma → Dispatch-Datensatz
- Transportschein → Dispatch (Belegnummer) + HALE-Referenz
- PayPal/Online → Dispatch
- Winker-Fahrgast → HALE
- Barausgaben → Kassenbuch
- Geldtransit → Kassenbuch

Jede Zeile: source: "hale" | "dispatch" | "merged" | "kassenbuch"

#### 4.2 UI

- Zeitraum-Filter
- Filter nach: Zahlungsart, Steuersatz, Quelle, Fahrzeug, Fahrer, TSE-Status, historisch ja/nein
- Spalten: Datum, TSE-Symbol (🔒/⚠️), Fahrzeug, Zahlungsart, Brutto, MwSt, Konto, Gegenkonto, Belegnummer, Quelle
- CSV-Export aller angezeigten Zeilen

#### 4.3 Manuelle Korrekturen

- Zahlungsart änderbar (falls HALE falsch klassifiziert)
- Debitor zuweisbar (für Rechnungsfahrten)
- Konto manuell überschreibbar
- Kommentar-Feld
- HALE-Kernfelder (Brutto, MwSt, Datum, Zeit) sind gesperrt (locked)
- Änderungen erzeugen Audit-Log-Eintrag

---

### MODUL 5: Kassenbuch (Barkasse-Verwaltung)

Admin-Bereich: "📊 Buchhaltung" → "💰 Kassenbuch"

Zweck: Zentrales Kassenbuch, das Bareinnahmen aus HALE + Barausgaben zusammenführt. Ersetzt die manuelle Eingabe in DATEV-Kassenbuch.

#### 5.1 Bareinnahmen (automatisch aus HALE)

Alle HALE-Fahrten mit zahlungsart: "bar" erscheinen automatisch als Einnahme im Kassenbuch. Keine Doppeleingabe nötig.

#### 5.2 Barausgaben (manuelle Erfassung)

Form zum Eintragen von Ausgaben:
- Datum (Default: heute)
- Betrag
- Kategorie: Tanken / Werkstatt / Kleinteile / Wagenwäsche / Parkgebühren / Büromaterial / Privatentnahme / Sonstiges
- Beschreibung
- Belegfoto hochladen (Kamera bzw. Upload)
- Fahrzeug-Zuordnung (optional)
- Steuersatz: 19% / 7% / 0%
- Automatische Konto-Zuordnung basierend auf Kategorie

#### 5.3 Kassenbestand (laufend)

- Anzeige oben: "Aktueller Soll-Kassenbestand: XXX,XX €"
- Berechnung: Anfangsbestand + Einnahmen - Ausgaben
- Chart: Kassenbestand-Verlauf über Zeit

#### 5.4 Kassensturz-Funktion

Täglich oder wöchentlich:
- Button "Kassensturz machen"
- Form: Aktuell gezähltes Bargeld eingeben
- Differenz zu Soll-Bestand wird angezeigt
- Begründung eingeben (bei Differenz)
- Eintrag dokumentiert mit Datum, User, Kommentar
- GoBD-relevant: Regelmäßige Kassenstürze sind Pflicht

#### 5.5 Kassenbuch-Druck (GoBD-konform)

Monatlicher PDF-Ausdruck:
- Fortlaufende Nummerierung aller Ein- und Ausgänge
- Chronologische Reihenfolge
- Keine Lücken
- Laufender Saldo pro Zeile
- Unterschriftenfeld für Unternehmer
- Aufbewahrungspflicht: 10 Jahre

#### 5.6 DATEV-Export aus Kassenbuch

Eigener Export nur Kassenbuch-Bewegungen, kompatibel mit DATEV-Kassenbuch-Im

---FRAGMENT-BREAK---

kassenbuch_eintraege (Collection)
└── {id}
    ├── datum, zeit
    ├── typ: "einnahme" | "ausgabe" | "sturz" | "geldtransit"
    ├── betrag
    ├── kategorie
    ├── beschreibung
    ├── beleg_nr (auto-generiert)
    ├── beleg_foto_url (optional)
    ├── fahrzeug_id (optional)
    ├── mwst_satz
    ├── konto, gegenkonto (aus Kontenrahmen)
    ├── source: "hale_auto" | "manuell" | "sturz" | "geldtransit"
    ├── hale_fahrt_id (bei Einnahmen: Referenz)
    └── audit_log
---

### MODUL 6: DATEV-CSV-Export

Admin-Bereich: "📊 Buchhaltung" → "📊 DATEV-Export"

#### 6.1 Export-Funktion

- Zeitraum wählbar (Monat/Quartal/frei)
- Quelle: Buchungssätze aus Modul 4 (ohne historische) + Kassenbuch aus Modul 5
- Nutzt aktiven Kontenrahmen (SKR03/SKR04)
- DATEV-CSV-Format mit Spalten:
  - Umsatz (Brutto)
  - Soll/Haben-Kennzeichen
  - WKZ (EUR)
  - Konto
  - Gegenkonto
  - BU-Schlüssel
  - Belegdatum (TT.MM.JJJJ)
  - Belegfeld 1 (Belegnummer)
  - Buchungstext (bei unsignierten Fahrten: "(TSE: nicht signiert)" anhängen)

#### 6.2 Pflichtprüfungen vor Export

- Alle Buchungen haben gültiges Konto und Gegenkonto
- Keine Lücken in Belegnummernkreis
- Kontrollbilanz: Summe Soll = Summe Haben
- Keine "roten" Tage im Zeitraum → bei Abweichung: Warnung + Liste, Export nur nach Bestätigung
- Historische Daten werden NICHT exportiert – Warnung falls versucht

#### 6.3 Begleitbericht als PDF

Zusätzlich zum CSV ein Begleit-PDF:
- Zeitraum
- Anzahl signierte vs. unsignierte Fahrten, prozentualer Anteil
- Fahrzeug-Übersicht mit TSE-Status
- Erklärungstext zum TSE-Upgrade-Status
- Kontrollbilanz
- Signatur-Feld

Dieser Begleitbericht ist bei einer Betriebsprüfung das zentrale Dokument.

#### 6.4 Edge Cases

- Fahrt mit Zwischenstopp → ein Buchungssatz
- Storno: nicht exportiert, aber archiviert
- Fahrt über Mitternacht: Schichtbeginn zählt
- Krankenfahrt 0 €: nicht gebucht, nur km-Nachweis
- Rundungsdifferenzen: Rest auf Rundungskonto 8980 (SKR03) / 4580 (SKR04)

---

### MODUL 7: USt-Voranmeldung

Admin-Bereich: "📊 Buchhaltung" → "📱 USt-Voranmeldung"

- Auswahl Monat/Quartal
- Quelle: HALE-Umsätze nach MwSt-Satz + Dispatch-Rechnungsfahrten + Kassenbuch-Vorsteuer
- ELSTER-Format:
  - Kennzahl 81: Netto-Summe 19% Umsätze
  - Kennzahl 86: Netto-Summe 7% Umsätze
  - Kennzahl 35/36: Steuerfreie Umsätze §4 Nr. 17b UStG
  - Abgeführte USt gesamt
  - Vorsteuer automatisch aus Kassenbuch + manuelles Feld für weitere Vorsteuer
  - Zahllast/Erstattung
- PDF-Archiv
- Zahlen 1:1 in ELSTER-Formular übertragbar

---

### MODUL 8: Belegmanagement und Geldtransit

Zwei Erweiterungen des Kassenbuchs.

#### 8.1 Belegmanagement

Erweitere das Kassenbuch um komfortablen Beleg-Upload.

Drei Eingabe-Wege:

Weg 1 – Mobile Kamera (unterwegs):
- Button "📷 Beleg fotografieren" direkt im Kassenbuch-UI
- Öffnet Kamera, Foto-Zuschnitt
- Bild wird in Firebase Storage abgelegt
- Formular zum Ausfüllen erscheint (Betrag, Kategorie, etc.)
- Optional: OCR-Erkennung (Datum, Betrag) – falls Claude-API oder Google Vision verfügbar

Weg 2 – Drag & Drop PDF/JPG (am Computer):
- Uploadsbereich "Belege hochladen"
- Mehrere Dateien gleichzeitig (ScanSnap-Stapel)
- Pro Beleg öffnet sich Formular
- Nach Speichern: nächster Beleg erscheint

Weg 3 – Watch-Folder (optional, Phase 2):
- Automatischer Import aus lokalem Ordner
- Für Phase 1 nicht zwingend nötig

Beleg-Dateien-Verwaltung:

Firebase Storage-Struktur:
/belege/
├── kassenbuch/
│   └── {jahr}/{monat}/{beleg_nr}.pdf
└── sonstige/
- Dateinamen: Belegnummer + Originalname
- Keine Löschung möglich (GoBD, 10 Jahre)
- Vorschau im UI (PDF-Viewer oder Bild-Thumbnail)

Beleg-Status im UI:

Pro Kassenbuch-Eintrag:
- 📎 Beleg vorhanden (mit Vorschau-Icon beim Hover)
- ⚠️ Beleg fehlt (rote Markierung)
- 🔍 Beleg öffnen (Vollbild-Ansicht)

Im Kassenbuch-Druck: Beleg-Referenz-Nummer in der Ausgabe.

#### 8.2 Geldtransit zwischen Kasse und Bank

Neue Kategorie im Kassenbuch: geldtransit

---FRAGMENT-BREAK---

Beim Eintragen einer Transit-Bewegung:
- Datum/Zeit
- Richtung: "Kasse → Bank" oder "Bank → Kasse"
- Betrag
- Konto-Ziel: Bankkonto aus Stammdaten
- Beleg: Einzahlungsquittung/Auszahlungsbeleg (Foto)
- Kommentar: "Tageseinnahme XX.XX.2026 eingezahlt"

DATEV-Buchungslogik:

| Richtung | Soll-Konto | Haben-Konto |
|----------|------------|-------------|
| Kasse → Bank | 1360 (Geldtransit) | 1000 (Kasse) |
| | 1200 (Bank) | 1360 (Geldtransit) |
| Bank → Kasse | 1000 (Kasse) | 1360 (Geldtransit) |
| | 1360 (Geldtransit) | 1200 (Bank) |

Bei SKR04 entsprechend 1460/1600/1800.

Abgleich mit DATEV-Bankauszug:

Wenn DATEV-Bankauszugs-Import aktiv ist (Setting aus Modul 1):
- Im DATEV-Export nur die Kasse-Seite ausgeben
- Bank-Seite kommt automatisch über DATEVs Bankauszugs-Import
- Geldtransit-Konto wird von DATEV selbst ausgeglichen

Wenn nicht aktiv: beide Seiten exportieren.

UI für Transit:

Button im Kassenbuch prominent: "💱 Geldtransit buchen"

Schnell-Form:
- Heute / Gestern / Datum wählen
- Betrag
- Richtung (Dropdown)
- Bank-Konto (aus Liste)
- Foto vom Einzahlungsbeleg
- OK

#### 8.3 Arbeitsteilung mit DATEV (wichtig zum Verstehen)

In DATEV bleiben (Phase 1):
- Rechnungseingänge (Lieferantenrechnungen via ScanSnap)
- Rechnungsausgänge (BG BAU, DKV, Hotels – die App liefert nur Fahrdaten)
- Offene-Posten-Verwaltung, Mahnwesen, Bankabgleich

In die App:
- Kassenbuch (Bar-Einnahmen aus HALE + Bar-Ausgaben manuell)
- Geldtransit Kasse/Bank
- Fahrtdaten (für spätere Rechnungserstellung in DATEV)

Regel für manuelle Eingaben:
- Überweisung → DATEV
- Bar bezahlt → App-Kassenbuch

---

### MODUL 9: Drucker-Integration (Vorbereitung)

Admin-Bereich: "📊 Buchhaltung" → "🖨️ Drucker-Verwaltung"

Zweck: Infrastruktur für Bluetooth-Drucker TPD-02-BT-D vorbereiten. Hardware ist noch nicht vorhanden, wird aber später evtl. angeschafft. Module bauen, aber per Feature-Flag deaktiviert.

#### 9.1 Build Now, Activate Later

Komplette Infrastruktur wird gebaut, aber deaktiviert:

if (settings.drucker_integration_aktiv && fahrzeug.drucker_config.hat_drucker) {
  // Echte Bluetooth-Kommunikation
} else {
  // Mock-Daten oder Fallback
}
Standard: Feature deaktiviert.

#### 9.2 Kopplungs-Workflow (UI)

Neuer Bereich: "Drucker koppeln"

Pro Fahrzeug ein Button: "🔌 Drucker mit Fahrzeug HST-XX-Y koppeln"

Wizard:

Schritt 1: Anleitung anzeigen:
> "Stellen Sie den Drucker in Kopplungs-Modus:
> 1. T2 (rechter Knopf) gedrückt halten
> 2. T1 (linker Knopf) 4× drücken
> 3. Drucker ist jetzt 2 Minuten kopplungsbereit"

Schritt 2: App sucht nach Bluetooth-Geräten (Web Bluetooth API).

Schritt 3: User wählt den TPD-02-BT-D, App koppelt.

Schritt 4: Test-Druck anfordern.

Schritt 5: Bei Erfolg: Kopplung speichern, verbindungs_status: "online".

Fallback: Wenn Web Bluetooth nicht verfügbar (iOS Safari): Hinweis "Bitte Chrome oder Edge verwenden".

#### 9.3 Datenempfang vom Drucker

Flexibler Parser mit:
- Mock-Modus: simulierte Testdaten ohne Hardware
- Live-Modus: echte Daten vom gekoppelten Drucker
- Schema-Validierung: unbekannte Felder werden geloggt, nicht abgewiesen

Empfangene Fahrten gehen in hale_fahrten Collection mit:
source: "hale"
source_detail: "bluetooth_drucker"
received_at: Timestamp
Duplikat-Erkennung: HALE-Fahrt-ID oder TSE-Hash (wie Modul 2).

#### 9.4 Beleg-Druck aus der App

Fahrgast-Quittung drucken:
- Button bei abgeschlossener Fahrt: "🧾 Quittung drucken"
- Beleg enthält: Firmendaten, Datum/Uhrzeit, Route, km, Preis, MwSt, TSE-Signatur als QR-Code, Belegnummer

Schichtabschluss-Beleg:
- Am Schichtende: "📋 Schichtabrechnung drucken"
- Fahrer, Fahrzeug, Schichtzeit, Anzahl Fahrten, Umsatz, km besetzt/leer

Kassensturz-Beleg:
- Aus Kassenbuch (Modul 5): "💰 Kassensturz-Beleg drucken"

Rechnungskopie für Firmenkunden:
- "📄 Rechnungskopie drucken"

Druckt nur wenn drucker_config.hat_drucker = true und verbindungs_status = "online". Sonst Meldung.

#### 9.5 Mock-Modus für Entwicklung

---FRAGMENT-BREAK---

Solange kein Drucker da:
- Button "Drucker-Integration simulieren" in Admin
- App zeigt Druckergebnisse als modales PDF im Browser
- Fahrtdaten werden alle 5 Minuten simuliert (mit source_detail: "mock")

Mock-Daten klar von echten Daten trennbar.

#### 9.6 Telegram-Benachrichtigungen

Nutze bestehende Telegram-Integration:
- "Drucker verbunden" – bei Schichtbeginn
- "Drucker offline seit X Minuten" – bei Verbindungsabbruch
- "Beleg-Druck fehlgeschlagen" – bei Papierleere

#### 9.7 Fallback bei Drucker-Offline

- App warnt: "Drucker offline – Belege werden gespeichert"
- Warteschlange in drucker_queue
- Sobald Drucker online: Warteschlange automatisch abarbeiten
- Optional: Quittung per E-Mail/WhatsApp an Fahrgast

---

### REIHENFOLGE DER UMSETZUNG

Strikt in dieser Reihenfolge, nicht parallel:

1. Modul 1 (Stammdaten) – Fundament mit SKR03/SKR04, TSE-Status, Drucker-Config
2. Modul 2 (HALE-Import) – zuerst CSV-Upload, dann E-Mail (letzteres auskommentiert bis Test erfolgreich)
3. Modul 5 (Kassenbuch) – mit Modul 8.1 (Belegmanagement) und 8.2 (Geldtransit)
4. Modul 3 (Sync-Monitor) – sobald HALE-Daten importiert werden
5. Modul 4 (Buchungssätze) – zentrale Ansicht
6. Modul 6 (DATEV-Export) – erste produktive Ausgabe
7. Modul 7 (USt-Voranmeldung) – zweite produktive Ausgabe
8. Modul 9 (Drucker-Integration) – letztes Modul, bereitet Hardware-Anbindung vor

Nach jedem Modul: kurzer Test vor dem nächsten.

---

### RÜCKFRAGEN BITTE VOR CODE-START

Bitte frage VOR Codestart nach:

1. Welche Firebase-Collections existieren bereits in index.html (Fahrten, Schichten, Fahrzeuge, Fahrer)?
2. Welche Felder haben diese Collections aktuell?
3. HALE-CSV-Beispieldatei verfügbar (/samples/hale_export_beispiel.csv)?
4. Bestehende E-Mail-Integration: IMAP, API oder Webhook?
5. Bestehende Telegram-Bot-Integration: wie werden Nachrichten gesendet?
6. Default-Kontenrahmen: SKR03 empfohlen
7. Fahrer-Geräte: Android oder iOS? (Web Bluetooth API nur auf Android/Desktop, nicht iOS Safari)

## ENDE PROMPT

---

## Praktische Hinweise für Patrick

### Sauberer Schnitt 2025/2026

- Wirtschaftsjahr 2025: komplett bei ECOVIS, Jahresabschluss + Einkommensteuer dort
- Dezember 2025 USt-Voranmeldung: letzte komplett von ECOVIS
- Ab 01.01.2026: neue App-Buchhaltung, Belegnummern beginnen bei 00001
- Kassensturz zum 31.12.2025 zwingend (Anfangsbestand für 2026)
- ECOVIS informieren per E-Mail, Leistungsumfang und neuen Preis verhandeln

### Kassenbuch-Übergang

- Klarer Stichtag (z.B. 01.05.2026 oder 01. des Monats nach App-Fertigstellung)
- Bis dahin: DATEV-Kassenbuch wie bisher weiterführen
- Ab Stichtag: alle Bareinnahmen aus HALE + Barausgaben mit Foto in App
- Monatlich CSV-Export an ECOVIS für DATEV-Kassenbuch

### TSE-Nachrüstung parallel

- E-Mail an HALE-Servicepartner (4 bestehende SEI-03M + 1 neue Box + TSE-Karten für 5 Fahrzeuge)
- Realistisch 2-4 Wochen Wartezeit
- Parallel läuft das App-Projekt

### Realistische Kostenersparnis

| Bisher bei ECOVIS | Mit neuem System | Ersparnis |
|---|---|---|
| Laufende Finanzbuchhaltung | App → DATEV-CSV | ~3.500 €/Jahr |
| Kassenbuch-Führung | App-Kassenbuch → DATEV | ~1.500 €/Jahr |
| USt-Voranmeldungen | Selbst via ELSTER | ~800 €/Jahr |
| Belegerfassung | HALE + App automatisch | ~1.500 €/Jahr |
| Gesamt | | ~7.000 €/Jahr |

Bei ECOVIS verbleibt: Lohnbuchhaltung, Jahresabschluss, Einkommensteuer = ca. 3.000 €/Jahr.

Gesamtrechnung: statt 10.000 € nur noch ca. 3.000 € beim Steuerberater.

### TSE-Hardware-Investition einmalig

Für die HALE-TSE-Umrüstung (parallel zum App-Projekt):
- 4× TSE-Karten-Wechsel in bestehenden SEI-03M Boxen: ca. 400-600 €
- 1× neue SEI-03M für fünftes Fahrzeug: ca. 600-800 €
- Einbau, Eichung, Software-Updates: ca. 800-1.200 €
- Gesamt: ca. 1.800-2.600 €
- Plus laufend: ca. 50 €/Monat (SIM + HALE Fiskal für 5 Fahrzeuge)

Amortisiert sich in ca. 4 Monaten durch die Steuerberater-Einsparung.

### Drucker-Integration (optional, später)

---FRAGMENT-BREAK---

- 1 Test-Drucker TPD-02-BT-D: 284 € netto
- Wenn Test erfolgreich: 4 weitere à 284 € = 1.136 €
- Erst nach erfolgreichem Test entscheiden

---

*Finaler konsolidierter Prompt für: Patrick Wydra, Funk Taxi Heringsdorf*  
*Stand: April 2026 — Module 1 bis 9*

---FRAGMENT-BREAK---

