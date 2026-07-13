#!/usr/bin/env node
// Fixe die ungerundeten totalNet/totalVat in 20-26-1292
const { execSync } = require('child_process');
const https = require('https');
const RTDB_HOST = 'taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';
function getToken() { return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim(); }
function req(method, path, body) {
    return new Promise((resolve, reject) => {
        const token = getToken();
        const bodyStr = body !== undefined ? JSON.stringify(body) : null;
        const opts = { hostname: RTDB_HOST, path: path + '?access_token=' + token, method, headers: { 'Content-Type': 'application/json' } };
        if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        const r = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d || 'null')); } catch(e) { resolve(d); } }); });
        r.on('error', reject);
        if (bodyStr) r.write(bodyStr);
        r.end();
    });
}
(async () => {
    const newNet = parseFloat((10 / 1.07).toFixed(2)); // 9.35
    const newVat = parseFloat((10 - newNet).toFixed(2)); // 0.65
    await req('PATCH', '/invoices/20-26-1292', { totalNet: newNet, totalVat: newVat, updatedAt: Date.now() });
    console.log(`✅ 20-26-1292 totalNet=${newNet} totalVat=${newVat} gesetzt`);
})().catch(e => console.error('ERROR:', e.message));
