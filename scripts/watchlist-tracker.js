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
const PRICE_DROP_THRESHOLD_PCT = 25; // v1.1: 10 → 25 (Puffer gegen Meta-Suche-Rauschen)
const PORTAL_TIMEOUT_MS = 25000;
const PORTAL_WAIT_AFTER_LOAD_MS = 4500;

function fbGet(path) {
    // v1.1 (Patrick 07.08.): --output <file> statt stdout — verhindert JSON.parse-Crash
    // durch ANSI-Deprecation-Warnings die neuere Firebase CLI in stdout schreibt.
    const tmp = require('os').tmpdir() + '/wtracker_get_' + Date.now() + '.json';
    const tokenArg = process.env.FIREBASE_TOKEN ? `--token ${process.env.FIREBASE_TOKEN}` : '';
    try {
        execSync(`firebase database:get "${path}" --project ${PROJECT} ${tokenArg} --output ${tmp}`, { stdio: ['ignore', 'ignore', 'pipe'] });
        const raw = require('fs').readFileSync(tmp, 'utf8');
        return JSON.parse(raw || 'null');
    } finally {
        try { require('fs').unlinkSync(tmp); } catch(e) {}
    }
}

function fbUpdate(path, obj) {
    if (DRY_RUN) { console.log(`  [dry-run] fbUpdate ${path}`, JSON.stringify(obj).slice(0, 120)); return; }
    const tmp = require('os').tmpdir() + '/wtracker_' + Date.now() + '.json';
    require('fs').writeFileSync(tmp, JSON.stringify(obj));
    try {
        execSync(`firebase database:update "${path}" ${tmp} --project ${PROJECT} ${process.env.FIREBASE_TOKEN ? '--token ' + process.env.FIREBASE_TOKEN : ''} -f`, { stdio: 'inherit' });
    } finally {
        try { require('fs').unlinkSync(tmp); } catch(e) {}
    }
}

async function scrapePortal(page, portal, entry) {
    const url = portal.buildUrl(entry);
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
        const result = await page.evaluate(portal.extract, { hotelName: entry.hotel || null, isDirectUrl: !!entry.bookingUrl });
        return { portal: portal.name, ...result, url };
    } catch (e) {
        return { portal: portal.name, error: e.message.slice(0, 100), url };
    }
}

const PORTALS = [
    {
        name: 'Booking',
        // v1.1 (Patrick 07.08.): Wenn entry.bookingUrl gesetzt → direkte Hotel-URL
        //   mit Datum/Personen-Params. Sonst pauschale Suche, sortiert nach
        //   Bewertungs-Score (statt Preis), damit Top-10 wirklich renommierte
        //   Hotels sind — nicht die billigsten (Ferienwohnungen/Hostels).
        buildUrl: (entry) => {
            const dest = entry.hotel || entry.destination;
            const q = encodeURIComponent(dest);
            const from = entry.dateFrom;
            const to = entry.dateTo;
            const adults = entry.adults || 2;
            if (entry.bookingUrl) {
                // Direkte Hotel-URL → nur diese Property, kein Rauschen
                const sep = entry.bookingUrl.includes('?') ? '&' : '?';
                return `${entry.bookingUrl}${sep}checkin=${from}&checkout=${to}&group_adults=${adults}`;
            }
            // Ziel-Suche: sortiert nach Score, damit Top-10 die renommierten sind
            return `https://www.booking.com/searchresults.html?ss=${q}&checkin=${from}&checkout=${to}&group_adults=${adults}&order=bayesian_review_score`;
        },
        extract: ({ hotelName, isDirectUrl }) => {
            const prices = [];
            const hotels = [];
            // Bei direkter Hotel-URL: Preis aus Hotel-Detail-Seite lesen
            if (isDirectUrl) {
                const priceCandidates = [];
                document.querySelectorAll('[data-testid="price-for-x-nights"], .prco-valign-middle-helper, [class*="prco-inline-block-maker-helper"], [data-price-for-nights]').forEach(el => {
                    const m = el.innerText.match(/(\d[\d.,]*)\s*€/);
                    if (m) priceCandidates.push(parseInt(m[1].replace(/[.,]/g, '')));
                });
                // Fallback: erster €-Betrag im Body zwischen 30-9999 (Hotel-Nacht/Aufenthalt)
                if (priceCandidates.length === 0) {
                    const bodyMatches = (document.body.innerText.match(/(\d[\d.,]*)\s*€/g) || []).slice(0, 10);
                    bodyMatches.forEach(m => {
                        const num = m.match(/(\d[\d.,]*)/);
                        if (num) {
                            const p = parseInt(num[1].replace(/[.,]/g, ''));
                            if (p >= 30 && p <= 9999) priceCandidates.push(p);
                        }
                    });
                }
                if (priceCandidates.length > 0) prices.push(Math.min(...priceCandidates));
                return { count: prices.length, min: prices.length ? prices[0] : null, sample: prices.slice(0, 5), hotels: [], mode: 'direct-hotel' };
            }
            // Ziel-Suche: Property-Cards durchgehen
            const hotelNameLower = hotelName ? hotelName.toLowerCase() : null;
            document.querySelectorAll('[data-testid="property-card"]').forEach((card) => {
                const nameEl = card.querySelector('[data-testid="title"]');
                const priceEl = card.querySelector('[data-testid="price-and-discounted-price"]');
                const scoreEl = card.querySelector('[data-testid="review-score"]');
                const linkEl = card.querySelector('a[data-testid="title-link"], a[href*="/hotel/"]');
                const name = nameEl ? nameEl.innerText.trim() : null;
                const priceM = priceEl ? priceEl.innerText.match(/(\d[\d.,]*)\s*€/) : null;
                const price = priceM ? parseInt(priceM[1].replace(/[.,]/g, '')) : null;
                const scoreText = scoreEl ? scoreEl.innerText : '';
                const scoreM = scoreText.match(/(\d+[.,]\d+)/);
                const score = scoreM ? parseFloat(scoreM[1].replace(',', '.')) : null;
                const reviewsM = scoreText.match(/(\d[\d.,]*)\s*(Bewert|review)/i);
                const reviews = reviewsM ? parseInt(reviewsM[1].replace(/[.,]/g, '')) : null;
                if (price) prices.push(price);
                if (name) {
                    hotels.push({
                        name,
                        price,
                        score,
                        reviews,
                        url: linkEl ? linkEl.href.split('?')[0] : null,
                    });
                }
            });
            // v1.2 (Patrick 07.08. Bridge): Threshold 100→1000 Reviews.
            //   Test mit Malta zeigte: bayesian_review_score liefert oben Airbnbs mit
            //   6-69 Reviews (hoher Score, unbedeutend). Marken-Hotels haben >=1000
            //   Reviews (Radisson 3522, Novotel 2065, Azur 9407). Threshold 1000
            //   filtert Klein-Anbieter aus und liefert echte Kandidaten.
            //   HARDER Filter: Hotels UNTER 1000 Reviews raus (nicht nur nachrangig)
            //   damit Top-10 wirklich renommiert ist.
            const MIN_REVIEWS = 1000;
            const qualified = hotels.filter(h => h.score != null && (h.reviews || 0) >= MIN_REVIEWS);
            qualified.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (b.reviews || 0) - (a.reviews || 0);
            });
            // Fallback wenn zu wenig qualifizierte (kleine Ziele): mit >=100 auffüllen
            let topHotels = qualified.slice(0, 10);
            if (topHotels.length < 5) {
                const softQualified = hotels
                    .filter(h => h.score != null && (h.reviews || 0) >= 100 && !qualified.includes(h))
                    .sort((a, b) => (b.score !== a.score ? b.score - a.score : (b.reviews || 0) - (a.reviews || 0)));
                topHotels = [...topHotels, ...softQualified].slice(0, 10);
            }
            // Bei Ziel-Suche mit hotelName-Filter: nur Preise aus passenden Cards nehmen
            let filteredPrices = prices;
            if (hotelNameLower) {
                filteredPrices = hotels
                    .filter(h => h.name && h.name.toLowerCase().includes(hotelNameLower) && h.price)
                    .map(h => h.price);
            }
            return {
                count: filteredPrices.length,
                min: filteredPrices.length ? Math.min(...filteredPrices) : null,
                sample: filteredPrices.slice(0, 5),
                hotels: topHotels,
                mode: hotelNameLower ? 'name-filtered' : 'destination-search',
            };
        },
    },
    {
        name: 'Google_Hotels',
        // Google Hotels bleibt informationell (Consent-Wall macht präzise Extraktion
        // schwierig). Preise werden gespeichert aber NICHT für Drop-Alarme genutzt
        // (nur Booking ist Alarm-autoritativ, siehe pushBridge-Logik unten).
        buildUrl: (entry) => {
            const dest = entry.hotel || entry.destination;
            const q = encodeURIComponent(dest);
            return `https://www.google.com/travel/hotels?q=${q}&checkin=${entry.dateFrom}&checkout=${entry.dateTo}`;
        },
        extract: () => {
            const prices = [];
            const bodyText = document.body.innerText;
            const matches = bodyText.match(/(\d[\d.,]*)\s*€/g) || [];
            matches.slice(0, 30).forEach(m => {
                const num = m.match(/(\d[\d.,]*)/);
                if (num) {
                    const p = parseInt(num[1].replace(/[.,]/g, ''));
                    if (p >= 30 && p <= 5000) prices.push(p);
                }
            });
            return { count: prices.length, min: prices.length ? Math.min(...prices) : null, sample: prices.slice(0, 5), mode: 'body-regex-informational' };
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
        execSync(`firebase database:update "/claudeBridge/outbox/${ts}" ${tmp} --project ${PROJECT} ${process.env.FIREBASE_TOKEN ? '--token ' + process.env.FIREBASE_TOKEN : ''} -f`, { stdio: 'inherit' });
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
        console.log('⚠️ FIREBASE_TOKEN env-var nicht gesetzt — nutze lokalen firebase-Login-Cache');
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
        // v1.1: Booking ist AUTORITATIV für Drop-Alarm (Property-Card, präzise).
        // Google Hotels bleibt informationell (Body-Regex, zu viel Rauschen).
        const bookingResult = results.find(r => r.portal === 'Booking') || {};
        const googleResult = results.find(r => r.portal === 'Google_Hotels') || {};
        const authoritativeMin = bookingResult.min != null ? bookingResult.min : null;
        const informationalMin = googleResult.min != null ? googleResult.min : null;
        // priceFrom im Snapshot: bevorzuge Booking, fallback Google
        const overallMin = authoritativeMin != null ? authoritativeMin : informationalMin;
        const overallMax = informationalMin != null && authoritativeMin != null
            ? Math.max(authoritativeMin, informationalMin)
            : overallMin;

        const prevSnaps = entry.snapshots || [];
        // Nur vorherige Booking-basierte Snapshots als Referenz für Drop-Alarm
        const prevAuthoritative = prevSnaps
            .map(s => s.authoritativeMin)
            .filter(p => p != null);
        const prevMin = prevAuthoritative.length ? Math.min(...prevAuthoritative) : null;

        if (overallMin == null) {
            console.log(`     ⚠️ Keine Preise ermittelt — kein Snapshot geschrieben`);
            summary.push({ id, title: entry.title, status: 'no-data' });
            continue;
        }

        const snapshot = {
            priceFrom: overallMin,
            priceTo: overallMax,
            authoritativeMin, // v1.1: Booking-Preis (verlässlich), null wenn Booking geblockt
            informationalMin, // v1.1: Google-Preis (Body-Regex, Rauschen möglich)
            mode: entry.bookingUrl ? 'direct-hotel' : (entry.hotel ? 'name-filtered' : 'destination-search'),
            summary: results.map(r => r.error ? `${r.portal}: err` : `${r.portal}: min ${r.min}€ (${r.count} Angebote, ${r.mode || '-'})`).join(' | '),
            quelle: 'auto-tracker-v1.1',
            portals: results.map(r => ({ portal: r.portal, min: r.min || null, count: r.count || 0, mode: r.mode || null, error: r.error || null })),
            ts: Date.now(),
        };
        console.log(`     ▶ Snapshot: authoritative(Booking)=${authoritativeMin != null ? authoritativeMin+'€' : 'n/a'}, informational(Google)=${informationalMin != null ? informationalMin+'€' : 'n/a'}  (vorher-authoritative: ${prevMin != null ? prevMin + '€' : 'neu'})`);

        // v1.1 (Phase 1c): Top-10 Hotels aus Booking-Suchergebnis speichern
        const bookingHotels = (results.find(r => r.portal === 'Booking') || {}).hotels || [];
        const patch = { snapshots: [...prevSnaps, snapshot].slice(-30) };
        if (bookingHotels.length > 0) {
            patch.topHotels = bookingHotels.map(h => ({ ...h, ts: Date.now(), source: 'booking' }));
            console.log(`     ▶ Top-Hotels: ${bookingHotels.length} (best: "${bookingHotels[0].name}" @ ${bookingHotels[0].price}€, score ${bookingHotels[0].score || 'n/a'})`);
        }
        fbUpdate(`/urlaubWatchlist/${id}`, patch);

        // v1.1: Drop-Alarm NUR wenn authoritativer (Booking-)Preis heute UND vorher da
        // war. Verhindert Fehl-Alarme durch Google-Rauschen.
        if (prevMin != null && authoritativeMin != null && authoritativeMin < prevMin) {
            const dropPct = ((prevMin - authoritativeMin) / prevMin) * 100;
            if (dropPct >= PRICE_DROP_THRESHOLD_PCT) {
                const msg = `🎉 Preisdrop Urlaubs-Watchlist\n\n${entry.title}\n${entry.hotel || entry.destination}\n📅 ${entry.dateFrom} → ${entry.dateTo}\n\nvorher: ab ${prevMin}€\njetzt:  ab ${authoritativeMin}€\nErsparnis: ${Math.round(prevMin - authoritativeMin)}€ (-${Math.round(dropPct)}%)\n\nQuelle: Booking (autoritativ)\n→ urlaub.html ansehen`;
                console.log(`     🎉 PREISDROP ${Math.round(dropPct)}% (autoritativ) — Push wird gesendet`);
                pushBridge(msg);
                summary.push({ id, title: entry.title, status: 'drop', dropPct: Math.round(dropPct), prevMin, newMin: authoritativeMin });
            } else {
                summary.push({ id, title: entry.title, status: 'minor-drop', dropPct: Math.round(dropPct) });
            }
        } else if (prevMin == null) {
            summary.push({ id, title: entry.title, status: 'first-snapshot', newMin: overallMin });
        } else if (authoritativeMin == null) {
            summary.push({ id, title: entry.title, status: 'no-authoritative' });
        } else {
            summary.push({ id, title: entry.title, status: 'stable-or-up', prevMin, newMin: authoritativeMin });
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
