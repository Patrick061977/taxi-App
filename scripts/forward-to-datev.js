#!/usr/bin/env node
// forward-to-datev.js — Patrick (21.05.2026 19:43): Bulk-Forward aller eingesammelten
// Eingangs-Rechnungs-PDFs an DATEV-Belegtransfer.
//
// Pro PDF:
//   • Eine Mail an e41e7435-8c6b-4078-a3d4-fd7a04a0c891@uploadmail.datev.de
//   • Subject: "[Auto] {Sender} {Datum}"
//   • Anhang: das PDF (DATEV erkennt PDFs automatisch)
//
// Duplikat-Schutz: Marker-Datei _datev-forwarded.json mit allen schon-versendet PDF-Pfaden.
// Beim Re-Run werden bereits versendete PDFs übersprungen.

const fs = require('fs');
const path = require('path');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const RECHN_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen';
const MARKER_FILE = path.join(RECHN_ROOT, '_datev-forwarded.json');
const DATEV_EINGANG = 'e41e7435-8c6b-4078-a3d4-fd7a04a0c891@uploadmail.datev.de';

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

function loadMarker() {
    if (!fs.existsSync(MARKER_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')); }
    catch { return {}; }
}
function saveMarker(m) {
    fs.writeFileSync(MARKER_FILE, JSON.stringify(m, null, 2));
}

// Welche Ordner sollen forwarded werden? Excludiert ECOVIS+VKO+STRATO+DATEV
// (= sind schon in DATEV automatisch via STRATO-Auto-Forward / ECOVIS-Direkt-Einstellung)
const FORWARD_SENDERS = [
    'Adobe',      // GMX + Google
    'Anthropic',
    'Stripe',
    'GitHub',
    'Autodoc',
    'Google',
    'Tesla',
    'Microsoft',
    'Autoservice-Wendlandt',  // war Wendlandt-Privat
    'Heise',  // Kündigung — DATEV-relevant für Stornierung
    'Radius',  // 24.05.2026: Tankstellen-Belege Radius Business Solutions
];

async function main() {
    const marker = loadMarker();
    const sentBefore = Object.keys(marker).length;
    let sent = 0, skipped = 0, errors = 0;
    const log = [];

    for (const sender of FORWARD_SENDERS) {
        const senderDir = path.join(RECHN_ROOT, sender);
        if (!fs.existsSync(senderDir)) continue;
        // Rekursiv alle PDFs finden (auch in 2025/google/, 2025/gmx/ usw.)
        const allPdfs = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) allPdfs.push(full);
            }
        };
        walk(senderDir);

        for (const pdf of allPdfs) {
            const key = pdf.replace(/\\/g, '/');
            if (marker[key]) { skipped++; continue; }
            const stat = fs.statSync(pdf);
            const fname = path.basename(pdf);
            // Datum aus Dateiname extrahieren (z.B. 'Adobe_Transaction_No_3167586615_20250724.pdf')
            const dateM = fname.match(/(\d{4})[_-](\d{2})[_-](\d{2})/) || fname.match(/(\d{8})/);
            let dateStr = '';
            if (dateM) {
                if (dateM[0].length === 8 && !dateM[2]) dateStr = `${dateM[1].slice(0,4)}-${dateM[1].slice(4,6)}-${dateM[1].slice(6,8)}`;
                else dateStr = `${dateM[1]}-${dateM[2]}-${dateM[3]}`;
            }
            const subject = `[Auto] ${sender}${dateStr ? ' ' + dateStr : ''} (${fname.slice(0, 60)})`;
            try {
                const info = await transporter.sendMail({
                    from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
                    to: DATEV_EINGANG,
                    subject,
                    text: `Auto-Forward von ${sender}\nDatei: ${fname}\nGröße: ${Math.round(stat.size/1024)} KB\n\nGesendet via forward-to-datev.js (v6.62.855+)`,
                    attachments: [{ filename: fname, path: pdf, contentType: 'application/pdf' }],
                });
                marker[key] = { sentAt: Date.now(), messageId: info.messageId, subject };
                sent++;
                log.push({ status: 'ok', sender, file: fname });
                console.log(`  [SEND ${sent}] ${sender}/${fname}`);
                // SMTP rate limit: 1 Mail/Sek (Gmail erlaubt 500/Tag)
                await new Promise(r => setTimeout(r, 1100));
            } catch (e) {
                errors++;
                log.push({ status: 'error', sender, file: fname, err: e.message });
                console.error(`  [ERR] ${sender}/${fname}: ${e.message}`);
                // Bei Fehler kurz länger warten
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }

    saveMarker(marker);
    console.log('\n[FORWARD-DATEV FERTIG]');
    console.log('  gesendet (neu): ' + sent);
    console.log('  übersprungen (schon gesendet): ' + skipped);
    console.log('  Fehler: ' + errors);
    console.log('  Marker total: ' + Object.keys(marker).length);
    console.log('  Marker-Datei: ' + MARKER_FILE);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
