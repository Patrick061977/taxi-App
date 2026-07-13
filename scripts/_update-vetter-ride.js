#!/usr/bin/env node
// Einmal-Script: Vetter-Touristik-Fahrt auf PW-SK-222 umstellen
const { execSync } = require('child_process');
const https = require('https');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
const RIDE_ID = '-Owg4WZaEywQhtyWdvNr';

function getToken() {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

function fbGet(path) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const req = https.request({
            hostname: RTDB_HOST,
            path: '/' + path + '.json?access_token=' + token,
            method: 'GET'
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('parse: ' + d.slice(0, 300))); } });
        });
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
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('parse: ' + d.slice(0, 300))); } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

(async () => {
    try {
        console.log('Lese Fahrt...');
        const ride = await fbGet(`rides/${RIDE_ID}`);
        if (!ride || ride.error) {
            console.error('Fahrt nicht gefunden:', JSON.stringify(ride));
            process.exit(1);
        }
        console.log('Aktuelle Fahrt:', ride.pickup, '→', ride.destination);
        console.log('Aktuelles Fahrzeug:', ride.assignedVehicle);
        console.log('Pickup-Zeit:', ride.pickupTime, 'ts:', ride.pickupTimestamp);

        // Pickup-Timestamp für 11:30 Uhr heute (04.07.2026 Berlin)
        // Aktueller TS: 1783157400000 = let's check
        const currentTs = ride.pickupTimestamp;
        const currentDate = currentTs ? new Date(currentTs) : null;
        if (currentDate) console.log('Pickup-Datum:', currentDate.toISOString());

        // Update: Fahrzeug auf pw-sk-222
        const update = {
            assignedVehicle: 'pw-sk-222',
            vehicleLabel: 'PW-SK 222',
            updatedAt: Date.now()
        };

        console.log('\nPATCH:', JSON.stringify(update));
        const result = await fbPatch(`rides/${RIDE_ID}`, update);
        console.log('Ergebnis:', JSON.stringify(result).substring(0, 200));
        console.log('✅ Fahrzeug auf PW-SK-222 gesetzt');

    } catch (e) {
        console.error('❌ Fehler:', e.message);
        process.exit(1);
    }
})();
