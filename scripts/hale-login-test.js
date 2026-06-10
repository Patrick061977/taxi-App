#!/usr/bin/env node
// hale-login-test.js — Test-Login bei Hale-Datacenter
// URL: https://datacenter.hale.de/DC/Account/Login

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;

const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen';
fs.mkdirSync(OUT_DIR, { recursive: true });

(async () => {
    console.log('[Hale] Starte Chromium (headed)');
    const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized'],
    });
    const context = await browser.newContext({
        viewport: null,
        acceptDownloads: true,
        locale: 'de-DE',
    });
    const page = await context.newPage();

    // Downloads handler
    page.on('download', async d => {
        const filename = d.suggestedFilename();
        const dest = path.join(OUT_DIR, '2025', filename);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await d.saveAs(dest);
        console.log('  [DL] ' + filename);
    });

    try {
        console.log('[Hale] Navigiere ...');
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);

        // Screenshot vor Login
        await page.screenshot({ path: path.join(OUT_DIR, '_login-step1.png'), fullPage: true });

        // 3-Felder-Login: Benutzername | Kennwort | Identifikationsnummer
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        console.log('[Hale] Inputs gefunden: ' + inputs.length);
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL);  // Benutzername
            await inputs[1].fill(PASS);   // Kennwort
            await inputs[2].fill('DE205006336');  // Identifikationsnummer (MwSt-ID)
            console.log('[Hale] 3 Felder ausgefüllt');
        } else {
            console.log('[Hale] Weniger als 3 Inputs — probiere klassisches Email/Pass');
            if (inputs[0]) await inputs[0].fill(EMAIL);
            if (inputs[1]) await inputs[1].fill(PASS);
        }
        const submit = await page.$('button[type="submit"], input[type="submit"], button:has-text("Anmelden")');
        if (submit) await submit.click();

        await page.waitForTimeout(5000);
        await page.screenshot({ path: path.join(OUT_DIR, '_login-step2.png'), fullPage: true });
        console.log('[Hale] URL nach Login:', page.url());

        // Navigation zu Auswertung
        console.log('[Hale] Suche Auswertung-Link/Tab...');
        // Versuch 1: Menü-Element 'Auswertung' oder Icon mit chart
        const auswertungSel = await page.$('a:has-text("Auswertung"), button:has-text("Auswertung"), [title*="Auswertung"]');
        if (auswertungSel) {
            await auswertungSel.click();
            console.log('[Hale] Auswertung-Link geklickt');
        } else {
            console.log('[Hale] Auswertung-Link nicht gefunden — versuche direkte URLs');
            for (const path2 of ['/DC/Reports', '/DC/Evaluation', '/DC/Reporting', '/DC/Auswertung', '/DC/Statistics']) {
                try {
                    await page.goto('https://datacenter.hale.de' + path2, { waitUntil: 'domcontentloaded', timeout: 10000 });
                    console.log('[Hale] Versucht: ' + path2 + ' → URL:', page.url());
                    await page.waitForTimeout(2000);
                    if (!page.url().includes('Login')) break;
                } catch {}
            }
        }
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(OUT_DIR, '_login-step3-auswertung.png'), fullPage: true });
        console.log('[Hale] Screenshot von Auswertung gespeichert');

        console.log('[Hale] Browser bleibt offen — drück STRG+C oder schließ den Tab um zu beenden.');
        await new Promise(() => {});
    } catch (e) {
        console.error('[Hale] FEHLER:', e.message);
        await page.screenshot({ path: path.join(OUT_DIR, '_error.png'), fullPage: true }).catch(() => {});
        await new Promise(() => {});
    }
})();
