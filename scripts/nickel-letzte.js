#!/usr/bin/env node
// Letzte Nickel-Mails finden
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
    // Suche alle Nickel-Mails
    const queries = [
        { from: 'buchhaltung@werbeagentur-nickel.de' },
        { from: 'nickel' },
    ];
    for (const q of queries) {
        const uids = await client.search({ ...q, since: new Date('2026-04-01') });
        console.log(`Query ${JSON.stringify(q)}: ${uids.length} Mails`);
        for (const uid of uids.slice(-5)) {
            const msg = await client.fetchOne(uid, { envelope: true, internalDate: true, source: true });
            const date = msg.internalDate?.toISOString().slice(0,16).replace('T',' ');
            const subj = msg.envelope?.subject || '';
            console.log(`  ${date} | ${msg.envelope?.from?.[0]?.address} | ${subj}`);
            const parsed = await simpleParser(msg.source);
            console.log(`    Snippet: ${(parsed.text || '').slice(0, 200).replace(/\s+/g,' ')}`);
            const pdfs = (parsed.attachments || []).filter(a => (a.filename || '').toLowerCase().endsWith('.pdf'));
            if (pdfs.length) console.log(`    PDF: ${pdfs.map(p => p.filename).join(', ')}`);
        }
    }
    await client.logout();
})().catch(e => { console.error(e); process.exit(1); });
