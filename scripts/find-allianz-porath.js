#!/usr/bin/env node
// Sucht in Gmail + GMX nach Allianz / Porath / Kostenuebernahme Mails seit 2026-01-01

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');

(async () => {
    const accounts = [
        { host: 'imap.gmail.com', user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS, label: 'GMAIL' },
        { host: 'imap.gmx.net', user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS, label: 'GMX' }
    ];
    const hits = [];
    for (const cfg of accounts) {
        if (!cfg.pass) { console.log(cfg.label + ': KEIN PASSWORT'); continue; }
        console.log('\n=== ' + cfg.label + ' ===');
        const c = new ImapFlow({ host: cfg.host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
        try {
            await c.connect();
            await c.mailboxOpen('INBOX');
            const since = new Date('2026-01-01');
            const uids = await c.search({ since });
            console.log('Mails seit 01.01.2026:', uids.length);
            let count = 0;
            for (const uid of uids) {
                try {
                    const m = await c.fetchOne(uid, { envelope: true });
                    if (!m?.envelope) continue;
                    const from = (m.envelope.from?.[0]?.address || '').toLowerCase();
                    const subj = (m.envelope.subject || '').toLowerCase();
                    const isMatch = from.includes('allianz') || subj.includes('allianz')
                        || subj.includes('porath')
                        || subj.includes('kostenüber') || subj.includes('kostenuber')
                        || (from.includes('allianz') && (subj.includes('schaden') || subj.includes('aktenzeichen')));
                    if (isMatch) {
                        count++;
                        const dt = m.envelope.date ? new Date(m.envelope.date).toLocaleString('de-DE') : '?';
                        const entry = { uid, label: cfg.label, from: m.envelope.from?.[0]?.address, subject: m.envelope.subject, date: dt };
                        console.log(' UID', uid, '|', dt, '|', entry.from, '|', (entry.subject || '').slice(0, 90));
                        if (count <= 5) {
                            const full = await c.fetchOne(uid, { source: true });
                            const p = await simpleParser(full.source);
                            entry.text = (p.text || '').slice(0, 2000);
                            entry.attachments = (p.attachments || []).map(a => ({ filename: a.filename, size: a.size, contentType: a.contentType }));
                            console.log('   TEXT-PREVIEW:', entry.text.slice(0, 500).replace(/\n+/g, ' | '));
                            if (entry.attachments.length) console.log('   ATTACHMENTS:', entry.attachments.map(a => a.filename).join(', '));
                        }
                        hits.push(entry);
                    }
                } catch(eUid) { console.warn(' UID-Fehler', uid, eUid.message); }
            }
            console.log('Treffer ' + cfg.label + ':', count);
            await c.logout();
        } catch(e) { console.warn(cfg.label, 'FATAL:', e.message); }
    }
    fs.writeFileSync('C:/Taxi App/taxi-App-github/.pdf-temp/allianz-search-result.json', JSON.stringify(hits, null, 2));
    console.log('\nGESAMT-TREFFER:', hits.length, '→ .pdf-temp/allianz-search-result.json');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
