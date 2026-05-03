# ECOVIS-Stundenzettel — Format-Dokumentation

Quelle: 3 echte Vorlagen für März 2026 (Dombrowski / Kargoll / Kulpa) unter
`samples/ecovis-stundenzettel/`. Patrick hat sie als ZIP geschickt am 03.05.2026
für den Schichtplan-Lohnexport (Block A der TODOs).

## Datei

- **Pro Mitarbeiter und Monat** eine `.xlsx` Datei
- Dateiname: `<Monat>_<Jahr>_<NACHNAME>_PAUSE_KORREKT.xlsx`
- Beispiel: `März_2026_DOMBROWSKI_PAUSE_KORREKT.xlsx`

## Struktur (Sheet 1, ein Sheet pro Datei)

### Header (Zeile 1)
- `A1` (merge A1:L1): `<Nachname> <Monat> <Jahr>` — z.B. `Dombrowski März 2026`

### Spalten (Zeile 2 — Header)

| Spalte | Header | Inhalt |
|--------|--------|--------|
| A | Datum | `DD.MM.` z.B. `01.03.` |
| B | Tag | `Mo Di Mi Do Fr Sa So` |
| C | Rufber.(h) | Rufbereitschafts-Zeitfenster, z.B. `19.00-20.00 (1)` (1=1h) |
| D | Schichtzeit (h) | Hauptschicht-Zeitfenster, z.B. `20.00-22.00 (2)` (2=2h) |
| E | (h) Pause | Pausen-Stunden, leer oder `-` |
| F | Pause Zeit | Pausen-Zeitfenster, leer oder `-` |
| G | geleist.Std. | Geleistete Stunden (Zahl) |
| H | Rufber.(h) | Zweiter Rufbereitschaftsblock, z.B. `22.00-23.00 (1)` |
| I | Rufber.ges. | Summe Rufbereitschaft pro Tag (Zahl) |
| J | So.-zul. 50% | Sonntagszuschlag (Stunden), Hinweis in Zeile 3: `20.00-00.00` |
| K | Nacht 25% | Nachtzuschlag 25% (z.B. 20:00-00:00 / 06:00-08:00) |
| L | Nacht 40% | Nachtzuschlag 40% (z.B. 00:00-06:00) |

### Datenzeilen (4 bis Anzahl-Tage+3)
- Eine Zeile pro Tag des Monats — Auch leere Tage haben Datum + Wochentag
- Inhaltliche Felder bei Frei-Tagen leer
- Beispiel arbeitstag (Do 05.03.):
  - Rufber.: `19.00-20.00 (1)` (1h)
  - Schicht: `20.00-22.00 (2)` (2h)
  - Pause: `-` (keine)
  - geleist.Std.: `2`
  - Rufber. 2: `22.00-23.00 (1)` (1h)
  - Rufber.ges.: `2` (Summe 1h + 1h)

### Summen-Zeilen (n+1 und n+2 nach Datenende)
- Zeile n+1: `G=Anzahl Std.` + `I=Anzahl Rufber.-Std.`
- Zeile n+2: `G=Brutto-Lohn aus Schicht` (€) + `I=Brutto-Lohn aus Rufbereitschaft` (€)
- Beispiel Dombrowski März 2026:
  - 24 Std Schicht / 24 Std Rufber.
  - Schicht: 333,60 € → Stundenlohn ≈ **13,90 €/h**
  - Rufber.: 60 € → Rufber.-Lohn ≈ **2,50 €/h** (24h × 2,50)

## Zeitfenster-Format

`HH.MM-HH.MM (X)` wobei `X` die Stunden sind.
- `19.00-20.00 (1)` = 1h
- `20.00-22.00 (2)` = 2h
- `22.00-23.00 (1)` = 1h

Die Trennung zwischen Schichtzeit und Rufber. ergibt sich aus dem Zeitfenster
in Zusammenhang mit dem Tarifvertrag. Stunden werden separat aufaddiert, weil
**Rufbereitschaft anders bezahlt wird als reguläre Schicht**.

## Mitarbeiter-Stammdaten (für Export benötigt)

Aus dem ECOVIS-Format ableitbar:
- Nachname
- Stundenlohn Schicht (€/h) — z.B. 13,90
- Stundenlohn Rufber. (€/h) — z.B. 2,50
- Sonntagszuschlag-Faktor (50%)
- Nachtzuschlag 25% (Stunden 20:00-00:00 / 06:00-08:00)
- Nachtzuschlag 40% (Stunden 00:00-06:00)

Zusätzlich für den vollständigen ECOVIS-Lohnexport (PDF/CSV):
- Vorname, Nachname
- Personal-Nummer
- SV-Nummer
- Steuer-ID
- Wochenarbeitszeit Soll
- Vertragsbeginn / Ende
- Krankenkasse
- Bankdaten (IBAN)
- Geburtsdatum

## Phasen-Plan (aus TODO-Memory)

1. **Phase 1** (✅ heute): Mitarbeiter-Stammdaten — Schema + Admin-Tab CRUD
2. **Phase 2**: Wochenplan-UI (Mo–So Raster pro Mitarbeiter, Schicht-Eintrag)
3. **Phase 3**: Auto-Erfassung Ist-Zeiten aus `vehicleShifts`
4. **Phase 4**: Wochen-/Monatsansicht Soll vs Ist
5. **Phase 5**: ECOVIS-Export (XLSX im Format oben + CSV)

## Hinweise

- Die ECOVIS-Vorlage hat keinen `sharedStrings.xml` — alle Strings sind als
  `<is><t>…</t></is>` (inline strings) direkt in `sheet1.xml`. Beim Export
  also ebenfalls inline strings nutzen, damit ECOVIS die Datei wie gewohnt
  lesen kann.
- Spalte E (`(h) Pause`) und F (`Pause Zeit`) bleiben in den Beispielen
  immer `-` oder leer. Vermutlich werden Pausen abhängig vom Tarifvertrag
  nicht abgezogen oder die Schichten waren <6h (kein Anspruch).
- Spalten J/K/L in den Beispielen alle leer. Vermutlich nur ausgefüllt wenn
  die Schicht in den Sonn-/Nachtzeitraum fällt — bei den 19:00-23:00-Schichten
  greift K (25%-Zuschlag ab 20:00).
