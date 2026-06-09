#!/usr/bin/env node
// vetter-pull-analyse.js — Vetter Touristik Fahraufträge aus Gmail ziehen + analysieren
// Patrick (22.05. 06:53): "vetter sind aufträge — auch durchlesen und analysieren"

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Vetter-Touristik-Auftraege';
const SINCE = new Date('2025-01-01');

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ from: 'info@vetter-touristik.de', since: SINCE });
    console.log(`[Vetter] ${uids.length} Mails seit 2025-01-01`);

    const rows = [];
    rows.push(['Datum','Subject','PDFAnzahl','PDFs','Auftrag-Datum','Auftrag-Zeit','Pickup','Ziel','Personen','Preis','TextSnippet'].join(';'));
    let dl = 0;
    for (const uid of uids) {
        let msg;
        try {
            msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        } catch { continue; }
        const subject = msg.envelope?.subject || '';
        const dateISO = msg.internalDate?.toISOString().slice(0, 10) || '';
        const year = dateISO.slice(0, 4);
        const parsed = await simpleParser(msg.source);
        const text = parsed?.text || '';

        // PDFs speichern
        const pdfs = (parsed.attachments || []).filter(a =>
            a.contentType === 'application/pdf' || (a.filename || '').toLowerCase().endsWith('.pdf')
        );
        const pdfNames = [];
        for (const att of pdfs) {
            const safe = (att.filename || `vetter-${dateISO}-uid${uid}.pdf`).replace(/[<>:"/\\|?*]/g, '_').slice(0, 180);
            const destDir = path.join(OUT_DIR, year);
            fs.mkdirSync(destDir, { recursive: true });
            const dest = path.join(destDir, safe);
            if (!(fs.existsSync(dest) && fs.statSync(dest).size === att.content.length)) {
                fs.writeFileSync(dest, att.content);
                dl++;
            }
            pdfNames.push(safe);
        }

        // Body analysieren — typische Vetter-Felder
        const dateM = text.match(/(?:Datum|Termin|am)[:\s]+(\d{1,2}[.,/-]\d{1,2}[.,/-]\d{2,4})/i)
                   || subject.match(/(\d{2}[.,/-]\d{2}[.,/-]\d{2,4})/);
        const timeM = text.match(/(?:Uhrzeit|Zeit|um)[:\s]+(\d{1,2}[:.]\d{2})/i)
                   || subject.match(/(\d{1,2}[:.]\d{2})\s*Uhr/i);
        const pickupM = text.match(/(?:Abholung|Abholort|Start|Von|Pickup)[:\s]+([^\n]+)/i);
        const zielM = text.match(/(?:Ziel|Nach|Zielort|Destination)[:\s]+([^\n]+)/i);
        const personenM = text.match(/(?:Personen|Pers|Pax)[:\s]+(\d+)/i);
        const preisM = text.match(/(?:Preis|Gesamt|EUR)[:\s]+([\d.,]+)\s*(?:€|EUR)/i)
                    || text.match(/([\d.,]+)\s*€/);

        rows.push([
            dateISO, subject.slice(0, 80),
            pdfs.length, pdfNames.join(' | '),
            dateM ? dateM[1] : '',
            timeM ? timeM[1] : '',
            pickupM ? pickupM[1].slice(0, 60).trim() : '',
            zielM ? zielM[1].slice(0, 60).trim() : '',
            personenM ? personenM[1] : '',
            preisM ? preisM[1] : '',
            text.slice(0, 150).replace(/\n/g, ' '),
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    }

    const csvFile = path.join(OUT_DIR, '_vetter-auftraege.csv');
    fs.writeFileSync(csvFile, '﻿' + rows.join('\r\n'));
    console.log(`[Vetter] FERTIG — ${dl} PDFs neu geladen, ${rows.length-1} Aufträge in CSV → ${csvFile}`);
    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
