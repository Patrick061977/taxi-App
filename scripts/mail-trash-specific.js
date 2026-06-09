#!/usr/bin/env node
// mail-trash-specific.js — Per-Patrick-Anweisung gezielt Mails in Papierkorb
// verschieben. Aktuell: Stuhlprobe / Praxis Gramsch.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');

const SINCE = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

const accounts = [
    { name: 'GMX', host: 'imap.gmx.net', user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS, trash: 'Trash' },
    { name: 'Gmail', host: 'imap.gmail.com', user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS, trash: '[Gmail]/Trash' },
];

function shouldTrash(envelope, snippet) {
    const from = (envelope.from?.[0]?.address || '').toLowerCase();
    const subj = (envelope.subject || '').toLowerCase();
    const hay = from + ' ' + subj + ' ' + snippet;
    // Stuhlprobe / Praxis Gramsch
    return /stuhlprobe|gramsch/.test(hay) && /(praxis|t-online|nachreich|kurzfeedback)/.test(hay);
}

(async () => {
    const summary = [];
    for (const cfg of accounts) {
        const r = { account: cfg.name, scanned: 0, matched: 0, moved: 0 };
        const client = new ImapFlow({ host: cfg.host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
        await client.connect();
        await client.mailboxOpen('INBOX');
        const uids = await client.search({ since: SINCE });
        r.scanned = uids.length;
        const trashUids = [];
        for (const uid of uids) {
            try {
                const msg = await client.fetchOne(uid, { envelope: true, source: true });
                if (!msg) continue;
                const parsed = msg.source ? await simpleParser(msg.source) : null;
                const env = msg.envelope || {};
                const snippet = ((parsed && (parsed.text || parsed.html || '')) || '').toString().replace(/<[^>]+>/g, ' ').slice(0, 400).toLowerCase();
                if (shouldTrash(env, snippet)) {
                    trashUids.push(uid);
                    LOG('  → match:', env.from?.[0]?.address, '|', (env.subject || '').slice(0, 90));
                }
            } catch (_) {}
        }
        r.matched = trashUids.length;
        if (trashUids.length) {
            try {
                await client.messageMove(trashUids, cfg.trash, { uid: true });
                r.moved = trashUids.length;
            } catch (e) {
                LOG(cfg.name, 'MOVE-Fehler:', e.message);
            }
        }
        await client.logout();
        summary.push(r);
    }
    console.log('\n=== Trash Summary ===');
    for (const s of summary) console.log(JSON.stringify(s));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
