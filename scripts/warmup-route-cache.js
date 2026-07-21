#!/usr/bin/env node
// v6.63.766 (Patrick 21.07.): Route-Cache Warm-up
// Lädt alle Rides der letzten 6 Monate, sammelt einzigartige (from,to)-Paare,
// prüft welche im Firebase /routeCache fehlen und berechnet nur die fehlenden.
// Nach Durchlauf: alle historisch genutzten Routen sind cached → Konflikt-Filter
// im Cron braucht keine Live-Rechnung mehr.

const https = require('https');
const { execSync } = require('child_process');

const DB = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
const TOKEN = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
const SIX_MONTHS_MS = 6 * 30 * 24 * 3600 * 1000;

function get(path) {
    return new Promise((res, rej) => {
        https.get(`https://${DB}${path}?access_token=${TOKEN}`, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try { res(JSON.parse(d)); } catch (e) { res(null); }
            });
        }).on('error', rej);
    });
}

function put(path, body) {
    return new Promise((res, rej) => {
        const data = JSON.stringify(body);
        const req = https.request({
            hostname: DB,
            path: `${path}?access_token=${TOKEN}`,
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
        }, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => res(r.statusCode));
        });
        req.on('error', rej);
        req.write(data);
        req.end();
    });
}

async function osrmMin(fLat, fLon, tLat, tLon) {
    return new Promise((res, rej) => {
        const url = `https://router.project-osrm.org/route/v1/driving/${fLon},${fLat};${tLon},${tLat}?overview=false`;
        https.get(url, r => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                try {
                    const j = JSON.parse(d);
                    const sec = j?.routes?.[0]?.duration;
                    if (typeof sec !== 'number') return res(null);
                    res(Math.max(2, Math.round(sec / 60)));
                } catch (e) { res(null); }
            });
        }).on('error', () => res(null));
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('=== Route-Cache Warm-up ===');
    console.log('Lade Rides + archiveRides...');
    const [rides, arch] = await Promise.all([get('/rides.json'), get('/archiveRides.json')]);
    const all = { ...(arch || {}), ...(rides || {}) };
    const now = Date.now();
    const cutoff = now - SIX_MONTHS_MS;

    const pairs = new Map(); // key → { fLat, fLon, tLat, tLon }
    let totalRides = 0;
    for (const r of Object.values(all)) {
        if (!r || !r.pickupTimestamp || r.pickupTimestamp < cutoff) continue;
        const fLat = parseFloat(r.pickupLat || r.pickupCoords?.lat);
        const fLon = parseFloat(r.pickupLon || r.pickupCoords?.lon);
        const tLat = parseFloat(r.destinationLat || r.destCoords?.lat);
        const tLon = parseFloat(r.destinationLon || r.destCoords?.lon);
        if (!Number.isFinite(fLat) || !Number.isFinite(fLon) || !Number.isFinite(tLat) || !Number.isFinite(tLon)) continue;
        totalRides++;
        const key = `${fLat.toFixed(4)}_${fLon.toFixed(4)}-${tLat.toFixed(4)}_${tLon.toFixed(4)}-driving-min`;
        if (!pairs.has(key)) pairs.set(key, { fLat, fLon, tLat, tLon });
    }
    console.log(`Rides (6 Mo): ${totalRides} | einzigartige Routen: ${pairs.size}`);

    // Firebase-Cache lesen
    console.log('Lade routeCache Keys...');
    const cache = await get('/routeCache.json?shallow=true');
    const cachedKeys = new Set(Object.keys(cache || {}));
    console.log(`Cache: ${cachedKeys.size} vorhanden`);

    const missing = [];
    for (const [key, coords] of pairs) {
        const fbKey = key.replace(/\./g, '_'); // Firebase-safe key: Punkte durch Unterstriche
        if (!cachedKeys.has(fbKey)) missing.push({ key: fbKey, ...coords });
    }
    console.log(`Fehlend: ${missing.length}`);

    if (missing.length === 0) {
        console.log('✓ Cache komplett.');
        return;
    }

    let done = 0, fail = 0;
    for (const p of missing) {
        try {
            const min = await osrmMin(p.fLat, p.fLon, p.tLat, p.tLon);
            if (min == null) { fail++; continue; }
            await put(`/routeCache/${p.key}.json`, {
                duration: min,
                distance: null,
                source: 'osrm-driving-min',
                createdAt: Date.now(),
                warmedUp: true
            });
            done++;
            if ((done + fail) % 50 === 0) {
                console.log(`Progress: ${done + fail}/${missing.length} · OK ${done} · fail ${fail}`);
            }
        } catch (e) {
            fail++;
        }
        await sleep(1000); // Rate-Limit-Schutz
    }
    console.log(`=== Fertig: ${done} neu, ${fail} fail, ${cachedKeys.size + done} gesamt ===`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
