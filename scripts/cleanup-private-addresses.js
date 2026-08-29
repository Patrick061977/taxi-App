#!/usr/bin/env node
// v6.63.998: Cleanup — löscht taxi-*.html Landing-Pages mit privaten Adressen.
// Patrick 29.08. "private Adressen entfernen, nur POI mit Adresse OK".
// Erkennt private Adressen aus Title/Description der bereits generierten Seiten.

const fs = require('fs');
const path = require('path');
const { isPrivateAddress, isPoiName } = require('./generate-from-rides-selflearn.js');

const ROOT = path.resolve(__dirname, '..');

function extractFromTo(html) {
    // <title>Taxi X → Y · Funk Taxi Heringsdorf</title>
    const m = html.match(/<title>Taxi\s+(.+?)\s*→\s*(.+?)\s*·/);
    if (m) return { from: m[1].trim(), to: m[2].trim() };
    // Fallback: aus description
    const d = html.match(/<meta name="description" content="Taxi vom\s+(.+?)\s+zum\s+(.+?):/);
    if (d) return { from: d[1].trim(), to: d[2].trim() };
    return null;
}

function main() {
    const files = fs.readdirSync(ROOT).filter(f => f.startsWith('taxi-') && f.endsWith('.html'));
    console.log(`📋 Prüfe ${files.length} taxi-*.html Seiten auf private Adressen...`);

    let deleted = 0, kept = 0, unparseable = 0;
    const deletedList = [];

    for (const f of files) {
        // Skip Hub-Seiten
        if (f === 'taxi-preise.html' || f === 'taxi-usedom-preise.html' || f === 'taxi-22022.html') { kept++; continue; }
        const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const ft = extractFromTo(html);
        if (!ft) { unparseable++; kept++; continue; }
        const fPriv = isPrivateAddress(ft.from);
        const tPriv = isPrivateAddress(ft.to);
        if (fPriv || tPriv) {
            fs.unlinkSync(path.join(ROOT, f));
            deleted++;
            if (deletedList.length < 10) deletedList.push(`  ✗ ${f}  (from='${ft.from}' priv=${fPriv} | to='${ft.to}' priv=${tPriv})`);
        } else {
            kept++;
        }
    }

    console.log('---');
    console.log(`✅ Cleanup fertig:`);
    console.log(`   ${deleted} Seiten gelöscht (private Adressen)`);
    console.log(`   ${kept} Seiten behalten`);
    console.log(`   ${unparseable} unparseable (keine <title>-Regex-Match)`);
    if (deletedList.length > 0) {
        console.log('\nBeispiele gelöschte:');
        deletedList.forEach(l => console.log(l));
    }
}

if (require.main === module) main();
