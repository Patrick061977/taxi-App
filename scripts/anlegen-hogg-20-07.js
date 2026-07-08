#!/usr/bin/env node
// anlegen-hogg-20-07.js — Patrick 08.07.2026
// Vorbestellung Sandy Hogg: Bahnhof Heringsdorf → Labahnstraße 9, 20.07.2026 17:05 Uhr
// 3 Personen + 1 Hund, 3 Koffer

'use strict';
const { execSync } = require('child_process');
const https = require('https');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

function getToken() {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

function rtdbPut(path, data) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const body = JSON.stringify(data);
        const opts = {
            hostname: RTDB_HOST,
            path: path + '.json?access_token=' + token,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        };
        const req = https.request(opts, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => resolve(JSON.parse(d)));
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

function rtdbPost(path, data) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const body = JSON.stringify(data);
        const opts = {
            hostname: RTDB_HOST,
            path: path + '.json?access_token=' + token,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        };
        const req = https.request(opts, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => resolve(JSON.parse(d)));
        });
        req.on('error', reject);
        req.write(body); req.end();
    });
}

function nominatim(q) {
    return new Promise((resolve) => {
        const path = '/search?q=' + encodeURIComponent(q) + '&format=json&limit=1&countrycodes=de';
        const opts = { hostname: 'nominatim.openstreetmap.org', path, method: 'GET', headers: { 'User-Agent': 'FunkTaxi/1.0' } };
        https.get(opts, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const r = JSON.parse(d);
                    if (r[0]) resolve({ lat: parseFloat(r[0].lat), lon: parseFloat(r[0].lon), name: r[0].display_name });
                    else resolve(null);
                } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

(async () => {
    const now = Date.now();
    const pickupTimestamp = new Date('2026-07-20T17:05:00+02:00').getTime();

    // Geocoding
    console.log('📍 Geocodiere Adressen...');
    const [gPickup, gDest] = await Promise.all([
        nominatim('Bahnhof Ostseebad Heringsdorf'),
        nominatim('Labahnstraße 9, Heringsdorf'),
    ]);

    const pickupLat = gPickup?.lat || 53.9663;
    const pickupLon = gPickup?.lon || 14.1566;
    const destLat   = gDest?.lat   || 53.9591;
    const destLon   = gDest?.lon   || 14.1622;

    console.log('   Bahnhof:       ', pickupLat, pickupLon, gPickup ? '✅' : '⚠️ Fallback');
    console.log('   Labahnstraße 9:', destLat, destLon, gDest ? '✅' : '⚠️ Fallback');

    // 1. CRM-Kunden anlegen
    console.log('\n👤 Lege CRM-Kunden an...');
    const customer = {
        name:         'Sandy Hogg',
        phone:        '01638690367',
        mobile:       '01638690367',
        email:        'sandy.hogg@yahoo.de',
        type:         'Gelegenheitskunde',
        createdAt:    now,
        updatedAt:    now,
        createdBy:    'claude-bridge',
        notes:        '3 Personen + Hund (45cm). Rückfahrt 27.07. folgt separat.',
        source:       'telegram-anfrage-2026-07-08',
    };
    const custRes = await rtdbPost('/customers', customer);
    const customerId = custRes.name;
    console.log('   CRM-ID:', customerId);

    // 2. Fahrt anlegen
    console.log('\n🚕 Lege Fahrt an...');
    const ride = {
        pickup:           'Bahnhof Heringsdorf',
        pickupLat,
        pickupLon,
        destination:      'Labahnstraße 9, 17424 Heringsdorf',
        destinationLat:   destLat,
        destinationLon:   destLon,

        pickupTimestamp,
        datetime:    '2026-07-20T17:05',
        pickupTime:  '2026-07-20 17:05',

        customerName:    'Sandy Hogg',
        customerPhone:   '01638690367',
        customerMobile:  '01638690367',
        customerEmail:   'sandy.hogg@yahoo.de',
        customerId,

        persons:     3,
        passengers:  3,
        status:      'vorbestellt',
        paymentMethod: 'cash',
        notes:       '1 Hund (~45 cm Schulterhöhe), 3 Koffer + Taschen. Bus-Ankunft 17:05 Uhr.',
        createdAt:   now,
        updatedAt:   now,
        createdBy:   'claude-bridge',
        source:      'telegram-bridge-hogg-2026-07-08',
    };
    const rideRes = await rtdbPost('/rides', ride);
    const rideId = rideRes.name;
    console.log('   Ride-ID:', rideId);

    console.log('\n✅ Fertig!');
    console.log('   Kunde:   Sandy Hogg / 01638690367');
    console.log('   Fahrt:   20.07.2026 17:05 | Bahnhof HER → Labahnstraße 9');
    console.log('   Pax:     3 + Hund');
    console.log('   CRM-ID:  ', customerId);
    console.log('   Ride-ID: ', rideId);
    process.exit(0);
})().catch(e => { console.error('❌ Fehler:', e.message); process.exit(1); });
