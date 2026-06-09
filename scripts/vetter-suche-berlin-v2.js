#!/usr/bin/env node
// Suche ALLE Mails ab März 2026 nach Berlin+August Bezug
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

    // 1. Alle Vetter-Mails seit Mai 2026 → Body lesen für Berlin
    console.log('=== ALLE Vetter-Mails seit 2026-05-01 ===');
    const vUids = await client.search({ from: 'info@vetter-touristik.de', since: new Date('2026-05-01') });
    for (const uid of vUids) {
        const msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
        const parsed = await simpleParser(msg.source);
        const subj = msg.envelope?.subject || '';
        const text = parsed.text || '';
        const date = msg.internalDate?.toISOString().slice(0,16).replace('T',' ');
        console.log(`\n${date} | ${subj}`);
        console.log('Text:', text.slice(0, 400));
    }

    // 2. ALLE Mails mit Berlin im Subject seit März
    console.log('\n\n=== Alle Mails mit BERLIN im Subject ===');
    const bUids = await client.search({ since: new Date('2026-03-01') });
    for (const uid of bUids) {
        const env = (await client.fetchOne(uid, { envelope: true, internalDate: true })).envelope;
        const subj = env?.subject || '';
        if (/berlin/i.test(subj)) {
            console.log(`  ${env.from?.[0]?.address || '?'} | ${subj} | ${env.date}`);
        }
    }

    // 3. Nickel — letzte Mail
    console.log('\n\n=== Werbeagentur Nickel — letzte Mails ===');
    const nUids = await client.search({ from: 'nickel', since: new Date('2026-04-01') });
    for (const uid of nUids.slice(-3)) {
        const env = (await client.fetchOne(uid, { envelope: true, internalDate: true })).envelope;
        console.log(`  ${env?.date} | ${env?.subject}`);
    }
    const nUids2 = await client.search({ from: 'buchhaltung@werbeagentur-nickel.de', since: new Date('2026-04-01') });
    for (const uid of nUids2.slice(-3)) {
        const env = (await client.fetchOne(uid, { envelope: true, internalDate: true })).envelope;
        console.log(`  ${env?.date} | ${env?.subject}`);
    }

    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
