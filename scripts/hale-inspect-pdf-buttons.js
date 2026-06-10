// Inspect: alle Buttons auf der Detail-Seite finden, log Responses
const { chromium } = require('playwright');
const fs = require('fs');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 100 });
    const context = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await context.newPage();

    const allResponses = [];
    const logResp = (resp) => {
        const ct = resp.headers()['content-type'] || '';
        const cl = resp.headers()['content-length'] || '?';
        allResponses.push({ url: resp.url(), status: resp.status(), ct, cl });
    };
    page.on('response', logResp);
    context.on('page', np => np.on('response', logResp));

    try {
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) { await inputs[0].fill('taxiwydra@gmx.de'); await inputs[1].fill(process.env.HALE_PASS); await inputs[2].fill('DE205006336'); }
        const submit = await page.$('button[type="submit"]');
        if (submit) await submit.click();
        await page.waitForTimeout(5000);
        const aus = await page.$('a:has-text("Auswertung")');
        if (aus) { await aus.click(); await page.waitForTimeout(3500); }

        await page.evaluate(() => document.getElementById('grid_3_edit')?.click());
        await page.waitForTimeout(3500);

        await page.evaluate(() => {
            const start = document.getElementById('start');
            const stop = document.getElementById('stop');
            if (start) { start.removeAttribute('readonly'); start.value = '01.01.2025'; start.dispatchEvent(new Event('change', { bubbles: true })); }
            if (stop) { stop.removeAttribute('readonly'); stop.value = '01.01.2025'; stop.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        await page.waitForTimeout(500);

        await page.evaluate(() => {
            const sel = document.getElementById('selectedExportOptionDropDown');
            if (sel) {
                const opts = Array.from(sel.options);
                const pdf = opts.find(o => /pdf/i.test(o.text));
                console.log('PDF-OPTION:', pdf && (pdf.text + '=' + pdf.value));
                if (pdf) {
                    sel.value = pdf.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    if (typeof window.$ !== 'undefined') $(sel).selectpicker('refresh');
                }
            }
        });
        await page.waitForTimeout(500);

        const buttons = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('button, input[type="submit"], a.btn, a[id]')).map(b => ({
                id: b.id || '',
                cls: (b.className || '').slice(0, 60),
                text: (b.innerText || b.value || '').slice(0, 50),
                visible: b.offsetParent !== null
            })).filter(b => b.visible && (b.text || b.id));
        });
        console.log('SICHTBARE BUTTONS:');
        buttons.forEach(b => console.log(' ', JSON.stringify(b)));

        console.log('\n=== Klicke #getReportDataSubmitItem ===');
        await page.locator('#getReportDataSubmitItem').click();
        await page.waitForTimeout(10000);

        console.log('\n=== RESPONSES nach Klick (letzte 30) ===');
        allResponses.slice(-30).forEach(r => {
            console.log('  [' + r.status + '] ' + (r.ct || '?').slice(0, 40) + ' (' + r.cl + 'b) <- ' + r.url.slice(-100));
        });

        fs.writeFileSync('C:/temp/hale-inspect-responses.json', JSON.stringify(allResponses, null, 2));
        console.log('\nBrowser bleibt 30s offen.');
        await page.waitForTimeout(30000);
    } catch(e) { console.error('FATAL:', e); }
    finally { await browser.close(); }
})();
