#!/usr/bin/env node
// pull-wendlandt-invoices.js — alle Mails von Guido Wendlandt mit Rechnungen ziehen
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

const OUT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Wendlandt-Privat';
fs.mkdirSync(path.join(OUT, '2025'), { recursive: true });

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const since = new Date('2024-06-01');
    const uids = await client.search({ from: 'guido.wendlandt@arcor.de', since });
    console.log('[Wendlandt] ' + uids.length + ' Mails');
    let dl = 0;
    for (const uid of uids) {
        let msg;
        try {
            msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        } catch (e) { continue; }
        const subject = msg.envelope?.subject || '';
        const dateISO = msg.internalDate?.toISOString().slice(0, 10) || '';
        const year = dateISO.slice(0, 4);
        const parsed = await simpleParser(msg.source);
        const pdfs = (parsed.attachments || []).filter(a =>
            a.contentType === 'application/pdf' || (a.filename || '').toLowerCase().endsWith('.pdf')
        );
        if (pdfs.length === 0) continue;
        console.log('[' + dateISO + '] ' + subject + ' (' + pdfs.length + ' PDFs)');
        const dir = path.join(OUT, year);
        fs.mkdirSync(dir, { recursive: true });
        for (const att of pdfs) {
            const safe = (att.filename || `wendlandt-${dateISO}-uid${uid}.pdf`).replace(/[<>:"/\\|?*]/g, '_').slice(0, 180);
            const dest = path.join(dir, safe);
            if (fs.existsSync(dest) && fs.statSync(dest).size === att.content.length) continue;
            fs.writeFileSync(dest, att.content);
            dl++;
            console.log('  [DL] ' + safe);
        }
    }
    console.log('[DONE] ' + dl + ' PDFs');
    await client.logout();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
