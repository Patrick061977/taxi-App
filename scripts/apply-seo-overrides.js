#!/usr/bin/env node
// v6.63.1003: Apply SEO Overrides from Firebase to static Landing HTML.
// Patrick 29.08.: nach Override-Edit im Admin-Panel müssen die statischen
//   taxi-*-zu-*.html Landings mit den neuen Werten (Preis/km/min/Intro/Hide)
//   aktualisiert werden. Läuft als GitHub Actions Cron oder manual dispatch.

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const DB_URL = 'https://taxi-heringsdorf-default-rtdb.europe-west1.firebasedatabase.app';

function fetchOverrides() {
    return new Promise((resolve, reject) => {
        const token = process.env.FIREBASE_TOKEN || '';
        const url = `${DB_URL}/seoRouteOverrides.json${token ? '?auth=' + token : ''}`;
        https.get(url, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data) || {}); }
                catch (e) { reject(new Error('Parse error: ' + e.message + ' body: ' + data.slice(0, 200))); }
            });
        }).on('error', reject);
    });
}

function slugFromFile(f) { return f.replace(/^taxi-/, '').replace(/\.html$/, ''); }

function updateHtml(html, ov) {
    // Preis in Title/Description/H1/JSON-LD ersetzen
    let out = html;

    // Description: "ca. X,XX € (Y km, Z Min)"
    if (ov.priceOverride != null || ov.kmOverride != null || ov.minOverride != null) {
        out = out.replace(
            /(ca\.\s*)([\d,]+)(\s*€\s*\()([\d,\.]+)(\s*km,\s*)(\d+)(\s*Min\))/,
            (m, pre, price, midK, km, midM, min, post) => {
                const p = ov.priceOverride != null ? ov.priceOverride.toFixed(2).replace('.', ',') : price;
                const k = ov.kmOverride != null ? ov.kmOverride.toFixed(1).replace('.', ',') : km;
                const mn = ov.minOverride != null ? ov.minOverride : min;
                return `${pre}${p}${midK}${k}${midM}${mn}${post}`;
            }
        );
        // Header .price div "10,60 €"
        if (ov.priceOverride != null) {
            const priceStr = ov.priceOverride.toFixed(2).replace('.', ',');
            out = out.replace(/(<div class="price"[^>]*>)([\d,]+)(\s*€)/, `$1${priceStr}$3`);
            // JSON-LD priceRange
            out = out.replace(/"priceRange"\s*:\s*"EUR\s*[\d,\.]+"/, `"priceRange":"EUR ${ov.priceOverride.toFixed(2)}"`);
        }
    }

    // Custom Intro ersetzen (v1003 - wenn vorhanden)
    if (ov.customIntro) {
        // Erster <p>...</p> nach der Header-Section
        out = out.replace(
            /(<main[^>]*>\s*<p[^>]*>)([\s\S]*?)(<\/p>)/,
            (m, pre, _content, post) => `${pre}${ov.customIntro.replace(/</g, '&lt;').replace(/>/g, '&gt;')}${post}`
        );
    }

    return out;
}

async function main() {
    const overrides = await fetchOverrides();
    const slugs = Object.keys(overrides);
    console.log(`📋 ${slugs.length} Overrides gefunden in Firebase`);

    let modified = 0, hidden = 0, deletedFromSitemap = [];

    for (const slug of slugs) {
        const ov = overrides[slug];
        if (!ov) continue;
        const file = `taxi-${slug}.html`;
        const fullPath = path.join(ROOT, file);
        if (!fs.existsSync(fullPath)) {
            console.log(`  ⚠️  ${file} — Slug nicht als Datei vorhanden, skip`);
            continue;
        }
        if (ov.hide) {
            fs.unlinkSync(fullPath);
            hidden++;
            deletedFromSitemap.push(file);
            console.log(`  🚫 ${file} — GELÖSCHT (hide=true)`);
            continue;
        }
        const original = fs.readFileSync(fullPath, 'utf8');
        const updated = updateHtml(original, ov);
        if (updated !== original) {
            fs.writeFileSync(fullPath, updated);
            modified++;
            const parts = [];
            if (ov.priceOverride != null) parts.push(`Preis=${ov.priceOverride}`);
            if (ov.kmOverride != null) parts.push(`km=${ov.kmOverride}`);
            if (ov.minOverride != null) parts.push(`min=${ov.minOverride}`);
            if (ov.customIntro) parts.push(`Intro=${ov.customIntro.slice(0, 40)}…`);
            console.log(`  ✏️  ${file} — ${parts.join(', ')}`);
        }
    }

    console.log(`\n✅ Fertig: ${modified} modifiziert, ${hidden} versteckt (gelöscht).`);
    return { modified, hidden, deletedFromSitemap };
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { main, fetchOverrides, updateHtml };
