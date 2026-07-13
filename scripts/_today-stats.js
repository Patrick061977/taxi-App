#!/usr/bin/env node
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
function ber(ts) { return new Date(ts).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }); }

(async () => {
    const rides = await get('/rides.json');
    if (!rides) { console.log('keine rides'); return; }

    const today = new Date();
    today.setHours(0,0,0,0);
    const todayStart = today.getTime();
    const todayEnd = todayStart + 86400000;

    const todayRides = Object.entries(rides)
        .filter(([k,v]) => v && v.pickupTimestamp && v.pickupTimestamp >= todayStart && v.pickupTimestamp < todayEnd)
        .sort((a,b) => a[1].pickupTimestamp - b[1].pickupTimestamp);

    console.log(`\n📊 HEUTE ${new Date().toLocaleDateString('de-DE')} — ${todayRides.length} Fahrten total\n`);

    const byStatus = {};
    const byVehicle = {};
    let totalPax = 0;
    let revenue = 0;
    const vehiclesUsed = new Set();

    for (const [k, r] of todayRides) {
        const s = r.status || 'unknown';
        byStatus[s] = (byStatus[s] || 0) + 1;
        const vid = r.assignedVehicle || r.vehicleId || 'unzugewiesen';
        if (vid !== 'unzugewiesen') vehiclesUsed.add(vid);
        byVehicle[vid] = (byVehicle[vid] || 0) + 1;
        totalPax += r.passengers || 1;
        if (s === 'completed' && r.price) revenue += parseFloat(r.price) || 0;

        const emoji = {completed:'✅', cancelled:'❌', storniert:'❌', wartepool:'⚠️', new:'🆕', vorbestellt:'📅', assigned:'🚗', accepted:'🔑', on_way:'🚕', picked_up:'🧍', arrived:'📍'}[s] || '❓';
        console.log(`  ${emoji} ${ber(r.pickupTimestamp)} ${r.customerName?.padEnd(25)||'?'} ${String(r.passengers||1).padStart(2)}P  ${(vid).padEnd(15)} ${s}`);
    }

    console.log('\n━━━ ZUSAMMENFASSUNG ━━━');
    console.log('Status:');
    Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).forEach(([s,n])=>console.log(`  ${s}: ${n}`));
    console.log('\nFahrzeuge:');
    Object.entries(byVehicle).sort((a,b)=>b[1]-a[1]).forEach(([v,n])=>console.log(`  ${v}: ${n} Fahrten`));
    console.log(`\n👥 Gesamt Personen: ${totalPax}`);
    console.log(`💰 Umsatz (completed): ${revenue.toFixed(2)} €`);
    console.log(`🚗 Aktive Fahrzeuge heute: ${vehiclesUsed.size} (${[...vehiclesUsed].join(', ')})`);

    // Peak-Stunden berechnen
    const byHour = {};
    for (const [k,r] of todayRides) {
        const h = new Date(r.pickupTimestamp).getHours();
        byHour[h] = (byHour[h]||0)+1;
    }
    const peakH = Object.entries(byHour).sort((a,b)=>b[1]-a[1]).slice(0,3);
    console.log('\n⏰ Peak-Stunden:', peakH.map(([h,n])=>`${h}:00 (${n})`).join(', '));

    // Wartepool-Fahrten
    const wp = todayRides.filter(([k,r])=>r.status==='wartepool'||r.wartepoolActive);
    if (wp.length) console.log(`\n⚠️ Wartepool jetzt: ${wp.length} Fahrt(en)`);
    const unassigned = todayRides.filter(([k,r])=>!r.assignedVehicle&&!r.vehicleId&&r.status==='new');
    if (unassigned.length) console.log(`🆕 Unzugewiesen (new): ${unassigned.length} Fahrt(en)`);
})().catch(e => console.error('ERROR:', e.message));
