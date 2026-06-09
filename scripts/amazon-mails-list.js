#!/usr/bin/env node
// amazon-mails-list.js — Patrick (21.05. 20:27): Amazon-Bestellbestätigungs-Mails aus Gmail
// auflisten (kein PDF-Download — Amazon schickt keine PDFs, nur HTML-Bestätigungen).
// Liefert CSV mit Datum, Bestellnummer, Artikel-Name, Betrag pro Bestellung.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Amazon';
fs.mkdirSync(OUT_DIR, { recursive: true });
const CSV_FILE = path.join(OUT_DIR, '_amazon-bestellungen.csv');

const SINCE = new Date('2025-01-01');

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    // Amazon-Bestellungen
    const uids = await client.search({
        since: SINCE,
        or: [
            { from: 'bestellbestaetigung@amazon.de' },
            { from: 'versandbestaetigung@amazon.de' },
            { from: 'auto-confirm@amazon.de' },
        ],
    });
    console.log(`[Amazon-Mails] ${uids.length} Mails seit 2025-01-01`);

    const rows = [];
    rows.push(['Datum','Bestellnummer','Artikel','Betrag','Subject','UID'].join(';'));
    let cnt = 0;
    for (const uid of uids) {
        cnt++;
        if (cnt % 100 === 0) console.log(`  ${cnt}/${uids.length}`);
        let msg;
        try {
            msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        } catch { continue; }
        const subject = msg.envelope?.subject || '';
        const from = msg.envelope?.from?.[0]?.address || '';
        const dateISO = msg.internalDate?.toISOString().slice(0, 10) || '';
        // Skip Versand-Bestätigungen (sind Dubletten zu Bestellbestätigungen) — nur 'bestellbestaetigung@'
        if (!from.includes('bestellbestaetigung')) continue;
        // Parse Body für Bestellnummer + Betrag + Artikel
        let parsed = null;
        try { parsed = await simpleParser(msg.source); } catch {}
        const text = parsed?.text || '';
        const orderM = text.match(/Bestellnummer\s*[:#]?\s*(\d{3}-\d{7}-\d{7})/)
                    || text.match(/(\d{3}-\d{7}-\d{7})/);
        const orderId = orderM ? orderM[1] : '';
        // Betrag suchen
        const amtM = text.match(/Gesamtsumme[:\s]+([\d.,]+\s*EUR)/i)
                  || text.match(/Bestellsumme[:\s]+([\d.,]+\s*EUR)/i)
                  || text.match(/Summe[:\s]+([\d.,]+\s*EUR)/i)
                  || text.match(/([\d.,]+\s*EUR)\b/);
        const amt = amtM ? amtM[1].trim() : '';
        // Artikel aus Subject extrahieren
        const artM = subject.match(/Bestellt[:\s]+„?([^"„]+)"?/i)
                  || subject.match(/„([^"„]+)"/)
                  || subject.match(/Ihre Amazon\.de Bestellung von\s+(.+?)\.?$/);
        const artikel = artM ? artM[1].trim() : subject.slice(0, 80);

        rows.push([dateISO, orderId, artikel, amt, subject.slice(0, 100), uid]
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    }

    fs.writeFileSync(CSV_FILE, '﻿' + rows.join('\r\n'));
    console.log(`\n[Amazon-Mails] FERTIG — ${rows.length - 1} Bestellungen → ${CSV_FILE}`);
    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
