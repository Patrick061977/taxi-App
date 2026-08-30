#!/usr/bin/env node
// v6.63.1023: Fuegt neue taxi-*-zu-*.html Files als Rows in bestehenden Hub
// (taxi-preise.html) ein. Bewahrt die 9-Kategorien-Struktur des Rollback-Baseline.
//
// Aufruf:  node scripts/append-new-landings-to-hub.js
// Dry-Run: node scripts/append-new-landings-to-hub.js --dry
//
// Was gemacht wird:
//   1) Alle taxi-*-zu-*.html auf Platte scannen -> {from, to, km, price, min, count}
//   2) Delta gegen Hub-Links berechnen (nur NEUE = die noch keine Row haben)
//   3) Fuer jede neue Landing: in eine der 9 Kategorien einordnen
//   4) HTML-Row aufbauen und am Ende der Kategorie-Tabelle einfuegen
//   5) Zahlen im Text-Kopf ("144 echte Routen" -> "204") und
//      pro Kategorie ("(76 Routen)") aktualisieren.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

function extractFromLanding(html) {
    const t = html.match(/<title>Taxi\s+(.+?)\s*→\s*(.+?)\s*·/);
    if (!t) return null;
    const d = html.match(/<meta name="description" content="Taxi vom\s+.+?\s+zum\s+.+?:\s*ca\.\s*([\d,]+)\s*€\s*\(([\d,\.]+)\s*km,\s*(\d+)\s*Min\)\.\s*Aus\s*(\d+)/);
    return {
        from: t[1].trim(),
        to: t[2].trim(),
        price: d ? parseFloat(d[1].replace(',', '.')) : null,
        km:    d ? parseFloat(d[2].replace(',', '.')) : null,
        min:   d ? parseInt(d[3]) : null,
        count: d ? parseInt(d[4]) : 1
    };
}

// Klassifikation in eine der 9 Hub-Kategorien
// Reihenfolge = Prioritaet (Bahnhof gewinnt vor Hotel etc.)
const CATEGORIES = [
    // key = string, wie das Heading im Hub aussieht
    { key: 'Bahnhof-Transfers',              test: r => /bahnhof/i.test(r.from) || /bahnhof/i.test(r.to) },
    { key: 'Flughafen-Transfers',            test: r => /flughafen|hdf\b/i.test(r.from + ' ' + r.to) },
    { key: 'Grenzfahrten Polen',             test: r => /świnou|swin|polen/i.test(r.from + ' ' + r.to) },
    { key: 'Krankenhaus und Klinik',         test: r => /klinik|krankenhaus|reha|pflegeheim|residenz/i.test(r.from + ' ' + r.to) },
    { key: 'Hotel-Transfers',                test: r => /hotel|villa|resort|kaiserhof|steigenberger|ahlbecker hof|ostseeblick|maritim|breeze/i.test(r.from + ' ' + r.to) },
    { key: 'Restaurant- und Einkaufs-Fahrten', test: r => /restaurant|athen|bierkutscher|rewe|edeka|lidl|kaufhaus|kulmeck|sixt/i.test(r.from + ' ' + r.to) },
    { key: 'Fern- und Kreisfahrten',         test: r => /berlin|greifswald|wolgast|anklam|stralsund|misdroy|ueckeritz|ückeritz|koserow|trassenheide|zinnowitz|peenemünde/i.test(r.from + ' ' + r.to) },
    { key: 'Sehenswuerdigkeiten und Reha',   test: r => /therme|museum|zoo|tropen|baumwipfel|kurpark|kurhaus|schloss/i.test(r.from + ' ' + r.to) },
    { key: 'Weitere Routen',                 test: () => true }, // catch-all
];

function classify(route) {
    for (const c of CATEGORIES) if (c.test(route)) return c.key;
    return 'Weitere Routen';
}

// HTML-Row im Hub-Style (gleiches Padding + Farbe wie die 144 Rollback-Rows)
function buildRow(route) {
    const priceStr = route.price != null ? route.price.toFixed(2).replace('.', ',') : '?';
    const kmStr = route.km != null ? route.km.toFixed(1) : '?';
    const esc = s => (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<tr><td style="padding:6px;border-bottom:1px solid #eee;">${esc(route.from)}</td><td style="padding:6px;border-bottom:1px solid #eee;">${esc(route.to)}</td><td style="padding:6px;text-align:right;border-bottom:1px solid #eee;">${kmStr} km</td><td style="padding:6px;text-align:right;border-bottom:1px solid #eee;font-weight:600;color:#059669;">ca. ${priceStr} EUR</td><td style="padding:6px;text-align:center;border-bottom:1px solid #eee;"><a href="${route.file}" style="color:#0b57d0;text-decoration:none;">Details</a></td></tr>`;
}

// --- Main ---
console.log('=== v6.63.1023: Append new landings to hub ===');
if (DRY) console.log('   DRY-RUN (kein File wird geschrieben)');
console.log();

// 1) Hub einlesen + bestehende Landing-Files finden
let hub = fs.readFileSync(path.join(ROOT, 'taxi-preise.html'), 'utf8');
const inHub = new Set();
for (const m of hub.matchAll(/href="(taxi-[^"]+-zu-[^"]+\.html)"/g)) inHub.add(m[1]);
console.log('Im Hub verlinkt:', inHub.size);

// 2) Alle Landings auf Platte
const onDisk = fs.readdirSync(ROOT).filter(f => /^taxi-.*-zu-.*\.html$/.test(f));
console.log('Auf Platte:', onDisk.length);

// 3) Neue = Delta
const newFiles = onDisk.filter(f => !inHub.has(f));
console.log('Neu (nicht im Hub):', newFiles.length);
if (newFiles.length === 0) { console.log('Nichts zu tun.'); return; }

// 4) Landings parsen + klassifizieren
const byCat = {};
for (const f of newFiles) {
    try {
        const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const e = extractFromLanding(html);
        if (!e) { console.warn('  skip (no title/meta):', f); continue; }
        e.file = f;
        const cat = classify(e);
        (byCat[cat] = byCat[cat] || []).push(e);
    } catch (err) { console.warn('  skip (parse err):', f, err.message); }
}

console.log();
console.log('Neue Routen pro Kategorie:');
Object.entries(byCat).forEach(([cat, arr]) => console.log('  ' + cat + ': ' + arr.length));
console.log();

// 5) Fuer jede Kategorie: Row-HTML anfuegen VOR dem naechsten <h2 oder </div><footer
let totalAdded = 0;
for (const [cat, arr] of Object.entries(byCat)) {
    if (arr.length === 0) continue;
    // Suche <h2 ...>KATEGORIE ...</h2>  gefolgt von naechster <table ...> ... </table>
    // v1025 (Patrick): [^<]* konnte das <span>-Element nach dem Namen nicht matchen.
    //   Jetzt [\s\S]*? bis zum </h2>, dann bis zum ersten </table>.
    const escCat = cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const catRe = new RegExp('(<h2[^>]*>\\s*' + escCat + '[\\s\\S]*?</h2>[\\s\\S]*?<table[^>]*>[\\s\\S]*?)(</table>)');
    const m = hub.match(catRe);
    if (!m) {
        console.warn('  ⚠️ Kategorie nicht gefunden im Hub:', cat, '- ' + arr.length + ' Routen ausgelassen');
        continue;
    }
    // Sortiere nach count (haeufigste zuerst) dann km
    arr.sort((a, b) => (b.count || 0) - (a.count || 0) || (a.km || 0) - (b.km || 0));
    const newRows = arr.map(buildRow).join('\n');
    hub = hub.replace(catRe, m[1] + '\n' + newRows + '\n' + m[2]);
    console.log('  ✓ ' + cat + ': +' + arr.length + ' Rows');
    totalAdded += arr.length;
}

// 6) Zahlen im Kopf-Text aktualisieren
const oldTotal = inHub.size;
const newTotal = oldTotal + totalAdded;
hub = hub.replace(/\b144 echte Routen\b/g, newTotal + ' echte Routen');
hub = hub.replace(/<!-- 144 Routen /g, '<!-- ' + newTotal + ' Routen ');
hub = hub.replace(/<title>Taxi-Preise Insel Usedom · Datensammlung echter Fahrten/i,
                  '<title>Taxi-Preise Insel Usedom · Datensammlung echter Fahrten');
// Pro-Kategorie-Counts (z.B. "(76 Routen)") — zaehle jetzt neu
const catCountRe = /(<h2[^>]*>\s*)([^<]+?)(\s*<span[^>]*>\()(\d+)(\s+Routen\)<\/span><\/h2>)/g;
hub = hub.replace(catCountRe, (whole, pre, catName, mid, oldN, post) => {
    const catKey = CATEGORIES.find(c => catName.trim().toLowerCase().startsWith(c.key.toLowerCase()))?.key;
    const added = catKey && byCat[catKey] ? byCat[catKey].length : 0;
    const newN = parseInt(oldN) + added;
    return pre + catName + mid + newN + post;
});

console.log();
console.log('===');
console.log('Total hinzugefuegt:', totalAdded, 'Rows');
console.log('Neu im Hub:', newTotal, 'Routen');
console.log('===');

if (DRY) {
    console.log();
    console.log('Dry-Run - nichts geschrieben. Erneut ohne --dry laufen lassen.');
    return;
}

fs.writeFileSync(path.join(ROOT, 'taxi-preise.html'), hub);
console.log('✅ taxi-preise.html aktualisiert.');
