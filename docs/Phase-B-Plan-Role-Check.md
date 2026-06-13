# Phase B — Role-Check für Phone-Auth-User

**Auslöser:** Patrick 13.06.2026 16:21 — „Phase B vorbereiten ... musst du mir nachher nochmal sagen, wenn ich zu Hause bin, was wir da machen müssen, können, sollen."
**Vorbedingung:** Phase A (PR #2365) ist gemerged + live verifiziert. /rides /vehicles /drivers /vehicleShifts /tracking /settings/telegram/* sind nicht mehr anonym lesbar.

---

## I. Was Phase A noch NICHT löst

Phase A hat alle Schreib- und Lese-Regeln auf `auth != null` gesetzt. Das stoppt anonyme Internet-Browser, **aber jeder eingeloggte Phone-Auth-User hat technisch immer noch Vollzugriff** auf alle „auth != null"-Pfade.

Konkretes Szenario:
1. Beliebige Person legt mit ihrer Handynummer ein Konto in index.html an
2. Bekommt SMS-Code, ist eingeloggt → bekommt `auth.uid`
3. Browser-DevTools → curl mit Auth-Token → kann `/rides` LESEN und SCHREIBEN
4. Sieht alle Kunden mit Phones, kann Rides verändern, kann SMS triggern (/smsQueue), kann Telegram-Bot-Konversationen einsehen

→ DSGVO-Bruch bleibt für jeden Phone-Login.

---

## II. Was Phase B macht

Verschärft die Rules von „auth != null" auf „auth != null UND role-Check". Dabei:

| Pfad | Read | Write |
|---|---|---|
| `/rides` | `admin` oder `fahrer` (alle) ODER eigene customerId | `admin` oder `fahrer` |
| `/customers` | `admin` oder `fahrer` (bereits Phase A) | `admin` |
| `/vehicles` | `admin` oder `fahrer` | `admin` oder eigenes Vehicle |
| `/vehicleShifts` | `admin` oder `fahrer` | `admin` |
| `/drivers` | `admin` oder `fahrer` | `admin` |
| `/tracking/$code` | `admin` oder eigener Tracking-Token | nur Fahrer eigener Tour |
| `/smsQueue` | `admin` | `admin` (kein Phone-User soll SMS triggern!) |
| `/emailInbox` | `admin` | `admin` oder Cloud-Function |
| `/activity_log` | `admin` oder eigene UID | `admin` |
| `/optimierungsLog` | `admin` | `admin` |
| `/calendarEvents` | `admin` oder `fahrer` | `admin` oder `fahrer` |
| `/shifts` | `admin` oder `fahrer` | `admin` |
| `/cancellations` | `admin` oder `fahrer` | `admin` oder `fahrer` |
| `/hotelCalendars` | `admin` oder `fahrer` | `admin` |
| `/urlaubRequests` | `admin` oder eigene UID | eigene UID erstellt |
| `/bookingRequests` | `admin` oder eigene UID | eigene UID erstellt |

---

## III. Was sich ändert für die UI

### III.1 — buchen.html
- Anonymous-Auth-User → bekommen `role` = nichts → können nichts lesen → **bricht**
- Lösung: `/publicRides` mit anonymisierten Daten (nur „Vehicle busy/free" + GPS)
  - Cloud-Function spiegelt aus `/rides` und `/vehicles` ein subset
  - **Aufwand:** ~2-3h

### III.2 — track.html
- Tracking-Link-Kunde hat keinen Account → Anonymous-Auth-User → kein role
- Lösung: `/tracking/$code` darf gelesen werden wenn `auth != null` UND der `code` selbst im URL drinsteht („wer den Link hat, darf"). Code wird beim Erstellen kryptografisch zufällig generiert (vermutlich schon — prüfen)
  - Read-Rule: `auth != null` (mehr geht ohne Cloud-Function-Mediation nicht)
  - Sicherheits-Mehrwert: Codes sind nicht erratbar (10+ Zeichen Zufall) → praktisch sicher
  - **Aufwand:** 30 Min (Rules + ggf. Code-Generator prüfen)

### III.3 — landing.html
- Live-ETA-Banner liest `/vehicles` + `/rides`
- Lösung: gleicher `/publicRides`-Subset wie buchen.html
- **Aufwand:** 0 (nutzt buchen.html-Lösung)

### III.4 — index.html
- Passenger-User: kann nur eigene Rides sehen
  - UI-Code muss `db.ref('rides').orderByChild('customerId').equalTo(uid)` nutzen statt `db.ref('rides').once()`
  - Sonst: Rule schlägt fehl beim Lesen, User sieht „Permission denied"-Fehler
- Fahrer-User: liest alle Rides + Vehicles wie bisher (role = 'fahrer')
- Admin-User: unverändert (role = 'admin')
- **Aufwand:** ~1-2h für UI-Filter, vor allem Customer-Bereich (passenger-Tab)

### III.5 — Native Driver-App (Android)
- Fahrer-User: role = 'fahrer' → liest alle nötigen Pfade
- Vermutlich keine Code-Änderung nötig (Fahrer hat schon admin/fahrer-role)
- **Aufwand:** 0 nach Verifikation

### III.6 — Cloud-Functions
- Cloud-Function nutzt Admin-SDK → umgeht Rules komplett
- Keine Änderung nötig
- **Aufwand:** 0

---

## IV. Vorbereitungs-Checkliste (vor Phase-B-Rollout)

### IV.1 — `/users/{uid}/role` muss IMMER gesetzt sein
Aktuell schreibt index.html beim Phone-Auth-Login `role: 'passenger'` (zu prüfen).
- [ ] Code-Audit: wird `role` zuverlässig gesetzt bei jedem neuen User?
- [ ] Migrations-Script: alle bestehenden /users/{uid} ohne role → role='passenger' setzen
- [ ] Cloud-Function `onUserCreated` (falls nicht vorhanden) als Sicherheit

### IV.2 — `/publicRides` Subset anlegen
Cloud-Function `mirrorPublicRides` triggert auf `/rides` Updates:
```js
exports.onRideChanged = onValueWritten('/rides/{rideId}', async (event) => {
    const ride = event.data.after.val();
    if (!ride) {
        await db.ref(`/publicRides/${event.params.rideId}`).remove();
        return;
    }
    // Anonymisiertes Subset: KEINE Kunden-Daten
    await db.ref(`/publicRides/${event.params.rideId}`).set({
        vehicleId: ride.assignedVehicle || null,
        status: ride.status,
        isBusy: ['accepted', 'on_way', 'picked_up', 'in_progress', 'sofort'].includes(ride.status),
        pickupTimestamp: ride.pickupTimestamp,
        completedAt: ride.completedAt || null
        // KEINE customerName, KEINE customerPhone, KEINE Adressen
    });
});
```
- [ ] Cloud-Function deployen
- [ ] Initialer Backfill aller bestehenden Rides
- [ ] buchen.html + landing.html auf /publicRides umschalten

### IV.3 — `/tracking/$code` Code-Generator prüfen
- [ ] Wo wird der Code generiert? (vermutlich `createTrackingLink` Cloud-Function oder index.html)
- [ ] Ist Code Zufalls-String mit ausreichend Entropie? (mindestens 10+ Zeichen, 64+ Zeichensatz)
- [ ] Falls nicht: Generator hochziehen

### IV.4 — index.html passenger-Tab umstellen
- [ ] `db.ref('rides').once()` → `db.ref('rides').orderByChild('customerId').equalTo(auth.currentUser.uid).once()`
- [ ] Test mit Patricks Test-Account

### IV.5 — Rules-PR
- [ ] database.rules.json → Role-Check für 16 Pfade
- [ ] PR + Live-Test mit Test-User (passenger role) der nur eigene Rides sieht
- [ ] Rollback-Plan: PR revert

---

## V. Rollout-Reihenfolge (empfohlen)

| Tag | Schritt | Risiko |
|---|---|---|
| Tag 1 | `/users/{uid}/role` Audit + Migration | 0 |
| Tag 1 | Cloud-Function `/publicRides` Mirror + Initial-Backfill | 0 (read-only neue Daten) |
| Tag 2 vormittag | buchen.html + landing.html auf `/publicRides` | mittel (UI ggf. brechen) |
| Tag 2 nachmittag | index.html passenger-Tab umstellen | mittel (Test-Daten) |
| Tag 2 abend | Rules-PR Phase B (Role-Check) | hoch (gleich gross wie Phase A) |
| Tag 3 | Monitoring + Bugfixes | — |

---

## VI. Was Patrick HEUTE ABEND entscheiden muss

1. **`/publicRides` Subset bauen oder /tracking-Code als Geheimnis trauen?**
   - Subset bauen = aufwändiger, aber technisch sauberer
   - Tracking-Code = einfacher, aber „Wer den Link hat darf"-Sicherheit

2. **Rollout schnell oder schrittweise?**
   - Schnell: alle Schritte heute abend → morgen früh Bugs
   - Schrittweise: 2-3 Tage, jeden Schritt einzeln verifizieren

3. **Anonymous-Auth in Firebase Console wirklich aktivieren?**
   - Wenn Patrick es noch nicht gemacht hat: passiert bei buchen.html/track.html/landing.html dass die Page einen Fehler zeigt anstatt zu funktionieren
   - Aktivieren ist 1 Klick

4. **Native Driver-App testen oder Update-Forcing?**
   - Sollen Fahrer eine APK-Update erzwungen bekommen wenn Phase B live geht?

---

## VII. Quick-Wins ohne Phase B (parallel)

Auch ohne Role-Check kann man heute noch:
- [ ] Google API-Keys in Cloud Console mit Domain-Restriction (15 Min)
- [ ] `/settings/buchenLog`-Validation um Schreib-Größe begrenzen (5 Min)
- [ ] `/anfragen` Rate-Limit pro IP (Cloud-Function vorgeschaltet)

---

**Erstellt:** 13.06.2026 16:31 · Phase-B-Plan
**Status:** Diskussions-Vorlage für Patricks Abend-Briefing
