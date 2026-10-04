#!/usr/bin/env node
// Sortiert die 26 heute heruntergeladenen Rechnungen aus OneDrive/Rechnungsausgang/2026/
// in Monats-Unterordner (2026-07/, 2026-08/, 2026-09/, 2026-10/).
// Fahrtdaten:
//   - 2925 Seidner 03.10. → 2026-10
//   - 2933 Vetter 18.07. → 2026-07
//   - 2937-2941 Vetter Juli 2026
//   - 2942-2950 Vetter August 2026
//   - 2951-2972 Vetter September 2026

const fs = require('fs');
const path = require('path');

const BASE = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungsausgang/2026';

const MAPPING = {
    '20-26-2925': '2026-10',  // Seidner 03.10.26
    '20-26-2933': '2026-07',  // Vetter 18.07.26 (hin)
    // Jul-Sep (aus _vetter-trips-jul-sep.json Reihenfolge)
    '20-26-2937': '2026-07',  // 11.07.
    '20-26-2938': '2026-07',  // 25.07.
    '20-26-2939': '2026-07',  // 25.07.
    '20-26-2940': '2026-08',  // 01.08.
    '20-26-2941': '2026-08',  // 01.08.
    '20-26-2942': '2026-08',  // 08.08.
    '20-26-2943': '2026-08',  // 08.08.
    '20-26-2944': '2026-08',  // 15.08.
    '20-26-2945': '2026-08',  // 15.08.
    '20-26-2946': '2026-08',  // 15.08.
    '20-26-2947': '2026-08',  // 22.08.
    '20-26-2948': '2026-08',  // 22.08.
    '20-26-2949': '2026-08',  // 29.08.
    '20-26-2950': '2026-08',  // 29.08.
    '20-26-2951': '2026-09',  // 05.09.
    '20-26-2953': '2026-09',  // 05.09.
    '20-26-2954': '2026-09',  // 05.09.
    '20-26-2957': '2026-09',  // 12.09.
    '20-26-2959': '2026-09',  // 12.09.
    '20-26-2962': '2026-09',  // 12.09.
    '20-26-2963': '2026-09',  // 19.09.
    '20-26-2967': '2026-09',  // 19.09.
    '20-26-2968': '2026-09',  // 26.09.
    '20-26-2972': '2026-09'   // 26.09.
};

let moved = 0, skipped = 0;
for (const [inv, month] of Object.entries(MAPPING)) {
    const src = path.join(BASE, `rechnung-${inv}.pdf`);
    const dstDir = path.join(BASE, month);
    const dst = path.join(dstDir, `rechnung-${inv}.pdf`);
    if (!fs.existsSync(src)) {
        console.log(`❌ Quelle fehlt: ${src}`);
        skipped++;
        continue;
    }
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    if (fs.existsSync(dst)) {
        console.log(`⚠️  Ziel existiert, ueberschreibe: ${dst}`);
        fs.unlinkSync(dst);
    }
    fs.renameSync(src, dst);
    console.log(`✅ ${inv} → ${month}/`);
    moved++;
}
console.log(`\nFertig: ${moved} verschoben, ${skipped} skipped`);
