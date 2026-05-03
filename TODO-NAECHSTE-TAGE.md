# TODO Nächste Tage — ab 03.05.2026

Konsolidierte Liste der nächsten Schritte. Bei jedem Session-Start öffnen + abarbeiten.

---

## Sa 03.05.2026 Vormittag — ABGEHAKT (15 PRs)

✅ **Block A komplett** (Schichtplan + ECOVIS-Lohnexport):
- ✅ Phase 1: `mitarbeiter.html` — Mitarbeiter-Stammdaten (CRUD)
- ✅ Phase 2: `schichtplan.html` — Wochenraster Mo-So pro Mitarbeiter
- ✅ Phase 3 (v6.62.211): Auto-Erfassung Ist-Zeiten aus `/shiftHistory`, Soll-vs-Ist-Ampel
- ✅ Phase 4 (v6.62.213): Detail-Modal pro Tag (Plan vs Ist Diff, Pause, Fahrten, Umsatz)
- ✅ Phase 5 (v6.62.215): ECOVIS-XLSX-Export (inline strings, ZIP via JSZip CDN)

✅ **Schicht-Healthcheck** war schon in v6.62.203/204 fertig (OnboardingHealthcheckActivity).

✅ Weitere PRs heute:
- v6.62.206 Pauschalpreis-Display (anfrage.html toggleRabatt synchronisiert Preis-Anzeige + Notiz)
- v6.62.207 Bewertungen öffentlich (kein Google-Login mehr) + 5★ zuerst
- v6.62.208 CRM-Schnellbuchung Adress-Modus-Toolbar (🏠➡️📍 / 📍➡️🏠 / 📍➡️📍)
- v6.62.208b `/todo`-Bot-Befehl (`@Funktaxiclaudebot todo` → Liste aus `/claudeBridge/tasks`)
- v6.62.209 Profi-Update-Flow (Schicht beenden + Lock weg vor APK-Install)
- v6.62.210 Auto-Preis-Berechnung in `onRideCreated` (Native Vorbestellung 0€-Bug)
- v6.62.211b Apps-Script v5.4 — 🏷️ Pauschalpreis-Marker (manueller Deploy nötig!)
- v6.62.212 Google-Places Init Stub-Closure-Sync (Web-CRM)
- v6.62.213b Places-Sync auch in Standard-Buchung + Edit-Waypoint
- v6.62.214 Native-Places-Key auf Web-Key umgestellt (Native-Key war API_KEY_SERVICE_BLOCKED)
- v6.62.216 Losfahrt-Telegram an Admins (parallel zum FCM-Push, scheduledAutoAssign)

### Manuelle Aktionen offen:
- [ ] **Apps Script v5.4 deployen** — `kalender-sync-v5.4.js` ins Google-Apps-Script-Projekt kopieren (Pauschalpreis-Marker im Kalender)
- [ ] **Schicht S20 FE beenden** — wenn Patrick am Handy: Hamburger-Menü → Pause/Offline; ODER beim Update auf v6.62.214 wird sie automatisch sauber beendet (Profi-Update-Flow v6.62.209)

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
