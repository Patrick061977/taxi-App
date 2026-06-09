#!/usr/bin/env node
// check-gmx-adobe-new.js — letzten 60 Min in GMX-Postfach auf neue Adobe-Rechnungen prüfen
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmx.net', port: 993, secure: true,
    auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS }, logger: false,
};

const OUT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Adobe/2025/gmx';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    // Letzte 24h
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const uids = await client.search({ since });
    console.log('[GMX] ' + uids.length + ' Mails letzte 24h');
    let dl = 0, adobeFound = 0;
    for (const uid of uids) {
        let msg;
        try {
            msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        } catch (e) { continue; }
        const subject = msg.envelope?.subject || '';
        const from = msg.envelope?.from?.[0]?.address || '';
        // Adobe-relevant?
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
            const safe = (att.filename || `gmx-${dateISO}-uid${uid}.pdf`).replace(/[<>:"/\\|?*]/g, '_').slice(0, 180);
            const dest = path.join(OUT, safe);
            fs.writeFileSync(dest, att.content);
            dl++;
            console.log('    [DL] ' + safe);
        }
    }
    console.log('[GMX] Adobe-related: ' + adobeFound + ', PDFs downloaded: ' + dl);
    await client.logout();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
