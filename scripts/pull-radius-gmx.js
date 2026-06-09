#!/usr/bin/env node
// Radius-Pull aus GMX-Postfach
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = { host: 'imap.gmx.net', port: 993, secure: true,
    auth: { user: 'taxiwydra@gmx.de', pass: process.env.GMX_PASS }, logger: false };
const OUT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Radius/2025';
fs.mkdirSync(OUT, { recursive: true });
const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const queries = [
        { from: 'radius' },
        { subject: 'Radius' },
        { subject: 'Tankabrechnung' },
        { body: 'Radius Business' }
    ];
    const allUids = new Set();
    for (const q of queries) {
        try {
            const uids = await client.search({ since: new Date('2025-01-01'), before: new Date('2026-02-01'), ...q });
            LOG('Q', JSON.stringify(q), '→', uids.length);
            uids.forEach(u => allUids.add(u));
        } catch (e) { LOG('q err:', e.message); }
    }
    LOG('Total unique:', allUids.size);
    let saved = 0;
    for (const uid of allUids) {
        const msg = await client.fetchOne(uid, { source: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = ((parsed.from && parsed.from.text) || '').toLowerCase();
        if (!/radius/i.test(from + (parsed.subject || ''))) continue;
        const date = parsed.date ? parsed.date.toISOString().slice(0, 10) : 'unk';
        const atts = (parsed.attachments || []).filter(a => /pdf/i.test(a.contentType || a.filename || ''));
        for (const att of atts) {
            const safeFn = att.filename ? att.filename.replace(/[<>:"/\\|?*]/g, '_') : `radius_${date}_${uid}.pdf`;
            const fn = `${date}_${safeFn}`;
            const dest = path.join(OUT, fn);
            if (fs.existsSync(dest)) { LOG('skip', fn); continue; }
            fs.writeFileSync(dest, att.content);
            saved++;
            LOG('✅', fn);
        }
    }
    await client.logout();
    LOG('PDFs gespeichert:', saved);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
