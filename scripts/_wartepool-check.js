#!/usr/bin/env node
// Wartepool-Check: welche Fahrten warten + "999 min zu spät" Kandidaten
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
function dt(ts) { return ts ? new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : 'null'; }

(async () => {
    const rides = await get('/rides.json');
    if (!rides) { console.log('keine rides'); return; }

    const now = Date.now();
    const wartepool = [];
    const overdue = [];

    for (const [k, r] of Object.entries(rides)) {
        if (!r || r.status === 'cancelled' || r.status === 'rejected' || r.status === 'deleted' || r.status === 'completed') continue;
        if (r.wartepoolActive || r.inWartepool || r.status === 'wartepool') {
            wartepool.push({ k, r });
        }
        // 999 min zu spät = pickupTimestamp > 16.5h in der Vergangenheit
        if (r.pickupTimestamp && r.pickupTimestamp < now - 60 * 60 * 1000) {
            const minsLate = Math.floor((now - r.pickupTimestamp) / 60000);
            if (minsLate > 30) overdue.push({ k, r, minsLate });
        }
    }

    console.log('=== WARTEPOOL ===');
    if (wartepool.length === 0) {
        // Check auch wartepoolRides node
        const wp = await get('/wartepoolRides.json');
        if (wp) {
            for (const [k, v] of Object.entries(wp)) {
                if (v) console.log('  WP-Key:', k, '|', (v.customerName||v.name||'?'), '|', dt(v.pickupTimestamp));
            }
        } else {
            console.log('  Keine wartepoolRides-Node');
        }
    }
    for (const { k, r } of wartepool) {
        console.log('  ', k, '|', r.customerName, '|', dt(r.pickupTimestamp), '|', r.status, '|', r.pickup, '→', r.destination);
    }

    console.log('\n=== ÜBERFÄLLIG (>30 Min) ===');
    overdue.sort((a, b) => b.minsLate - a.minsLate);
    for (const { k, r, minsLate } of overdue.slice(0, 10)) {
        const v = r.assignedVehicle || 'kein Fzg';
        console.log(`  ${minsLate}min | ${k} | ${r.status} | ${v} | ${r.customerName} | ${dt(r.pickupTimestamp)}`);
    }

    console.log('\n=== ALLE AKTIVEN RIDES HEUTE ===');
    const todayStart = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) + 'T00:00:00+02:00').getTime();
    const todayRides = Object.entries(rides)
        .filter(([k, r]) => r && r.pickupTimestamp >= todayStart && r.status !== 'cancelled' && r.status !== 'completed' && r.status !== 'deleted')
        .sort((a, b) => a[1].pickupTimestamp - b[1].pickupTimestamp);
    for (const [k, r] of todayRides) {
        const t = new Date(r.pickupTimestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
        const v = r.assignedVehicle || '?';
        console.log(`  ${t} | ${r.status} | ${v} | ${r.customerName} | ${(r.pickup||'').substring(0,25)} → ${(r.destination||'').substring(0,25)}`);
    }
})().catch(e => console.error('ERROR:', e.message));
