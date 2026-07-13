const { execSync } = require('child_process');

const TOKEN = execSync('gcloud auth print-access-token --project=taxi-heringsdorf', {encoding:'utf8'}).trim();
const DB = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

// Check rides-archive
const paths = ['/rides', '/rides-archive', '/invoices'];

for (const path of paths) {
    console.log(`\n=== ${path} (shallow) ===`);
    const res = execSync(`curl -s "${DB}${path}.json?auth=${TOKEN}&shallow=true"`, {encoding:'utf8', maxBuffer: 5*1024*1024});
    const data = JSON.parse(res);
    if (data && data.error) {
        console.log('Error:', data.error);
        continue;
    }
    const keys = Object.keys(data || {});
    console.log(`Count: ${keys.length}`);
}

// Try to find Strand Idyll in CRM
console.log('\n=== CRM Kunden Suche: Strand ===');
const crmRes = execSync(`curl -s "${DB}/customers.json?auth=${TOKEN}&orderBy=%22name%22&startAt=%22Strand%22&endAt=%22Strand\\uf8ff%22"`, {encoding:'utf8', maxBuffer: 10*1024*1024});
const crm = JSON.parse(crmRes);
for (const [id, c] of Object.entries(crm || {})) {
    console.log(`CRM ID: ${id} | Name: ${c.name} | invoices: ${JSON.stringify(c.invoices||{})}`);
}
