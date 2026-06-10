// hale-inspect-v3.js — Finde den "linken Kreis" (Action-Menue) in der Reports-Liste
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const OUT = 'C:/temp/hale-inspect-v3';
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
        LOG('Login OK');

        const aus = await page.$('a:has-text("Auswertung")');
        if (aus) { await aus.click(); await page.waitForTimeout(3500); }
        LOG('Reports-Seite, URL:', page.url());

        // === Inspect Aktionen-Spalte: alle Buttons in der ERSTEN td jeder Zeile ===
        const actionsInspect = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tr, .grid-row, [class*="row"]');
            const items = [];
            rows.forEach((row, i) => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 2) return;
                const firstCell = cells[0];
                const reportName = (cells[1]?.innerText || '').trim().slice(0, 50);
                if (!reportName) return;
                const btns = firstCell.querySelectorAll('button, a, span[onclick], [role="button"], i, svg');
                const btnDetails = [];
                btns.forEach(b => {
                    btnDetails.push({
                        tag: b.tagName.toLowerCase(),
                        id: b.id || '',
                        class: (b.className || '').toString().slice(0,80),
                        title: b.title || '',
                        text: (b.innerText || '').slice(0,30)
                    });
                });
                items.push({ row: i, reportName, actions: btnDetails });
            });
            return items.slice(0, 20);
        });

        LOG('=== Action-Buttons pro Zeile ===');
        actionsInspect.forEach(item => {
            LOG(`Row ${item.row}: "${item.reportName}"`);
            item.actions.forEach(a => LOG(`   • ${a.tag}.${a.class.slice(0,40)} id=${a.id} title=${a.title}`));
        });

        // Versuche den ersten Action-Button zu klicken bei "Taxiabrechnung Detail"
        const detailRow = page.locator('tr:has-text("Taxiabrechnung Detail")').first();
        if (await detailRow.count() > 0) {
            await detailRow.scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(OUT, '1-before-click.png'), fullPage: true });
            const firstAction = detailRow.locator('td').first().locator('button, a, span[role="button"], i, svg').first();
            if (await firstAction.count() > 0) {
                LOG('Klicke erste Aktion in Taxiabrechnung Detail');
                try {
                    await firstAction.click({ timeout: 5000, force: true });
                    await page.waitForTimeout(3000);
                    LOG('  → click ok');
                    await page.screenshot({ path: path.join(OUT, '2-after-action-click.png'), fullPage: true });
                } catch (e) {
                    LOG('  click failed:', e.message.slice(0,150));
                }
            } else {
                LOG('Keine Aktion-Buttons in der Zeile gefunden');
            }
        }
        LOG('Browser 15s offen.');
        await page.waitForTimeout(15000);
    } catch (e) {
        LOG('💥', e.message);
        await page.screenshot({ path: path.join(OUT, 'ERROR.png'), fullPage: true }).catch(()=>{});
    } finally {
        await browser.close();
    }
})();
