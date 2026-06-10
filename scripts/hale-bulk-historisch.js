#!/usr/bin/env node
// hale-bulk-historisch.js — Pulle Hale-Tagesabrechnungen für JEDEN Tag YEAR-Param
// Adaptiert von hale-bulk-2025.js für historische Jahre 2021-2024
// Aufruf: HEADLESS=true node scripts/hale-bulk-historisch.js 2024
// ETA: ~3-4 Stunden pro Jahr

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';

const YEAR = parseInt(process.argv[2] || '2024', 10);
if (YEAR < 2018 || YEAR > 2026) {
    console.error('Year out of range:', YEAR);
    process.exit(1);
}

const OUT_DIR = `C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/${YEAR}/7-Prozent`;
fs.mkdirSync(OUT_DIR, { recursive: true });

const HEADLESS = process.env.HEADLESS === 'true';
const REPORT_NAME = 'Taxiabrechnung Detail';

function pad(n) { return String(n).padStart(2, '0'); }
function daysOfYear(year) {
    const days = [];
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`);
    }
    return days;
}

(async () => {
    console.log(`[Bulk-Historisch] YEAR=${YEAR}  HEADLESS=${HEADLESS}  OUT=${OUT_DIR}`);
    const browser = await chromium.launch({
        headless: HEADLESS,
        args: HEADLESS ? [] : ['--start-maximized'],
        slowMo: HEADLESS ? 50 : 200
    });
    const context = await browser.newContext({ viewport: HEADLESS ? { width: 1600, height: 1000 } : null, acceptDownloads: true, locale: 'de-DE' });
    const page = await context.newPage();
    let dlCount = 0, skipCount = 0;
    page.on('download', async d => {
        const fn = d.suggestedFilename();
        // Datum als Prefix (vom currentDate-Marker)
        const safeDate = (page._currentDate || 'unknown').replace(/\./g, '-').split('-').reverse().join('-');
        const dest = path.join(OUT_DIR, `${fn.replace(/\.pdf$/, '')}_${safeDate}.pdf`);
        if (fs.existsSync(dest)) { console.log('  [SKIP] schon da:', path.basename(dest)); skipCount++; return; }
        try { await d.saveAs(dest); dlCount++; console.log('  [DL] ' + path.basename(dest)); } catch(e) { console.warn('DL-Fehler', e.message); }
    });

    try {
        console.log('[Bulk] Login ...');
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL); await inputs[1].fill(PASS); await inputs[2].fill(IDNR);
        }
        await (await page.$('button[type="submit"]')).click();
        await page.waitForTimeout(4000);
        console.log('[Bulk] Login OK, URL:', page.url());

        const ausLink = await page.$('a:has-text("Auswertung")');
        if (ausLink) await ausLink.click();
        await page.waitForTimeout(3000);

        const reportLink = page.locator(`tr:has-text("${REPORT_NAME}") a, tr:has-text("${REPORT_NAME}") td:nth-child(2)`).first();
        try {
            await reportLink.click({ timeout: 10000 });
            console.log('[Bulk] Report-Link geklickt');
        } catch (e) {
            console.log('[Bulk] Report-Link nicht klickbar — versuche alternativ');
            const actionRow = page.locator(`tr:has-text("${REPORT_NAME}")`).first();
            await actionRow.locator('i, svg, [class*="edit"], [class*="pencil"]').first().click({ timeout: 5000, force: true }).catch(() => {});
        }
        await page.waitForTimeout(3000);

        const days = daysOfYear(YEAR);
        console.log('[Bulk] ' + days.length + ' Tage ' + YEAR);
        const t0 = Date.now();

        for (let i = 0; i < days.length; i++) {
            const date = days[i];
            page._currentDate = date;
            // Check ob schon vorhanden — Filename-Schema: Taxiabrechnung-07_YYYY-MM-DD.pdf
            const parts = date.split('.');
            const expected = path.join(OUT_DIR, `Taxiabrechnung-07_${parts[2]}-${parts[1]}-${parts[0]}.pdf`);
            if (fs.existsSync(expected)) {
                if (i % 30 === 0) process.stdout.write('s');
                skipCount++;
                continue;
            }

            try {
                // Date-Picker Von+Bis ausfüllen
                const dateInputs = await page.$$('input[type="text"]');
                // Annahme: erstes + zweites Date-Input
                for (let di = 0; di < Math.min(2, dateInputs.length); di++) {
                    await dateInputs[di].fill('');
                    await dateInputs[di].fill(date);
                    await page.keyboard.press('Tab');
                }
                await page.waitForTimeout(800);

                // PDF-Button klicken
                const pdfBtn = await page.$('button:has-text("PDF"), a:has-text("PDF")');
                if (pdfBtn) {
                    await pdfBtn.click();
                    await page.waitForTimeout(2500);
                }
            } catch (e) {
                console.warn('  [ERR] ' + date + ':', e.message.slice(0, 80));
            }

            if (i > 0 && i % 30 === 0) {
                const elapsedMin = ((Date.now() - t0) / 60000).toFixed(1);
                console.log(`\n[Bulk] ${i}/${days.length} (${elapsedMin} Min) — DL=${dlCount} Skip=${skipCount}`);
            }
            process.stdout.write('.');
        }
        console.log(`\n[Bulk] FERTIG YEAR=${YEAR} — Downloads ${dlCount}, Skip ${skipCount}`);
    } catch (e) {
        console.error('[Bulk] FATAL:', e);
    } finally {
        if (!HEADLESS) await page.waitForTimeout(3000);
        await browser.close();
    }
})();
