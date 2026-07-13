#!/usr/bin/env node
// Revert falsch gepatchte 20-26-004 + Patch korrekte Strandidyll 20-26-1292
const { execSync } = require('child_process');
const https = require('https');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }

function req(method, path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const bodyStr = body !== undefined ? JSON.stringify(body) : null;
        const url = path + '?access_token=' + token;
        const opts = { hostname: RTDB_HOST, path: url, method, headers: { 'Content-Type': 'application/json' } };
        if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        const r = https.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => { try { resolve(JSON.parse(data || 'null')); } catch(e) { resolve(data); } });
        });
        r.on('error', reject);
        if (bodyStr) r.write(bodyStr);
        r.end();
    });
}

(async () => {
    // === 1. REVERT: Strandhotel Ahlbeck 20-26-004 → zurück auf 7€ ===
    console.log('=== REVERT 20-26-004 (Strandhotel Ahlbeck) → 7€ ===');
    const inv004 = await req('GET', '/invoices/20-26-004.json');
    if (inv004) {
        console.log('Aktuell:', inv004.totalGross + '€', '|', inv004.customerName);
        if (inv004.totalGross !== 7) {
            const net7 = parseFloat((7 / 1.07).toFixed(2));
            const vat7 = parseFloat((7 - net7).toFixed(2));
            await req('PATCH', '/invoices/20-26-004', { totalGross: 7, totalNet: net7, totalVat: vat7, updatedAt: Date.now() });
            await req('PATCH', '/invoices/20-26-004/positions/0', { amount: 7, totalGross: null });
            console.log('✅ Zurück auf 7€ gesetzt (net=' + net7 + ' vat=' + vat7 + ')');
        } else {
            console.log('✅ Bereits 7€');
        }
    } else {
        console.log('⚠️ 20-26-004 nicht gefunden');
    }

    // === 2. DIREKT: Strandidyll 20-26-1292 ===
    console.log('\n=== Strandidyll 20-26-1292 (direkt) ===');
    const inv = await req('GET', '/invoices/20-26-1292.json');
    if (!inv) {
        console.log('❌ /invoices/20-26-1292 nicht gefunden');
        // Shallow scan nach "strand" oder "idyll" in letzten 50 Keys
        console.log('\nScanne letzte 50 Schlüssel auf "strand"/"idyll"...');
        const allKeys = await req('GET', '/invoices.json?shallow=true');
        const keys = Object.keys(allKeys || {});
        console.log('Total:', keys.length, 'Rechnungen');
        // Letzte 50 prüfen
        const last50 = keys.slice(-50);
        for (const k of last50) {
            const i = await req('GET', `/invoices/${k}.json`);
            if (!i) continue;
            const name = (i.customerName || '').toLowerCase();
            if (name.includes('strand') || name.includes('idyll')) {
                console.log(`✅ GEFUNDEN: ${k} | ${i.invoiceNumber} | ${i.customerName} | ${i.totalGross}€`);
            }
        }
        return;
    }

    console.log('invoiceNumber:', inv.invoiceNumber);
    console.log('customerName:', inv.customerName);
    console.log('totalGross:', inv.totalGross + '€');
    console.log('totalNet:', inv.totalNet);
    console.log('totalVat:', inv.totalVat);
    console.log('positions[0].amount:', inv.positions && inv.positions[0] ? inv.positions[0].amount : 'N/A');

    if (inv.totalGross !== 10) {
        console.log('\nPatche auf 10€...');
        const newNet = parseFloat((10 / 1.07).toFixed(2));
        const newVat = parseFloat((10 - newNet).toFixed(2));
        await req('PATCH', '/invoices/20-26-1292', { totalGross: 10, totalNet: newNet, totalVat: newVat, updatedAt: Date.now() });
        if (inv.positions && inv.positions[0] !== undefined) {
            await req('PATCH', '/invoices/20-26-1292/positions/0', { amount: 10, totalGross: 10 });
        }
        console.log('✅ 20-26-1292 → 10€ (net=' + newNet + ' vat=' + newVat + ')');
    } else {
        console.log('✅ Bereits 10€ in Firebase');
        console.log('→ Problem war nur das PDF. Bitte Rechnung in Web-Admin neu generieren.');
    }
})().catch(e => console.error('ERROR:', e.message));
