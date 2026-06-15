#!/usr/bin/env node
// hale-mitarbeiter-fahrten-explore.js — Patrick 15.06.2026 10:47:
//   Hale-Detail-Bericht mit Mitarbeiter-Fahrtzeiten + Leerlauf-Luecken explorieren.
//
// Workflow: Login → Auswertungen/Berichte → Detail pro Tag → Mitarbeiter-Fahrtenliste.
// Erst Erkundungs-Lauf: Login + Screenshot Hauptmenue + Klick durch Auswertungs-Menue.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const OUT_DIR = path.join(__dirname, '..', '.hale-explore');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

if (!PASS) {
    console.error('HALE_PASS nicht gesetzt');
    process.exit(1);
}

async function shot(page, label) {
    const p = path.join(OUT_DIR, label + '.png');
    await page.screenshot({ path: p, fullPage: true });
    console.log('  📸', p);
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();

    console.log('[1] Login…');
    await page.goto(URL_LOGIN, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
    if (inputs.length >= 3) {
        await inputs[0].fill(EMAIL);
        await inputs[1].fill(PASS);
        await inputs[2].fill(IDNR);
    }
    const submit = await page.$('button[type="submit"]');
    if (submit) await submit.click();
    await page.waitForTimeout(4000);
    await shot(page, '01-after-login');

    console.log('[2] Texte der Hauptseite extrahieren…');
    const mainTexts = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('a, button, .nav-link, .menu-item')).filter(el => {
            const t = (el.innerText || '').trim();
            return t.length > 0 && t.length < 80;
        }).slice(0, 50);
        return items.map(el => ({
            tag: el.tagName,
            text: el.innerText.trim(),
            href: el.href || '',
            cls: el.className?.toString().slice(0, 60) || ''
        }));
    });
    console.log('[3] Main-Page Navigations-Items:');
    for (const i of mainTexts) console.log('   ', i.tag, '|', i.text, '|', i.href.slice(-50));
    fs.writeFileSync(path.join(OUT_DIR, '02-main-nav.json'), JSON.stringify(mainTexts, null, 2));

    // Try to find an "Auswertung" or "Bericht" or "Mitarbeiter" link
    const interesting = mainTexts.filter(i => /auswert|bericht|mitarb|fahrt|aktivit|detail|export/i.test(i.text));
    console.log('[4] Interessante Links:');
    for (const i of interesting) console.log('   ', i.text, '→', i.href);

    if (interesting.length > 0) {
        const target = interesting[0];
        console.log('[5] Navigiere zu:', target.text);
        try {
            await page.click('a:has-text("' + target.text + '"), button:has-text("' + target.text + '")');
            await page.waitForTimeout(3000);
            await shot(page, '03-after-click-' + target.text.replace(/\s/g, '-').slice(0, 30));
        } catch (e) { console.warn('  Klick fail', e.message); }
    }

    await browser.close();
    console.log('\n✅ Fertig. Screenshots in', OUT_DIR);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
