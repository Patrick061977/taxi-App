#!/usr/bin/env node
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const cfg = { host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false };
(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ since: new Date('2026-05-22') });
    for (const uid of uids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true, internalDate: true });
            const subj = msg.envelope?.subject || '';
            const parsed = await simpleParser(msg.source);
            const text = parsed.text || '';
            if (/lehning|03080909797|kirchblick|zehlendorf/i.test(subj+' '+text)) {
                console.log('\nDATUM:', msg.internalDate?.toISOString().slice(0,16));
                console.log('FROM:', msg.envelope.from?.[0]?.address);
                console.log('REPLY-TO:', msg.envelope.replyTo?.[0]?.address);
                console.log('SUBJ:', subj);
                console.log('TEXT:', text.slice(0, 1500));
            }
        } catch {}
    }
    await client.logout();
})().catch(e => { console.error(e); process.exit(1); });
