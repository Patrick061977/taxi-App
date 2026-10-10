#!/usr/bin/env node
// fix-hospital-privacy.js — Patrick 10.10. 17:45 Bridge:
//   "Bei Krankenhaus bitte keine privatadressen, wenn dann nur der Ort"
//
// Scannt alle taxi-*-zu-*.html Landings. Wenn eine Seite der Route ein
// Krankenhaus/Klinik/Hospital/Reha ist UND die ANDERE Seite ein Straßen-/
// Hausnummern-Name — dann wird die andere Seite in Title/Description/H1
// auf den OrtsNamen reduziert.
//
// Beispiel:
//   "Ahlbeck Pommern Straße B → Kreiskrankenhaus Wolgast"
//     → "Ahlbeck → Kreiskrankenhaus Wolgast"

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// Keine \b vorne weil "Kreiskrankenhaus" / "Universitätsklinikum" compound-Wörter sind
const HOSPITAL_RE = /(krankenhaus|klinik|klinikum|hospital|rehaklinik|rehabilitation|arztpraxis|pflegeheim|seniorenheim|hospiz)/i;
const STREET_RE = /\b(straße|strasse|str\.|straße|weg|platz|allee|chaussee|ring|promenade|gasse|ufer|damm|hof)\b/i;
const PRIVATE_INDICATOR = /\d/; // Zahl im Namen = typische Privatadresse

// Orte in der Region
const ORTE = [
    'Heringsdorf','Ahlbeck','Bansin','Zinnowitz','Koserow','Loddin','Dargen',
    'Mellenthin','Morgenitz','Wolgast','Greifswald','Anklam','Peenemünde',
    'Karlshagen','Trassenheide','Swinemünde','Świnoujście','Usedom','Kölpinsee',
    'Zempin','Ückeritz','Pudagla','Garz','Zirchow','Mahlzow','Benz','Neppermin',
    'Sellin','Baabe','Göhren','Binz','Prerow','Rügen','Berlin','Hamburg','Stralsund',
    'Kaiserbäder',
];

function findOrt(name) {
    const low = name.toLowerCase();
    // Längster Match gewinnt (Heringsdorf-Kaiserbäder vor Heringsdorf)
    const compound = ['heringsdorf-kaiserbäder','ahlbeck-kaiserbäder','bansin-kaiserbäder','seebad-ahlbeck','seebad-bansin','seebad-heringsdorf'];
    for (const c of compound) {
        if (low.includes(c)) return c.replace(/\b\w/g, l => l.toUpperCase());
    }
    for (const o of ORTE) {
        if (low.includes(o.toLowerCase())) return o;
    }
    return null;
}

function isHospitalName(name) {
    return HOSPITAL_RE.test(name);
}

function isPrivatish(name) {
    // Enthält Zahlen (Hausnummer) ODER explizit Straße/Weg/Platz
    if (PRIVATE_INDICATOR.test(name)) return true;
    if (STREET_RE.test(name)) return true;
    return false;
}

function reducePrivateToOrt(name) {
    const ort = findOrt(name);
    if (ort) return ort;
    // Fallback: ersten Teil vor Komma behalten
    return name.split(',')[0].trim();
}

// Scannt alle taxi-X-zu-Y.html und sucht Hospital-Routen mit Privatadresse
function processFile(file) {
    const p = path.join(ROOT, file);
    const html = fs.readFileSync(p, 'utf8');

    // Aus Dateinamen from/to extrahieren
    const m = file.match(/^taxi-(.+?)-zu-(.+?)\.html$/);
    if (!m) return { file, changed: false, reason: 'no-match' };
    const fromSlug = m[1], toSlug = m[2];

    // Aus H1 den echten from/to-Namen lesen (robuster als Dateiname)
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const h1 = h1Match ? h1Match[1] : '';
    // z.B. "Taxi vom Hotel Residenz zum Kreiskrankenhaus Wolgast" oder "Taxi von der Dünenstraße zum Ahlbeck Bahnhof"
    const h1m = h1.match(/^Taxi\s+(?:vom|von der|von)\s+(.+?)\s+(?:zum|zur|zu)\s+(.+?)$/i);
    const fromName = h1m ? h1m[1].trim() : '';
    const toName = h1m ? h1m[2].trim() : '';

    const fromHosp = isHospitalName(fromName);
    const toHosp = isHospitalName(toName);
    if (!fromHosp && !toHosp) return { file, changed: false, reason: 'no-hospital' };

    let newFrom = fromName, newTo = toName;
    let privacyFixed = false;

    if (fromHosp && !toHosp && isPrivatish(toName)) {
        newTo = reducePrivateToOrt(toName);
        privacyFixed = true;
    } else if (toHosp && !fromHosp && isPrivatish(fromName)) {
        newFrom = reducePrivateToOrt(fromName);
        privacyFixed = true;
    }

    if (!privacyFixed) return { file, changed: false, reason: 'no-private-counterpart' };

    // Replacements: fromName/toName in Title, Description, H1, JSON-LD BreadcrumbList, FAQ
    let out = html;
    let count = 0;
    const applyReplace = (needle, replacement) => {
        if (!needle || needle === replacement) return;
        const before = out;
        out = out.split(needle).join(replacement);
        if (out !== before) count++;
    };

    if (newFrom !== fromName) {
        applyReplace(fromName, newFrom);
        // Grammatik-Fix: wenn Reduktion auf Ort → "von der Ahlbeck" → "von Ahlbeck"
        applyReplace(`von der ${newFrom}`, `von ${newFrom}`);
        applyReplace(`vom ${newFrom}`, `von ${newFrom}`);
    }
    if (newTo !== toName) {
        applyReplace(toName, newTo);
        applyReplace(`zum ${newTo}`, `nach ${newTo}`);
        applyReplace(`zur ${newTo}`, `nach ${newTo}`);
    }

    if (count === 0) return { file, changed: false, reason: 'replace-failed' };

    fs.writeFileSync(p, out);
    return {
        file, changed: true, from: fromName, to: toName, newFrom, newTo,
        count,
    };
}

// Alle taxi-*-zu-*.html Landings
const files = fs.readdirSync(ROOT).filter(f => /^taxi-.+-zu-.+\.html$/.test(f));
let fixed = 0, scanned = 0, skippedNoHosp = 0, skippedNoPriv = 0;
const changes = [];
for (const f of files) {
    scanned++;
    const r = processFile(f);
    if (r.changed) {
        fixed++;
        changes.push(r);
        console.log(`✓ ${f}`);
        console.log(`    FROM: "${r.from}" → "${r.newFrom}"`);
        console.log(`    TO:   "${r.to}" → "${r.newTo}"`);
    } else {
        if (r.reason === 'no-hospital') skippedNoHosp++;
        else if (r.reason === 'no-private-counterpart') skippedNoPriv++;
    }
}
console.log(`\n→ ${fixed} Dateien geändert / ${scanned} gescannt (${skippedNoHosp} ohne Krankenhaus, ${skippedNoPriv} Krankenhaus-Routen ok ohne Privat-Gegenseite)`);
