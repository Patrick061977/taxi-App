#!/usr/bin/env node
/**
 * Fuegt fehlende <lastmod> Tags in sitemap.xml ein.
 * Datenquelle: git log -1 --format=%as <file> fuer die zugehoerige HTML-Datei.
 * Fallback: heutiges Datum wenn Datei nicht existiert oder nie committed.
 *
 * Idempotent: URLs mit existierendem <lastmod> bleiben unveraendert.
 * Ausgabe: Overwrites sitemap.xml. Backup landet in sitemap.xml.bak.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const TODAY = new Date().toISOString().slice(0, 10);

function gitLastModDate(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const out = execSync(`git log -1 --format=%as -- "${path.basename(filePath)}"`, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        return out || null;
    } catch {
        return null;
    }
}

const raw = fs.readFileSync(SITEMAP, 'utf8');
fs.writeFileSync(SITEMAP + '.bak', raw, 'utf8');

const urlBlocks = raw.split(/(<url>[\s\S]*?<\/url>)/);
let added = 0, kept = 0, notFound = 0, removed = 0;
const removedList = [];

const patched = urlBlocks.map(seg => {
    if (!seg.startsWith('<url>')) return seg;
    const loc = seg.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) return seg;
    const slug = loc.replace(/^https?:\/\/[^\/]+\//, '').replace(/\/$/, '') || 'index.html';
    const file = path.join(ROOT, slug);
    const exists = fs.existsSync(file);

    if (!exists) {
        removed++;
        removedList.push(slug);
        return '';
    }

    if (/<lastmod>/.test(seg)) { kept++; return seg; }
    let date = gitLastModDate(file);
    if (!date) { date = TODAY; notFound++; }
    added++;
    return seg.replace('</loc>', `</loc>\n    <lastmod>${date}</lastmod>`);
}).join('').replace(/\n\s*\n\s*\n/g, '\n');

fs.writeFileSync(SITEMAP, patched, 'utf8');

console.log(`sitemap.xml gepatcht:`);
console.log(`  lastmod-Tags hinzugefuegt: ${added}`);
console.log(`  bereits vorhanden:         ${kept}`);
console.log(`  Fallback auf heute:        ${notFound}`);
console.log(`  broken URLs entfernt:      ${removed}`);
console.log(`  Backup: sitemap.xml.bak`);
if (removedList.length) {
    console.log(`\n  Entfernte URLs (Datei fehlt im Repo):`);
    removedList.forEach(s => console.log(`    - ${s}`));
}
