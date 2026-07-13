const { execSync } = require('child_process');

const TOKEN = execSync('gcloud auth print-access-token --project=taxi-heringsdorf', {encoding:'utf8'}).trim();
const DB = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

// Check drivers table
const driversRes = execSync(`curl -s "${DB}/drivers.json?auth=${TOKEN}"`, {encoding:'utf8', maxBuffer: 50*1024*1024});
const drivers = JSON.parse(driversRes);

console.log('=== FAHRER (/drivers) ===');
for (const [id, d] of Object.entries(drivers || {})) {
    console.log(`ID: ${id} | Name: ${d.name||d.displayName||'?'} | vehicleId: ${d.vehicleId||'?'} | uid: ${d.uid||d.userId||'?'} | email: ${d.email||'?'}`);
}

// Also check vehicles/sk-222/driver
const skRes = execSync(`curl -s "${DB}/vehicles/pw-sk-222.json?auth=${TOKEN}"`, {encoding:'utf8', maxBuffer: 1024*1024});
const sk = JSON.parse(skRes);
console.log('\n=== pw-sk-222 vehicle ===');
console.log(JSON.stringify({
    currentDriver: sk.currentDriver,
    driverId: sk.driverId,
    userId: sk.userId,
    activeDevice: sk.activeDevice ? { uid: sk.activeDevice.uid, lastHeartbeat: sk.activeDevice.lastHeartbeat } : null,
}, null, 2));
