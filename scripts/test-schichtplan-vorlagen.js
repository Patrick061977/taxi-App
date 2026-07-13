const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, slowMo: 300 });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();

    console.log('1. Schichtplan laden...');
    await page.goto('https://umwelt-taxi-insel-usedom.de/Taxi-App/schichtplan.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'C:/Users/Taxi/Desktop/tpl-1-start.png', fullPage: false });

    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
    console.log('Seite:', bodyText.replace(/\n/g, ' | '));

    // Tab "Wechselschicht-Vorlagen" anklicken
    const tabBtn = await page.$('[data-tab="vorlagen"]');
    if (tabBtn) {
        await tabBtn.click();
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'C:/Users/Taxi/Desktop/tpl-2-tab.png', fullPage: false });
        console.log('2. Vorlagen-Tab geöffnet');
    } else {
        console.log('FEHLER: Vorlagen-Tab nicht gefunden');
    }

    // Vorlagen-Tab HTML prüfen
    const vorlagenTab = await page.$('#tab-vorlagen');
    if (vorlagenTab) {
        const html = await vorlagenTab.evaluate(el => el.innerHTML.slice(0, 500));
        console.log('Vorlagen-Tab HTML:', html.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 300));
    }

    await page.screenshot({ path: 'C:/Users/Taxi/Desktop/tpl-3-final.png', fullPage: true });
    await browser.close();
    console.log('Fertig. Screenshots auf Desktop.');
})().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
