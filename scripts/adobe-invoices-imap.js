#!/usr/bin/env node
// adobe-invoices-imap.js — Patrick (21.05.2026): Adobe-Rechnungen aus Gmail via IMAP ziehen.
// Sucht alle 'Steuerfreie Transaktion mit Adobe' Mails von message@adobe.com seit 01.01.2025,
// extrahiert die PDF-Anhänge und speichert sie in OneDrive/5.Buchführung/Rechnungen/Adobe/{Jahr}/.

const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');

// Gmail App-Password (aus session memory, NICHT in Git)
const GMAIL_USER = 'taxiwydra@googlemail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;   // App-Password (SMTP/IMAP)

const OUT_ROOT = 'C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Adobe';

const cfg = {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    logger: false,
};

(async () => {
    const client = new ImapFlow(cfg);
    try {
        console.log('[Adobe-IMAP] Verbinde Gmail-IMAP ...');
        await client.connect();
        await client.mailboxOpen('INBOX');
        console.log('[Adobe-IMAP] Verbunden');

        // Suche alle Adobe-Mails seit 01.01.2025
        const since = new Date('2025-01-01');
        const uids = await client.search({
            from: 'adobe.com',
            since,
        });
        console.log(`[Adobe-IMAP] ${uids.length} Treffer von adobe.com seit 2025-01-01`);

        let downloaded = 0;
        const log = [];
        for (const uid of uids) {
            const msg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true });
            const dateISO = msg.internalDate?.toISOString();
            const subject = msg.envelope.subject || '';
            const from = msg.envelope.from?.[0]?.address || '';
            // Nur Rechnungs-Mails (mit PDF-Anhang) interessieren
            const parsed = await simpleParser(msg.source);
            const pdfs = (parsed.attachments || []).filter(a => a.contentType === 'application/pdf' || (a.filename || '').toLowerCase().endsWith('.pdf'));
            const entry = {
                uid,
                date: dateISO,
                from,
                subject,
                pdfCount: pdfs.length,
                pdfFiles: [],
            };
            if (pdfs.length === 0) {
                log.push(entry);
                continue;
            }
            const year = (dateISO || '').slice(0, 4) || '2025';
            const outDir = path.join(OUT_ROOT, year);
            fs.mkdirSync(outDir, { recursive: true });
            for (const att of pdfs) {
                const safeName = (att.filename || `adobe-${dateISO?.slice(0,10)}-${uid}.pdf`)
                    .replace(/[<>:"/\\|?*]/g, '_');
                const dest = path.join(outDir, safeName);
                fs.writeFileSync(dest, att.content);
                entry.pdfFiles.push(safeName);
                downloaded++;
                console.log(`  [DL] ${dateISO?.slice(0,10)} | ${safeName} (${att.content.length} bytes)`);
            }
            log.push(entry);
        }

        // Log-Datei schreiben
        const logFile = path.join(OUT_ROOT, '_adobe-import-log.json');
        fs.writeFileSync(logFile, JSON.stringify({
            fetchedAt: new Date().toISOString(),
            total: uids.length,
            downloaded,
            entries: log,
        }, null, 2));
        console.log(`\n[Adobe-IMAP] FERTIG: ${downloaded} PDFs aus ${uids.length} Mails`);
        console.log(`[Adobe-IMAP] Log: ${logFile}`);

        await client.logout();
        process.exit(0);
    } catch (e) {
        console.error('[Adobe-IMAP] FEHLER:', e.message);
        try { await client.logout(); } catch {}
        process.exit(1);
    }
})();
