# OneDrive-Voice → Auto-Buchung — Plan

**Status:** TODO (29.04.2026 angedacht, Detail-Infos noch offen)

---

## Idee
Patricks Anrufbeantworter / Telefonaufnahmen werden automatisch in OneDrive Business synchronisiert. Eine Cloud-Function holt sie ab, transkribiert via Anthropic Audio API, extrahiert die Buchungs-Daten und legt eine Vorbestellung an — alles ohne dass Patrick die Anrufe selber durchhören muss.

---

## Quelle
- **OneDrive Business**, Account: `taxiwydra@outlook.de` (auf Patricks Tesla-Handy als Cloud-Dienst Nr. 3 konfiguriert).
- **Sync-Aktivität:** automatisch, in der App sichtbar als „Vor X Min/Std" aktualisiert.

### Noch offen (Patrick muss liefern):
- 📁 **OneDrive-Ordner** in dem die Voice-Files landen (z. B. `Recordings/`, `Anrufe/`, `Sprachnotizen/`).
- 📎 **Beispiel-Dateiname** — typischerweise enthält der die Caller-ID (z. B. `+491797835106_2026-04-29_19-58.mp3`). Pattern wird daraus abgeleitet.

---

## Workflow-Skizze

```
┌────────────────────┐
│ Anrufbeantworter   │ Voice-Datei wird gespeichert
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ OneDrive Business  │ Auto-Sync (taxiwydra@outlook.de)
└────────┬───────────┘
         │ Webhook / Polling (Microsoft Graph API)
         ▼
┌────────────────────┐
│ Cloud Function     │ /functions/index.js → onOneDriveVoice
│ (europe-west1)     │ 1) Datei-Name parsen → Caller-ID
│                    │ 2) Audio-Datei via Graph API holen
│                    │ 3) Anthropic Audio API: Transkript +
│                    │    Buchungs-Extraktion (Name, Adressen,
│                    │    Datum/Zeit, Personen, Hotel etc.)
│                    │ 4) CRM-Match mit Caller-ID
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ Bridge-Push        │ "📞 Anruf von 0179... — Frau Müller,
│ an Patrick         │  Sa 16:45 Bansin → Seebrücke Heringsdorf
│                    │  — anlegen?"
└────────┬───────────┘
         │ Patrick: Inline-Button OK / Korrektur / Verwerfen
         ▼
┌────────────────────┐
│ /rides + smsQueue  │ Buchung angelegt + Bestätigungs-SMS raus
└────────────────────┘
```

---

## Komponenten

### 1) Microsoft Graph API
- App-Registrierung in Microsoft Entra ID nötig (https://portal.azure.com).
- App-Permissions: `Files.Read.All` (delegated für Patrick als User) ODER `Files.Read.All` (application).
- Refresh-Token in `settings/oneDrive/refreshToken` speichern (Cloud-Function holt sich Access-Token bei Bedarf).
- **Webhook (Subscription)**: Microsoft Graph kann auf Datei-Änderungen pushen. Muss alle 3 Tage erneuert werden.
- **Alternative Polling**: alle 60 s checkt Cloud-Function `delta`-Endpoint des Ordners.

### 2) Datei-Name-Parser
Pattern wird abgeleitet aus echten Beispielen. Wahrscheinlich:
- `+49xxx_YYYY-MM-DD_HH-MM.mp3`  (mit Caller-ID)
- `Unknown_YYYY-MM-DD_HH-MM.mp3` (anonymer Anruf)
- `Voice_YYYYMMDD-HHMMSS.m4a`    (Sprachmemo, kein Anrufer)

Code:
```js
function extractCallerId(filename) {
    const m = filename.match(/^\+?(\d{6,})/);
    if (m) return '+' + m[1].replace(/^00/, '');
    return null; // → später aus dem Audio extrahieren
}
```

### 3) Anthropic Audio API
- Claude unterstützt Audio-Input ähnlich wie Vision. `message.content` mit `type: "input_audio"` (Format: `mp3`/`wav`/`m4a` als base64 oder URL).
- Prompt wie bei `importAuftragPdf` — strikt JSON zurück:
  ```
  {
    "transcript": "...",
    "callerName": "Carola Siebert",
    "isTaxiBooking": true,
    "isFerienwohnungInquiry": false,
    "pickup": "Strandpromenade 17, Bansin",
    "destination": "Seebrücke Heringsdorf",
    "datetime": "2026-05-02T16:45:00+02:00",
    "passengers": 1,
    "callerPhoneInAudio": "+491797835106",   // falls explizit genannt
    "intent": "neue Buchung" | "Stornierung" | "Frage" | "Sonstiges",
    "confidence": 0.85
  }
  ```

### 4) Bridge-Bestätigung an Patrick
- Falls `confidence > 0.7` und `isTaxiBooking === true`:
  → Push: „📞 Anruf von 0179...: **Carola Siebert** will am Sa 16:45 von **Strandpromenade 17 Bansin** zur **Seebrücke Heringsdorf**, 1 Person. Anlegen?"
  → Inline-Buttons: ✅ Anlegen / ✏️ Korrigieren / 🗑 Verwerfen
- Falls `confidence < 0.7` oder Daten fehlen:
  → Push mit Voice-Transkript + Bitte um manuelle Klärung.

### 5) Auto-Anlage
Bei „Anlegen" identisches Pattern wie aktuelle Bridge-Buchung (siehe Petrizien/Carola Siebert von heute):
- Geocoding via Nominatim
- `/rides/{id}` mit `status: vorbestellt` + `bookingMode: vorbestellt`
- Cloud-Function-Trigger sendet Bestätigungs-SMS an Caller-ID

---

## Kosten
- **Microsoft Graph API**: kostenlos für reasonable Polling/Webhook-Volume.
- **Anthropic Audio**: ~0,01 €/Min Audio (claude-sonnet-4-6).
- Bei 50 Anrufen/Tag × Ø 1 Min = ~0,50 €/Tag = **~15 €/Monat**.
- Keine Wiederkehr-Kosten außer der Anthropic-API-Nutzung.

---

## Sicherheit / Datenschutz
- DSGVO: Voice-Aufnahmen enthalten personenbezogene Daten. Patrick muss seine Anrufer informieren („Dieser Anruf wird aufgezeichnet…") — gilt aber bereits jetzt für seinen Anrufbeantworter.
- Anthropic-API erhält den Audio-Inhalt. Wird laut Anthropic-AGB nicht für Training genutzt (Standard B2B-API).
- Refresh-Token / Caller-IDs nur in Firebase (keine Logs).

---

## Reihenfolge (wenn wir's bauen)
1. Patrick gibt Ordner-Pfad + Beispiel-Dateiname.
2. Azure-App-Registrierung + Refresh-Token holen (einmalige Aktion, Patrick + Claude zusammen).
3. Cloud-Function `onOneDriveVoice` mit Polling-Mode (Webhooks später).
4. Datei-Name-Parser + Anthropic-Audio-Call testen mit 3-5 Beispiel-Files.
5. Bridge-Bestätigungs-Flow mit Inline-Buttons.
6. Auto-Anlage + SMS-Confirm-Pfad.
7. Polling auf Webhook umstellen für Echtzeit (1-2 Min Verzögerung statt 60 s).

---

## Verbindung zu anderen TODOs
- **Buchhaltungs-Modul** (siehe `BUCHHALTUNG-PLAN.md`): die ICS-Caller-IDs könnten parallel auch als Marketing-Customer-Records erfasst werden.
- **Telegram-Bot-Tuning**: derselbe Buchungs-Flow (Voice → KI → Vorschlag → Bestätigung) ist heute im Telegram-Bot drin, aber haspelig (siehe Patricks Frust 29.04.2026 mit dem `awaitingAdminCrmConfirm`-State). Lessons Learned aus dem OneDrive-Workflow können den Telegram-Pfad verbessern.
