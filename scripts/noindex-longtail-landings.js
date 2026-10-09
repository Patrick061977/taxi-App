#!/usr/bin/env node
// noindex-longtail-landings.js — Patrick 09.10.2026 09:48 "mach A":
// Setzt noindex-Tag auf alle Longtail-Routen-Landings (taxi-<pickup>-zu-<ziel>.html)
// und entfernt sie aus sitemap.xml.
//
// Grund: 283 dieser URLs sind in GSC "Gefunden – zurzeit nicht indexiert"
// mit Last-Crawl 1970-01-01 (= Google hat sie nie besucht). Google ignoriert
// programmatische Longtail-Templates seit Helpful Content Update 2024.
//
// Strategie: Crawl-Budget auf die ~15-20 Hauptseiten konzentrieren.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const PATTERN = /^taxi-.+-zu-.+\.html$/;
const NOINDEX_TAG = '<meta name="robots" content="noindex, follow">';
const MARKER = '<!-- noindex via scripts/noindex-longtail-landings.js -->';

function processHtmlFile(file) {
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes(MARKER)) return { skipped: true, reason: 'already-tagged' };
    if (content.includes('name="robots"') && content.includes('noindex')) return { skipped: true, reason: 'has-noindex' };

    // Insert noindex meta right after <meta name="description">, or before </head> as fallback
    let patched;
    const descMatch = content.match(/<meta name="description"[^>]*>/);
    if (descMatch) {
        const insertAt = descMatch.index + descMatch[0].length;
        patched = content.slice(0, insertAt) + '\n' + MARKER + '\n' + NOINDEX_TAG + content.slice(insertAt);
    } else {
        const headEnd = content.indexOf('</head>');
        if (headEnd === -1) return { skipped: true, reason: 'no-head-end' };
        patched = content.slice(0, headEnd) + MARKER + '\n' + NOINDEX_TAG + '\n' + content.slice(headEnd);
    }

    fs.writeFileSync(file, patched);
    return { patched: true };
}

function processSitemap(longtailBasenames) {
    const content = fs.readFileSync(SITEMAP, 'utf8');
    const beforeCount = (content.match(/<loc>/g) || []).length;

    // Match each <url>...</url> block, drop if its <loc> contains a longtail basename
    const longtailSet = new Set(longtailBasenames);
    const patched = content.replace(/<url>[\s\S]*?<\/url>\s*/g, (block) => {
        const locMatch = block.match(/<loc>https?:\/\/[^<]+\/([^<]+?)<\/loc>/);
        if (!locMatch) return block;
        const basename = locMatch[1].split('?')[0].split('#')[0];
        return longtailSet.has(basename) ? '' : block;
    });

    const afterCount = (patched.match(/<loc>/g) || []).length;
    fs.writeFileSync(SITEMAP, patched);
    return { before: beforeCount, after: afterCount, removed: beforeCount - afterCount };
}

function main() {
    const files = fs.readdirSync(ROOT).filter(f => PATTERN.test(f));
    console.log(`Found ${files.length} longtail landing files (pattern: taxi-*-zu-*.html)`);

    let patched = 0, skipped = 0;
    const skipReasons = {};
    for (const f of files) {
        const r = processHtmlFile(path.join(ROOT, f));
        if (r.patched) patched++;
        else {
            skipped++;
            skipReasons[r.reason] = (skipReasons[r.reason] || 0) + 1;
        }
    }
    console.log(`HTML: ${patched} patched, ${skipped} skipped (${JSON.stringify(skipReasons)})`);

    const sm = processSitemap(files);
    console.log(`sitemap.xml: ${sm.before} → ${sm.after} URLs (removed ${sm.removed})`);
}

if (require.main === module) main();
