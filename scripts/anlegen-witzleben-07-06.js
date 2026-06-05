#!/usr/bin/env node
// anlegen-witzleben-07-06.js — Patrick 05.06.2026 10:30: "bitte eintragen"
// Vorbestellung Witzleben für So 07.06.2026 09:50 Uhr.

const admin = require('C:/Taxi App/taxi-App-github/functions/node_modules/firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = require('C:/Taxi App/taxi-App-github/scripts/firebase-admin-key.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app',
    });
}
const db = admin.database();

(async () => {
    const pickupTimestamp = new Date('2026-06-07T09:50:00+02:00').getTime();
    const ride = {
        pickup: 'Ostseehotel Ahlbeck, Kurstraße, 17419 Ostseebad Heringsdorf — OT Ahlbeck',
        pickupLat: 53.9461,
        pickupLon: 14.2103,
        destination: 'Bahnhof Heringsdorf — OT Ahlbeck',
        destinationLat: 53.9450,
        destinationLon: 14.2107,

        pickupTimestamp: pickupTimestamp,
        datetime: '2026-06-07T09:50',
        pickupTime: '2026-06-07 09:50',

        customerName: 'Witzleben',
        customerPhone: '01773776675',
        customerMobile: '01773776675',

        persons: 3,
        passengers: 3,
        status: 'vorbestellt',
        paymentMethod: 'cash',
        notes: 'Mit Gepäck und Gehwagen — größeres Fahrzeug nötig (kein Tesla wegen Gehwagen)',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: 'claude-bridge',
        source: 'telegram-bridge-witzleben',
    };

    const ref = db.ref('rides').push();
    await ref.set(ride);
    console.log('Ride angelegt:', ref.key);
    console.log('Pickup:', ride.pickup);
    console.log('Destination:', ride.destination);
    console.log('Zeit:', ride.pickupTime);
    console.log('Kunde:', ride.customerName, '/', ride.customerPhone);
    console.log('Personen:', ride.persons, 'mit Gepäck+Gehwagen');
    process.exit(0);
})().catch(e => { console.error('Fehler:', e); process.exit(1); });
