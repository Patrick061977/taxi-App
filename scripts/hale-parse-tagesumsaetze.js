// Parse HALE-Tagesabrechnungen → CSV mit Datum + Brutto-Umsatz
// Patrick (29.05. 07:51): Statistik 2025-2026 für 7% USt aus HALE-PDFs.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_2025_7 = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/2025/7-Prozent';
const ROOT_2026_7 = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/2026/7-Prozent';
const OUT_CSV = 'C:/Taxi App/taxi-App-github/.hale-tagesumsaetze-2025-2026.csv';

function parsePdf(filepath) {
    try {
        const txt = execSync(`pdftotext -layout "${filepath}" -`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        const m = txt.match(/Bruttoumsatz:\s*([\d.]+,\d{2})/);
        if (!m) return null;
        return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    } catch (e) {
        return null;
    }
}

function dateFromFilename(fn) {
    const m = fn.match(/(\d{4})-(\d{2})-(\d{2})\.pdf/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const rows = [];
let parsed = 0, failed = 0;
const t0 = Date.now();

for (const dir of [ROOT_2025_7, ROOT_2026_7]) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
    files.sort();
    process.stdout.write(`[${path.basename(path.dirname(dir))}] ${files.length} Files: `);
    for (const f of files) {
        const date = dateFromFilename(f);
        if (!date) { failed++; continue; }
        const brutto = parsePdf(path.join(dir, f));
        if (brutto != null) {
            rows.push({ date, brutto });
            parsed++;
        } else {
            failed++;
        }
        if (parsed % 50 === 0) process.stdout.write('.');
    }
    process.stdout.write('\n');
}

console.log(`\n✅ Parsed ${parsed} Tage, ${failed} Fails in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
rows.sort((a, b) => a.date.localeCompare(b.date));
const csv = 'date;brutto\n' + rows.map(r => `${r.date};${r.brutto.toFixed(2)}`).join('\n');
fs.writeFileSync(OUT_CSV, csv);
console.log(`Saved: ${OUT_CSV}`);

// Mini-Aggregate
const byMonth = {};
for (const r of rows) {
    const ym = r.date.slice(0, 7);
    if (!byMonth[ym]) byMonth[ym] = { sum: 0, days: 0 };
    byMonth[ym].sum += r.brutto;
    byMonth[ym].days++;
}
console.log('\n📊 Monatsumsätze 7% USt (brutto):');
for (const ym of Object.keys(byMonth).sort()) {
    const v = byMonth[ym];
    console.log(`  ${ym}: ${v.sum.toFixed(2).padStart(10)} EUR (${v.days} Tage, ⌀ ${(v.sum / v.days).toFixed(2)} EUR/Tag)`);
}
