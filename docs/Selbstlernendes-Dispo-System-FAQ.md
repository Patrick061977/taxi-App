# Selbstlernendes Dispo-System — FAQ / To-Do

Patrick 20.09.2026 13:40 Bridge: *„Erstell mir daraus mal bitte eine FAQ oder eine To-Do-List, was wir machen müssten, damit wir so ein bisschen auf Änderungen flexibler reagieren können. Also was du dann machen würdest, damit das System lebt."*

Konzept: Statt harter "einmal berechnet, dann festgenagelt"-Zuweisung soll das System **rotierend** und **live** rechnen — auf Basis von GPS, Vergangenheit, App-Zustand — bis 30 Min vor Pickup. Danach: Freeze.

---

## Was schon lebt (gemergt heute 20.09.2026)

### ✅ v6.66.110 — 5-Min-App-Update-Grace
`onShiftStatusChanged` triggert nicht mehr sofort Reassign wenn ein Fahrer `shift.status='ended'` schickt (bei App-Update = normaler Fall). Stattdessen 5 Min warten, ob der Fahrer wieder Heartbeat schickt. Rides mit Pickup ≤ 15 Min bleiben sofort-reassign (Marion-Regel).

### ✅ v6.66.111 — Wartepool-Retry-Cron
Alle 5 Min bewertet `scheduledWartepoolRetry` alle Wartepool-Rides neu solange Pickup > 30 Min entfernt. `vehicleScores` werden invalidiert, `autoAssignRide` neu aufgerufen. Marker wie `fallback-excluded` verlieren ihre "Ewigkeit".

### ✅ v6.66.108 — Auto-Shift geblockt bei Vorfahrt-Konflikt
Statt Fahrten heimlich +N Min zu verschieben → Admin-Push, Patrick entscheidet.

---

## Was noch fehlt für "das System lebt"

### 🚧 v6.66.112 — 30-Min-Cutoff-Freeze visuell + Konflikt-Karenz +5 Min
**Problem:** Aktuell wird die Zuweisung theoretisch bis Sekunden vor Pickup umgeschmissen wenn irgendein Cron das für optimal hält. Patrick 13:38 Bridge: *„30-35 Min vor dem Termin sollte feststehen wer die Fahrt macht. Das sollte dann auch in der Dispo stehen."*

**Fix:**
- Neuer Flag `_assignmentFrozen: true` wird ab 30 Min vor Pickup gesetzt (Cron oder onRideUpdated).
- Auto-Assign, Auto-Optimize, Prio-Time-Resort respektieren den Flag: keine Umverteilung mehr.
- Ausnahme: Fahrer aktiv Reject oder Schicht-Ende (v6.66.110-Grace + v6.66.73 Marion-Regel greifen).
- Dispo-Live zeigt "🔒 fest zugewiesen" Badge bei Rides mit `_assignmentFrozen`.
- Konflikt-Toleranz: aktuell blockt v6.66.108 schon bei +0 Min. Auf +5 Min hochziehen (Patrick's Karenz-Regel, feedback_karenz-5min-beide-richtungen.md).

**Aufwand:** ~2h.

---

### 🚧 v6.66.113 — Live-Anfahrt via GPS statt statisch
**Problem:** `autoAssignRide` nutzt aktuell OSRM ONE-Time-Berechnung. Wenn Tesla MY unterwegs Richtung Ahlbeck fährt (jetzt 42 km weg), müsste das System bei jedem GPS-Ping die Neu-Anfahrtszeit rechnen. Sonst „veraltete Diagnose" — was in Radegast-Fall 20.09. genau passiert ist.

**Fix:**
- `vehicles/{vid}/lat|lon`-Updates triggern eine Neu-Bewertung aller zugewiesenen + Wartepool-Rides von dem Fzg
- Fahrt-Ende → alle offenen Rides prüfen: könnte ich die auch machen? Wenn ja: Vorschlag pushen
- Batch-Update alle 60s (nicht bei jedem GPS-Ping = teuer)

**Aufwand:** ~4h. Braucht Cost-Monitoring, GPS-Pings sind viele.

---

### 🚧 v6.66.114 — „Fzg fährt in die Richtung" Detection
**Problem:** Patrick heute: *„Wenn jetzt zum Beispiel ein Fahrzeug in die Richtung fährt..."* — das ist der Human-Instinkt vom Dispatcher. Fzg X fährt gerade in Richtung Ahlbeck (mit einem Kunden), erreicht Ahlbeck in 8 Min → könnte danach die nächste Ahlbeck-Fahrt anschließen.

**Fix:**
- OSRM-Anfahrt-Berechnung erweitern: nicht nur vom aktuellen GPS zum Pickup, sondern vom Drop-Off der aktuellen Fahrt.
- Wenn `assignedVehicle` gerade eine Fahrt macht → Drop-Off-Koords + Puffer als „virtuelle Startposition" für nächste Ride nehmen.
- Chain-Score: kürzeste Leerfahrt-Kette gewinnt.

**Aufwand:** ~3h.

---

### 🚧 v6.66.115 — Ergebnis-Learning Fahrer-Grab vs. Auto-Assign
**Problem:** Wenn Fzg X eine Fahrt selbst grab-t obwohl Auto-Assign es ausgeschlossen hat → System hat falsch entschieden. Umgekehrt: wenn Auto-Assign Fzg X vergibt und Fzg X reject-t → System sollte für ähnliche Situationen zurückhaltender werden.

**Fix:**
- Log-Struktur `/systemLearn/{rideId}` mit `{autoAssignChoice, humanOverride, actualDriver, timestamp}`
- Wöchentlicher Report: welche Regeln haben schlechte Trefferquote?
- Erst Analyse-Phase, dann Regel-Anpassung — kein autonomes Regel-Umschreiben.

**Aufwand:** Analyse ~2h, Adjust-Iterationen laufen weiter.

---

### 🚧 v6.66.116 — Konflikt-Kaskade auflösen mit 3-Way-Look-Ahead
**Problem:** Aktuell greift `autoResolveConflicts` nur 1-vs-1: Fahrt A blockt Fzg X für Fahrt B → beide neu verteilen. Aber oft ist die Lösung ein 3-Way-Swap: A → Fzg X, B → Fzg Y (der bisher C hatte), C → Fzg Z. Kein Cron rechnet das.

**Fix:**
- Bei Konflikt-Erkennung: alle betroffenen Rides + alle im-Dienst-Fzg als Bipartite-Graph → Hungarian-Algorithm für optimales Matching.
- Fallback wenn zu viele Kombinationen (>20 Rides): heuristisches Greedy-Matching.

**Aufwand:** ~6h. Größer, aber löst „Radegast + Seeperle + Krupp + Antje"-Ketten-Fälle in einem Rutsch.

---

## Prinzipien

1. **Rotierend, nicht statisch**: Bis 30 Min vor Pickup jede 5-10 Min neu bewerten.
2. **Freeze mit Sichtbarkeit**: Ab Cutoff Zuweisung fest + Dispo zeigt "🔒".
3. **Karenz statt Perfektion**: +5 Min Toleranz sowohl beim Vorwärts- als auch Rückwärts-Shift.
4. **App-Update ist normal**: 5 Min Grace bei shift.ended (v6.66.110 ✅).
5. **GPS ist Wahrheit, Schichtplan ist Rahmen**: Live-Position schlägt statische Anfahrt-Schätzung.
6. **Human-Override immer respektieren**: `assignmentLocked=true` niemals brechen.
7. **Selbstlernen ohne Selbstverändern**: System sammelt Muster, meldet Auffälligkeiten — Patrick entscheidet über Regel-Änderungen.

---

## Was das System NICHT tun soll

- ❌ **Auto-Shift ohne Approval** (v6.66.108 disabled). Zeit-Verschiebungen nur nach Admin-Push + Patrick-Freigabe.
- ❌ **Selbstständig Kunden benachrichtigen** (feedback_nie-eigenmaechtig-an-kunden-senden.md).
- ❌ **Assignments locken ohne User-Aktion** (feedback_bridge-wartepool-no-lock.md).
- ❌ **Fahrer-Reject als "einmal abgelehnt = für immer" verstehen wenn die Ursache weg ist** (v6.66.72 muss mit TTL nachjustiert werden — pending).

---

**Priorisierung Patrick-Sicht:** v6.66.112 zuerst (30-Min-Freeze sichtbar), dann v6.66.114 (Ketten-Optimierung), dann v6.66.113 (Live-GPS).
