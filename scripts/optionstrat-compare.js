#!/usr/bin/env node
// optionstrat-compare.js — Patrick 15.06.2026 08:25: SPY Iron Condor + SPY Calendar Put + IWM Iron Condor vergleichen
// OptionStrat Guest-Modus (kein Login). Screenshots + extrahierte Werte.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTDIR = path.resolve(__dirname, '..', 'assets', 'optionstrat-snapshots');
if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

const STRATEGIES = [
    { id: 'spy-iron-condor', name: 'SPY Iron Condor 7DTE', url: 'https://optionstrat.com/build/iron-condor/SPY' },
    { id: 'iwm-iron-condor', name: 'IWM Iron Condor 7DTE', url: 'https://optionstrat.com/build/iron-condor/IWM' },
    { id: 'spy-calendar-put', name: 'SPY Calendar Put Spread', url: 'https://optionstrat.com/build/calendar-put-spread/SPY' }
];

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();

    const results = [];
    for (const s of STRATEGIES) {
        console.log('[' + s.id + '] Lade ' + s.url);
        try {
            await page.goto(s.url, { waitUntil: 'networkidle', timeout: 45000 });
            await page.waitForTimeout(3500);
            // Try to wait for the chart
            try { await page.waitForSelector('canvas, svg.profit', { timeout: 10000 }); } catch (_) {}
            // Close any modal
            try {
                const closeBtn = await page.locator('button:has-text("✕"), button[aria-label="Close"], [class*="modal"] button').first();
                if (await closeBtn.count() > 0) { await closeBtn.click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(500); }
            } catch (_) {}
            const filepath = path.join(OUTDIR, s.id + '.png');
            await page.screenshot({ path: filepath, fullPage: false });
            console.log('  Screenshot:', filepath);
            // Extract key metrics
            const metrics = await page.evaluate(() => {
                const t = document.body.innerText;
                const out = {};
                const grab = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };
                out.maxProfit = grab(/Max\s+Profit[:\s\$]+([\d,\.\-]+)/i);
                out.maxLoss = grab(/Max\s+Loss[:\s\$]+([\d,\.\-]+)/i);
                out.cost = grab(/(?:Cost|Premium|Credit|Debit)[:\s\$]+([\d,\.\-]+)/i);
                out.breakeven = grab(/Break[-\s]?even[:\s\$]+([\d,\.\sand]+)/i);
                out.probProfit = grab(/Prob(?:ability)?\s*Profit[:\s%]+([\d\.]+)/i);
                out.delta = grab(/Delta[:\s]+([\-\d\.]+)/i);
                out.theta = grab(/Theta[:\s]+([\-\d\.]+)/i);
                out.fragment = t.slice(0, 200);
                return out;
            });
            results.push({ ...s, ...metrics, screenshot: filepath });
        } catch (e) {
            console.error('  ERR:', e.message);
            results.push({ ...s, error: e.message });
        }
    }
    await browser.close();

    fs.writeFileSync(path.join(OUTDIR, 'compare-results.json'), JSON.stringify(results, null, 2));
    console.log('\n=== ERGEBNIS ===');
    for (const r of results) {
        console.log(r.name + ': maxProfit=' + r.maxProfit + ' maxLoss=' + r.maxLoss + ' probProfit=' + r.probProfit + '% theta=' + r.theta);
    }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
