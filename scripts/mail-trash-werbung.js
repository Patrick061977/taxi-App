#!/usr/bin/env node
// mail-trash-werbung.js — Patrick (Bridge 01.06. 19:30): "Werbe-E-Mails kannst du
// erstmal alle löschen". Verschiebt alle als "werbung" klassifizierten Mails der
// letzten 7 Tage aus GMX + Gmail in den Papierkorb (reversibel falls Patrick
// etwas zurückholen muss).

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');

const SINCE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

const accounts = [
    { name: 'GMX', host: 'imap.gmx.net', user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS, trash: 'Trash' },
    { name: 'Gmail', host: 'imap.gmail.com', user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS, trash: '[Gmail]/Trash' },
];

function isWerbung(envelope, snippetLower) {
    const from = (envelope.from?.[0]?.address || '').toLowerCase();
    const fromName = (envelope.from?.[0]?.name || '').toLowerCase();
    const subject = (envelope.subject || '').toLowerCase();
    const hay = from + ' ' + fromName + ' ' + subject + ' ' + snippetLower;
    return /newsletter|unsubscribe|werbung|sale|-\s?\d{1,2}\s?%|rabatt|gutschein|gewinnspiel|aktion|flash[- ]?sale|black\s?friday|cyber\s?monday|barchart|aktienfinder|seasonax|too good to go|samsung\s.*deals|uber@uber\.com|aktion|exklusiv|spring sale/.test(hay);
}

async function processAccount(cfg) {
    const result = { account: cfg.name, scanned: 0, werbung: 0, moved: 0, errors: [] };
    const client = new ImapFlow({ host: cfg.host, port: 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ since: SINCE });
    result.scanned = uids.length;
    LOG(cfg.name, 'scanning', uids.length, 'Mails seit', SINCE.toISOString().slice(0,10));
    const werbungUids = [];
    for (const uid of uids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true });
            if (!msg) continue;
            const parsed = msg.source ? await simpleParser(msg.source) : null;
            const env = msg.envelope || {};
            const snippet = ((parsed && (parsed.text || parsed.html || '')) || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300).toLowerCase();
            if (isWerbung(env, snippet)) {
                werbungUids.push(uid);
                LOG('  → WERB:', env.from?.[0]?.address, '|', (env.subject || '').slice(0, 80));
            }
        } catch (e) { result.errors.push({ uid, err: e.message }); }
    }
    result.werbung = werbungUids.length;
    LOG(cfg.name, 'gefunden:', werbungUids.length, 'Werbe-Mails');

    if (werbungUids.length > 0) {
        try {
            await client.messageMove(werbungUids, cfg.trash, { uid: true });
            result.moved = werbungUids.length;
            LOG(cfg.name, '✅ in Papierkorb verschoben:', werbungUids.length);
        } catch (e) {
            LOG(cfg.name, 'MOVE-Fehler:', e.message);
            result.errors.push({ stage: 'move', err: e.message });
        }
    }
    await client.logout();
    return result;
}

(async () => {
    const summary = [];
    for (const acc of accounts) {
        try {
            const r = await processAccount(acc);
            summary.push(r);
        } catch (e) {
            LOG('account-fatal', acc.name, e.message);
            summary.push({ account: acc.name, fatal: e.message });
        }
    }
    console.log('\n=== Zusammenfassung ===');
    for (const r of summary) {
        if (r.fatal) {
            console.log(`${r.account}: FATAL ${r.fatal}`);
        } else {
            console.log(`${r.account}: ${r.scanned} gescannt, ${r.werbung} Werbung erkannt, ${r.moved} in Papierkorb`);
            if (r.errors?.length) console.log(`  Fehler: ${r.errors.length}`);
        }
    }
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
