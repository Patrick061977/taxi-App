#!/usr/bin/env node
/**
 * Meta-Audit ueber alle Landing-Pages im Repo.
 * Prueft pro HTML-Datei: title, meta-description, h1, og:*, twitter:*, canonical.
 * Ergaenzt: sitemap.xml Coverage + lastmod je URL.
 *
 * Output: Konsolen-Report + JSON in seo-meta-audit.json (fuer weitere Verarbeitung).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');

const SKIP_PREFIXES = [
    'FUNKTIONS-', 'HILFE', 'PENDING-', 'SYSTEM-',
    'admin-', 'change-viewer', 'buchen-demo-', 'buchung-test',
    'function-explorer', 'dms', 'fahrer-', 'kunden-'
];

function shouldAudit(f) {
    if (!f.endsWith('.html')) return false;
    for (const p of SKIP_PREFIXES) if (f.startsWith(p) || f === p + '.html') return false;
    return true;
}

const htmlFiles = fs.readdirSync(ROOT).filter(shouldAudit).sort();

function extract(html, re) {
    const m = html.match(re);
    return m ? m[1].trim() : null;
}

function auditFile(filename) {
    const html = fs.readFileSync(path.join(ROOT, filename), 'utf8');
    return {
        file: filename,
        title: extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
        description: extract(html, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i),
        h1: extract(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/\s+/g, ' ').trim(),
        canonical: extract(html, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i),
        og_title: extract(html, /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i),
        og_description: extract(html, /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i),
        og_image: extract(html, /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i),
        twitter_card: extract(html, /<meta[^>]*name=["']twitter:card["'][^>]*content=["']([^"']+)["']/i),
    };
}

const results = htmlFiles.map(auditFile);

const sitemap = fs.readFileSync(SITEMAP, 'utf8');
const sitemapUrls = new Map();
const urlBlocks = sitemap.split('<url>').slice(1);
for (const block of urlBlocks) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
    if (loc) {
        const slug = loc.replace(/^https?:\/\/[^\/]+\//, '').replace(/\/$/, '') || 'index.html';
        sitemapUrls.set(slug, lastmod || null);
    }
}

for (const r of results) {
    const key1 = r.file;
    const key2 = r.file.replace(/\.html$/, '');
    if (sitemapUrls.has(key1)) {
        r.in_sitemap = true;
        r.sitemap_lastmod = sitemapUrls.get(key1);
    } else if (sitemapUrls.has(key2)) {
        r.in_sitemap = true;
        r.sitemap_lastmod = sitemapUrls.get(key2);
    } else {
        r.in_sitemap = false;
        r.sitemap_lastmod = null;
    }
}

const missing = {
    title: results.filter(r => !r.title).map(r => r.file),
    description: results.filter(r => !r.description).map(r => r.file),
    h1: results.filter(r => !r.h1).map(r => r.file),
    canonical: results.filter(r => !r.canonical).map(r => r.file),
    og_title: results.filter(r => !r.og_title).map(r => r.file),
    og_description: results.filter(r => !r.og_description).map(r => r.file),
    og_image: results.filter(r => !r.og_image).map(r => r.file),
    twitter_card: results.filter(r => !r.twitter_card).map(r => r.file),
    not_in_sitemap: results.filter(r => !r.in_sitemap).map(r => r.file),
    sitemap_without_lastmod: results.filter(r => r.in_sitemap && !r.sitemap_lastmod).map(r => r.file),
};

const shortDesc = results.filter(r => r.description && r.description.length < 100).map(r => ({file: r.file, len: r.description.length}));
const longDesc = results.filter(r => r.description && r.description.length > 160).map(r => ({file: r.file, len: r.description.length}));

console.log(`\n============================================================`);
console.log(`  META-AUDIT ueber ${results.length} Landing-Pages`);
console.log(`============================================================\n`);
console.log(`  Sitemap-URLs total:               ${sitemapUrls.size}`);
console.log(`  Landing-Files audited:            ${results.length}\n`);
console.log(`  FEHLENDE FELDER:`);
console.log(`    Title fehlt:                    ${missing.title.length}`);
console.log(`    Meta-Description fehlt:         ${missing.description.length}`);
console.log(`    H1 fehlt:                       ${missing.h1.length}`);
console.log(`    Canonical fehlt:                ${missing.canonical.length}`);
console.log(`    OG:title fehlt:                 ${missing.og_title.length}`);
console.log(`    OG:description fehlt:           ${missing.og_description.length}`);
console.log(`    OG:image fehlt:                 ${missing.og_image.length}`);
console.log(`    Twitter:card fehlt:             ${missing.twitter_card.length}`);
console.log(`    NICHT in sitemap.xml:           ${missing.not_in_sitemap.length}`);
console.log(`    in sitemap ohne <lastmod>:      ${missing.sitemap_without_lastmod.length}\n`);
console.log(`  QUALITAETS-CHECKS:`);
console.log(`    Description < 100 Zeichen:      ${shortDesc.length}`);
console.log(`    Description > 160 Zeichen:      ${longDesc.length}\n`);

if (missing.description.length > 0 && missing.description.length <= 30) {
    console.log(`  Missing Description (${missing.description.length}):`);
    missing.description.slice(0, 30).forEach(f => console.log(`    - ${f}`));
    console.log();
}
if (missing.h1.length > 0 && missing.h1.length <= 30) {
    console.log(`  Missing H1 (${missing.h1.length}):`);
    missing.h1.slice(0, 30).forEach(f => console.log(`    - ${f}`));
    console.log();
}
if (missing.canonical.length > 0 && missing.canonical.length <= 30) {
    console.log(`  Missing Canonical (${missing.canonical.length}):`);
    missing.canonical.slice(0, 30).forEach(f => console.log(`    - ${f}`));
    console.log();
}

const report = {
    generated: new Date().toISOString(),
    files_audited: results.length,
    sitemap_url_count: sitemapUrls.size,
    missing,
    short_description: shortDesc,
    long_description: longDesc,
};

fs.writeFileSync(path.join(ROOT, 'seo-meta-audit.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`  JSON Report: seo-meta-audit.json`);
console.log();
