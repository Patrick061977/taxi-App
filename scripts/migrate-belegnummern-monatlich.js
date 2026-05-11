// v6.62.600: Migration auf monatliche Belegnummern (Patrick 11.05. 07:50)
const { execSync } = require('child_process');
const fs = require('fs');

const PROJECT = 'taxi-heringsdorf';
const ENV = { ...process.env, MSYS_NO_PATHCONV: '1' };

console.log('1) Lade /docs...');
execSync(`firebase database:get /docs --project ${PROJECT} -o tmp-mig-docs.json`, { env: ENV, stdio: 'inherit' });
const docs = JSON.parse(fs.readFileSync('tmp-mig-docs.json', 'utf8') || '{}');

const docArr = Object.entries(docs).map(([k, v]) => ({ id: k, ...v }))
    .filter(d => d.datum)
    .sort((a, b) => (a.datum || '').localeCompare(b.datum || '') || (a.uploadedAt || 0) - (b.uploadedAt || 0));

console.log(`\n2) ${docArr.length} Docs sortiert nach Datum. Neue Belegnummern:`);
const monthCounters = {};
const flatUpdate = {};

for (const d of docArr) {
    const y = d.datum.slice(0, 4);
    const m = d.datum.slice(5, 7);
    const key = `${y}-M${m}`;
    monthCounters[key] = (monthCounters[key] || 0) + 1;
    const neueNummer = `${y}-M${m}-${String(monthCounters[key]).padStart(4, '0')}`;
    const monat = `M${m}`;

    console.log(`   ${d.id.slice(0, 16).padEnd(16)} | ${d.datum} | ${(d.belegnummer || '?').padEnd(16)} → ${neueNummer}`);

    flatUpdate[`docs/${d.id}/belegnummer`] = neueNummer;
    flatUpdate[`docs/${d.id}/belegMonat`] = monat;
    flatUpdate[`docs/${d.id}/belegQuartal`] = monat;
    flatUpdate[`docs/${d.id}/belegJahr`] = Number(y);
    flatUpdate[`docs/${d.id}/belegnummerMigratedFrom`] = d.belegnummer || null;
    flatUpdate[`docs/${d.id}/belegnummerMigratedAt`] = Date.now();
}

console.log('\n3) Monatszaehler:');
for (const [k, v] of Object.entries(monthCounters)) {
    flatUpdate[`settings/dms/belegCounter/${k}`] = v;
    console.log(`   ${k}: ${v}`);
}

console.log(`\n4) Schreibe ${Object.keys(flatUpdate).length} Pfade per multi-path update auf /...`);
fs.writeFileSync('tmp-mig-patch.json', JSON.stringify(flatUpdate, null, 2));
try {
    execSync(`firebase database:update / tmp-mig-patch.json --project ${PROJECT} -f`, { env: ENV, stdio: 'inherit' });
    console.log('\n✅ Migration erfolgreich.');
} catch (e) {
    console.error('\n❌ Migration fehlgeschlagen:', e.message);
    process.exit(1);
}
fs.unlinkSync('tmp-mig-docs.json');
fs.unlinkSync('tmp-mig-patch.json');
