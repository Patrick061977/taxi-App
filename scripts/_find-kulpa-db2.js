const { execSync } = require('child_process');

const TOKEN = execSync('gcloud auth print-access-token --project=taxi-heringsdorf', {encoding:'utf8'}).trim();
const DB = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

// Check specific known UIDs
const uids = [
    'SyJJTsDPkFOofZJXRoWtyW0aovZ2',  // from activeDevice
    '402S0371i7QAE4KD40F3wdyxj123',   // from drivers table (admin?)
    '5Y7LIHYLIMX9fCKpyjzpyyid5Pg1',   // from hw-hy-90 driver
    'd8krpKgnxAOmFDookfndYPYc9sd2',    // from tesla_model3_2
];

console.log('=== Firebase DB /users/{uid} Check ===\n');
for (const uid of uids) {
    const res = execSync(`curl -s "${DB}/users/${uid}.json?auth=${TOKEN}"`, {encoding:'utf8'});
    const u = JSON.parse(res);
    console.log(`UID: ${uid}`);
    console.log(`  Data: ${JSON.stringify(u)}`);
    console.log('');
}

// Check SK-222 full vehicle record
console.log('=== pw-sk-222 full record ===');
const sk = execSync(`curl -s "${DB}/vehicles/pw-sk-222.json?auth=${TOKEN}"`, {encoding:'utf8', maxBuffer: 5*1024*1024});
const skData = JSON.parse(sk);
// Show relevant fields
const relevant = {
    status: skData.status,
    currentDriver: skData.currentDriver,
    activeDevice: skData.activeDevice,
    shift: skData.shift ? {
        status: skData.shift.status,
        driverId: skData.shift.driverId,
        driverName: skData.shift.driverName,
        lastHeartbeat: skData.shift.lastHeartbeat
    } : null
};
console.log(JSON.stringify(relevant, null, 2));
