#!/usr/bin/env node
// scan-fritzbox-voicemail.js — pruefe Gmail-Postfach auf FritzBox-AB-Mails.
// Findet AVM-Anrufbeantworter-Mails, extrahiert WAV-Anhang, transkribiert via Whisper,
// KI-Klassifikation, Bridge-Push mit RUECKRUF-LINK (tel:+49xxx).
//
// Aufruf:
//   node scripts/scan-fritzbox-voicemail.js          # Einmal scannen
//   node scripts/scan-fritzbox-voicemail.js --watch  # Loop alle 5 Min

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');

const STATE_FILE = path.join(__dirname, '..', '.fritzbox-voicemail-state.json');
const VOICEMAIL_DIR = 'C:/Users/Taxi/OneDrive/6.Dokumente unsortiert/Anwendungen/FritzBox-AB';
fs.mkdirSync(VOICEMAIL_DIR, { recursive: true });

const WATCH = process.argv.includes('--watch');
const LOOP_MS = 5 * 60 * 1000;

function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { processed: {} }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function getOpenAIKey() {
    try {
        const out = execSync('firebase database:get /settings/openai/apiKey', { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
        return out.trim().replace(/^"|"$/g, '');
    } catch (e) { console.error('OpenAI-Key fehlt'); return null; }
}

async function transcribeFile(filePath, openaiKey) {
    const buf = fs.readFileSync(filePath);
    const boundary = '----formdata-fb-' + Date.now();
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="vm.wav"\r\nContent-Type: audio/wav\r\n\r\n`));
    parts.push(buf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
    });
    if (!r.ok) throw new Error('Whisper-Fehler ' + r.status + ' ' + await r.text());
    const data = await r.json();
    return data.text || '';
}

async function bridgePush(msg) {
    try {
        execSync(`node "${path.join(__dirname, 'bridge-direct-send.js')}" ${JSON.stringify(msg)}`, { stdio: 'pipe' });
    } catch (_) { /* nicht kritisch */ }
}

async function getAnthropicKey() {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    try {
        const out = execSync('firebase database:get /settings/anthropic/apiKey', { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
        return out.trim().replace(/^"|"$/g, '');
    } catch { return null; }
}

async function classifyWithKI(transcript, callerInfo, callDate, anthropicKey) {
    if (!transcript || !transcript.trim() || !anthropicKey) {
        return { isBookingRequest: false, art: 'keine-transkription', kurz: 'Whisper leer oder Anthropic fehlt' };
    }
    const prompt = `Du bist Buchungs-Assistent für Funk-Taxi Heringsdorf (Insel Usedom). Analysiere diese Anrufbeantworter-Nachricht:

ANRUF vom ${callDate}
Von: ${callerInfo}

NACHRICHT:
${transcript}

AUFGABE:
1. Ist das eine Taxi-Buchungsanfrage? (ja/nein/unklar)
2. Wenn ja, JSON:
   { "isBookingRequest": true, "confidence": "hoch|mittel|niedrig",
     "datum": "YYYY-MM-DD oder 'morgen' etc", "uhrzeit": "HH:MM oder 'sofort'",
     "pickup": "Abholort", "destination": "Zielort", "passengers": Zahl|null,
     "customerName": "Anrufer", "guestName": "Fahrgast (falls anders)",
     "phone": "Telefonnummer falls genannt", "paymentMethod": "bar/rechnung|null",
     "notes": "Zusatzinfo", "needsCallback": true/false,
     "unklarheiten": "was unklar ist" }
3. Nein/unklar: { "isBookingRequest": false, "art": "spam/werbung/privat/fahrer/sonstiges", "kurz": "1-Satz" }
Antworte NUR JSON, kein Markdown.`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) throw new Error('Anthropic-Fehler ' + r.status);
    const data = await r.json();
    const text = data.content?.[0]?.text || '{}';
    const m = text.match(/\{[\s\S]*\}/);
    try { return JSON.parse(m ? m[0] : text); } catch { return { isBookingRequest: false, art: 'parse-fehler', kurz: text.slice(0, 200) }; }
}

function normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/[^\d+]/g, '');
    if (!digits) return null;
    // 0... → +49...
    if (digits.startsWith('00')) return '+' + digits.slice(2);
    if (digits.startsWith('0')) return '+49' + digits.slice(1);
    if (digits.startsWith('+')) return digits;
    return '+' + digits;
}

async function scanOnce() {
    const state = loadState();
    const openaiKey = await getOpenAIKey();
    if (!openaiKey) { console.error('OpenAI-Key fehlt'); return; }
    const anthropicKey = await getAnthropicKey();
    const gmailPass = process.env.GMAIL_PASS;
    if (!gmailPass) { console.error('GMAIL_PASS fehlt'); return; }

    // 🔧 v1.1 (Patrick 24.06. 08:00): Gmail statt GMX als Empfangs-Postfach
    const imap = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: 'taxiwydra@googlemail.com', pass: gmailPass }, logger: false
    });
    await imap.connect();
    await imap.mailboxOpen('INBOX');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const uids = await imap.search({ since });
    console.log(`[${new Date().toLocaleTimeString('de-DE')}] ${uids.length} Mails letzte 24h gescannt (Gmail)`);
    let found = 0, skipped = 0;
    for (const uid of uids) {
        if (state.processed[uid]) continue;
        const m = await imap.fetchOne(uid, { envelope: true });
        if (!m?.envelope) continue;
        const fromAddr = (m.envelope.from?.[0]?.address || '').toLowerCase();
        const subject = m.envelope.subject || '';
        const isFB = fromAddr.includes('avm') || fromAddr.includes('fritz') ||
                     subject.toLowerCase().includes('anrufbeantworter') ||
                     subject.toLowerCase().includes('sprachnachricht') ||
                     subject.toLowerCase().includes('voicemail') ||
                     subject.toLowerCase().includes('fritz!box');
        if (!isFB) { state.processed[uid] = { skip: true, ts: Date.now() }; continue; }
        const full = await imap.fetchOne(uid, { source: true });
        const p = await simpleParser(full.source);
        const wav = (p.attachments || []).find(a => /\.(wav|mp3|m4a|ogg)$/i.test(a.filename || ''));
        if (!wav) { state.processed[uid] = { noWav: true, ts: Date.now() }; skipped++; continue; }
        const fname = (wav.filename || `fb-${uid}.wav`).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const dest = path.join(VOICEMAIL_DIR, `${new Date(m.envelope.date || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-')}_${fname}`);
        fs.writeFileSync(dest, wav.content);
        console.log(`📥 ${path.basename(dest)} (${Math.round(wav.size / 1024)} KB)`);

        let transData = { text: '' };
        try { transData = await transcribeFile(dest, openaiKey); } catch (e) { console.error('  Whisper-Fehler:', e.message); }
        const transcript = transData.text || '';

        // Anrufer-Nummer aus Subject/Body extrahieren (FritzBox-typisch: 'Anruf von 015...')
        const subjectPhone = subject.match(/(?:von|from)\s*[:]?\s*([\+\d\s\(\)\/-]{6,})/i)?.[1];
        const bodyPhone = (p.text || '').match(/(?:Anrufer|Nummer|Rufnummer|Caller)[:\s]+([\+\d\s\(\)\/-]{6,})/i)?.[1];
        const callerRaw = subjectPhone || bodyPhone || '?';
        const callerNorm = normalizePhone(callerRaw);
        const date = m.envelope.date ? new Date(m.envelope.date).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : '?';

        // KI-Klassifikation
        const classification = await classifyWithKI(transcript, callerRaw, date, anthropicKey).catch(e => ({ isBookingRequest: false, art: 'ki-fehler', kurz: e.message }));

        // Bridge-Push mit RUECKRUF-LINK
        const lines = [`📞 FRITZBOX-AB ${date}`];
        lines.push(`Anrufer: ${callerRaw}`);
        if (callerNorm) lines.push(`📲 RUECKRUF: tel:${callerNorm}`);
        lines.push('');
        if (classification.isBookingRequest) {
            lines.push(`✅ KI: BUCHUNG ERKANNT (Konfidenz ${classification.confidence || 'mittel'})`);
            lines.push(`🚖 ${classification.datum || '?'} ${classification.uhrzeit || '?'}`);
            lines.push(`${classification.pickup || '?'} → ${classification.destination || '?'}`);
            lines.push(`${classification.passengers || '?'} Personen · ${classification.paymentMethod || 'bar?'}`);
            if (classification.notes) lines.push(`Notiz: ${classification.notes}`);
            if (classification.unklarheiten) lines.push(`⚠️ Unklar: ${classification.unklarheiten}`);
            lines.push('');
            lines.push(`Antworte 'ja fb-${uid}' = anlegen / 'rueckruf' = anrufen / 'nein' = ignorieren`);
        } else {
            lines.push(`⏭️ KI: kein Buchung (${classification.art || '?'}: ${classification.kurz || ''})`);
            lines.push(`Rueckruf trotzdem? Tippe 'rueckruf fb-${uid}'`);
        }
        lines.push('');
        lines.push(`Transkript:`);
        lines.push(transcript.slice(0, 600) || '(leer)');
        bridgePush(lines.join('\n'));

        state.processed[uid] = {
            ts: Date.now(),
            file: path.basename(dest),
            callerRaw, callerNorm,
            transcript: transcript.slice(0, 500),
            classification: { isBookingRequest: classification.isBookingRequest, art: classification.art, datum: classification.datum, uhrzeit: classification.uhrzeit, pickup: classification.pickup, destination: classification.destination },
            pushed: true
        };
        saveState(state);
        found++;
        await new Promise(r => setTimeout(r, 400));
    }
    await imap.logout();
    saveState(state);
    console.log(`Run fertig. Neue Voicemails: ${found} | skipped: ${skipped}`);
}

(async () => {
    if (WATCH) {
        console.log(`🔁 Watch-Mode: alle ${LOOP_MS / 1000}s scannen`);
        while (true) {
            try { await scanOnce(); } catch (e) { console.error('Scan-Fehler:', e.message); }
            await new Promise(r => setTimeout(r, LOOP_MS));
        }
    } else {
        await scanOnce();
    }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
