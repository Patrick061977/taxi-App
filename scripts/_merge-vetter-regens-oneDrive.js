#!/usr/bin/env node
// v6.66.206-Regen Vetter-Rechnungen (2937-2972) mit den passenden Auftrags-PDFs
// aus OneDrive/1.Taxi/Taxi-Vetter/2026/{Monat}/ mergen und als gemergtes PDF ablegen.
// Mapping-Quelle: scripts/_merge-all-mai-juni.sh + _merge-all-jul-sep.sh
//
// Nutzung:
//   node scripts/_merge-vetter-regens-oneDrive.js             (dry-run, zeigt nur was)
//   node scripts/_merge-vetter-regens-oneDrive.js --apply     (schreibt)

const fs = require('fs');
const path = require('path');
const { merge } = require('./_merge-rechnung-auftrag');

const APPLY = process.argv.includes('--apply');
const RECHNUNGEN_BASE = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungsausgang/2026';
const VETTER_BASE = 'C:/Users/Taxi/OneDrive/1.Taxi/Taxi-Vetter/2026';

// invoiceNr | desc | auftragPdf | monthSubdir
const JOBS = [
    // === Mai+Juni ===
    { nr: '2937', desc: '16.05.2026_Rechnung_Ankunft_6Pax',   auftrag: '2026-05-11_Transfer_16.05.2026_doc01356820260511104800.pdf', sub: '05-Mai' },
    { nr: '2938', desc: '23.05.2026_Rechnung_Ankunft_6Pax',   auftrag: '2026-05-15_Transfer_23.05.2026_doc01405020260515093947.pdf', sub: '05-Mai' },
    { nr: '2939', desc: '23.05.2026_Rechnung_Abreise_4Pax',   auftrag: '2026-05-15_Transfer_23.05.2026_doc01405020260515093947.pdf', sub: '05-Mai' },
    { nr: '2940', desc: '06.06.2026_Rechnung_Ankunft_8Pax',   auftrag: '2026-05-26_06.06.2026_doc01526820260526145320.pdf',          sub: '06-Juni' },
    { nr: '2941', desc: '06.06.2026_Rechnung_Abreise_3Pax',   auftrag: '2026-05-26_06.06.2026_doc01526820260526145320.pdf',          sub: '06-Juni' },
    { nr: '2942', desc: '13.06.2026_Rechnung_Ankunft_7Pax',   auftrag: '2026-06-05_Transfere_13.06.2026_doc01642220260605104347.pdf', sub: '06-Juni' },
    { nr: '2943', desc: '13.06.2026_Rechnung_Abreise_8Pax',   auftrag: '2026-06-05_Transfere_13.06.2026_doc01642220260605104347.pdf', sub: '06-Juni' },
    { nr: '2944', desc: '20.06.2026_Rechnung_Ankunft_5Pax',   auftrag: '2026-06-12_Transfere_20.06.2026_doc01738720260612093254.pdf', sub: '06-Juni' },
    { nr: '2945', desc: '20.06.2026_Rechnung_Abreise_7Pax',   auftrag: '2026-06-12_Transfere_20.06.2026_doc01738720260612093254.pdf', sub: '06-Juni' },
    { nr: '2946', desc: '27.06.2026_Rechnung_Ankunft_4Pax',   auftrag: '2026-06-18_Transfere_27.06.2026_doc01826820260618153206.pdf', sub: '06-Juni' },
    { nr: '2947', desc: '27.06.2026_Rechnung_Abreise_5Pax',   auftrag: '2026-06-18_Transfere_27.06.2026_doc01826820260618153206.pdf', sub: '06-Juni' },
    { nr: '2948', desc: '18.07.2026_Rechnung_Ankunft_7Pax',   auftrag: '2026-07-08_Transfere_18.07.2026_doc02049520260708130602.pdf', sub: '07-Juli' },
    // === Juli-September ===
    { nr: '2949', desc: '11.07.2026_Rechnung_Ankunft_4Pax',             auftrag: '2026-07-03_Transfer_11.07.2026_doc01987620260703090753.pdf',               sub: '07-Juli' },
    { nr: '2950', desc: '25.07.2026_Rechnung_Ankunft_5Pax',             auftrag: '2026-07-20_Transfere_25.07.2026_doc02139720260720145808.pdf',              sub: '07-Juli' },
    { nr: '2951', desc: '25.07.2026_Rechnung_Abreise_7Pax',             auftrag: '2026-07-20_Transfere_25.07.2026_doc02139720260720145808.pdf',              sub: '07-Juli' },
    { nr: '2952', desc: '01.08.2026_Rechnung_Ankunft_4Pax',             auftrag: '2026-07-22_Transfere_01.08.2026_doc02163520260722103653.pdf',              sub: '08-August' },
    { nr: '2953', desc: '01.08.2026_Rechnung_Abreise_7Pax',             auftrag: '2026-07-22_Transfere_01.08.2026_doc02163520260722103653.pdf',              sub: '08-August' },
    { nr: '2954', desc: '08.08.2026_Rechnung_Ankunft_5Pax',             auftrag: '2026-07-29_Transfere_08.08.2026_doc02218820260729143540.pdf',              sub: '08-August' },
    { nr: '2955', desc: '08.08.2026_Rechnung_Abreise_2Pax',             auftrag: '2026-07-29_Transfere_08.08.2026_doc02218820260729143540.pdf',              sub: '08-August' },
    { nr: '2956', desc: '15.08.2026_Rechnung_Ankunft_2Pax',             auftrag: '2026-08-10_Transfere_15.08._und_22.08.2026_doc02327920260810104148.pdf',   sub: '08-August' },
    { nr: '2957', desc: '15.08.2026_Rechnung_Abreise_6Pax_FahrzeugA',   auftrag: '2026-08-10_Transfere_15.08._und_22.08.2026_doc02327920260810104148.pdf',   sub: '08-August' },
    { nr: '2958', desc: '15.08.2026_Rechnung_Abreise_3Pax_FahrzeugB',   auftrag: '2026-08-10_Transfere_15.08._und_22.08.2026_doc02327920260810104148.pdf',   sub: '08-August' },
    { nr: '2959', desc: '22.08.2026_Rechnung_Ankunft_2Pax',             auftrag: '2026-08-10_Transfere_15.08._und_22.08.2026_doc02327920260810104148.pdf',   sub: '08-August' },
    { nr: '2960', desc: '22.08.2026_Rechnung_Abreise_2Pax',             auftrag: '2026-08-10_Transfere_15.08._und_22.08.2026_doc02327920260810104148.pdf',   sub: '08-August' },
    { nr: '2961', desc: '29.08.2026_Rechnung_Ankunft_5Pax',             auftrag: '2026-08-24_Transfere_29.08.2026_doc02494920260824111354.pdf',              sub: '08-August' },
    { nr: '2962', desc: '29.08.2026_Rechnung_Abreise_2Pax',             auftrag: '2026-08-24_Transfere_29.08.2026_doc02494920260824111354.pdf',              sub: '08-August' },
    { nr: '2963', desc: '05.09.2026_Rechnung_Ankunft_6Pax_FahrzeugA',   auftrag: '2026-08-28_Transfere_05.09.2026_doc02573120260828123852.pdf',              sub: '09-September' },
    { nr: '2964', desc: '05.09.2026_Rechnung_Ankunft_3Pax_FahrzeugB_Nautic', auftrag: '2026-08-28_Transfere_05.09.2026_doc02573120260828123852.pdf',          sub: '09-September' },
    { nr: '2965', desc: '05.09.2026_Rechnung_Abreise_5Pax',             auftrag: '2026-08-28_Transfere_05.09.2026_doc02573120260828123852.pdf',              sub: '09-September' },
    { nr: '2966', desc: '12.09.2026_Rechnung_Abreise_3Pax_FahrzeugB_Nautic', auftrag: '2026-09-04_Transfere_12.09.2026_doc02659920260904090537.pdf',          sub: '09-September' },
    { nr: '2967', desc: '12.09.2026_Rechnung_Abreise_6Pax_FahrzeugA',   auftrag: '2026-09-04_Transfere_12.09.2026_doc02659920260904090537.pdf',              sub: '09-September' },
    { nr: '2968', desc: '12.09.2026_Rechnung_Ankunft_3Pax',             auftrag: '2026-09-04_Transfere_12.09.2026_doc02659920260904090537.pdf',              sub: '09-September' },
    { nr: '2969', desc: '19.09.2026_Rechnung_Abreise_1Pax',             auftrag: '2026-09-10_Transfere_19.09.2026_doc02731020260910100837.pdf',              sub: '09-September' },
    { nr: '2970', desc: '19.09.2026_Rechnung_Ankunft_2Pax',             auftrag: '2026-09-10_Transfere_19.09.2026_doc02731020260910100837.pdf',              sub: '09-September' },
    { nr: '2971', desc: '26.09.2026_Rechnung_Ankunft_2Pax',             auftrag: '2026-09-17_Transfere_26.09.2026_doc02824420260917095753.pdf',              sub: '09-September' },
    { nr: '2972', desc: '26.09.2026_Rechnung_Abreise_4Pax',             auftrag: '2026-09-17_Transfere_26.09.2026_doc02824420260917095753.pdf',              sub: '09-September' }
];

// Finde Rechnungs-PDF in den Monats-Unterordnern
function findRechnung(nr) {
    for (const month of ['2026-07', '2026-08', '2026-09', '2026-10']) {
        const p = path.join(RECHNUNGEN_BASE, month, `rechnung-20-26-${nr}.pdf`);
        if (fs.existsSync(p)) return p;
    }
    // Fallback: flat
    const p2 = path.join(RECHNUNGEN_BASE, `rechnung-20-26-${nr}.pdf`);
    if (fs.existsSync(p2)) return p2;
    return null;
}

(async () => {
    let ok = 0, missing = 0, skipped = 0;
    for (const job of JOBS) {
        const rechnungPdf = findRechnung(job.nr);
        if (!rechnungPdf) {
            console.log(`❌ 20-26-${job.nr}: Rechnungs-PDF nicht gefunden`);
            missing++;
            continue;
        }
        const auftragPdf = path.join(VETTER_BASE, job.sub, job.auftrag);
        if (!fs.existsSync(auftragPdf)) {
            console.log(`⚠️  20-26-${job.nr}: Auftrag-PDF fehlt (${job.sub}/${job.auftrag})`);
            missing++;
            continue;
        }
        const outPath = path.join(VETTER_BASE, job.sub, `${job.desc}_20-26-${job.nr}.pdf`);
        if (!APPLY) {
            console.log(`DRY ${job.sub}/${job.desc}_20-26-${job.nr}.pdf`);
            skipped++;
            continue;
        }
        try {
            await merge(rechnungPdf, auftragPdf, outPath);
            ok++;
        } catch (e) {
            console.log(`❌ 20-26-${job.nr}: merge-Fehler: ${e.message}`);
            missing++;
        }
    }
    console.log(`\nFertig: ${ok} gemerged, ${missing} fehlgeschlagen${!APPLY ? `, ${skipped} dry-run` : ''}`);
    if (!APPLY) console.log('   → mit --apply nochmal ausfuehren um tatsaechlich zu schreiben');
})();
