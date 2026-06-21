#!/usr/bin/env node
// 🤖 v6.41.92: Claude-Bridge Live-Polling
// Pollt /claudeBridge/inbox alle 30s. Jede neue UNREAD Nachricht
// wird auf stdout emittiert (eine Zeile = eine Notification via Monitor).
// Doppelter Dedupe: in-memory Set + Firebase read:true Flag.
//
// 🆕 v6.63.249 (Patrick 09.06.): Komplett auf REST + gcloud-Token umgebaut.
// Vorher: `firebase database:get` CLI → silent fail wenn CLI nicht eingeloggt
// (Fehler auf stderr, stdout leer → Monitor bekam KEINE Notifications obwohl
// Patrick Nachrichten schickte). Jetzt: HTTPS direkt mit `gcloud auth
// print-access-token`, robust und ohne Firebase-CLI-Abhängigkeit.

const { execSync } = require('child_process');
const https = require('https');

// v6.63.462 (Patrick 21.06. 18:32 Bridge Profile-Auswertung): 30s → 60s + limitToLast 50→20
//   → /claudeBridge/inbox lag bei ~4,3 MB/h Download. Halbierte Polling-Frequenz und 60% kleinerer
//   Slice → -75 % auf diesem Pfad. Latency-Toleranz Patrick→Claude ist 60s OK.
const POLL_INTERVAL_MS = 60000;
const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
const seenKeys = new Set();

// Token-Cache: gcloud-Tokens halten ~60 Min. Wir refreshen alle 50 Min.
let cachedToken = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000;

function getToken() {
    if (cachedToken && (Date.now() - tokenFetchedAt) < TOKEN_TTL_MS) return cachedToken;
    try {
        cachedToken = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
        tokenFetchedAt = Date.now();
        return cachedToken;
    } catch (e) {
        console.error(`[token ERR] gcloud auth print-access-token: ${e.message}`);
        return null;
    }
}

function httpsRequest(method, path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        if (!token) return reject(new Error('no gcloud token'));
        const sep = path.includes('?') ? '&' : '?';
        const fullPath = path + sep + 'access_token=' + token;
        const opts = {
            hostname: RTDB_HOST,
            path: fullPath,
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(data || 'null')); }
                    catch (e) { reject(new Error('JSON parse: ' + data.slice(0, 200))); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function fbGet(refPath, queryStr = '') {
    const path = '/' + refPath + '.json' + (queryStr ? '?' + queryStr : '');
    try {
        return await httpsRequest('GET', path, null);
    } catch (e) {
        console.error(`[fbGet ERR] ${refPath}: ${e.message}`);
        return null;
    }
}

async function fbUpdate(refPath, dataObj) {
    const path = '/' + refPath + '.json';
    try {
        await httpsRequest('PATCH', path, JSON.stringify(dataObj));
        return true;
    } catch (e) {
        console.error(`[fbUpdate ERR] ${refPath}: ${e.message}`);
        return false;
    }
}

async function poll() {
    // Heartbeat (v6.41.92): claudeBotWebhook erkennt daraus dass Claude online ist.
    fbUpdate('claudeBridge/heartbeat', { ts: Date.now(), pid: process.pid });

    // 1) Telegram-Bridge inbox — v6.63.462: limitToLast(20) statt 50 (Profile-Auswertung 21.06.)
    // v6.63.232: limitToLast(50) statt komplette Inbox (Inbox-Read mit 4767 Einträgen zog 1.65 MB pro Poll)
    const root = await fbGet('claudeBridge/inbox', 'orderBy=%22%24key%22&limitToLast=20');
    if (root) {
        const keys = Object.keys(root).filter(k => root[k] && !root[k].read && !seenKeys.has(k)).sort();
        for (const k of keys) {
            seenKeys.add(k);
            const v = root[k];
            const time = new Date(v.ts || Number(k)).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const from = v.fromName || 'admin';
            const src = (v.source || '').startsWith('claudeBot') ? '🤖' : '📱';
            const limit = (v.source || '').includes('photo') ? 2000 : (v.source || '').includes('voice') ? 1000 : 500;
            const msg = (v.message || '').replace(/\n/g, ' ↵ ').slice(0, limit);
            console.log(`${src} [${time}] ${from} (#${k}): ${msg}`);
            await fbUpdate(`claudeBridge/inbox/${k}`, { read: true });
        }
    }

    // 2) Email-Bridge inbox (Gmail-Forward via Apps Script) — v6.62.419
    const emails = await fbGet('emailInbox');
    if (emails) {
        const ekeys = Object.keys(emails).filter(k => emails[k] && !emails[k].read && !seenKeys.has('email_' + k)).sort();
        for (const k of ekeys) {
            seenKeys.add('email_' + k);
            const e = emails[k];
            const time = new Date(e.ts || 0).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const from = (e.from || '?').replace(/<[^>]+>/g, '').trim().substring(0, 40);
            const subject = (e.subject || '(kein Betreff)').substring(0, 80);
            const bodyPreview = (e.body || '').replace(/\n+/g, ' ↵ ').replace(/\s+/g, ' ').substring(0, 800);
            const attCount = e.attachmentCount || 0;
            const attHint = attCount > 0 ? ` 📎 ${attCount}` : '';
            console.log(`📧 [${time}] ${from} (#email_${k}): ${subject}${attHint} — ${bodyPreview}`);
            await fbUpdate(`emailInbox/${k}`, { read: true });
        }
    }
}

(async () => {
    console.log(`▶️ Bridge-Polling gestartet (alle ${POLL_INTERVAL_MS / 1000}s, v6.63.249 REST+gcloud)`);
    // Bereits-gelesene Keys beim Start in seenKeys aufnehmen damit wir sie nicht
    // als "neu" emittieren. Nur ungelesene werden durchgereicht.
    const initial = await fbGet('claudeBridge/inbox', 'orderBy=%22%24key%22&limitToLast=200') || {};
    for (const k of Object.keys(initial)) {
        if (initial[k]?.read) seenKeys.add(k);
    }
    const initialEmails = await fbGet('emailInbox') || {};
    for (const k of Object.keys(initialEmails)) {
        if (initialEmails[k]?.read) seenKeys.add('email_' + k);
    }
    await poll();
    setInterval(() => { poll().catch(e => console.error('[poll ERR]', e.message)); }, POLL_INTERVAL_MS);
})();
