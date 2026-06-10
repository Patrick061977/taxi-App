#!/usr/bin/env node
// hale-bulk-v3.js — Bessere Selector-Strategie, Dom-Inspection
// Patrick: 'du hast vorne was zusammenbekommen' — heißt der first-Cell-Click hat damals den
// CSV-Download getriggert. Wiederholen wir das + iterieren über Datums.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';
const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/2025';
fs.mkdirSync(OUT_DIR, { recursive: true });

function pad(n) { return String(n).padStart(2, '0'); }
function daysOfYear(year) {
    const days = [];
    for (let d = new Date(year, 0, 1); d <= new Date(year, 11, 31); d.setDate(d.getDate() + 1)) {
        days.push(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`);
    }
    return days;
}

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 300 });
    const context = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await context.newPage();
    let dlCount = 0;
    page.on('download', async d => {
        const fn = d.suggestedFilename();
        const prefix = page._currentDate ? page._currentDate + '_' : 'unknown_';
        const dest = path.join(OUT_DIR, prefix + fn);
        try { await d.saveAs(dest); dlCount++; console.log('  [DL ' + dlCount + '] ' + path.basename(dest)); }
        catch (e) { console.warn('DL err: ' + e.message); }
    });

    try {
        // ─── LOGIN ───
        console.log('[v3] Login');
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL); await inputs[1].fill(PASS); await inputs[2].fill(IDNR);
        }
        await (await page.$('button[type="submit"]')).click();
        await page.waitForTimeout(4000);
        console.log('[v3] Login OK');

        // ─── AUSWERTUNG ───
        const ausLink = await page.$('a:has-text("Auswertung")');
        if (ausLink) await ausLink.click();
        await page.waitForTimeout(3000);
        console.log('[v3] Auswertung URL:', page.url());

        // ─── REPORT-ZEILE FINDEN + KLICKEN ───
        const reportName = 'Taxiabrechnung Detail';
        // Wir wissen aus Test: First-Cell-Klick öffnet vermutlich kein Menü, aber der "Berichts anzeigen" Direkt-Klick auf eine Zeile öffnet den Editor.
        // Versuche: Doppelklick auf die Zeile selber
        const row = page.locator(`tr:has-text("${reportName}")`).first();
        console.log('[v3] Doppelklick auf Zeile');
        await row.dblclick({ timeout: 10000 }).catch(e => console.log('  dblclick fehlgeschlagen: ' + e.message));
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(OUT_DIR, '_v3-step1-after-dblclick.png'), fullPage: true });

        // Wenn nicht: versuche Klick auf Name (2. Zelle)
        let inEditor = page.url().includes('Edit') || page.url().includes('Show');
        if (!inEditor) {
            console.log('[v3] Editor noch nicht offen → Klick auf Name-Zelle');
            await row.locator('td').nth(1).click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(3000);
            inEditor = page.url().includes('Edit') || page.url().includes('Show');
        }

        if (!inEditor) {
            console.log('[v3] Editor immer noch nicht offen — DOM-Inspection');
            const html = await row.evaluate(el => el.outerHTML);
            console.log('[v3] Zeilen-HTML (300 Zeichen):', html.slice(0, 300));
            // Probe per JavaScript click() (umgeht Playwright Click-Sicherheit)
            await row.evaluate(el => {
                const firstClickable = el.querySelector('a, button, [onclick], [role="button"], svg, i[class]');
                if (firstClickable) firstClickable.click();
            });
            await page.waitForTimeout(3000);
        }

        await page.screenshot({ path: path.join(OUT_DIR, '_v3-step2-after-jsclick.png'), fullPage: true });
        console.log('[v3] URL jetzt:', page.url());

        // ─── EDITOR-CHECK ───
        const datumInputs = await page.$$('input[type="text"]');
        console.log('[v3] Editor-Text-Inputs: ' + datumInputs.length);
        if (datumInputs.length < 2) {
            console.log('[v3] Editor nicht erreicht. Skript stoppt.');
            await new Promise(() => {});
            return;
        }

        // ─── ITERIERE 2025 ───
        const days = daysOfYear(2025);
        for (let i = 0; i < days.length; i++) {
            const date = days[i];
            page._currentDate = date.replace(/\./g, '-');
            try {
                // Datums-Felder: ERSTEN 2 Text-Inputs neu setzen
                const fields = await page.$$('input[type="text"]');
                let setN = 0;
                for (const f of fields.slice(0, 5)) {
                    try {
                        await f.click({ clickCount: 3 }); // Select all
                        await f.fill(date);
                        setN++;
                        if (setN >= 2) break;
                    } catch {}
                }

                // Bericht anzeigen
                const showBtn = await page.$('button:has-text("Bericht anzeigen")');
                if (!showBtn) { console.log(`  [${date}] Bericht-Button NICHT GEFUNDEN → break`); break; }
                await showBtn.click();
                await page.waitForTimeout(5000);  // Wait for download
                if ((i + 1) % 30 === 0) console.log(`  ... ${i+1}/${days.length}, DL=${dlCount}`);
            } catch (e) {
                console.warn(`  [${date}] ERR: ${e.message}`);
            }
        }
        console.log('[v3] FERTIG: ' + dlCount + ' Downloads');
        await new Promise(() => {});
    } catch (e) {
        console.error('[v3] FATAL:', e.message);
        await page.screenshot({ path: path.join(OUT_DIR, '_v3-error.png'), fullPage: true }).catch(() => {});
        await new Promise(() => {});
    }
})();
