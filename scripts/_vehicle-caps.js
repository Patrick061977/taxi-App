#!/usr/bin/env node
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
(async () => {
    const vehicles = await get('/vehicles.json');
    if (!vehicles) { console.log('keine vehicles'); return; }
    console.log('--- Fahrzeug-Kapazitäten ---');
    Object.entries(vehicles).forEach(([vid, vd]) => {
        if (!vd) return;
        console.log(vid, '| seats:', vd.seats, '| capacity:', vd.capacity, '| name:', vd.name, '| make:', vd.make, '| model:', vd.model);
    });

    // Check capacity field
    console.log('\n--- Rides mit pax > 4 und vehicleId gesetzt ---');
    const rides = await get('/rides.json');
    if (!rides) return;
    Object.entries(rides).forEach(([k,v]) => {
        if (!v || !v.passengers || v.passengers <= 4) return;
        const vid = v.assignedVehicle || v.vehicleId || '';
        if (!vid || vid === 'undefined') return;
        const vd = vehicles[vid];
        const cap = vd ? (vd.capacity || vd.seats || '?') : '?';
        if (cap !== '?' && v.passengers > parseInt(cap)) {
            console.log('⚠️ KAPAZITÄTS-VERLETZUNG:', k, v.customerName, 'pax:', v.passengers, '>', 'cap:', cap, 'vehicle:', vid, 'status:', v.status, new Date(v.pickupTimestamp).toLocaleString('de-DE',{timeZone:'Europe/Berlin'}));
        } else {
            console.log('OK', k, v.customerName, 'pax:', v.passengers, 'cap:', cap, 'vehicle:', vid, 'status:', v.status);
        }
    });
})().catch(e => console.error('ERROR:', e.message));
