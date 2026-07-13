#!/usr/bin/env node
// Holt die 2 Allianz-Porath-Mails (UID 39308 + 39731 in GMX, UID 28360 + 28371 in Gmail) komplett.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const ATTACHMENT_DIR = 'C:/Taxi App/taxi-App-github/.pdf-temp/allianz-attachments';
fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });

const TARGETS = [
    { host: 'imap.gmail.com', user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS, uids: [28360, 28371], label: 'GMAIL' },
    { host: 'imap.gmx.net', user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS, uids: [39308, 39731], label: 'GMX' }
];

(async () => {
    for (const cfg of TARGETS) {
        if (!cfg.pass) { console.log(cfg.label, 'KEIN PASSWORT'); continue; }
        console.log('\n=== ' + cfg.label + ' ===');
        const c = new ImapFlow({ host: cfg.host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
        await c.connect();
        await c.mailboxOpen('INBOX');
        for (const uid of cfg.uids) {
            try {
                const m = await c.fetchOne(uid, { source: true });
                if (!m?.source) { console.log(' UID', uid, 'KEINE SOURCE'); continue; }
                const p = await simpleParser(m.source);
                console.log('\n📧 UID ' + uid + ' ' + cfg.label);
                console.log('   FROM:', p.from?.value?.[0]?.address || '?');
                console.log('   DATE:', p.date?.toLocaleString('de-DE') || '?');
                console.log('   SUBJ:', p.subject || '?');
                console.log('   TEXT (komplett):');
                console.log('---TEXT-START---');
                console.log(p.text || '(leer)');
                console.log('---TEXT-END---');
                console.log('   ATTACHMENTS:', (p.attachments || []).map(a => a.filename + ' (' + Math.round(a.size/1024) + 'KB)').join(', '));
                for (const att of (p.attachments || [])) {
                    const fname = (att.filename || ('attachment-' + uid)).replace(/[^a-zA-Z0-9_.-]/g, '_');
                    const dest = path.join(ATTACHMENT_DIR, cfg.label + '-' + uid + '-' + fname);
                    fs.writeFileSync(dest, att.content);
                    console.log('   📂 Gespeichert:', dest);
                }
            } catch(e) { console.warn(' UID', uid, 'ERROR:', e.message); }
        }
        await c.logout();
    }
    console.log('\nFERTIG');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
