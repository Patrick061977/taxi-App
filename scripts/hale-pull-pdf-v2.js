// Hale-PDF-Pull v2 — basiert auf Inspect-Erkenntnissen
// Wichtigster Fix: PDF-Format-Setzen mit MEHRFACHEM Trigger (selectpicker + change-Event)
// + groesseres Timeout vor Submit + saubere Response-Filter

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';

const YEAR = process.env.YEAR ? parseInt(process.env.YEAR, 10) : 2025;
const OUT_BASE = `C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/${YEAR}`;
const OUT_DIR_7 = OUT_BASE + '/7-Prozent';
const OUT_DIR_19 = OUT_BASE + '/19-Prozent';
fs.mkdirSync(OUT_DIR_7, { recursive: true });
fs.mkdirSync(OUT_DIR_19, { recursive: true });

const REPORTS = {
    'daily-7': { gridIndex: 3, label: 'Taxiabrechnung-07' },
    'daily-19': { gridIndex: 6, label: 'Taxiabrechnung-19' }
};
const MODE = process.env.MODE || 'daily-7';
const cfg = REPORTS[MODE];

function pad(n) { return String(n).padStart(2, '0'); }
function ddmmyyyy(d) { return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`; }
function yyyymmdd(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

async function setPdfFormat(page) {
    return await page.evaluate(() => {
        const sel = document.getElementById('selectedExportOptionDropDown');
        if (!sel) return 'NO_SELECT';
        const opts = Array.from(sel.options);
        const pdfOpt = opts.find(o => /pdf/i.test(o.text));
        if (!pdfOpt) return 'NO_PDF_OPTION';
        sel.value = pdfOpt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof window.$ !== 'undefined' && typeof $(sel).selectpicker === 'function') {
            try { $(sel).selectpicker('val', pdfOpt.value); $(sel).selectpicker('refresh'); } catch(e) {}
        }
        return 'PDF_SET:' + pdfOpt.value;
    });
}

async function pullForDate(page, context, dateFrom, dateTo, outFile, outDir) {
    // 1. Datum setzen
    await page.evaluate(({ from, to }) => {
        const start = document.getElementById('start');
        const stop = document.getElementById('stop');
        if (start) { start.removeAttribute('readonly'); start.value = from; start.dispatchEvent(new Event('input', { bubbles: true })); start.dispatchEvent(new Event('change', { bubbles: true })); }
        if (stop) { stop.removeAttribute('readonly'); stop.value = to; stop.dispatchEvent(new Event('input', { bubbles: true })); stop.dispatchEvent(new Event('change', { bubbles: true })); }
    }, { from: dateFrom, to: dateTo });
    await page.waitForTimeout(800);

    // 2. PDF-Format setzen (zwei Versuche)
    let pdfResult = await setPdfFormat(page);
    if (!pdfResult.startsWith('PDF_SET')) {
        await page.waitForTimeout(500);
        pdfResult = await setPdfFormat(page);
    }
    LOG('  PDF-Format: ' + pdfResult);
    await page.waitForTimeout(800);

    // 3. Sammle PDF-URLs (aller pdf-responses) — am Ende direkt fetchen
    const pdfUrls = new Set();
    let pdfBuffer = null;
    let captured = false;
    const onResponse = (response) => {
        try {
            const url = response.url();
            if (/hale\.de.*EventReport.*\.pdf/i.test(url)) {
                pdfUrls.add(url);
            }
        } catch (e) {}
    };
    page.on('response', onResponse);
    context.on('page', np => np.on('response', onResponse));

    // 4. Klick auf "Bericht anzeigen"
    await page.locator('#getReportDataSubmitItem').click();

    // 5. Warte bis PDF-URL gesammelt (max 20s)
    const startWait = Date.now();
    while (pdfUrls.size === 0 && (Date.now() - startWait) < 20000) {
        await page.waitForTimeout(500);
    }
    page.off('response', onResponse);

    if (pdfUrls.size === 0) {
        LOG(`  ⚠️ KEINE PDF-URL erkannt fuer ${dateFrom}`);
        return false;
    }

    // 6. Direktes Fetchen via context.request (umgeht Browser-Cache-Probleme)
    for (const url of pdfUrls) {
        try {
            const resp = await context.request.get(url);
            if (resp.ok()) {
                const body = await resp.body();
                if (body.length > 1000) {
                    pdfBuffer = body;
                    LOG(`  📦 PDF ${Math.round(body.length/1024)} KB via direct-fetch`);
                    break;
                }
            }
        } catch (e) { LOG('  fetch err: ' + e.message.slice(0, 50)); }
    }
    if (!pdfBuffer) { LOG('  ⚠️ Fetch alle URLs fehlgeschlagen'); return false; }

    const dest = path.join(outDir, outFile);
    fs.writeFileSync(dest, pdfBuffer);
    return true;
}

(async () => {
    const browser = await chromium.launch({ headless: process.env.HEADLESS === '1', args: ['--start-maximized'], slowMo: process.env.HEADLESS === '1' ? 0 : 50 });
    const context = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await context.newPage();
    try {
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) { await inputs[0].fill(EMAIL); await inputs[1].fill(PASS); await inputs[2].fill(IDNR); }
        const submit = await page.$('button[type="submit"]');
        if (submit) await submit.click();
        await page.waitForTimeout(5000);
        LOG('Login OK');
        const aus = await page.$('a:has-text("Auswertung")');
        if (aus) { await aus.click(); await page.waitForTimeout(3500); }

        LOG(`Klick grid_${cfg.gridIndex}_edit ...`);
        await page.evaluate((idx) => document.getElementById(`grid_${idx}_edit`)?.click(), cfg.gridIndex);
        await page.waitForTimeout(3500);
        LOG('Detail-Seite geladen.');

        const outDir = MODE === 'daily-7' ? OUT_DIR_7 : OUT_DIR_19;
        const startStr = process.env.START_DATE;
        const endStr = process.env.END_DATE;
        const datesEnv = process.env.DATES;
        let dates = [];
        if (datesEnv) {
            dates = datesEnv.split(',').filter(Boolean).map(s => new Date(s));
        } else {
            const start = startStr ? new Date(startStr) : new Date(YEAR, 0, 1);
            const end = endStr ? new Date(endStr) : new Date(YEAR, 11, 31);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) dates.push(new Date(d));
        }

        let done = 0, fail = 0;
        for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            const dStr = ddmmyyyy(d);
            const fn = `${cfg.label}_${yyyymmdd(d)}.pdf`;
            if (fs.existsSync(path.join(outDir, fn))) { LOG(`skip ${fn}`); continue; }
            LOG(`[${i+1}/${dates.length}] ${dStr} ...`);
            const ok = await pullForDate(page, context, dStr, dStr, fn, outDir);
            if (ok) {
                done++;
                LOG(`  ✅ ${fn}`);
            } else fail++;
            await page.waitForTimeout(1500);
        }
        LOG(`Done: ${done} OK / ${fail} fail`);
    } catch (e) {
        LOG('💥', e.message);
    } finally {
        await page.waitForTimeout(2000);
        await browser.close();
    }
})();
