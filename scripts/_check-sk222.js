#!/usr/bin/env node
const { execSync } = require('child_process');
const https = require('https');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

function getToken() {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
}

function httpsGet(path) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const opts = {
            hostname: RTDB_HOST,
            path: path + (path.includes('?') ? '&' : '?') + 'access_token=' + token,
            method: 'GET'
        };
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data || 'null')); }
                catch (e) { reject(new Error('JSON: ' + data.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

(async () => {
    console.log('=== vehicles/pw-sk-222.shift KOMPLETT ===');
    const veh = await httpsGet('/vehicles/pw-sk-222.json');
    if (veh && veh.shift) {
        console.log('shift:', JSON.stringify(veh.shift, null, 2));
        console.log('forceEnded boolean:', veh.shift.forceEnded);
        console.log('endedAt:', veh.shift.endedAt ? new Date(veh.shift.endedAt).toLocaleString('de-DE') : 'null');
        console.log('forceEndedAt:', veh.shift.forceEndedAt ? new Date(veh.shift.forceEndedAt).toLocaleString('de-DE') : 'null');
    } else {
        console.log('kein shift-Objekt');
    }
})().catch(e => console.error('ERROR:', e.message));
