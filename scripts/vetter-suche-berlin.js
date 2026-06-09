#!/usr/bin/env node
// vetter-suche-berlin.js — Suche Vetter-Mails seit 2026-05-01 nach 'Berlin' oder 'August'
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ from: 'info@vetter-touristik.de', since: new Date('2026-03-01') });
    console.log(`${uids.length} Vetter-Mails seit Mitte April`);
    for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        const parsed = await simpleParser(msg.source);
        const subj = msg.envelope?.subject || '';
        const text = parsed.text || '';
        const date = msg.internalDate?.toISOString().slice(0,10) || '';
        const isBerlin = /berlin/i.test(subj) || /berlin/i.test(text);
        const isAugust = /august|08\.|\.08\./i.test(subj) || /august|08\.|\.08\./i.test(text);
        if (isBerlin || isAugust) {
            console.log('\n=== MAIL ===');
            console.log('Datum:', date);
            console.log('Subject:', subj);
            console.log('Berlin:', isBerlin, '| August:', isAugust);
            console.log('Text-Snippet:', text.slice(0, 800));
        }
    }
    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
