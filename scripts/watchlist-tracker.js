#!/usr/bin/env node
// Watchlist-Preis-Tracker Phase 1 (Patrick 06.08.2026)
//
// Läuft alle 12h via GitHub Action, scraped Booking + Google Hotels für
// jeden Eintrag in /urlaubWatchlist mit hotel/destination + dateFrom + dateTo,
// speichert Snapshot in {id}/snapshots[], pusht Telegram bei Preisdrop >10%.
//
// Env-Vars:
//   FIREBASE_TOKEN — Firebase CLI Token für DB-Access
//   TG_CHAT_ID     — Patricks Chat-ID für Push (fallback: 6229490043)
//   HEADLESS       — 'false' um Chrome sichtbar zu starten (nur lokal, für Debug)
//
// Args:
//   --dry-run      — kein Firebase-Write, kein Push, nur Log
//   --only=<id>    — nur diesen einen Watchlist-Eintrag verarbeiten

const { execSync } = require('child_process');
const { chromium } = require('playwright');

const PROJECT = 'taxi-heringsdorf';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6229490043';
const HEADLESS = process.env.HEADLESS !== 'false';
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_ARG = process.argv.find(a => a.startsWith('--only='));
const ONLY = ONLY_ARG ? ONLY_ARG.slice('--only='.length) : null;
const PRICE_DROP_THRESHOLD_PCT = 10; // Push wenn neu min >10% unter altem min
const PORTAL_TIMEOUT_MS = 25000;
const PORTAL_WAIT_AFTER_LOAD_MS = 4500;

function fbGet(path) {
    const cmd = `firebase database:get "${path}" --project ${PROJECT} --token ${process.env.FIREBASE_TOKEN}`;
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out || 'null');
}

function fbUpdate(path, obj) {
    if (DRY_RUN) { console.log(`  [dry-run] fbUpdate ${path}`, JSON.stringify(obj).slice(0, 120)); return; }
    const tmp = require('os').tmpdir() + '/wtracker_' + Date.now() + '.json';
    require('fs').writeFileSync(tmp, JSON.stringify(obj));
    try {
        execSync(`firebase database:update "${path}" ${tmp} --project ${PROJECT} --token ${process.env.FIREBASE_TOKEN} -y`, { stdio: 'inherit' });
    } finally {
        try { require('fs').unlinkSync(tmp); } catch(e) {}
    }
}

async function scrapePortal(page, portal, entry) {
    const dest = entry.hotel || entry.destination;
    const q = encodeURIComponent(dest);
    const qHyphen = encodeURIComponent(dest.replace(/\s+/g, '-'));
    const url = portal.buildUrl(q, qHyphen, entry.dateFrom, entry.dateTo, entry.adults || 2);
    console.log(`  → ${portal.name}: ${url.slice(0, 100)}${url.length > 100 ? '...' : ''}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PORTAL_TIMEOUT_MS });
        // Consent-Banner wegklicken
        const consentTexts = ['Alle akzeptieren', 'Zustimmen', 'Accept all', 'OK', 'Akzeptieren'];
        for (const txt of consentTexts) {
            try {
                const btn = await page.locator(`button:has-text("${txt}")`).first();
                if (await btn.isVisible({ timeout: 400 })) {
                    await btn.click({ timeout: 1500 });
                    await page.waitForTimeout(1500);
                    break;
                }
            } catch(e) {}
        }
        await page.waitForTimeout(PORTAL_WAIT_AFTER_LOAD_MS);
        const result = await page.evaluate(portal.extract);
        return { portal: portal.name, ...result, url };
    } catch (e) {
        return { portal: portal.name, error: e.message.slice(0, 100), url };
    }
}

const PORTALS = [
    {
        name: 'Booking',
        buildUrl: (q, qh, from, to, adults) =>
            `https://www.booking.com/searchresults.html?ss=${q}&checkin=${from}&checkout=${to}&group_adults=${adults}&order=price`,
        extract: () => {
            const prices = [];
            document.querySelectorAll('[data-testid="price-and-discounted-price"]').forEach(el => {
                const m = el.innerText.match(/(\d[\d.,]*)\s*€/);
                if (m) prices.push(parseInt(m[1].replace(/[.,]/g, '')));
            });
            if (prices.length === 0) {
                document.querySelectorAll('[data-testid="property-card"]').forEach(card => {
                    const m = card.innerText.match(/(\d[\d.,]*)\s*€/);
                    if (m) prices.push(parseInt(m[1].replace(/[.,]/g, '')));
                });
            }
            return { count: prices.length, min: prices.length ? Math.min(...prices) : null, sample: prices.slice(0, 5) };
        },
    },
    {
        name: 'Google_Hotels',
        buildUrl: (q, qh, from, to, adults) =>
            `https://www.google.com/travel/hotels?q=${q}&checkin=${from}&checkout=${to}`,
        extract: () => {
            const prices = [];
            const bodyText = document.body.innerText;
            const matches = bodyText.match(/(\d[\d.,]*)\s*€/g) || [];
            matches.slice(0, 30).forEach(m => {
                const num = m.match(/(\d[\d.,]*)/);
                if (num) {
                    const p = parseInt(num[1].replace(/[.,]/g, ''));
                    if (p >= 30 && p <= 5000) prices.push(p); // Sanity-Range: 30-5000 €
                }
            });
            return { count: prices.length, min: prices.length ? Math.min(...prices) : null, sample: prices.slice(0, 5) };
        },
    },
];

function pushBridge(message) {
    if (DRY_RUN) { console.log(`  [dry-run] pushBridge: ${message.slice(0, 100)}`); return; }
    const ts = Date.now();
    const outbox = {
        message,
        targetChatId: parseInt(TG_CHAT_ID),
        via: 'claude',
        ts,
    };
    const tmp = require('os').tmpdir() + '/wtracker_bridge_' + ts + '.json';
    require('fs').writeFileSync(tmp, JSON.stringify(outbox));
    try {
        execSync(`firebase database:update "/claudeBridge/outbox/${ts}" ${tmp} --project ${PROJECT} --token ${process.env.FIREBASE_TOKEN} -y`, { stdio: 'inherit' });
    } finally {
        try { require('fs').unlinkSync(tmp); } catch(e) {}
    }
}

(async () => {
    console.log(`═══════════════════════════════════════════════════`);
    console.log(`Watchlist-Preis-Tracker Phase 1  |  ${new Date().toISOString()}`);
    console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}  |  Headless: ${HEADLESS}${ONLY ? '  |  Only: ' + ONLY : ''}`);
    console.log(`═══════════════════════════════════════════════════`);

    if (!process.env.FIREBASE_TOKEN) {
        console.error('❌ FIREBASE_TOKEN env-var fehlt');
        process.exit(1);
    }

    console.log('Lese /urlaubWatchlist ...');
    const all = fbGet('/urlaubWatchlist') || {};
    const entries = Object.entries(all);
    console.log(`Gesamt: ${entries.length} Einträge`);

    const tracked = entries.filter(([id, e]) => {
        if (ONLY && id !== ONLY) return false;
        const hasQuery = e.hotel || e.destination;
        const hasDates = e.dateFrom && e.dateTo;
        if (!hasQuery || !hasDates) return false;
        return true;
    });
    console.log(`Trackbar (hat hotel/destination + dateFrom + dateTo): ${tracked.length}\n`);

    if (tracked.length === 0) {
        console.log('Nichts zu tun.');
        return;
    }

    const browser = await chromium.launch({ headless: HEADLESS });
    const ctx = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        viewport: { width: 1400, height: 900 },
        locale: 'de-DE',
    });
    const page = await ctx.newPage();

    const summary = [];
    for (const [id, entry] of tracked) {
        console.log(`\n─── ${entry.title || id} ─────────────`);
        console.log(`  ${entry.hotel || entry.destination}  |  ${entry.dateFrom} → ${entry.dateTo}  |  ${entry.adults || 2} Erw`);
        const results = [];
        for (const portal of PORTALS) {
            const r = await scrapePortal(page, portal, entry);
            results.push(r);
            if (r.error) {
                console.log(`     ❌ ${r.error}`);
            } else {
                console.log(`     ✓ ${r.count} Preise, min ${r.min ? r.min + '€' : 'n/a'}, sample [${r.sample.map(p => p + '€').join(', ')}]`);
            }
        }
        const validMins = results.filter(r => r.min != null).map(r => r.min);
        const overallMin = validMins.length ? Math.min(...validMins) : null;
        const overallMax = validMins.length ? Math.max(...validMins) : null;

        const prevSnaps = entry.snapshots || [];
        const prevMin = prevSnaps.length ? Math.min(...prevSnaps.map(s => s.priceFrom).filter(p => p != null)) : null;

        if (overallMin == null) {
            console.log(`     ⚠️ Keine Preise ermittelt — kein Snapshot geschrieben`);
            summary.push({ id, title: entry.title, status: 'no-data' });
            continue;
        }

        const snapshot = {
            priceFrom: overallMin,
            priceTo: overallMax,
            summary: results.map(r => r.error ? `${r.portal}: err` : `${r.portal}: min ${r.min}€ (${r.count} Angebote)`).join(' | '),
            quelle: 'auto-tracker-v1',
            portals: results.map(r => ({ portal: r.portal, min: r.min || null, count: r.count || 0, error: r.error || null })),
            ts: Date.now(),
        };
        console.log(`     ▶ Snapshot: min ${overallMin}€ (vorher: ${prevMin != null ? prevMin + '€' : 'neu'})`);

        const newSnaps = [...prevSnaps, snapshot].slice(-30); // max 30 Snapshots pro Eintrag
        fbUpdate(`/urlaubWatchlist/${id}`, { snapshots: newSnaps });

        // Preis-Drop erkennen: nur pushen wenn deutlicher Rückgang
        if (prevMin != null && overallMin < prevMin) {
            const dropPct = ((prevMin - overallMin) / prevMin) * 100;
            if (dropPct >= PRICE_DROP_THRESHOLD_PCT) {
                const msg = `🎉 Preisdrop Urlaubs-Watchlist\n\n${entry.title}\n${entry.hotel || entry.destination}\n📅 ${entry.dateFrom} → ${entry.dateTo}\n\nvorher: ab ${prevMin}€\njetzt:  ab ${overallMin}€\nErsparnis: ${Math.round(prevMin - overallMin)}€ (-${Math.round(dropPct)}%)\n\n→ urlaub.html ansehen`;
                console.log(`     🎉 PREISDROP ${Math.round(dropPct)}% — Push wird gesendet`);
                pushBridge(msg);
                summary.push({ id, title: entry.title, status: 'drop', dropPct: Math.round(dropPct), prevMin, newMin: overallMin });
            } else {
                summary.push({ id, title: entry.title, status: 'minor-drop', dropPct: Math.round(dropPct) });
            }
        } else if (prevMin == null) {
            summary.push({ id, title: entry.title, status: 'first-snapshot', newMin: overallMin });
        } else {
            summary.push({ id, title: entry.title, status: 'stable-or-up', prevMin, newMin: overallMin });
        }
    }

    await browser.close();

    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`ZUSAMMENFASSUNG (${summary.length}):`);
    summary.forEach(s => console.log(`  ${s.status.padEnd(18)} ${s.title || s.id}${s.dropPct ? ' (-' + s.dropPct + '%)' : ''}`));
    console.log(`═══════════════════════════════════════════════════`);
})().catch(e => {
    console.error('❌ FATAL:', e.message);
    process.exit(1);
});
