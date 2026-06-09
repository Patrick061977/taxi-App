#!/usr/bin/env node
// Suche Transfer-Anfragen IM MAI 2026 wo August oder 8. erwähnt wird
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
    const uids = await client.search({ since: new Date('2026-05-01'), before: new Date('2026-05-23') });
    console.log(`Mai-Mails: ${uids.length}`);
    let found = 0;
    for (const uid of uids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true, internalDate: true });
            const subj = msg.envelope?.subject || '';
            const from = msg.envelope?.from?.[0]?.address || '?';
            const date = msg.internalDate?.toISOString().slice(0,10) || '?';
            const parsed = await simpleParser(msg.source);
            const text = (parsed.text || '') + ' ' + subj;
            // Filter: Berlin + August/8./08.
            const hasBerlin = /berlin/i.test(text);
            const hasAugust = /august|01\.08|02\.08|03\.08|04\.08|05\.08|06\.08|07\.08|08\.08|09\.08|1[0-9]\.08|2[0-9]\.08|3[01]\.08|\/08\/|2026-08-/i.test(text);
            if (hasBerlin && hasAugust) {
                found++;
                console.log(`\n[${found}] ${date} | ${from} | ${subj}`);
                const idx = text.toLowerCase().indexOf('berlin');
                console.log(`  ...${text.slice(Math.max(0,idx-150), idx+400)}...`);
            }
            // Auch nur "Abholung August"
            if (!hasBerlin && hasAugust && /abholung|transfer|fahrt|taxi/i.test(text)) {
                console.log(`\n[KANDIDAT] ${date} | ${from} | ${subj}`);
                const idx = text.toLowerCase().search(/august|\.08\./i);
                console.log(`  ...${text.slice(Math.max(0,idx-100), idx+300)}...`);
            }
        } catch {}
    }
    console.log(`\nBerlin+August: ${found}`);
    await client.logout();
})().catch(e => { console.error(e); process.exit(1); });
