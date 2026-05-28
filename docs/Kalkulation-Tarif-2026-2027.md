# Selbstkosten-Kalkulation Taxi Funk Taxi Heringsdorf
## Stand: 28.05.2026 · Kalkulationsbasis: Mindestlohn 14,60 € (geplant 01.01.2027)

Methodisch angelehnt an Linne+Krause-Tarifgutachten (bundesweit anerkannte Methodik nach §39 PBefG und VO über Beförderungsentgelte). Personalkosten dominieren mit ~55-60% Anteil — wie in deren Gutachten Essen/Berlin/Hamburg dokumentiert.

---

## A) Selbstkosten je Fahrzeug-Stunde (€/h)

### A1) Lohn-Kosten
| Position                              | Betrag €/h |
|---------------------------------------|------------|
| Mindestlohn (geplant 01.01.2027)      |    14,60 € |
| Arbeitgeberanteil Sozialvers. (~21%)  |     3,07 € |
| Lohnnebenkosten (BG, Umlage U1/U2, ~9%) |   1,31 € |
| **Lohnkosten brutto**                 |  **18,98 €/h** |

### A2) Fahrzeug-Kosten (Tesla Y / Renault Traffic Mix)
| Position                              | Betrag €/h |
|---------------------------------------|------------|
| Leasing / AfA Wagen (ca. 600€/Mo / 200h)|    3,00 € |
| Versicherung (Vollkasko + Personenbef.) (~1.800€/J / 2200h) | 0,82 € |
| KFZ-Steuer + TÜV/HU                   |     0,40 € |
| Inspektion + Reifen (1.200€/J)        |     0,55 € |
| **Wagenkosten total**                 |  **4,77 €/h** |

### A3) Sprit-/Lade-Kosten
| Position                              | Betrag €/h |
|---------------------------------------|------------|
| Strom (Tesla Y: 0,18 kWh/km × ~25 km/h × 0,30€/kWh) | 1,35 € |
| Diesel-Anteil Renault Traffic (5L/h × 1,65€) | 8,25 € |
| Gewichteter Mix (70% Tesla / 30% Renault) | **3,42 €/h** |

### A4) Sach- und Verwaltungskosten
| Position                              | Betrag €/h |
|---------------------------------------|------------|
| IT / Software (DATEV, Lexware, Hosting)|    0,60 € |
| Versicherung Betrieb (BHV, BU)        |     0,30 € |
| Werbung / Marketing                   |     0,40 € |
| Telefon / Internet                    |     0,20 € |
| Steuerberatung (ECOVIS)               |     0,50 € |
| Büromaterial / Sonstiges              |     0,30 € |
| **Verwaltung total**                  |  **2,30 €/h** |

### A5) Wartung / Reparatur
| Position                              | Betrag €/h |
|---------------------------------------|------------|
| Reparaturen + Ersatzteile             |     1,20 € |
| Reifenwechsel + Service               |     0,40 € |
| **Wartung total**                     |  **1,60 €/h** |

---

## B) Selbstkosten je Stunde — Zusammenfassung

| Kostenblock                | €/h    | Anteil |
|----------------------------|--------|--------|
| Lohnkosten brutto          | 18,98 €| 62,1%  |
| Wagenkosten                |  4,77 €| 15,6%  |
| Sprit/Strom (Mix)          |  3,42 €| 11,2%  |
| Verwaltung                 |  2,30 €|  7,5%  |
| Wartung                    |  1,60 €|  5,2%  |
| **SELBSTKOSTEN BRUTTO**    |**30,57 €/h** | 100% |
| + 10% Gewinnaufschlag (üblich klein) |  3,06 € | |
| **= MINDEST-STUNDENSATZ**  |**33,63 €/h** | |

---

## C) Umrechnung in Tarif-Empfehlung

Bei einer durchschnittlichen Stadt-Geschwindigkeit von 25 km/h (Heringsdorf-Kaiserbäder Mix Innerorts/Bundesstraße) ergibt sich:

```
Selbstkosten/km = 33,63 € / 25 km/h = 1,35 €/km (reine Fahrtzeit)
```

Aber: Taxi-Fahrzeuge sind nur zu ca. 65-70% der Online-Zeit produktiv unterwegs (Rest = Leerfahrt, Stand-by, Pickup-Anfahrt). Korrigiert:

```
Selbstkosten/Produktiv-km = 1,35 / 0,67 = 2,01 €/km
```

Plus Fix-Anteil über Grundgebühr (Leerfahrt-Kompensation, ~2 km/Tour):

```
Grundgebühr soll decken:    2 km × 2,01 €/km × 50% = 2,01 €
                          + 30% Risikopuffer
                          ≈ 2,60 € Fix-Anteil pro Tour
```

---

## D) Empfohlene Tarif-Struktur (Tag)

| Position           | Aktuell (Aug 2022) | Empfehlung 2026 | Erhöhung |
|--------------------|--------------------|------------------|----------|
| Grundgebühr Tag    | 4,00 €             | **5,50 €**       | +37,5%   |
| Grundgebühr Nacht  | 5,50 €             | **6,90 €**       | +25,5%   |
| km 1-2 (Tag)       | 3,30 €             | **3,80 €**       | +15,2%   |
| km 3-4 (Tag)       | 2,80 €             | **3,20 €**       | +14,3%   |
| km ab 5 (Tag)      | 2,20 €             | **2,50 €**       | +13,6%   |
| Wartezeit/h        | 40,00 €            | **50,00 €**      | +25,0%   |

**Durchschnittliche Tarif-Erhöhung gewichtet nach Fahrt-Verteilung (Daten aus 1.137 completed Fahrten 2025-2026):**

| km-Stufe | Anteil Fahrten | Heute Ø-Preis | Empfehlung | Erhöhung |
|----------|----------------|---------------|------------|----------|
| ≤2 km    | 39,2%          | 10,60 €       | 13,10 €    | +23,6%   |
| 2-5 km   | 33,9%          | 17,00 €       | 20,30 €    | +19,4%   |
| 5-10 km  | 11,1%          | 27,40 €       | 32,60 €    | +19,0%   |
| 10-20 km | 9,0%           | 47,40 €       | 56,10 €    | +18,4%   |
| >20 km   | 6,8%           | 90,00 €       | 105,80 €   | +17,6%   |

**Gewichteter Durchschnitt: +20,5%**

---

## E) Vergleich mit anderen Tarifgebieten (Stand 2024/25)

| Stadt           | Grundgeb. | km-Tarif (Schnitt) | Wartezeit/h | Letzte Anpassung |
|-----------------|-----------|---------------------|-------------|------------------|
| Heringsdorf     |  4,00 €   | 2,80 € (Schnitt)    | 40 €        | Aug 2022         |
| Berlin (2024)   |  4,30 €   | 2,60 € (km 8+)      | 41 €        | Jan 2024 +5,5%   |
| Hamburg (2024)  |  4,00 €   | 2,80-3,40 €         | 42 €        | Apr 2024 +6%     |
| Düsseldorf (2023)|  4,50 €  | 2,90 €               | 38 €        | Dez 2023 +9%     |
| Essen (2020)    |  4,00 €   | 2,00-2,10 €          | 30 € (Zeit) | Mär 2020         |

→ Heringsdorf-Tarif war 2022 marktgerecht, ist 2026 deutlich unter Marktniveau. Empfehlung +20% bringt uns wieder ins Mittelfeld.

---

## F) Auswirkung auf Jahresumsatz

Basisdaten aus HALE-Tagesabrechnungen 2025:
```
2025 Brutto:    145.256 €
× 1,205 (gewichtete Erhöhung +20,5%):    175.034 €
Mehrumsatz/Jahr:                          +29.778 €
```

Davon abzudecken (Mindestlohn-Sprung 12,82€ → 14,60€):
```
Mindestlohn-Differenz pro Stunde: 1,78 €
× Lohnnebenkosten Faktor 1,30:    2,31 €
× Bezahlte Std/Jahr (geschätzt 4.000 für 2 Mitarbeiter):  9.240 €
```

→ Reine Mindestlohn-Deckung kostet 9.240 €/Jahr. Bleiben **~20.500 €/Jahr Spielraum** für Inflation+Sprit+Sach-Steigerungen + Risiko-Puffer für 2028.

---

**Erstellt:** 28.05.2026 · Funk Taxi Heringsdorf, Patrick Wydra
**Methode:** Linne+Krause-Selbstkosten-Methodik (§39 PBefG)
