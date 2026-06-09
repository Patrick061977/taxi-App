#!/usr/bin/env node
// Pull all Patrick-Mails about Kaiserbaeder/Kurkarte/Heilmann/Nagy/Haak (gesendet + INBOX, 2024-2026)
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');

const USER = 'taxiwydra@googlemail.com';
const PASS = process.env.GMAIL_PASS;

const SEARCH_TERMS = ['kurkart', 'kaiserbäder', 'kaiserbaeder', 'heilmann', 'nagy', 'kurtaxe', 'kurabgabe', 'haak'];

(async () => {
    const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
    await client.connect();
    const allHits = new Map();
    const boxes = ['INBOX', '[Gmail]/Sent Mail'];
    for (const box of boxes) {
        try {
            await client.mailboxOpen(box);
            console.log('Box', box);
            for (const term of SEARCH_TERMS) {
                const uids = await client.search({ since: new Date('2024-01-01'), or: [{ subject: term }, { body: term }] });
                if (uids.length) console.log('  term=' + term + ' → ' + uids.length + ' msgs');
                for (const uid of uids) {
                    const key = box + ':' + uid;
                    if (allHits.has(key)) continue;
                    const msg = await client.fetchOne(uid, { source: true });
                    if (!msg || !msg.source) continue;
                    const parsed = await simpleParser(msg.source);
                    allHits.set(key, {
                        box, uid,
                        date: parsed.date,
                        from: (parsed.from && parsed.from.text) || '',
                        to: (parsed.to && parsed.to.text) || '',
                        cc: (parsed.cc && parsed.cc.text) || '',
                        subject: parsed.subject || '',
                        text: parsed.text || ''
                    });
                }
            }
        } catch (e) { console.log('  ' + box + ': ' + e.message); }
    }
    await client.logout();
    const hits = Array.from(allHits.values()).sort((a,b)=> new Date(a.date) - new Date(b.date));
    console.log('\n=== ' + hits.length + ' unique Kurkarten-Mails 2024-2026 ===');
    for (const h of hits) {
        console.log('---');
        console.log('Date:', h.date);
        console.log('From:', h.from);
        console.log('To:', h.to);
        if (h.cc) console.log('Cc:', h.cc);
        console.log('Subject:', h.subject);
        console.log('--Body (first 1500)--');
        console.log((h.text || '').slice(0, 1500));
    }
    fs.writeFileSync('C:/temp/kurkarten-mails.json', JSON.stringify(hits, null, 2));
    console.log('\nSaved C:/temp/kurkarten-mails.json (' + hits.length + ' mails)');
})().catch(e => { console.error('ERR', e); process.exit(1); });
