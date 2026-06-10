// Findet welchen grid_X den ReportName "Taxiabrechnung 19" hat
const { chromium } = require('playwright');
const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

(async () => {
    const browser = await chromium.launch({ headless: true, slowMo: 50 });
    const ctx = await browser.newContext({ acceptDownloads: true, locale: 'de-DE' });
    const page = await ctx.newPage();
    try {
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill('taxiwydra@gmx.de');
            await inputs[1].fill(process.env.HALE_PASS);
            await inputs[2].fill('DE205006336');
        }
        const submit = await page.$('button[type="submit"]');
        if (submit) await submit.click();
        await page.waitForTimeout(4000);
        const aus = await page.$('a:has-text("Auswertung")');
        if (aus) { await aus.click(); await page.waitForTimeout(3500); }

        // Iteriere alle grid_X_edit (0-20)
        for (let i = 0; i <= 20; i++) {
            const exists = await page.locator(`#grid_${i}_edit`).count();
            if (exists === 0) { LOG(`grid_${i}_edit: not exists, stop`); break; }
            // Click
            try {
                await page.evaluate((idx) => { document.getElementById(`grid_${idx}_edit`)?.click(); }, i);
                await page.waitForTimeout(2500);
                const name = await page.locator('#ReportSubscription_ReportName').inputValue().catch(()=>'?');
                LOG(`grid_${i} → '${name}'`);
                // Zurück
                await page.locator('#mainNavReports').click().catch(()=>{});
                await page.waitForTimeout(2200);
            } catch (e) {
                LOG(`grid_${i}: ERR ${e.message.slice(0,80)}`);
                await page.locator('#mainNavReports').click().catch(()=>{});
                await page.waitForTimeout(2000);
            }
        }
    } finally {
        await browser.close();
    }
})();
