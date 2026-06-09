#!/usr/bin/env node
// pull-ibkr-taxilv-lexware-nickel.js — 4 Sender parallel ziehen
// IBKR: Wertpapier-Belege | Taxilandesverband-MV: Mitgliedsbeiträge | Lexware: Rechnungen | Nickel: Werbeagentur

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const cfg = {
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: 'taxiwydra@googlemail.com', pass: process.env.GMAIL_PASS }, logger: false,
};

const OUT_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen';
const SINCE = new Date('2025-01-01');

const SENDERS = [
    { name: 'IBKR',              folder: 'IBKR',                  from: 'donotreply@interactivebrokers.com' },
    { name: 'Taxilandesverband', folder: 'Taxilandesverband-MV',  from: 'info@taxilandesverband-mv.de' },
    { name: 'Lexware',           folder: 'Lexware',               from: 'versand@belege.lexware.de' },
    { name: 'Nickel',            folder: 'Werbeagentur-Nickel',   from: 'buchhaltung@werbeagentur-nickel.de' },
];

(async () => {
    const client = new ImapFlow(cfg);
    await client.connect();
    await client.mailboxOpen('INBOX');
    let totalDl = 0;
    for (const s of SENDERS) {
        console.log('\n=== ' + s.name + ' (' + s.from + ') ===');
        const uids = await client.search({ from: s.from, since: SINCE });
        console.log(uids.length + ' Mails');
        let dl = 0;
        for (const uid of uids) {
            let msg;
            try { msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }); }
            catch { continue; }
            const parsed = await simpleParser(msg.source);
            const pdfs = (parsed.attachments || []).filter(a =>
                a.contentType === 'application/pdf' || (a.filename || '').toLowerCase().endsWith('.pdf')
            );
            if (pdfs.length === 0) continue;
            const dateISO = msg.internalDate?.toISOString().slice(0, 10) || '';
            const year = dateISO.slice(0, 4);
            const destDir = path.join(OUT_ROOT, s.folder, year);
            fs.mkdirSync(destDir, { recursive: true });
            for (const att of pdfs) {
                const safe = (att.filename || `${s.folder}-${dateISO}-uid${uid}.pdf`).replace(/[<>:"/\\|?*]/g, '_').slice(0, 180);
                const dest = path.join(destDir, safe);
                if (fs.existsSync(dest) && fs.statSync(dest).size === att.content.length) continue;
                fs.writeFileSync(dest, att.content);
                dl++; totalDl++;
            }
        }
        console.log('  → ' + dl + ' PDFs neu');
    }
    console.log('\n[GESAMT] ' + totalDl + ' PDFs');
    await client.logout();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
