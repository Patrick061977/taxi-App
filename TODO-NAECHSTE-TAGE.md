# TODO Nächste Tage — ab 03.05.2026

Konsolidierte Liste der nächsten Schritte. Bei jedem Session-Start öffnen + abarbeiten.

---

## Sa 03.05.2026 — Schichtplan + Healthcheck

### Vormittag — Schichtplan + ECOVIS-Lohnexport
**Voraussetzung:** Patrick schickt früh Foto/PDF des aktuellen Stundenzettels (ECOVIS-Format).

- [ ] **Phase 1:** Mitarbeiter-Stammdaten erweitern (~1 h)
  - Pro Fahrer: Stundenlohn EUR/h, Bankverbindung, SV-Nr, Steuer-ID, Wochenarbeitszeit Soll
  - Speicherort: `/users/{uid}/payroll` oder `/drivers/{id}/payroll`
- [ ] **Phase 2:** Wochenplan-UI (~2 h)
  - Mo–So Raster pro Mitarbeiter, Drag & Drop oder Tabelle
  - Schichten: 06–14 / 14–22 / Nacht / individuell
  - Wiederholungs-Pattern für Standardwochen
  - Speicherort: `/drivers/{id}/shiftPlan`
- [ ] **Phase 3:** Auto-Erfassung Ist-Zeiten (~1,5 h)
  - Cloud Function bei Driver-Login/Logout → `/driverShifts/{driverId}/{date}`
  - Felder: `startedAt`, `endedAt`, `vehicleId`, `totalMinutes`
- [ ] **Phase 4:** Wochen-/Monatsansicht (~1 h)
  - Pro Fahrer Soll vs Ist Stunden, Differenzen rot/grün
  - Summe Stunden + Brutto-Lohn
- [ ] **Phase 5:** ECOVIS-Export (~2 h)
  - Excel/CSV im Format des Stundenzettels
  - PDF-Lohnaufstellung pro Fahrer
  - Email-Versand-Knopf an ECOVIS

**Klärung morgen früh:** Patrick sagte „Jahresschic..." (abgeschnitten) — Jahresplan? Jahres-Statistik? Jahres-Urlaubsübersicht? Nachfragen.

### Nachmittag — Schicht-Healthcheck nach Driver-Login

9 Checks bei jedem Schicht-Login:
1. Standort-Berechtigung „Immer erlauben" (Danilos IK-Bug)
2. GPS am Gerät aktiv
3. Letzter GPS-Update <60 s alt
4. Foreground-Service läuft
5. Akku-Optimierung deaktiviert
6. Notification-Permission
7. FCM-Token vorhanden
8. Internet-Verbindung
9. Mikrofon (Voice-Buchungen)

Pro Punkt: ✅ / ⚠️ / ❌. Bei ❌ → „Jetzt fixen"-Button mit Settings-Intent.
Plus: Telegram-Alert an Patrick wenn Fahrer-Healthcheck failed.

### Falls Zeit — FCM-Push für Web-Anfragen (Stufe 2/3)

- [ ] Cloud Function `onRideCreated`: bei `source === 'web-booking'` FCM-Push an alle Admin-FCM-Tokens
- [ ] Admin-Tokens beim AppStart in `/adminFcmTokens/{uid}` speichern
- [ ] Native-Notification mit Tap → öffnet AdminDashboard auf der Web-Anfrage
- [ ] „Annehmen" / „Ablehnen" Buttons in der Web-Anfrage-Card
- [ ] Bei „Ablehnen": SMS an Kunden mit Begründung

---

## Mo/Di 05.-06.05.2026 — DMS Dokumenten-Scanner

**Konzept:** Patrick scannt Foto/PDF → Anthropic Vision klassifiziert + extrahiert → Auto-Ablage in Firebase Storage mit Ordner-Struktur.

- [ ] Kategorien finalisieren (Patrick hat Wochenende Zeit zum Überlegen)
- [ ] Cloud Function `analyzeDocument` (analog zu `analyzeAuftragPdf`)
- [ ] Native-Button „📷 Dokument scannen" + Foto-Upload-Pipeline
- [ ] Auto-Ablage `/docs/{kategorie}/{jahr}/{monat}/{datum}_{lieferant}_{betrag}EUR.pdf`
- [ ] Index in Firebase DB `/docs/{docId}` durchsuchbar
- [ ] UI „Meine Dokumente" mit Filter + Volltext-Suche

**Vorab-Kategorien (zu bestätigen):**
- Rechnungen Eingang (Lieferanten, Werkstatt, Versicherung)
- Bankauszüge
- Mitarbeiter (Stundenzettel, Krankschreibungen, Verträge)
- Behörden (Finanzamt, Gewerbeamt, Konzession)
- Fahrzeuge (TÜV, KFZ-Brief, Service)
- Versicherungen (KFZ, Haftpflicht, BU)
- Steuerberater (ECOVIS-Korrespondenz)
- Sonstiges

**Aufwand:** ~5–6 h Basis. Erweiterung (PDF-Volltext-Index, OCR): +4–5 h.

Hängt eng mit `BUCHHALTUNG-PLAN.md` zusammen — gleiche Pipeline kann Belege für beides verarbeiten.

---

## Offene Sub-Tickets aus früheren Sessions

- [ ] **kalender-sync-v5.3.js** — noch nicht ins Google Apps Script kopiert (`project_todo-apps-script-v5.3.md`)
- [ ] **ACR Call-Recording Sync** — Pfad+Schema dokumentiert, Implementation steht aus (`project_acr-call-recording-sync.md`)
- [ ] **System-Chat-Idee** — Claude-Chat-Bot für Fahrer/Kunden mit Rollen-Filter (geparkt 2026-04-27)
- [ ] **Hotel-Email-Login** — Hotels per Email-Code-Login + eigener Kalender (`project_hotel-email-login.md`)

---

## Heute (02.05.2026) abgeschlossen

- ✅ v6.62.198 Fahrer-Onboarding-Fix (preRegisteredUsers-Match + CRM-Auswahl + Phone-Duplikat)
- ✅ v6.62.198b-r landing.html — Pauschalpreise, Berlin-Service-Card, Reviews-Widget, Layout kompakter, klickbare Cards, Anfrage-Hero zurück
- ✅ v6.62.199 Native CallLogActivity — echte Umlaute + Geocoding-Kaskade Places→OSM
- ✅ v6.62.199b anfrage.html — 1h Vorlauf-Validierung
- ✅ v6.62.199e/f/g Bot-Geocoding gefixt — Substring-Match strikt + Word-Boundary Town-Filter + Audio-KI-Sanity-Check + Logging
- ✅ v6.62.200 Native AdminDashboard — Web-Anfragen oben hervorgehoben
