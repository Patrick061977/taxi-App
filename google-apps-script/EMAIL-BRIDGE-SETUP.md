# 📧 Email-Bridge Setup (Gmail → Claude)

So leitest du E-Mails (z.B. von ECOVIS) an Claude weiter.

## Einmaliges Setup (~5 Min)

### 1. Gmail-Label anlegen
- Gmail öffnen → Einstellungen ⚙ → "Alle Einstellungen"
- Tab "Labels" → unten "**Neues Label erstellen**"
- Name: **`ClaudeBridge`** (genau so geschrieben, mit Großbuchstaben)
- Optional: zweites Label `ClaudeBridge-Done` (wird automatisch angelegt)

### 2. Apps Script anlegen
- https://script.google.com/ → "**Neues Projekt**"
- Projekt-Name oben: `Funk Taxi · Gmail-Bridge`
- Code-Datei `Code.gs` öffnen → kompletten Inhalt löschen
- Inhalt von `gmail-to-bridge-v1.0.js` kopieren und einfügen
- 💾 Speichern (Ctrl+S)

### 3. Erste Berechtigung
- Im Editor oben Funktion `_testRun` auswählen → ▶️ Ausführen
- Google fragt nach Berechtigungen → "Erweitert" → "Funk Taxi … aufrufen"
- Erlauben für: **Gmail** (Lesen + Labels ändern) + **Externe URLs** (Firebase)
- Nochmal ▶️ Ausführen — sollte ohne Fehler durchlaufen

### 4. Trigger einrichten (Auto-Run)
- In Apps Script links: ⏰ "**Trigger**" (Uhrsymbol)
- Unten rechts "**+ Trigger hinzufügen**"
- Funktion: `syncGmailToBridge`
- Ereignisquelle: `Zeitgesteuert`
- Zeitintervall: `Minutentrigger` → `Alle 5 Minuten`
- Speichern

## Bedienung

Wenn du eine Mail an Claude weiterleiten willst:

1. Mail in Gmail öffnen
2. Label-Symbol 🏷 → **`ClaudeBridge`** dranklicken
3. Innerhalb 5 Min landet die Mail in Firebase `/emailInbox/`
4. Bridge-Polling sieht sie → Claude bekommt Notification
5. Mail wird automatisch auf Label `ClaudeBridge-Done` umgestellt (= verarbeitet)

## Was Claude bekommt
- Absender, Betreff, kompletter Klartext-Body (bis 50.000 Zeichen)
- Anhänge bis 7 MB als base64 (PDF, JPG, etc.) — größere nur Metadaten
- Eine Bridge-Notification: `📧 [Datum] [Absender] (#email_…): [Betreff] — [Body-Vorschau]`

## Database Rules
Damit das Apps Script schreiben darf, muss `/emailInbox` in `database.rules.json` öffentlich-write sein. Ist mit v6.62.419 schon drin — aber **Rules müssen manuell deployt werden**:

```bash
firebase deploy --only database
```

(Patrick: einmalig im Repo-Verzeichnis ausführen)

## Sicherheit
- `/emailInbox` ist public-write — jeder mit Firebase-URL könnte schreiben
- Read nur authentifiziert
- Falls Spam-Risiko: Apps Script kann Auth-Token mitsenden (`?auth=…`) und Rules verschärfen — aktuell pragmatisch offen weil keine kritische Pfad
