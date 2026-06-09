#!/usr/bin/env node
// mail-briefing-7days.js — Patrick (Bridge 01.06. 19:15): Mails letzte 7 Tage
// aus GMX + Gmail durchgehen, klassifizieren, antworten / löschen / informieren.
//
// Output: scripts-Verzeichnis ./mail-briefing-output.json + Konsolen-Übersicht.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');

const SINCE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

const accounts = [
    { name: 'GMX', host: 'imap.gmx.net', port: 993, user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS },
    { name: 'Gmail', host: 'imap.gmail.com', port: 993, user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS },
];

function classify(envelope, snippetLower) {
    const from = (envelope.from?.[0]?.address || '').toLowerCase();
    const subject = (envelope.subject || '').toLowerCase();
    const hay = from + ' ' + subject + ' ' + snippetLower;

    if (/newsletter|unsubscribe|werbung|sale|-\s?\d{1,2}\s?%|rabatt|gutschein|gewinnspiel|aktion|flash[- ]?sale|black\s?friday|cyber\s?monday/.test(hay))
        return { cat: 'werbung', prio: 'mute', emoji: '🗑️' };
    if (/no-?reply|do[-_]?not[-_]?reply|@github\.com|notifications?@/.test(from))
        return { cat: 'system', prio: 'low', emoji: '⚙️' };
    if (/finanzamt|steuer|ecovis|ihk|gewerbe|krankenkasse|aok|behörde|gesetzlich|datev|justiz|gericht|polizei|zoll/.test(hay))
        return { cat: 'behoerde', prio: 'HIGH', emoji: '🏛️' };
    if (/anwalt|rechtsanwalt|kanzlei|weigel/.test(hay))
        return { cat: 'anwalt', prio: 'HIGH', emoji: '⚖️' };
    if (/sparkasse|commerzbank|volksbank|paypal|stripe|zettle|kontoauszug|sepa|interactive ?brokers|adobe|amazon\sbusiness|google[-_ ]?play|microsoft 365|apple/.test(hay))
        return { cat: 'finanz', prio: 'normal', emoji: '💳' };
    if (/buchung|reservierung|fahrt|taxi|rechnung|invoice|auftrag|kunde|hotel|gast|abholung|transfer|flugha|krankenfah/.test(hay))
        return { cat: 'geschaeft', prio: 'normal', emoji: '🚕' };
    if (/praxis|arzt|doktor|rezept|blutwerte|gramsch|weihs|moskwa|patientenportal|krankschreib/.test(hay))
        return { cat: 'gesundheit', prio: 'HIGH', emoji: '💊' };
    if (/vetter|reise|tour|veranstaltung|ausflug|festival/.test(hay))
        return { cat: 'business', prio: 'normal', emoji: '🏨' };
    return { cat: 'sonstige', prio: 'normal', emoji: '📩' };
}

async function pullAccount(cfg) {
    const out = { account: cfg.name, user: cfg.user, total: 0, items: [] };
    const client = new ImapFlow({ host: cfg.host, port: cfg.port, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ since: SINCE });
    LOG(cfg.name, 'UIDs:', uids.length);
    out.total = uids.length;
    for (const uid of uids) {
        try {
            const msg = await client.fetchOne(uid, { envelope: true, source: true, internalDate: true });
            if (!msg) continue;
            const parsed = msg.source ? await simpleParser(msg.source) : null;
            const env = msg.envelope || {};
            const snippet = ((parsed && (parsed.text || parsed.html || '')) || '').toString().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300).toLowerCase();
            const cls = classify(env, snippet);
            out.items.push({
                uid,
                date: env.date ? new Date(env.date).toISOString().slice(0, 16).replace('T', ' ') : '',
                from: env.from?.[0] ? `${env.from[0].name || ''} <${env.from[0].address || ''}>`.trim() : '',
                fromAddress: env.from?.[0]?.address || '',
                subject: env.subject || '',
                snippet: snippet.slice(0, 180),
                cat: cls.cat,
                prio: cls.prio,
                emoji: cls.emoji,
                hasAttachments: !!(parsed && parsed.attachments && parsed.attachments.length),
            });
        } catch (e) { LOG('parse-err', cfg.name, uid, e.message); }
    }
    await client.logout();
    return out;
}

(async () => {
    const all = [];
    for (const acc of accounts) {
        try {
            const r = await pullAccount(acc);
            all.push(r);
        } catch (e) {
            LOG('account-err', acc.name, e.message);
            all.push({ account: acc.name, error: e.message, items: [] });
        }
    }
    fs.writeFileSync('./mail-briefing-output.json', JSON.stringify(all, null, 2));
    // Konsolen-Übersicht
    for (const acc of all) {
        console.log('\n═══ ' + acc.account + ' (' + (acc.items?.length || 0) + ' Mails) ═══');
        const buckets = {};
        for (const it of (acc.items || [])) {
            buckets[it.cat] = buckets[it.cat] || [];
            buckets[it.cat].push(it);
        }
        const order = ['behoerde', 'anwalt', 'gesundheit', 'business', 'geschaeft', 'finanz', 'sonstige', 'system', 'werbung'];
        for (const cat of order) {
            const list = (buckets[cat] || []).sort((a, b) => (a.date < b.date ? 1 : -1));
            if (!list.length) continue;
            console.log('\n  ' + (list[0].emoji || '') + ' ' + cat.toUpperCase() + ' (' + list.length + ')');
            for (const it of list) {
                console.log('    ' + it.date + ' | ' + it.from.substring(0, 50));
                console.log('       └─ ' + it.subject.substring(0, 100) + (it.hasAttachments ? ' 📎' : ''));
            }
        }
    }
    console.log('\n[fertig] JSON-Backup: ./mail-briefing-output.json');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
