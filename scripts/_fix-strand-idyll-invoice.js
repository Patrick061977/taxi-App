const { execSync } = require('child_process');

const TOKEN = execSync('gcloud auth print-access-token --project=taxi-heringsdorf', {encoding:'utf8'}).trim();
const DB = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

// Find rides for Strand Idyll
const ridesRes = execSync(`curl -s "${DB}/rides.json?auth=${TOKEN}&orderBy=%22customerName%22&startAt=%22Strand%22&endAt=%22Strand\\uf8ff%22"`, {encoding:'utf8', maxBuffer: 20*1024*1024});
const rides = JSON.parse(ridesRes);

console.log('=== Strand-Idyll Fahrten ===\n');
for (const [id, r] of Object.entries(rides || {})) {
    const n = (r.customerName || r.customer || r.guestName || '').toLowerCase();
    if (n.includes('strand') || n.includes('idyll')) {
        console.log(`ID: ${id}`);
        console.log(`  Name: ${r.customerName || r.customer}`);
        console.log(`  Amount: ${r.price || r.amount || r.invoiceAmount}`);
        console.log(`  invoiceNumber: ${r.invoiceNumber}`);
        console.log(`  invoiceAmount: ${r.invoiceAmount}`);
        console.log(`  invoicePdfUrl: ${r.invoicePdfUrl || '(kein PDF)'}`);
        console.log(`  pdfGenerated: ${r.pdfGenerated}`);
        console.log(`  status: ${r.status}`);
        console.log('');
    }
}

// Also search by customer field broadly
console.log('\n=== Suche über alle Fahrten nach Strand... ===');
const allRes = execSync(`curl -s "${DB}/rides.json?auth=${TOKEN}&shallow=true"`, {encoding:'utf8', maxBuffer: 5*1024*1024});
const allIds = Object.keys(JSON.parse(allRes) || {});
console.log(`Gesamt Fahrten: ${allIds.length}`);
