#!/usr/bin/env node
// pull-vetter-pdf-13-06.js — Patrick 05.06.2026 11:07: 'PDF im Anhang holen'
// Lädt das doc01642220260605104347.pdf aus Vetter-Mail von heute 10:51 und speichert lokal.

const fs = require('fs');
const path = require('path');
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');

(async () => {
    const imap = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
        logger: false
    });
    await imap.connect();
    await imap.mailboxOpen('INBOX');

    const uids = await imap.search({ from: 'info@vetter-touristik.de', since: new Date(Date.now() - 86400000) });
    console.log('Vetter UIDs:', uids);

    for (const uid of uids.slice(-3)) {
        const m = await imap.fetchOne(uid, { source: true });
        const p = await simpleParser(m.source);
        const subject = p.subject || '';
        if (!/13\.06|transfer/i.test(subject)) continue;
        console.log(`\nUID ${uid}: ${subject}`);
        for (const att of (p.attachments || [])) {
            if (!att.filename) continue;
            const outDir = '/tmp/vetter';
            fs.mkdirSync(outDir, { recursive: true });
            const outPath = path.join(outDir, att.filename);
            fs.writeFileSync(outPath, att.content);
            console.log('Saved:', outPath, '(' + att.content.length + ' bytes)');
        }
    }

    await imap.logout();
})().catch(e => { console.error('Fehler:', e); process.exit(1); });
