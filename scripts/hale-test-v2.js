#!/usr/bin/env node
// hale-test-v2.js — v2 mit Action → Stift → Datum → Bericht-anzeigen-Workflow
// Patrick: 'Klick Action → Stift → Datum eintragen → Bericht anzeigen'

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';

const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/2025';
fs.mkdirSync(OUT_DIR, { recursive: true });

const TEST_REPORT_NAME = 'Taxiabrechnung Detail';
const TEST_DATE = '01.05.2025';

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 500 });
    const context = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await context.newPage();
    page.on('download', async d => {
        const fn = d.suggestedFilename();
        const dest = path.join(OUT_DIR, '_TEST_' + fn);
        await d.saveAs(dest);
        console.log('  [DL] ' + dest);
    });
    try {
        console.log('[v2] Login ...');
        await page.goto(URL_LOGIN);
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL); await inputs[1].fill(PASS); await inputs[2].fill(IDNR);
        }
        await (await page.$('button[type="submit"]')).click();
        await page.waitForTimeout(4000);

        console.log('[v2] Auswertung ...');
        await (await page.$('a:has-text("Auswertung")')).click();
        await page.waitForTimeout(3000);

        console.log('[v2] Suche Report: ' + TEST_REPORT_NAME);
        const row = page.locator(`tr:has-text("${TEST_REPORT_NAME}")`).first();
        // Klick auf das ERSTE Element in der Action-Spalte (egal welcher Tag)
        // Strategy: Klick auf die FIRST <td> der Zeile (das ist die Action-Spalte)
        const firstCell = row.locator('td').first();
        await firstCell.click({ timeout: 10000 });
        console.log('[v2] First-Cell geklickt');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: path.join(OUT_DIR, '_v2-step1-after-cell-click.png'), fullPage: true });

        // Patrick: 'dann auf den Stift'
        // Suche Stift-Icon — vermutlich SVG mit class enthält 'edit' oder 'pencil'
        const pencilSelectors = ['[title*="bearbeiten" i]', '[title*="Edit" i]', '[aria-label*="bearbeiten" i]',
            '.fa-pencil', '.fa-edit', 'svg[class*="pencil"]', 'svg[class*="edit"]',
            'button:has(svg)', 'a:has(svg)'];
        let pencilClicked = false;
        for (const sel of pencilSelectors) {
            try {
                const el = await page.$(sel);
                if (el) {
                    await el.click();
                    console.log('[v2] Stift via Selector "' + sel + '"');
                    pencilClicked = true;
                    break;
                }
            } catch {}
        }
        if (!pencilClicked) console.log('[v2] Stift nicht gefunden — bitte Screenshot anschauen');

        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(OUT_DIR, '_v2-step2-after-pencil.png'), fullPage: true });

        // Datum-Felder ausfüllen
        const dateInputs = await page.$$('input[type="date"], input[type="text"][placeholder*="atum" i], input[name*="ate" i]');
        console.log('[v2] Datum-Inputs: ' + dateInputs.length);
        for (const di of dateInputs.slice(0, 2)) {
            try { await di.fill(TEST_DATE); } catch {}
        }
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(OUT_DIR, '_v2-step3-after-date.png'), fullPage: true });

        // Bericht anzeigen
        const showBtn = await page.$('button:has-text("Bericht anzeigen"), button:has-text("anzeigen"), button:has-text("PDF"), button:has-text("Bericht")');
        if (showBtn) {
            await showBtn.click();
            console.log('[v2] Bericht-anzeigen geklickt');
        } else { console.log('[v2] Bericht-anzeigen-Button nicht gefunden'); }

        await page.waitForTimeout(10000);
        await page.screenshot({ path: path.join(OUT_DIR, '_v2-step4-after-show.png'), fullPage: true });
        console.log('[v2] FERTIG — Browser bleibt offen, schau Screenshots an.');
        await new Promise(() => {});
    } catch (e) {
        console.error('[v2] FEHLER:', e.message);
        await page.screenshot({ path: path.join(OUT_DIR, '_v2-error.png'), fullPage: true }).catch(() => {});
        await new Promise(() => {});
    }
})();
