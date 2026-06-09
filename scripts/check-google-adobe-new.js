#!/usr/bin/env node
// check-google-adobe-new.js — letzten 60 Min in GOOGLE-Postfach auf neue Adobe-Rechnungen prüfen
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

const OUT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Adobe/2025/google';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    // Letzte 60 Min
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const uids = await client.search({ since });
    console.log('[Google] ' + uids.length + ' Mails letzte 60 Min');
    let dl = 0, adobeFound = 0;
    for (const uid of uids) {
        let msg;
        try {
            msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        } catch (e) { continue; }
        const subject = msg.envelope?.subject || '';
        const from = msg.envelope?.from?.[0]?.address || '';
        const lc = (subject + ' ' + from).toLowerCase();
        if (!lc.includes('adobe') && !lc.includes('transaction') && !lc.includes('rechnung')) continue;
        adobeFound++;
        const parsed = await simpleParser(msg.source);
        const pdfs = (parsed.attachments || []).filter(a =>
            a.contentType === 'application/pdf' || (a.filename || '').toLowerCase().endsWith('.pdf')
        );
        const dateISO = msg.internalDate?.toISOString().slice(0, 10);
        console.log(`  [${dateISO}] from=${from} subj="${subject.slice(0,80)}" pdfs=${pdfs.length}`);
        for (const att of pdfs) {
            const safe = (att.filename || `google-${dateISO}-uid${uid}.pdf`).replace(/[<>:"/\\|?*]/g, '_').slice(0, 180);
            const dest = path.join(OUT, safe);
            // Skip if exists same size
            if (fs.existsSync(dest) && fs.statSync(dest).size === att.content.length) {
                console.log('    (skip) ' + safe + ' bereits da');
                continue;
            }
            fs.writeFileSync(dest, att.content);
            dl++;
            console.log('    [DL] ' + safe);
        }
    }
    console.log('[Google] Adobe-related: ' + adobeFound + ', PDFs downloaded: ' + dl);
    await client.logout();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
