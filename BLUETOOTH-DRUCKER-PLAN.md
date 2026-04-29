# Bluetooth-Drucker Integration — TPD-02-BT (HALE)

**Status:** Vorbereitung läuft (29.04.2026) — Hardware-Test beim Servicetechniker geplant.

---

## 1. Hardware-Specs (TPD-02-BT)

- **Hersteller:** HALE electronic GmbH
- **Schnittstelle:** Bluetooth (Classic / vermutlich SPP-Profil; BLE-Variante muss bestätigt werden)
- **Anwendung:** Quittungs-Druck am Fahrzeug-Standort (mobil), Anbindung an Taxameter MCT-06 + TSE-Box SEI-03
- **Kompatibilität laut HALE:** Android (Bluetooth einmalig pairen + via App ansteuern)
- **OFFEN — Patrick fragt Servicetechniker / HALE-Support:**
  - Bluetooth-Profil: SPP (RFCOMM) oder BLE GATT?
  - Druck-Protokoll: ESC/POS (Standard), HALE-proprietär oder beides?
  - Zeichensatz: CP437, CP850 oder UTF-8?
  - Papierbreite: 58 mm (vermutet) oder 80 mm?
  - Reicht Strom über Akku/USB-C?

---

## 2. Capacitor-Plugin-Auswahl

### Empfehlung: **`@capacitor-community/bluetooth-le`** + nativer SPP-Fallback
- BLE deckt moderne Drucker ab (häufig der Fall bei aktuellen TPD-Modellen).
- Falls TPD-02-BT klassisches SPP nutzt → eigener Android-Kanal über `BluetoothSocket` mit UUID `00001101-0000-1000-8000-00805F9B34FB`.

### Alternative
- `cordova-plugin-bluetooth-serial` — nur SPP/Classic, kein BLE.
- Reine Native-Implementierung ohne Plugin (nur `BluetoothAdapter`/`BluetoothSocket`) — schlankster Weg, da unsere App ohnehin nativ Android ist und kein iOS-Support gefordert ist.

### Entscheidung (sobald Profil bekannt)
- **SPP**: native `BluetoothSocket`-Klasse `EscPosPrinter.java` schreiben (kein Plugin nötig).
- **BLE**: `@capacitor-community/bluetooth-le` über npm einbinden + GATT-Service vom Hersteller bestätigen lassen.

---

## 3. ESC/POS Quittungs-Layout (58 mm)

```
       FUNK TAXI HERINGSDORF
   Kanalstr. 1, 17424 Heringsdorf
        Tel. 038378 / 13313
   USt-IdNr.: DE205006336
- - - - - - - - - - - - - - - - -
Beleg-Nr.   2026-04-29-12345
Datum/Zeit  29.04.2026 14:37
Fahrer      P. Wydra
Fahrzeug    PW-IK 222
- - - - - - - - - - - - - - - - -
Abfahrt     Heringsdorf, Strand
Stopp 1     Bansin, Lidl
Ziel        Ahlbeck, Bahnhof
Strecke     12,4 km
Dauer       0:24 h
- - - - - - - - - - - - - - - - -
Grundpreis           4,00
Strecke   12,4 km   24,80
Wartezeit  5 Min     3,35
- - - - - - - - - - - - - - - - -
Summe netto         29,12
MwSt 7 %             2,03  ← (Personenbeförderung)
SUMME BRUTTO        31,15 EUR
- - - - - - - - - - - - - - - - -
Bezahlart   Bar / Stripe / Hotel
[QR Stripe-Link]
- - - - - - - - - - - - - - - - -
   Vielen Dank, gute Fahrt!
        funktaxi.de
```

### ESC/POS-Befehle (Standard-Set, das wir generieren)
- `ESC @` — Drucker reset
- `ESC ! 0x30` — Doppelgröße (Header)
- `ESC a 1` — Zentriert
- `ESC a 0` — Linksbündig
- `GS V 0` — Papier abschneiden (full cut)
- `GS k 65` — QR-Code-Block (Stripe-Link)

---

## 4. Code-Stellen (was anzupassen ist)

### Native Android (Drucker-Aufruf nach Bezahlung)
- `DriverDashboardActivity.java:1487` `markCompleted()` — direkt vor dem Toast den Druck triggern, sobald `paymentMethod` ≠ `null` und `printerEnabled` in Settings.
- `DriverDashboardActivity.java:1257` `showPaymentDialog()` — zusätzlicher Button **„🖨 Quittung drucken"** im Dialog (Patrick-Vorlieben: optional, kein Pflicht-Druck).

### Neue Datei
- `android/app/src/main/java/de/taxiheringsdorf/app/EscPosPrinter.java`
  - `connectSpp(macAddress)` / `connectBle(deviceId)`
  - `printReceipt(Ride r, double amount, String paymentMethod, String stripeUrl)`
  - `disconnect()`

### Settings (Firebase)
- `settings/printer/enabled` — global on/off (Admin-Toggle).
- `settings/printer/macAddress` — gepairtes Gerät (pro Fahrzeug).
- `settings/printer/profile` — `spp` | `ble`.
- `settings/printer/paperWidth` — 58 / 80 mm.
- `settings/printer/footerLine1..3` — frei konfigurierbar (z.B. „Vielen Dank, gute Fahrt!").

### UI in `index.html`
- Admin-Tab „Bezahlung & Drucker" → Pair-Button + Test-Druck-Button + Footer-Editor.
- Pro Fahrzeug-Profil eigene MAC-Adresse hinterlegbar (S9+ pairt seinen TPD, Tesla pairt seinen).

### Cloud-Function (optional, Stufe 2)
- `printReceiptViaApp({ rideId, vehicleId })` — Cloud-Trigger, der ein Druck-Event in `rides/{id}/printRequest` setzt; das Fahrer-Handy hört darauf und druckt.
- Sinnvoll, wenn auch nach-träglich aus dem Web/CRM gedruckt werden soll.

---

## 5. UI-Workflow Drucker pairen (Native)

1. Admin öffnet „Einstellungen → Drucker".
2. Tippt **„🔍 Geräte suchen"**.
3. App listet sichtbare BT-Geräte; HALE-TPD-02-BT erscheint mit MAC.
4. Tippt darauf → Android-Pairing-Dialog (PIN meist `0000` oder `1234`).
5. Nach erfolgreichem Pair speichert die App MAC + Profil in Firebase.
6. **„🧾 Test-Druck"** druckt eine Beispiel-Quittung mit Heutigem Datum.
7. Bei Fehler — Toast mit Hinweis (z.B. „Drucker außer Reichweite").

---

## 6. Test-Plan (Servicetechniker-Termin)

| # | Test | Erwartetes Ergebnis |
|---|------|----------------------|
| 1 | TPD-02-BT einschalten + pairen mit S9+ | Pairing erfolgreich, MAC sichtbar |
| 2 | Test-Druck aus Admin-Panel | Beispiel-Quittung kommt raus |
| 3 | Echte Fahrt → markCompleted + Bar-Bezahlung | Quittung mit echten Daten |
| 4 | Stripe-QR + Druck | QR-Block druckbar |
| 5 | Drucker außer Reichweite | App zeigt Fehler-Toast, Fahrt ist trotzdem `completed` |
| 6 | Akku-Stand niedrig auf TPD-02-BT | Druck noch lesbar / Fehlerwarnung |
| 7 | Zeichensatz: Umlaute (ä, ö, ü, ß) | Korrekt gedruckt |

**Patrick fragt Servicetechniker:**
- BT-Profil und Druck-Protokoll
- Standard-PIN
- Dokumentation / Beispiel-Code (HALE-Support hat manchmal SDK)

---

## 7. To-do bis zum Servicetechniker-Termin

- [ ] HALE-Support-Anfrage formulieren (BT-Profil + ESC/POS-Konformität)
- [ ] `EscPosPrinter.java` Skelett anlegen (mit Mock für Test ohne Hardware)
- [ ] Settings-Schema in Firebase anlegen (`settings/printer/*`)
- [ ] Admin-UI „Drucker-Einstellungen" in `index.html` skizzieren
- [ ] Test-Druck-Button in `DriverDashboardActivity` (`showPaymentDialog`)
- [ ] Capacitor-Plugin entscheiden (SPP nativ vs. BLE-Plugin)
- [ ] Permission `BLUETOOTH_CONNECT` + `BLUETOOTH_SCAN` in `AndroidManifest.xml`

---

## 8. HALE-Support-Anfrage (Entwurf)

**An:** support@hale.de
**Von:** taxiwydra@gmx.de (Funk Taxi Heringsdorf, Kunden-Nr. DE205006336)
**Betreff:** TPD-02-BT — Schnittstellen-Dokumentation für Eigen-Integration

> Sehr geehrtes HALE-Team,
>
> wir betreiben Funk Taxi Heringsdorf und planen, den TPD-02-BT
> Bluetooth-Drucker direkt aus unserer eigenen Android-Fahrer-App heraus
> anzusteuern. Für die Implementierung benötigen wir folgende
> Informationen:
>
> 1. Welches Bluetooth-Profil nutzt der TPD-02-BT (Bluetooth Classic / SPP
>    mit RFCOMM-UUID, oder BLE / GATT)? Falls BLE: welche Service-/
>    Characteristic-UUIDs?
> 2. Welches Druck-Protokoll erwartet der Drucker (ESC/POS, HALE-proprietär,
>    beides)? Gibt es ein Befehlsreferenz-PDF?
> 3. Standard-Pairing-PIN?
> 4. Empfohlener Zeichensatz für Umlaute (CP437, CP850, UTF-8)?
> 5. Papierbreite (58 mm oder 80 mm) und max. Druckbreite in Punkten?
> 6. Gibt es ein Android-SDK / Beispiel-Code?
>
> Hintergrund: Wir setzen den Drucker ergänzend zum HALE-Datacenter-Workflow
> ein, um Quittungen direkt am Fahrzeug-Standort beim Kunden zu drucken
> (Bar-Zahlung, Stripe-QR-Beleg).
>
> Vielen Dank im Voraus!
> Patrick Wydra — Funk Taxi Heringsdorf

---

## 9. Risiken / Offene Fragen

- **TSE-Bindung:** Falls der TPD-02-BT in Verbindung mit der SEI-03 TSE-Box
  läuft, muss die Druck-Quittung den TSE-Hash mit drucken (KassenSichV).
  → Klären, ob unsere App die Quittung allein (ohne TSE-Mitwirkung)
  drucken darf, oder ob der Druckauftrag durch das Taxameter laufen muss.
- **Mehrere Fahrzeuge:** Jedes Fahrzeug sollte sein eigenes pairing
  speichern, sonst „verwechseln" sich Drucker.
- **S9+ Eignung:** Patricks SMS-Gateway-Tesla hat einen S9+ (Android 8).
  BLE und Classic werden ab Android 5 unterstützt — sollte gehen.
- **Stromversorgung TPD-02-BT:** Kann den ganzen Tag laufen? Oder
  Schichtpause = ausschalten / aufladen?
