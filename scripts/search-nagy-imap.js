#!/usr/bin/env node
// Suche IMAP Gmail nach Mails von/an "Nagy" Sept 2025 mit Kurkarten-Bezug
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');

const USER = 'taxiwydra@googlemail.com';
const PASS = process.env.GMAIL_PASS;

(async () => {
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
    await client.connect();
    const hits = [];
    for (const box of ['INBOX', '[Gmail]/Gesendet', '[Gmail]/Alle Nachrichten']) {
        try {
            await client.mailboxOpen(box);
            console.log('Searching in', box, '...');
            const uids = await client.search({ since: new Date('2025-08-01'), before: new Date('2025-11-01'), or: [{ from: 'nagy' }, { to: 'nagy' }, { body: 'Nagy' }] });
            console.log('  Found', uids.length, 'msgs');
            for (const uid of uids) {
                const msg = await client.fetchOne(uid, { source: true, envelope: true });
                if (!msg || !msg.source) continue;
                const parsed = await simpleParser(msg.source);
                const subject = parsed.subject || '';
                const from = (parsed.from && parsed.from.text) || '';
                const to = (parsed.to && parsed.to.text) || '';
                const text = (parsed.text || '').slice(0, 2000);
                hits.push({ box, uid, date: parsed.date, from, to, subject, textPreview: text });
            }
        } catch (e) { console.log('  ' + box + ': ' + e.message); }
    }
    await client.logout();
    console.log('\n=== TOTAL HITS:', hits.length, '===');
    hits.sort((a,b)=> new Date(a.date) - new Date(b.date));
    for (const h of hits) {
        console.log('---');
        console.log('Date:', h.date);
        console.log('From:', h.from);
        console.log('To:', h.to);
        console.log('Subject:', h.subject);
        console.log('Body (2000 chars):');
        console.log(h.textPreview);
    }
    fs.writeFileSync('C:/temp/nagy-mails.json', JSON.stringify(hits, null, 2));
    console.log('\nSaved C:/temp/nagy-mails.json');
})().catch(e => { console.error('ERR', e); process.exit(1); });
