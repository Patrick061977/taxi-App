#!/usr/bin/env node
// hale-mails-gmx-pull.js — Hale schickt Tagesabrechnungen täglich 04:00 Uhr an taxiwydra@gmx.de
// Sender: noreply@hale.at | Subject: "Taxiabrechnung 07 %" | Anhang: EventReport_YYYY_MM_DD.pdf
// Patrick (22.05. 06:57): rückwirkend alle 2025-er Hale-Tagesberichte ziehen

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmx.net', port: 993, secure: true,
    auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS }, logger: false,
};

const OUT_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Hale-Tagesabrechnungen';
fs.mkdirSync(path.join(OUT_ROOT, '2025'), { recursive: true });
fs.mkdirSync(path.join(OUT_ROOT, '2026'), { recursive: true });

const SINCE = new Date('2025-01-01');

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ from: 'noreply@hale.at', since: SINCE });
    console.log(`[Hale-GMX] ${uids.length} Mails seit 2025-01-01`);

    const rows = [];
    rows.push(['Datum','Subject','PDFAnzahl','PDFs','Pfad'].join(';'));
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
        const pdfs = (parsed.attachments || []).filter(a =>
            a.contentType === 'application/pdf' || (a.filename || '').toLowerCase().endsWith('.pdf')
        );
        const pdfNames = [];
        const destDir = path.join(OUT_ROOT, year);
        fs.mkdirSync(destDir, { recursive: true });
        for (const att of pdfs) {
            const safe = (att.filename || `hale-${dateISO}-uid${uid}.pdf`).replace(/[<>:"/\\|?*]/g, '_').slice(0, 180);
            const dest = path.join(destDir, safe);
            if (fs.existsSync(dest) && fs.statSync(dest).size === att.content.length) {
                pdfNames.push(safe);
                continue;
            }
            fs.writeFileSync(dest, att.content);
            dl++;
            pdfNames.push(safe);
        }
        rows.push([dateISO, subject, pdfs.length, pdfNames.join(' | '), destDir.replace(/\\/g,'/')]
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    }
    const csvFile = path.join(OUT_ROOT, '_hale-tagesabrechnungen.csv');
    fs.writeFileSync(csvFile, '﻿' + rows.join('\r\n'));
    console.log(`[Hale-GMX] FERTIG — ${dl} PDFs neu geladen, ${rows.length-1} Mails in CSV`);
    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
