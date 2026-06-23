#!/usr/bin/env node
// datev-ocr-sort-and-forward.js — Patrick (23.06.2026 09:34 Bridge):
// 'OCR vorab sortieren und an die richtige email versenden'.
// Patrick (09:38): 'baue mal mit den 2 emails ein und kassenbon in eingang'.
//
// Workflow:
//   1. Lies alle PDFs aus INBOX-Ordner
//   2. Pro PDF via pdftotext OCR-Text extrahieren
//   3. Heuristik: EINGANG (Rechnung an Wydra) / AUSGANG (Wydra als Absender) / KASSE (Bon/Quittung)
//   4. Forward an passende DATEV-Belegtransfer-Email
//   5. PDF in Subfolder verschieben (nachvollziehbar fuer Patrick)
//   6. Marker-File _datev-sort-forwarded.json verhindert Doppel-Forward
//
// DATEV-Email-Adressen (aus forward-to-datev.js / forward-ausgangsrechnungen-datev.js):
//   - EINGANG (Eingangsrechnungen + Kassenbons): e41e7435-8c6b-4078-a3d4-fd7a04a0c891@uploadmail.datev.de
//   - AUSGANG (eigene Rechnungen):                8d5776ad-af6b-4ff8-ad13-b0ff2bea30e1@uploadmail.datev.de
//
// Aufruf:
//   node scripts/datev-ocr-sort-and-forward.js          # Sortiert + forwarded alle unverarbeiteten PDFs
//   node scripts/datev-ocr-sort-and-forward.js --dry    # Nur OCR + Klassifikation, kein Send + kein Move

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const DRY = process.argv.includes('--dry');
const INBOX_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/INBOX';
const SORTED_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/INBOX-SORTIERT';
const MARKER_FILE = path.join(SORTED_ROOT, '_datev-sort-forwarded.json');
const UNKLAR_PUSH_BRIDGE = true; // Bei UNKLAR-Klassifikation einen Bridge-Push an Patrick

const DATEV_EINGANG = 'e41e7435-8c6b-4078-a3d4-fd7a04a0c891@uploadmail.datev.de';
const DATEV_AUSGANG = '8d5776ad-af6b-4ff8-ad13-b0ff2bea30e1@uploadmail.datev.de';

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
function loadMarker() {
    if (!fs.existsSync(MARKER_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')); } catch { return {}; }
}
function saveMarker(m) { ensureDir(SORTED_ROOT); fs.writeFileSync(MARKER_FILE, JSON.stringify(m, null, 2)); }

function ocrPdf(pdfPath) {
    try {
        // pdftotext gibt OCR-Text aus (sofern PDF Text-Layer hat — bei reinen Scan-PDFs leer)
        const txt = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        return txt || '';
    } catch (e) {
        console.warn(`  ⚠️ pdftotext fehlgeschlagen: ${e.message.slice(0, 100)}`);
        return '';
    }
}

function classify(ocrText, filename) {
    const t = (ocrText || '').toLowerCase();
    const f = (filename || '').toLowerCase();

    // Wydra/Funk-Taxi Erkennung
    const isWydraIn = /wydra|funk[- ]?taxi[- ]?heringsdorf|taxiwydra|umwelt[- ]?taxi/i.test(t);

    // KASSE: Tankbeleg, Bon, Quittung, EC-Beleg, oft kein "Rechnung an"-Block
    if (/\bkassenbon\b|\bquittung\b|\btankbeleg\b|\bbeleg\s*nr|\bbeleg-?nr|\bbon-?nr|\bbon\s*\d+|\bkassenzettel\b|\bec[- ]?beleg/.test(t)) {
        return { category: 'KASSE', target: DATEV_EINGANG, reason: 'Kassenbon/Quittung erkannt' };
    }
    if (/\bkassenbon\b|\bquittung\b|tankbeleg|\bbon[-_ ]/.test(f)) {
        return { category: 'KASSE', target: DATEV_EINGANG, reason: 'Dateiname enthaelt Kassenbon-Indikator' };
    }

    // AUSGANG: Wydra im Absender-Block (oben links typisch) + Rechnungsnummer im Wydra-Format
    // (Wydra-Rechnungsnummern: 20-26-XXX o.ae.)
    if (isWydraIn && /\b20-2[5-9]-\d{2,5}\b/.test(t)) {
        return { category: 'AUSGANG', target: DATEV_AUSGANG, reason: 'Wydra-Absender + Wydra-Rechnungsnr. (20-XX-XXX)' };
    }

    // EINGANG: Rechnung mit Wydra als Empfaenger (z.B. 'An: Funk-Taxi Wydra')
    if (isWydraIn && /\brechnung\b/i.test(t)) {
        // Pruefe ob es eindeutig Eingang ist — "An Funk-Taxi" vs. "Von Funk-Taxi"
        // Heuristik: ohne Wydra-Nummer ist es vermutlich Eingang
        return { category: 'EINGANG', target: DATEV_EINGANG, reason: 'Rechnung an Wydra (kein Wydra-Rechnungs-Nr. erkannt)' };
    }

    // Generische Rechnung ohne Wydra-Match → schwer einzuordnen
    if (/\brechnung\b|\binvoice\b/i.test(t)) {
        return { category: 'EINGANG', target: DATEV_EINGANG, reason: 'Generische Rechnung — defaulted EINGANG' };
    }

    // UNKLAR — manuell sortieren
    return { category: 'UNKLAR', target: null, reason: 'OCR-Text zu schwach, keine eindeutige Klassifikation' };
}

async function sendToDatev(pdfPath, fileName, category, target) {
    if (DRY) {
        console.log(`  🟡 [DRY] Wuerde forwarden: ${fileName} → ${category} → ${target}`);
        return { ok: true, dry: true };
    }
    const info = await transporter.sendMail({
        from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
        to: target,
        subject: `[Auto ${category}] ${fileName.slice(0, 60)}`,
        text: `OCR-Vorsortierung: ${category}\nDatei: ${fileName}\n\nGesendet via datev-ocr-sort-and-forward.js`,
        attachments: [{ filename: fileName, path: pdfPath, contentType: 'application/pdf' }]
    });
    return { ok: true, messageId: info.messageId };
}

async function pushBridge(msg) {
    try {
        execSync(`node scripts/bridge-direct-send.js ${JSON.stringify(msg)}`, { stdio: 'pipe' });
    } catch (_) { /* bridge nicht kritisch */ }
}

(async () => {
    if (!fs.existsSync(INBOX_ROOT)) {
        console.error(`❌ INBOX-Ordner nicht gefunden: ${INBOX_ROOT}`);
        console.error(`   Patrick: bitte den Ordner anlegen und PDFs reinkopieren.`);
        process.exit(1);
    }
    ensureDir(SORTED_ROOT);
    const marker = loadMarker();
    const files = fs.readdirSync(INBOX_ROOT).filter(f => f.toLowerCase().endsWith('.pdf'));
    console.log(`\n📁 INBOX: ${INBOX_ROOT} — ${files.length} PDF(s)`);
    console.log(`📁 SORTIERT: ${SORTED_ROOT}`);
    if (DRY) console.log(`🟡 DRY-RUN — kein Send + kein Move`);

    const stats = { sent: 0, skipped: 0, unklar: 0, errors: 0 };

    for (const f of files) {
        const fullPath = path.join(INBOX_ROOT, f);
        const key = f;
        if (marker[key]) { stats.skipped++; continue; }

        console.log(`\n📄 ${f}`);
        const ocr = ocrPdf(fullPath);
        const cls = classify(ocr, f);
        console.log(`  → ${cls.category} (${cls.reason})`);

        if (cls.category === 'UNKLAR') {
            stats.unklar++;
            if (UNKLAR_PUSH_BRIDGE && !DRY) {
                await pushBridge(`📁 DATEV-Sort UNKLAR: ${f}\n\nOCR liefert kein eindeutiges Signal. Bitte manuell sortieren in INBOX-SORTIERT/UNKLAR/.`);
            }
            // In UNKLAR-Ordner verschieben (auch DRY: skip)
            if (!DRY) {
                const dst = path.join(SORTED_ROOT, 'UNKLAR', f);
                ensureDir(path.dirname(dst));
                fs.renameSync(fullPath, dst);
                console.log(`  📂 Verschoben nach: UNKLAR/${f}`);
            }
            continue;
        }

        try {
            const r = await sendToDatev(fullPath, f, cls.category, cls.target);
            stats.sent++;
            if (!DRY) {
                const yearMatch = f.match(/(20\d{2})/);
                const year = yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
                const dst = path.join(SORTED_ROOT, cls.category, year, f);
                ensureDir(path.dirname(dst));
                fs.renameSync(fullPath, dst);
                console.log(`  ✉️ Gesendet (msgId: ${r.messageId?.slice(0, 20) || 'OK'})`);
                console.log(`  📂 Verschoben nach: ${cls.category}/${year}/${f}`);
            }
            marker[key] = { sentAt: Date.now(), category: cls.category, target: cls.target, reason: cls.reason };
            saveMarker(marker);
            // Throttle 1s zwischen Sends (smtp.gmail.com Limit)
            await new Promise(r => setTimeout(r, 1100));
        } catch (e) {
            stats.errors++;
            console.error(`  ❌ Send-Fehler: ${e.message}`);
            await new Promise(r => setTimeout(r, 2500));
        }
    }

    console.log(`\n=== ZUSAMMENFASSUNG ===`);
    console.log(`  Forwarded:   ${stats.sent}`);
    console.log(`  UNKLAR:      ${stats.unklar}`);
    console.log(`  Skipped:     ${stats.skipped} (schon verarbeitet)`);
    console.log(`  Fehler:      ${stats.errors}`);

    if (stats.sent > 0 || stats.unklar > 0) {
        await pushBridge(`📋 DATEV-Sort Run: ${stats.sent} forwarded, ${stats.unklar} UNKLAR, ${stats.errors} Fehler.`);
    }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
