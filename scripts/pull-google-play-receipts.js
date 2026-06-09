#!/usr/bin/env node
// pull-google-play-receipts.js — Google Play Bestellungen aus Gmail extrahieren
// Parsiert Mails von googleplay-noreply@google.com und googleone-noreply@google.com
// und baut CSV-Liste 2025+2026 sowie pro Beleg eine HTML-Datei zur Archivierung.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

const OUT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Google-Play';
fs.mkdirSync(path.join(OUT, '2025'), { recursive: true });
fs.mkdirSync(path.join(OUT, '2026'), { recursive: true });

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const since = new Date('2025-01-01');
    // Mehrere Google-Play-Sender (Belege, Refunds, Abo-Hinweise)
    const queries = [
        { from: 'googleplay-noreply@google.com', since },
        { from: 'googleone-noreply@google.com', since },
        { from: 'payments-noreply@google.com', since },
    ];

    const rows = [];
    rows.push(['Datum','Sender','Subject','Produkt','Betrag','Bestellnummer','Datei','Year'].join(';'));

    let total = 0;

    for (const q of queries) {
        const uids = await client.search(q);
        console.log('\n[' + q.from + '] ' + uids.length + ' Mails');
        for (const uid of uids) {
            let msg;
            try {
                msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
            } catch (e) { continue; }
            const subj = msg.envelope?.subject || '';
            const dateISO = msg.internalDate?.toISOString().slice(0, 10) || '';
            const year = dateISO.slice(0, 4);

            // Nur Belege/Rechnungen — keine Erinnerungs-Mails
            const lc = subj.toLowerCase();
            const isReceipt = lc.includes('beleg') || lc.includes('receipt') || lc.includes('quittung')
                || lc.includes('bestätig') || lc.includes('bestellbeleg') || lc.includes('erstattung')
                || lc.includes('refund');
            if (!isReceipt) continue;

            const parsed = await simpleParser(msg.source);
            const text = parsed.text || '';
            const html = parsed.html || '';

            // Extrahiere Produkt + Betrag + Bestellnummer aus Text
            const m_prod1 = text.match(/Folgendes hast du erhalten[:\s]+([^\n]+)/);
            const m_prod2 = text.match(/Produkt[:\s]+([^\n]+)/);
            const m_prod3 = subj.match(/Beleg für deine.*Bestellung vom\s+(\d{2}\.\d{2}\.\d{4})/);
            const product = (m_prod1 && m_prod1[1].trim()) || (m_prod2 && m_prod2[1].trim()) || '';

            const m_amt = text.match(/Gesamtbetrag[:\s]+(\d+[,.]\d{2})\s*€/)
                || text.match(/Summe[:\s]+(\d+[,.]\d{2})\s*€/)
                || text.match(/(\d+[,.]\d{2})\s*€/);
            const amount = m_amt ? m_amt[1] : '';

            const m_order = text.match(/Bestellnummer[:\s]+(GPA\.\d+-\d+-\d+-\d+)/)
                || text.match(/Bestellnummer[:\s]+([A-Z0-9.\-]+)/);
            const order = m_order ? m_order[1] : '';

            // HTML/Text als 'pseudo-PDF' speichern (einfache .html / .txt)
            const fnSafe = `${dateISO}_${order || 'order-' + uid}.html`.replace(/[<>:"/\\|?*]/g, '_').slice(0, 180);
            const dest = path.join(OUT, year || '2025', fnSafe);
            try {
                fs.writeFileSync(dest, html || `<html><body><pre>${text.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre></body></html>`);
            } catch {}

            rows.push([dateISO, msg.envelope.from?.[0]?.address || '', subj, product, amount, order, fnSafe, year]
                .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
            total++;
        }
    }

    const csvFile = path.join(OUT, '_google-play-belege.csv');
    fs.writeFileSync(csvFile, '﻿' + rows.join('\r\n'));
    console.log('\n[DONE] ' + total + ' Google-Play-Belege → ' + csvFile);
    await client.logout();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
