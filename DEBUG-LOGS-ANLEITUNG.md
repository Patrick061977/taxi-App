# 🔍 DEBUG & LOGGING ANLEITUNG

## 📊 **Wo finde ich welche Logs?**

Die Taxi-App hat **3 verschiedene Log-Systeme**:

---

## 1. 🐛 **Debug Panel** (Live-Logs in der App)

### Wie öffnen:
- **Floating Button** unten rechts: 🐛 Symbol klicken
- **Admin-Menü**: ☰ → Debug Panel

### Was wird angezeigt:
- ✅ Live-Logs während der Nutzung
- 📋 Logs Tab: Alle aktuellen System-Logs
- 🔧 Funktionen Tab: Übersicht aller 1.286 Funktionen
- ⏱️ Timeline Tab: Chronologische Ereignisse

### Logs anzeigen:
```javascript
// Im Code:
debugLog('info', 'Meine Info-Nachricht');
debugLog('warn', 'Warnung!');
debugLog('error', 'Fehler aufgetreten!');
```

### 🔗 **NEU: Automatische Integration!**
Alle `advancedLogger` Logs erscheinen jetzt auch im Debug Panel!

---

## 2. 📚 **Advanced Logger** (Persistente Logs in IndexedDB)

### Wie nutzen:
```javascript
// Im Code verwenden:
window.advancedLogger.info(LOG_CATEGORIES.BOOKING, 'Buchung erstellt', {rideId: 123});
window.advancedLogger.warn(LOG_CATEGORIES.GPS, 'GPS ungenau', {accuracy: 100});
window.advancedLogger.error(LOG_CATEGORIES.DATABASE, 'Firebase Fehler', {error: err});
```

### Kategorien:
- `LOG_CATEGORIES.SYSTEM` - Systemereignisse
- `LOG_CATEGORIES.GPS` - GPS & Location
- `LOG_CATEGORIES.ROUTE` - Routen-Berechnung
- `LOG_CATEGORIES.BOOKING` - Buchungen
- `LOG_CATEGORIES.PAYMENT` - Zahlungen
- `LOG_CATEGORIES.AUTH` - Authentifizierung
- `LOG_CATEGORIES.DATABASE` - Firebase-Operationen
- `LOG_CATEGORIES.UI` - UI-Events
- `LOG_CATEGORIES.PERFORMANCE` - Performance-Metriken
- `LOG_CATEGORIES.NETWORK` - API-Calls

### Logs abrufen:
```javascript
// Alle Logs
const logs = await window.advancedLogger.getLogs();

// Gefilterte Logs
const errorLogs = await window.advancedLogger.getLogs({
    level: LOG_LEVELS.ERROR,
    category: 'booking',
    startDate: '2026-02-01'
});

// Statistiken
const stats = await window.advancedLogger.getStatistics();
console.log('Total Logs:', stats.total);
console.log('Errors:', stats.errors);
```

### Export:
```javascript
// JSON Export
await window.advancedLogger.exportLogs({}, 'json');

// CSV Export
await window.advancedLogger.exportLogs({}, 'csv');

// TXT Export
await window.advancedLogger.exportLogs({}, 'txt');
```

---

## 3. 🔍 **Log Viewer** (Separates HTML-Tool)

### Wie öffnen:
Direkter Link: `https://patrick061977.github.io/taxi-App/log-viewer.html`

### Features:
- 📊 Übersicht aller Logs aus IndexedDB
- 🔍 Filter nach Kategorie, Level, Datum
- 📈 Statistiken (Total, Transaktionen, Fehler)
- 💾 Export (JSON/CSV/TXT)
- 🗑️ Logs löschen

### Verwendung:
1. Öffne log-viewer.html
2. Warte bis Logs geladen sind
3. Nutze Filter um zu suchen:
   - Kategorie: GPS, Booking, etc.
   - Level: ERROR, WARN, INFO, DEBUG
   - Zeitraum: Von/Bis Datum
4. Export oder Logs löschen

---

## 🔧 **Welches System wofür?**

| Use Case | System |
|----------|--------|
| **Live-Debugging während Entwicklung** | Debug Panel |
| **Fehler in Produktion analysieren** | Advanced Logger + Log Viewer |
| **Performance-Metriken tracken** | Advanced Logger (Transactions) |
| **User-Support** | Log Viewer (Export & User senden lassen) |
| **Console-Logs strukturiert speichern** | Advanced Logger |

---

## 🚨 **Wichtige Hinweise**

### ⚠️ **Endlosschleifen vermeiden:**

```javascript
// ❌ FALSCH - Kann Endlosschleife verursachen:
console.log = function() {
    window.advancedLogger.debug('system', 'Console log');
};

// ✅ RICHTIG - Bridge ist bereits implementiert:
// Nichts tun, alles läuft automatisch!
```

### 🔒 **Geschützte Systeme:**

Die folgenden Schutzmaßnahmen sind aktiv:
- ✅ `isLogging` Guard verhindert rekursive Logs
- ✅ Firebase-Sync DEAKTIVIERT (verhindert Loops)
- ✅ Console-Overrides DEAKTIVIERT (verhindert Loops)
- ✅ Silent fail in saveLog() (kein Console-Spam)

### 💾 **Datenspeicherung:**

- **Debug Panel**: Max. 500 Logs im Memory (wird bei Seiten-Reload gelöscht)
- **Advanced Logger**: 7 Tage in IndexedDB (automatische Bereinigung)
- **Log Viewer**: Zeigt alle IndexedDB-Logs (max. 1000 im Memory)

---

## 📖 **Beispiele**

### Transaction Tracking:
```javascript
// Starte Transaction
const txnId = window.advancedLogger.startTransaction(
    'Buchung erstellen',
    LOG_CATEGORIES.BOOKING,
    {userId: 'user123'}
);

// Log Zwischenschritte
window.advancedLogger.logTransactionStep(txnId, 'Route berechnet', {distance: 15.3});
window.advancedLogger.logTransactionStep(txnId, 'Preis kalkuliert', {price: 25.50});

// Ende Transaction
window.advancedLogger.endTransaction(txnId, 'success', {rideId: 'ride_456'});
```

### Performance Tracking:
```javascript
// Start Messung
const markId = window.advancedLogger.startPerformanceMark('Route berechnen');

// ... Code ausführen ...

// Ende Messung
const duration = window.advancedLogger.endPerformanceMark(markId);
console.log(`Route Berechnung dauerte ${duration}ms`);
```

### Spezialisierte Logs:
```javascript
// GPS Update
window.advancedLogger.logGPSUpdate({lat: 52.5, lng: 13.4}, 10);

// Buchung
window.advancedLogger.logBooking(bookingData, {success: true, rideId: 'ride123'});

// Route
window.advancedLogger.logRouteCalculation('Berlin', 'Hamburg', result, 150);

// API Call
window.advancedLogger.logAPICall('https://api.example.com', 'GET', 200, 150);
```

---

## 🔗 **Integration zwischen Systemen**

Die Systeme sind jetzt verbunden:

```
advancedLogger.info()
  ↓
consoleOutput()
  ↓
├─→ Browser Console (styled)
└─→ debugLog() [NEU!]
      ↓
    Debug Panel
```

**Das bedeutet:**
- Jeder `advancedLogger` Log erscheint automatisch im Debug Panel ✅
- Logs werden in IndexedDB gespeichert ✅
- Logs erscheinen in Browser-Console ✅
- Logs sind im Log Viewer sichtbar ✅

---

## 🎯 **Best Practices**

1. **Verwende Kategorien sinnvoll:**
   ```javascript
   // ✅ Gut
   window.advancedLogger.error(LOG_CATEGORIES.DATABASE, 'Firebase Fehler', {path: '/rides'});

   // ❌ Schlecht
   window.advancedLogger.error(LOG_CATEGORIES.SYSTEM, 'Irgendein Fehler');
   ```

2. **Füge Context hinzu:**
   ```javascript
   // ✅ Gut
   window.advancedLogger.info(LOG_CATEGORIES.BOOKING, 'Buchung erstellt', {
       rideId: ride.id,
       userId: user.id,
       pickup: pickup,
       price: price
   });

   // ❌ Schlecht
   window.advancedLogger.info(LOG_CATEGORIES.BOOKING, 'Buchung erstellt');
   ```

3. **Nutze passende Log-Levels:**
   - `DEBUG`: Nur für Entwicklung, sehr detailliert
   - `INFO`: Normale Events (Buchung, Route)
   - `WARN`: Warnungen die beachtet werden sollten
   - `ERROR`: Fehler die Recovery erlauben
   - `CRITICAL`: Fatale Fehler, App nicht funktionsfähig

---

## 📞 **Support**

Bei Fragen zum Logging-System:
- Session: https://claude.ai/code/session_01M7xEtk2T17vKcM2iLFHP6f
- GitHub Issues: https://github.com/Patrick061977/taxi-App/issues
