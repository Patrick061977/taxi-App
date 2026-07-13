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

function httpsPatch(path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const bodyStr = JSON.stringify(body);
        const opts = {
            hostname: RTDB_HOST,
            path: path + '?access_token=' + token,
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
        };
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

(async () => {
    // Get all invoice keys first (shallow)
    console.log('=== Invoice Keys (shallow) ===');
    const keys = await httpsGet('/invoices.json?shallow=true');
    if (!keys) { console.log('keine invoices'); return; }
    console.log(`${Object.keys(keys).length} Rechnungen total`);

    // Find by invoice number
    let foundKey = null;
    for (const key of Object.keys(keys)) {
        const inv = await httpsGet(`/invoices/${key}.json`);
        if (!inv) continue;
        if (inv.invoiceNumber === '20-26-1292' || (inv.customerName && inv.customerName.toLowerCase().includes('strand'))) {
            console.log(`\n✅ GEFUNDEN: ${key}`);
            console.log('invoiceNumber:', inv.invoiceNumber);
            console.log('customerName:', inv.customerName);
            console.log('totalGross:', inv.totalGross);
            console.log('totalNet:', inv.totalNet);
            console.log('totalVat:', inv.totalVat);
            console.log('positions[0].amount:', inv.positions && inv.positions[0] ? inv.positions[0].amount : 'N/A');
            console.log('updatedAt:', inv.updatedAt ? new Date(inv.updatedAt).toLocaleString('de-DE') : 'null');
            foundKey = key;
            break;
        }
    }

    if (!foundKey) {
        console.log('❌ Strandidyll-Rechnung 20-26-1292 nicht gefunden');
        // Show recent invoices
        const recent = Object.keys(keys).slice(-10);
        for (const k of recent) {
            const inv = await httpsGet(`/invoices/${k}.json`);
            if (inv) console.log(k.slice(0,8), '|', inv.invoiceNumber, '|', inv.customerName, '|', inv.totalGross);
        }
        return;
    }

    // Check if values are correct
    const inv = await httpsGet(`/invoices/${foundKey}.json`);
    const pos0amount = inv.positions && inv.positions[0] ? inv.positions[0].amount : null;
    if (inv.totalGross !== 10 || pos0amount !== 10) {
        console.log('\n⚠️ Patch auf 10€...');
        const vatRate = 7.0;
        const newNet = parseFloat((10 / 1.07).toFixed(2));
        const newVat = parseFloat((newNet * 0.07).toFixed(2));
        await httpsPatch(`/invoices/${foundKey}`, {
            totalGross: 10,
            totalNet: newNet,
            totalVat: newVat,
            updatedAt: Date.now()
        });
        await httpsPatch(`/invoices/${foundKey}/positions/0`, {
            amount: 10,
            totalGross: 10
        });
        console.log(`✅ ${foundKey} → 10€ gesetzt`);
    } else {
        console.log('\n✅ Bereits korrekt (10€)');
    }
})().catch(e => console.error('ERROR:', e.message));
