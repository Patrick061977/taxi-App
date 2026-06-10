#!/usr/bin/env node
// hale-bulk-2025.js — Pulle Hale-Tagesabrechnungen für JEDEN Tag 2025
// Pro Tag: 1 PDF + 1 CSV (Komplett-Bericht mit USt-Satz pro Zeile)
// ETA: ~3-4 Stunden

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_LOGIN = 'https://datacenter.hale.de/DC/Account/Login?ReturnUrl=%2FDC%2FActivities';
const EMAIL = 'taxiwydra@gmx.de';
const PASS = process.env.HALE_PASS;
const IDNR = 'DE205006336';

const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen/2025';
fs.mkdirSync(OUT_DIR, { recursive: true });

const REPORT_NAME = 'Taxiabrechnung Detail';  // bestätigt mit Patrick — Detail liefert CSV/PDF mit USt pro Zeile

function pad(n) { return String(n).padStart(2, '0'); }
function daysOfYear(year) {
    const days = [];
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`);
    }
    return days;
}

(async () => {
    const browser = await chromium.launch({ headless: false, args: ['--start-maximized'], slowMo: 200 });
    const context = await browser.newContext({ viewport: null, acceptDownloads: true, locale: 'de-DE' });
    const page = await context.newPage();
    let dlCount = 0;
    page.on('download', async d => {
        const fn = d.suggestedFilename();
        // Datum als Prefix nutzen — wir setzen bei jedem Save den aktuellen Datum-Context
        const dest = path.join(OUT_DIR, `${page._currentDate || 'unknown'}_${fn}`);
        try { await d.saveAs(dest); dlCount++; console.log('  [DL] ' + path.basename(dest)); } catch(e) { console.warn('DL-Fehler', e.message); }
    });

    try {
        // ─── LOGIN ───
        console.log('[Bulk] Login ...');
        await page.goto(URL_LOGIN, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        const inputs = await page.$$('input:not([type="hidden"]):not([type="checkbox"])');
        if (inputs.length >= 3) {
            await inputs[0].fill(EMAIL); await inputs[1].fill(PASS); await inputs[2].fill(IDNR);
        }
        await (await page.$('button[type="submit"]')).click();
        await page.waitForTimeout(4000);
        console.log('[Bulk] Login OK, URL:', page.url());

        // ─── AUSWERTUNG ───
        const ausLink = await page.$('a:has-text("Auswertung")');
        if (ausLink) await ausLink.click();
        await page.waitForTimeout(3000);

        // ─── ÖFFNE REPORT ─── (Klick auf Zeile-erste-td, dann Stift)
        // Variante: Klick auf den Report-Namen direkt (Hyperlink-Spalte 'Name')
        const reportLink = page.locator(`tr:has-text("${REPORT_NAME}") a, tr:has-text("${REPORT_NAME}") td:nth-child(2)`).first();
        try {
            await reportLink.click({ timeout: 10000 });
            console.log('[Bulk] Report-Link geklickt');
        } catch (e) {
            console.log('[Bulk] Report-Link nicht klickbar — versuche alternativ');
            // Alternative: Suche die "Pencil" Action-Buttons in der ersten Spalte
            const actionRow = page.locator(`tr:has-text("${REPORT_NAME}")`).first();
            await actionRow.locator('i, svg, [class*="edit"], [class*="pencil"]').first().click({ timeout: 5000, force: true }).catch(() => {});
        }
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(OUT_DIR, '_bulk-step-after-report-open.png'), fullPage: true });

        // ─── ITERIERE ÜBER 2025 ───
        const days = daysOfYear(2025);
        console.log('[Bulk] ' + days.length + ' Tage 2025');
        for (let i = 0; i < days.length; i++) {
            const date = days[i];
            page._currentDate = date.replace(/\./g, '-');  // für Filename-Prefix
            try {
                // Datum in Sidebar 'Individuell' setzen
                // Suche 2 Datums-Inputs in der linken Sidebar
                const dateFields = await page.$$('input[type="text"]:not([readonly])');
                // Heuristik: die Datums-Felder sind die ERSTEN ZWEI Inputs mit Datum-Format
                let setCount = 0;
                for (const f of dateFields) {
                    try {
                        await f.fill('');
                        await f.fill(date);
                        setCount++;
                        if (setCount >= 2) break;
                    } catch {}
                }
                if (setCount < 2) console.log(`  [${date}] Nur ${setCount} Datums-Felder gesetzt`);

                // Datenformat = CSV (nur Daten) — pro Iteration sicherstellen
                if (i === 0) {
                    // Beim ersten Mal: Dropdown wechseln zu CSV
                    const fmtLink = await page.$('a:has-text("PDF (.pdf)"), [class*="format"]');
                    if (fmtLink) {
                        await fmtLink.click().catch(() => {});
                        await page.waitForTimeout(500);
                        const csvOpt = await page.$('a:has-text("Textdatei (.csv) nur Daten"), a:has-text("Textdatei (.csv)"), li:has-text(".csv")');
                        if (csvOpt) {
                            await csvOpt.click();
                            console.log('[Bulk] Datenformat → CSV gewählt');
                        }
                        await page.waitForTimeout(500);
                    }
                }

                // Bericht anzeigen
                const showBtn = await page.$('button:has-text("Bericht anzeigen"), button:has-text("anzeigen")');
                if (!showBtn) { console.log(`  [${date}] Bericht-Button nicht da — break`); break; }
                await showBtn.click();
                await page.waitForTimeout(6000);  // Warte auf Download
                if ((i + 1) % 30 === 0) console.log(`  ... ${i+1}/${days.length} Tage durch, ${dlCount} Downloads`);
            } catch (e) {
                console.warn(`  [${date}] FEHLER: ${e.message}`);
                continue;
            }
        }

        console.log('[Bulk] FERTIG — ' + dlCount + ' Downloads. Browser bleibt offen.');
        await new Promise(() => {});
    } catch (e) {
        console.error('[Bulk] FATAL:', e.message);
        await page.screenshot({ path: path.join(OUT_DIR, '_bulk-error.png'), fullPage: true }).catch(() => {});
        await new Promise(() => {});
    }
})();
