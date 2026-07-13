/**
 * Interaktiver Playwright-Test: buchen.html mit echter SMS-Verifikation
 * Patrick gibt den SMS-Code via stdin oder Bridge.
 */
const { chromium } = require('playwright');
const readline = require('readline');

const v = Date.now();
const BASE_URL =
    `https://umwelt-taxi-insel-usedom.de/Taxi-App/buchen.html` +
    `?new=1&v=${v}` +
    `&from=Bahnhof+Heringsdorf&lat=53.9576&lon=14.1498` +
    `&to=Seebr%C3%BCcke+Ahlbeck&toLat=53.9424&toLon=14.1930` +
    `&name=Patrick+Wydra&passengers=1`;

const TEST_PHONE = '015127585179'; // ohne +49, Country-Select macht das

(async () => {
    const browser = await chromium.launch({ headless: false, slowMo: 200 });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    const buchungLogs = [];
    page.on('console', msg => {
        const t = msg.text();
        if (t.includes('buchen-log') || t.includes('BUCHUNG') || t.includes('Fehler') || t.includes('fehler') || t.includes('SMS') || t.includes('Code')) {
            buchungLogs.push(t);
            console.log('📋', t.slice(0, 140));
        }
    });

    console.log('🌐 Öffne buchen.html...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const pickupVal = await page.locator('#b-pickup').inputValue().catch(() => '');
    console.log('📍 Pickup:', pickupVal);

    // AGB
    const agbCb = page.locator('#agb-checkbox');
    if (await agbCb.count() > 0) {
        await agbCb.scrollIntoViewIfNeeded().catch(() => {});
        await agbCb.check({ force: true });
        console.log('✅ AGB akzeptiert');
        await page.waitForTimeout(500);
    }

    // Warte auf btn-book
    try {
        await page.locator('#btn-book:visible').waitFor({ timeout: 12000 });
        const btnTxt = await page.locator('#btn-book').textContent().catch(() => '');
        console.log('✅ btn-book sichtbar:', btnTxt.trim());
    } catch {
        console.log('❌ btn-book nicht sichtbar'); await browser.close(); return;
    }

    // Buchen-Button klicken → step-phone erscheint
    await page.locator('#btn-book').click({ force: true });
    console.log('🔘 Klick → step-phone sollte erscheinen...');
    await page.waitForTimeout(1500);

    // Telefon-Feld ausfüllen
    const phoneInput = page.locator('#b-phone');
    if (await phoneInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await phoneInput.fill(TEST_PHONE);
        console.log('📱 Telefon eingetragen:', TEST_PHONE);
    } else {
        console.log('⚠️ Telefonfeld nicht sichtbar — möglicherweise bereits eingeloggt?');
        const toastTxt = await page.locator('#toast, .toast').textContent({ timeout: 500 }).catch(() => '');
        if (toastTxt) console.log('🍞 Toast:', toastTxt);
        await browser.close();
        return;
    }

    // SMS senden
    const btnNow = await page.locator('#btn-book').textContent().catch(() => '');
    console.log('🔘 Button jetzt:', btnNow.trim());
    await page.locator('#btn-book').click({ force: true });
    console.log('📨 SMS-Code angefordert an', TEST_PHONE, '...');
    await page.waitForTimeout(3000);

    // Warte auf Code-Eingabefeld
    const codeInput = page.locator('#b-sms-code');
    if (!await codeInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        console.log('❌ SMS-Code-Feld erscheint nicht');
        const t = await page.locator('#toast, .toast').textContent({ timeout: 500 }).catch(() => '');
        if (t) console.log('🍞 Toast:', t);
        await browser.close();
        return;
    }

    const _formatted = '+49' + TEST_PHONE.replace(/^0/, '');
    console.log('\n🔔 SMS-Code wurde an ' + _formatted + ' gesendet!');
    console.log('   Patrick: Bitte Code hier eingeben:');

    // Warte auf Code von Patrick (stdin oder Bridge)
    const rl = readline.createInterface({ input: process.stdin });
    const code = await new Promise(resolve => {
        process.stdout.write('Code > ');
        rl.once('line', line => { rl.close(); resolve(line.trim()); });
    });

    console.log('🔐 Gebe Code ein:', code);
    await codeInput.fill(code);

    // Verify-Button suchen und klicken
    const verifyBtn = page.locator('#btn-verify-sms, button:has-text("Bestätigen"), button:has-text("Verifizieren"), button:has-text("Code"), #btn-book');
    await verifyBtn.first().click({ force: true });
    console.log('✅ Code eingegeben, warte auf Buchung...');
    await page.waitForTimeout(10000);

    // Ergebnis
    const toastText = await page.locator('#toast, .toast').textContent({ timeout: 500 }).catch(() => '');
    if (toastText) console.log('🍞 Toast:', toastText.slice(0, 120));

    const statusBox = page.locator('#live-status-box');
    const statusVisible = await statusBox.isVisible({ timeout: 3000 }).catch(() => false);
    if (statusVisible) {
        const txt = await statusBox.textContent().catch(() => '');
        console.log('✅ Status-Banner:', txt.trim().slice(0, 100));
    } else {
        console.log('❌ Status-Banner nicht sichtbar');
    }

    const errLogs = buchungLogs.filter(l => l.includes('FEHLER') || l.includes('is not defined'));
    console.log(errLogs.length ? '❌ Fehler in Logs' : '✅ Keine Fehler in Logs');

    await page.screenshot({ path: 'test-buchen-live-result.png' });
    console.log('📸 test-buchen-live-result.png');
    await page.waitForTimeout(3000);
    await browser.close();
})().catch(err => {
    console.error('❌ Crash:', err.message);
    process.exit(1);
});
