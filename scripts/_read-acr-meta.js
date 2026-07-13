const fs = require('fs');
const path = require('path');

// Find a " 1" duplicate file to inspect
const ACR_DIR = 'C:\\Users\\Taxi\\OneDrive\\6.Dokumente unsortiert\\Anwendungen\\ACRPhone Cloud Uploads\\Acr';
const files = fs.readdirSync(ACR_DIR).filter(f => f.endsWith(' 1.m4a'));
console.log('Duplikat-Dateien (mit " 1" Suffix):');
files.slice(0, 5).forEach(f => console.log(' -', f));

if (files.length === 0) { console.log('Keine Duplikate gefunden'); process.exit(0); }

// Inspect the first one
const filePath = path.join(ACR_DIR, files[0]);
const origPath = path.join(ACR_DIR, files[0].replace(' 1.m4a', '.m4a'));
const buf = fs.readFileSync(filePath);
const origBuf = origPath !== filePath && fs.existsSync(origPath) ? fs.readFileSync(origPath) : null;

console.log('\n=== Datei:', files[0]);
console.log('Größe:', buf.length, 'bytes');
if (origBuf) console.log('Original-Größe:', origBuf.length, 'bytes', origBuf.length === buf.length ? '(IDENTISCH)' : '(UNTERSCHIEDLICH!)');

// Search for phone numbers and metadata in M4A binary
const str = buf.toString('binary');

// M4A atoms use 4-byte size + 4-char name
// Common metadata atoms: ©cmt, ©nam, ©art, desc, ©ART
const searchTerms = ['\xA9cmt', '\xA9nam', '\xA9ART', 'desc', 'comm'];
for (const term of searchTerms) {
    const idx = str.indexOf(term);
    if (idx > 0) {
        const ctx = buf.slice(Math.max(0, idx), Math.min(buf.length, idx + 200)).toString('utf8', 0, 200).replace(/[^\x20-\x7EÀ-ÿ]/g, '.');
        console.log(`\nTag '${term}' @ offset ${idx}:`, ctx.substring(0, 100));
    }
}

// Look for phone-number patterns
const allText = buf.toString('utf8', 0, buf.length).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ');
const phones = [...allText.matchAll(/\+[0-9]{8,15}/g)];
console.log('\nGefundene Telefonnummern im Metadata:', phones.length > 0 ? phones.map(m => m[0]).join(', ') : 'keine');

// Dump first 4KB as hex + printable to look for metadata
console.log('\n--- Erste 200 printable chars ---');
console.log(allText.substring(0, 500).replace(/\s+/g, ' ').trim());
