#!/usr/bin/env node
// forward-ausgangsrechnungen-datev.js — Patrick (21.05. 19:48): Ausgangsrechnungen
// an DATEV-Belegtransfer-AUSGANGS-Adresse forwarden.

const fs = require('fs');
const path = require('path');
const nodemailer = require('C:/Taxi App/taxi-App-github/functions/node_modules/nodemailer');

const AUSGANG_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungsausgang';
const MARKER_FILE = path.join(AUSGANG_ROOT, '_datev-ausgang-forwarded.json');
const DATEV_AUSGANG = '8d5776ad-af6b-4ff8-ad13-b0ff2bea30e1@uploadmail.datev.de';

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
});

function loadMarker() {
    if (!fs.existsSync(MARKER_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8')); } catch { return {}; }
}
function saveMarker(m) { fs.writeFileSync(MARKER_FILE, JSON.stringify(m, null, 2)); }

async function main() {
    const marker = loadMarker();
    let sent = 0, skipped = 0, errors = 0;

    const years = ['2025', '2026'];
    for (const year of years) {
        const dir = path.join(AUSGANG_ROOT, year);
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
        for (const f of files) {
            const full = path.join(dir, f);
            const key = full.replace(/\\/g, '/');
            if (marker[key]) { skipped++; continue; }
            // RNr aus Dateiname (z.B. 'Rechnung_RE1027_13.03.2025.pdf' → RE1027)
            const reM = f.match(/(20-2[5-6]-\d{3,5})/) || f.match(/(RE\d{3,5})/);
            const reNr = reM ? reM[1] : '';
            const dateM = f.match(/(\d{2})[._-](\d{2})[._-](\d{4})/);
            const dateStr = dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : '';
            const subject = `[Auto Ausgang] ${reNr || f.slice(0, 40)}${dateStr ? ' ' + dateStr : ''}`;
            try {
                const info = await transporter.sendMail({
                    from: '"Funk-Taxi Heringsdorf" <taxiwydra@googlemail.com>',
                    to: DATEV_AUSGANG,
                    subject,
                    text: `Auto-Forward Ausgangsrechnung\nRNr: ${reNr || '?'}\nDatei: ${f}\n\nGesendet via forward-ausgangsrechnungen-datev.js`,
                    attachments: [{ filename: f, path: full, contentType: 'application/pdf' }],
                });
                marker[key] = { sentAt: Date.now(), messageId: info.messageId, subject, reNr };
                sent++;
                console.log(`  [SEND ${sent}] ${year}/${f}`);
                await new Promise(r => setTimeout(r, 1100));
            } catch (e) {
                errors++;
                console.error(`  [ERR] ${year}/${f}: ${e.message}`);
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
    saveMarker(marker);
    console.log(`\n[AUSGANG-FORWARD FERTIG]  sent=${sent} skipped=${skipped} errors=${errors}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
