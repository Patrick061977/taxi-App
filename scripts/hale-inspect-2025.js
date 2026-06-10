// hale-inspect-2025.js — Live-Inspektion der Hale-Tagesreport-UI
// Findet die neuen Datum-Picker-Selectors nach dem UI-Update
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const OUT = 'C:/temp/hale-inspect';
fs.mkdirSync(OUT, { recursive: true });

const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 300 });
    const ctx = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await ctx.newPage();

    try {
        // Login
        LOG('Navigating to login');
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL);
            await inputs[1].fill(PASS);
            await inputs[2].fill(IDNR);
        }
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click();
        await page.waitForTimeout(5000);
        LOG('Logged in, URL:', page.url());
        await page.screenshot({ path: path.join(OUT, '1-after-login.png'), fullPage: true });

        // Click "Auswertung"
        const ausLink = await page.$('a:has-text("Auswertung")');
        if (ausLink) { await ausLink.click(); await page.waitForTimeout(3000); }
        LOG('Auswertung clicked, URL:', page.url());
        await page.screenshot({ path: path.join(OUT, '2-after-auswertung.png'), fullPage: true });

        // Find "Taxiabrechnung Detail" or "Fahrten-Bericht" or whatever the new name is
        // Patrick's Screenshot zeigt "Berichte / Fahrtberichte / Fahrten-Bericht"
        const reportCandidates = ['Taxiabrechnung Detail', 'Fahrten-Bericht', 'Fahrtbericht', 'Taxiabrechnung', 'Detail'];
        let reportClicked = false;
        for (const name of reportCandidates) {
            try {
                const link = page.locator(`text="${name}"`).first();
                if (await link.count() > 0) {
                    await link.click({ timeout: 5000 });
                    LOG('Clicked report:', name);
                    reportClicked = true;
                    break;
                }
            } catch (e) {}
        }
        if (!reportClicked) LOG('⚠️ Konnte keinen Report-Link finden');
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(OUT, '3-after-report-open.png'), fullPage: true });

        // === DOM-Inspektion: alle interaktiven Elemente listen ===
        const interactiveElements = await page.evaluate(() => {
            const results = [];
            // Alle Buttons, Inputs, Links, Klick-Selektoren
            document.querySelectorAll('button, input, select, a[href], [onclick], [class*="datepicker"], [class*="calendar"], [class*="date-picker"]').forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return; // hidden
                results.push({
                    tag: el.tagName.toLowerCase(),
                    type: el.type || '',
                    id: el.id || '',
                    name: el.name || '',
                    class: (el.className || '').toString().slice(0, 80),
                    placeholder: el.placeholder || '',
                    text: (el.innerText || el.value || '').slice(0, 50),
                    role: el.role || el.getAttribute('role') || ''
                });
            });
            return results.slice(0, 60);
        });
        LOG('=== Interaktive Elemente ===');
        interactiveElements.forEach((e, i) => LOG(` ${i}.`, JSON.stringify(e)));

        await page.waitForTimeout(5000);
        LOG('Browser bleibt 30s offen zum manuellen Inspizieren...');
        await page.waitForTimeout(30000);

    } catch (e) {
        LOG('💥', e.message);
        await page.screenshot({ path: path.join(OUT, 'ERROR.png'), fullPage: true }).catch(()=>{});
    } finally {
        await browser.close();
    }
})();
