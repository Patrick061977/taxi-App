// hale-pull-2025-pdf.js — PDF-Format diesmal (statt XLS)
// Patrick (24.05.2026 22:11): braucht ECHTE Hale-PDFs mit Logo + Datum-Bereich
// Strategie: Format='PDF', dann inline-PDF abfangen mit page.on('response')

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
if (!cfg) { console.error('Unknown MODE:', MODE); process.exit(1); }

function pad(n) { return String(n).padStart(2, '0'); }
function ddmmyyyy(d) { return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`; }
function yyyymmdd(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

async function setupReport(page, gridIndex) {
    LOG(`Klick grid_${gridIndex}_edit ...`);
    await page.evaluate((idx) => {
        const el = document.getElementById(`grid_${idx}_edit`);
        if (el) el.click();
    }, gridIndex);
    await page.waitForTimeout(3500);
    LOG('Detail-Seite geladen.');
}

async function pullForDate(page, context, dateFrom, dateTo, outFile) {
    // Date setzen
    await page.evaluate(({ from, to }) => {
        const start = document.getElementById('start');
        const stop = document.getElementById('stop');
        if (start) { start.removeAttribute('readonly'); start.value = from; start.dispatchEvent(new Event('input', { bubbles: true })); start.dispatchEvent(new Event('change', { bubbles: true })); }
        if (stop) { stop.removeAttribute('readonly'); stop.value = to; stop.dispatchEvent(new Event('input', { bubbles: true })); stop.dispatchEvent(new Event('change', { bubbles: true })); }
    }, { from: dateFrom, to: dateTo });
    await page.waitForTimeout(500);

    // PDF-Format selektieren
    await page.evaluate(() => {
        const sel = document.getElementById('selectedExportOptionDropDown');
        if (sel) {
            const opts = Array.from(sel.options);
            const pdf = opts.find(o => /pdf/i.test(o.text)) || opts[0];
            if (pdf) {
                sel.value = pdf.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof window.$ !== 'undefined') $(sel).selectpicker('refresh');
            }
        }
    });
    await page.waitForTimeout(300);

    // PDF-Response abfangen — NUR application/pdf von /DC/temp/.../EventReport*.pdf
    let pdfBuffer = null;
    let captured = false;
    const onResponse = async (response) => {
        try {
            if (captured) return;
            const ct = (response.headers()['content-type'] || '').toLowerCase();
            const url = response.url();
            // Strikt: nur 'application/pdf' UND URL enthält EventReport
            if (ct === 'application/pdf' && /EventReport/i.test(url)) {
                const body = await response.body();
                if (body.length > 1000) {  // mind 1 KB damit nicht HTML-Errorpage zaehlt
                    pdfBuffer = body;
                    captured = true;
                    LOG('  📦 PDF abgefangen ' + Math.round(body.length/1024) + ' KB url=' + url.slice(-60));
                }
            }
        } catch (e) { /* ignore */ }
    };
    page.on('response', onResponse);
    context.on('page', np => np.on('response', onResponse));

    // Klick auf Bericht anzeigen
    LOG('Klicke Bericht anzeigen...');
    await page.locator('#getReportDataSubmitItem').click();

    // Warte bis PDF da
    const startWait = Date.now();
    while (!captured && (Date.now() - startWait) < 30000) {
        await page.waitForTimeout(500);
    }

    page.off('response', onResponse);

    if (!pdfBuffer) {
        LOG(`  ⚠️ KEIN PDF abgefangen fuer ${dateFrom}`);
        return false;
    }
    const dest = path.join(MODE === 'daily-7' ? OUT_DIR_7 : OUT_DIR_19, outFile);
    fs.writeFileSync(dest, pdfBuffer);
    LOG(`  ✅ ${outFile} (${Math.round(pdfBuffer.length/1024)} KB)`);
    return true;
}

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 50 });
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

        await setupReport(page, cfg.gridIndex);

        // Datumsbereich
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
        for (const d of dates) {
            const dStr = ddmmyyyy(d);
            const fn = `${cfg.label}_${yyyymmdd(d)}.pdf`;
            const outDir = MODE === 'daily-7' ? OUT_DIR_7 : OUT_DIR_19;
            if (fs.existsSync(path.join(outDir, fn))) { LOG(`skip ${fn}`); continue; }
            const ok = await pullForDate(page, context, dStr, dStr, fn);
            if (ok) done++; else fail++;
            await page.waitForTimeout(1000);
            if ((done+fail) % 25 === 0) LOG(`Progress: ${done} OK, ${fail} fail`);
        }
        LOG(`Done: ${done} OK / ${fail} fail`);
    } catch (e) {
        LOG('💥', e.message);
    } finally {
        await page.waitForTimeout(2000);
        await browser.close();
    }
})();
