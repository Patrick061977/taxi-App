#!/usr/bin/env node
// onedrive-acr-stats.js — Patrick (11.06.2026 11:38):
// Wertet die ACR-Dateien aus dem OneDrive-Ordner aus + schreibt JSON
// fuer anrufstatistik.html. Plus Lost-Calls-Erkennung gegen /rides.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ONEDRIVE = 'C:/Users/Taxi/OneDrive/6.Dokumente unsortiert/Anwendungen/ACRPhone Cloud Uploads/Acr';
const OUT = 'C:/Taxi App/taxi-App-github/public/data/anrufstatistik.json';

if (!fs.existsSync(ONEDRIVE)) {
    console.error('ACR-OneDrive-Ordner nicht gefunden:', ONEDRIVE);
    process.exit(1);
}

const TOKEN = execSync('gcloud auth print-access-token', {encoding:'utf8'}).trim();
function rtdb(path) {
    const url = `https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app${path}?access_token=${TOKEN}`;
    return JSON.parse(execSync(`curl -s "${url}"`, {encoding:'utf8', maxBuffer: 100*1024*1024}) || 'null');
}

// 1. Parse ACR-Dateien
console.log('🔍 Lese ACR-Ordner...');
const files = fs.readdirSync(ONEDRIVE);
console.log('  Gesamt:', files.length);

const re = /^(.*?) \(([+\d]+)\) \[(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})\] \[(Eingehend|Ausgehend)\]/;
const calls = [];
files.forEach(f => {
    const m = f.match(re);
    if (!m) return;
    const ts = new Date(`${m[3]}-${m[4]}-${m[5]}T${m[6]}:${m[7]}:${m[8]}`).getTime();
    calls.push({
        name: m[1].trim(),
        phone: m[2],
        ts,
        direction: m[9] === 'Eingehend' ? 'in' : 'out'
    });
});
calls.sort((a, b) => b.ts - a.ts);
console.log('  Parsed:', calls.length);

// 2. Tages-Statistik (letzte 90 Tage)
const now = Date.now();
const cutoff = now - 90 * 24 * 60 * 60 * 1000;
const recentCalls = calls.filter(c => c.ts >= cutoff);

const byDay = {};
const byHour = Array(24).fill(0).map(() => ({ in: 0, out: 0 }));
const byWeekday = Array(7).fill(0).map(() => ({ in: 0, out: 0 }));
const dayLabels = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

recentCalls.forEach(c => {
    const dt = new Date(c.ts);
    const dayStr = dt.toISOString().substring(0, 10);
    if (!byDay[dayStr]) byDay[dayStr] = { in: 0, out: 0 };
    byDay[dayStr][c.direction]++;
    byHour[dt.getHours()][c.direction]++;
    byWeekday[dt.getDay()][c.direction]++;
});

// 3. Lost-Calls vs. Rides
console.log('🔍 Lade Rides letzte 7 Tage fuer Lost-Call-Match...');
const ridesData = rtdb('/rides.json') || {};
const ridesByPhone = {};
Object.values(ridesData).forEach(r => {
    if (!r || !r.customerPhone) return;
    const ph = r.customerPhone.replace(/[\s\-()]/g, '');
    if (!ridesByPhone[ph]) ridesByPhone[ph] = [];
    ridesByPhone[ph].push({
        ts: r.createdAt || r.pickupTimestamp,
        status: r.status,
        id: r.firebaseId
    });
});

let lostInLast7Days = 0;
const sevenDays = now - 7 * 24 * 60 * 60 * 1000;
const incomingLast7 = recentCalls.filter(c => c.direction === 'in' && c.ts >= sevenDays);
incomingLast7.forEach(c => {
    const ph = c.phone.replace(/[\s\-()]/g, '');
    const rides = ridesByPhone[ph] || [];
    const hasFollowupRide = rides.some(r => {
        return r.ts && r.ts >= c.ts && (r.ts - c.ts) <= 30 * 60 * 1000;
    });
    if (!hasFollowupRide) lostInLast7Days++;
});

// 4. Letzte 30 Eintraege fuer Live-Anzeige
const recent30 = calls.slice(0, 30).map(c => ({
    ts: c.ts,
    tsStr: new Date(c.ts).toLocaleString('de-DE'),
    name: c.name,
    phone: c.phone,
    direction: c.direction
}));

// 5. Output
const result = {
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    parsedCalls: calls.length,
    earliestCall: calls.length ? new Date(calls[calls.length-1].ts).toISOString() : null,
    latestCall: calls.length ? new Date(calls[0].ts).toISOString() : null,
    last90DaysCount: recentCalls.length,
    incoming90d: recentCalls.filter(c => c.direction === 'in').length,
    outgoing90d: recentCalls.filter(c => c.direction === 'out').length,
    lostInLast7Days,
    incomingLast7: incomingLast7.length,
    byDay: Object.fromEntries(Object.entries(byDay).sort()),
    byHour,
    byWeekday: byWeekday.map((v, i) => ({ day: dayLabels[i], ...v })),
    recent30
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log('\n✅ JSON geschrieben:', OUT);
console.log('   90d:', recentCalls.length, 'Anrufe |', lostInLast7Days, 'verlorene (7d)');
