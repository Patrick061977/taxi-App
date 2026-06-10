// hale-inspect-v2.js — Iteriere ueber alle Pencil-Icons, screenshot jeden Report
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const OUT = 'C:/temp/hale-inspect-v2';
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
            await inputs[0].fill(EMAIL);
            await inputs[1].fill(PASS);
            await inputs[2].fill(IDNR);
        }
        const submit = await page.$('button[type="submit"]');
        if (submit) await submit.click();
        await page.waitForTimeout(5000);
        LOG('Login OK');

        const aus = await page.$('a:has-text("Auswertung")');
        if (aus) { await aus.click(); await page.waitForTimeout(3000); }
        LOG('Auswertung OK, URL:', page.url());
        await page.screenshot({ path: path.join(OUT, '0-reports-list.png'), fullPage: true });

        // Lese die Report-Namen aus der Tabelle
        const reportNames = await page.evaluate(() => {
            const rows = document.querySelectorAll('tr[data-row], .data-row, tr');
            const names = [];
            rows.forEach((row, i) => {
                const txt = row.innerText || '';
                if (txt.trim() && !txt.includes('Aktionen') && !txt.includes('Name') && i < 10) {
                    names.push(`Row${i}: ${txt.replace(/\n+/g, ' | ').slice(0, 200)}`);
                }
            });
            return names;
        });
        LOG('=== Report-Zeilen ===');
        reportNames.forEach(n => LOG(' ', n));

        // Iteriere ueber Pencil-Icons grid_0_edit bis grid_6_edit
        for (let idx = 0; idx <= 6; idx++) {
            const pencilId = `#grid_${idx}_edit`;
            const exists = await page.locator(pencilId).count() > 0;
            if (!exists) { LOG(`grid_${idx}_edit existiert nicht — skip`); continue; }
            LOG(`>>> Klicke ${pencilId}`);
            try {
                await page.locator(pencilId).click({ timeout: 5000 });
                await page.waitForTimeout(3500);
                // Screenshot
                await page.screenshot({ path: path.join(OUT, `report-${idx}-detail.png`), fullPage: true });
                // Berichtsname aus der Detail-Seite extrahieren
                const reportInfo = await page.evaluate(() => {
                    const title = document.querySelector('h1, h2, .breadcrumb, [class*="title"], [class*="header"]')?.innerText || '';
                    const nameField = document.querySelector('input[placeholder*="Berichtsname"], input[name*="name"], input[name*="Name"]')?.value || '';
                    const ustField = document.querySelector('select[name*="UStSatz"], select[name*="ust"]')?.value || '';
                    // Suche nach allen Inputs mit aktuellem Datum
                    const allInputs = Array.from(document.querySelectorAll('input')).map(i => ({
                        id: i.id, name: i.name, type: i.type, value: i.value?.slice(0,30), placeholder: i.placeholder
                    })).filter(i => i.value || i.placeholder);
                    return { title: title.slice(0,200), nameField, ustField, inputs: allInputs.slice(0,15) };
                });
                LOG(`  Detail ${idx}:`, JSON.stringify(reportInfo).slice(0, 500));

                // Zurueck zur Liste
                const backBtn = await page.$('button:has-text("Zurueck"), a:has-text("Zurueck"), a:has-text("Berichte"), [id="mainNavReports"]');
                if (backBtn) {
                    await backBtn.click();
                    await page.waitForTimeout(2500);
                } else {
                    // Browser back
                    await page.goBack();
                    await page.waitForTimeout(2500);
                }
            } catch (e) {
                LOG(`  ❌ ${pencilId}:`, e.message.slice(0,150));
                try { await page.goBack(); } catch(_){}
                await page.waitForTimeout(2000);
            }
        }
        LOG('Inspect fertig. Browser bleibt 15s offen.');
        await page.waitForTimeout(15000);
    } catch (e) {
        LOG('💥', e.message);
        await page.screenshot({ path: path.join(OUT, 'ERROR.png'), fullPage: true }).catch(()=>{});
    } finally {
        await browser.close();
    }
})();
