#!/usr/bin/env node
// Suche ALLE Mails seit März 2026 wo 'Berlin' im Text vorkommt + August/8.
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

    // Alle Mails seit März → text contains Berlin
    const uids = await client.search({ since: new Date('2026-03-01') });
    console.log(`Durchsuche ${uids.length} Mails seit 2026-03-01 nach 'Berlin' im Text/Subj...`);
    let found = 0;
    for (const uid of uids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, internalDate: true, source: true });
            const subj = msg.envelope?.subject || '';
            const from = msg.envelope?.from?.[0]?.address || '?';
            const date = msg.internalDate?.toISOString().slice(0,10) || '?';
            const parsed = await simpleParser(msg.source);
            const text = (parsed.text || '') + ' ' + subj;
            if (/berlin/i.test(text)) {
                found++;
                console.log(`\n[${found}] ${date} | ${from}`);
                console.log(`  Subject: ${subj}`);
                // 200 Zeichen um "berlin" rum
                const idx = text.toLowerCase().indexOf('berlin');
                console.log(`  Snippet: ...${text.slice(Math.max(0,idx-100), idx+200)}...`);
            }
        } catch {}
    }
    console.log(`\nTotal Berlin-Mails: ${found}`);
    await client.logout();
})().catch(e => { console.error(e); process.exit(1); });
