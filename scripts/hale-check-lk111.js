const { chromium } = require('playwright');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...a);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ locale: 'de-DE', viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
    LOG('Inputs:', inputs.length);
    if (inputs.length >= 3) {
        await inputs[0].fill(EMAIL);
        await inputs[1].fill(PASS);
        await inputs[2].fill(IDNR);
    }
    const submit = await page.$('button[type="submit"]');
    if (submit) await submit.click();
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
    LOG('URL nach Login:', page.url());

    const txt = await page.evaluate(() => document.body.innerText);
    const lines = txt.split('\n').filter(l => l.trim().length > 3);

    // Take screenshot first
    await page.screenshot({ path: 'C:/Users/Taxi/Desktop/hale-overview.png', fullPage: true });
    LOG('Screenshot: Desktop/hale-overview.png');

    // Try clicking on "Überblick" nav item to trigger content
    const links = await page.$$('a');
    for (const link of links) {
        const txt = await link.textContent().catch(() => '');
        if (/Überblick/i.test(txt)) { await link.click(); await page.waitForTimeout(2000); break; }
    }

    // Navigate to Activities overview — intercept AJAX calls for lazy content
    const ajaxUrls = [];
    page.on('request', req => {
        const url = req.url();
        if (url.includes('hale.de') && !url.includes('.css') && !url.includes('.js') && !url.includes('.png')) {
            ajaxUrls.push({ method: req.method(), url });
        }
    });

    const ajaxResponses = {};
    page.on('response', async resp => {
        const url = resp.url();
        if (url.includes('hale.de') && (url.includes('Vehicle') || url.includes('Activit') || url.includes('Widget') || url.includes('Dashboard'))) {
            try {
                const body = await resp.text();
                if (body.length < 50000) ajaxResponses[url] = body;
            } catch(e) {}
        }
    });

    await page.goto('https://datacenter.hale.de/DC/Activities', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    LOG('AJAX-URLs nach Seitenload:', ajaxUrls.length);
    ajaxUrls.forEach(r => LOG(' ', r.method, r.url.replace('https://datacenter.hale.de', '')));

    // Try triggering lazy load via keyboard page-down
    await page.keyboard.press('End');
    await page.waitForTimeout(2000);
    await page.keyboard.press('End');
    await page.waitForTimeout(3000);

    LOG('AJAX-URLs nach Scroll:', ajaxUrls.length);
    ajaxUrls.forEach(r => LOG(' ', r.method, r.url.replace('https://datacenter.hale.de', '')));

    // Call VehicleActivityData endpoint directly
    LOG('--- VehicleActivityData ---');
    try {
        const resp = await context.request.post('https://datacenter.hale.de/DC/Activities/VehicleActivityData', {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            data: ''
        });
        const body = await resp.text();
        LOG('Status:', resp.status(), 'Länge:', body.length);
        const clean = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        LOG(clean.slice(0, 2000));
    } catch(e) { LOG('Fehler:', e.message); }

    // Call LoadActivityData
    LOG('--- LoadActivityData ---');
    try {
        const resp2 = await context.request.post('https://datacenter.hale.de/DC/Activities/LoadActivityData', {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            data: ''
        });
        const body2 = await resp2.text();
        LOG('Status:', resp2.status(), 'Länge:', body2.length);
        const clean2 = body2.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (/LK|SK|IK|Daten|zuletzt|letzte/i.test(clean2)) LOG('RELEVANT:', clean2.slice(0, 1000));
        else LOG(clean2.slice(0, 200));
    } catch(e) { LOG('Fehler:', e.message); }

    // Look at page HTML for lazy-load URLs
    const html = await page.content();
    const lazyMatches = html.match(/data-url=['"][^'"]+['"]/gi) || [];
    const ajaxLinks = html.match(/url\s*[:=]\s*['"][^'"]*Activities[^'"]*['"]/gi) || [];
    LOG('Lazy-URL-Attribute:', lazyMatches.slice(0, 10));
    LOG('AJAX-Links:', ajaxLinks.slice(0, 10));

    // Try known Hale widget endpoints
    const testUrls = [
        '/DC/Activities/VehicleWidget',
        '/DC/Activities/DeviceStatus',
        '/DC/Activities/GetVehicleStatus',
        '/DC/Vehicles/LastData',
        '/DC/Activities/DashboardWidgets',
        '/DC/Activities/ScrollContent',
    ];
    for (const path of testUrls) {
        try {
            const resp = await context.request.get('https://datacenter.hale.de' + path);
            if (resp.ok()) {
                const body = await resp.text();
                LOG('✅ Found:', path, body.slice(0, 200).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
            } else {
                LOG('❌', path, resp.status());
            }
        } catch(e) { LOG('ERR', path, e.message.slice(0, 50)); }
    }

    const txt2 = await page.evaluate(() => document.body.innerText);
    const lines2 = txt2.split('\n').filter(l => l.trim().length > 3);

    // Filter for vehicle data warnings
    const relevant = lines2.filter(l =>
        /LK111|keine Daten|geliefert|Taxameter|Verbindung|Gerät|Warnung|Fehler|Status|offline/i.test(l)
    );
    if (relevant.length) {
        LOG('Relevante Warnungen:');
        relevant.forEach(l => LOG(' ', l.trim()));
    }

    LOG('--- Alle Zeilen nach Scroll (' + lines2.length + ' Zeilen) ---');
    lines2.forEach((l, i) => LOG(i, l.trim()));

    await browser.close();
})().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
