#!/usr/bin/env node
// migrate-lifecyclelog-to-ridelogs.js — Phase 2 (Patrick 01.06. 21:00 Bridge
// "jetzt versuchs du Traffic einzusparen"): verschiebt alle existierenden
// rides/{id}/lifecycleLog Einträge nach rideLogs/{id}/{logId} und löscht
// das alte Inline-Feld. Reduziert den Bandwidth-Bedarf bei jedem
// /rides-Listener-Update drastisch.

const admin = require('C:/Taxi App/taxi-App-github/functions/node_modules/firebase-admin');
const fs = require('fs');

let serviceAccount;
try {
    serviceAccount = require('C:/Taxi App/taxi-App-github/scripts/firebase-admin-key.json');
} catch (e) {
    console.error('FATAL: scripts/firebase-admin-key.json nicht gefunden');
    process.exit(1);
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app',
    });
}
const db = admin.database();
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);

(async () => {
    LOG('Lade /rides (shallow) …');
    const rideKeysSnap = await db.ref('rides').once('value');
    if (!rideKeysSnap.exists()) { LOG('keine rides'); process.exit(0); }
    const allRides = rideKeysSnap.val() || {};
    const rideIds = Object.keys(allRides);
    LOG('Gesamtanzahl Rides:', rideIds.length);

    let migrated = 0, ridesAffected = 0, totalEntries = 0, errors = 0;
    const batchSize = 25;
    for (let i = 0; i < rideIds.length; i += batchSize) {
        const slice = rideIds.slice(i, i + batchSize);
        await Promise.all(slice.map(async (rideId) => {
            try {
                const ride = allRides[rideId];
                if (!ride || typeof ride !== 'object') return;
                const oldLog = ride.lifecycleLog;
                if (!oldLog || typeof oldLog !== 'object') return;
                const entries = Object.entries(oldLog);
                if (!entries.length) return;
                ridesAffected++;
                // Schreibe alle Einträge unter rideLogs/{id}/{eintragKey}
                const updates = {};
                for (const [k, v] of entries) {
                    updates['rideLogs/' + rideId + '/' + k] = v;
                    totalEntries++;
                }
                // Lösche lifecycleLog aus /rides
                updates['rides/' + rideId + '/lifecycleLog'] = null;
                await db.ref().update(updates);
                migrated += entries.length;
                if (ridesAffected % 50 === 0) LOG('progress:', ridesAffected, 'rides /', migrated, 'entries');
            } catch (e) {
                errors++;
                LOG('FEHLER bei', rideId, ':', e.message);
            }
        }));
    }
    LOG('===== FERTIG =====');
    LOG('Rides betroffen:', ridesAffected);
    LOG('Einträge verschoben:', migrated);
    LOG('Fehler:', errors);
    process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
