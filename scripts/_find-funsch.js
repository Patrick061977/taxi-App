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
    const rides = await get('/rides.json');
    if (!rides) { console.log('keine rides'); return; }
    const vehicles = await get('/vehicles.json');

    const found = Object.entries(rides).filter(([k, v]) =>
        v && v.customerName && v.customerName.toLowerCase().includes('funsch')
    );

    if (found.length === 0) {
        console.log('Keine Funsch-Fahrten gefunden. Suche in letzten 50 Rides...');
        const all = Object.entries(rides);
        const recent = all.sort((a,b)=> (b[1].pickupTimestamp||0)-(a[1].pickupTimestamp||0)).slice(0,50);
        recent.forEach(([k,v])=>{
            console.log(k, v.customerName, 'pax:', v.passengers, 'vehicle:', v.assignedVehicle||v.vehicleId, 'status:', v.status, new Date(v.pickupTimestamp).toLocaleString('de-DE',{timeZone:'Europe/Berlin'}));
        });
        return;
    }

    for (const [k, v] of found) {
        const vid = v.assignedVehicle || v.vehicleId || '';
        const vData = vid && vehicles && vehicles[vid] ? vehicles[vid] : null;
        const vCap = vData ? (vData.capacity || vData.seats || '?') : '?';
        console.log('--- Funsch Ride:', k);
        console.log('  Name:', v.customerName);
        console.log('  Passagiere:', v.passengers);
        console.log('  Fahrzeug:', vid, '| Kapazität:', vCap);
        console.log('  Status:', v.status);
        console.log('  assignedBy:', v.assignedBy);
        console.log('  Pickup:', new Date(v.pickupTimestamp).toLocaleString('de-DE',{timeZone:'Europe/Berlin'}));
        console.log('  Pickup-Ort:', v.pickup);
        console.log('  Ziel:', v.destination);
    }

    // Zeig Fahrzeug-Kapazitäten
    if (vehicles) {
        console.log('\n--- Fahrzeug-Kapazitäten ---');
        Object.entries(vehicles).forEach(([vid, vd]) => {
            if (vd && (vd.capacity || vd.seats)) {
                console.log(' ', vid, '| seats:', vd.seats, '| capacity:', vd.capacity);
            }
        });
    }
})().catch(e => console.error('ERROR:', e.message));
