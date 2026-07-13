#!/usr/bin/env node
// Alex Touristik — finale Updates: neue Zeiten + Gästenamen + Busfahrer-Kontakte

const https = require('https');
const { execSync } = require('child_process');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }

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
    // 04.07. 14:15 — keine Zeitänderung, nur Gäste + Busfahrer ergänzen
    await fbPatch('rides/-OwWs5MZJAJ0hN7k2Hz4', {
        notes: [
            'Alex Touristik — Bahnhof → Esplanade & Aurora',
            'Gäste: Herr Mönnicke Siegfried, Frau Mönnicke Kirsten, Frau Nitsche Gudrun, Herr Eidner Edgar, Frau Eidner Sigrid',
            'Busfahrer: Herr Fischer — 015774871712',
            'Reiseleiter: Frau Rockstroh — 015121233517',
            'Bezahlung vom Busunternehmen vor Ort. Busfahrer ruft 1h vorher an.'
        ].join('\n'),
        updatedAt: Date.now()
    });
    console.log('✅ 04.07. aktualisiert (Gäste + Busfahrer)');

    // 11.07. — Zeit Abreise: 14:00 (war 14:15), Anreise: 14:15 (gleich)
    // Pickup = 14:00 CEST = 12:00 UTC
    const ts1107 = new Date('2026-07-11T12:00:00Z').getTime();
    await fbPatch('rides/-OwWs5bT4ARfZLadqVSX', {
        pickupTimestamp: ts1107,
        pickupTime: '14:00',
        notes: [
            'Alex Touristik — Hin- und Rückfahrt kombiniert',
            '14:00 Uhr: 3 Pax Abreise Hotel → Bahnhof (Herr Mönnicke, Frau Mönnicke, Frau Nitsche)',
            '14:15 Uhr: 4 Pax Anreise Bahnhof → Hotel (Frau Lauber Lotte, Frau Goldhahn Heidi, Herr Wappler Lothar, Frau Möckel Christine)',
            'Busfahrer: Herr Kocot — 017684290887',
            'Reiseleiter: Herr Schönherr — 015753592966',
            'Bezahlung vom Busunternehmen vor Ort. Preis gesamt €20.'
        ].join('\n'),
        updatedAt: Date.now()
    });
    console.log('✅ 11.07. aktualisiert (Zeit 14:00, Gäste + Busfahrer)');

    // 18.07. — Zeit: 10:15 (war 10:30)
    // 10:15 CEST = 08:15 UTC
    const ts1807 = new Date('2026-07-18T08:15:00Z').getTime();
    await fbPatch('rides/-OwWs64D8Kx0wH8nEeGw', {
        pickupTimestamp: ts1807,
        pickupTime: '10:15',
        notes: [
            'Alex Touristik — Esplanade → Bahnhof',
            'Gäste: Herr Eidner Edgar, Frau Eidner Sigrid, Frau Lauber Lotte, Frau Goldhahn Heidi, Herr Wappler Lothar, Frau Möckel Christine',
            'Busfahrer: Herr Häckel — 01734796226',
            'Reiseleiter: Herr Schönherr — 015753592966',
            'Bezahlung vom Busunternehmen vor Ort. Busfahrer ruft 1h vorher an.'
        ].join('\n'),
        updatedAt: Date.now()
    });
    console.log('✅ 18.07. aktualisiert (Zeit 10:15, Gäste + Busfahrer)');
})();
