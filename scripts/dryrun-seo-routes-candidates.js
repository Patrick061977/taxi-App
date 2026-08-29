#!/usr/bin/env node
// v6.63.1011: DRY-RUN — zaehlt wieviele saubere SEO-Routen-Kandidaten in /rides
// + /archiveRides stecken, OHNE Files zu schreiben. Nutzt exakt dieselben Filter
// wie generate-from-rides-selflearn.js (shortName + isPrivateAddress aus v1005).
//
// Aufruf:
//   node scripts/dryrun-seo-routes-candidates.js
//   node scripts/dryrun-seo-routes-candidates.js --min 2 --lookback 730 --top 50

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { shortName, isPrivateAddress } = require('./generate-from-rides-selflearn.js');

const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function argVal(name, def) {
    const i = args.indexOf(name);
    return i >= 0 && args[i+1] ? args[i+1] : def;
}
const MIN_COUNT = parseInt(argVal('--min', '2'));
const LOOKBACK_DAYS = parseInt(argVal('--lookback', '730'));
const TOP_N = parseInt(argVal('--top', '30'));

function fetchViaCli(refPath) {
    const out = execSync('firebase database:get ' + refPath, {
        maxBuffer: 500 * 1024 * 1024,
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }).toString();
    return JSON.parse(out);
}

function slugify(s) {
    return s.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function main() {
    console.log('🔍 DRY-RUN — es wird NICHTS geschrieben');
    console.log(`   MIN_COUNT=${MIN_COUNT}× | LOOKBACK=${LOOKBACK_DAYS} Tage | TOP=${TOP_N}`);
    console.log('---');

    const existing = new Set(
        fs.readdirSync(ROOT).filter(f => /^taxi-.*-zu-.*\.html$/.test(f))
    );
    console.log(`📁 Existierende Landings auf Platte: ${existing.size}`);

    const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000;
    const routes = {};
    let totalScanned = 0, totalCompleted = 0, filteredPrivate = 0;

    const scanRides = (rides, sourceLabel) => {
        const n = Object.keys(rides || {}).length;
        console.log(`📡 ${sourceLabel}: ${n} Rides`);
        for (const r of Object.values(rides || {})) {
            if (!r) continue;
            totalScanned++;
            if (r.status !== 'completed') continue;
            const ts = r.completedAt || r.pickupTimestamp || r.createdAt || 0;
            if (ts < cutoff) continue;
            totalCompleted++;
            const fromName = shortName(r.pickup);
            const toName = shortName(r.destination);
            if (!fromName || !toName) continue;
            if (isPrivateAddress(fromName) || isPrivateAddress(toName)) { filteredPrivate++; continue; }
            const fromS = slugify(fromName);
            const toS = slugify(toName);
            if (!fromS || !toS || fromS === toS) continue;
            const key = fromS + '|' + toS;
            if (!routes[key]) routes[key] = { count: 0, from: fromName, to: toName, fromS, toS };
            routes[key].count++;
        }
    };

    try { scanRides(fetchViaCli('/rides'), '/rides (Live)'); }
    catch (e) { console.warn('⚠️  /rides Fetch-Fehler:', e.message.slice(0, 200)); }
    try { scanRides(fetchViaCli('/archiveRides'), '/archiveRides'); }
    catch (e) { console.warn('⚠️  /archiveRides Fetch-Fehler:', e.message.slice(0, 200)); }

    console.log('---');
    console.log(`📊 Rides: ${totalScanned} gescannt, ${totalCompleted} completed im Fenster, ${filteredPrivate} wegen Privat-Adresse verworfen`);

    const all = Object.values(routes);
    const buckets = {};
    for (const r of all) {
        r.filename = `taxi-${r.fromS}-zu-${r.toS}.html`;
        r.exists = existing.has(r.filename);
        for (const min of [1, 2, 3, 5, 10]) {
            if (r.count >= min) {
                buckets[min] = buckets[min] || { total: 0, newOnly: 0 };
                buckets[min].total++;
                if (!r.exists) buckets[min].newOnly++;
            }
        }
    }

    console.log('---');
    console.log('🎯 Verteilung (saubere POI-Kombinationen nach Filter):');
    console.log('   MIN | Total | Davon noch KEIN File');
    for (const min of [1, 2, 3, 5, 10]) {
        const b = buckets[min] || { total: 0, newOnly: 0 };
        console.log(`   ≥${min}× | ${String(b.total).padStart(5)} | ${b.newOnly}`);
    }

    const newCandidates = all
        .filter(r => r.count >= MIN_COUNT && !r.exists)
        .sort((a, b) => b.count - a.count);

    console.log('---');
    console.log(`🆕 TOP ${TOP_N} neue Kandidaten (≥${MIN_COUNT}× gefahren, noch kein File):`);
    newCandidates.slice(0, TOP_N).forEach((r, i) => {
        console.log(`   ${String(i+1).padStart(2)}. ${String(r.count).padStart(3)}× | ${r.from} → ${r.to}`);
    });

    console.log('---');
    console.log(`✅ SUMME: ${newCandidates.length} neue saubere Kandidaten (≥${MIN_COUNT}× im letzten ${LOOKBACK_DAYS}-Tage-Fenster)`);
    console.log(`   Aktuell auf Platte: ${existing.size} Landings`);
    console.log(`   Bei Voll-Regen (≥${MIN_COUNT}×): ${existing.size + newCandidates.length} total`);
}

main();
