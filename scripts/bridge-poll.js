#!/usr/bin/env node
// 🤖 v6.41.92: Claude-Bridge Live-Polling
// Pollt /claudeBridge/inbox alle 15s. Jede neue UNREAD Nachricht
// wird auf stdout emittiert (eine Zeile = eine Notification via Monitor).
// Doppelter Dedupe: in-memory Set + Firebase read:true Flag.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const POLL_INTERVAL_MS = 30000;  // 🆕 v6.63.239 (Patrick 08.06. 07:25 'Bridge effektiv machen'): 15s → 30s, -50% Polling-Traffic
const INSTANCE = 'taxi-heringsdorf-default-rtdb';
const seenKeys = new Set();

function fbGet(refPath, queryArgs = '') {
    try {
        const out = execSync(
            `firebase database:get --instance ${INSTANCE} "/${refPath}" ${queryArgs}`.trim(),
            // 🆕 v6.62.538: maxBuffer von 1MB→64MB (Default-1MB war Ursache stiller
            // ENOBUFS-Fehler sobald inbox>1MB wuchs → Bridge-Polling lief silent leer)
            { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: ['ignore', 'pipe', 'pipe'], shell: true, maxBuffer: 64 * 1024 * 1024 }
        );
        // 🆕 v6.63.214 (07.06.): FIREBASE_TOKEN-Auth wirft Deprecation-Warning
        // direkt nach stdout — JSON.parse() crasht an ANSI-Codes. Filtern.
        const lines = out.split('\n');
        const jsonStart = lines.findIndex(l => /^\s*[\{\["null]/.test(l.replace(/\x1b\[[0-9;]*m/g, '')));
        const cleaned = jsonStart >= 0 ? lines.slice(jsonStart).join('\n').trim() : out.trim();
        return JSON.parse(cleaned || 'null');
    } catch (e) {
        console.error(`[fbGet ERR] ${refPath}: ${e.message}`);
        return null;
    }
}

function fbUpdate(refPath, dataObj) {
    // Windows-cmd.exe verschluckt single-quotes — daher JSON via Temp-Datei statt -d
    const tmpFile = path.join(os.tmpdir(), `bridge-update-${process.pid}-${Date.now()}.json`);
    try {
        fs.writeFileSync(tmpFile, JSON.stringify(dataObj));
        execSync(
            `firebase database:update --instance ${INSTANCE} -f "/${refPath}" "${tmpFile}"`,
            { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: 'ignore', shell: true }
        );
        return true;
    } catch (e) {
        return false;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
}

function poll() {
    // 🆕 v6.41.92: Heartbeat — claudeBotWebhook erkennt daraus dass Claude online ist.
    fbUpdate('claudeBridge/heartbeat', { ts: Date.now(), pid: process.pid });

    // 1) Telegram-Bridge inbox — 🆕 v6.63.232: limitToLast(50) statt komplette Inbox
    // (Inbox-Read mit 4767 Einträgen zog 1.65 MB pro Poll = 396 MB/h!)
    const root = fbGet('claudeBridge/inbox', '--order-by-key --limit-to-last 50');
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
            fbUpdate(`claudeBridge/inbox/${k}`, { read: true });
        }
    }

    // 🆕 v6.62.419: 2) Email-Bridge inbox (Gmail-Forward via Apps Script)
    const emails = fbGet('emailInbox');
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
            fbUpdate(`emailInbox/${k}`, { read: true });
        }
    }
}

console.log(`▶️ Bridge-Polling gestartet (alle ${POLL_INTERVAL_MS / 1000}s)`);
// Bereits-gelesene Keys beim Start in seenKeys aufnehmen damit wir sie nicht
// als "neu" emittieren. Nur ungelesene werden durchgereicht.
const initial = fbGet('claudeBridge/inbox') || {};
for (const k of Object.keys(initial)) {
    if (initial[k]?.read) seenKeys.add(k);
}
// 🆕 v6.62.419: gleiche Logik für emailInbox
const initialEmails = fbGet('emailInbox') || {};
for (const k of Object.keys(initialEmails)) {
    if (initialEmails[k]?.read) seenKeys.add('email_' + k);
}
poll();
setInterval(poll, POLL_INTERVAL_MS);
