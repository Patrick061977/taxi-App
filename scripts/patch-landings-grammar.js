#!/usr/bin/env node
// v6.63.1032 (Patrick 30.08. "poi extrem wichtig" + Grammatik):
//   Patcht bestehende taxi-*.html Landing-Pages mit aktuellen isFeminine-Regeln.
//   Extrahiert from/to aus dem Title (Arrow-Format "Taxi X → Y | Funk Taxi") und
//   ersetzt H1 + Description + FAQ mit vomVonDer/zumZur. Idempotent — mehrfaches
//   Ausführen wendet die jeweils aktuelle Regel an.

const fs = require('fs');
const path = require('path');
const { isFeminine, isCity, zumZur, vomVonDer } = require('./generate-from-rides-selflearn.js');

const ROOT = path.join(__dirname, '..');

function patchOne(filePath) {
    let html = fs.readFileSync(filePath, 'utf8');
    const orig = html;

    // Extrahiere from/to aus <title>: "Taxi X → Y | Funk Taxi ..." oder "Taxi X → Y · Funk Taxi ..."
    let m = html.match(/<title>Taxi ([^<→]+?)\s*→\s*([^<|·]+?)\s*[|·]/);
    if (!m) {
        // Fallback: alte H1 "Taxi von X nach Y"
        m = html.match(/<h1[^>]*>Taxi von ([^<]+?) nach ([^<]+?)<\/h1>/);
    }
    if (!m) return { skipped: true, reason: 'kein Title/H1-Match' };

    const from = m[1].trim();
    const to = m[2].trim();
    const fromP = vomVonDer(from);
    const toP   = zumZur(to);

    // 1. H1 — akzeptiert alle Varianten (von/vom/von der + nach/zum/zur)
    const h1Re = /<h1([^>]*)>Taxi (?:von der|vom|von) ([^<]+?) (?:zur|zum|nach) ([^<]+?)<\/h1>/;
    const h1M = html.match(h1Re);
    if (h1M) {
        const newH1 = `<h1${h1M[1]}>Taxi ${fromP} ${toP}</h1>`;
        html = html.replace(h1Re, newH1);
    }

    // 2. Meta description — "Taxi (von|vom|von der) X (nach|zum|zur) Y:"
    const descRe = /Taxi (?:von der|vom|von) ([^:"<]+?) (?:zur|zum|nach) ([^:"<]+?):/g;
    html = html.replace(descRe, `Taxi ${fromP} ${toP}:`);

    // 3. FAQ-Fragen — "Fahrt (von|vom|von der) X (nach|zum|zur) Y"
    const faqRe = /Fahrt (?:von der|vom|von) ([^<?"]+?) (?:zur|zum|nach) ([^<?"]+?)([?"<])/g;
    html = html.replace(faqRe, `Fahrt ${fromP} ${toP}$3`);

    if (html === orig) return { skipped: true, reason: 'nichts zu ersetzen' };
    fs.writeFileSync(filePath, html);
    return { patched: true, from, to, fromP, toP };
}

function main() {
    const files = fs.readdirSync(ROOT).filter(f => f.startsWith('taxi-') && f.endsWith('.html') && f !== 'taxi-preise.html');
    let patched = 0, skipped = 0, samples = [];
    for (const f of files) {
        const full = path.join(ROOT, f);
        try {
            const res = patchOne(full);
            if (res.patched) {
                patched++;
                if (samples.length < 10) samples.push({ f, patched: `Taxi ${res.fromP} ${res.toP}` });
            } else {
                skipped++;
            }
        } catch (e) {
            console.error(`Fehler bei ${f}:`, e.message);
            skipped++;
        }
    }
    console.log(`✅ ${patched} Landing-Pages gepatcht, ${skipped} unverändert.`);
    if (samples.length) {
        console.log('\nBeispiele:');
        for (const s of samples) console.log(`  ${s.f}\n     ${s.patched}`);
    }
}

main();
