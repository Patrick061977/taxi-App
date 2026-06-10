// hale-inspect-v4.js — Pencil grid_0_edit klicken + Datum-Picker-Selectors finden
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const OUT = 'C:/temp/hale-inspect-v4';
fs.mkdirSync(OUT, { recursive: true });
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 200 });
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
        const aus = await page.$('a:has-text("Auswertung")');
        if (aus) { await aus.click(); await page.waitForTimeout(3500); }
        LOG('Reports-Seite, URL:', page.url());

        // JS-Click auf grid_0_edit (Taxiabrechnung Detail Pencil)
        LOG('JS-Click auf grid_0_edit...');
        await page.evaluate(() => {
            const el = document.getElementById('grid_0_edit');
            if (el) el.click();
            else console.log('grid_0_edit not found in DOM');
        });
        await page.waitForTimeout(4000);
        LOG('URL nach Click:', page.url());
        await page.screenshot({ path: path.join(OUT, '1-after-pencil.png'), fullPage: true });

        // === DOM-Inspect der Detail-Seite ===
        const detailInspect = await page.evaluate(() => {
            // Find all clickable elements + inputs
            const all = [];
            document.querySelectorAll('button, input, select, a[href], [onclick], [class*="date"], [class*="picker"], [class*="calendar"]').forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return;
                all.push({
                    tag: el.tagName.toLowerCase(),
                    type: el.type || '',
                    id: el.id || '',
                    name: el.name || '',
                    class: (el.className || '').toString().slice(0, 70),
                    placeholder: el.placeholder || '',
                    text: (el.innerText || el.value || '').slice(0, 35),
                    title: el.title || ''
                });
            });
            return all.slice(0, 80);
        });
        LOG('=== Detail-Seite Elemente ===');
        detailInspect.forEach((e,i) => LOG(`  ${i}.`, JSON.stringify(e).slice(0, 250)));

        // Suche speziell den Datumsbereich (Text z.B. "01.01.2025 - 01.01.2025" oder ähnlich)
        const dateTexts = await page.evaluate(() => {
            const txt = document.body.innerText;
            // Find all date patterns
            const matches = txt.match(/\d{2}\.\d{2}\.\d{4}\s*[-–]\s*\d{2}\.\d{2}\.\d{4}/g);
            return matches || [];
        });
        LOG('Datum-Patterns in Body:', dateTexts.slice(0, 5));

        LOG('Browser 20s offen.');
        await page.waitForTimeout(20000);
    } catch (e) {
        LOG('💥', e.message);
        await page.screenshot({ path: path.join(OUT, 'ERROR.png'), fullPage: true }).catch(()=>{});
    } finally {
        await browser.close();
    }
})();
