#!/usr/bin/env node
const { execSync } = require('child_process');
const https = require('https');
const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }

function post(path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const bodyStr = JSON.stringify(body);
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method: 'POST', headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(bodyStr)} };
        const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d||'null'));}catch(e){resolve(d);} }); });
        r.on('error', reject); r.write(bodyStr); r.end();
    });
}
function patch(path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const bodyStr = JSON.stringify(body);
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method: 'PATCH', headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(bodyStr)} };
        const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d||'null'));}catch(e){resolve(d);} }); });
        r.on('error', reject); r.write(bodyStr); r.end();
    });
}
function get(path) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method: 'GET' };
        const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d||'null'));}catch(e){resolve(null);} }); });
        r.on('error', reject); r.end();
    });
}

(async () => {
    const now = Date.now();
    const pickupTs = 1783189800000; // 04.07.2026 20:30 CEST

    // CRM-Check: Berger mit 01736809016 vorhanden?
    const customers = await get('/customers.json');
    let custId = null;
    if (customers) {
        for (const [k, c] of Object.entries(customers)) {
            if (!c) continue;
            const phones = [c.phone, c.mobile, c.mobilePhone].filter(Boolean);
            if (phones.some(p => p.replace(/\s/g,'').includes('01736809016'))) {
                custId = k;
                console.log('CRM-Match gefunden:', k, c.name);
                break;
            }
            if (c.name && c.name.toLowerCase().includes('berger')) {
                custId = k;
                console.log('CRM-Match (Name):', k, c.name);
                break;
            }
        }
    }

    // CRM anlegen wenn nicht vorhanden
    if (!custId) {
        console.log('Kein CRM-Eintrag gefunden → lege an...');
        const newCust = {
            name: 'Berger',
            phone: '01736809016',
            mobile: '01736809016',
            createdAt: now,
            createdBy: 'admin-bridge',
            type: 'gelegentlich'
        };
        const res = await post('/customers.json', newCust);
        custId = res?.name || null;
        console.log('CRM angelegt:', custId);
    }

    // Fahrt anlegen
    const ride = {
        customerName: 'Berger',
        customerPhone: '01736809016',
        customerId: custId || null,
        pickup: 'Bahnhof Heringsdorf',
        destination: 'Kulmstraße 6, 17424 Heringsdorf',
        pickupTimestamp: pickupTs,
        pickupTime: '20:30',
        passengers: 1,
        status: 'vorbestellt',
        createdAt: now,
        updatedAt: now,
        createdBy: 'admin-bridge',
        paymentMethod: 'bar',
        source: 'telegram-admin'
    };

    const result = await post('/rides.json', ride);
    const rideId = result?.name;
    console.log('Fahrt angelegt:', rideId);
    console.log('Pickup:', new Date(pickupTs).toLocaleString('de-DE', {timeZone:'Europe/Berlin'}));
    console.log(JSON.stringify(ride, null, 2));
})().catch(e => console.error('ERROR:', e.message));
