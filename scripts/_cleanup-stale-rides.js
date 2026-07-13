#!/usr/bin/env node
// Räumt veraltete Rides auf:
// - status=undefined/null + >48h alt → storniert
// - status=wartepool + >24h alt + kein Fahrzeug → storniert
// - status=assigned + ovp-Fahrzeug + >7 Tage alt → completed (Vetter-Busse)
const { execSync } = require('child_process');
const https = require('https');
const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }
function get(path) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method: 'GET' };
        const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d||'null'));}catch(e){resolve(null);} }); });
        r.on('error', reject); r.end();
    });
}
function patch(path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const bodyStr = JSON.stringify(body);
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method: 'PATCH', headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(bodyStr)} };
        const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
        r.on('error', reject); r.write(bodyStr); r.end();
    });
}
function dt(ts) { return ts ? new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : 'null'; }

(async () => {
    const rides = await get('/rides.json');
    if (!rides) { console.log('keine rides'); return; }
    const now = Date.now();
    const H48 = 48 * 60 * 60 * 1000;
    const H24 = 24 * 60 * 60 * 1000;
    const D7 = 7 * 24 * 60 * 60 * 1000;

    let cancelled = 0, completed = 0, skipped = 0;

    for (const [k, r] of Object.entries(rides)) {
        if (!r || !r.pickupTimestamp) continue;
        const age = now - r.pickupTimestamp;
        const status = r.status || 'undefined';
        const vehicle = r.assignedVehicle || r.vehicleId || '';

        // Bereits abgeschlossen/storniert → überspringen
        if (['completed', 'cancelled', 'storniert', 'rejected', 'deleted'].includes(status)) continue;

        // Undefined/null status + >48h alt → storniert
        if (!r.status && age > H48) {
            console.log(`  STORNIERE (undefined, ${Math.round(age/3600000)}h alt): ${k} | ${r.customerName} | ${dt(r.pickupTimestamp)}`);
            await patch(`/rides/${k}.json`, { status: 'cancelled', cancelledAt: now, cancelReason: 'Auto-Cleanup: kein Status + >48h', updatedAt: now });
            cancelled++;
            continue;
        }

        // Wartepool + >24h alt + kein Fahrzeug → storniert
        if ((status === 'wartepool' || r.wartepoolActive) && age > H24 && !vehicle) {
            console.log(`  STORNIERE (wartepool, ${Math.round(age/3600000)}h, kein Fzg): ${k} | ${r.customerName} | ${dt(r.pickupTimestamp)}`);
            await patch(`/rides/${k}.json`, { status: 'cancelled', cancelledAt: now, cancelReason: 'Auto-Cleanup: Wartepool >24h ohne Fahrzeug', updatedAt: now, wartepoolActive: null });
            cancelled++;
            continue;
        }

        // OVP-Bus-Fahrten (Vetter) assigned + >7 Tage → completed
        if (status === 'assigned' && vehicle.startsWith('ovp-') && age > D7) {
            console.log(`  COMPLETED (OVP-Bus, ${Math.round(age/3600000)}h): ${k} | ${r.customerName} | ${dt(r.pickupTimestamp)}`);
            await patch(`/rides/${k}.json`, { status: 'completed', completedAt: r.pickupTimestamp + 3600000, updatedAt: now });
            completed++;
            continue;
        }

        // Assigned + kein Fahrzeug + >48h → storniert
        if (status === 'assigned' && !vehicle && age > H48) {
            console.log(`  STORNIERE (assigned, kein Fzg, ${Math.round(age/3600000)}h): ${k} | ${r.customerName} | ${dt(r.pickupTimestamp)}`);
            await patch(`/rides/${k}.json`, { status: 'cancelled', cancelledAt: now, cancelReason: 'Auto-Cleanup: assigned ohne Fahrzeug >48h', updatedAt: now });
            cancelled++;
            continue;
        }

        // Uhlmann Juli 1 assigned pw-ik-222 → überspringen (war möglicherweise eine echte Fahrt, Patrick soll entscheiden)
        if (age > H48 && status === 'assigned' && vehicle && !vehicle.startsWith('ovp-')) {
            console.log(`  SKIP (assigned mit Fzg, ${Math.round(age/3600000)}h): ${k} | ${r.customerName} | ${vehicle} | ${dt(r.pickupTimestamp)}`);
            skipped++;
        }
    }

    console.log(`\nErgebnis: ${cancelled} storniert, ${completed} abgeschlossen, ${skipped} übersprungen`);
})().catch(e => console.error('ERROR:', e.message));
