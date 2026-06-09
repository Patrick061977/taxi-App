#!/usr/bin/env node
// pull-radius-imap.js — Patrick (24.05.2026): Tank-Belege Radius Business Solutions
// Holt alle Radius-Mails 2025 aus Gmail + speichert PDFs nach OneDrive
const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

const GMAIL_USER = 'taxiwydra@googlemail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;
const OUT_DIR = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Radius/2025';
fs.mkdirSync(OUT_DIR, { recursive: true });

const LOG = (...a) => console.log('[' + new Date().toISOString().slice(11,19) + ']', ...a);

(async () => {
    const client = new ImapFlow({
        host: 'imap.gmail.com', port: 993, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS }, logger: false,
    });
    await client.connect();
    await client.mailboxOpen('INBOX');

    // OR-Search: "radius" UND/ODER "Tankabrechnung" UND/ODER bestimmte Sender-Domains
    const queries = [
        { from: 'radius' },
        { from: 'radiusbusiness' },
        { from: 'mail.radiusbusiness.com' },
        { subject: 'Radius' },
        { subject: 'Tankabrechnung' },
        { body: 'Radius Business' }
    ];

    const allUids = new Set();
    for (const q of queries) {
        try {
            const uids = await client.search({ since: new Date('2025-01-01'), before: new Date('2026-01-01'), ...q });
            LOG('Query', JSON.stringify(q), '→', uids.length, 'msgs');
            uids.forEach(uid => allUids.add(uid));
        } catch (e) { LOG('Query error:', q, e.message); }
    }
    LOG('Total unique:', allUids.size);

    let savedPdfCount = 0;
    let mailsWithPdf = 0;
    const summary = [];
    for (const uid of allUids) {
        try {
            const msg = await client.fetchOne(uid, { source: true });
            if (!msg || !msg.source) continue;
            const parsed = await simpleParser(msg.source);
            const date = parsed.date ? parsed.date.toISOString().slice(0, 10) : 'unknown';
            const from = ((parsed.from && parsed.from.text) || '').toLowerCase();
            const subject = parsed.subject || '';
            // Filter: must be from Radius
            const isRadius = /radius/i.test(from + subject);
            if (!isRadius) continue;
            const atts = (parsed.attachments || []).filter(a => /pdf/i.test(a.contentType || a.filename || ''));
            if (atts.length === 0) {
                summary.push({ date, from, subject, pdfs: 0 });
                continue;
            }
            mailsWithPdf++;
            for (const att of atts) {
                const safeFn = att.filename ? att.filename.replace(/[<>:"/\\|?*]/g, '_') : `radius_${date}_${uid}.pdf`;
                const fn = `${date}_${safeFn}`;
                const dest = path.join(OUT_DIR, fn);
                if (fs.existsSync(dest)) { LOG('skip exists:', fn); continue; }
                fs.writeFileSync(dest, att.content);
                savedPdfCount++;
                LOG('✅ saved:', fn, `(${Math.round(att.content.length/1024)} KB)`);
            }
            summary.push({ date, from, subject, pdfs: atts.length });
        } catch (e) { LOG('fetch err uid=' + uid + ':', e.message); }
    }

    await client.logout();
    LOG('\n=== ZUSAMMENFASSUNG ===');
    LOG('Gefundene Radius-Mails (von):', summary.length);
    LOG('davon mit PDF:', mailsWithPdf);
    LOG('PDFs neu gespeichert:', savedPdfCount);
    LOG('Ausgabe-Ordner:', OUT_DIR);
    // Save metadata
    fs.writeFileSync('C:/temp/radius-2025-pull.json', JSON.stringify(summary, null, 2));
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
