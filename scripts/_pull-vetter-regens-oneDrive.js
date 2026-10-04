#!/usr/bin/env node
// Zieht die 26 heute regenerierten Vetter-Multi-Stop-Rechnungen (v6.66.206-Fix)
// aus Firebase Storage und legt sie in OneDrive/5.Buchfuehrung/Rechnungsausgang/2026/ ab.
// Dateiname: rechnung-20-26-XXXX.pdf

const https = require('https');
const fs = require('fs');
const path = require('path');

const BUCKET = 'taxi-heringsdorf.firebasestorage.app';
const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungsausgang/2026';

const INVOICES = [
    '20-26-2925', '20-26-2933',
    '20-26-2937', '20-26-2938', '20-26-2939', '20-26-2940',
    '20-26-2941', '20-26-2942', '20-26-2943', '20-26-2944',
    '20-26-2945', '20-26-2946', '20-26-2947', '20-26-2948',
    '20-26-2949', '20-26-2950', '20-26-2951', '20-26-2953',
    '20-26-2954', '20-26-2957', '20-26-2959', '20-26-2962',
    '20-26-2963', '20-26-2967', '20-26-2968', '20-26-2972'
];

if (!fs.existsSync(OUT_DIR)) {
    console.error('OneDrive-Zielordner nicht gefunden:', OUT_DIR);
    process.exit(1);
}

function download(invNr) {
    return new Promise((resolve, reject) => {
        const url = `https://storage.googleapis.com/${BUCKET}/invoices/rechnung-${invNr}.pdf`;
        const outFile = path.join(OUT_DIR, `rechnung-${invNr}.pdf`);
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} fuer ${invNr}`));
            }
            const file = fs.createWriteStream(outFile);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                const stat = fs.statSync(outFile);
                resolve({ invNr, outFile, bytes: stat.size });
            });
            file.on('error', reject);
        }).on('error', reject);
    });
}

(async () => {
    let ok = 0, fail = 0;
    for (const inv of INVOICES) {
        try {
            const r = await download(inv);
            console.log(`✅ ${inv} → ${r.bytes.toLocaleString()} bytes`);
            ok++;
        } catch (e) {
            console.error(`❌ ${inv}: ${e.message}`);
            fail++;
        }
    }
    console.log(`\nFertig: ${ok}/${INVOICES.length} erfolgreich${fail ? `, ${fail} Fehler` : ''}`);
    console.log(`Zielordner: ${OUT_DIR}`);
})();
