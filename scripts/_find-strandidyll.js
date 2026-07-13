#!/usr/bin/env node
// Sucht ALLE Strandidyll-Rechnungen + zeigt was loadInvoices() lädt
const { execSync } = require('child_process');
const https = require('https');
const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }
function get(path) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method: 'GET' };
        const r = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d||'null'));}catch(e){resolve(null);} }); });
        r.on('error', reject); r.end();
    });
}

(async () => {
    // 1. Direkt 20-26-1292 prüfen
    console.log('=== 20-26-1292 direkt ===');
    const inv = await get('/invoices/20-26-1292.json');
    if (inv) {
        console.log('totalGross:', inv.totalGross);
        console.log('customerName:', inv.customerName);
        console.log('invoiceDate:', inv.invoiceDate);
        console.log('createdAt:', inv.createdAt ? new Date(inv.createdAt).toLocaleString('de-DE') : 'null');
        console.log('updatedAt:', inv.updatedAt ? new Date(inv.updatedAt).toLocaleString('de-DE') : 'null');
        console.log('needsPdfRegeneration:', inv.needsPdfRegeneration);
    } else {
        console.log('NICHT GEFUNDEN');
    }

    // 2. Was lädt die native App? → orderByChild("invoiceDate") startAt("2026-01-01") limitToLast(80)
    console.log('\n=== Query 1: orderByChild(invoiceDate) limitToLast(80) ===');
    const q1 = await get('/invoices.json?orderBy=%22invoiceDate%22&startAt=%222026-01-01%22&limitToLast=80');
    if (q1) {
        const q1Keys = Object.keys(q1);
        console.log('Ergebnis:', q1Keys.length, 'Einträge');
        const strandInQ1 = q1Keys.filter(k => {
            const v = q1[k];
            return v && (v.customerName||'').toLowerCase().includes('strand');
        });
        if (strandInQ1.length) {
            for (const k of strandInQ1) {
                console.log('  Strand-Treffer:', k, '|', q1[k].customerName, '|', q1[k].totalGross + '€');
            }
        } else {
            console.log('  Kein Strand-Treffer in Query 1');
            // Zeige letzten + ersten
            const sorted = q1Keys.sort();
            console.log('  Ältester Key:', sorted[0], '|', (q1[sorted[0]]||{}).invoiceDate);
            console.log('  Neuester Key:', sorted[sorted.length-1], '|', (q1[sorted[sorted.length-1]]||{}).invoiceDate);
        }
    }

    // 3. Query 2: orderByChild("createdAt") startAt(1) limitToLast(50)
    console.log('\n=== Query 2: orderByChild(createdAt) limitToLast(50) ===');
    const q2 = await get('/invoices.json?orderBy=%22createdAt%22&startAt=1&limitToLast=50');
    if (q2) {
        const q2Keys = Object.keys(q2);
        console.log('Ergebnis:', q2Keys.length, 'Einträge');
        const strandInQ2 = q2Keys.filter(k => {
            const v = q2[k];
            return v && (v.customerName||'').toLowerCase().includes('strand');
        });
        if (strandInQ2.length) {
            for (const k of strandInQ2) {
                console.log('  Strand-Treffer:', k, '|', q2[k].customerName, '|', q2[k].totalGross + '€');
            }
        } else {
            console.log('  Kein Strand-Treffer in Query 2');
        }
    }

    // 4. Kompletter Scan nach "strandidyll" (letzte 500 per key)
    console.log('\n=== Kompletter Scan: letzte 500 per key ===');
    const byKey = await get('/invoices.json?orderBy=%22%24key%22&limitToLast=500');
    if (byKey) {
        let found = 0;
        for (const [k, v] of Object.entries(byKey)) {
            if (!v) continue;
            const name = (v.customerName||'').toLowerCase();
            if (name.includes('strand') || name.includes('idyll')) {
                console.log('  ✅', k, '|', v.invoiceNumber, '|', v.customerName, '|', v.totalGross + '€', '| invoiceDate:', v.invoiceDate, '| createdAt:', v.createdAt ? new Date(v.createdAt).toLocaleString('de-DE') : 'null');
                found++;
            }
        }
        if (!found) console.log('  Keine Strandidyll-Rechnung in letzten 500 Keys');
    }
})().catch(e => console.error('ERROR:', e.message));
