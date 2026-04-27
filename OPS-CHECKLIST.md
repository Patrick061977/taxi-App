# Ops-Checkliste — Was Patrick regelmäßig kontrollieren sollte

Stand: 2026-04-27. Lebende Datei — anpassen wenn neue Sachen dazukommen oder alte überflüssig werden.

---

## ⚡ TÄGLICH (2 Min, morgens vor Schichtbeginn)

| Was | Wo | Grün ist… | Rot wenn… |
|---|---|---|---|
| **Telegram Bot lebt** | Test-Nachricht an Bot | Bot antwortet sofort | Keine Antwort → `functions/index.js` deployed? |
| **Offene Vorbestellungen** | Web-App Tab "Aufträge" | Keine `accepted`-Fahrten >1h vor Pickup | Stehengeblieben → Cloud-Auto-Assign-Logs |
| **Schicht-Fahrer online** | Web-App Live-Monitor | Erwartete Fahrer haben 🟢 Online | Tesla offline, Patrick fährt → Heartbeat-Bug |

---

## 📅 WÖCHENTLICH (15 Min, Montag früh)

### 1. GCP Kosten-Trend
🔗 https://console.cloud.google.com/billing/projects/taxi-heringsdorf
- **Berichte** → "Diesen Monat" → Balkendiagramm gruppiert nach Dienst
- **Grün**: Tageskosten <0,30 €, Trend stabil/sinkend
- **Rot**: Plötzlicher Spike, neuer Dienst auf Platz 1, oder Tageskosten >1 €

### 2. Firebase Usage
🔗 https://console.firebase.google.com/project/taxi-heringsdorf/usage
- **Realtime DB Bandwidth**: <100 MB/Tag normal, >500 MB/Tag = irgendwer streamt zu viel
- **Functions Invocations**: <10k/Tag normal, >50k = Hot-Loop irgendwo
- **Functions Errors**: 0 ist Ziel, einzelne OK, >100/Tag = Bug

### 3. GitHub Actions Health
🔗 https://github.com/Patrick061977/taxi-App/actions
- Letzte 5 Runs: alle ✅? Wenn build-apk oder deploy-functions ❌ → mein Job das zu fixen
- Action-Minuten verbraucht: https://github.com/settings/billing/summary (gratis 2000/Monat)

### 4. APK-Status
🔗 https://umwelt-taxi-insel-usedom.de/app/latest.json
- Sollte aktuelle Version zeigen + 200 OK
- Wenn 404 → Strato-Mirror-Upload kaputt → mir Bescheid sagen

### 5. Cloud Functions Errors (live anschauen)
🔗 https://console.cloud.google.com/functions/list?project=taxi-heringsdorf
- Auf jede Function klicken → "Logs"
- **Grün**: nur INFO + DEBUG
- **Rot**: ERROR-Lines, "validateRideConsistency"-Inkonsistenzen häufen sich, etc.

---

## 🗓 MONATLICH (30 Min, 1. des Monats)

### 1. Stripe-Auszahlungen
🔗 https://dashboard.stripe.com/payouts
- Sind alle Auszahlungen durch? Mismatches?
- Failed-Payments aufräumen

### 2. Firebase Auth — verwaiste Konten
🔗 https://console.firebase.google.com/project/taxi-heringsdorf/authentication/users
- Test-Accounts mit "test" oder leerer Email löschen
- Inaktive Konten >90 Tage → archivieren oder löschen

### 3. Backup-Stand
- Firebase Export (manuell): https://console.cloud.google.com/firestore/import-export?project=taxi-heringsdorf
- Sollte 1x/Monat manuell ausgelöst werden, oder über Skript automatisieren (TODO)

### 4. CRM-Hygiene
- In Web-App CRM-Tab: Duplikate suchen via "Merge"-Funktion
- Inaktive Kunden (>1 Jahr keine Fahrt) markieren

---

## 🚨 AD-HOC (wenn was schief geht)

| Symptom | Wo nachsehen | Was tun |
|---|---|---|
| Fahrer meldet "kein Push" | `vehicles/{id}/fcmToken` in Firebase + Cloud Function `sendFcmToVehicle` Logs | Token-Format prüfen (siehe v6.59.1 Fix) |
| Buchung "verschwunden" | Firebase Console → `/rides/{id}` → was ist `status`? `validateRideConsistency`-Logs | Manueller Status-Set + bei Cloud Function-Bug Patch deployen |
| Doppelte Telegram-Nachrichten | Browser-Tab offen + Webhook aktiv? `settings/telegram/webhookActive` muss `true` sein | Browser schließen oder Flag prüfen |
| Update-Banner kommt nicht | `latest.json` auf Strato erreichbar? `compareVersions` greift? | Logcat auf "UpdateChecker" filtern |
| Schicht "hängt" | `vehicles/{id}/shift.lastHeartbeat` älter als 5 Min? | App force-stop + neu öffnen → Recovery-Logik (v6.51.2) |

---

## 📊 LIVE-MONITORING (jederzeit)

- **Web-App "Live-Monitor"-Tab** — alle aktiven Fahrer + Live-Position auf Karte
- **Web-App "Diagnose"-Tab** — System-Health: Telegram, Webhook, FCM, Heartbeats
- **Logcat auf S9+/S20** (für native Bugs) — `adb logcat | grep -E "TAG=|UpdateChecker|FCM"`
- **Telegram-Bot-Log** in Web-App "Bot-Log"-Tab — letzte 50 Bot-Aktivitäten

---

## 🎯 Was wir NICHT regelmäßig prüfen müssen

- **Capacitor-Plugin-Versionen** — werden via npm install automatisch aktuell
- **Firebase-SDK-Versionen** — bleiben stabil, hochziehen nur wenn Feature gebraucht
- **Android Gradle Plugin** — funktioniert seit v6.50.0, anfassen nur bei Build-Fehlern
- **Telegram-Bot-Token** — ändert sich nie

---

## 📝 Letzte Reviews

- **2026-04-27**: Initial-Version erstellt nach Patrick-Wunsch nach Strukturierung
