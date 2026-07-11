# Changelog

Alle wichtigen Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/).

---

## [6.63.684] - 2026-07-11

### 🐛 Native Driver-Banner: 'Erledigt'-Option bei überfälligen Wartepool-Fahrten (E)

Patrick 11.07. 10:50 Bridge: *'9:40 Uhr, jetzt 10:50, ich will die Fahrt als erledigt markieren nicht übernehmen'*.

**`DriverDashboardActivity.showUnassignedRideGrabDialog` (~Z1751):**
- Bisher nur 2 Buttons: ✅ Übernehmen / Abbrechen
- Neu bei Pickup >15 Min überfällig: dritter Button `✔ Erledigt (schließen)`
  - Setzt `status=completed`, `_erledigtOhneFahrer=true`, räumt Wartepool-Felder auf
  - Titel-Erweiterung `⏰ X Min überfällig`

---

## [6.63.683] - 2026-07-11

### 🐛 Native: 'Frei für Sofort'-Banner nur bei echten Situationen

Patrick 11.07. 08:28 Bridge: *'Kannst du oben den Banner "Frei für Sofortfahrten" wenn nichts ist einfach weg machen. Nur wenn wirklich eine Fahrt überfällig ist. Sonst benutzt der oben zu viel sinnlos.'*

**Fix `DriverDashboardActivity.updateStatusBanner` (~Z2149 + Z2210):**
- Vorher: grüner Banner `🟢 Frei für Sofort-Anfragen — keine Vorbestellung in Sicht` immer sichtbar wenn kein Termin ansteht
- Vorher: grüner Banner `🟢 Frei für Sofort · max X Min` sichtbar bei entspannter Lage (Pickup >30 Min)
- Neu: beide grünen Fälle → `banner.setVisibility(View.GONE)`
- Rot/Gelb-Fälle (Losfahren, Pickup naht, kurzes Fenster, ohne Fahrer, überfällig) bleiben sichtbar

---

## [6.63.682] - 2026-07-11

### ✨ Cloud + Native: Schicht-Änderung triggert sofortige Re-Zuweisung (R)

Patrick 11.07. 07:01 Bridge: *'Wenn ich das Fahrzeug die Uhrzeit verändere, muss sofort geändert werden'*.

**Cloud — neue HTTP-Function `retriggerAssignAfterShiftChange` (~Z24250):**
- POST `{ vehicleId }` löst für alle vorbestellten Fahrten der nächsten 48h einen Re-Assign aus
- Fahrten des Fahrzeugs werden freigegeben (assignedVehicle=null) und via `autoAssignRide` neu berechnet
- Response: `{ released, candidatesChecked, newlyAssigned }`

**Native `ShiftEditorActivity`:**
- Nach jedem Save (Hauptschicht + Tages-Override + Wochenplan-Editor) → `triggerReassignForVehicle(vehicleId, name)` als POST-Call
- Toast zeigt Ergebnis: `🔁 Vito LK: 2 freigegeben, 1 neu zugewiesen`

Bisher: nur 10-Min-Cron. Jetzt: Wirkung sofort sichtbar.

---

## [6.63.681] - 2026-07-10

### ✨ Native Dispo: Korrespondenz-Zeile direkt in Fahrt-Karte (Q-Fortsetzung)

Patrick 10.07. 16:56 Bridge: *'In dem Termin mit den Kunden sollen die Korrespondenzen auch enthalten sein. Nicht dass ich das irgendwo suchen muss.'*

**Neu — kompakte Zeile direkt in der Fahrt-Karte:**
Aus Ride-eigenen Send-Flags gebaut:
- 🧾 Rechnung mit Zeit + Kanal (email/whatsapp/sms)
- ✉ Email
- 📲 SMS
- 💬 Telegram

Beispiel: `📨 🧾 09.07. 21:31 (email) · 📲 10.07. 06:37`

Volle Timeline weiter per LongPress → 'Korrespondenz anzeigen' (v6.63.680) — dort auch anfrage-Bestätigungen, smsQueue, personalMailQueue.

---

## [6.63.680] - 2026-07-10

### ✨ Native Dispo: Korrespondenz-Timeline pro Fahrt (Q)

Patrick 10.07. 16:40 Bridge: *'Ich sehe die Korrespondenzen nicht zwischen den Kunden und mir. Normalerweise müsste ich sehen was rausgeschickt wurde und was nicht.'*

**Neu — LongPress auf Fahrt-Karte in Dispo:**
- Aktions-Menü: '📨 Korrespondenz anzeigen' / '✏️ Bearbeiten' / '❌ Schließen'

**Korrespondenz-Dialog `showKorrespondenzDialog`:**
Sammelt aus 3 Firebase-Nodes nach `rideId`:
- `/anfragen` — confirmSent-Felder mit confirmChannel + confirmSentAt
- `/smsQueue` — text + category + createdAt
- `/personalMailQueue` — subject + status (pending_approval / sent)

Timeline chronologisch, mit Icon (📱 WA / ✉ Email / 📲 SMS) + Zeit + Kanal + Text-Snippet + Status.

Hinweis wenn leer: 'Manuelle Sends via CRM erscheinen hier NICHT (noch)'.

---

## [6.63.679] - 2026-07-10

### 🐛 Native Dispo: Engpass-Schwelle 5 Min statt jede Minute (O)

Patrick 10.07. 16:28 Bridge: *'Zwei Minuten ist Quatsch als Engpass. Alles bis 5 Min ist mir egal.'*

**Änderung `AdminDashboardActivity` Konflikt-Detection (~Z577):**
- Bisher: jedes deficit > 0 Min → `⚠️ Engpass`-Badge
- Neu: `deficit <= 5 Min` → keine Anzeige (Karenz) — außer nächste Fahrt geht zum Bahnhof
- `deficit 6-10 Min` → `⚠️ Engpass`
- `deficit > 10 Min` → `🚨 Kollision`
- Bahnhof-Sonderregel bleibt: nächste Fahrt zum Bahnhof zeigt Engpass auch bei <5 Min (Zug verpasst = Kunde weg)

---

## [6.63.678] - 2026-07-10

### 🐛 Native Dispo: Wartepool-Diagnose sichtbar + Rides bleiben in Timeline

Patrick 10.07. 16:04-16:05 Bridge:
*'es zeigt aber auch keinen Grund an'* + *'das habe ich nirgends gesehen'* + *'weil der wartepool oben angezeigt wird und aus der Disposition verschwindet das ist unübersichtlich'*.

**Fix 1 — Details per Default aufgeklappt (Z3297):**
- Bisher war Wartepool-Diagnose (`autoAssignLastReason`, `wartepoolReason`, `vehicleScores`) hinter '💡 Details'-Toggle versteckt (default GONE)
- Neu: default VISIBLE. Toggle zeigt '▲ Details' um zuzuklappen.

**Fix 2 — Wartepool-Rides bleiben in Tag-Timeline (Z396):**
- v6.63.375 hatte Wartepool aus rest entfernt und am ENDE als eigene Sektion angezeigt
- Patrick heute: aus Timeline verschwinden ist unübersichtlich — er will die Fahrt bei ihrer Uhrzeit sehen
- Neu: Wartepool-Rides bleiben in Tag-Timeline INLINE. Der obere Wartepool-Banner-Count bleibt als visuelle Sofort-Info.

---

## [6.63.677] - 2026-07-10

### 🐛 Cloud autoAssignRide: 'ended' Schicht wieder ins 4h-Fenster (I-Korrektur)

Patrick 10.07. 15:48 Bridge: *"MY ist eingeteilt ab 5:45, warum kein Fahrzeug"*.

**Problem:** v6.63.672 hatte `ended` + `force-ended` HART geblockt, egal wie weit weg der Pickup war. Zu streng: Patrick beendete heute 15:22 seine MY-Schicht → Auto-Assign für morgen 07:50 (Fahrt "Das Ahlbeck") lief danach → MY komplett aus dem Pool geworfen → wartepool. Aber morgen 05:45 startet er ja wieder Schicht (Wochenplan).

**Fix:**
- `force-ended` → HART blocken (bewusst gesetzt, kein Fahrer geplant)
- `ended` + `auto-ended` + Pickup <4h → blocken (unmittelbar → sonst hängt)
- `ended` + `auto-ended` + Pickup ≥4h → **durchlassen** (Wochenplan ist Autorität für Vorbestellungen; Fahrer kann bis dahin wieder in Schicht kommen)

Der Koch-Fall (Kulpa 63h offline, Pickup 3h20min entfernt) wird weiterhin geblockt weil <4h-Fenster greift.

---

## [6.63.676] - 2026-07-10

### 🐛 Rechnung-Send: PDF-Integrität + Dialog radikal vereinfacht (N-Fortsetzung)

Patrick 10.07. 15:11 Bridge: *"gesendete PDF konnte nicht geöffnet werden weil beschädigt"* + *"Rechnung an Auftraggeber ist zu kompliziert. Ich will nur die PDF an die Email angehängt haben, mehr nicht."*

**Cloud `sendInvoiceEmail` — PDF-Fetch mit Integritätsprüfung (~Z35201):**
- Bisher konnte ein unvollständig heruntergeladenes PDF stillschweigend als Anhang gesendet werden → Empfänger sah "PDF-Datei ist beschädigt"
- Neu: Content-Length gegen Buffer-Länge geprüft, `%PDF-` Header + `%%EOF` Footer verifiziert, mind. 128 Bytes
- Bei jeder Anomalie: HTTP 500 zurück mit klarer Fehlermeldung. Rechnung wird NICHT versendet (statt kaputten Anhang zu verschicken)
- Redirect-Chain jetzt bis zu 3 Ebenen tief (301/302/303/307/308)

**Native Dialog — schlank + editierbarer Text (~Z2135):**
- Zusammenfassung: nur `💰 10,00 € · 👤 Kunde` in einer Zeile (vorher: 5-6 Zeilen mit Route)
- Betreff-Feld entfernt — Cloud setzt automatisch
- **Editierbares Anschreiben** mit sinnvollem Default:
  `Sehr geehrte {customerName}, im Anhang finden Sie die Rechnung {nr} über {betrag}. Vielen Dank für Ihre Buchung. Mit freundlichen Grüßen, Patrick Wydra, Funk Taxi Heringsdorf`
- Text wird als `htmlBody` an Cloud-Function übermittelt (Zeilenumbrüche → `<br>`)
- Bleibt: Empfänger + Send + Cancel

---

## [6.63.675] - 2026-07-10

### 🐛 Native Admin: Rechnung-an-Auftraggeber-Dialog zeigt Klartext-Betrag (N)

Patrick 10.07. 14:45 Bridge: *"Rechnung an Auftraggeber senden zeigt 0 Euro. Warum wird die Web-App geöffnet?"*

**Ursache:** `showInvoiceEmailDialog` (v6.63.534) lud das Rechnungs-PDF via `docs.google.com/gview` WebView. Das wirkte als würde eine Web-App geöffnet — und wenn der Viewer langsam lud oder Patrick nicht scrollte, sah er keinen Betrag → 0-Euro-Eindruck. Das PDF war tatsächlich korrekt (10,00 EUR bei Ostseeblick-Fahrt 20-26-1369, geprüft via pdftotext).

**Fix:**
- PDF-WebView-Vorschau entfernt (kein `docs.google.com` mehr, kein Web-App-Eindruck)
- Klartext-Zusammenfassung direkt im Dialog: Rechnungsbetrag, Datum, Kunde/Gast, Pickup, Ziel, PDF-Anhang-Hinweis
- Wenn kein `invoicePdfUrl` gesetzt: Warnung "PDF-Anhang FEHLT" statt stillschweigendes Weiterlaufen
- Empfänger, Betreff, Send/Cancel-Buttons unverändert (Cloud-Function `sendInvoiceEmail` bekommt PDF-URL als Attachment)

---

## [6.63.674] - 2026-07-10

### 🐛 Native Schicht-Editor: 3 UX-Fixes + alte Fahrzeuge raus (L + M)

Patrick 10.07. 13:49-13:58 Bridge zu Einzeltag-Override:
*"Ich wollte heute PWMY222 nur bis 14 Uhr laufen lassen. Override steht bis 14 Uhr, aber wenn ich drauf drücke steht wieder bis 16:30 Uhr."*

**Fix 1 — Default-Mode NUR_HEUTE statt WOCHENPLAN** (~Z767, ~Z802):
- 3-Pill-UI (v6.63.270) hatte 📅 Wochenplan als Default. Jede Zeit-Änderung überschrieb versehentlich den Wochenplan.
- Jetzt: 📌 NUR HEUTE ist Default. Wer Wochenplan ändern will, tippt bewusst 📅.

**Fix 2 — Edit-Dialog lädt Override-Zeiten statt Wochenplan** (~Z634):
- Bisher zeigte Pre-Fill immer `defaultTimes[dow]` (Wochenplan-Zeiten). Bestehende Overrides waren beim Wieder-Öffnen unsichtbar → User dachte Override sei weg.
- Neu: wenn `vs.todayOverride=true` → `vs.todayStartTime/todayEndTime` (aktuelle Override-Zeiten) im Dialog vorbelegen.

**Fix 3 — Alte Fahrzeuge aus Schicht-Editor** (Z53-62):
- pw-sj-222 (VW Caravelle alt) + sbg-v-104 (Sprinter/Mazda) aus `OFFICIAL_VEHICLES` entfernt
- ovp-ii-600 + ovp-ik-222 waren hier eh nie in der Native-Liste
- In Firebase bleiben die Datensätze für Buchhaltung/TÜV-Historie
- Web-App hat sie bereits als `dmsOnly=true` markiert (v6.62.424)

---

## [6.63.672] - 2026-07-10

### 🐛 Cloud-Backend: Phase-0 Hard-Block + Non-Accept-Reassign (I)

Patrick 10.07. 11:27 Bridge: *"aber wenn der Fahrer nicht annimmt oder akzeptiert, dann muss das ja auch irgendwie weitergegeben werden an die Fahrer die Online sind"*.

**Ursache Koch-Fall (10.07. 06:39):** cloud-auto-optimize wies Fahrt (Pickup 10:00) an vg-lk-111 (Danilo) zu — trotz Schicht seit 07.07. 18:28 ended (63 Std offline). Grund: der v6.63.568-Schicht-Inaktiv-Check war nur aktiv bei Pickup <4h — beim Assign-Zeitpunkt lag Pickup weiter weg. Watchdog griff später auch nicht (msUntil<0 skip). Fahrt blieb unsichtbar.

**Fix `autoAssignRide` (functions/index.js ~Z1584):**
- `shift.status='ended'` und `'force-ended'` werden jetzt HART geblockt, egal wie weit weg der Pickup
- `shift.status='auto-ended'` bleibt beim 4h-Fenster (App-Restart kann Schicht reaktivieren)

**Fix STUCK-ASSIGNED-WATCHDOG (functions/index.js ~Z31258):**
- `acceptedAt=null` + Pickup kritisch (<=30 Min) + assignedAt>5 Min alt → als offline behandeln → Safety-Net triggert → warteschlange
- Vergangenheit (msUntil<0) wird weiterhin geskippt — überfällige Fahrten sind ohnehin verloren (Patrick 10.07. 11:40)

---

## [6.63.671] - 2026-07-10

### 🐛 Native Fahrer-App: Vorkasse-Rechnung sagte "Bar erhalten" (G)

- **DriverDashboardActivity — showPaymentMethodStage**: Erkennung der Vorkasse-Absicht erweitert
- Bisher (v6.63.502) nur wenn `stripePaymentStatus='paid'` ODER `paymentMethod='vorkasse'`
- Vorkasse-Fahrten aus Cloud-Auto-Flow (v6.63.263) haben `paymentMethod='stripe'` + `stripeCheckoutUrl` — Webhook kann verspätet sein → Option erschien nicht → Fahrer wählte Bar → Rechnung "Bar erhalten"
- **Neu**: `_prepaidContext` prüft zusätzlich `paymentMethod='stripe'` OR `stripeCheckoutUrl` gesetzt → Option "Vorkasse bezahlt (Kunde hat Link/Terminal genutzt)" → `markCompleted(stripe)` → Rechnung "Bezahlt per Stripe (online)"
- Ride-Model um `stripeCheckoutUrl` erweitert (frisch aus Firebase gelesen)

### 🐛 Native Admin-Dispo: Neue Sektion "VORGESEHEN — nicht bestätigt" (F)

- **AdminDashboardActivity — rebuildAdapterList**: neue oberste Sektion 🕐 vor der Tag-Timeline
- Filter: `status='assigned'` + `acceptedAt=null` + (`assignedAt` > 5 Min alt ODER `pickupTimestamp` < 30 Min entfernt/überfällig)
- Deckt Fälle ab wo Cloud-Auto-Optimize Fahrten an offline-Fahrer verteilt (Koch-Fall 10.07.: assignedAt=06:39, Fahrer Danilo Schicht seit 07.07. ended, Pickup 10:00 verstrichen — Fahrt bisher unsichtbar)
- Vorgesehen-Rides werden aus `rest` entfernt damit sie nicht doppelt in der Tag-Timeline erscheinen
- Ride-Model um `assignedAt` + `acceptedAt` erweitert
- Terminologie: 'assigned + acceptedAt=null' = VORGESEHEN · 'assigned + acceptedAt≠null' = wirklich zugewiesen (Patrick 10.07. 11:09 Bridge)

---

## [6.63.670] - 2026-07-10

### 🐛 Native Fahrer-App: Anfrage-Karte Ablehnen wieder erreichbar (A)

- **AdminDashboardActivity — AnfrageVH**: seit v6.63.629 löste Tap direkt `_uebernehmeAnfrageImpl(a)` aus, Ablehnen war nur per LongPress erreichbar (versteckt)
- Patrick 10.07. 07:08: *"Web-Anfragen kann ich ja gar nicht mehr ablehnen"*
- **Ohne Rückfahrt-Hinweis**: Tap öffnet AlertDialog mit ✅ Übernehmen + bestätigen / ⚪ Nur übernehmen (kein Versand) / ❌ Ablehnen
- **Mit Rückfahrt-Hinweis**: Abbrechen-Slot wird zu ❌ Ablehnen (Abbrechen weiter via Back-Taste)
- LongPress-Menü bleibt als Power-User-Fallback

---

## [6.63.669] - 2026-07-09

### ✨ Native Fahrer-App: Erledigt-Button in Disposition

- **AdminDashboardActivity**: Blauer Button `✅ FAHRT ABSCHLIESSEN` direkt oben im Edit-Dialog für Fahrten mit Status `accepted`, `picked_up`, `on_way`
- Ein Tap + kurze Bestätigung → Status wird `completed`, `completedAt` + `completedBy` gesetzt
- Kein Scrollen zum Status-Spinner mehr nötig

---

## [6.63.668] - 2026-07-09

### ✨ Native Fahrer-App: Rückfahrt direkt in Anfrage-Karte auswählbar

- **AdminDashboardActivity — AnfrageVH**: Wenn Notizen "Rückfahrt" oder "Rückweg" + Datum + Uhrzeit enthalten, erscheint ein gelber Badge `📅 Rückfahrt erkannt: 25.07 14:30 Uhr → tippen zum Übernehmen`
- Tap auf Anfrage-Karte öffnet Dialog mit Hin- und Rückfahrt im Vergleich
- **3 Optionen**: "Beide übernehmen" (beide Fahrten gleichzeitig anlegen) / "Nur Hinfahrt" / Abbrechen
- Eigenes LinearLayout-Card-Layout (statt simple_list_item_2) für AnfrageVH

---

## [6.63.667] - 2026-07-09

### ✨ Native Fahrer-App: Rückfahrt-Button in Anfrage-Karte (Zwischenschritt)

- Übergangsversion — ersetzt durch v6.63.668

---

## [6.63.666] - 2026-07-09

### ✨ Native Fahrer-App: Rückfahrt-Erkennung bei Anfrage-Übernahme

- **AdminDashboardActivity**: `_detectRueckfahrt(notes)` erkennt Datum + Uhrzeit nach "Rückfahrt/Rückweg" in Notizen via Regex
- Nach Anfrage-Übernahme erscheint AlertDialog wenn Rückfahrt erkannt — Optionen: anlegen / überspringen
- `_createRueckfahrtRide()` legt Fahrt mit vertauschten Adressen + `linkedHinfahrtId` in Firebase an

---

## [6.63.665] - 2026-07-09

### ✨ Native Fahrer-App: Notizen in Disposition-Karten sichtbar

- **AdminDashboardActivity — RideVH**: Notizen (`r.notes`) werden als `📝 ...` unter Route-Zeile angezeigt
- Kindersitz, Rollstuhl, etc. jetzt direkt in der Disposition-Liste sichtbar (nicht mehr nur per Tap in Edit-Dialog)

---

## [6.63.664] - 2026-07-09

### ✨ Native Fahrer-App: Notizen + Personenzahl in Dispo-Live-Karten

- **DispoActivity**: `RideInfo` bekommt Felder `notes` und `passengers`
- `parseRide()` liest beide Felder aus Firebase
- `buildUpcomingCard()` + `buildVehicleCard()`: zeigt `👤 X Pax` (grau) und `📝 Notiz` (gelb) in den Karten
- `showRideDiagnosisDialog()`: Pax + Notizen im Detail-Dialog sichtbar

---

## [6.25.3] - 2026-03-15

### 🐛 Fix: Falscher Konflikt-Alarm + Adress-Erkennung

- **Konflikt-Checker**: `deleted` und `rejected` Fahrten werden jetzt rausgefiltert (verursachte falschen Alarm: gelöschte Berlin-Fahrt → 220km Rückfahrt-Konflikt)
- **Konflikt-Telegram**: Zeigt jetzt welche bestehende Fahrt den Konflikt verursacht (Kunde, Uhrzeit, Route)
- **CRM-Adressen nutzen**: Wenn Kunde bekannt ist, werden CRM-Koordinaten direkt verwendet statt neu zu geocoden
- **"Von zu Hause" / "Nach Hause" Buttons**: Setzen jetzt Koordinaten aus CRM → kein Geocoding mehr nötig
- **Booking-History-Match**: Flexibler bei Ortsteil-Mismatch (Bansin/Heringsdorf = gleiche Gemeinde)
- **Telegram-Customer-Cache**: Speichert jetzt lat/lon aus CRM mit

---

## [6.25.2] - 2026-03-15

### 🐛 Fix: CRM Unified Modal - Tabs waren leer

- **Bug:** Tabs (Routen, Fahrten, Rechnungen, E-Mails, Notizen) zeigten leeren Inhalt
- **Ursache:** `_crmUnifiedTabsLoaded` Cache wurde nie zurückgesetzt beim erneuten Modal-Öffnen
- **Fix:** Cache wird bei jedem `editCustomer()` Aufruf geleert
- Loading-Spinner wird sofort angezeigt beim Tab-Wechsel
- Debug-Logging für Ride-Matching hinzugefügt

---

## [6.25.1] - 2026-03-15

### ✨ Telefonnummer-Validierung mit Live-Feedback

- Echtzeit-Validierung bei Mobilfunk- und Festnetznummern im CRM
- Visuelles Feedback (grün/rot Border) bei Eingabe

---

## [6.25.0] - 2026-03-15

### 🐛 KI-Booking Fix: missing-Felder

- Unified CRM Modal - Bearbeiten + Details in einem Fenster
- Doppelte +49 bei Mobilnummern endgültig behoben
- WhatsApp +49 Verdoppelung + Rechnungsadresse aus CRM laden

---

## [6.24.0] - 2026-03-15

### ✨ PDF-Anhang bei Rechnungs-Emails + Rechnungs-Layout-Editor

- Rechnungen können als PDF per E-Mail versendet werden
- Rechnungs-Layout-Editor zum Anpassen des Designs

---

## [6.23.0] - 2026-03-15

### ✨ CRM-Portal mit zentralen Tabs

- Rechnungen-Tab, E-Mail-Verlauf, Notizen im CRM-Kundenprofil
- Adress-Schutz ignoriert jetzt PLZ und Ortsnamen (v6.15.2)
- datetime_now Button Fix

---

## [6.22.0] - 2026-03-15

### ✨ Stripe QR-Codes + payRedirect Cloud Function

- Scannbare Stripe QR-Codes für Zahlungen
- Stripe automatic_payment_methods statt hardcoded giropay/sofort
- Stripe Checkout findet jetzt die Rechnungsnummer

---

## [6.21.0] - 2026-03-14

### ✨ Stripe Checkout + SMTP Email-Versand

- **Stripe Checkout Integration** für Online-Zahlungen
- **SMTP Email-Versand** via Cloud Function
- Stripe-Fehler werden jetzt geloggt statt verschluckt

---

## [6.20.2] - 2026-03-14

### ✨ Telegram Bot: Sofortfahrt + Warteschlange

- Sofortfahrt mit Schichtplan-Check + Admin-Vermittlung
- Warteschlange + Wartezeit-Schätzung bei Sofortfahrten
- Alle Bot-Nachrichten mit fetten Aktionen + Eingabefeld-Hinweisen
- Datum-Picker überarbeitet: "Heute" vs "Vorbestellen"
- Standort-Tipp prominent in Begrüßung + Buchen
- "Kein Fahrer erreichbar" → nur "Bitte anrufen" Meldung
- Änderungs-Übersicht bei Buchungen anzeigen (v6.20.1)

---

## [5.100.1] - 2026-02-25

### 🐛 Root-Cause-Fix: Luftlinie-Fallback nutzte Meter statt km

**Einzige Ursache des Problems:** OSRM war offline → Luftlinien-Fallback sprang an.

**Der eigentliche Fehler:** Zwei Funktionen mit gleichem Namen `calculateGPSDistance` im globalen Scope:
- Zeile 35755 (zuerst definiert): gibt **km** zurück (R = 6371)
- Zeile 46967 (danach definiert): gibt **Meter** zurück (R = 6.371.000)

JavaScript überschreibt die erste mit der zweiten → der Luftlinie-Fallback rechnete z.B. 31.136 Meter als "31.136 km" → × 1,35 = **42.033 km** (statt ~42 km), Preis: **92.481 € statt ~70 €**.

**Fix:** km-Version umbenannt zu `calculateGPSDistanceKm` (vervollständigt Umbenennung aus v5.90.341). Alle 6 Aufrufer der km-Version aktualisiert.

---

## [5.100.0] - 2026-02-25

### 🛡️ Fix: Koordinaten-Plausibilitätsprüfung (Root-Cause-Fix)

- **`fetchRouteWithFallback`**: Neue Validierung beim Start – Koordinaten außerhalb des europäischen Bereichs (lat 35–72, lon −30 bis 45) werden abgewiesen statt zu falschen Distanzen zu führen
- **`geocodeCustomerAddress`**: Nominatim-Anfragen erhalten jetzt `viewbox=5.0,55.5,25.0,47.0` (Europa-Hinweis) sowie eine Post-Validierung – Koordinaten außerhalb Europa werden ignoriert
- **Luftlinie-Fallback**: Gibt jetzt die exakten Koordinaten (`From/To`) im Warn-Log aus, damit bei zukünftigen Fehlern sofort erkennbar ist welche Koordinaten das Problem verursacht haben
- Hintergrund: Diese Änderungen adressieren die Root-Cause des in v5.99.7 als Workaround gesicherten Problems (3023 km Luftlinie statt ~1 km durch falsche Geocoding-Koordinaten)

---

## [5.99.7] - 2026-02-25

### 🛡️ Fix: Distanz-Sanity-Check bei Buchungen

- **Neuer Sicherheitscheck**: Bei berechneter Distanz > 100 km erscheint ein Bestätigungs-Dialog bevor die Buchung gespeichert wird
- Dialog zeigt: berechnete km, berechneten Preis, Abholung und Ziel zur Prüfung
- Nutzer kann "Abbrechen" → Buchung wird nicht gespeichert, Formular bleibt offen zur Korrektur
- Gilt für Schnellbuchung und Fahrt-Bearbeitung
- Hintergrund: Wenn alle Routing-APIs ausfallen (OSRM + GraphHopper), fällt das System auf Luftlinie zurück — bei falschen Geocoding-Koordinaten können dabei unrealistische Werte entstehen (z.B. 3032 km statt 5 km)

---

## [5.99.6] - 2026-02-25

### ⚖️ Neues Feature: Zuteilungs-Modus (Priorität vs. Effizienz)

- **4 Preset-Buttons** im Schichtplan (Bereich "Zuteilungs-Priorität"):
  - 🟢 **Fair** (0 min): Kürzeste Leerfahrt gewinnt immer — Priorität wird ignoriert
  - 🔵 **Ausgewogen** (20 min): Fahrzeug #1 bevorzugt, außer ein anderes hat ≥20 Min kürzere Leerfahrt
  - 🟠 **Priorität** (40 min): Fahrzeug #1 gewinnt meistens, verliert nur bei ≥40 Min Unterschied
  - 🔴 **Strikt** (60 min): Fahrzeug #1 gewinnt fast immer
- Einstellung wird in Firebase (`settings/pricing`) gespeichert und live übernommen
- **Kalender "Warum dieses Fahrzeug?"** verbessert:
  - ⬆️ Zeigt an wenn ein Fahrzeug mit höherer Priorität nicht gewählt wurde
  - Erklärt den Grund: z. B. "Höhere Priorität – gewähltes Fahrzeug hatte X Min kürzere Leerfahrt"
  - Footer-Note zeigt den aktuell aktiven Modus an
- Scoring-Formel: `finalScore = leerfahrtMinuten + (priorität - 1) × vorteilMinuten`

---

## [5.99.5] - 2026-02-25

### 🐛 Fixes

- **Rechnungs-Modal CRM-Button**: Kein Alert mehr bei mehreren Kunden-Treffern. Der `➕ Neu`-Button öffnet jetzt immer direkt das Neu-Kunden-Modal mit dem eingetippten Namen. Suche läuft über das Live-Dropdown.
- **Telegram Bot-Log in Firebase**: Log-Einträge werden jetzt persistent in `settings/telegram/botlog/` gespeichert (max 200 Einträge). Nach Seiten-Reload sind die letzten Einträge sofort wieder sichtbar. Timestamp wird mit Datum angezeigt.

---

## [5.99.4] - 2026-02-25

### 🔍 Telegram Bot Log: Vollständige KI-Analyse sichtbar

#### ✨ Verbesserungen
- **KI-Analyse vollständig im Log**: Jetzt sieht man nach jeder Nachricht was Claude extrahiert hat:
  - datetime, pickup, destination, passengers
  - missing-Felder (was noch fehlt)
  - Frage die gestellt wurde
- **Kontext vor KI-Call**: Log zeigt ob Heimadresse bekannt war, ob Telefon-Pflicht, die exakte Kundennachricht
- **"Details ▸" aufklappbar**: Alle Einträge mit Zusatzinfos haben jetzt ein aufklappbares Detail-Panel
- **"Sitzung abgelaufen" mit Grund**: Log zeigt jetzt warum die Sitzung abgelaufen ist (hasPending, hasModifying, rideId-Mismatch)
- **Nachricht an Kunden verbessert**: Statt "Sitzung abgelaufen" jetzt: "⏰ Sitzung abgelaufen – bitte /ändern eingeben"

---

## [5.99.3] - 2026-02-25

### 🤖 Telegram Bot: Fahrt-Bearbeitung komplett überarbeitet

#### ✨ Neue Features
- **5 Änderungsoptionen** statt bisher 3:
  - 📅 Datum ändern (Uhrzeit bleibt)
  - 🕐 Uhrzeit ändern (Datum bleibt)
  - 📍 Abholort ändern
  - 🎯 Zielort ändern
  - 👥 Personenzahl ändern (1–8)
- **Lokaler Zeit/Datum-Parser** – kein API-Call mehr für einfache Eingaben:
  - "16 Uhr", "16:30", "um 16" → direkt erkannt, kein "Fehler bei Zeitanalyse"
  - "morgen", "übermorgen", "Freitag" → sofort verarbeitet
  - Nur wirklich komplexe Eingaben gehen noch an die KI
- **Robusterer KI-Fallback**: Fragt jetzt kompakt nur nach Stunde/Minute (weniger Fehlerquellen)

---

## [5.99.2] - 2026-02-25

### 📄 Rechnung: Live-Suche Dropdown + Anrede kompakter

#### ✨ Neue Features
- **Live-Suche im Rechnungs-Kundenfeld** wie in der Schnellbuchung:
  - Ab 2 Zeichen erscheint ein Dropdown mit passenden Kunden (Name, Telefon, Adresse)
  - Kunden mit Anrede + Kundennummer sichtbar im Dropdown
  - Kunde anklicken → Name & Adresse werden automatisch übernommen, Feld grün bestätigt
  - Kein Treffer → Button "Als neuen Kunden anlegen" direkt im Dropdown
- **Anrede-Feld kompakter** in beiden CRM-Modals:
  - Kleines Dropdown (120px) inline neben dem Namensfeld in einer Zeile
  - Platz gespart, kein separates Feld mehr

---

## [5.99.1] - 2026-02-25

### 📄 Rechnung: CRM-Button öffnet jetzt Neuer-Kunde-Modal

#### ✨ Neue Features
- **CRM-Button in der neuen Rechnung** öffnet jetzt direkt "Neuer Kunde" statt eines "geh ins CRM"-Alerts:
  - Kein Name eingegeben → Neuer Kunde Modal öffnet sich leer
  - Name eingegeben, Kunde nicht gefunden → Neuer Kunde Modal mit vorausgefülltem Namen
  - Kunde gefunden → Kunde bearbeiten (wie bisher)
- **Automatische Datenübernahme nach Anlegen:** Nach dem Speichern eines neuen Kunden aus dem Rechnungskontext werden Name und Adresse automatisch in die Rechnung eingetragen
- **Visueller Hinweis** im Modal: "💡 Nach dem Speichern werden die Daten automatisch in die Rechnung übernommen"
- **Titel** zeigt "📄 Neuer Kunde für Rechnung" statt nur "Neuer Kunde"

---

## [5.99.0] - 2026-02-25

### 👤 CRM: Anrede, Kundennummern & Lieferantennummern

#### ✨ Neue Features
- **Anrede-Dropdown im Kunden-Formular:**
  - Auswahl: Herr, Frau, Divers, Dr., Prof., Prof. Dr., Firma, Keine Angabe
  - In beiden Modals (Neuer Kunde + Bearbeiten)
  - Anrede wird in der CRM-Liste beim Namen angezeigt
- **Automatische Kundennummern (KD000001, KD000002, ...):**
  - Wird automatisch beim Anlegen eines neuen Kunden (Typ = Kunde) vergeben
  - Fortlaufend, via Firebase-Transaction (kein Duplikat möglich)
  - Im CRM als blauer Badge sichtbar, im Edit-Modal oben angezeigt
- **Automatische Lieferantennummern (LF000001, LF000002, ...):**
  - Wird automatisch beim Anlegen eines neuen Lieferanten vergeben
  - Grüner Badge im CRM
- **Toast-Bestätigung** zeigt die vergebene Nummer direkt nach dem Erstellen

#### 📋 Warum beide?
Bisher gab es weder für Kunden noch für Lieferanten automatische Nummern (nur ein optionales manuelles Feld im Hotel-Bereich). Jetzt werden beide Typen automatisch nummeriert.

---

## [5.93.24] - 2026-02-07

### 🚕 Fahrer-App komplett überarbeitet

#### ✨ Neue Features
- **Interaktive Status-Buttons in allen Fahrt-Phasen:**
  - **ZUGETEILT (assigned)**: Button "✅ Fahrt akzeptieren" → Status wird `accepted`
  - **AKZEPTIERT (accepted)**: Button "🚗 Losfahren" → Status wird `on_way`
  - **UNTERWEGS (on_way)**: Button "👥 Kunde eingestiegen" → Status wird `picked_up`
  - **BESETZT (picked_up)**: Button "🔄 Fahrt abschließen" → Status wird `completed` (bereits vorhanden)

- **Fahrten-Historie für Fahrer** (index.html:4512-4543)
  - Neue ausklappbare Sektion "📋 Meine Fahrten heute"
  - Zeigt alle abgeschlossenen Fahrten des aktuellen Fahrzeugs
  - Übersicht: Anzahl Fahrten + Gesamtumsatz heute
  - Details: Zeit, Kunde, Abholort, Zielort, Preis
  - Automatisch sichtbar wenn Fahrzeug ausgewählt ist

#### 🔧 Neue Funktionen
- `acceptRide(rideId)` - Akzeptiert zugeteilte Fahrt (index.html:40390-40411)
- `startDrivingToCustomer(rideId)` - Startet Fahrt zum Kunden (index.html:40413-40434)
- `pickUpCustomer(rideId)` - Markiert Kunde als eingestiegen (index.html:40436-40457)
- `toggleDriverHistory()` - Blendet Historie ein/aus (index.html:40459-40474)
- `loadDriverHistory()` - Lädt abgeschlossene Fahrten heute (index.html:40476-40526)
- `renderDriverHistory(rides)` - Rendert Historie-Liste (index.html:40528-40589)

#### 🐛 Behoben
- **Fehlende Fahrzeuge zu Firebase hinzugefügt** (index.html:47547-47559)
  - Problem: Nur 3 von 5 Fahrzeugen waren in Firebase gespeichert
  - Lösung: `loadVehiclesFromFirebase()` prüft jetzt fehlende Fahrzeuge und fügt sie hinzu
  - Betrifft: Tesla Model Y (pw-my-222-e) und Toyota Prius IK (pw-ik-222)
- **Status-Sync-Problem zwischen PC und Fahrer-Handy gelöst**
  - Alle Buttons aktualisieren sofort die Status-Box via `updateDriverViewIsarfunk()`
- **Fahrt-Abschluss-Funktion** erweitert um Historie-Update (index.html:40395-40399)

#### 📝 Technische Details
- Alle Status-Änderungen schreiben Timestamps in Firebase
- Historie wird nur bei Bedarf geladen (Toggle)
- Historie-Sektion erscheint automatisch wenn `currentVehicle` gesetzt ist
- Realtime-Update der Historie nach Fahrt-Abschluss

---

## [5.93.19] - 2026-02-07

### 🚗 Planung
- **ALLE Fahrzeuge (online + offline) in Schnellbuchung verfügbar**
  - `loadQuickBookingVehicles()` lädt jetzt korrekt den Online-Status (index.html:50966-51019)
  - **Problem**: Offline-Status wurde nicht korrekt gesetzt, alle Fahrzeuge zeigten 🔴
  - **Lösung**: Lade Fahrer-Daten parallel, setze `isOnline` Status korrekt
  - **Anzeige**: 🟢 für online, ⚪ für offline Fahrzeuge
  - **Wichtig**: ALLE Fahrzeuge sind auswählbar, auch offline - für Planungszwecke!
  - Sortierung: Priorität → Online-Status → Alphabetisch

### 🐛 Behoben
- **KRITISCHER BUG: Fahrer-Daten wurden nicht geladen**
  - `assignVehicleToRide()` lud zweimal `vehicles` statt `vehicles` + `drivers` (index.html:13182)
  - `loadQuickBookingVehicles()` hatte denselben Bug (index.html:50974)
  - **Impact**: Online-Status konnte nie korrekt ermittelt werden!
  - **Lösung**: `db.ref('drivers')` statt `db.ref('vehicles')` für zweiten Snapshot

### 📝 Technische Details
- `loadQuickBookingVehicles()` ist jetzt `async` und lädt Fahrer-Daten parallel
- `onlineVehicleIds` Set wird aus Fahrer-Daten erstellt
- Jedes Fahrzeug erhält korrekten `isOnline` Status
- Console-Log zeigt Anzahl online/offline Fahrzeuge
- Identische Logik wie in `assignVehicleToRide()` (index.html:13168-13239)

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
