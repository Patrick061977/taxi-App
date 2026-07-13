#!/usr/bin/env node
// Sucht Strandidyll-Rechnung von heute und patcht auf 10€
const { execSync } = require('child_process');
const https = require('https');

const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }

function req(method, path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const bodyStr = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: RTDB_HOST,
            path: path + (path.includes('?') ? '&' : '?') + 'access_token=' + token,
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        const r = https.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data || 'null')); }
                catch (e) { reject(new Error(data.slice(0, 200))); }
            });
        });
        r.on('error', reject);
        if (bodyStr) r.write(bodyStr);
        r.end();
    });
}

(async () => {
    // Suche heute angelegte Invoices (createdAt >= heute 00:00 Berlin-Zeit)
    const today = new Date(new Date().toLocaleDateString('en-US', {timeZone:'Europe/Berlin'}) + ' 00:00:00').getTime();
    console.log('Suche Invoices von heute (seit', new Date(today).toLocaleString('de-DE'), ')...');

    const recent = await req('GET', `/invoices.json?orderBy="createdAt"&startAt=${today}&limitToLast=100`);
    if (!recent || recent.error) {
        console.log('createdAt-Query fehlgeschlagen (kein Index), versuche updatedAt...');
        // Try updatedAt
        const recent2 = await req('GET', `/invoices.json?orderBy="updatedAt"&startAt=${today}&limitToLast=100`);
        if (!recent2 || recent2.error) {
            console.log('Auch updatedAt fehlgeschlagen. Versuche last 500 per key...');
            // Get last 500 by key
            const by_key = await req('GET', '/invoices.json?orderBy="$key"&limitToLast=500');
            if (by_key) {
                let found = null, foundKey = null;
                for (const [k, v] of Object.entries(by_key)) {
                    if (!v) continue;
                    const name = (v.customerName || '').toLowerCase();
                    const nr = v.invoiceNumber || '';
                    if (name.includes('strand') || name.includes('idyll') || nr === '20-26-1292') {
                        found = v; foundKey = k;
                        console.log(`✅ ${k} | ${nr} | ${v.customerName} | ${v.totalGross}€`);
                    }
                }
                if (!foundKey) console.log('Nicht in letzten 500 Invoices — alle Kandidaten:');
            }
            return;
        }
        Object.entries(recent2 || {}).forEach(([k, v]) => {
            if (!v) return;
            const name = (v.customerName||'').toLowerCase();
            console.log(k.slice(0,10), '|', v.invoiceNumber, '|', v.customerName, '|', v.totalGross+'€');
            if (name.includes('strand') || name.includes('idyll') || v.invoiceNumber === '20-26-1292') {
                console.log('  ^^^ STRANDIDYLL GEFUNDEN ^^^');
            }
        });
        return;
    }

    // Print all today's invoices
    let found = null, foundKey = null;
    for (const [k, v] of Object.entries(recent)) {
        if (!v) continue;
        const name = (v.customerName||'').toLowerCase();
        console.log(k.slice(0,10), '|', v.invoiceNumber, '|', v.customerName, '|', v.totalGross+'€');
        if (name.includes('strand') || name.includes('idyll') || v.invoiceNumber === '20-26-1292') {
            found = v; foundKey = k;
        }
    }

    if (!foundKey) { console.log('\nNicht gefunden unter heutigen Invoices.'); return; }

    console.log(`\n✅ STRANDIDYLL: ${foundKey}`);
    console.log('totalGross:', found.totalGross);
    console.log('positions[0].amount:', found.positions && found.positions[0] ? found.positions[0].amount : 'N/A');

    if (found.totalGross !== 10 || (found.positions && found.positions[0] && found.positions[0].amount !== 10)) {
        console.log('Patche auf 10€...');
        const newNet = parseFloat((10/1.07).toFixed(2));
        const newVat = parseFloat((newNet*0.07).toFixed(2));
        await req('PATCH', `/invoices/${foundKey}`, { totalGross:10, totalNet:newNet, totalVat:newVat, updatedAt:Date.now() });
        await req('PATCH', `/invoices/${foundKey}/positions/0`, { amount:10, totalGross:10 });
        console.log('✅ Gepatcht!');
    } else {
        console.log('✅ Bereits 10€ in Firebase — Problem ist das PDF');
    }
})().catch(e => console.error('ERROR:', e.message));
