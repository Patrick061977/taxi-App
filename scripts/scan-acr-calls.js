#!/usr/bin/env node
// scan-acr-calls.js — Scannt den ACR-Phone-OneDrive-Ordner nach neuen Anrufaufnahmen.
// Pro neuer .m4a: Whisper-Transkription → Anthropic-KI-Klassifikation (Buchung ja/nein) →
// bei Buchung Bridge-Push an Patrick mit Vorschlag.
//
// Aufruf:
//   node scripts/scan-acr-calls.js              # Einmal scannen
//   node scripts/scan-acr-calls.js --watch      # Loop alle 10 Min
//   node scripts/scan-acr-calls.js --backfill 12  # Hole letzte 12h auch wenn schon vermerkt
//
// Speichert State in .acr-scan-state.json damit jeder Anruf nur einmal verarbeitet wird.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ACR_DIR = 'C:/Users/Taxi/OneDrive/6.Dokumente unsortiert/Anwendungen/ACRPhone Cloud Uploads/Acr';
const STATE_FILE = path.join(__dirname, '..', '.acr-scan-state.json');
const TRANSCRIPT_CACHE = path.join(__dirname, '..', '.acr-transcripts');
fs.mkdirSync(TRANSCRIPT_CACHE, { recursive: true });

const WATCH = process.argv.includes('--watch');
const LOOP_MS = 10 * 60 * 1000;
const BACKFILL_HOURS = (() => {
    const i = process.argv.indexOf('--backfill');
    return i > -1 ? parseInt(process.argv[i + 1] || '0', 10) : 0;
})();
const MIN_DURATION_SEC = 8;   // Anrufe < 8s = Verpasste/Falschverbindung, skip
// 🔧 v1.5 (Patrick 24.06. 14:51 'Zentrale kannst du skippen'): interne Funk-Kanaele
// als CallerName komplett vorfiltern — kein Whisper-Call, kein KI-Aufruf, keine Tokens.
// v6.63.495 (Patrick 25.06. 09:57 'Zentrale ist Mitarbeiter, skippen'): Liste erweitert
// + zusaetzlich CALLER_NUMBER_BLACKLIST (manche ACR-Files haben nur Nummer ohne Namen).
const CALLER_NAME_BLACKLIST = ['zentrale', 'patrick', 'mama', 'hasi', 'danilo', 'ivo', 'olaf', 'kulpa', 'karl-heinz', 'karlheinz'];
const CALLER_NUMBER_BLACKLIST = ['+491715377241']; // Zentrale-Funk

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { processed: {}, lastRunAt: 0 }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function getOpenAIKey() {
    try {
        const out = execSync('firebase database:get /settings/openai/apiKey', { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
        return out.trim().replace(/^"|"$/g, '');
    } catch { return null; }
}

async function transcribeFile(filePath, openaiKey) {
    const buf = fs.readFileSync(filePath);
    const boundary = '----formdata-acr-' + Date.now();
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="call.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`));
    parts.push(buf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
    });
    if (!r.ok) throw new Error('Whisper-Fehler ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return await r.json();
}

async function classifyWithKI(transcript, callerName, callerNumber, callDate, anthropicKey) {
    const prompt = `Du bist Buchungs-Assistent für Funk-Taxi Heringsdorf (Insel Usedom). Analysiere dieses Anruf-Transkript:

ANRUF vom ${callDate}
Von: ${callerName} (${callerNumber})

TRANSKRIPT:
${transcript}

AUFGABE:
1. Ist das eine Taxi-Buchungsanfrage? (ja/nein/unklar)
2. Wenn ja: extrahiere die Buchung als JSON mit Feldern (alle optional, null wenn unklar):
   {
     "isBookingRequest": true,
     "confidence": "hoch|mittel|niedrig",
     "datum": "YYYY-MM-DD oder Beschreibung wie 'morgen'",
     "uhrzeit": "HH:MM oder 'sofort'/'unklar'",
     "pickup": "Abholort",
     "destination": "Zielort",
     "passengers": Zahl oder null,
     "customerName": "Name des Anrufers oder Auftragsbuchers",
     "guestName": "Name des Fahrgasts (falls anders als Anrufer, z.B. Hotelgast)",
     "phone": "Telefonnummer falls genannt",
     "paymentMethod": "bar/rechnung/karte oder null",
     "notes": "wichtige Zusatzinfo (Anlass, Spezialwuensche, Bus-Anschluss etc.)",
     "needsCallback": true/false,
     "unklarheiten": "was unklar geblieben ist (z.B. 'Personenzahl nicht genannt')"
   }
3. Bei 'nein' oder 'unklar' (Spam/Werbung/zufaellig/Familie/etc.) gib nur zurück:
   {
     "isBookingRequest": false,
     "art": "spam/werbung/privat/fahrer/sonstiges",
     "kurz": "1-Satz-Zusammenfassung"
   }

Antworte NUR mit gültigem JSON. Keine Erklärungen, kein Markdown.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }]
        })
    });
    if (!r.ok) throw new Error('Anthropic-Fehler ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const data = await r.json();
    const text = data.content?.[0]?.text || '{}';
    // Extrahiere JSON aus Antwort (falls KI doch mal Wrap nutzt)
    const m = text.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : text); } catch { return { isBookingRequest: false, art: 'parse-fehler', kurz: text.slice(0, 200) }; }
}

function bridgePush(msg) {
    // 🔕 v6.63.546 (Patrick 29.06.): Bridge-Push deaktiviert — Bridge muss frei bleiben.
    // Anruf-Vorschauen verstopfen die Bridge; Patrick will keine automatischen Push-Meldungen.
    console.log('[ACR] Bridge-Push deaktiviert:', msg.slice(0, 80));
    return false;
}

// 🔧 v6.63.495: Anruf-Statistik anhaengen (newline-JSON, einfach append)
const STATS_FILE = path.join(__dirname, '..', '.acr-call-stats.ndjson');
function appendCallStat(entry) {
    fs.appendFileSync(STATS_FILE, JSON.stringify(entry) + '\n');
}

// 🔧 v6.63.495: CRM-Cache (5 Min TTL) damit nicht jeder Push komplette /customers laedt
let _crmCache = null;
let _crmCacheAt = 0;
async function lookupCrm(phone) {
    if (!phone) return null;
    const normalized = phone.replace(/[\s()-]/g, '');
    if (!_crmCache || Date.now() - _crmCacheAt > 5 * 60 * 1000) {
        try {
            const out = execSync('firebase database:get /customers --project taxi-heringsdorf', {
                encoding: 'utf8',
                env: { ...process.env, MSYS_NO_PATHCONV: '1' },
                maxBuffer: 50 * 1024 * 1024
            });
            _crmCache = JSON.parse(out || '{}');
            _crmCacheAt = Date.now();
        } catch (e) { _crmCache = {}; }
    }
    for (const [id, c] of Object.entries(_crmCache || {})) {
        if (!c) continue;
        const phones = [c.phone, c.mobile, c.mobilePhone].filter(Boolean).map(p => p.replace(/[\s()-]/g, ''));
        if (phones.some(p => p === normalized || p.endsWith(normalized.slice(-9)))) {
            return { id, name: c.name, phone: c.phone, address: c.address, lat: c.lat, lon: c.lon };
        }
    }
    return null;
}

// 🔧 v6.63.495: Datum/Uhrzeit-Aufhuebsch (HEUTE/MORGEN Berlin) — KI-Output normalisieren
function formatBookingTime(datum, uhrzeit, fallbackTs) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    let prefix = '';
    if (datum === today || (datum && datum.toLowerCase().includes('heute'))) prefix = 'HEUTE ';
    else if (datum === tomorrow || (datum && datum.toLowerCase().includes('morgen'))) prefix = 'MORGEN ';
    const dt = datum && datum.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(datum + 'T12:00:00+02:00') : new Date(fallbackTs);
    const wday = dt.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' });
    const day = dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
    return `${prefix}${wday} ${day} ${uhrzeit || '?'}`;
}

function parseAcrFilename(filename) {
    // "Waldoase Ahlbeck (+493837850225) [2026-06-23 18-39-50] [Eingehend].m4a"
    // ODER "+49 1573 2027558 (+4915732027558) [2025-08-05 10-43-04] [Eingehend].m4a"
    const m = filename.match(/^(.+?)\s*\(([+\d\s()-]+)\)\s*\[(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})\]\s*\[(Eingehend|Ausgehend)\]/);
    if (!m) return null;
    return {
        callerName: m[1].trim(),
        callerNumber: m[2].replace(/[\s()-]/g, ''),
        date: m[3],
        time: `${m[4]}:${m[5]}:${m[6]}`,
        direction: m[7] === 'Eingehend' ? 'incoming' : 'outgoing',
        timestamp: new Date(`${m[3]}T${m[4]}:${m[5]}:${m[6]}+02:00`).getTime()
    };
}

async function getAnthropicKey() {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    try {
        const out = execSync('firebase database:get /settings/anthropic/apiKey', { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
        return out.trim().replace(/^"|"$/g, '');
    } catch { return null; }
}

async function scanOnce() {
    if (!fs.existsSync(ACR_DIR)) { console.error('ACR-Ordner fehlt:', ACR_DIR); return; }
    const state = loadState();
    const openaiKey = await getOpenAIKey();
    if (!openaiKey) { console.error('OpenAI-Key fehlt'); return; }
    const anthropicKey = await getAnthropicKey();
    if (!anthropicKey) { console.error('Anthropic-Key fehlt'); return; }

    // 🔧 v1.3 (Patrick 24.06. 08:13 'wann kommt der push'):
    //   File-Timestamp im Filename = Anrufzeit (08:05:15), aber OneDrive
    //   uploaded die Datei verspaetet (08:07 fs.watch-event). Wenn cutoffTs =
    //   state.lastRunAt, faellt die Datei durch's Raster. Fix: 30 Min Puffer.
    const cutoffTs = BACKFILL_HOURS > 0
        ? Date.now() - BACKFILL_HOURS * 3600 * 1000
        : Math.max((state.lastRunAt || 0) - 30 * 60 * 1000, Date.now() - 24 * 3600 * 1000);

    const files = fs.readdirSync(ACR_DIR).filter(f => /\.m4a$/i.test(f));
    const candidates = files
        .map(f => ({ filename: f, meta: parseAcrFilename(f), fullPath: path.join(ACR_DIR, f) }))
        // 🔧 v1.4 (Patrick 24.06. 09:46 'nimmst du nur Anrufe oder auch Rueckrufe'):
        //   Ausgehende Anrufe (= Patricks Rueckrufe) auch analysieren — Buchungen werden
        //   oft beim Rueckruf abgeschlossen. KI filtert kurze technische Anrufe selber raus.
        .filter(x => x.meta && (x.meta.direction === 'incoming' || x.meta.direction === 'outgoing') && x.meta.timestamp >= cutoffTs)
        .filter(x => !state.processed[x.filename])
        .sort((a, b) => a.meta.timestamp - b.meta.timestamp);

    console.log(`[${new Date().toLocaleTimeString('de-DE')}] ${candidates.length} neue eingehende ACR-Aufnahmen seit ${new Date(cutoffTs).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`);

    let pushed = 0, skipped = 0;
    for (const c of candidates) {
        try {
            const stat = fs.statSync(c.fullPath);
            const sizeKb = Math.round(stat.size / 1024);
            // 🔧 v1.5 / v6.63.495: Skip interne Funk-Kanaele (Name ODER Nummer)
            const callerLow = (c.meta.callerName || '').toLowerCase();
            const callerNum = (c.meta.callerNumber || '').replace(/[\s()-]/g, '');
            const blacklistedByName = CALLER_NAME_BLACKLIST.some(b => callerLow.includes(b));
            const blacklistedByNumber = CALLER_NUMBER_BLACKLIST.some(b => callerNum === b);
            if (blacklistedByName || blacklistedByNumber) {
                const reason = blacklistedByNumber ? `number-${callerNum}` : `name-${callerLow}`;
                console.log(`  ⏭️ ${c.filename} — Blacklist (${reason})`);
                state.processed[c.filename] = { skipped: 'blacklist-' + reason, ts: Date.now(), callerName: c.meta.callerName };
                skipped++;
                saveState(state);
                continue;
            }
            console.log(`  📥 ${c.filename} (${sizeKb} KB)`);
            // Whisper-Cache: wenn schon transkribiert, nicht nochmal
            const cacheFile = path.join(TRANSCRIPT_CACHE, c.filename.replace(/\.m4a$/i, '.json'));
            let trans;
            if (fs.existsSync(cacheFile)) {
                trans = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                console.log(`     → cached transcript (${trans.duration?.toFixed(0) || '?'}s)`);
            } else {
                trans = await transcribeFile(c.fullPath, openaiKey);
                fs.writeFileSync(cacheFile, JSON.stringify(trans, null, 2));
                console.log(`     → Whisper OK (${trans.duration?.toFixed(0) || '?'}s)`);
            }
            // 🔧 v1.2 (Patrick 24.06. 07:42 Ostseehotel-Bug):
            //   Whisper liefert manchmal duration=null. Dann nicht skippen, sondern
            //   Dateigroesse als Fallback nutzen (<25 KB = wirklich nur Klingeln).
            const trueDuration = trans.duration != null ? trans.duration : null;
            const isShortByDuration = trueDuration != null && trueDuration < MIN_DURATION_SEC;
            const isShortBySize = trueDuration == null && sizeKb < 25;
            if (isShortByDuration || isShortBySize) {
                const reason = isShortByDuration ? `Dauer ${trueDuration.toFixed(1)}s < ${MIN_DURATION_SEC}s` : `Groesse ${sizeKb} KB < 25 KB`;
                console.log(`     ⏭️ skip (${reason})`);
                state.processed[c.filename] = { skipped: reason, ts: Date.now() };
                skipped++;
                continue;
            }

            // KI-Klassifikation
            const callerDisplay = c.meta.callerName && !c.meta.callerName.match(/^\+\d/) ? c.meta.callerName : c.meta.callerNumber;
            const dateDisplay = new Date(c.meta.timestamp).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
            const classification = await classifyWithKI(trans.text || '', callerDisplay, c.meta.callerNumber, dateDisplay, anthropicKey);
            console.log(`     → KI: ${classification.isBookingRequest ? '✅ BUCHUNG' : '⏭️ ' + (classification.art || 'nein')}`);

            if (classification.isBookingRequest) {
                // 🔧 v6.63.495 (Patrick 25.06. 10:09 "in dieser Schumann-Struktur immer"):
                //   Kompaktes Vorschau-Format, CRM-Lookup automatisch, kein Header/Konfidenz/Transkript-Quatsch.
                const crmMatch = await lookupCrm(c.meta.callerNumber);
                const callerLabel = classification.customerName || classification.guestName || callerDisplay;
                const dtFmt = formatBookingTime(classification.datum, classification.uhrzeit, c.meta.timestamp);
                const lines = [];
                lines.push(`📋 ${callerLabel.toUpperCase()} — ${new Date(c.meta.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Anruf`);
                lines.push(`  📅 ${dtFmt}`);
                lines.push(`  🏨 Pickup: ${classification.pickup || '?'}`);
                if (crmMatch) lines.push(`       CRM: ${crmMatch.id} (${crmMatch.phone || c.meta.callerNumber})`);
                lines.push(`  🎯 Ziel: ${classification.destination || '?'}`);
                lines.push(`  👤 ${callerLabel}${classification.guestName && classification.guestName !== classification.customerName ? ` für ${classification.guestName}` : ''}`);
                lines.push(`       Anruf von ${c.meta.callerNumber}${crmMatch ? '' : ' (NICHT im CRM)'}`);
                lines.push(`  👥 ${classification.passengers || '?'} Pax`);
                lines.push(`  💳 ${classification.paymentMethod || 'bar'}${crmMatch ? ' (Stammkunde)' : ''}`);
                if (classification.notes) lines.push(`  💬 ${classification.notes.slice(0, 120)}`);
                if (classification.unklarheiten) lines.push(`  ❓ Unklar: ${classification.unklarheiten.slice(0, 100)}`);
                lines.push(``);
                lines.push(`→ 'go' = anlegen / 'go N pax' / 'aendern XYZ'${crmMatch ? '' : ` / 'crm-anlegen ${callerLabel}'`}`);
                bridgePush(lines.join('\n'));
                pushed++;
            } else {
                console.log(`     → KI: kein Buchungs-Push (${classification.art || 'unklar'}: ${classification.kurz || ''})`);
                skipped++;
            }

            state.processed[c.filename] = {
                ts: Date.now(),
                duration: trans.duration,
                classification: {
                    isBookingRequest: classification.isBookingRequest,
                    art: classification.art,
                    confidence: classification.confidence,
                    datum: classification.datum,
                    uhrzeit: classification.uhrzeit,
                    pickup: classification.pickup,
                    destination: classification.destination,
                    passengers: classification.passengers,
                    customerName: classification.customerName,
                    guestName: classification.guestName,
                    notes: classification.notes
                },
                pushedToBridge: classification.isBookingRequest === true
            };
            saveState(state);
            // 🔧 v6.63.495: Anruf-Statistik anhaengen (fuer spaetere Hotspot-Karte)
            try {
                appendCallStat({
                    ts: c.meta.timestamp,
                    direction: c.meta.direction,
                    callerName: c.meta.callerName,
                    callerNumber: c.meta.callerNumber,
                    isBooking: classification.isBookingRequest === true,
                    datum: classification.datum || null,
                    uhrzeit: classification.uhrzeit || null,
                    pickup: classification.pickup || null,
                    destination: classification.destination || null,
                    passengers: classification.passengers || null
                });
            } catch (statErr) { console.warn('Call-Stat-Anhang Fehler:', statErr.message); }
            // Schonzeit damit Anthropic Rate-Limit nicht greift
            await new Promise(r => setTimeout(r, 600));
        } catch (e) {
            console.error(`  ❌ ${c.filename}:`, e.message);
            state.processed[c.filename] = { error: e.message.slice(0, 200), ts: Date.now() };
            saveState(state);
        }
    }

    state.lastRunAt = Date.now();
    saveState(state);
    console.log(`Run fertig. Push: ${pushed} | Skip: ${skipped}`);
    return { pushed, skipped, total: candidates.length };
}

// 🆕 v1.1 (Patrick 24.06. 07:43 "nur due neuesten wenn anruf eingegangen nicht alle 10 minuten"):
// Statt Polling-Loop ein File-Watcher auf den ACR-Ordner. Sobald neue .m4a-Datei kommt,
// 5 Sek Stabilitaets-Wait (OneDrive-Download fertig), dann sofort verarbeiten.
// Plus 5-Min-Safety-Poll als Fallback fuer den Fall dass fs.watch ein Event verpasst.
async function startFileWatch() {
    if (!fs.existsSync(ACR_DIR)) { console.error('ACR-Ordner fehlt:', ACR_DIR); return; }
    console.log(`👁️ FS-Watch auf ${ACR_DIR}`);
    // Initial-Scan beim Start (holt verpasste Files seit letztem Run)
    await scanOnce();
    const debounceTimers = {};
    let watcher;
    try {
        watcher = fs.watch(ACR_DIR, { persistent: true }, (eventType, filename) => {
            if (!filename || !/\.m4a$/i.test(filename)) return;
            console.log(`📡 fs.watch event: ${eventType} ${filename}`);
            // 8 Sek warten damit OneDrive den File komplett gelesen hat
            clearTimeout(debounceTimers[filename]);
            debounceTimers[filename] = setTimeout(async () => {
                delete debounceTimers[filename];
                try {
                    // scanOnce verarbeitet jede neue Datei (nutzt state.processed-Dedup)
                    await scanOnce();
                } catch (e) { console.error('Trigger-Scan-Fehler:', e.message); }
            }, 8000);
        });
        watcher.on('error', e => console.error('fs.watch error:', e.message));
    } catch (e) { console.error('fs.watch konnte nicht starten:', e.message); }
    // Safety-Poll alle 5 Min falls fs.watch ein Event verpasst (OneDrive-Atomic-Writes etc.)
    setInterval(async () => {
        try { await scanOnce(); } catch (e) { console.error('Safety-Poll-Fehler:', e.message); }
    }, 5 * 60 * 1000);
    // Halte Prozess am Leben
    process.stdin.resume();
}

(async () => {
    if (WATCH) {
        await startFileWatch();
    } else {
        await scanOnce();
    }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
