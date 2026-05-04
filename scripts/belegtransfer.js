#!/usr/bin/env node
/**
 * v6.62.245: Belegtransfer-Watcher fuer Patricks PC.
 *
 * Watcht einen Ordner (z.B. C:\Users\Taxi\OneDrive\Belege\Eingang).
 * Sobald eine PDF/JPG/PNG-Datei reinkommt:
 *   1. Wartet 2 Sek (falls Datei noch nicht fertig kopiert ist)
 *   2. POST an Cloud Function processDocument (KI + Storage + DB)
 *   3. Bei Erfolg: verschiebt in 'Done/'-Subfolder oder loescht
 *   4. Bei Fehler: verschiebt in 'Error/'-Subfolder
 *
 * Aufruf:
 *   node scripts/belegtransfer.js
 *
 * Optional via Umgebungsvariablen:
 *   BELEG_DIR    — Watch-Ordner (Default: C:/Users/Taxi/OneDrive/Belege/Eingang)
 *   BELEG_KEY    — Cloud-Function-Key (Default: aus settings/healthCheckKey, fallback)
 *   BELEG_MODE   — 'delete' oder 'archive' (Default: archive — verschiebt nach Done/)
 *
 * Setup als Auto-Start:
 *   Verknuepfung in shell:startup mit Ziel:
 *     node "C:\Taxi App\taxi-App-github\scripts\belegtransfer.js"
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// v6.62.257: Multi-Folder-Support — BELEG_DIRS (komma-separiert) ODER config-Datei
//   node scripts/belegtransfer.js
//   set BELEG_DIRS=D:\Scans;C:\Users\Taxi\OneDrive\Eingang && node ...
//   ODER: config-Datei scripts/belegtransfer.config.json mit { "dirs": [...] }
const CONFIG_PATH = path.join(__dirname, 'belegtransfer.config.json');
let configDirs = null;
try {
    if (fs.existsSync(CONFIG_PATH)) {
        configDirs = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).dirs;
    }
} catch (_) {}

const ENV_DIRS = process.env.BELEG_DIRS
    ? process.env.BELEG_DIRS.split(/[,;]/).map(s => s.trim()).filter(Boolean)
    : null;
const SINGLE_DIR = process.env.BELEG_DIR;
const WATCH_DIRS = ENV_DIRS && ENV_DIRS.length > 0
    ? ENV_DIRS
    : (configDirs && configDirs.length > 0
        ? configDirs
        : (SINGLE_DIR ? [SINGLE_DIR] : ['C:/Users/Taxi/OneDrive/Belege/Eingang']));
const API_KEY   = process.env.BELEG_KEY || 'funk-taxi-heringsdorf-2026';
const MODE      = process.env.BELEG_MODE || 'archive'; // 'delete' | 'archive'
const ENDPOINT  = 'https://europe-west1-taxi-heringsdorf.cloudfunctions.net/processDocument';

const ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png'];
const PROCESSED = new Set();  // file paths die gerade verarbeitet werden

function doneDirFor(watchDir) { return path.join(watchDir, 'Done'); }
function errorDirFor(watchDir) { return path.join(watchDir, 'Error'); }

function ensureDirs() {
    for (const w of WATCH_DIRS) {
        for (const d of [w, doneDirFor(w), errorDirFor(w)]) {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        }
    }
}

function timestamp() {
    return new Date().toLocaleTimeString('de-DE', { hour12: false });
}

async function processFile(filePath, watchDir) {
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const ERROR_DIR = errorDirFor(watchDir);
    const DONE_DIR = doneDirFor(watchDir);
    if (!ALLOWED.includes(ext)) {
        console.log(`[${timestamp()}] ⏭  ${fileName} (kein PDF/Bild)`);
        return;
    }
    if (PROCESSED.has(filePath)) return;
    PROCESSED.add(filePath);

    try {
        // Datei einlesen
        const buffer = fs.readFileSync(filePath);
        if (buffer.length === 0) {
            console.log(`[${timestamp()}] ⏭  ${fileName} (leer)`);
            PROCESSED.delete(filePath);
            return;
        }
        if (buffer.length > 10 * 1024 * 1024) {
            console.log(`[${timestamp()}] ❌ ${fileName} zu gross (>10MB) → Error/`);
            fs.renameSync(filePath, path.join(ERROR_DIR, fileName));
            PROCESSED.delete(filePath);
            return;
        }
        const mediaType = ext === '.pdf' ? 'application/pdf' :
                          ext === '.png' ? 'image/png' : 'image/jpeg';
        console.log(`[${timestamp()}] 📤 ${fileName} (${(buffer.length/1024).toFixed(0)} KB) → KI-Analyse…`);

        // POST an Cloud Function
        const fileBase64 = buffer.toString('base64');
        const url = `${ENDPOINT}?key=${encodeURIComponent(API_KEY)}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileBase64, mediaType, filename: fileName })
        });
        const data = await resp.json();

        if (!data.ok) {
            console.error(`[${timestamp()}] ❌ ${fileName}: ${data.error || 'unbekannt'} → Error/`);
            fs.renameSync(filePath, path.join(ERROR_DIR, fileName));
            PROCESSED.delete(filePath);
            return;
        }

        if (data.status === 'duplicate') {
            const orig = data.duplicateOf || {};
            console.log(`[${timestamp()}] 🔁 ${fileName}: DUBLETTE — Original ${orig.lieferant || '?'} (${orig.datum || '?'}). Datei wird ${MODE === 'delete' ? 'gelöscht' : 'archiviert'}.`);
        } else {
            const p = data.parsed || {};
            const tag = data.status === 'inbox' ? '📥 INBOX' : '✅';
            console.log(`[${timestamp()}] ${tag} ${fileName} → ${p.kategorie || '_inbox'} · ${p.lieferant || '?'} · ${p.datum || ''} ${p.betrag ? p.betrag.toFixed(2)+'€' : ''} · doc=${data.docId}`);
        }

        // Verschieben oder loeschen
        if (MODE === 'delete') {
            fs.unlinkSync(filePath);
        } else {
            const target = path.join(DONE_DIR, fileName);
            // Bei Konflikt mit Timestamp-Prefix
            const finalTarget = fs.existsSync(target)
                ? path.join(DONE_DIR, `${Date.now()}_${fileName}`)
                : target;
            fs.renameSync(filePath, finalTarget);
        }
    } catch (e) {
        console.error(`[${timestamp()}] ❌ ${path.basename(filePath)}: ${e.message}`);
        try { fs.renameSync(filePath, path.join(ERROR_DIR, path.basename(filePath))); } catch (_) {}
    } finally {
        PROCESSED.delete(filePath);
    }
}

function startWatcher() {
    ensureDirs();
    console.log(`╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║  📨 Belegtransfer-Watcher v6.62.257                            ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    for (const w of WATCH_DIRS) {
        console.log(`║  📂 ${w.slice(0, 60).padEnd(60)}║`);
    }
    console.log(`║  Modus:  ${(MODE === 'delete' ? 'Original löschen nach Upload' : 'Original archivieren in ./Done').padEnd(54)}║`);
    console.log(`║  Endpoint: ${ENDPOINT.replace('https://', '').slice(0, 50).padEnd(52)}║`);
    console.log(`╚══════════════════════════════════════════════════════════════╝`);
    console.log(`\nÜberwacht ${WATCH_DIRS.length} Ordner — leg Dokumente ab, ich verarbeite automatisch.\n`);

    for (const watchDir of WATCH_DIRS) {
        // Initial: alle vorhandenen Files verarbeiten
        try {
            for (const f of fs.readdirSync(watchDir)) {
                const full = path.join(watchDir, f);
                try {
                    if (fs.statSync(full).isFile()) {
                        setTimeout(() => processFile(full, watchDir), 1000);
                    }
                } catch (_) {}
            }
        } catch (e) {
            console.error(`Fehler beim Initial-Scan von ${watchDir}: ${e.message}`);
        }

        // Live-Watcher pro Ordner
        try {
            fs.watch(watchDir, { persistent: true }, (eventType, fileName) => {
                if (!fileName) return;
                const full = path.join(watchDir, fileName);
                setTimeout(() => {
                    try {
                        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                            processFile(full, watchDir);
                        }
                    } catch (_) {}
                }, 2000);
            });
        } catch (e) {
            console.error(`Watcher-Fehler für ${watchDir}: ${e.message}`);
        }
    }
}

startWatcher();
