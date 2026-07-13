#!/usr/bin/env node
// Erstellt 4 Alex Touristik Vorbestellungen in Firebase

const https = require('https');
const { execSync } = require('child_process');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

function getToken() {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

function fbPush(path, data) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const body = JSON.stringify(data);
        const req = https.request({
            hostname: RTDB_HOST,
            path: '/' + path + '.json?access_token=' + token,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

const now = Date.now();

const rides = [
    {
        pickup: 'Bahnhof Heringsdorf, Bahnhofstraße, 17424 Heringsdorf',
        pickupLat: 53.9661, pickupLon: 14.1706,
        destination: 'Seehotel Esplanade & Aurora, Seestraße 5, 17424 Heringsdorf',
        destLat: 53.9693, destLon: 14.1693,
        pickupTime: '14:15',
        pickupTimestamp: 1783167300000,
        passengers: 5,
        price: 15,
        label: '04.07. 14:15 — 5 Pax Bahnhof→Esplanade'
    },
    {
        pickup: 'Seehotel Esplanade & Aurora, Seestraße 5, 17424 Heringsdorf',
        pickupLat: 53.9693, pickupLon: 14.1693,
        destination: 'Bahnhof Heringsdorf, Bahnhofstraße, 17424 Heringsdorf',
        destLat: 53.9661, destLon: 14.1706,
        pickupTime: '14:15',
        pickupTimestamp: 1783772100000,
        passengers: 3,
        price: 10,
        label: '11.07. 14:15 — 3 Pax Esplanade→Bahnhof (Abreise)'
    },
    {
        pickup: 'Bahnhof Heringsdorf, Bahnhofstraße, 17424 Heringsdorf',
        pickupLat: 53.9661, pickupLon: 14.1706,
        destination: 'Seehotel Esplanade & Aurora, Seestraße 5, 17424 Heringsdorf',
        destLat: 53.9693, destLon: 14.1693,
        pickupTime: '14:30',
        pickupTimestamp: 1783773000000,
        passengers: 4,
        price: 10,
        label: '11.07. 14:30 — 4 Pax Bahnhof→Esplanade (Anreise)'
    },
    {
        pickup: 'Seehotel Esplanade & Aurora, Seestraße 5, 17424 Heringsdorf',
        pickupLat: 53.9693, pickupLon: 14.1693,
        destination: 'Parkplatz P-Bus, Bahnhofstraße, 17424 Heringsdorf',
        destLat: 53.9661, destLon: 14.1706,
        pickupTime: '10:30',
        pickupTimestamp: 1784363400000,
        passengers: 6,
        price: 15,
        label: '18.07. 10:30 — 6 Pax Esplanade→Bahnhof'
    }
];

(async () => {
    for (const r of rides) {
        const ride = {
            pickup: r.pickup,
            pickupLat: r.pickupLat, pickupLon: r.pickupLon,
            pickupCoords: { lat: r.pickupLat, lon: r.pickupLon },
            destination: r.destination,
            destinationLat: r.destLat, destinationLon: r.destLon,
            destCoords: { lat: r.destLat, lon: r.destLon },
            pickupTime: r.pickupTime,
            pickupTimestamp: r.pickupTimestamp,
            passengers: r.passengers,
            price: r.price,
            priceSource: 'manual',
            customerName: 'Alex Touristik',
            customerPhone: '',
            notes: 'Busreise-Transfer Alex Touristik / Mandy Rockstroh',
            status: 'vorbestellt',
            source: 'admin_manual',
            createdAt: now,
            updatedAt: now,
            cloudNotificationSent: false
        };
        const result = await fbPush('rides', ride);
        console.log('✅', r.label, '→', result.name);
    }
    console.log('\nFertig. 4 Fahrten angelegt.');
})();
