#!/usr/bin/env node
/**
 * Wochen-SEO-Check — jeden Montag früh via GitHub Actions
 *
 * Sammelt:
 *  1. Sitemap-Health (URLs, Last-Modified auf Server)
 *  2. Live-Check der wichtigsten Landing-Pages (HTTP-Status)
 *  3. Indexierungs-Schätzung via Bing "site:umwelt-taxi-insel-usedom.de"
 *  4. Konkurrenz-Baseline: funk-taxi-heringsdorf.de dieselbe Query
 *
 * Push-Ziel: Claude-Bot an Patrick via Bridge-Outbox.
 *
 * ENV-Variablen (aus GitHub-Secrets):
 *   FIREBASE_TOKEN — Firebase CLI Token für DB-Access
 *   TG_CHAT_ID     — Patricks Chat-ID (fallback 6229490043)
 */
const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DOMAIN = 'umwelt-taxi-insel-usedom.de';
const CONCURRENT = 'funk-taxi-heringsdorf.de';
const PROJECT = 'taxi-heringsdorf';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '6229490043';

const KEY_LANDINGS = [
    'landing.html',
    'flughafen-heringsdorf.html',
    'berlin.html',
    'taxi-preise.html',
    'taxi-bahnhof-heringsdorf.html',
    'taxi-bahnhof-ahlbeck.html',
    'taxi-bahnhof-bansin.html',
    'taxi-hotel-usedom.html',
    'taxi-zu-pommerscher-hof.html',
    'taxi-zu-strandhotel-heringsdorf.html',
    'taxi-zu-ahlbecker-hof.html',
    'sitemap.xml',
    'robots.txt',
];

const KEY_QUERIES = [
    'Taxi Heringsdorf',
    'Taxi Ahlbeck',
    'Taxi Bansin',
    'Flughafentransfer Heringsdorf',
    'Taxi Insel Usedom',
];

function httpGet(url, headers = {}) {
    return new Promise((resolve) => {
        const opts = { method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0 SEOCheck', ...headers } };
        const req = https.request(url, opts, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', (e) => resolve({ status: 0, error: e.message }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
        req.end();
    });
}

async function checkLiveUrls() {
    const results = [];
    for (const p of KEY_LANDINGS) {
        const r = await httpGet(`https://${DOMAIN}/${p}`);
        results.push({ path: p, status: r.status });
    }
    return results;
}

async function fetchSitemapStats() {
    const r = await httpGet(`https://${DOMAIN}/sitemap.xml`);
    if (r.status !== 200) return { ok: false, status: r.status };
    const urlCount = (r.body.match(/<url>/g) || []).length;
    const lastMod = r.headers['last-modified'] || '';
    return { ok: true, urlCount, lastMod };
}

async function bingSiteQuery(domain) {
    // Bing zählt "About N results" für site:-Queries.
    const r = await httpGet(`https://www.bing.com/search?q=site%3A${encodeURIComponent(domain)}&count=10`);
    if (r.status !== 200) return null;
    // Bing zeigt "Über X Ergebnisse" oder "X results"
    const m = r.body.match(/([\d\.,]+)\s+(Ergebnisse|results)/i);
    return m ? m[1].replace(/[\.,]/g, '') : null;
}

async function bingRankCheck(query, targetDomain) {
    // Wie oft erscheint targetDomain in den ersten 30 Bing-Ergebnissen?
    const r = await httpGet(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=30`);
    if (r.status !== 200) return { rank: null };
    const positions = [];
    let idx = 0;
    // Simpler Extraktor: sucht href="..."-Blöcke mit tatsächlichen Result-URLs
    const links = [...r.body.matchAll(/<h2[^>]*><a[^>]*href="([^"]+)"/g)];
    links.forEach((mm, i) => {
        if (mm[1].includes(targetDomain)) positions.push(i + 1);
    });
    return { rank: positions[0] || null, all: positions };
}

function fmt(n) {
    return typeof n === 'number' ? n.toLocaleString('de-DE') : (n ?? '?');
}

async function main() {
    console.log('=== Wochen-SEO-Check ===');
    const now = new Date();
    const week = `KW ${Math.ceil(((now - new Date(now.getFullYear(), 0, 1)) / 86400000 + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)}`;

    // 1) Sitemap
    console.log('[1/4] Sitemap...');
    const sm = await fetchSitemapStats();

    // 2) Live-URLs
    console.log('[2/4] Live-URLs...');
    const liveChecks = await checkLiveUrls();
    const okCount = liveChecks.filter(x => x.status === 200).length;
    const failList = liveChecks.filter(x => x.status !== 200).map(x => `${x.path} (${x.status})`);

    // 3) Bing site: Query
    console.log('[3/4] Bing site:-Query...');
    const bingOurs = await bingSiteQuery(DOMAIN);
    const bingConcurrent = await bingSiteQuery(CONCURRENT);

    // 4) Ranking-Check
    console.log('[4/4] Ranking-Check (Bing)...');
    const rankings = [];
    for (const q of KEY_QUERIES) {
        const ours = await bingRankCheck(q, DOMAIN);
        const conc = await bingRankCheck(q, CONCURRENT);
        rankings.push({ query: q, ours: ours.rank, conc: conc.rank });
    }

    // Report bauen
    const lines = [];
    lines.push(`📊 SEO-Wochen-Check · ${week} · ${now.toLocaleDateString('de-DE')}`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push('📄 Sitemap:');
    if (sm.ok) {
        lines.push(`   URLs: ${sm.urlCount}  ·  Last-Modified: ${sm.lastMod || '?'}`);
    } else {
        lines.push(`   ❌ nicht erreichbar (HTTP ${sm.status})`);
    }
    lines.push('');
    lines.push('🌐 Live-URLs:');
    lines.push(`   ${okCount} von ${liveChecks.length} OK`);
    if (failList.length) {
        lines.push('   Fehler:');
        failList.forEach(f => lines.push(`   • ${f}`));
    }
    lines.push('');
    lines.push('🔍 Bing-Index (site:-Query):');
    lines.push(`   ${DOMAIN}: ~${fmt(bingOurs)} Seiten`);
    lines.push(`   ${CONCURRENT}: ~${fmt(bingConcurrent)} Seiten`);
    lines.push('');
    lines.push('🏆 Ranking-Vergleich (Bing Top-30):');
    for (const r of rankings) {
        const oursTxt = r.ours ? `Pos ${r.ours}` : '—';
        const cTxt = r.conc ? `Pos ${r.conc}` : '—';
        const winner = r.ours && (!r.conc || r.ours < r.conc) ? '👑 wir' :
                       r.conc && (!r.ours || r.conc < r.ours) ? 'funk-taxi vorn' : '≈';
        lines.push(`   "${r.query}":  wir ${oursTxt}  ·  funk-taxi ${cTxt}  ${winner}`);
    }
    lines.push('');
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push('_Automatischer Report jeden Montag früh via GitHub Actions._');
    lines.push('_Für Detailanalyse: bitte GSC-Coverage-ZIP schicken._');

    const message = lines.join('\n');
    console.log('\n' + message);

    // Bridge-Push
    const ts = Date.now();
    const payload = {
        message,
        targetChatId: parseInt(TG_CHAT_ID),
        via: 'claude',
        ts
    };
    const tmp = path.join(os.tmpdir(), `seo-push-${ts}.json`);
    fs.writeFileSync(tmp, JSON.stringify(payload));
    try {
        const tokenArg = process.env.FIREBASE_TOKEN ? `--token ${process.env.FIREBASE_TOKEN}` : '';
        execSync(`firebase database:update "/claudeBridge/outbox/${ts}" ${tmp} --project ${PROJECT} ${tokenArg} -f`, { stdio: 'inherit' });
        console.log(`\n✅ Bridge-Push gesendet (ts=${ts})`);
    } catch (e) {
        console.error('❌ Bridge-Push fehlgeschlagen:', e.message);
        process.exit(1);
    } finally {
        try { fs.unlinkSync(tmp); } catch {}
    }
}

main().catch(e => { console.error(e); process.exit(1); });
