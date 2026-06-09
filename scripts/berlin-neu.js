#!/usr/bin/env node
// Suche NEUE Berlin-Transfer-Mail seit heute
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
    // Heute + letzte 3 Tage, alle Mails mit "Berlin" oder "Transfer" oder "Heringsdorf"
    const uids = await client.search({ since: new Date('2026-05-20') });
    console.log(`Mails seit 20.05.: ${uids.length}`);
    let found = 0;
    for (const uid of uids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true, internalDate: true });
            const subj = msg.envelope?.subject || '';
            const from = msg.envelope?.from?.[0]?.address || '?';
            const date = msg.internalDate?.toISOString().replace('T',' ').slice(0,16);
            const parsed = await simpleParser(msg.source);
            const text = parsed.text || '';
            // Filter: berlin + 06 oder 18.06 oder 25.06 oder Juni
            const combined = subj + ' ' + text;
            if (/18\.06\.2026|25\.06\.2026|18\.06\.26|25\.06\.26|18\.\s?Juni|25\.\s?Juni/i.test(combined) ||
                (/transfer|abholung|fahrt/i.test(combined) && /berlin/i.test(combined))) {
                found++;
                console.log(`\n[${found}] ${date} | ${from}`);
                console.log(`  Subj: ${subj}`);
                console.log(`  Text: ${text.slice(0, 600)}`);
            }
        } catch {}
    }
    if (!found) {
        console.log('\nKein Berlin+Juni-Treffer gefunden. Zeige ALLE Mails von heute:');
        const today = await client.search({ since: new Date('2026-05-22') });
        for (const uid of today) {
            try {
                const env = (await client.fetchOne(uid, { envelope: true, internalDate: true })).envelope;
                const date = env.date ? env.date.toString().slice(0,21) : '';
                console.log(`  ${date} | ${env.from?.[0]?.address} | ${env.subject}`);
            } catch {}
        }
    }
    await client.logout();
})().catch(e => { console.error(e); process.exit(1); });
