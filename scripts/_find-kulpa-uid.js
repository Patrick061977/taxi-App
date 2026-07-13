const { execSync } = require('child_process');

const TOKEN = execSync('gcloud auth print-access-token --project=taxi-heringsdorf', {encoding:'utf8'}).trim();
const DB = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

const res = execSync(`curl -s "${DB}/users.json?auth=${TOKEN}"`, {encoding:'utf8', maxBuffer: 50*1024*1024});
const users = JSON.parse(res);

console.log('Suche nach Kulpa / Fahrern...\n');
for (const [uid, u] of Object.entries(users || {})) {
    const n = (u.displayName || u.name || '').toLowerCase();
    const e = (u.email || '').toLowerCase();
    const r = u.role || '';
    // Show all drivers
    if (r === 'driver' || n.includes('kulpa') || n.includes('dariusz') || e.includes('kulpa')) {
        console.log(`UID: ${uid}`);
        console.log(`  Name: ${u.displayName || u.name || '(leer)'}`);
        console.log(`  Email: ${u.email || '(leer)'}`);
        console.log(`  Role: ${r}`);
        console.log(`  vehicleId: ${u.vehicleId || u.vehicle || '(leer)'}`);
        console.log('');
    }
}
