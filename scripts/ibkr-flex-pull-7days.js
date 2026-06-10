#!/usr/bin/env node
// ibkr-flex-pull-7days.js — Patrick (10.06.2026 16:12):
// Activity-Flex-Statement-XMLs der letzten 7 Tage aus Gmail ziehen,
// in graham-value/data/flex/ ablegen + Trade-Statistik ausgeben.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const GMAIL_USER = 'taxiwydra@googlemail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;

if (!GMAIL_PASS) {
    console.error('❌ GMAIL_PASS env-var fehlt');
    process.exit(1);
}

const OUT_DIR = 'C:/Taxi App/graham-value/data/flex';
fs.mkdirSync(OUT_DIR, { recursive: true });

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    logger: false,
};

function parseFlexXml(xml) {
    const trades = [];
    const re = /<Trade\b([^>]+?)\/>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const attrs = {};
        const a = m[1];
        for (const am of a.matchAll(/(\w+)="([^"]*)"/g)) attrs[am[1]] = am[2];
        trades.push(attrs);
    }
    return trades;
}

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let allTrades = [];
    try {
        const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        const uids = await client.search({
            from: 'donotreply@interactivebrokers.com',
            subject: 'Activity Flex',
            since
        });
        console.log(`📧 ${uids.length} Flex-Statements gefunden`);
        for (const uid of uids) {
            const msg = await client.fetchOne(uid, { source: true });
            const parsed = await simpleParser(msg.source);
            for (const att of parsed.attachments || []) {
                if (!att.filename || !att.filename.endsWith('.xml')) continue;
                const fp = path.join(OUT_DIR, att.filename);
                fs.writeFileSync(fp, att.content);
                const xml = att.content.toString('utf8');
                const trades = parseFlexXml(xml);
                console.log(`  ✓ ${att.filename}: ${trades.length} Trades`);
                allTrades.push(...trades.map(t => ({ ...t, _file: att.filename })));
            }
        }
    } finally {
        lock.release();
        await client.logout();
    }
    // Summary
    fs.writeFileSync(path.join(OUT_DIR, '_summary-7days.json'),
        JSON.stringify({ generatedAt: new Date().toISOString(), totalTrades: allTrades.length, trades: allTrades }, null, 2));
    console.log(`\n✅ ${allTrades.length} Trades total in ${OUT_DIR}/_summary-7days.json`);
    // Quick-Stat
    const bySymbol = {};
    for (const t of allTrades) {
        const sym = t.symbol || t.underlyingSymbol || '?';
        if (!bySymbol[sym]) bySymbol[sym] = 0;
        bySymbol[sym]++;
    }
    console.log('\nTop-Symbole:');
    Object.entries(bySymbol).sort((a, b) => b[1] - a[1]).slice(0, 15)
        .forEach(([s, c]) => console.log(`  ${s}: ${c}`));
})().catch(e => { console.error('❌', e.message); process.exit(1); });
