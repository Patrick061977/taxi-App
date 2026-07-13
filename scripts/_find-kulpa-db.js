const { execSync } = require('child_process');

const TOKEN = execSync('gcloud auth print-access-token --project=taxi-heringsdorf', {encoding:'utf8'}).trim();
const DB = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

// Check all users in Firebase DB
const res = execSync(`curl -s "${DB}/users.json?auth=${TOKEN}&shallow=false"`, {encoding:'utf8', maxBuffer: 50*1024*1024});
const users = JSON.parse(res);

console.log('=== Alle User-Einträge mit Daten ===\n');
let count = 0;
for (const [uid, u] of Object.entries(users || {})) {
    if (!u || typeof u !== 'object') continue;
    const n = JSON.stringify(u).toLowerCase();
    // Show entries that have displayName or role or vehicleId
    if (u.displayName || u.name || u.role || u.vehicleId) {
        console.log(`UID: ${uid}`);
        console.log(`  Name: ${u.displayName || u.name || '?'}`);
        console.log(`  Phone: ${u.phone || u.phoneNumber || '?'}`);
        console.log(`  Role: ${u.role || '?'}`);
        console.log(`  VehicleId: ${u.vehicleId || '?'}`);
        console.log(`  Email: ${u.email || '?'}`);
        count++;
    }
}
console.log(`\nTotal mit Daten: ${count}`);
