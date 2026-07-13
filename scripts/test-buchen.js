/**
 * Playwright-Test: buchen.html — v6.63.523 returnRideId-Fix verifizieren
 * Nutzt URL-Parameter lat/lon/toLat/toLon um Geocoding zu umgehen.
 */
const { chromium } = require('playwright');

const v = Date.now();
// Bahnhof Heringsdorf → Seebrücke Ahlbeck, mit AGB-Bypass via URL
const BASE_URL =
    `https://umwelt-taxi-insel-usedom.de/Taxi-App/buchen.html` +
    `?new=1&v=${v}` +
    `&from=Bahnhof+Heringsdorf&lat=53.9576&lon=14.1498` +
    `&to=Seebr%C3%BCcke+Ahlbeck&toLat=53.9424&toLon=14.1930` +
    `&name=Playwright+Test&passengers=1`;

const TEST_PHONE = '+4915127585179';

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 200 });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    const buchungLogs = [];
    page.on('console', msg => {
        const t = msg.text();
        if (t.includes('buchen-log') || t.includes('BUCHUNG') || t.includes('returnRide') || t.includes('Fehler') || t.includes('fehler')) {
            buchungLogs.push(t);
            console.log('📋', t.slice(0, 140));
        }
    });

    // localStorage mit Telefon setzen BEVOR die Seite geladen wird
    await page.addInitScript((phone) => {
        localStorage.setItem('buchen-verifiedPhone', phone);
        localStorage.setItem('buchen-verifiedAt', String(Date.now()));
    }, TEST_PHONE);

    console.log('🌐 Öffne buchen.html mit Koordinaten in URL...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Seite-Status prüfen
    const pickupVal = await page.locator('#b-pickup').inputValue().catch(() => '');
    const destVal   = await page.locator('#b-destination').inputValue().catch(() => '');
    console.log('📍 Pickup:', pickupVal || '(leer)');
    console.log('🎯 Ziel:  ', destVal || '(leer)');

    // AGB-Checkbox anklicken + warten bis btn-book enabled
    const agbCb = page.locator('#agb-checkbox');
    if (await agbCb.count() > 0) {
        // Scroll zur Checkbox und anklicken
        await agbCb.scrollIntoViewIfNeeded();
        await agbCb.check({ force: true });
        console.log('✅ AGB akzeptiert');
        await page.waitForTimeout(500);
    } else {
        // Via JS erzwingen
        await page.evaluate(() => {
            const cb = document.getElementById('agb-checkbox');
            if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
            // agb-disabled entfernen
            const btn = document.getElementById('btn-book');
            if (btn) { btn.removeAttribute('data-agb-disabled'); btn.disabled = false; }
        });
        console.log('✅ AGB via JS akzeptiert');
    }

    // Warte auf sichtbaren Button (Koordinaten kommen aus URL → sollte schnell gehen)
    console.log('--- Warte auf btn-book ---');
    try {
        await page.locator('#btn-book:visible').waitFor({ timeout: 12000 });
        const btnTxt = await page.locator('#btn-book').textContent().catch(() => '');
        console.log('✅ btn-book sichtbar:', btnTxt.trim());
    } catch {
        await page.screenshot({ path: 'test-buchen-no-btn.png' });
        console.log('❌ btn-book NICHT sichtbar — Screenshot: test-buchen-no-btn.png');
        // Koordinaten im JS-Scope checken
        const coords = await page.evaluate(() => {
            return {
                pickup: typeof pickupCoords !== 'undefined' ? pickupCoords : 'undefined',
                dest:   typeof destCoords !== 'undefined' ? destCoords : 'undefined',
                avail:  typeof isAvailable !== 'undefined' ? isAvailable : 'undefined'
            };
        }).catch(() => ({}));
        console.log('🔍 JS-State:', JSON.stringify(coords));
        await browser.close();
        return;
    }

    // Buchen klicken (force falls noch disabled)
    await page.locator('#btn-book').click({ force: true });
    console.log('🔘 Klick auf btn-book...');

    // Warten
    await page.waitForTimeout(10000);

    // Toast prüfen
    const toastText = await page.locator('#toast, .toast').textContent({ timeout: 500 }).catch(() => '');
    if (toastText) {
        const isError = toastText.includes('Fehler') || toastText.includes('fehler') || toastText.includes('Bitte');
        console.log(isError ? '❌ Toast (Fehler):' : '🍞 Toast:', toastText.slice(0, 120));
    }

    // Status-Banner
    const statusBox = page.locator('#live-status-box');
    const statusVisible = await statusBox.isVisible({ timeout: 3000 }).catch(() => false);
    if (statusVisible) {
        const txt = await statusBox.textContent().catch(() => '');
        console.log('✅ Status-Banner:', txt.trim().slice(0, 100));
    } else {
        console.log('❌ Status-Banner NICHT sichtbar');
        const successCard = page.locator('#success-card, #success-details');
        if (await successCard.isVisible({ timeout: 1000 }).catch(() => false)) {
            const stxt = await successCard.textContent().catch(() => '');
            console.log('✅ Success-Card sichtbar:', stxt.trim().slice(0, 80));
        }
    }

    // Log-Auswertung
    const errLogs = buchungLogs.filter(l => l.includes('FEHLER') || l.includes('is not defined') || l.includes('TypeError'));
    const okLogs  = buchungLogs.filter(l => l.includes('erfolgreich') || l.includes('Ride') || l.includes('angelegt') || l.includes('created') || l.includes('gestartet'));

    console.log('\n=== Ergebnis ===');
    if (errLogs.length) {
        console.error('❌ Fehler-Logs:');
        errLogs.forEach(l => console.error('  •', l.slice(0, 120)));
    } else {
        console.log('✅ Keine Fehler in buchen-Logs');
    }
    if (okLogs.length) {
        console.log('✅ Buchungs-Logs:');
        okLogs.forEach(l => console.log('  •', l.slice(0, 120)));
    }

    await page.screenshot({ path: 'test-buchen-result.png', fullPage: false });
    console.log('📸 test-buchen-result.png');

    await page.waitForTimeout(2000);
    await browser.close();
})().catch(err => {
    console.error('❌ Test-Crash:', err.message);
    process.exit(1);
});
