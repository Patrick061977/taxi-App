#!/usr/bin/env node
// 🤖 v6.41.92: Claude-Bridge Live-Polling
// Pollt /claudeBridge/inbox alle 15s. Jede neue UNREAD Nachricht
// wird auf stdout emittiert (eine Zeile = eine Notification via Monitor).
// Doppelter Dedupe: in-memory Set + Firebase read:true Flag.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const POLL_INTERVAL_MS = 15000;
const INSTANCE = 'taxi-heringsdorf-default-rtdb';
const seenKeys = new Set();

function fbGet(refPath) {
    try {
        const out = execSync(
            `firebase database:get --instance ${INSTANCE} "/${refPath}"`,
            { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, stdio: ['ignore', 'pipe', 'ignore'], shell: true }
        );
        return JSON.parse(out.trim() || 'null');
    } catch (e) {
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
    // Wenn Heartbeat älter als 60s → Webhook antwortet 'offline, Notiz gespeichert' statt
    // normaler Bestätigung.
    fbUpdate('claudeBridge/heartbeat', { ts: Date.now(), pid: process.pid });
    const root = fbGet('claudeBridge/inbox');
    if (!root) return;
    const keys = Object.keys(root).filter(k => root[k] && !root[k].read && !seenKeys.has(k)).sort();
    for (const k of keys) {
        seenKeys.add(k);
        const v = root[k];
        const time = new Date(v.ts || Number(k)).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const from = v.fromName || 'admin';
        const src = v.source === 'claudeBot' ? '🤖' : '📱';
        const msg = (v.message || '').replace(/\n/g, ' ↵ ').slice(0, 500);
        console.log(`${src} [${time}] ${from} (#${k}): ${msg}`);
        // Best-effort als read markieren — wenn's failt, schützt das Set davor dass wir
        // dieselbe Nachricht doppelt emittieren in dieser Session.
        fbUpdate(`claudeBridge/inbox/${k}`, { read: true });
    }
}

console.log(`▶️ Bridge-Polling gestartet (alle ${POLL_INTERVAL_MS / 1000}s)`);
// Bereits-gelesene Keys beim Start in seenKeys aufnehmen damit wir sie nicht
// als "neu" emittieren. Nur ungelesene werden durchgereicht.
const initial = fbGet('claudeBridge/inbox') || {};
for (const k of Object.keys(initial)) {
    if (initial[k]?.read) seenKeys.add(k);
}
poll();
setInterval(poll, POLL_INTERVAL_MS);
