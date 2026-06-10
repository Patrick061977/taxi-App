#!/usr/bin/env node
// hale-test-tagesbericht.js — Test: 1 Tagesbericht 'Taxiabrechnung Detail' für 01.05.2025 abrufen
// Lernt UI-Flow für Bulk-Download später.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';

const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/2025';
fs.mkdirSync(OUT_DIR, { recursive: true });

const TEST_DATE = '01.05.2025';  // Anfangsdatum für Test
const TEST_REPORT_NAME = 'Taxiabrechnung Detail';

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
    const context = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await context.newPage();

    // Download-Handler
    const downloads = [];
    page.on('download', async d => {
        const filename = d.suggestedFilename();
        const dest = path.join(OUT_DIR, `_TEST_${TEST_DATE.replace(/\./g,'-')}_${filename}`);
        await d.saveAs(dest);
        console.log('  [DL] ' + dest);
        downloads.push(dest);
    });

    try {
        console.log('[Hale-Test] Login ...');
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL);
            await inputs[1].fill(PASS);
            await inputs[2].fill(IDNR);
        }
        const submit = await page.$('button[type="submit"], input[type="submit"]');
        if (submit) await submit.click();
        await page.waitForTimeout(4000);

        console.log('[Hale-Test] Navigiere zu Auswertung ...');
        const auswertungSel = await page.$('a:has-text("Auswertung")');
        if (auswertungSel) await auswertungSel.click();
        else await page.goto('https://datacenter.hale.de/DC/Evaluation', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);

        await page.screenshot({ path: path.join(OUT_DIR, '_test-step-1-berichte-liste.png'), fullPage: true });

        // Suche Report-Zeile mit Name "Taxiabrechnung Detail"
        console.log('[Hale-Test] Suche Zeile: ' + TEST_REPORT_NAME);
        // Versuch: alle <td> mit Text "Taxiabrechnung Detail" finden
        const reportRow = await page.locator(`tr:has-text("${TEST_REPORT_NAME}")`).first();
        const rowCount = await reportRow.count();
        console.log('[Hale-Test] Gefunden: ' + rowCount + ' Zeile(n)');
        if (rowCount === 0) {
            console.log('[Hale-Test] Report nicht gefunden — schaue Screenshot');
            await new Promise(() => {});
        }
        // Klick auf den ersten Action-Button in dieser Zeile (vermutlich ein Pfeil oder Edit-Icon)
        // Strategie 1: Klick auf "Generieren" oder ähnliches
        const actionBtn = await reportRow.locator('button, a, [role="button"]').first();
        await actionBtn.click();
        console.log('[Hale-Test] Action-Button geklickt');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(OUT_DIR, '_test-step-2-after-action-click.png'), fullPage: true });

        // Vermutlich öffnet sich ein Dialog mit Datum-Picker
        // Suche Datum-Input
        const dateInputs = await page.$$('input[type="date"], input[placeholder*="Datum"], input[placeholder*="Date"]');
        console.log('[Hale-Test] Datum-Inputs: ' + dateInputs.length);
        if (dateInputs.length > 0) {
            // Fülle alle Datum-Felder mit Test-Datum
            for (const di of dateInputs) {
                try { await di.fill(TEST_DATE); } catch {}
            }
        }
        // Submit/Generieren-Button suchen
        const generateBtn = await page.$('button:has-text("Generieren"), button:has-text("Bericht"), button:has-text("PDF"), button:has-text("Download"), button:has-text("Ausführen"), button:has-text("OK")');
        if (generateBtn) {
            console.log('[Hale-Test] Generieren-Button geklickt');
            await generateBtn.click();
        }
        await page.waitForTimeout(8000);
        await page.screenshot({ path: path.join(OUT_DIR, '_test-step-3-after-generate.png'), fullPage: true });
        console.log('[Hale-Test] Downloads: ' + downloads.length);

        console.log('[Hale-Test] Browser bleibt offen — bitte manuell weiter klicken wenn nötig. STRG+C zum Beenden.');
        await new Promise(() => {});
    } catch (e) {
        console.error('[Hale-Test] FEHLER:', e.message);
        await page.screenshot({ path: path.join(OUT_DIR, '_test-error.png'), fullPage: true }).catch(() => {});
        await new Promise(() => {});
    }
})();
