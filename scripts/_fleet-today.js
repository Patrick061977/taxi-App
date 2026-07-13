#!/usr/bin/env node
// Analyse heutiger Fahrtenplan + Fahrzeug-Auslastung
const { execSync } = require('child_process');
const https = require('https');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }
function get(path) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method: 'GET' };
        const r = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d || 'null')); } catch(e) { resolve(null); } }); });
        r.on('error', reject); r.end();
    });
}

function berlinHHMM(ts) {
    return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
}

(async () => {
    const now = new Date();
    const todayBerlin = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const todayStart = new Date(todayBerlin + 'T00:00:00+02:00').getTime();
    const todayEnd = todayStart + 86400000;

    // Lade heutige Rides
    const rides = await get('/rides.json?shallow=false');
    if (!rides) { console.log('keine rides'); return; }

    const todayRides = Object.entries(rides)
        .filter(([k, r]) => r && r.pickupTimestamp >= todayStart && r.pickupTimestamp < todayEnd)
        .map(([k, r]) => ({ ...r, _key: k }))
        .filter(r => r.status !== 'cancelled' && r.status !== 'rejected' && r.status !== 'deleted')
        .sort((a, b) => a.pickupTimestamp - b.pickupTimestamp);

    console.log(`\n=== Heute ${todayBerlin}: ${todayRides.length} Fahrten ===\n`);

    // Pro Fahrzeug gruppieren
    const byVehicle = {};
    const unassigned = [];
    for (const r of todayRides) {
        const v = r.assignedVehicle || r.vehicleId || null;
        if (!v) { unassigned.push(r); continue; }
        if (!byVehicle[v]) byVehicle[v] = [];
        byVehicle[v].push(r);
    }

    const vehicles = Object.keys(byVehicle).sort();
    console.log(`Fahrzeuge im Einsatz heute: ${vehicles.length}`);
    if (unassigned.length) console.log(`Nicht zugewiesen: ${unassigned.length}`);

    for (const vid of vehicles) {
        const list = byVehicle[vid];
        console.log(`\n📍 ${vid} (${list.length} Fahrten):`);
        for (const r of list) {
            const t = berlinHHMM(r.pickupTimestamp);
            const from = (r.pickup || '?').substring(0, 30);
            const to = (r.destination || '?').substring(0, 30);
            const status = r.status === 'completed' ? '✅' : r.status === 'accepted' ? '🔵' : r.status === 'on_way' ? '🚗' : r.status === 'new' ? '⏳' : '?';
            const pax = r.passengerCount || r.passengers || 1;
            console.log(`  ${status} ${t} ${from} → ${to} (${pax}P)`);
        }
    }

    if (unassigned.length) {
        console.log('\n⚠️ OHNE FAHRZEUG:');
        for (const r of unassigned) {
            const t = berlinHHMM(r.pickupTimestamp);
            console.log(`  ⏳ ${t} ${(r.pickup||'').substring(0,30)} → ${(r.destination||'').substring(0,30)}`);
        }
    }

    // Engpass-Analyse: pro Stunde wie viele Fahrten
    console.log('\n=== STUNDEN-VERTEILUNG ===');
    const hourBuckets = {};
    for (const r of todayRides) {
        const h = new Date(r.pickupTimestamp).toLocaleString('de-DE', { hour: '2-digit', timeZone: 'Europe/Berlin' }).replace(' Uhr','');
        hourBuckets[h] = (hourBuckets[h] || 0) + 1;
    }
    for (const h of Object.keys(hourBuckets).sort()) {
        const n = hourBuckets[h];
        const bar = '█'.repeat(n);
        const peak = n >= 3 ? ' ⚡ ENGPASS' : '';
        console.log(`  ${h}:xx → ${bar} (${n})${peak}`);
    }

    // Fahrzeuge im Schichtplan heute
    const shifts = await get('/vehicleShifts.json');
    console.log('\n=== SCHICHTPLAN HEUTE (SA) ===');
    const dow = now.toLocaleString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' });
    const dowIdx = now.getDay(); // 0=So,1=Mo,...,6=Sa
    if (shifts) {
        for (const [vid, s] of Object.entries(shifts)) {
            if (!s || !s.defaults) continue;
            const hasShift = s.defaults[dowIdx] === true;
            if (!hasShift) continue;
            const dt = s.defaultTimes && s.defaultTimes[String(dowIdx)];
            const times = dt ? `${dt.startTime}-${dt.endTime}` : 'keine Zeiten';
            const inRides = byVehicle[vid] ? byVehicle[vid].length : 0;
            console.log(`  ✅ ${vid}: ${times} (${inRides} Fahrten)`);
        }
    }
})().catch(e => console.error('ERROR:', e.message));
