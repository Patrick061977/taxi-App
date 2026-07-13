#!/usr/bin/env node
// Löscht die doppelte 11.07-Anreise-Fahrt und aktualisiert die Abreise-Fahrt
// mit Notiz über die Rückfahrt (Hin- und Rückfahrt in einem)

const https = require('https');
const { execSync } = require('child_process');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }

function fbDelete(path) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const req = https.request({
            hostname: RTDB_HOST,
            path: '/' + path + '.json?access_token=' + token,
            method: 'DELETE'
        }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
        req.on('error', reject);
        req.end();
    });
}

function fbPatch(path, data) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const body = JSON.stringify(data);
        const req = https.request({
            hostname: RTDB_HOST,
            path: '/' + path + '.json?access_token=' + token,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

(async () => {
    // Lösche die extra Anreise-Fahrt (14:30)
    await fbDelete('rides/-OwWs5qM6tKvyrFYPCUy');
    console.log('✅ Extra Anreise-Fahrt (11.07. 14:30) gelöscht');

    // Aktualisiere die Abreise-Fahrt mit Notiz über Rückfahrt + Preis €20
    await fbPatch('rides/-OwWs5bT4ARfZLadqVSX', {
        notes: 'Alex Touristik — Hin- und Rückfahrt: 3 Pax Hotel→Bahnhof, dann 4 Pax Bahnhof→Hotel. Bezahlung vom Busunternehmen vor Ort.',
        price: 20,
        passengers: 4,
        updatedAt: Date.now()
    });
    console.log('✅ 11.07-Fahrt aktualisiert: Hin- und Rückfahrt, €20');
})();
