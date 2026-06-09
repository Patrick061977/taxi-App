#!/usr/bin/env node
// Suche Weigel-Adresse + alle Mails an/von Weigel/Anklam
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');

const USER = 'taxiwydra@googlemail.com';
const PASS = process.env.GMAIL_PASS;

(async () => {
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
    await client.connect();
    const hits = [];
    for (const box of ['INBOX']) {
        try {
            await client.mailboxOpen(box);
            for (const term of ['weigel', 'anklam']) {
                const uids = await client.search({ since: new Date('2024-01-01'), or: [{ from: term }, { to: term }, { body: term }, { subject: term }] });
                console.log(box + ' / ' + term + ': ' + uids.length);
                for (const uid of uids) {
                    const msg = await client.fetchOne(uid, { source: true });
                    if (!msg || !msg.source) continue;
                    const parsed = await simpleParser(msg.source);
                    hits.push({ box, uid, date: parsed.date, from: (parsed.from && parsed.from.text)||'', to: (parsed.to && parsed.to.text)||'', subject: parsed.subject||'', textPreview: (parsed.text||'').slice(0,800) });
                }
            }
        } catch(e) { console.log(box, e.message); }
    }
    await client.logout();
    fs.writeFileSync('C:/temp/weigel-mails.json', JSON.stringify(hits, null, 2));
    hits.sort((a,b)=>new Date(a.date)-new Date(b.date));
    for (const h of hits) {
        console.log('---');
        console.log('Date:', h.date);
        console.log('From:', h.from);
        console.log('To:', h.to);
        console.log('Subject:', h.subject);
        console.log(h.textPreview.slice(0,400));
    }
})().catch(e => { console.error('ERR', e); process.exit(1); });
