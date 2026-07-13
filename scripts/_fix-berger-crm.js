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

(async () => {
    const rideId = '-Owhx8ku8aSLrJYL1HxH';
    const now = Date.now();

    // Neuen CRM-Eintrag für Berger anlegen
    const newCust = {
        name: 'Berger',
        phone: '01736809016',
        mobile: '01736809016',
        createdAt: now,
        createdBy: 'admin-bridge',
        type: 'gelegentlich'
    };
    const res = await post('/customers.json', newCust);
    const newCustId = res?.name;
    console.log('Neuer CRM-Eintrag Berger:', newCustId);

    // Ride mit korrekter customerId updaten
    await patch('/rides/' + rideId + '.json', {
        customerId: newCustId,
        updatedAt: now
    });
    console.log('Ride korrigiert:', rideId, '→ customerId:', newCustId);
})().catch(e => console.error('ERROR:', e.message));
