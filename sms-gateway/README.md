# SMS Gateway — Eigene SIM-Karte

SMS automatisch senden über dein eigenes Android-Handy.
Keine externen Dienste, keine Kosten (nur dein SMS-Tarif).

## Option A: Android App "SMS Gateway" (EMPFOHLEN — am einfachsten)

### 1. App installieren
- Play Store öffnen
- Suche nach: **"SMS Gateway API"** von Capcom
- Oder: https://play.google.com/store/apps/details?id=com.capcom.smsgateway
- Installieren + SMS-Berechtigung erteilen

### 2. App einrichten
- App öffnen → "Server starten"
- Die App zeigt eine lokale IP + Port (z.B. `http://192.168.1.50:8080`)
- **Aber:** Wir nutzen den Firebase-Modus (kein lokaler Server nötig!)

### 3. Firebase-Modus (funktioniert über Internet)
- In der App: Settings → Cloud/Firebase Mode → aktivieren
- Firebase URL eingeben: `https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app`
- Pfad: `/smsQueue`
- Die App hört automatisch auf neue Einträge und sendet SMS!

---

## Option B: Macrodroid (flexibler)

### 1. App installieren
- Play Store: **"MacroDroid"** (kostenlos bis 5 Makros)

### 2. Makro erstellen
- **Trigger:** Firebase Database → Neuer Eintrag unter `/smsQueue`
  - ODER: HTTP Server → POST Request empfangen
- **Aktion:** SMS senden → Nummer aus {variable}, Text aus {variable}
- **Constraint:** Keiner (immer aktiv)

---

## Option C: Termux + Node.js (für Profis)

### 1. Termux installieren
```bash
# Von F-Droid (NICHT Play Store - die Version ist veraltet!)
# https://f-droid.org/packages/com.termux/
```

### 2. Setup
```bash
pkg update && pkg install nodejs
npm install firebase-admin
```

### 3. Script starten
```bash
node sms-worker.js
```

Das Script `sms-worker.js` (liegt in diesem Ordner) liest die
Firebase SMS-Queue und sendet über die Android SMS API.

---

## Umschalten in Firebase

In Firebase Console → Realtime Database:

```
settings/sms/gateway = "queue"    → eigenes Handy (Standard)
settings/sms/gateway = "proxy"    → seven.io (Fallback)
```

## Testen

1. Gateway starten (App/Makro/Termux)
2. In Firebase Console → smsQueue → Neuer Eintrag:
   - to: "+491761234567" (deine Nummer)
   - text: "Test SMS"
   - status: "pending"
   - createdAt: (Timestamp)
3. SMS sollte automatisch von deinem Handy gesendet werden
