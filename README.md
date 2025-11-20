# 🚕 Funk Taxi Heringsdorf - Version 3.6.0

## 🎉 NEUE FEATURES

### ✅ Was jetzt funktioniert:

1. **🔔 Push-Benachrichtigungen** 
   - App läuft im Hintergrund
   - Benachrichtigungen auch bei geschlossener App
   - Sound + Vibration bei neuen Buchungen

2. **🎯 Intelligente Auto-Zuweisung**
   - Nächstes Taxi wird automatisch zugewiesen (nach GPS-Entfernung)
   - 30-Sekunden-Timer pro Fahrer
   - Automatisch zum nächsten Taxi wenn nicht angenommen

3. **⭐ Stammkunden-Funktion**
   - Name & Adressen werden gespeichert
   - Schnellbuchung mit einem Klick
   - Anzahl Fahrten wird gezählt

4. **📍 Live-ETA für Fahrgäste**
   - Echtzeit-Anzeige: "Taxi kommt in 4 Min"
   - Live-Karte mit Taxi-Position
   - Farbcodierte Entfernungsanzeige

5. **📲 PWA (Progressive Web App)**
   - Als App installierbar
   - Funktioniert offline
   - Wie eine native App

---

## 📥 INSTALLATION

### 1. Dateien auf GitHub hochladen:

```
patrick061977.github.io/taxi-App/
├── index.html          ← Haupt-App
├── service-worker.js   ← Hintergrund-Prozess
└── manifest.json       ← PWA-Config
```

### 2. App auf dem Handy installieren:

#### **Android (Chrome/Edge):**
1. Öffne: `https://patrick061977.github.io/taxi-App/`
2. Tippe auf ⋮ (Menü)
3. Wähle "Zum Startbildschirm hinzufügen"
4. ✅ Fertig! App ist jetzt wie eine normale App installiert

#### **iPhone (Safari):**
1. Öffne: `https://patrick061977.github.io/taxi-App/`
2. Tippe auf 📤 (Teilen-Button unten)
3. Wähle "Zum Home-Bildschirm"
4. ⚠️ **Einschränkung:** Push-Benachrichtigungen funktionieren nur eingeschränkt auf iOS

---

## 🔔 BENACHRICHTIGUNGEN AKTIVIEREN

### Beim ersten Start:
1. Banner erscheint: "Benachrichtigungen aktivieren?"
2. Tippe auf **"✓ Aktivieren"**
3. Browser fragt nach Erlaubnis → **"Zulassen"**

### Wenn versehentlich blockiert:
- **Android Chrome:** Einstellungen → Website-Einstellungen → Benachrichtigungen → Zulassen
- **Android Edge:** Einstellungen → Website-Berechtigungen → Benachrichtigungen → Zulassen

---

## 🚗 SO FUNKTIONIERT DIE AUTO-ZUWEISUNG

### Ablauf:
1. **Fahrgast bucht** in Ahlbeck
2. **System berechnet:** Welches Taxi ist am nächsten?
   - Tesla 1: 2,3 km ✅ **← Dieser bekommt die Fahrt!**
   - Tesla 2: 5,1 km
   - Tesla 3: Offline
3. **Tesla 1 bekommt:**
   - 🔔 Push-Benachrichtigung
   - 🔊 Sound-Alarm
   - ⏰ 30 Sekunden Zeit zum Annehmen
4. **Wenn NICHT angenommen:**
   - → Automatisch zu Tesla 2
   - → Wieder 30 Sek. Timer
   - → Und so weiter...

---

## 📞 Bei Fragen einfach melden! 😊

**Version 3.6.0 - November 2024**
