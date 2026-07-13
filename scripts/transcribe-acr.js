#!/usr/bin/env node
// transcribe-acr.js — Transkribiert eine ACR-m4a-Datei via OpenAI Whisper.
// Aufruf: node scripts/transcribe-acr.js "<pfad-zur-m4a-datei>"

const fs = require('fs');
const path = require('path');

const FILE = process.argv[2];
if (!FILE || !fs.existsSync(FILE)) {
    console.error('Datei nicht gefunden:', FILE);
    process.exit(1);
}

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) { console.error('OPENAI_API_KEY fehlt — bitte als ENV oder via Firebase /settings/openai/apiKey'); process.exit(1); }

(async () => {
    const buf = fs.readFileSync(FILE);
    const boundary = '----formdata-claude-' + Date.now();
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.m4a"\r\nContent-Type: audio/mp4\r\n\r\n`));
    parts.push(buf);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);
    console.log('Sende', Math.round(body.length/1024), 'KB an OpenAI Whisper ...');
    const t0 = Date.now();
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
    });
    if (!r.ok) { console.error('Fehler:', r.status, await r.text()); process.exit(1); }
    const data = await r.json();
    console.log('Dauer:', ((Date.now()-t0)/1000).toFixed(1), 's');
    console.log('Sprache:', data.language, '| Audio-Dauer:', data.duration?.toFixed(1), 's');
    console.log('\n--- TRANSKRIPT ---\n');
    console.log(data.text);
    console.log('\n--- ENDE ---\n');
    // Speichere als JSON neben dem m4a
    const out = FILE.replace(/\.m4a$/i, '.transcript.json');
    fs.writeFileSync(out, JSON.stringify(data, null, 2));
    console.log('Gespeichert:', out);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
