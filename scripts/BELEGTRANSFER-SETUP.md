# 📨 Belegtransfer — Watch-Folder für DMS

Watcht einen Ordner auf deinem PC. Jedes neue PDF/Bild wird automatisch:
1. KI-analysiert (Anthropic Vision)
2. Auf Dubletten geprüft (SHA-256 Hash)
3. In Firebase Storage hochgeladen
4. In `/docs/{id}` indexiert
5. Original verschoben in `Done/` oder gelöscht

## 1) Setup (einmalig)

**Voraussetzung:** Node.js installiert (`node --version` zeigt v18+).

**Watch-Ordner anlegen:**
```
C:\Users\Taxi\OneDrive\Belege\Eingang
```

(Sub-Ordner `Done\` und `Error\` werden automatisch angelegt.)

## 2) Starten

```bash
node "C:\Taxi App\taxi-App-github\scripts\belegtransfer.js"
```

Konsole zeigt:
```
╔══════════════════════════════════════════════╗
║  📨 Belegtransfer-Watcher v6.62.245           ║
╠══════════════════════════════════════════════╣
║  Ordner: C:/Users/Taxi/OneDrive/Belege/...    ║
║  Modus:  Original archivieren in ./Done       ║
╚══════════════════════════════════════════════╝
Überwacht — leg Dokumente in den Ordner ab.
```

Sobald du eine PDF/JPG dort ablegst:
```
[09:15:32] 📤 rechnung-werkstatt.pdf (243 KB) → KI-Analyse…
[09:15:48] ✅ rechnung-werkstatt.pdf → C · Werkstatt Schmidt · 2026-04-22 245.50€ · doc=-O...
```

Datei wandert nach `Eingang/Done/rechnung-werkstatt.pdf`.

## 3) Modi

**`BELEG_MODE=archive`** (Default) — Original wird in `./Done` verschoben.
**`BELEG_MODE=delete`** — Original wird gelöscht (nicht empfehlenswert).

Beispiel mit Delete-Modus:
```bash
set BELEG_MODE=delete && node scripts/belegtransfer.js
```

## 4) Anderer Watch-Ordner

```bash
set BELEG_DIR=D:\Scans && node scripts/belegtransfer.js
```

## 5) Auto-Start beim Hochfahren

1. **Win+R** → `shell:startup` (öffnet Autostart-Ordner)
2. Rechtsklick → **Neu → Verknüpfung**
3. Ziel: `node "C:\Taxi App\taxi-App-github\scripts\belegtransfer.js"`
4. Name: `Belegtransfer`
5. **Fertig** — startet bei jedem PC-Start

## 6) Was passiert in welcher Situation

| Was | Datei landet in… | DMS-Status |
|-----|------------------|------------|
| KI erkennt mit Confidence ≥ 80% | `Done/` | normale Bibliothek (Kategorie A-H) |
| KI unsicher / Fehler | `Done/` | **📥 Posteingang** im DMS, manuell nachprüfen |
| Schon hochgeladen (Hash-Match) | `Done/` | nicht doppelt — nur Datei verschoben |
| > 10 MB / kein PDF/Bild | `Error/` | nichts in DMS |
| KI-Endpoint nicht erreichbar | `Error/` | nichts in DMS — später nochmal versuchen |

## 7) Use-Cases

- **Multifunktions-Drucker:** Direkt in den Watch-Ordner scannen
- **Email-Anhänge:** Manuell aus Outlook in den Ordner ziehen
- **Smartphone-Scanner:** OneDrive-Sync schiebt Scans automatisch dort hin
- **Fotos vom Beleg:** Per OneDrive-Sync vom Handy in den Ordner

Alles wird vollautomatisch im DMS verarbeitet.
