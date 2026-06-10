// hale-pull-2025.js — v4 mit korrekten Selectors fuer Hale-UI 2026
// Workflow:
//  - Mode 'overview': 1 Pull Taxiabrechnung Detail 01.01.-31.12.2025 (Gesamt)
//  - Mode 'daily-7': 365 Pulls Taxiabrechnung 07% pro Tag
//  - Mode 'daily-19': nur fuer Tage mit 19%-Umsatz aus overview
//
// Verwendung:
//   MODE=overview node scripts/hale-pull-2025.js
//   MODE=daily-7 node scripts/hale-pull-2025.js
//   MODE=daily-19 DATES=2025-01-15,2025-03-22 node scripts/hale-pull-2025.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const YEAR = process.env.YEAR ? parseInt(process.env.YEAR, 10) : 2025;
const OUT_BASE = `C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/${YEAR}`;
const OUT_DIR_OVERVIEW = OUT_BASE;
const OUT_DIR_7 = OUT_BASE + '/7-Prozent';
const OUT_DIR_19 = OUT_BASE + '/19-Prozent';
fs.mkdirSync(OUT_DIR_OVERVIEW, { recursive: true });
fs.mkdirSync(OUT_DIR_7, { recursive: true });
fs.mkdirSync(OUT_DIR_19, { recursive: true });

// Mode-spezifischer Output-Pfad
function outDirFor(mode) {
    if (mode === 'daily-7') return OUT_DIR_7;
    if (mode === 'daily-19') return OUT_DIR_19;
    return OUT_DIR_OVERVIEW;
}
// Wird unten gesetzt
const OUT_DIR = outDirFor(process.env.MODE || 'overview');

// Report-Grid-Indizes (aus inspect-v3):
//  grid_0 = Taxiabrechnung Detail (KEIN USt-Filter → enthält alle Sätze)
//  grid_3 = Taxiabrechnung 07%
//  grid_5/6 = Taxiabrechnung 19 % (genaue Index muss verifiziert werden)
// grid_X-Indizes verifiziert via inspect-v3 (24.05.2026):
//  grid_0 = Taxiabrechnung Detail (Gesamt)
//  grid_3 = Taxiabrechnung 07%
//  grid_5 oder grid_6 = Taxiabrechnung 19 % — wird beim ersten Open verifiziert
const REPORTS = {
    overview: { gridIndex: 0, label: 'Taxiabrechnung-Detail' },
    'daily-7': { gridIndex: 3, label: 'Taxiabrechnung-07' },
    'daily-19': { gridIndex: 6, label: 'Taxiabrechnung-19', expectedName: /19/ }
};

const MODE = process.env.MODE || 'overview';
const cfg = REPORTS[MODE];
if (!cfg) { console.error('Unknown MODE:', MODE, '— allowed: overview, daily-7, daily-19'); process.exit(1); }

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
    LOG('Detail-Seite geladen. ReportName-Input:', await page.locator('#ReportSubscription_ReportName').inputValue().catch(()=>''));
}

async function pullForDate(page, dateFrom, dateTo, outFn) {
    // Hale-Inputs sind readonly + per Picker. Lösung: readonly entfernen + JS-Werte direkt
    // setzen, dann change-Event triggern. Alternativ Picker-Workflow (Klick → Jahr/Monat/Tag).
    await page.evaluate(({ from, to }) => {
        const start = document.getElementById('start');
        const stop = document.getElementById('stop');
        if (start) { start.removeAttribute('readonly'); start.value = from; start.dispatchEvent(new Event('input', { bubbles: true })); start.dispatchEvent(new Event('change', { bubbles: true })); }
        if (stop) { stop.removeAttribute('readonly'); stop.value = to; stop.dispatchEvent(new Event('input', { bubbles: true })); stop.dispatchEvent(new Event('change', { bubbles: true })); }
    }, { from: dateFrom, to: dateTo });
    await page.waitForTimeout(800);

    // 🛠️ Datenformat auf 'Microsoft Excel (.xls)' umstellen — PDF zeigt nur inline,
    //   Excel triggert Download. Workflow: Dropdown #selectedExportOptionDropDown
    try {
        await page.evaluate(() => {
            const sel = document.getElementById('selectedExportOptionDropDown');
            if (sel) {
                // Suche Option mit 'Excel' und set value
                const opts = Array.from(sel.options);
                const excel = opts.find(o => /excel/i.test(o.text));
                if (excel) {
                    sel.value = excel.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    if (typeof window.$ !== 'undefined') $(sel).selectpicker('refresh');
                }
            }
        });
        await page.waitForTimeout(500);
    } catch (_e) { LOG('Format-Switch-Fehler:', _e.message); }
    LOG('Klicke Bericht anzeigen...');
    const dlPromise = page.waitForEvent('download', { timeout: 90000 }).catch(()=>null);
    await page.locator('#getReportDataSubmitItem').click();
    LOG('  Warte auf Download (max 90s)...');
    const dl = await dlPromise;
    if (!dl) { LOG(`  ⚠️ Kein Download fuer ${dateFrom}-${dateTo}`); return false; }
    const dest = path.join(OUT_DIR, outFn);
    await dl.saveAs(dest);
    LOG(`  ✅ ${outFn} (${Math.round(fs.statSync(dest).size/1024)} KB)`);
    return true;
}

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 100 });
    const ctx = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL); await inputs[1].fill(PASS); await inputs[2].fill(IDNR);
        }
        const submit = await page.$('button[type="submit"]');
        if (submit) await submit.click();
        await page.waitForTimeout(5000);
        LOG('Login OK');

        const aus = await page.$('a:has-text("Auswertung")');
        if (aus) { await aus.click(); await page.waitForTimeout(3500); }

        await setupReport(page, cfg.gridIndex);

        // Datumsbereich aus ENV (default: ganzes Jahr)
        const _envStart = process.env.START_DATE; // YYYY-MM-DD
        const _envEnd = process.env.END_DATE;
        const _rangeStart = _envStart ? new Date(_envStart) : new Date(YEAR, 0, 1);
        const _rangeEnd = _envEnd ? new Date(_envEnd) : new Date(YEAR, 11, 31);
        const _ovFromDDMMYY = ddmmyyyy(_rangeStart);
        const _ovToDDMMYY = ddmmyyyy(_rangeEnd);
        const _ovLabel = _envStart ? `${_envStart}_bis_${_envEnd || yyyymmdd(_rangeEnd)}` : `${YEAR}-komplett`;

        if (MODE === 'overview') {
            // EIN Pull fuer den Bereich
            const ok = await pullForDate(page, _ovFromDDMMYY, _ovToDDMMYY, `${cfg.label}_${_ovLabel}.pdf`);
            LOG(ok ? '🎉 Overview erfolgreich' : '💥 Overview fehlgeschlagen');
        } else if (MODE === 'daily-7') {
            // N Pulls fuer 7%
            const start = _rangeStart; const end = _rangeEnd;
            let done = 0, fail = 0;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
                const dStr = ddmmyyyy(d);
                const fn = `${cfg.label}_${yyyymmdd(d)}.pdf`;
                if (fs.existsSync(path.join(OUT_DIR, fn))) { LOG(`skip ${fn} (exists)`); continue; }
                const ok = await pullForDate(page, dStr, dStr, fn);
                if (ok) done++; else fail++;
                await page.waitForTimeout(1500); // Rate-Limit
                if ((done+fail) % 30 === 0) LOG(`Progress: ${done} OK, ${fail} fail`);
            }
            LOG(`Done: ${done} OK / ${fail} fail`);
        } else if (MODE === 'daily-19') {
            const dates = (process.env.DATES || '').split(',').filter(Boolean);
            if (!dates.length) { LOG('Keine DATES env gesetzt!'); return; }
            for (const dStr of dates) {
                const d = new Date(dStr);
                const fn = `${cfg.label}_${yyyymmdd(d)}.pdf`;
                if (fs.existsSync(path.join(OUT_DIR, fn))) { LOG(`skip ${fn}`); continue; }
                await pullForDate(page, ddmmyyyy(d), ddmmyyyy(d), fn);
                await page.waitForTimeout(1500);
            }
        }
    } catch (e) {
        LOG('💥', e.message);
        await page.screenshot({ path: path.join(OUT_DIR, '_ERROR.png'), fullPage: true }).catch(()=>{});
    } finally {
        await page.waitForTimeout(3000);
        await browser.close();
    }
})();
